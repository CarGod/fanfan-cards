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
export function directText(element: Element): string {
  let text = ''
  for (const node of element.childNodes) {
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

export interface TranslationUnit {
  element: Element
  text: string
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

    if (text.length >= minLength && HAS_LETTER.test(text) && shouldTranslateText(text, target)) {
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
  const minLength = options.minLength ?? 12
  const target_ = options.targetLanguage ?? 'zh-CN'

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
    const inline = INLINE_TAGS.has(element.tagName)

    if (!inline) {
      const text = directText(element)
      if (text.length >= minLength && HAS_LETTER.test(text) && shouldTranslateText(text, target_)) {
        return { element, text }
      }
    }
    element = element.parentElement
  }
  return null
}
