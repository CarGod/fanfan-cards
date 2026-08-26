import { t } from '@/i18n/index.ts'
import { sendMessage } from '@/services/messaging.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import type { Settings } from '@/types/settings.ts'
import {
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type BridgePayload,
  type BridgeResponse,
  type CaptionsData,
} from './bridge.ts'
import {
  SubtitleControl,
  mountControl,
  type ControlState,
  type ControlStatus,
} from './controlButton.ts'
import { SubtitleOverlay, type OverlayOptions, type SubtitleMode } from './subtitleOverlay.ts'
import {
  groupCues,
  orderFromPlayhead,
  planBatches,
  spreadTranslations,
  type CueGroup,
} from './segment.ts'
import { chooseTrack } from './trackSelect.ts'
import {
  buildTimedTextUrl,
  looksLikeBlockPage,
  parseJson3,
  requiresProofOfOrigin,
  trackLabel,
  type CaptionTrack,
  type Cue,
} from './timedtext.ts'
import { injectVideoStyles } from './styles.ts'

/**
 * 把前面那几块接到真实的 YouTube 页面上。
 *
 * 这个文件里的每一处等待、每一次重建，都是因为 YouTube 是单页应用：控制栏、播放器、
 * 视频元素都会在换视频时被换掉，而 URL 变了不代表 DOM 已经变好。所以不假设任何节点
 * 一直在，只假设它们迟早会来。
 */

/** 满编时一次请求打包多少组：够快，又不至于让单次失败损失太多。 */
const GROUPS_PER_REQUEST = 12
/**
 * 头两批故意小。
 *
 * 按下开关之后读者盯着的是第一行字什么时候出现，不是整支视频什么时候翻完。
 */
const FIRST_BATCHES = [2, 4]
/** 同时最多几个翻译请求在飞。 */
const MAX_CONCURRENT = 4
/** 等播放器出现的上限，超过就当这页没有播放器。 */
const MOUNT_TIMEOUT_MS = 20_000
/**
 * 等贴片广告的上限。
 *
 * 广告期间播放器给的是**广告那一支**的数据：没有字幕轨，`pot` 也是广告的，
 * 拿去取正片字幕只会换回一个空 body。这不是失败，是还没轮到我们——所以是等，不是报错。
 */
const CONTENT_WAIT_MS = 240_000
const CONTENT_POLL_MS = 700
const BRIDGE_TIMEOUT_MS = 20_000

function isWatchPage(): boolean {
  return location.pathname === '/watch'
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 地址栏里的那支视频。播放器在广告期间报的是另一支。 */
function videoIdFromUrl(): string {
  return new URLSearchParams(location.search).get('v') ?? ''
}

/**
 * 播放器手里拿的是不是读者点的那支片子。
 *
 * 这一个判断就是「广告一放功能就永久失效」的成因所在，所以把它拎出来单独钉住。
 * 两个信号缺一不可：播放器自己挂的广告标记，以及播放器报的视频 id 和地址栏对不对得上。
 * 只看广告标记不够——广告刚结束、正片数据还没换上来的那一瞬间，标记已经没了。
 */
export function contentIsReady(state: {
  /** 地址栏里的 v 参数。取不到时不作要求。 */
  wantedVideoId: string
  /** 播放器此刻报的 id。还没就绪时是空的。 */
  playerVideoId: string
  adPlaying: boolean
}): boolean {
  if (state.adPlaying) return false
  if (!state.wantedVideoId || !state.playerVideoId) return true
  return state.playerVideoId === state.wantedVideoId
}

let requestSeq = 0

/** 向页面世界要一件事。超时按失败处理，不能让界面永远停在「正在准备」。 */
export function callMainWorld<T>(request: BridgePayload): Promise<T> {
  const id = `ff-${(requestSeq += 1)}`
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, onResponse)
      reject(new Error(t('video.error.bridge_timeout')))
    }, BRIDGE_TIMEOUT_MS)

    function onResponse(event: Event): void {
      let payload: BridgeResponse
      try {
        payload = JSON.parse(String((event as CustomEvent).detail)) as BridgeResponse
      } catch {
        return
      }
      if (payload.id !== id) return
      window.clearTimeout(timer)
      document.removeEventListener(RESPONSE_EVENT, onResponse)
      if (payload.ok) resolve(payload.data as T)
      else reject(new Error(payload.error))
    }

    document.addEventListener(RESPONSE_EVENT, onResponse)
    document.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ ...request, id }) }),
    )
  })
}

