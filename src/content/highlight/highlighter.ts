import { clamp, debounce } from '@/shared/utils.ts'
import type { FamiliarityLevel, VocabularyEntry } from '@/types/vocabulary.ts'
import {
  applyBackdropAttribute,
  clearBackdropAttribute,
  watchPageBackdrop,
  type Backdrop,
  type BackdropWatch,
} from './backdrop.ts'
import { buildIndex, scanForSavedWords, type WordHit } from './scan.ts'
import { applyHighlightStyles, highlightCss, removeHighlightStyles } from './styles.ts'

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

/**
 * 注册到 `CSS.highlights` 的名字，和 CSS 里的 `::highlight()` 对应。
 *
 * **一个熟悉度一个名字。** 一个 Highlight 只带一套样式，而现在同一页上要同时画出
 * 「陌生」「学习中」「熟悉」「掌握」四种颜色，所以只能拆成四份注册。
 * 深浅两套底色**不**再各占一个名字——那笔账见 {@link ./styles.ts}。
 */
export const HIGHLIGHT_NAME_STEM = 'fanfan-saved'

export function highlightNameFor(level: FamiliarityLevel): string {
  return `${HIGHLIGHT_NAME_STEM}-${level}`
}

export const HIGHLIGHT_LEVELS: readonly FamiliarityLevel[] = [0, 1, 2, 3]
export const HIGHLIGHT_NAMES: readonly string[] = HIGHLIGHT_LEVELS.map(highlightNameFor)

/**
 * 这张卡在读者记忆里的位置。
 *
 * 防着读的：`review` 在类型上是必填，但这个值来自本地存储和另一台设备同步过来的
 * 数据，而这一层是**画在别人的页面上**——一条缺字段的记录不该让整页高亮消失。
 * 缺了就当 0 级，那也正是一个刚存下的词的样子。
 */
function levelOf(entry: VocabularyEntry): FamiliarityLevel {
  const level = entry.review?.level
  return (typeof level === 'number' ? clamp(Math.round(level), 0, 3) : 0) as FamiliarityLevel
}

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
  level: FamiliarityLevel
}

/** 开关：翻翻模式里那些和「画成什么样」有关的设置。 */
export interface HighlightOptions {
  /** 已经掌握（3 级）的词还标不标。 */
  showMastered: boolean
}

const DEFAULT_OPTIONS: HighlightOptions = { showMastered: true }

export class SavedWordHighlighter {
  private index = new Map<string, string>()
  private levels = new Map<string, FamiliarityLevel>()
  private painted: Painted[] = []
  private entries: readonly VocabularyEntry[] = []
  private options: HighlightOptions = DEFAULT_OPTIONS
  private observer: MutationObserver | null = null
  private running = false
  /**
   * 页面此刻是深底还是浅底。
   *
   * 这是这一层唯一记着的「外观」状态，也是那个 bug 的修法：以前这件事交给
   * `@media (prefers-color-scheme: dark)`，问的是操作系统；而 chatgpt.com
   * 在浅色系统上照样是深色页。现在是量出来的，见 backdrop.ts。
   */
  private backdrop: Backdrop = 'light'
  private backdropWatch: BackdropWatch | null = null
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

