// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn<(type: string, payload?: unknown) => Promise<unknown>>()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: unknown) => sendMessage(type, payload),
}))
vi.mock('@/services/speech.ts', () => ({ speak: vi.fn(), warmUpVoices: vi.fn() }))

const { createMemoryAdapter, setStorageAdapter } = await import('@/storage/area.ts')
const { saveSettings } = await import('@/storage/repositories/settingsRepo.ts')
const { App } = await import('./App.tsx')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface PendingTranslation {
  promise: Promise<{ translation: string; targetLanguage: string }>
  resolve: (value: { translation: string; targetLanguage: string }) => void
  reject: (error: unknown) => void
}

let container: HTMLDivElement
let host: HTMLElement
let root: Root
let mounted = false
let pending: PendingTranslation

function deferred(): PendingTranslation {
  let resolve!: PendingTranslation['resolve']
  let reject!: PendingTranslation['reject']
  const promise = new Promise<{ translation: string; targetLanguage: string }>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  document.body.replaceChildren()
  sendMessage.mockReset()
  pending = deferred()
  sendMessage.mockImplementation(async (type) => {
    if (type === 'page/shouldTranslate') return { translating: false }
    if (type === 'input/translate') return pending.promise
    return {}
  })
  setStorageAdapter(createMemoryAdapter())
  await saveSettings({ provider: 'deepseek' })

  container = document.createElement('div')
  host = document.createElement('div')
  document.body.append(container, host)
  root = createRoot(container)
  mounted = true
  await act(async () => {
    root.render(<App host={host} />)
    await Promise.resolve()
  })
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  setStorageAdapter(null)
  document.body.replaceChildren()
})

function inputWith(value: string): HTMLInputElement {
  const input = document.createElement('input')
  input.value = value
  input.getBoundingClientRect = () => new DOMRect(20, 40, 180, 32)
  document.body.append(input)
  input.focus()
  input.setSelectionRange(value.length, value.length)
  return input
}

function pressSpace(input: HTMLInputElement): void {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  })
  input.dispatchEvent(event)
  if (event.defaultPrevented) return
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  input.setRangeText(' ', start, end, 'end')
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' ', inputType: 'insertText' }))
}

async function trigger(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    pressSpace(input)
    pressSpace(input)
    pressSpace(input)
    await Promise.resolve()
  })
}

const indicator = () => container.querySelector('[data-input-translation-loading]')

describe('input translation loading lifecycle in App', () => {
  it('keeps the original text and shows a spinner on that input until success replaces it', async () => {
    const input = inputWith('Original draft')
    await trigger(input)

    expect(input.value).toBe('Original draft')
    expect(input.getAttribute('aria-busy')).toBe('true')
    expect(indicator()).not.toBeNull()

    await act(async () => {
      pending.resolve({ translation: 'Translated draft', targetLanguage: 'en' })
      await pending.promise
      await Promise.resolve()
    })

    expect(input.value).toBe('Translated draft')
    expect(indicator()).toBeNull()
    expect(input.hasAttribute('aria-busy')).toBe(false)
  })

  it('removes the spinner and preserves the original when the request fails', async () => {
    const input = inputWith('Keep this')
    await trigger(input)
    expect(indicator()).not.toBeNull()

    await act(async () => {
      pending.reject(new Error('network down'))
      try {
        await pending.promise
      } catch {
        // The controller turns this into an error status for App.
      }
      await Promise.resolve()
    })

    expect(input.value).toBe('Keep this')
    expect(indicator()).toBeNull()
    expect(input.hasAttribute('aria-busy')).toBe(false)
  })

  it('removes the spinner without overwriting edits made while waiting', async () => {
    const input = inputWith('Draft')
    await trigger(input)
    input.setRangeText(' changed', input.value.length, input.value.length, 'end')
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ' changed' }))

    await act(async () => {
      pending.resolve({ translation: 'Should not win', targetLanguage: 'en' })
      await pending.promise
      await Promise.resolve()
    })

    expect(input.value).toBe('Draft changed')
    expect(indicator()).toBeNull()
    expect(input.hasAttribute('aria-busy')).toBe(false)
  })

  it('cleans target state when the controller unmounts or the input is removed', async () => {
    const input = inputWith('Draft')
    await trigger(input)
    expect(indicator()).not.toBeNull()

    input.remove()
    await act(async () => window.dispatchEvent(new Event('scroll')))
    expect(indicator()).toBeNull()
    expect(input.hasAttribute('aria-busy')).toBe(false)

    const second = inputWith('Another draft')
    await trigger(second)
    expect(indicator()).not.toBeNull()
    act(() => root.unmount())
    mounted = false
    expect(container.querySelector('[data-input-translation-loading]')).toBeNull()
    expect(second.hasAttribute('aria-busy')).toBe(false)
  })
})
