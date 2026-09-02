// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TripleSpaceInputTranslator,
  type InputTranslationResult,
  type InputTranslationStatus,
} from './tripleSpaceTranslator.ts'

let now = 0
let translate = vi.fn<(text: string) => Promise<InputTranslationResult>>()
let statuses: InputTranslationStatus[]
let controller: TripleSpaceInputTranslator

beforeEach(() => {
  document.body.innerHTML = ''
  now = 0
  translate = vi.fn(async (text) => ({ translation: `译:${text}`, targetLanguage: 'zh-CN' }))
  statuses = []
  controller = new TripleSpaceInputTranslator({
    translate,
    onStatus: (status) => statuses.push(status),
    now: () => now,
  })
  controller.start(document)
})

afterEach(() => controller.stop())

function textInput(type = 'text'): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  document.body.append(input)
  return input
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value
  input.focus()
  input.setSelectionRange(value.length, value.length)
}

/** jsdom dispatches keyboard events but does not perform their default edit. */
function press(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  init: KeyboardEventInit = {},
  advance = 100,
): KeyboardEvent {
  now += advance
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  if (!event.defaultPrevented && event.key === ' ') insertDefaultSpace(target)
  return event
}

function insertDefaultSpace(target: HTMLInputElement | HTMLTextAreaElement | HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart
    const end = target.selectionEnd
    // Number and other non-text controls do not accept Space as text input.
    if (start === null || end === null) return
    target.setRangeText(' ', start, end, 'end')
    target.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' ', inputType: 'insertText' }))
    return
  }

  const selection = document.getSelection()!
  const range = selection.getRangeAt(0)
  const node = document.createTextNode(' ')
  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' ', inputType: 'insertText' }))
}

function nativeSetFormValue(target: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(target, value)
}

/** Simulates the browser's default edit; production code does not handle Delete. */
function browserDeleteForm(
  target: HTMLInputElement | HTMLTextAreaElement,
  key: 'Backspace' | 'Delete',
): void {
  const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(keydown)
  expect(keydown.defaultPrevented).toBe(false)

  const start = target.selectionStart ?? 0
  const end = target.selectionEnd ?? start
  const from = start !== end ? start : key === 'Backspace' ? Math.max(0, start - 1) : start
  const to = start !== end ? end : key === 'Delete' ? Math.min(target.value.length, end + 1) : end
  const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward'
  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: null,
  })
  target.dispatchEvent(before)
  if (before.defaultPrevented || from === to) return

  nativeSetFormValue(target, target.value.slice(0, from) + target.value.slice(to))
  target.setSelectionRange(from, from)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: null }))
}

function browserDeleteContentEditable(target: HTMLElement, key: 'Backspace' | 'Delete'): void {
  const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(keydown)
  expect(keydown.defaultPrevented).toBe(false)

  const selection = document.getSelection()!
  const current = selection.getRangeAt(0)
  const prefix = document.createRange()
  prefix.selectNodeContents(target)
  prefix.setEnd(current.startContainer, current.startOffset)
  const caret = prefix.toString().length
  const text = target.textContent ?? ''
  const from = key === 'Backspace' ? Math.max(0, caret - 1) : caret
  const to = key === 'Delete' ? Math.min(text.length, caret + 1) : caret
  if (from === to) return

  const inputType = key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward'
  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType,
    data: null,
  })
  target.dispatchEvent(before)
  if (before.defaultPrevented) return

  const node = target.firstChild!
  const range = document.createRange()
  range.setStart(node, from)
  range.setEnd(node, to)
  range.deleteContents()
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: null }))
}

async function settle(): Promise<void> {
  await vi.waitFor(() => expect(statuses.at(-1)?.kind).not.toBe('translating'))
}

