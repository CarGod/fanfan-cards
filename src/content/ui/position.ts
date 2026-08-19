import { clamp } from '@/shared/utils.ts'

export interface AnchorBox {
  top: number
  bottom: number
  left: number
  right: number
}

export interface Size {
  width: number
  height: number
}

export interface Placement {
  top: number
  left: number
  side: 'below' | 'above'
  /**
   * How tall the card is allowed to be here.
   *
   * A fixed cap wastes a 1200px-tall window: with the selection near the top of
   * the article there is room for the whole explanation without scrolling, and
   * with it near the middle there is not. Let the space decide.
   */
  maxHeight: number
}

const MARGIN = 8

/** Below this the card is cramped enough that flipping sides is better. */
const MIN_CARD_HEIGHT = 260
/**
 * A card at least this tall shows the meaning, the contextual reading and the
 * sentence without scrolling. When the chosen side cannot offer that much, we
 * take it anyway and let the card overlap the line — the reader can drag it,
 * and a 280px sliver of a card helps nobody.
 */
const COMFORTABLE_HEIGHT = 460
/** Above this a card stops feeling like a popover and starts feeling like a page. */
const MAX_CARD_HEIGHT = 720

/**
 * Places a floating element against a selection, in viewport coordinates.
 *
 * Rules, in priority order:
 * 1. Below the selection, so the popup never covers the text being read.
 * 2. Flip above when there is not enough room below.
 * 3. Always stay fully on screen — a card clipped by the viewport edge is the
 *    single most common bug in this class of extension.
 *
 * Pure function so the placement logic is unit-testable without a DOM.
 */
export function placePanel(
  anchor: AnchorBox,
  size: Size,
  viewport: Size,
  // Tight enough to read as attached to the selection. A larger gap makes the
  // card look like it belongs to whatever is underneath it instead.
  gap = 6,
): Placement {
  const spaceBelow = viewport.height - anchor.bottom
  const spaceAbove = anchor.top
  const side: Placement['side'] =
    spaceBelow >= size.height + gap + MARGIN || spaceBelow >= spaceAbove ? 'below' : 'above'

  const room = (side === 'below' ? spaceBelow : spaceAbove) - gap - MARGIN
  const usable = Math.max(room, Math.min(COMFORTABLE_HEIGHT, viewport.height - MARGIN * 2))
  const maxHeight = clamp(usable, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)

  const rawTop = side === 'below' ? anchor.bottom + gap : anchor.top - size.height - gap
  const top = clamp(rawTop, MARGIN, Math.max(MARGIN, viewport.height - size.height - MARGIN))

  // Centre on the selection, then pull back inside the viewport.
  const rawLeft = anchor.left + (anchor.right - anchor.left) / 2 - size.width / 2
  const left = clamp(rawLeft, MARGIN, Math.max(MARGIN, viewport.width - size.width - MARGIN))

  return { top, left, side, maxHeight }
}
