import { debounce } from '@/shared/utils.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { buildIndex, scanForSavedWords, type WordHit } from './scan.ts'

/**
 * 把词库里的词画到页面上。
 *
 * **不碰 DOM。** 用的是 CSS Custom Highlight API：给浏览器一组 Range，它负责画，
 * 页面的节点树一个字节都不动。
 *
 * 常规做法是把命中的词切出来包进 `<span>`，那条路在这个产品上走不通，三个原因：
 *
 * 1. 这个扩展的第一条规则是「不动原文」。整页翻译是追加兄弟节点才守得住这条，
 *    而包 span 要切开文本节点——那是真的在改别人的文档。
 * 2. x.com 这类页面由 React 托管。往它管的子树里插节点，下一次 render 轻则冲掉，
 *    重则让 React 按索引找子节点时直接抛错。而这两个站正是这个功能最有用的地方。
 * 3. 关掉时要把切开的文本节点精确合并回去，漏一处就是永久改了别人的页面——
 *    而这种漏法在开发机上永远看不出来。
 *
 * 代价有两条，都认了：`::highlight()` 只支持 background-color、color、
 * text-decoration 那几个属性（做不了圆角）；以及高亮本身收不到点击，
 * 得在 click 时反查坐标落在哪个 Range 里（见 {@link entryAt}）。
 */

/** 注册到 `CSS.highlights` 的名字，和 CSS 里的 `::highlight()` 对应。 */
export const HIGHLIGHT_NAME = 'fanfan-saved'

/** 重扫的防抖。信息流会一直改 DOM，每次都重扫等于把主线程焊死。 */
const RESCAN_DELAY_MS = 350

/**
 * 鼠标停在标出来的词上时，`<html>` 上挂这个属性。
 *
 * `::highlight()` 认不得 `cursor`（它只支持颜色、背景和文字装饰那几样），
 * 所以光标形状没法跟着高亮走，只能反过来：自己做命中测试，命中了就打个标记，
 * 由 CSS 去改光标。
 */
const HOVER_ATTRIBUTE = 'data-fanfan-word-hover'

interface Painted {
  range: Range
  entryId: string
}

export class SavedWordHighlighter {
  private index = new Map<string, string>()
  private painted: Painted[] = []
  private observer: MutationObserver | null = null
  private running = false
  /**
   * 上一次命中那个词的矩形。
   *
   * 命中测试要问浏览器「这个点落在哪个文本节点的第几个字符上」，那是一次布局查询。
   * 鼠标在一个词上移动时，每一帧都问一次是白问——先看还在不在上一次那个框里，
   * 在就直接复用。真正需要查的是「跨出去」和「刚进来」那两帧。
   */
  private hoverRect: DOMRect | null = null
  private hoverFrame = 0
  private pointer: { x: number; y: number } | null = null

  private readonly rescan = debounce(() => this.paint(), RESCAN_DELAY_MS)

  /** 浏览器不支持就安静地什么都不做——这是个锦上添花的功能，不该报错。 */
  static get supported(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
  }

