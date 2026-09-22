import { t } from '@/i18n/index.ts'
import type { MessageKey } from '@/i18n/messages.ts'
import { sendMessage } from '@/services/messaging.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'
import { shouldTranslateText, targetLanguage } from '@/shared/language.ts'
import { getSettings, isHostEnabled, saveSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import type { Settings } from '@/types/settings.ts'
import { BilibiliCueSource, isBilibiliPlayer } from './bilibili.ts'
import { CueSourceError, type CueSource, type CueSourceFailure } from './cueSource.ts'
import { SubtitleOverlay, type OverlayOptions } from './subtitleOverlay.ts'
import { groupCues, orderFromPlayhead, planBatches, spreadTranslations, type CueGroup } from './segment.ts'
import type { Cue } from './timedtext.ts'
import { injectVideoStyles } from './styles.ts'

/**
 * 任何网站上的视频，只要能拿到整条字幕轨。
 *
 * YouTube 那一套是专门写的：字幕要从它的接口拿，按钮要长进它的控制栏。可绝大多数
 * 网站的视频就是一个标准 `<video>`，字幕就是 `<track>`——浏览器已经把每一条 cue 和
 * 时间轴都给了，只差翻译和一层双语显示。这里做的就是这一段，不认识任何站点。
 * 认识的站点（B 站）只是换一个拿 cue 的地方，见 {@link CueSource}。
 *
 * 和 YouTube 一样的原则：不动网站自己的 DOM。所有东西都放在一个 `position: fixed`
 * 的宿主里，按视频的位置跟着走；全屏时再把宿主搬进全屏元素。
 */

export const HOST_CLASS = 'fanfan-video-host'
export const CHIP_CLASS = 'fanfan-video-chip'

const GROUPS_PER_REQUEST = 12
const FIRST_BATCHES = [2, 4]
const MAX_CONCURRENT = 3
/** 等 `<track>` 把 cue 加载出来的上限。 */
const CUES_WAIT_MS = 8_000
/** 视频比这还小的多半是预览图、背景装饰，不值得挂一颗按钮。 */
const MIN_WIDTH = 240
/** 页面 DOM 一直在变（播放器每秒都在改进度条），扫描要节流。 */
const SCAN_DEBOUNCE_MS = 500
/** 读者点过按钮之后，按钮多露这么久再随鼠标走；出错时更久，得让人看清那句话。 */
const REVEAL_MS = 2_500
const REVEAL_ERROR_MS = 4_000
/**
 * 至少这么大比例的 cue 不是读者自己的语言，才值得开双语。
 * 门槛定得很低：中文 up 主放几段英文片段也算数，那几段正是想看的。
 * 低于它就是整条都是中文（B 站给英文演讲配的中文 AI 字幕）：翻了也是同一句，不如直说。
 */
const MIN_FOREIGN_RATIO = 0.05

export interface TrackLike {
  kind: string
  language: string
  label: string
  mode: string
}

/** 有可翻的字幕轨才算：章节、元数据轨不是字幕。 */
export function isSubtitleTrack(track: { kind: string }): boolean {
  return track.kind === 'subtitles' || track.kind === 'captions'
}

/**
 * 挑一条轨。
 *
 * 读者设了源语言就按它挑；没设（自动）就当英文——这个产品是学英文的。都没有，
 * 就用网站正在显示的那条；再没有，第一条。
 */
export function pickTextTrack<T extends TrackLike>(tracks: readonly T[], sourceLanguage: string): T | null {
  const usable = tracks.filter(isSubtitleTrack)
  if (usable.length === 0) return null
  const want = (sourceLanguage === 'auto' ? 'en' : sourceLanguage).toLowerCase()
  return (
    usable.find((track) => track.language.toLowerCase().startsWith(want)) ??
    usable.find((track) => track.mode === 'showing') ??
    usable[0]!
  )
}

/** 浏览器的 cue 列表 → 我们的 Cue。去标签、并空白，空行丢掉。 */
export function cuesFromTrack(
  list: ArrayLike<{ startTime: number; endTime: number; text?: string }>,
): Cue[] {
  const cues: Cue[] = []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]!
    // 浏览器给的是 TextTrackCue；字幕轨上实际都是 VTTCue，带 text。别的种类没有，跳过。
    const text = (item.text ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    cues.push({ startMs: item.startTime * 1000, endMs: item.endTime * 1000, text })
  }
  return cues
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 标准 `<video>` 的 `<track>`：把轨设成 hidden 让浏览器照常加载 cue，我们只读。 */
export class TrackCueSource implements CueSource {
  private track: TextTrack | null = null
  private originalMode: TextTrackMode = 'disabled'

  async load(video: HTMLVideoElement, settings: Settings): Promise<Cue[]> {
    const track = pickTextTrack(Array.from(video.textTracks), settings.sourceLanguage)
    if (!track) throw new CueSourceError('no_track')
    this.track = track
    this.originalMode = track.mode
    // `hidden`：浏览器照常加载 cue、照常触发时间轴，只是不再自己画——这一层交给我们。
    track.mode = 'hidden'

    const deadline = Date.now() + CUES_WAIT_MS
    while ((!track.cues || track.cues.length === 0) && Date.now() < deadline) await sleep(200)
    const cues = track.cues ? cuesFromTrack(track.cues) : []
    if (cues.length === 0) throw new CueSourceError('no_track')
    return cues
  }

  release(): void {
    if (this.track) {
      try {
        this.track.mode = this.originalMode
      } catch {
        // 轨已经被网站换掉了，没什么可恢复的。
      }
    }
    this.track = null
  }
}

/** 这支视频的字幕从哪拿；哪都拿不到就不挂按钮。 */
function sourceFor(video: HTMLVideoElement): CueSource | null {
  if (isBilibiliPlayer(video)) return new BilibiliCueSource()
  const hasTrack = Array.from(video.textTracks).some(isSubtitleTrack) || video.querySelector('track') !== null
  return hasTrack ? new TrackCueSource() : null
}

/** 全屏时宿主得进全屏元素里，否则看不见。全屏的是 `<video>` 本身时进不去，只能放弃。 */
function hostParent(): HTMLElement {
  const full = document.fullscreenElement
  if (full instanceof HTMLElement && !(full instanceof HTMLVideoElement)) return full
  return document.documentElement
}

type FailReason = CueSourceFailure | 'own_language'

const FAIL_LABEL: Record<FailReason, MessageKey> = {
  no_track: 'video.generic.chip_error',
  login: 'video.generic.chip_login',
  network: 'video.generic.chip_network',
  own_language: 'video.generic.chip_own_language',
}

class VideoBinding {
  private readonly host: HTMLElement
  private readonly chip: HTMLButtonElement
  private readonly overlay: SubtitleOverlay

  private cues: Cue[] = []
  private groups: CueGroup[] = []
  private groupTranslations: string[] = []
  private perCue: string[] = []
  /** 上次加载 cue 时媒体的身份，见 {@link CueSource.key}。 */
  private mediaKey = ''
  private targetCode = 'zh-CN'

  private enabled = false
  private hovering = false
  private status: 'off' | 'loading' | 'on' | 'error' = 'off'
  private failReason: FailReason = 'no_track'
  private run = 0
  private frame = 0
  private revealTimer = 0
  /** 这次开关是读者点的，还是页面一打开自动开的。自动失败不打扰人，点了失败得告诉人。 */
  private userTriggered = false
  private disposers: Array<() => void> = []

  constructor(
    readonly video: HTMLVideoElement,
    private readonly source: CueSource,
    options: OverlayOptions,
    private readonly onToggled: (enabled: boolean) => void,
  ) {
    this.host = document.createElement('div')
    this.host.className = `${HOST_CLASS} notranslate`
    this.host.setAttribute('translate', 'no')

    this.chip = document.createElement('button')
    this.chip.type = 'button'
    this.chip.className = CHIP_CLASS
    this.chip.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.userTriggered = true
      this.reveal(REVEAL_MS)
      void this.setEnabled(!this.enabled)
    })
    this.host.append(this.chip)

    this.overlay = new SubtitleOverlay(options)
    this.overlay.element.style.visibility = 'hidden'
    this.host.append(this.overlay.element)
    hostParent().append(this.host)

    const onFullscreen = (): void => {
      const parent = hostParent()
      if (this.host.parentElement !== parent) parent.append(this.host)
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    this.disposers.push(() => document.removeEventListener('fullscreenchange', onFullscreen))

    this.renderChip()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setOptions(options: OverlayOptions): void {
    this.overlay.setOptions(options)
  }

  destroy(): void {
    this.disable()
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    if (this.revealTimer) clearTimeout(this.revealTimer)
    this.overlay.destroy()
    this.host.remove()
  }

  private setHover(hovering: boolean): void {
    if (hovering === this.hovering) return
    this.hovering = hovering
    this.updateShow()
    this.ensureLoop()
  }

  /**
   * 按钮什么时候露出来：鼠标在视频上、正在准备字幕、或者刚点过 / 刚出错的那几秒。
   * 字幕开着的时候按钮不常驻——看片的人不需要一颗一直亮着的按钮，字幕本身就是状态。
   */
  private updateShow(): void {
    this.host.dataset['show'] = String(this.hovering || this.revealTimer !== 0 || this.status === 'loading')
  }

  private reveal(ms: number): void {
    if (this.revealTimer) clearTimeout(this.revealTimer)
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = 0
      this.updateShow()
    }, ms)
    this.updateShow()
  }

  /**
   * 鼠标在哪。按坐标算「在不在视频上」，不听 `<video>` 自己的 mouseenter：
   * 播放器几乎都在视频上面盖着弹幕层、控制层，`<video>` 本身摸不到鼠标。
   */
  pointerAt(x: number, y: number): void {
    const rect = this.video.getBoundingClientRect()
    this.setHover(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
  }

  private renderChip(): void {
    const labelKey = {
      off: 'video.generic.chip_off',
      loading: 'video.generic.chip_loading',
      on: 'video.generic.chip_on',
      error: FAIL_LABEL[this.failReason],
    } as const
    this.chip.textContent = t(labelKey[this.status], { lang: t(targetLanguage(this.targetCode).labelKey) })
    this.chip.dataset['status'] = this.status
    this.chip.title = t('video.generic.chip_title')
    this.updateShow()
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.onToggled(enabled)
    if (enabled) await this.enable()
    else this.disable()
  }

  /**
   * 网站换了片子（B 站换 P）但 `<video>` 还是那一个：手里的 cue 是上一支的，重新拿。
   * 上一支没开起来、读者又是要自动开的，新的一支也再试一次。
   */
  refreshIfStale(auto: boolean): void {
    if (!this.source.key) return
    if (this.source.key() === this.mediaKey) return
    if (this.enabled) {
      this.disable()
      this.enabled = true
      void this.enable()
    } else if (auto) {
      void this.setEnabled(true)
    }
  }

  private async enable(): Promise<void> {
    const run = (this.run += 1)
    this.status = 'loading'
    this.renderChip()
    this.ensureLoop()

    const settings = await getSettings()
    if (run !== this.run) return
    this.targetCode = settings.targetLanguage
    this.mediaKey = this.source.key?.() ?? ''

    let cues: Cue[]
    try {
      cues = await this.source.load(this.video, settings)
    } catch (error) {
      if (run !== this.run) return
      // 按钮上只放一句人话；具体是哪一步没通留在控制台，排查时要看。
      console.warn('[fanfan] video subtitles unavailable:', error)
      this.fail(error instanceof CueSourceError ? error.reason : 'network')
      return
    }
    if (run !== this.run) return
    if (cues.length === 0) {
      this.fail('no_track')
      return
    }
    // 字幕本来就是读者自己的语言：翻出来还是同一句，不如在按钮上直说。
    const foreign = cues.filter((cue) => shouldTranslateText(cue.text, settings.targetLanguage)).length
    if (foreign < cues.length * MIN_FOREIGN_RATIO) {
      this.fail('own_language')
      return
    }

    this.cues = cues
    this.groups = groupCues(cues)
    this.groupTranslations = new Array<string>(this.groups.length).fill('')
    this.perCue = new Array<string>(cues.length).fill('')
    this.status = 'on'
    this.userTriggered = false
    this.renderChip()
    this.ensureLoop()
    void this.translateAll(run)
  }

  /**
   * 没开起来。只关掉这一次，不碰「下一支默认开」的设置——失败不是读者的选择，
   * 一支没字幕的视频不该把以后每一支都关掉。
   */
  private fail(reason: FailReason): void {
    this.run += 1
    this.status = 'error'
    this.failReason = reason
    this.enabled = false
    this.source.release()
    this.overlay.element.style.visibility = 'hidden'
    this.renderChip()
    if (this.userTriggered) this.reveal(REVEAL_ERROR_MS)
    this.userTriggered = false
  }

  private disable(): void {
    this.run += 1
    this.enabled = false
    this.status = 'off'
    this.cues = []
    this.groups = []
    this.groupTranslations = []
    this.perCue = []
    this.source.release()
    this.overlay.element.style.visibility = 'hidden'
    this.overlay.refresh()
    this.renderChip()
    this.ensureLoop()
  }

  /** 只在需要的时候跑帧循环：按钮露出来或字幕开着。其余时间一帧都不占。 */
  private ensureLoop(): void {
    const wanted = this.hovering || this.enabled || this.status === 'loading'
    if (!wanted) {
      if (this.frame) cancelAnimationFrame(this.frame)
      this.frame = 0
      return
    }
    if (this.frame) return
    const tick = (): void => {
      this.frame = 0
      this.position()
      if (this.enabled && this.status === 'on') {
        this.overlay.render(this.cues, this.perCue, this.video.currentTime * 1000)
      }
      if (this.hovering || this.enabled || this.status === 'loading') {
        this.frame = requestAnimationFrame(tick)
      }
    }
    this.frame = requestAnimationFrame(tick)
  }

  private position(): void {
    const rect = this.video.getBoundingClientRect()
    // 视频被网站藏起来（换集、折叠）时，按钮和字幕也一起藏。
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
    this.host.style.display = visible ? '' : 'none'
    if (!visible) return
    const parent = hostParent()
    // 宿主在全屏元素里时，坐标要减掉那个元素自己的偏移。
    const base = parent === document.documentElement ? { left: 0, top: 0 } : parent.getBoundingClientRect()
    this.host.style.left = `${rect.left - base.left}px`
    this.host.style.top = `${rect.top - base.top}px`
    this.host.style.width = `${rect.width}px`
    this.host.style.height = `${rect.height}px`
    this.overlay.setPlayerWidth(rect.width)
  }

  private async translateAll(run: number): Promise<void> {
    const now = this.video.currentTime * 1000
    const order = orderFromPlayhead(this.groups, this.cues, now)
    const batches = planBatches(order, FIRST_BATCHES, GROUPS_PER_REQUEST)

    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        if (run !== this.run) return
        const batch = batches[cursor]
        cursor += 1
        if (!batch) return
        try {
          const result = await sendMessage('page/translate', {
            texts: batch.map((index) => this.groups[index]!.text),
            hint: document.title,
          })
          if (run !== this.run) return
          batch.forEach((groupIndex, offset) => {
            this.groupTranslations[groupIndex] = result.translations[offset] ?? ''
          })
          this.perCue = spreadTranslations(this.cues, this.groups, this.groupTranslations)
          this.overlay.refresh()
        } catch (error) {
          if (run !== this.run) return
          if (noteOrphanError(error)) return
          // 一批失败只丢这一批，整条轨不该因为一次抖动全没。
          console.warn('[fanfan] video subtitle batch failed:', error)
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker))
  }
}

