import { describe, expect, it } from 'vitest'
import { decideSelectionAction, type SelectionDecisionInput } from './selectionTrigger.ts'

const base: SelectionDecisionInput = {
  fromOwnUi: false,
  hasSelection: true,
  altKey: false,
  triggerMode: 'button',
  uiVisible: false,
  sameSelectionAsVisible: false,
}

describe('decideSelectionAction', () => {
  // The regression this whole module exists for: clicking our own trigger pill
  // clears the page selection, and the follow-up mouseup used to be read as
  // "user deselected" — which dismissed the card that had just opened.
  it('never acts on events that came from our own UI', () => {
    expect(
      decideSelectionAction({ ...base, fromOwnUi: true, hasSelection: false, uiVisible: true }),
    ).toBe('ignore')
  })

  it('shows the trigger pill for a normal selection', () => {
    expect(decideSelectionAction(base)).toBe('showTrigger')
  })

  it('explains immediately in auto mode, or when Alt is held', () => {
    expect(decideSelectionAction({ ...base, triggerMode: 'auto' })).toBe('explain')
    expect(decideSelectionAction({ ...base, altKey: true })).toBe('explain')
  })

  it('stays silent in hotkey mode unless Alt is held', () => {
    expect(decideSelectionAction({ ...base, triggerMode: 'hotkey' })).toBe('ignore')
    expect(decideSelectionAction({ ...base, triggerMode: 'hotkey', altKey: true })).toBe('explain')
  })

  // The card must survive the click that opened it: that click's mouseup often
  // lands on the page, because the pill it hit was replaced by a taller card.
  it('leaves a visible card alone while the selection is unchanged', () => {
    expect(
      decideSelectionAction({ ...base, uiVisible: true, sameSelectionAsVisible: true }),
    ).toBe('ignore')
    // …including in auto mode, which would otherwise re-issue the request.
    expect(
      decideSelectionAction({
        ...base,
        uiVisible: true,
        sameSelectionAsVisible: true,
        triggerMode: 'auto',
      }),
    ).toBe('ignore')
  })

  it('still reacts when the user selects a different word', () => {
    expect(
      decideSelectionAction({ ...base, uiVisible: true, sameSelectionAsVisible: false }),
    ).toBe('showTrigger')
  })

  it('dismisses a visible card when the selection is gone', () => {
    expect(decideSelectionAction({ ...base, hasSelection: false, uiVisible: true })).toBe('dismiss')
  })

  it('does nothing when there is no selection and nothing on screen', () => {
    expect(decideSelectionAction({ ...base, hasSelection: false, uiVisible: false })).toBe('ignore')
  })
})
