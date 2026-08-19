import type { TriggerMode } from '@/types/settings.ts'

/**
 * What a mouseup should do, as a pure decision.
 *
 * This exists because the bug it now guards against was invisible: the
 * "did this event come from our own UI?" check used `event.composedPath()`
 * inside a debounced callback. `composedPath()` returns an EMPTY ARRAY once the
 * event has finished dispatching, so the check silently always said "not ours".
 * Clicking the trigger pill then cleared the page selection, and 140ms later the
 * debounced handler read an empty selection and dismissed the card that had just
 * opened — the card appeared to flash and vanish.
 *
 * Ownership must therefore be resolved synchronously, in the listener, and
 * passed in here as a plain boolean. Keeping the rest of the rules in a pure
 * function means they can be tested without a DOM.
 */
export type SelectionAction = 'ignore' | 'dismiss' | 'showTrigger' | 'explain'

export interface SelectionDecisionInput {
  /** Resolved synchronously via `composedPath()` while the event dispatches. */
  fromOwnUi: boolean
  /** Whether a usable selection survived (null snapshot -> false). */
  hasSelection: boolean
  /** Alt was held during the gesture — the power-user shortcut. */
  altKey: boolean
  triggerMode: TriggerMode
  /** True when a pill or card is currently on screen. */
  uiVisible: boolean
  /**
   * The selection we just read is the same one the visible UI is already about.
   *
   * This is what keeps a card alive while the model is still thinking: clicking
   * the trigger pill replaces it with a card, so the click's own mouseup often
   * lands on the page rather than on us — and without this check, that stray
   * mouseup demotes a loading card back to a pill, which looks exactly like the
   * card vanishing.
   */
  sameSelectionAsVisible: boolean
}

export function decideSelectionAction(input: SelectionDecisionInput): SelectionAction {
  // Clicks inside our own card must never be interpreted as page gestures,
  // otherwise interacting with the card destroys the card.
  if (input.fromOwnUi) return 'ignore'

  if (!input.hasSelection) {
    // Losing the selection means the user moved on; a card left behind would be
    // describing text that is no longer highlighted.
    return input.uiVisible ? 'dismiss' : 'ignore'
  }

  // Nothing about the user's intent changed, so nothing on screen should.
  if (input.uiVisible && input.sameSelectionAsVisible) return 'ignore'

  if (input.triggerMode === 'hotkey' && !input.altKey) return 'ignore'
  if (input.triggerMode === 'auto' || input.altKey) return 'explain'
  return 'showTrigger'
}
