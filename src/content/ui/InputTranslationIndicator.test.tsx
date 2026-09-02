// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputTranslationIndicator } from './InputTranslationIndicator.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.replaceChildren()
})

function targetAt(left: number, top: number, width = 180, height = 32): HTMLInputElement {
  const target = document.createElement('input')
  target.getBoundingClientRect = vi.fn(
    () => new DOMRect(left, top, width, height),
  )
  document.body.append(target)
  return target
}

describe('target-bound input translation loading indicator', () => {
  it('sits on the triggering field edge, follows movement, and restores aria-busy', () => {
    const target = targetAt(20, 40)
    const rect = target.getBoundingClientRect as ReturnType<typeof vi.fn>

    act(() => root.render(<InputTranslationIndicator target={target} />))
    const indicator = container.querySelector<HTMLElement>('[data-input-translation-loading]')!
    expect(indicator).not.toBeNull()
    expect(indicator.style.left).toBe('172px')
    expect(indicator.style.top).toBe('44px')
    expect(indicator.style.width).toBe('24px')
    expect(indicator.querySelector('.spinner')).not.toBeNull()
    expect(target.getAttribute('aria-busy')).toBe('true')

    rect.mockReturnValue(new DOMRect(80, 90, 180, 32))
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(indicator.style.left).toBe('232px')
    expect(indicator.style.top).toBe('94px')

    act(() => root.render(<></>))
    expect(container.querySelector('[data-input-translation-loading]')).toBeNull()
    expect(target.hasAttribute('aria-busy')).toBe(false)
  })

  it('keeps simultaneous requests associated with their own fields', () => {
    const first = targetAt(20, 40)
    const second = targetAt(20, 100)
    act(() =>
      root.render(
        <>
          <InputTranslationIndicator target={first} />
          <InputTranslationIndicator target={second} />
        </>,
      ),
    )

    const indicators = container.querySelectorAll('[data-input-translation-loading]')
    expect(indicators).toHaveLength(2)
    expect(first.getAttribute('aria-busy')).toBe('true')
    expect(second.getAttribute('aria-busy')).toBe('true')

    first.remove()
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(container.querySelectorAll('[data-input-translation-loading]')).toHaveLength(1)
  })

  it('shrinks inside a short field and hides when the target cannot hold it', () => {
    const target = targetAt(10, 20, 18, 16)
    const rect = target.getBoundingClientRect as ReturnType<typeof vi.fn>
    act(() => root.render(<InputTranslationIndicator target={target} />))

    const indicator = container.querySelector<HTMLElement>('[data-input-translation-loading]')!
    expect(indicator.style.left).toBe('13px')
    expect(indicator.style.top).toBe('22px')
    expect(indicator.style.width).toBe('12px')
    expect(Number.parseFloat(indicator.style.left) + Number.parseFloat(indicator.style.width)).toBeLessThanOrEqual(28)

    rect.mockReturnValue(new DOMRect(10, 20, 10, 10))
    act(() => window.dispatchEvent(new Event('resize')))
    expect(container.querySelector('[data-input-translation-loading]')).toBeNull()
  })
})
