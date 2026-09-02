// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TripleSpaceInputTranslator, type InputTranslationResult } from './tripleSpaceTranslator.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let controller: TripleSpaceInputTranslator
let resolveTranslation: (result: InputTranslationResult) => void

function ControlledInput({ reactEvents }: { reactEvents: string[] }) {
  const [value, setValue] = useState('Draft')
  return (
    <input
      data-controlled="true"
      value={value}
      onBeforeInput={(event) =>
        reactEvents.push(`beforeinput:${(event.nativeEvent as InputEvent).inputType}`)
      }
      onInput={(event) => reactEvents.push(`input:${(event.nativeEvent as InputEvent).inputType}`)}
      onChange={(event) => {
        reactEvents.push(`change:${event.currentTarget.value}`)
        setValue(event.currentTarget.value)
      }}
    />
  )
}

function RemountingControlledInput() {
  const [value, setValue] = useState('Draft')
  return (
    <input
      key={value === 'Translated' ? 'translated' : 'draft'}
      data-remounting="true"
      value={value}
      onChange={(event) => setValue(event.currentTarget.value)}
    />
  )
}

beforeEach(() => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  controller = new TripleSpaceInputTranslator({
    translate: () =>
      new Promise<InputTranslationResult>((resolve) => {
        resolveTranslation = resolve
      }),
  })
  controller.start(document)
})

afterEach(() => {
  controller.stop()
  act(() => root.unmount())
  container.remove()
})

function nativeSetValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
}

function insertSpace(input: HTMLInputElement): void {
  const keydown = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  input.dispatchEvent(keydown)
  if (keydown.defaultPrevented) return
  const caret = input.selectionStart ?? input.value.length
  nativeSetValue(input, input.value.slice(0, caret) + ' ' + input.value.slice(caret))
  input.setSelectionRange(caret + 1, caret + 1)
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }),
  )
}

function browserDelete(input: HTMLInputElement, key: 'Backspace' | 'Delete'): void {
  const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  input.dispatchEvent(keydown)
  expect(keydown.defaultPrevented).toBe(false)

  const caret = input.selectionStart ?? 0
  const from = key === 'Backspace' ? Math.max(0, caret - 1) : caret
  const to = key === 'Delete' ? Math.min(input.value.length, caret + 1) : caret
  const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward'
  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: null,
  })
  input.dispatchEvent(before)
  if (before.defaultPrevented || from === to) return
  nativeSetValue(input, input.value.slice(0, from) + input.value.slice(to))
  input.setSelectionRange(from, from)
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: null }))
}

describe('controlled React input remains editable after translation', () => {
  it('keeps framework state, focus, caret and native editing protocol in sync', async () => {
    const reactEvents: string[] = []
    await act(async () => {
      root.render(<ControlledInput reactEvents={reactEvents} />)
      await Promise.resolve()
    })
    const input = container.querySelector<HTMLInputElement>('[data-controlled]')!
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)

    const nativeEvents: string[] = []
    input.addEventListener('beforeinput', (event) =>
      nativeEvents.push(`beforeinput:${(event as InputEvent).inputType}`),
    )
    input.addEventListener('input', (event) =>
      nativeEvents.push(`input:${(event as InputEvent).inputType}`),
    )
    input.addEventListener('change', () => nativeEvents.push('change'))

    await act(async () => {
      insertSpace(input)
      insertSpace(input)
      insertSpace(input)
      await Promise.resolve()
    })
    expect(input.value).toBe('Draft')
    nativeEvents.length = 0
    reactEvents.length = 0

    await act(async () => {
      resolveTranslation({ translation: 'Translated', targetLanguage: 'en' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(input.value).toBe('Translated')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(input.value.length)
    expect(input.selectionEnd).toBe(input.value.length)
    expect(nativeEvents).toEqual([
      'beforeinput:insertReplacementText',
      'input:insertReplacementText',
    ])
    // React's onChange is intentionally input-backed. A native change event is
    // not fired until the text control is committed (normally on blur).
    expect(reactEvents).toContain('input:insertReplacementText')
    expect(reactEvents).toContain('change:Translated')
    expect(nativeEvents).not.toContain('change')

    await act(async () => {
      browserDelete(input, 'Backspace')
      await Promise.resolve()
    })
    expect(input.value).toBe('Translate')
    expect(input.selectionStart).toBe(9)

    input.setSelectionRange(0, 0)
    await act(async () => {
      browserDelete(input, 'Delete')
      await Promise.resolve()
    })
    expect(input.value).toBe('ranslate')
    expect(input.selectionStart).toBe(0)
  })

  it('does not focus or mutate a stale node when React remounts the editor', async () => {
    await act(async () => {
      root.render(<RemountingControlledInput />)
      await Promise.resolve()
    })
    const original = container.querySelector<HTMLInputElement>('[data-remounting]')!
    original.focus()
    original.setSelectionRange(original.value.length, original.value.length)

    await act(async () => {
      insertSpace(original)
      insertSpace(original)
      insertSpace(original)
      await Promise.resolve()
    })

    await act(async () => {
      resolveTranslation({ translation: 'Translated', targetLanguage: 'en' })
      await Promise.resolve()
      await Promise.resolve()
    })

    const replacement = container.querySelector<HTMLInputElement>('[data-remounting]')!
    expect(original.isConnected).toBe(false)
    expect(replacement).not.toBe(original)
    expect(replacement.value).toBe('Translated')
    expect(document.activeElement).not.toBe(original)
  })
})