describe('three-spaces input translation', () => {
  it('consumes the gesture spaces and replaces a text input with the translation', async () => {
    const input = textInput()
    setInput(input, 'Hello world')
    const inputEvents: string[] = []
    const beforeInputEvents: string[] = []
    let changeEvents = 0
    input.addEventListener('input', (event) => inputEvents.push((event as InputEvent).inputType))
    input.addEventListener('beforeinput', (event) =>
      beforeInputEvents.push((event as InputEvent).inputType),
    )
    input.addEventListener('change', () => changeEvents++)

    press(input)
    press(input)
    const third = press(input)

    expect(third.defaultPrevented).toBe(true)
    expect(input.value).toBe('Hello world')
    expect(translate).toHaveBeenCalledWith('Hello world')
    await settle()

    expect(input.value).toBe('译:Hello world')
    expect(input.selectionStart).toBe(input.value.length)
    expect(document.activeElement).toBe(input)
    expect(beforeInputEvents).toContain('insertReplacementText')
    expect(inputEvents).toContain('deleteContentBackward')
    expect(inputEvents).toContain('insertReplacementText')
    // Text editing fires beforeinput/input. Native change is a later commit
    // event (normally blur), while React's synthetic onChange is input-backed.
    expect(changeEvents).toBe(0)
    expect(statuses.map((status) => status.kind)).toEqual(['translating', 'done'])
  })

  it('works in a textarea and preserves the whole multi-line draft as one request', async () => {
    const textarea = document.createElement('textarea')
    document.body.append(textarea)
    setInput(textarea, 'Line one\nLine two')

    press(textarea)
    press(textarea)
    press(textarea)
    await settle()

    expect(translate).toHaveBeenCalledWith('Line one\nLine two')
    expect(textarea.value).toBe('译:Line one\nLine two')
  })

  it('supports a contenteditable editor even when key events come from a child span', async () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.innerHTML = '<span>Hello</span>'
    document.body.append(editor)
    editor.focus()
    const child = editor.firstElementChild!
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(child)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)

    press(child as HTMLElement)
    press(child as HTMLElement)
    press(child as HTMLElement)
    await settle()

    expect(translate).toHaveBeenCalledWith('Hello')
    expect(editor.textContent).toBe('译:Hello')
  })

  it('does nothing for an empty field, so typing three intentional spaces still works', () => {
    const input = textInput()
    setInput(input, '')

    press(input)
    press(input)
    const third = press(input)

    expect(third.defaultPrevented).toBe(false)
    expect(input.value).toBe('   ')
    expect(translate).not.toHaveBeenCalled()
  })

  it('requires three quick consecutive presses on the same target', () => {
    const first = textInput()
    const second = textInput()
    setInput(first, 'First')
    setInput(second, 'Second')

    press(first)
    press(first, {}, 500)
    press(first)
    expect(translate).not.toHaveBeenCalled()

    press(second)
    press(first)
    expect(translate).not.toHaveBeenCalled()

    const letter = new KeyboardEvent('keydown', { key: 'x', bubbles: true })
    first.dispatchEvent(letter)
    press(first)
    press(first)
    expect(translate).not.toHaveBeenCalled()
  })

  it('ignores IME composition and key auto-repeat', () => {
    const input = textInput()
    setInput(input, '你好')

    press(input)
    press(input)
    press(input, { isComposing: true })
    expect(translate).not.toHaveBeenCalled()

    press(input)
    press(input)
    press(input, { repeat: true })
    expect(translate).not.toHaveBeenCalled()
  })

  it('does not read passwords, readonly fields, or unsupported input types', () => {
    for (const input of [textInput('password'), textInput('number'), textInput()]) {
      if (input.type === 'text') input.readOnly = true
      input.value = input.type === 'number' ? '123' : 'secret'
      input.focus()
      if (input.type !== 'number') input.setSelectionRange(input.value.length, input.value.length)
      press(input)
      press(input)
      press(input)
    }
    expect(translate).not.toHaveBeenCalled()
  })

  it('never overwrites text the user typed while translation was in flight', async () => {
    let resolve!: (result: InputTranslationResult) => void
    translate.mockImplementation(
      () => new Promise<InputTranslationResult>((done) => (resolve = done)),
    )
    const input = textInput()
    setInput(input, 'Draft')

    press(input)
    press(input)
    press(input)
    input.setRangeText(' changed', input.value.length, input.value.length, 'end')
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' changed' }))
    resolve({ translation: '译文', targetLanguage: 'zh-CN' })
    await settle()

    expect(input.value).toBe('Draft changed')
    expect(statuses.at(-1)?.kind).toBe('changed')
  })

  it('does not start a duplicate request on the same field while one is running', () => {
    translate.mockImplementation(() => new Promise<InputTranslationResult>(() => undefined))
    const input = textInput()
    setInput(input, 'Draft')

    press(input)
    press(input)
    press(input)
    press(input)
    press(input)
    press(input)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('Draft')
    expect(statuses.at(-1)?.kind).toBe('busy')
  })

  it('keeps the original text and reports an error when translation fails', async () => {
    translate.mockRejectedValue(new Error('network down'))
    const input = textInput()
    setInput(input, 'Keep me')

    press(input)
    press(input)
    press(input)
    await settle()

    expect(input.value).toBe('Keep me')
    expect(statuses.at(-1)).toMatchObject({ kind: 'error' })
  })

  it('reports cancellation for the exact active target when the controller stops', () => {
    translate.mockImplementation(() => new Promise<InputTranslationResult>(() => undefined))
    const input = textInput()
    setInput(input, 'Draft')

    press(input)
    press(input)
    press(input)
    expect(statuses.at(-1)).toMatchObject({ kind: 'translating', target: input })

    controller.stop()
    expect(statuses.at(-1)).toMatchObject({ kind: 'cancelled', target: input })
  })

  it('respects a host that cancels insertReplacementText in beforeinput', async () => {
    const input = textInput()
    setInput(input, 'Original')
    input.addEventListener('beforeinput', (event) => {
      if ((event as InputEvent).inputType === 'insertReplacementText') event.preventDefault()
    })

    press(input)
    press(input)
    press(input)
    await settle()

    expect(input.value).toBe('Original')
    expect(statuses.at(-1)).toMatchObject({ kind: 'error', target: input })
  })

  it('does not steal focus back when the user changes controls while waiting', async () => {
    let resolve!: (result: InputTranslationResult) => void
    translate.mockImplementation(
      () => new Promise<InputTranslationResult>((done) => (resolve = done)),
    )
    const input = textInput()
    const button = document.createElement('button')
    document.body.append(button)
    setInput(input, 'Draft')

    press(input)
    press(input)
    press(input)
    button.focus()
    resolve({ translation: 'Translated', targetLanguage: 'en' })
    await settle()

    expect(input.value).toBe('Translated')
    expect(document.activeElement).toBe(button)
  })
})

