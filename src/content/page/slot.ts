import { conformLineShape, isRedundantTranslation, repairOmissions } from '@/shared/language.ts'
import { TRANSLATED_MARK, TRANSLATION_CLASS } from './walker.ts'

/**
 * Inserting a translation next to its original.
 *
 * Shared by whole-page and single-paragraph translation, because everything
 * that makes the insertion safe belongs to the insertion, not to the thing that
 * triggered it: never replacing the original, marking our node `notranslate` so
 * other translation extensions leave it alone, restoring the source's line
 * structure, and refusing a "translation" that merely repeats the source.
 *
 * That last guard is why this is one module rather than two: it was written for
 * the x.com incident, where a Chinese UI came back "translated" into the same
 * Chinese and the page looked vandalised. A second copy of the insertion logic
 * would eventually be a copy without that check.
 */

/** Placeholder shown in the translation slot while the request is in flight. */
export const PENDING_CLASS = 'ara-translation-pending'

/** Links a source element to its slot, so the pair survives a reflow. */
const SOURCE_ID = 'data-ara-id'
let nextId = 0

/**
 * The slot is inserted before the translation exists, so the page reflows once
 * instead of twice and the reader sees where the text will land.
 */
export function createSlot(source: Element): HTMLElement {
  const inline = isInlineLike(source)
  const slot = document.createElement(inline ? 'span' : 'div')
  slot.className = `${TRANSLATION_CLASS} ${PENDING_CLASS} notranslate`
  slot.setAttribute('translate', 'no')
  /*
   * An explicit id rather than "the next sibling".
   *
   * Sibling lookup breaks on exactly the sites this feature is for: x.com and
   * other feeds re-render around our node, and once anything is inserted between
   * the paragraph and its slot, the answer can never be delivered — leaving a
   * 「翻译中…」 placeholder sitting there for the rest of the session. An id
   * survives reordering, and a source element that was removed entirely simply
   * finds nothing, which is the correct outcome.
   */
  const id = source.getAttribute(SOURCE_ID) ?? `s${++nextId}`
  source.setAttribute(SOURCE_ID, id)
  slot.dataset['araFor'] = id
  if (inline) slot.dataset['araInline'] = ''
  return slot
}

export function slotFor(element: Element): HTMLElement | null {
  const id = element.getAttribute(SOURCE_ID)
  if (!id) return null
  return document.querySelector<HTMLElement>(
    `.${TRANSLATION_CLASS}[data-ara-for="${CSS.escape(id)}"]`,
  )
}

/**
 * 从译文槽找回它对应的原文。
 *
 * 「仅译文」模式下原文是 display:none 的，鼠标底下只有译文。而整段翻译的
 * 「再按一次收起」是靠悬停原文触发的——藏起来的东西悬停不到，这个手势就没了
 * 撤销，翻完一段就再也退不回去。所以悬停到译文上时，要能顺着 data-ara-for
 * 找回它的主人。
 *
 * 双语模式下这条路同样成立，而且更顺手：鼠标已经在译文上了，不必再挪回原文。
 */
export function sourceForSlot(node: Node | null): Element | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null)
  const slot = element?.closest(`.${TRANSLATION_CLASS}`)
  const id = slot instanceof HTMLElement ? slot.dataset['araFor'] : undefined
  if (!id) return null
  return document.querySelector(`[${SOURCE_ID}="${CSS.escape(id)}"]`)
}

/** Drops our slot and the mark, leaving the page exactly as we found it. */
export function clearSlot(element: Element): void {
  slotFor(element)?.remove()
  element.removeAttribute(TRANSLATED_MARK)
  element.removeAttribute(SOURCE_ID)
}

/**
 * Puts the page back exactly as it was found.
 *
 * Turning translation off has to leave no trace: not just our inserted nodes,
 * but every attribute we wrote onto the site's own elements. `data-ara-id` was
 * being left behind — invisible, but it is still our litter on someone else's
 * DOM, and it would make a later run think it had already numbered that element.
 */
export function clearAllSlots(): void {
  for (const node of document.querySelectorAll(`.${TRANSLATION_CLASS}`)) node.remove()
  for (const element of document.querySelectorAll(`[${TRANSLATED_MARK}], [${SOURCE_ID}]`)) {
    element.removeAttribute(TRANSLATED_MARK)
    element.removeAttribute(SOURCE_ID)
  }
}

/**
 * Removes placeholders whose source element is gone.
 *
 * A feed that recycles nodes can drop a paragraph while its request is still in
 * flight; without this the orphaned 「翻译中…」 stays on screen forever.
 */
export function sweepOrphanSlots(): number {
  let removed = 0
  for (const slot of document.querySelectorAll<HTMLElement>(`.${TRANSLATION_CLASS}`)) {
    const id = slot.dataset['araFor']
    if (!id) continue
    if (document.querySelector(`[${SOURCE_ID}="${CSS.escape(id)}"]`)) continue
    slot.remove()
    removed += 1
  }
  return removed
}

/**
 * 回填的结果。
 *
 * `line-shape-lost` 不是失败：译文已经填进去了，读者现在就能看。它只是在说
 * 「原文是多行、这份译文塌成了一段，你可以逐行重译一次把结构拿回来」。
 * 之所以先填再说，是因为让读者对着「翻译中…」等一次额外的往返，
 * 比先给他一份结构不完美但读得懂的译文更糟。
 */
export type FillResult = 'filled' | 'rejected' | 'line-shape-lost'

export function fillSlot(element: Element, source: string, translation: string): FillResult {
  const slot = slotFor(element)
  if (!slot) return 'rejected'

  // Last line of defence against the failure that makes a page look
  // vandalised: a "translation" that says exactly what the original said.
  if (!translation.trim() || isRedundantTranslation(source, translation)) {
    clearSlot(element)
    return 'rejected'
  }

  /*
   * 结构对齐放在这里，和「不许原样复读」「补回被吞掉的 @用户名」并排。
   *
   * 三件事的道理是同一条：能不能保证，取决于**回来时校验**，而不是请求时说得多清楚。
   * 放在插入这一处，是因为整页翻译和整段翻译都从这里过——放到调用方，
   * 迟早会有第三个调用方忘了做。
   */
  const conformed = conformLineShape(source, translation)

  slot.classList.remove(PENDING_CLASS)
  slot.textContent = repairOmissions(source, conformed ?? translation)
  element.setAttribute(TRANSLATED_MARK, 'done')
  return conformed === null ? 'line-shape-lost' : 'filled'
}

/** Links and buttons must not get a block translation shoved under them. */
export function isInlineLike(element: Element): boolean {
  if (['A', 'BUTTON', 'LABEL', 'SPAN', 'TD', 'TH', 'LI'].includes(element.tagName)) {
    return element.tagName !== 'LI'
  }
  const display = getComputedStyle(element).display
  return display.startsWith('inline')
}