  start(entries: readonly VocabularyEntry[]): void {
    if (!SavedWordHighlighter.supported) return
    this.running = true
    this.setEntries(entries)

    /*
     * 页面变了就重扫。
     *
     * Range 指着具体的文本节点，节点一换就失效——这一点和译文槽不同，译文槽
     * 靠 data-ara-id 认领得回来，Range 认不回来。所以这里不做增量，整页重扫，
     * 反正扫一遍是一次遍历加几万次哈希查找。
     */
    this.observer = new MutationObserver(() => this.rescan())
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    /*
     * 光标形状。
     *
     * 按帧节流：mousemove 一秒能发上百次，而命中测试是一次布局查询。
     * 滚动时也要清掉——页面动了，鼠标没动，但那个词已经不在指针底下了。
     */
    document.addEventListener('mousemove', this.onPointerMove, true)
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true })
    /*
     * 鼠标离开页面也要清掉。
     *
     * 这个标记只在「指针正停在那个词上」的那一刻成立，而它靠 mousemove 维持——
     * 指针移出窗口之后 mousemove 就不发了，标记会留在原地，
     * 表现成整页光标卡在手形上。这是这条实现唯一能出的丑，所以单独堵住。
     */
    document.addEventListener('mouseleave', this.onScroll)
    window.addEventListener('blur', this.onScroll)
  }

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY }
    if (this.hoverFrame) return
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0
      this.updateHoverCursor()
    })
  }

  private readonly onScroll = (): void => {
    this.setHover(false)
  }

  private updateHoverCursor(): void {
    const point = this.pointer
    if (!point || this.painted.length === 0) {
      this.setHover(false)
      return
    }

    /*
     * 还在上一次那个词的框里，就不用再问浏览器一次。
     *
     * 只有**量得到**的矩形才能当缓存用。`rectOf` 在量不到时会退回一个零尺寸的
     * 指针位置点，而那个点必然「包含」指针自己——拿它当缓存，鼠标就永远出不去，
     * 光标会一直卡在手形上。
     */
    const last = this.hoverRect
    if (
      last &&
      last.width > 0 &&
      last.height > 0 &&
      point.x >= last.left &&
      point.x <= last.right &&
      point.y >= last.top &&
      point.y <= last.bottom
    ) {
      return
    }

    const hit = this.hitAt(point.x, point.y)
    this.hoverRect = hit?.rect ?? null
    this.setHover(hit !== null)
  }

  private setHover(on: boolean): void {
    if (!on) this.hoverRect = null
    const root = document.documentElement
    if (on) root.setAttribute(HOVER_ATTRIBUTE, '')
    else root.removeAttribute(HOVER_ATTRIBUTE)
  }

  /** 词库变了：加了词、删了词、改了词形。 */
  setEntries(entries: readonly VocabularyEntry[]): void {
    this.index = buildIndex(entries)
    if (this.running) this.paint()
  }

  stop(): void {
    this.running = false
    this.rescan.cancel?.()
    this.observer?.disconnect()
    this.observer = null
    this.painted = []

    document.removeEventListener('mousemove', this.onPointerMove, true)
    window.removeEventListener('scroll', this.onScroll, true)
    document.removeEventListener('mouseleave', this.onScroll)
    window.removeEventListener('blur', this.onScroll)
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame)
    this.hoverFrame = 0
    this.pointer = null
    // 关掉之后一个痕迹都不留——包括这个只在悬停时才有的属性。
    this.setHover(false)

    if (SavedWordHighlighter.supported) CSS.highlights.delete(HIGHLIGHT_NAME)
  }

  /**
   * 这个坐标底下是哪一处高亮。
   *
   * 高亮收不到事件，所以点击是从坐标反查回来的：先问浏览器这个点落在哪个文本节点的
   * 第几个字符上，再看它落进了哪一段高亮里。
   *
   * 一次把卡片 id 和那个词的矩形一起给出来。分两次查会查到**另一处**同词高亮上去——
   * 同一个词一页里出现好几次是常态，那样卡片会弹在别的段落旁边。
   */
  hitAt(x: number, y: number): { entryId: string; rect: DOMRect } | null {
    const caret = caretAt(x, y)
    if (!caret) return null
    for (const { range, entryId } of this.painted) {
      if (
        range.startContainer === caret.node &&
        caret.offset >= range.startOffset &&
        caret.offset <= range.endOffset
      ) {
        return { entryId, rect: rectOf(range, x, y) }
      }
    }
    return null
  }

  private paint(): void {
    if (!this.running) return
    const hits = scanForSavedWords(document.body, this.index)
    this.painted = hits.map(toPainted).filter((item): item is Painted => item !== null)
    // 重画之后旧的矩形不作数了：那个词可能已经挪走或者不再是高亮。
    this.hoverRect = null

    if (this.painted.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME)
      return
    }
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...this.painted.map((item) => item.range)))
  }
}

/**
 * 这处高亮在屏幕上的位置。
 *
 * 量不到就退回鼠标所在的点。Range 的矩形在几种情况下会是空的——元素被折叠、
 * 刚好在滚动出视口的边界上，或者环境根本没实现这个方法。空矩形会让卡片弹到
 * 页面左上角，那看起来像个 bug；弹在鼠标旁边至少是对的。
 */
function rectOf(range: Range, x: number, y: number): DOMRect {
  const rect = range.getBoundingClientRect?.()
  if (rect && (rect.width > 0 || rect.height > 0)) return rect
  return new DOMRect(x, y, 0, 0)
}

function toPainted(hit: WordHit): Painted | null {
  try {
    const range = document.createRange()
    range.setStart(hit.node, hit.start)
    range.setEnd(hit.node, hit.end)
    return { range, entryId: hit.entryId }
  } catch {
    // 节点在扫描和建 Range 之间被换掉了。下一次重扫会带上它。
    return null
  }
}

/**
 * 坐标 → 文本节点里的第几个字符。
 *
 * `caretRangeFromPoint` 不是标准但 Chrome 一直有；`caretPositionFromPoint` 是标准，
 * Chrome 128 才到。扩展的最低版本是 116，所以先用前者。
 */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const legacy = (
    document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
  ).caretRangeFromPoint?.(x, y)
  if (legacy) return { node: legacy.startContainer, offset: legacy.startOffset }

  const standard = (
    document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint?.(x, y)
  return standard ? { node: standard.offsetNode, offset: standard.offset } : null
}
