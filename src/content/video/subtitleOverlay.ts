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
  /** 相对播放器宽度的字号倍率，1 为默认。 */
  fontScale: number
}

export const OVERLAY_CLASS = 'fanfan-subtitle-overlay'

/** 译文尚未到达时的占位，避免字幕在等待期间整块跳动。 */
const PENDING = '…'

export class SubtitleOverlay {
  private readonly root: HTMLElement
  private readonly source: HTMLElement
  private readonly translation: HTMLElement
  private lastIndex = -2
  private options: OverlayOptions

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
    const scale = this.options.fontScale
    this.source.style.fontSize = `${(2.2 * scale).toFixed(2)}vw`
    this.translation.style.fontSize = `${(2.4 * scale).toFixed(2)}vw`
  }
}
