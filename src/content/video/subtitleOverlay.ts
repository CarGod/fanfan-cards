import { cueIndexAt, type Cue } from './timedtext.ts'

/**
 * 播放器上的双语字幕层。
 *
 * 不改 YouTube 自己的字幕 DOM——播放器会随时重写它，全屏、剧场模式、切轨都会重建。
 * 我们只在播放器容器里叠一层自己的节点，和整页翻译「不动原文、只追加」是同一条原则。
 */

export type SubtitleMode = 'bilingual' | 'translationOnly'

export interface OverlayOptions {
  mode: SubtitleMode
  /** 字号倍率，1 为默认。 */
  fontScale: number
  /** 字幕底衬的不透明度，0 是完全透明（只靠描边压住画面）。 */
  background: number
}

export const OVERLAY_CLASS = 'fanfan-subtitle-overlay'

/** 译文尚未到达时的占位，避免字幕在等待期间整块跳动。 */
const PENDING = '…'

/**
 * 字号跟着**播放器**走，不跟着窗口走。
 *
 * 第一版用的是 `vw`，也就是视口宽度——于是把窗口拉宽，字就变大，哪怕播放器根本没变；
 * 而在一个 1440p 的屏幕上，默认档直接糊了半个画面。字幕是画面的一部分，它唯一该
 * 参照的就是画面本身。这个比例对着 YouTube 自己的默认字号调的。
 */
const WIDTH_RATIO = 0.0195
const MIN_PX = 13
const MAX_PX = 46
/** 原文退一步：它是拿来对照的，主角是译文。 */
const SOURCE_RATIO = 0.82
/** 播放器宽度还没量到时的兜底，别让字幕在第一帧是 0 号字。 */
const FALLBACK_WIDTH = 960
/** 低于这个不透明度就认为读者要的是「没有底衬」，描边得自己扛住画面。 */
const BARE_BACKGROUND = 0.15

const clamp = (min: number, value: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export class SubtitleOverlay {
  private readonly root: HTMLElement
  private readonly source: HTMLElement
  private readonly translation: HTMLElement
  private lastIndex = -2
  private options: OverlayOptions
  private playerWidth = 0

  constructor(options: OverlayOptions) {
    this.options = options
    this.root = document.createElement('div')
    this.root.className = `${OVERLAY_CLASS} notranslate`
    this.root.setAttribute('translate', 'no')
    // 字幕层不该吃掉点击：播放器的暂停、进度条都在它下面。
    this.root.style.pointerEvents = 'none'

    this.source = document.createElement('div')
    this.source.className = `${OVERLAY_CLASS}-source`
    this.translation = document.createElement('div')
    this.translation.className = `${OVERLAY_CLASS}-translation`

    this.root.append(this.source, this.translation)
    this.applyOptions()
  }

  get element(): HTMLElement {
    return this.root
  }

  setOptions(options: OverlayOptions): void {
    this.options = options
    this.applyOptions()
    // 模式变了要立刻重画，否则要等到下一句才生效。
    this.lastIndex = -2
  }

  /** 播放器尺寸变了（全屏、剧场模式、拖窗口）就重算字号。 */
  setPlayerWidth(width: number): void {
    if (width <= 0 || width === this.playerWidth) return
    this.playerWidth = width
    this.applyOptions()
  }

  /**
   * 按当前播放时间更新显示。
   *
   * `translations` 与 `cues` 一一对应；某一条还没翻好时给空串，这里显示占位符而不是
   * 把整行藏起来——字幕行忽有忽无比慢一点更难受。
   */
  render(cues: Cue[], translations: string[], timeMs: number): void {
    const index = cueIndexAt(cues, timeMs)
    if (index === this.lastIndex) return
    this.lastIndex = index

    if (index === -1) {
      this.root.style.visibility = 'hidden'
      return
    }
    this.root.style.visibility = 'visible'

    const cue = cues[index]!
    const translated = translations[index] ?? ''

    this.source.textContent = cue.text
    this.translation.textContent = translated || PENDING
    this.source.style.display = this.options.mode === 'bilingual' ? '' : 'none'
  }

  /** 译文迟到时调用：让下一次 render 不被去重挡住，把已显示的那行补上。 */
  refresh(): void {
    this.lastIndex = -2
  }

  destroy(): void {
    this.root.remove()
  }

  private applyOptions(): void {
    const width = this.playerWidth || FALLBACK_WIDTH
    const size = clamp(MIN_PX, width * WIDTH_RATIO * this.options.fontScale, MAX_PX)
    this.translation.style.fontSize = `${size.toFixed(1)}px`
    this.source.style.fontSize = `${(size * SOURCE_RATIO).toFixed(1)}px`

    const background = clamp(0, this.options.background, 1)
    this.root.style.setProperty('--ff-subtitle-bg', `rgba(8, 8, 8, ${background})`)
    // 底衬淡到不管用的时候，可读性只能靠描边接手。
    this.root.dataset['bare'] = String(background < BARE_BACKGROUND)
  }
}