  start(entries: readonly VocabularyEntry[], options: HighlightOptions = DEFAULT_OPTIONS): void {
    if (!SavedWordHighlighter.supported) return
    this.running = true
    this.options = options

    /*
     * 先把底色量出来，再画。
     *
     * 顺序是有意的：`watchPageBackdrop` 会同步量第一次，于是那张 CSS 表在第一个
     * Range 注册之前就已经就位。反过来的话，第一屏的高亮会先用默认的浅色那套画出来，
     * 深色页面上就是「先闪一下几乎看不见的东西，再变对」。
     */
    this.backdropWatch = watchPageBackdrop((backdrop) => this.setBackdrop(backdrop))

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

  /** 词库变了：加了词、删了词、改了词形，或者复习之后熟悉度变了。 */
  setEntries(entries: readonly VocabularyEntry[]): void {
    this.entries = entries
    this.reindex()
    if (this.running) this.paint()
  }

  /**
   * 设置变了。
   *
   * 单独一个入口，不并进 `setEntries`：翻一下「标不标已掌握的词」不该顺带把整个词库
   * 重新拉一遍，而 App 那边的 effect 一旦把这个开关加进依赖，重建的就是整个高亮层。
   */
  setOptions(options: HighlightOptions): void {
    if (this.options.showMastered === options.showMastered) return
    this.options = options
    this.reindex()
    if (this.running) {
      this.applyStyles()
      this.paint()
    }
  }

  /**
   * 词形索引 + 熟悉度表。
   *
   * 熟悉度另存一张表，而不是塞进 `buildIndex` 的返回值：扫描那一层的职责是
   * 「哪一段是哪张卡」，不是「画成什么颜色」。两件事混在一张 Map 里之后，
   * 「匹配对不对」和「画得好不好看」这两种错就再也分不开了。
   *
   * 已掌握的词是在**建索引时**就剔掉的，不是画的时候才跳过：这样它根本不会成为一次命中，
   * 既不占那 400 处的名额，也不会在页面上留下一个看不见却点得开的热区。
   */
  private reindex(): void {
    const visible = this.options.showMastered
      ? this.entries
      : this.entries.filter((entry) => levelOf(entry) !== 3)
    this.index = buildIndex(visible)
    this.levels = new Map(visible.map((entry) => [entry.id, levelOf(entry)]))
  }

  private setBackdrop(backdrop: Backdrop): void {
    this.backdrop = backdrop
    if (!this.running) return
    applyBackdropAttribute(backdrop)
    this.applyStyles()
  }

  private applyStyles(): void {
    applyHighlightStyles(highlightCss(this.backdrop, this.options.showMastered))
  }

  stop(): void {
    this.running = false
    this.rescan.cancel?.()
    this.observer?.disconnect()
    this.observer = null
    this.painted = []
    this.backdropWatch?.stop()
    this.backdropWatch = null
    /*
     * 把词库也放掉。
     *
     * 这个高亮层是模块级的单例，活得和这个标签页一样久。关掉翻翻模式之后还攥着
     * `entries`，等于把整个词库——每张卡的 AI 解释、例句、近义词、当初那一页的原文——
     * 留在别人的页面上直到读者离开。`start()` 每次都会重新灌一遍，留着没有任何用处。
     */
    this.entries = []
    this.index.clear()
    this.levels.clear()

    document.removeEventListener('mousemove', this.onPointerMove, true)
    window.removeEventListener('scroll', this.onScroll, true)
    document.removeEventListener('mouseleave', this.onScroll)
    window.removeEventListener('blur', this.onScroll)
    if (this.hoverFrame) cancelAnimationFrame(this.hoverFrame)
    this.hoverFrame = 0
    this.pointer = null
    // 关掉之后一个痕迹都不留——那张 CSS 表，和两个只在运行时才有的属性。
    this.setHover(false)
    clearBackdropAttribute()
    removeHighlightStyles()

    if (SavedWordHighlighter.supported) {
      for (const name of HIGHLIGHT_NAMES) CSS.highlights.delete(name)
    }
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

    /*
     * 顺手把底色再量一次。
     *
     * 观察器盯的是 html 和 body 上的属性，而有一种换主题的做法它看不见：
     * 直接给某个 <link rel=stylesheet> 加上 disabled。为那一种单开轮询不值得，
     * 但页面只要有任何动静就会走到这里，几十微秒把它兜住。
     */
    this.backdropWatch?.resample()

    const hits = scanForSavedWords(document.body, this.index)
    this.painted = hits
      .map((hit) => this.toPainted(hit))
      .filter((item): item is Painted => item !== null)
    // 重画之后旧的矩形不作数了：那个词可能已经挪走或者不再是高亮。
    this.hoverRect = null

    /*
     * 按熟悉度分桶，一桶一个注册项。
     *
     * 空桶必须**删掉**，不能只是不管它。以前只有一个名字，判「一处都没有就删」够用；
     * 拆成四个之后，读者把最后一个 1 级的词复习升到 2 级，1 级那一桶就空了——
     * 不删的话，那些已经作废的 Range 会一直画在页面上，而且从此再也不更新。
     */
    for (const level of HIGHLIGHT_LEVELS) {
      const name = highlightNameFor(level)
      const ranges = this.painted.filter((item) => item.level === level).map((item) => item.range)
      if (ranges.length === 0) CSS.highlights.delete(name)
      else CSS.highlights.set(name, new Highlight(...ranges))
    }
  }

  private toPainted(hit: WordHit): Painted | null {
    try {
      const range = document.createRange()
      range.setStart(hit.node, hit.start)
      range.setEnd(hit.node, hit.end)
      return { range, entryId: hit.entryId, level: this.levels.get(hit.entryId) ?? 0 }
    } catch {
      // 节点在扫描和建 Range 之间被换掉了。下一次重扫会带上它。
      return null
    }
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
