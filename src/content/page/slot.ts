import { isRedundantTranslation, repairOmissions } from '@/shared/language.ts'
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

/** Returns false when the translation was rejected and the slot removed. */
export function fillSlot(element: Element, source: string, translation: string): boolean {
  const slot = slotFor(element)
  if (!slot) return false

  // Last line of defence against the failure that makes a page look
  // vandalised: a "translation" that says exactly what the original said.
  if (!translation.trim() || isRedundantTranslation(source, translation)) {
    clearSlot(element)
    return false
  }
  slot.classList.remove(PENDING_CLASS)
  slot.textContent = repairOmissions(source, translation)
  element.setAttribute(TRANSLATED_MARK, 'done')
  return true
}

/** Links and buttons must not get a block translation shoved under them. */
export function isInlineLike(element: Element): boolean {
  if (['A', 'BUTTON', 'LABEL', 'SPAN', 'TD', 'TH', 'LI'].includes(element.tagName)) {
    return element.tagName !== 'LI'
  }
  const display = getComputedStyle(element).display
  return display.startsWith('inline')
}
