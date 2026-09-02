import { clamp, debounce } from '@/shared/utils.ts'
import { DEFAULT_FANFAN_PALETTE, type FanfanPaletteId } from '@/shared/fanfanPalette.ts'
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
  /** 使用哪套亮/暗成对的高亮主题。 */
  palette: FanfanPaletteId
}

const DEFAULT_OPTIONS: HighlightOptions = {
  showMastered: true,
  palette: DEFAULT_FANFAN_PALETTE,
}

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

  start(entries: readonly VocabularyEntry[], options: Partial<HighlightOptions> = {}): void {
    if (!SavedWordHighlighter.supported) return
    this.running = true
    this.options = { ...DEFAULT_OPTIONS, ...options }

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
    /*
     * 改了窗口大小也要清掉。
     *
     * DOM 没变（观察器看不见），指针没动（mousemove 不发），但重排之后那个词
     * 已经不在指针底下了，而缓存的矩形还「包含」着指针，于是不再重查。
     * 滚动堵住的是同一类账，只是这一半以前漏了。
     *
     * 只兜得住窗口尺寸和浏览器缩放——发 resize 的只有它们。字体加载完回流、
     * 图片撑开同样会把那个词挪走，却不发任何事件，这里够不着；代价是重排之后
     * 指针若仍落在旧矩形里，手形光标会多留一会儿，直到指针移出那个矩形。
     */
    window.addEventListener('resize', this.onScroll)
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
    if (last && last.width > 0 && last.height > 0 && within(last, point.x, point.y)) return

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
  setOptions(options: Partial<HighlightOptions>): void {
    const next = { ...this.options, ...options }
    const masteredChanged = this.options.showMastered !== next.showMastered
    const paletteChanged = this.options.palette !== next.palette
    if (!masteredChanged && !paletteChanged) return
    this.options = next
    if (masteredChanged) this.reindex()
    if (this.running) {
      this.applyStyles()
      if (masteredChanged) this.paint()
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
    applyHighlightStyles(
      highlightCss(this.backdrop, this.options.showMastered, this.options.palette),
    )
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
    window.removeEventListener('resize', this.onScroll)
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
   * 第几个字符上，再看它落进了哪一段高亮里，最后**量一次这处高亮画在哪，确认这个点
   * 真的压在色块上**。
   *
   * 最后这一步不是保险，是这条路子唯一的把关。`caretRangeFromPoint` 回答的是
   * 「离这个点最近的插入点在哪」，不是「这个点压在哪个字上」——它本来是给
   * 「在输入框里点一下把光标放过去」用的，点在一行右边的空白上，光标就得落到行尾，
   * 所以它**按设计**会把远处的坐标吸到最近的字符边界，而且几乎不返回 null。
   * 只比字符偏移的话，一个独占一行的词会把「这一行右边所有空白」都算成自己的热区，
   * 一直连到块容器的边缘；而误命中的代价不只是弹错卡片，还会把宿主页面的这次点击
   * 整个吞掉（见 App.tsx 里的 preventDefault + stopPropagation）。
   *
   * 偏移那一关留着，它是个**便宜的预筛**：一页上高亮能有几百处，每处都去量矩形是
   * 每帧几百次布局查询；偏移比对是纯数值，先用它把候选缩到通常 0 或 1 个，
   * 再对这一个量几何。也正因为有了几何这一关，偏移用的闭区间才变得无害——
   * 改成开区间反倒会让 `a`、`I` 这种单字母词永远点不中。
   *
   * 一次把卡片 id 和那个词的矩形一起给出来。分两次查会查到**另一处**同词高亮上去——
   * 同一个词一页里出现好几次是常态，那样卡片会弹在别的段落旁边。
   */
  hitAt(x: number, y: number): { entryId: string; rect: DOMRect } | null {
    const caret = caretAt(x, y)
    if (!caret) return null
    for (const { range, entryId } of this.painted) {
      if (
        range.startContainer !== caret.node ||
        caret.offset < range.startOffset ||
        caret.offset > range.endOffset
      ) {
        continue
      }
      /*
       * 偏移对上了还不算数，得这个点真的压在色块上。
       *
       * 落空了接着看下一处，不在这里返回 null：眼下同一个文本节点里的几处高亮
       * 偏移窗口两两不相交（词之间至少隔一个非词字符），所以走不到第二次判断，
       * 但那是扫描那一层的性质，不该由这里替它担保。
       */
      const rect = hitRectOf(range, x, y)
      if (rect) return { entryId, rect }
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
 * 命中判定的余量，单位是 CSS 像素。
 *
 * 为什么不是 0：指针坐标和矩形不在同一个刻度上。页面缩放和高 DPI 下 `clientX/Y`
 * 是带小数的，而矩形的边界本来就带小数（一行文字的高度很少是整数）。边上一两个
 * 物理像素的取整差，落到读者眼里就是「明明点在字上却没反应」——而没反应是这个
 * 功能最贵的一种错，它没有任何反馈，读者只会以为这个词没被标上。
 *
 * 为什么不更大：余量正是这个 bug 的原材料。原来那片误命中区有一千多像素宽，
 * 2px 是「够抵消取整误差」和「肉眼分不出来」的交集。
 *
 * 不必为行距和字缝额外放宽：`getClientRects()` 给的是**行盒**，不是字形的墨迹，
 * 行距上下那点留白本来就在矩形里，而那也正是 `::highlight()` 涂到色的地方。
 * 于是判定和视觉共用同一个矩形——有颜色的地方点得中，没颜色的地方点不中。
 */
const HIT_SLACK = 2

/** 点在不在这个矩形里。余量的账见 {@link HIT_SLACK}。 */
function within(rect: DOMRect, x: number, y: number): boolean {
  return (
    x >= rect.left - HIT_SLACK &&
    x <= rect.right + HIT_SLACK &&
    y >= rect.top - HIT_SLACK &&
    y <= rect.bottom + HIT_SLACK
  )
}

/**
 * 这个点压在这处高亮上吗？压着就返回它踩中的那一块，没压着返回 null。
 *
 * 用 `getClientRects()` 而不是 `getBoundingClientRect()`：一个词折了行会画成两块，
 * 而这两块的外接矩形会把两行之间那一整条——左边那行行尾之后的空白、右边那行行首
 * 之前的空白——全圈进来，等于把要修的这个 bug 又请回来一次。逐块判断才对得上
 * 眼睛看见的色块。
 *
 * 返回踩中的那一块，而不是外接矩形，有两处好处：卡片贴着**被点的那一行**弹出来；
 * 上面那层的 hover 缓存也因此变准——缓存的框就是刚判定通过的那个框，指针不出这块
 * 就一定还在命中区里，不必每帧再问一次浏览器。
 *
 * 量不到就放行。这和 {@link rectOf} 是同一套哲学：Range 的矩形在几种情况下是空的，
 * 或者环境根本没实现这个方法（jsdom 就没有）。这时候宁可退回只看偏移的老行为，
 * 也不要把一个明明画在页面上的词变成点不开的。
 */
function hitRectOf(range: Range, x: number, y: number): DOMRect | null {
  const rects = range.getClientRects?.()
  if (!rects || rects.length === 0) return rectOf(range, x, y)

  // 按下标取，不用 for...of：DOMRectList 的可迭代性依赖 lib 配置，而这里只需要长度和下标。
  let measured = false
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i]
    // 零尺寸的块画不出颜色，也就包不住任何点；更要紧的是别让它冒充「量到了」。
    if (!rect || rect.width <= 0 || rect.height <= 0) continue
    measured = true
    if (within(rect, x, y)) return rect
  }
  return measured ? null : rectOf(range, x, y)
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
