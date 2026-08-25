import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { isLookupCandidate } from '@/shared/language.ts'
import { extractContext, type ExtractedContext } from './context.ts'

export interface SelectionSnapshot {
  text: string
  /** Viewport-relative box of the selection, used to place the UI. */
  rect: DOMRect
  context: ExtractedContext
}

/**
 * Reads the current selection, or returns null when it should be ignored.
 *
 * Ignoring is as important as reading: a trigger button that appears while the
 * user is selecting a paragraph to copy, or dragging inside a text field, makes
 * the whole extension feel hostile.
 */
export function readSelection(
  maxLength: number,
  languages: { source: string; target: string },
): SelectionSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const text = selection.toString().trim()
  if (!text || text.length > maxLength) return null
  // A selection has to plausibly be in the language being learned: punctuation,
  // numbers, and text written entirely in the user's own script are not lookups.
  if (!isLookupCandidate(text, languages)) return null

  const range = selection.getRangeAt(0)
  if (isInsideOwnUi(range.commonAncestorContainer)) return null
  if (isEditable(range.commonAncestorContainer)) return null

  const rect = pickRect(range)
  if (!rect || (rect.width === 0 && rect.height === 0)) return null

  return { text, rect, context: extractContext(range, text) }
}

/**
 * A multi-line selection produces several client rects; anchoring to the last
 * one keeps the popup next to where the user's cursor actually stopped.
 */
function pickRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0)
  const last = rects[rects.length - 1]
  return last ?? range.getBoundingClientRect()
}

function isInsideOwnUi(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element) return false
  if (element.closest?.(`#${CONTENT_HOST_ID}`)) return true
  return element.getRootNode() instanceof ShadowRoot
}

function isEditable(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element) return false
  const editableHost = element.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')
  return editableHost !== null
}

export function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
}