export class GenericVideoSubtitles {
  private readonly bindings = new Map<HTMLVideoElement, VideoBinding>()
  private options: OverlayOptions = { mode: 'bilingual', fontScale: 1, background: 0.7 }
  private auto = false
  private observer: MutationObserver | null = null
  private scanTimer = 0
  private disposers: Array<() => void> = []
  private started = false

  async start(): Promise<void> {
    const settings = await getSettings()
    if (!settings.enabled || !isHostEnabled(settings, location.hostname)) return
    injectVideoStyles()
    this.started = true
    this.applySettings(settings)
    this.disposers.push(watchSettings((next) => this.applySettings(next)))

    this.scan()
    this.observer = new MutationObserver(() => this.scheduleScan())
    this.observer.observe(document.documentElement, { childList: true, subtree: true })
    // 单页站换片子只改地址不一定动 DOM，地址一变也扫一遍。
    const onNavigate = (): void => this.scheduleScan()
    window.addEventListener('popstate', onNavigate)
    this.disposers.push(() => window.removeEventListener('popstate', onNavigate))

    // 一个 mousemove 喂给所有绑定，一帧最多算一次。
    let pointer: { x: number; y: number } | null = null
    let pending = 0
    const flush = (): void => {
      pending = 0
      if (!pointer) return
      for (const binding of this.bindings.values()) binding.pointerAt(pointer.x, pointer.y)
    }
    const onMove = (event: MouseEvent): void => {
      pointer = { x: event.clientX, y: event.clientY }
      if (!pending) pending = requestAnimationFrame(flush)
    }
    const onLeave = (): void => {
      pointer = { x: -1, y: -1 }
      if (!pending) pending = requestAnimationFrame(flush)
    }
    document.addEventListener('mousemove', onMove, { capture: true, passive: true })
    document.addEventListener('mouseleave', onLeave)
    this.disposers.push(() => {
      document.removeEventListener('mousemove', onMove, { capture: true })
      document.removeEventListener('mouseleave', onLeave)
      if (pending) cancelAnimationFrame(pending)
    })
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.observer?.disconnect()
    this.observer = null
    if (this.scanTimer) clearTimeout(this.scanTimer)
    for (const binding of this.bindings.values()) binding.destroy()
    this.bindings.clear()
  }