async function waitFor<T>(get: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = get()
    if (value) return value
    if (Date.now() > deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export class YouTubeSubtitles {
  private control: SubtitleControl | null = null
  private overlay: SubtitleOverlay | null = null
  private player: HTMLElement | null = null
  private video: HTMLVideoElement | null = null

  private cues: Cue[] = []
  private groups: CueGroup[] = []
  private groupTranslations: string[] = []
  private perCue: string[] = []

  private enabled = false
  private mode: SubtitleMode = 'bilingual'
  private fontScale = 1
  private background = 0.7
  private auto = false
  private trackName = ''
  private error = ''
  private status: ControlStatus = 'off'

  /** 每次换视频或重新加载都 +1；异步任务回来时对不上就丢掉自己的结果。 */
  private run = 0
  /** 挂载也要有代次：等控制栏的那二十秒里，读者完全可能已经换了两支视频。 */
  private mountRun = 0
  private frame = 0
  /** 整个实例活着期间只装一次的东西：导航监听、轮询、全局点击。 */
  private disposers: Array<() => void> = []
  /**
   * 每挂载一次装一次的东西。
   *
   * 和上面那组分开，是因为 `remount()` 只拆挂载、不拆实例。原来两组混在一个数组里，
   * 而 remount 从不清空它——于是每换一支视频就多留一个 ResizeObserver 在那儿观察，
   * 一个下午刷下来能攒几十个。
   */
  private mountDisposers: Array<() => void> = []

  async start(): Promise<void> {
    injectVideoStyles()

    const settings = await getSettings()
    this.applySettings(settings)

    /*
     * 两条发现「换视频了」的路子，共用一个 `lastHref`。
     *
     * 光听 `yt-navigate-finish` 不够：前进后退、以及从搜索页直接进视频的某些路径
     * 不发这个事件，所以还要轮询 URL 兜底。但两边各记各的账，就会在同一次换视频上
     * 各触发一次 remount——按钮闪一下重建、字幕重取一遍，**已经发出去的翻译请求
     * 全部作废重发**。花的是读者自己的 API 额度，而屏幕上只是「加载了两次」。
     *
     * 共用之后谁先发现谁干活，另一条自然变成空转。
     */
    let lastHref = location.href
    const onNavigate = (): void => {
      if (location.href === lastHref) return
      lastHref = location.href
      void this.remount()
    }

    window.addEventListener('yt-navigate-finish', onNavigate)
    this.disposers.push(() => window.removeEventListener('yt-navigate-finish', onNavigate))

    const poll = window.setInterval(onNavigate, 1000)
    this.disposers.push(() => window.clearInterval(poll))

    const closePanel = (): void => this.control?.closePanel()
    document.addEventListener('click', closePanel)
    this.disposers.push(() => document.removeEventListener('click', closePanel))

    await this.mount()
  }

  destroy(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
    this.disposeMount()
    this.teardownRun()
    this.control?.destroy()
    this.control = null
    this.overlay?.destroy()
    this.overlay = null
  }

  private applySettings(settings: Settings): void {
    this.mode = settings.videoSubtitleMode
    this.fontScale = settings.videoSubtitleFontScale
    this.background = settings.videoSubtitleBackground
    this.auto = settings.videoSubtitleAuto
  }

  /** 拆掉上一次挂载留下的东西。remount 与 destroy 都要走这里。 */
  private disposeMount(): void {
    for (const dispose of this.mountDisposers) dispose()
    this.mountDisposers = []
  }

  private async remount(): Promise<void> {
    this.teardownRun()
    this.disposeMount()
    this.control?.destroy()
    this.control = null
    this.overlay?.destroy()
    this.overlay = null
    await this.mount()
  }

  private async mount(): Promise<void> {
    /*
     * 代次先加，再判断在不在 watch 页。
     *
     * 反过来写会漏掉一种情况：上一次 mount 正卡在「等控制栏」的那二十秒里，读者跳去了
     * 首页——这一次 mount 在第一行就 return 了，代次没变，于是那个还在等的旧挂载
     * 以为自己仍然当值，等控制栏一出现就把界面挂到首页上，并按一个空的 videoId
     * 把上一支视频整轨重翻一遍。
     */
    const mountRun = (this.mountRun += 1)
    if (!isWatchPage()) return

    /*
     * 等的是控制栏，不是播放器。
     *
     * `#movie_player` 先出现，右侧控件排是后填的——按播放器就绪去挂按钮，
     * 在冷加载的机器上必然扑空，而扑空的表现是「按钮时有时无」，
     * 最难查的那一类。
     */
    const controls = await waitFor(
      () => document.querySelector('#movie_player .ytp-right-controls'),
      MOUNT_TIMEOUT_MS,
    )
    // 这二十秒里读者可能已经点去别的视频了，那这次挂载就作废。
    if (!controls || mountRun !== this.mountRun) return

    const player = controls.closest('#movie_player') as HTMLElement | null
    if (!player) return

    this.player = player
    this.video = player.querySelector('video')

    this.overlay = new SubtitleOverlay(this.overlayOptions())
    player.append(this.overlay.element)
    this.overlay.element.style.visibility = 'hidden'
    this.overlay.setPlayerWidth(player.clientWidth)

    /*
     * 字号锚在播放器宽度上，所以播放器变了就得重算：全屏、剧场模式、迷你播放器、
     * 拖窗口——这四件事没有一件会发 resize 给我们。
     */
    const sizes = new ResizeObserver(() => this.overlay?.setPlayerWidth(player.clientWidth))
    sizes.observe(player)
    this.mountDisposers.push(() => sizes.disconnect())

    this.control = new SubtitleControl(this.state(), {
      onToggle: (next) => void this.setEnabled(next),
      onMode: (next) => void this.setMode(next),
      onFontScale: (next) => void this.setFontScale(next),
      onBackground: (next) => void this.setBackground(next),
    })
    mountControl(controls, this.control)
    player.append(this.control.panelElement)

    // 上一支视频开着字幕，这一支就默认也开着——读者按下开关表达的是「我要看双语」，
    // 不是「我要在这一支视频上看双语」。整页翻译也是这个道理。
    if (this.auto) await this.setEnabled(true)
  }

  private state(): ControlState {
    return {
      enabled: this.enabled,
      status: this.status,
      mode: this.mode,
      fontScale: this.fontScale,
      background: this.background,
      trackLabel: this.trackName,
      error: this.error,
    }
  }

  private sync(): void {
    this.control?.setState(this.state())
  }

  private async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    this.error = ''
    this.status = enabled ? 'loading' : 'off'
    this.sync()
    await saveSettings({ videoSubtitleAuto: enabled })
    this.auto = enabled

    if (enabled) await this.load()
    else this.teardownRun()
  }

  private async setMode(mode: SubtitleMode): Promise<void> {
    this.mode = mode
    this.overlay?.setOptions(this.overlayOptions())
    this.sync()
    await saveSettings({ videoSubtitleMode: mode })
  }

  private async setFontScale(fontScale: number): Promise<void> {
    this.fontScale = fontScale
    this.overlay?.setOptions(this.overlayOptions())
    this.sync()
    await saveSettings({ videoSubtitleFontScale: fontScale })
  }

  private async setBackground(background: number): Promise<void> {
    this.background = background
    this.overlay?.setOptions(this.overlayOptions())
    this.sync()
    await saveSettings({ videoSubtitleBackground: background })
  }

  private overlayOptions(): OverlayOptions {
    return { mode: this.mode, fontScale: this.fontScale, background: this.background }
  }

  private fail(message: string): void {
    this.teardownRun()
    this.error = message
    this.trackName = ''
    this.status = this.enabled ? 'error' : 'off'
    this.sync()
  }

  private teardownRun(): void {
    this.run += 1
    this.status = this.enabled ? 'loading' : 'off'
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.cues = []
    this.groups = []
    this.groupTranslations = []
    this.perCue = []
    if (this.overlay) {
      this.overlay.element.style.visibility = 'hidden'
      /*
       * 藏起来的同时要让它忘掉「这一条画过了」。
       *
       * 不忘的话，关掉再打开时 `render` 算出的还是同一个下标，被去重那一行挡回去，
       * 于是按钮已经亮着、面板已经写着字幕来源，画面上却一个字都没有——要等播放头
       * 跨过这一句才恢复。译文回来时 `translateAll` 会调一次 `refresh()` 把它救回来，
       * 所以症状是「空白一小会儿」而不是「永远不出现」，但那一小会儿正好落在
       * 读者刚点完开关、最盯着屏幕的时刻。
       */
      this.overlay.refresh()
    }
    this.player?.removeAttribute('data-fanfan-subtitles')
    void callMainWorld({ kind: 'restore' }).catch(() => undefined)
  }

  /**
   * 等到播放器手里拿的是**正片**为止。
   *
   * YouTube 进页面先放广告。广告期间 `getPlayerResponse()` 给的是广告那一支：没有字幕轨，
   * 抓到的 `pot` 也是广告的。第一版在这里直接判失败，于是广告一放，功能就永久地不工作了,
   * 而读者看到的是开关明明开着、字幕却一直没有——这正是「状态和事实对不上」的那一刻。
   *
   * 判据是地址栏的 v 参数：播放器报的 id 和它对不上，就说明现在放的不是读者点的那支。
   */
  private async waitForContent(run: number): Promise<CaptionsData | null> {
    const wanted = videoIdFromUrl()
    const deadline = Date.now() + CONTENT_WAIT_MS

    for (;;) {
      if (run !== this.run) return null

      const captions = await callMainWorld<CaptionsData>({ kind: 'captions' })
      if (run !== this.run) return null

      const advert = this.isAdPlaying()
      if (
        contentIsReady({
          wantedVideoId: wanted,
          playerVideoId: captions.videoId,
          adPlaying: advert,
        })
      ) {
        return captions
      }
      // 等到头了也得给个结果：让后面按「没有字幕轨」处理，而不是无限等下去。
      if (Date.now() > deadline) return captions

      this.status = 'loading'
      this.trackName = advert ? t('video.status.ad_playing') : t('video.status.waiting_video')
      this.sync()
      await sleep(CONTENT_POLL_MS)
    }
  }

  /** 广告期间播放器会挂上这两个类，隔离世界读得到——DOM 是共享的。 */
  private isAdPlaying(): boolean {
    const classes = this.player?.classList
    return !!classes && (classes.contains('ad-showing') || classes.contains('ad-interrupting'))
  }

  private async load(): Promise<void> {
    const run = (this.run += 1)
    this.status = 'loading'
    this.trackName = t('video.status.loading_track')
    this.error = ''
    this.sync()

    try {
      const captions = await this.waitForContent(run)
      if (!captions || run !== this.run) return

      const settings = await getSettings()
      const choice = chooseTrack(captions.tracks as CaptionTrack[], {
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      })
      if (!choice) {
        this.fail(t('video.error.no_track'))
        return
      }

      const cues = await this.fetchCues(choice.track, captions.pot)
      if (run !== this.run) return
      if (cues.length === 0) {
        this.fail(t('video.error.empty_track'))
        return
      }

      this.cues = cues
      this.groups = groupCues(cues)
      this.groupTranslations = new Array<string>(this.groups.length).fill('')
      this.perCue = new Array<string>(cues.length).fill('')
      this.trackName = trackLabel(choice.track)
      this.error = ''
      this.status = 'on'
      this.sync()

      this.player?.setAttribute('data-fanfan-subtitles', 'on')
      this.startRendering()
      void this.translateAll(run)
    } catch (error) {
      if (run !== this.run) return
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * 取字幕本身。
   *
   * 两个坑都在这里：地址带 `exp=xpe` 时必须补上播放器现算的 `pot`，否则服务端回 200
   * 和一个空 body——不是错误码，是空的；而拿票的唯一办法是让播放器自己去取一次。
   */
  private async fetchCues(track: CaptionTrack, knownPot: string): Promise<Cue[]> {
    const needsToken = requiresProofOfOrigin(track.baseUrl)
    let pot = knownPot

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (needsToken && (!pot || attempt > 0)) {
        const primed = await callMainWorld<{ pot: string }>({
          kind: 'prime',
          languageCode: track.languageCode,
          // 第二次一定要把旧票丢掉：广告期间抓到的那张是广告那一支的。
          ...(attempt > 0 ? { force: true } : {}),
        })
        pot = primed.pot
      }

      const url = buildTimedTextUrl(track.baseUrl, pot ? { pot } : {})
      const response = await callMainWorld<{ status: number; body: string }>({ kind: 'fetch', url })

      if (response.status !== 200) {
        throw new Error(t('video.error.http_status', { status: response.status }))
      }
      if (looksLikeBlockPage(response.body)) throw new Error(t('video.error.blocked'))
      if (response.body.trim()) return parseJson3(JSON.parse(response.body))

      /*
       * 200 加一个空 body。
       *
       * 这是这一整块最难查的一种失败：不是错误码，是「成功地什么都没给你」。原因几乎
       * 总是票不对——地址上带 exp=xpe 时必须配一张当前视频的 pot，而广告期间抓到的
       * 那张属于广告。所以不报错，丢掉重来一次。
       */
    }

    throw new Error(t('video.error.empty_repeated'))
  }

  private startRendering(): void {
    const tick = (): void => {
      // <video> 有时比容器晚一步到，晚到的那一次不该让整个渲染循环就此停摆。
      if (!this.video) this.video = this.player?.querySelector('video') ?? null
      if (!this.overlay) return
      if (!this.video) {
        this.frame = requestAnimationFrame(tick)
        return
      }
      this.overlay.render(this.cues, this.perCue, this.video.currentTime * 1000)
      this.frame = requestAnimationFrame(tick)
    }
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(tick)
  }

  /**
   * 从读者正在看的那一段开始翻，翻完一批就刷一批。
   *
   * 从头翻是最好写的，也是最难用的：他在第八分钟按下开关，却要等前八分钟翻完
   * 才看到第一行字。
   */
  private async translateAll(run: number): Promise<void> {
    const now = this.video ? this.video.currentTime * 1000 : 0
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
          // 一批成功就说明上一批的失败是暂时的，别让旧的错误留在面板上。
          if (this.error) {
            this.error = ''
            this.sync()
          }
          // 译文迟到了：让叠加层忘掉「这一条画过了」，把已经显示的那行补上。
          this.overlay?.refresh()
        } catch (error) {
          if (run !== this.run) return
          // 失联之后整支视频的每一批都会失败。停住，别把面板刷成一串同样的错。
          if (noteOrphanError(error)) {
            this.error = t('video.error.orphaned')
            this.sync()
            return
          }
          // 一批失败只丢这一批。整条字幕轨不该因为中间一次网络抖动全没。
          this.error = error instanceof Error ? error.message : String(error)
          this.sync()
        }
      }
    }

    await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker))
  }
}