describe('translated text remains natively editable', () => {
  for (const kind of ['input', 'textarea'] as const) {
    it(`${kind}: Backspace（口语 delete/退格）和正向 Delete 都能删除译文`, async () => {
      const backward =
        kind === 'input' ? textInput() : document.body.appendChild(document.createElement('textarea'))
      setInput(backward, 'Alpha')
      press(backward)
      press(backward)
      press(backward)
      await settle()
      expect(backward.value).toBe('译:Alpha')
      expect(backward.selectionStart).toBe(backward.value.length)
      browserDeleteForm(backward, 'Backspace')
      expect(backward.value).toBe('译:Alph')

      const forward =
        kind === 'input' ? textInput() : document.body.appendChild(document.createElement('textarea'))
      setInput(forward, 'Beta')
      press(forward)
      press(forward)
      press(forward)
      await settle()
      forward.setSelectionRange(0, 0)
      browserDeleteForm(forward, 'Delete')
      expect(forward.value).toBe(':Beta')
    })
  }

  it('contenteditable: Backspace（口语 delete/退格）和正向 Delete 都能删除译文', async () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.textContent = 'Alpha'
    document.body.append(editor)
    editor.focus()
    let range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    press(editor)
    press(editor)
    press(editor)
    await settle()
    expect(editor.textContent).toBe('译:Alpha')
    expect(document.activeElement).toBe(editor)
    browserDeleteContentEditable(editor, 'Backspace')
    expect(editor.textContent).toBe('译:Alph')

    const forward = document.createElement('div')
    forward.setAttribute('contenteditable', 'true')
    forward.textContent = 'Beta'
    document.body.append(forward)
    forward.focus()
    range = document.createRange()
    range.selectNodeContents(forward)
    range.collapse(false)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    press(forward)
    press(forward)
    press(forward)
    await settle()
    range = document.createRange()
    range.setStart(forward.firstChild!, 0)
    range.collapse(true)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    browserDeleteContentEditable(forward, 'Delete')
    expect(forward.textContent).toBe(':Beta')
  })
})