  private applySettings(settings: Settings): void {
    this.options = {
      mode: settings.videoSubtitleMode,
      fontScale: settings.videoSubtitleFontScale,
      background: settings.videoSubtitleBackground,
    }
    this.auto = settings.videoSubtitleAuto
    for (const binding of this.bindings.values()) binding.setOptions(this.options)
  }

  private scheduleScan(): void {
    if (this.scanTimer) return
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = 0
      this.scan()
    }, SCAN_DEBOUNCE_MS)
  }

  private scan(): void {
    if (!this.started) return
    // 已经绑定的视频从页面上消失了：拆掉，别留着一个宿主在那儿跟着一个不存在的元素。
    for (const [video, binding] of this.bindings) {
      if (!video.isConnected) {
        binding.destroy()
        this.bindings.delete(video)
        continue
      }
      binding.refreshIfStale(this.auto)
    }
    for (const video of Array.from(document.querySelectorAll('video'))) {
      if (this.bindings.has(video)) continue
      if (video.clientWidth > 0 && video.clientWidth < MIN_WIDTH) continue
      const source = sourceFor(video)
      if (!source) continue
      const binding = new VideoBinding(video, source, this.options, (enabled) => {
        // 和 YouTube 一样：读者按下开关表达的是「我要看双语」，下一支也默认开着。
        void saveSettings({ videoSubtitleAuto: enabled }).catch(() => undefined)
      })
      this.bindings.set(video, binding)
      if (this.auto) void binding.setEnabled(true)
    }
  }
}
