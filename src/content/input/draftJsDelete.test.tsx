// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type {
  EditorState as DraftEditorState,
  SelectionState as DraftSelectionState,
} from 'draft-js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TripleSpaceInputTranslator, type InputTranslationResult } from './tripleSpaceTranslator.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(navigator, 'userAgent', {
  configurable: true,
  value: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
})
const { ContentState, Editor, EditorState, SelectionState } = await import('draft-js')

let container: HTMLDivElement
let root: Root
let controller: TripleSpaceInputTranslator
let resolveTranslation: (result: InputTranslationResult) => void
let latestModelText = ''

function stateAtEnd(text: string): DraftEditorState {
  const content = ContentState.createFromText(text)
  const block = content.getFirstBlock()
  const selection = SelectionState.createEmpty(block.getKey()).merge({
    anchorOffset: block.getLength(),
    focusOffset: block.getLength(),
    hasFocus: true,
  }) as DraftSelectionState
  return EditorState.forceSelection(EditorState.createWithContent(content), selection)
}

/** Real Draft.js 0.11.7 with the same editor DOM markers used by x.com. */
function XComposerHarness() {
  const [editorState, setEditorState] = useState(() => stateAtEnd('Draft  '))
  latestModelText = editorState.getCurrentContent().getPlainText('\n')
  return (
    <Editor
      editorKey="x-composer"
      editorState={editorState}
      onChange={(next) => {
        latestModelText = next.getCurrentContent().getPlainText('\n')
        setEditorState(next)
      }}
      preserveSelectionOnBlur
      spellCheck
      stripPastedStyles
      webDriverTestID="tweetTextarea_0"
    />
  )
}

beforeEach(async () => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  latestModelText = ''
  controller = new TripleSpaceInputTranslator({
    translate: () =>
      new Promise<InputTranslationResult>((resolve) => {
        resolveTranslation = resolve
      }),
  })
  controller.start(document)
  await act(async () => {
    root.render(<XComposerHarness />)
    await Promise.resolve()
  })
})

afterEach(() => {
  controller.stop()
  act(() => root.unmount())
  container.remove()
})

function editor(): HTMLElement {
  return container.querySelector<HTMLElement>(
    'div.notranslate.public-DraftEditor-content[contenteditable="true"]' +
      '[data-testid="tweetTextarea_0"][role="textbox"]',
  )!
}

function pressSpace(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

function nativeKey(target: HTMLElement, key: 'Backspace' | 'Delete'): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperties(event, {
    keyCode: { value: key === 'Backspace' ? 8 : 46 },
    which: { value: key === 'Backspace' ? 8 : 46 },
  })
  target.dispatchEvent(event)
  return event
}

function putCaretAtStart(target: HTMLElement): void {
  const first = target.querySelector<HTMLElement>('[data-text="true"]')?.firstChild
  expect(first?.nodeType).toBe(Node.TEXT_NODE)
  const range = document.createRange()
  range.setStart(first!, 0)
  range.collapse(true)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  target.dispatchEvent(new Event('select', { bubbles: true }))
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}

function putCaretAtEnd(target: HTMLElement): void {
  const leaves = target.querySelectorAll<HTMLElement>('[data-text="true"]')
  const last = leaves.item(leaves.length - 1).firstChild
  expect(last?.nodeType).toBe(Node.TEXT_NODE)
  const range = document.createRange()
  range.setStart(last!, last!.textContent?.length ?? 0)
  range.collapse(true)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  target.dispatchEvent(new Event('select', { bubbles: true }))
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}

function expectSingleDraftText(target: HTMLElement, expected: string): void {
  const leafText = Array.from(target.querySelectorAll<HTMLElement>('[data-text="true"]'))
    .map((node) => node.textContent ?? '')
    .join('\n')
  expect(latestModelText).toBe(expected)
  expect(target.textContent).toBe(expected)
  expect(leafText).toBe(expected)
}

describe('x.com Draft.js composer', () => {
  it('commits translation to EditorState, then Backspace/Delete never create ghost text', async () => {
    const target = editor()
    expect(target.closest('.DraftEditor-editorContainer')).not.toBeNull()
    expect(target.closest('.DraftEditor-root')).not.toBeNull()
    target.focus()
    putCaretAtEnd(target)

    await act(async () => {
      pressSpace(target)
      pressSpace(target)
      const third = pressSpace(target)
      expect(third.defaultPrevented).toBe(true)
      await Promise.resolve()
    })
    expectSingleDraftText(target, 'Draft')

    await act(async () => {
      resolveTranslation({ translation: 'Translated', targetLanguage: 'en' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expectSingleDraftText(target, 'Translated')
    expect(document.activeElement).toBe(target)

    for (const expected of ['Translate', 'Translat', 'Transla']) {
      await act(async () => {
        const deletion = nativeKey(target, 'Backspace')
        expect(deletion.defaultPrevented).toBe(true)
        await Promise.resolve()
      })
      expectSingleDraftText(target, expected)
    }

    await act(async () => {
      putCaretAtStart(target)
      await Promise.resolve()
      const deletion = nativeKey(target, 'Delete')
      expect(deletion.defaultPrevented).toBe(true)
      await Promise.resolve()
    })
    expectSingleDraftText(target, 'ransla')
  })

  it('atomically undoes a paste when Draft did not accept the full selection', async () => {
    const target = editor()
    target.focus()
    putCaretAtEnd(target)
    // Block Draft's DOM-selection bridge so its internal selection stays at
    // the end. The first paste therefore appends instead of replacing; the
    // controller must undo that EditorState transaction without ghost DOM.
    const blockSelection = (event: Event) => event.stopImmediatePropagation()
    document.addEventListener('selectionchange', blockSelection, true)
    target.addEventListener('select', blockSelection, true)
    target.addEventListener('keyup', blockSelection, true)

    await act(async () => {
      pressSpace(target)
      pressSpace(target)
      pressSpace(target)
      await Promise.resolve()
      resolveTranslation({ translation: 'Translated', targetLanguage: 'en' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expectSingleDraftText(target, 'Draft')
    document.removeEventListener('selectionchange', blockSelection, true)
    target.removeEventListener('select', blockSelection, true)
    target.removeEventListener('keyup', blockSelection, true)
  })

  it('keeps Draft unchanged and does not steal focus after the user switches controls', async () => {
    const target = editor()
    const button = document.createElement('button')
    document.body.append(button)
    target.focus()
    putCaretAtEnd(target)

    await act(async () => {
      pressSpace(target)
      pressSpace(target)
      pressSpace(target)
      await Promise.resolve()
    })
    await act(async () => {
      button.focus()
      await Promise.resolve()
    })

    await act(async () => {
      resolveTranslation({ translation: 'Translated', targetLanguage: 'en' })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expectSingleDraftText(target, 'Draft')
    expect(document.activeElement).toBe(button)
    button.remove()
  })
})
