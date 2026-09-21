import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { shouldTranslateText } from '@/shared/language.ts'

/**
 * Finds the blocks of text on a page that are worth translating.
 *
 * The design follows read-frog's pipeline where it earned its complexity and
 * deliberately stops short of it everywhere else. What we take:
 *
 * - The unit of translation is "an element that directly contains text", not
 *   "an element" — that is what decouples semantic paragraphs from DOM shape.
 * - A tag deny-list, because `<pre>`, `<code>`, icon fonts and MathML are not
 *   prose and translating them corrupts the page.
 * - A giant-unit guard: a flat `<article>` that directly holds an entire page of
 *   text must be descended into, or viewport-gated lazy translation collapses
 *   into "translate everything at once" (their #1881).
 *
 * What we skip: site-specific rule sets, attribute protection, in-place text
 * swapping, ruby/MathML handling, drop-cap patches. Those exist to *replace*
 * page text; we only ever append a translation next to it, so none of them
 * apply.
 *
 * Layout access is injected so the selection logic can be tested without a
 * rendering engine.
 */

/** Never walked into, and their text never counts as content. */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'IMG',
  'SVG',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'IFRAME',
  'EMBED',
  'OBJECT',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'PRE',
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'MATH',
  'RT',
  'RP',
  'TEMPLATE',
])

/** Inline tags never form a unit on their own; their text belongs to the parent. */
const INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'BR',
  'CITE',
  'DATA',
  'DEL',
  'DFN',
  'EM',
  'I',
  'INS',
  'MARK',
  'Q',
  'RUBY',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'WBR',
])

/**
 * Text containers whose semantics are stronger than the generic length guard.
 *
 * A short label in an arbitrary `<div>` is usually interface chrome, while a
 * short `<p>`, heading or caption is still prose. Keeping that distinction lets
 * the paragraph gesture translate useful snippets without making every button
 * and menu item under the pointer eligible.
 */
const SEMANTIC_TEXT_TAGS = new Set([
  'P',
  'BLOCKQUOTE',
  'LI',
  'DT',
  'DD',
  'FIGCAPTION',
  'CAPTION',
  'SUMMARY',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
])
const SEMANTIC_TEXT_ROLES = new Set(['paragraph', 'heading', 'blockquote', 'listitem'])

/**
 * High-confidence application containers, checked before the generic walk.
 *
 * This list is intentionally tiny. x.com renders tweet prose as an inline-
 * styled `<div>`, so neither HTML tag semantics nor computed layout identify
 * its boundary. The structural walk below remains the fallback for every site.
 */
const PRIORITY_TEXT_BLOCK_SELECTOR = '[data-testid="tweetText"]'

/**
 * Chrome that is not the article.
 *
 * Following read-frog: these are ignored only in "content" range, and only when
 * they are not inside an `<article>` or `<main>` — sites do put real content in
 * a `<header>` inside an article, and skipping that would lose the headline.
 */
const CHROME_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE'])
const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'search', 'toolbar'])

/** Screen-reader-only text is invisible; a translation under it would be too. */
const HIDDEN_CLASSES = ['sr-only', 'visually-hidden', 'screen-reader-text']

/**
 * Ligature icon fonts store glyph names like `keyboard_return` in text nodes.
 * Translating one turns an icon into mojibake — read-frog's lesson, and it
 * costs one font-family check to avoid.
 */
const ICON_FONTS = /material icons|material symbols|font awesome|fontawesome|google symbols/i

export const TRANSLATION_CLASS = 'ara-translation'
/**
 * A reversible wrapper around one visual paragraph inside a larger DOM element.
 *
 * Some CMSes publish an entire article section as one `<p>`, using `<br><br>`
 * where they mean a paragraph boundary. The wrapper gives each of those visual
 * paragraphs its own source element, so its translation can sit beside it and
 * keep independent pending/done state. It renders as `display: contents` and is
 * unwrapped when page translation is turned off.
 */
export const SEGMENT_SOURCE_CLASS = 'ara-translation-source'
export const TRANSLATED_MARK = 'data-ara-translated'

export type TranslationRange = 'content' | 'all'

export interface WalkOptions {
  /** `content` skips nav/header/footer chrome outside the article. */
  range?: TranslationRange
  /** Language the reader wants; drives "is this already in my language". */
  targetLanguage?: string
  /** Injected for testability. */
  fontFamilyOf?: (element: Element) => string
  /** True when the element is not rendered. Injected for testability. */
  isHidden?: (element: Element) => boolean
  /** Element height in px; used only by the giant-unit guard. */
  heightOf?: (element: Element) => number
  /** Viewport height, for the same guard. */
  viewportHeight?: number
  /** Shortest text worth sending to a model. */
  minLength?: number
}

const HAS_LETTER = /\p{L}/u

function defaultIsHidden(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true
  const style = getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

/**
 * Respecting `translate="no"` and `.notranslate` is a deliberate difference
 * from read-frog, which ignores the attribute. We also stamp our own output
 * with them, so this is what stops us from translating our own translations.
 */
function isOptedOut(element: Element): boolean {
  return (
    element.getAttribute('translate') === 'no' ||
    element.classList.contains('notranslate') ||
    element.classList.contains(TRANSLATION_CLASS) ||
    element.id === CONTENT_HOST_ID
  )
}

function isInsideContentContainer(element: Element): boolean {
  return element.closest('article, main, [role="main"]') !== null
}

function hasHiddenClass(element: Element): boolean {
  return HIDDEN_CLASSES.some((name) => element.classList.contains(name))
}

/*
 * "Already translated" is state, not policy.
 *
 * It used to live in `isOptedOut` alongside `translate="no"` and our own output,
 * which conflated two different things: one says *never touch this*, the other
 * says *this has been handled*. Collection wants both. A caller looking for the
 * element in order to manage an existing translation — take it off again,
 * replace it with a longer one — must be able to find it, and could not: the
 * 「再按一次收起」 gesture never worked from the day it shipped, because the
 * lookup refused to return an element it had already translated.
 */
interface SkipContext {
  isHidden: (element: Element) => boolean
  fontFamilyOf: (element: Element) => string
  range: TranslationRange
  /** True for lookups that need to find already-translated elements. */
  allowTranslated?: boolean
}

/** Ordered cheapest-first; the style read is last because it forces layout. */
function isSkippable(element: Element, context: SkipContext): boolean {
  if (SKIP_TAGS.has(element.tagName) || isOptedOut(element)) return true
  if (!context.allowTranslated && element.hasAttribute(TRANSLATED_MARK)) return true
  if (hasHiddenClass(element)) return true

  if (context.range === 'content') {
    const isChrome =
      CHROME_TAGS.has(element.tagName) ||
      CHROME_ROLES.has(element.getAttribute('role') ?? '')
    if (isChrome && !isInsideContentContainer(element)) return true
  }

  if (context.isHidden(element)) return true
  return ICON_FONTS.test(context.fontFamilyOf(element))
}

/**
 * Text an element holds itself, folding in inline children.
 *
 * Inline children get the same exclusions as block ones: a `sr-only` span or an
 * `aria-hidden` icon inside a paragraph would otherwise be spliced into the
 * source text and translated as if the reader could see it.
 */
function textFromNodes(nodes: Iterable<Node>): string {
  let text = ''
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Newlines in the source are just whitespace in HTML; only <br> is a line.
      text += (node.textContent ?? '').replace(/\s+/g, ' ')
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue

    const child = node as Element
    // `<br>` is inline but it is a line, and collapsing it turns a three-line
    // post into one run-on sentence — for the reader and for the model.
    if (child.tagName === 'BR') {
      text += '\n'
      continue
    }
    if (!INLINE_TAGS.has(child.tagName)) continue
    if (SKIP_TAGS.has(child.tagName) || isOptedOut(child) || hasHiddenClass(child)) continue
    if (child.getAttribute('aria-hidden') === 'true') continue
    text += (child.textContent ?? '').replace(/\s+/g, ' ')
  }

  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function directText(element: Element): string {
  return textFromNodes(element.childNodes)
}

interface PendingVisualSegment {
  /** The original nodes that will be wrapped, in document order. */
  nodes: ChildNode[]
  /** The first `<br>` in the separating blank line, or null for the last part. */
  insertBefore: ChildNode | null
}

export interface TranslationUnit {
  element: Element
  text: string
  /** Present only until a `<br><br>` visual paragraph has been materialised. */
  pendingVisualSegment?: PendingVisualSegment
}

const isIgnorableBetweenBreaks = (node: ChildNode): boolean =>
  node.nodeType === Node.COMMENT_NODE ||
  (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim())

const isTranslationNode = (node: ChildNode): boolean =>
  node.nodeType === Node.ELEMENT_NODE &&
  (node as Element).classList.contains(TRANSLATION_CLASS)

/**
 * Splits only on a *blank line* (`<br><br>`), never on a single `<br>`.
 *
 * A single break is meaningful line structure in addresses, poems and social
 * posts, and continues to be sent as `\n` inside one unit. Comments and
 * whitespace between two breaks do not make the blank line disappear — React
 * and template engines commonly leave exactly those nodes in rendered markup.
 */
function visualParagraphs(element: Element): PendingVisualSegment[] | null {
  const children = [...element.childNodes]
  const segments: PendingVisualSegment[] = []
  let start = 0
  let index = 0

  while (index < children.length) {
    if (!(children[index] instanceof HTMLBRElement)) {
      index += 1
      continue
    }

    let cursor = index + 1
    let breaks = 1
    while (cursor < children.length) {
      const node = children[cursor]!
      if (node instanceof HTMLBRElement) {
        breaks += 1
        cursor += 1
        continue
      }
      if (isIgnorableBetweenBreaks(node)) {
        cursor += 1
        continue
      }
      break
    }

    if (breaks < 2) {
      index += 1
      continue
    }

    segments.push({
      nodes: children.slice(start, index).filter((node) => !isTranslationNode(node)),
      insertBefore: children[index] ?? null,
    })
    start = cursor
    index = cursor
  }

  if (segments.length === 0) return null
  segments.push({
    nodes: children.slice(start).filter((node) => !isTranslationNode(node)),
    insertBefore: null,
  })

  // A trailing/leading blank line is formatting, not an empty paragraph. We
  // split only when at least two real text groups survive.
  const nonEmpty = segments.filter((segment) => textFromNodes(segment.nodes).length > 0)
  return nonEmpty.length >= 2 ? nonEmpty : null
}

function existingSegmentSource(nodes: ChildNode[]): Element | null {
  const meaningful = nodes.filter(
    (node) => !isTranslationNode(node) && !isIgnorableBetweenBreaks(node),
  )
  if (meaningful.length !== 1) return null
  const [only] = meaningful
  return only instanceof Element && only.classList.contains(SEGMENT_SOURCE_CLASS) ? only : null
}

/**
 * Gives a virtual `<br><br>` paragraph a real, reversible source element.
 *
 * Collection stays read-only. Materialisation happens immediately before the
 * unit is queued, and moves (rather than clones) the site's nodes so links,
 * listeners and live form state survive. Ordinary paragraphs pass through.
 */
export function materializeTranslationUnit(unit: TranslationUnit): TranslationUnit {
  const pending = unit.pendingVisualSegment
  if (!pending) return unit

  const host = unit.element
  const connectedNodes = pending.nodes.filter((node) => node.parentNode === host)
  if (connectedNodes.length === 0) return unit

  const reusable = connectedNodes.find(
    (node): node is Element =>
      node instanceof Element && node.classList.contains(SEGMENT_SOURCE_CLASS),
  )
  const wrapper = reusable ?? document.createElement('span')
  wrapper.classList.add(SEGMENT_SOURCE_CLASS)

  if (!reusable) host.insertBefore(wrapper, connectedNodes[0] ?? pending.insertBefore)

  /*
   * Reconciliation matters when a framework appends text beside an already
   * wrapped segment. Flatten the old wrapper and the new sibling nodes into the
   * same wrapper, retaining every original Node object and its event listeners.
   */
  const content = document.createDocumentFragment()
  for (const node of connectedNodes) {
    if (node === wrapper) {
      content.append(...wrapper.childNodes)
    } else if (!isTranslationNode(node)) {
      content.append(node)
    }
  }
  wrapper.replaceChildren(content)

  return { element: wrapper, text: directText(wrapper) }
}

/**
 * Collects units in document order.
 *
 * An element becomes a unit when its own text (including inline descendants) is
 * substantial; block children are then visited separately, so a `<div>` holding
 * both a sentence and three paragraphs yields four units rather than one blob.
 */
export function collectUnits(root: Element, options: WalkOptions = {}): TranslationUnit[] {
  const context: SkipContext = {
    isHidden: options.isHidden ?? defaultIsHidden,
    fontFamilyOf:
      options.fontFamilyOf ??
      ((element: Element) => (element instanceof HTMLElement ? getComputedStyle(element).fontFamily : '')),
    range: options.range ?? 'content',
  }
  const heightOf = options.heightOf ?? ((el: Element) => el.getBoundingClientRect().height)
  const viewportHeight = options.viewportHeight ?? (typeof window === 'undefined' ? 800 : window.innerHeight)
  const minLength = options.minLength ?? 2
  const target = options.targetLanguage ?? 'zh-CN'
  const giantHeight = Math.max(viewportHeight, 800) * 3

  const units: TranslationUnit[] = []

  const visit = (element: Element, depth: number) => {
    if (depth > 40 || isSkippable(element, context)) return

    const text = directText(element)
    const blockChildren = [...element.children].filter(
      (child) => !INLINE_TAGS.has(child.tagName) && !isSkippable(child, context),
    )

    const segments = visualParagraphs(element)
    if (segments) {
      for (const segment of segments) {
        const source = existingSegmentSource(segment.nodes)
        if (source && isSkippable(source, context)) continue
        const segmentText = source ? directText(source) : textFromNodes(segment.nodes)
        if (
          segmentText.length >= minLength &&
          HAS_LETTER.test(segmentText) &&
          shouldTranslateText(segmentText, target)
        ) {
          units.push(
            source
              ? { element: source, text: segmentText }
              : { element, text: segmentText, pendingVisualSegment: segment },
          )
        }
      }
    } else if (text.length >= minLength && HAS_LETTER.test(text) && shouldTranslateText(text, target)) {
      // A single element holding a whole page of text defeats viewport gating,
      // so descend instead of translating it as one giant unit.
      const tooTall = blockChildren.length > 0 && heightOf(element) > giantHeight
      if (!tooTall) units.push({ element, text })
    }

    for (const child of blockChildren) visit(child, depth + 1)
  }

  visit(root, 0)
  return units
}

/** Batches units into requests, bounded by both count and characters. */
export function batchUnits(
  units: TranslationUnit[],
  limits: { maxUnits?: number; maxChars?: number } = {},
): TranslationUnit[][] {
  const maxUnits = limits.maxUnits ?? 10
  const maxChars = limits.maxChars ?? 2200

  const batches: TranslationUnit[][] = []
  let current: TranslationUnit[] = []
  let chars = 0

  for (const unit of units) {
    // A single oversized paragraph still gets its own request rather than being
    // dropped or silently truncated.
    if (current.length > 0 && (current.length >= maxUnits || chars + unit.text.length > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(unit)
    chars += unit.text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * The translation unit under a point on the page.
 *
 * Hover gives you the deepest element under the cursor — often a bare `<span>`
 * or the text node's parent — which is rarely the thing a reader means by "this
 * paragraph". So walk up until the element carries enough of its own text to be
 * worth translating, using exactly the rules `collectUnits` uses, and stop at
 * the first ancestor that qualifies rather than the largest.
 *
 * Returns null inside code, inputs, our own injected translations, and anything
 * whose text is already in the target language.
 */
export function findUnitAt(
  target: Element | null,
  options: WalkOptions = {},
): TranslationUnit | null {
  const context: SkipContext = {
    isHidden: options.isHidden ?? defaultIsHidden,
    fontFamilyOf:
      options.fontFamilyOf ??
      ((element: Element) =>
        element instanceof HTMLElement ? getComputedStyle(element).fontFamily : ''),
    range: options.range ?? 'all',
    allowTranslated: true,
  }
  // Explicit prose containers can be brief; arbitrary structural containers
  // keep the higher floor that suppresses navigation and control labels.
  const semanticMinLength = options.minLength ?? 3
  const fallbackMinLength = options.minLength ?? 12
  const target_ = options.targetLanguage ?? 'zh-CN'

  const unitFrom = (element: Element, minLength: number): TranslationUnit | null => {
    const text = directText(element)
    return text.length >= minLength && HAS_LETTER.test(text) && shouldTranslateText(text, target_)
      ? { element, text }
      : null
  }

  const pathIsEligible = (from: Element, through: Element): boolean => {
    let cursor: Element | null = from
    while (cursor) {
      if (cursor === document.body || cursor === document.documentElement) return false
      if (isSkippable(cursor, context)) return false
      if (cursor === through) return true
      cursor = cursor.parentElement
    }
    return false
  }

  /*
   * x.com's stable semantic boundary wins even if a descendant happens to look
   * like a standalone block. Resolve it at keypress time, rather than caching a
   * node, so React's virtualised timeline can replace or recycle tweets freely.
   */
  const priority = target?.closest(PRIORITY_TEXT_BLOCK_SELECTOR) ?? null
  if (target && priority && pathIsEligible(target, priority)) {
    const unit = unitFrom(priority, semanticMinLength)
    if (unit) return unit
  }

  let element: Element | null = target
  let depth = 0
  while (element && depth++ < 24) {
    if (element === document.body || element === document.documentElement) return null
    // Our own output, and anything already translated, are not candidates.
    if (element.classList?.contains(TRANSLATION_CLASS)) return null
    if (isSkippable(element, context)) return null

    /*
     * 行内元素永远不是一段。
     *
     * 悬停在 "can <em>lock a table</em> for minutes" 的 `<em>` 上，要翻的是整句，
     * 不是那三个词——`collectUnits` 也从来不会产出这样的单元，因为它把行内子节点
     * 折进块级父节点里了。所以一路往上爬，直到那个真正拥有这句话的块。
     *
     * 判据只看**标签**，不看计算样式。这一条是踩出来的：x.com 建在 React Native Web
     * 上，推文正文那个 `<div data-testid="tweetText">` 计算出来是 `display: inline`,
     * 而它是唯一装着正文的元素。多看一眼计算样式，就会从它头上爬过去，一路爬到 body
     * 也找不到东西——于是整页翻译在 x.com 上好好的，悬停整段翻译却毫无反应。
     *
     * 根源是两条路用了两套规则：`directText` 按标签折叠，这里按计算样式判断。
     * 统一成标签之后，「能翻整页却翻不了单段」这类错配就没有生长的地方了。
     */
    const segmentSource = element.classList.contains(SEGMENT_SOURCE_CLASS)
    const inline = INLINE_TAGS.has(element.tagName) && !segmentSource

    if (!inline) {
      const role = element.getAttribute('role') ?? ''
      const semantic = SEMANTIC_TEXT_TAGS.has(element.tagName) || SEMANTIC_TEXT_ROLES.has(role)
      const unit = unitFrom(element, semantic ? semanticMinLength : fallbackMinLength)
      if (unit) return unit
    }
    element = element.parentElement
  }
  return null
}
