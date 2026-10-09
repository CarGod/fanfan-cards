// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://x.com/home"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectUnits, directText, findUnitAt } from './walker.ts'
import { clearAllSlots, createSlot, fillSlot, slotFor } from './slot.ts'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))
const { PageTranslator } = await import('./pageTranslator.ts')
let translator: InstanceType<typeof PageTranslator> | undefined
const settle = async () => { await vi.advanceTimersByTimeAsync(700) }

const fixture = () => {
  document.body.innerHTML = `<article><div data-testid="tweetText" style="white-space:pre-wrap;font-size:17px;line-height:24px"><span>Today, we are announcing ChatGPT.\n\nIt is here: </span><a href="https://t.co/Pgk3THSyOJ" target="_blank" style="color:rgb(29,155,240)"><span aria-hidden="true">https://</span>chatgpt.com</a></div></article>`
  return document.querySelector('[data-testid="tweetText"]')!
}
beforeEach(() => { vi.useFakeTimers(); translate.mockReset() })
afterEach(() => { translator?.stop(); translator = undefined; clearAllSlots(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('visible source formatting', () => {
  it('reads X text newlines and visible link labels, without modifying the original', () => {
    const source = fixture()
    const original = source.innerHTML
    const expected = 'Today, we are announcing ChatGPT.\n\nIt is here: chatgpt.com'
    expect(directText(source)).toBe(expected)
    expect(collectUnits(document.body).map(u => u.text)).toEqual([expected])
    expect(findUnitAt(source.querySelector('span'))?.text).toBe(expected)
    expect(source.innerHTML).toBe(original)
  })
  it.each(['pre-wrap', 'pre-line', 'pre', 'break-spaces'])('honors CSS %s and nested BRs', mode => {
    document.body.innerHTML = `<div style="white-space:${mode}"><span>First\n\nSecond<br>Third</span></div>`
    expect(directText(document.body.firstElementChild!)).toBe('First\n\nSecond\nThird')
  })
  it('still collapses HTML indentation under normal whitespace rules', () => {
    document.body.innerHTML = '<p>First\n  <span>Second\nThird</span></p>'
    expect(directText(document.body.firstElementChild!)).toBe('First Second Third')
  })
  it('matches source typography and reconstructs safe source links', () => {
    const source = fixture()
    const original = source.innerHTML
    source.after(createSlot(source))
    expect(fillSlot(source, directText(source), '今天，我们宣布推出 ChatGPT。\n它来了：https://chatgpt.com')).toBe('filled')
    const slot = slotFor(source)!
    expect(slot.textContent).toBe('今天，我们宣布推出 ChatGPT。\n\n它来了：chatgpt.com')
    expect(slot.style.fontSize).toBe('17px')
    expect(slot.style.lineHeight).toBe('24px')
    expect(slot.querySelector('a')?.href).toBe('https://t.co/Pgk3THSyOJ')
    expect(slot.querySelector('a')?.style.color).toBe('rgb(29, 155, 240)')
    expect(slot.querySelector('a')?.rel).toContain('noopener')
    clearAllSlots()
    expect(source.innerHTML).toBe(original)
  })
  it('does not interpret model HTML or create unsafe/hallucinated links', () => {
    document.body.innerHTML = '<p><a href="javascript:alert(1)">bad.example</a> and <a href="https://example.com">example.com</a></p>'
    const source = document.body.firstElementChild!
    source.after(createSlot(source))
    const output = '<img src=x onerror=alert(1)> bad.example example.com.evil/path https://other.example example.com'
    fillSlot(source, directText(source), output)
    const slot = slotFor(source)!
    expect(slot.querySelector('img')).toBeNull()
    expect(slot.querySelectorAll('a')).toHaveLength(1)
    expect(slot.querySelector('a')?.href).toBe('https://example.com/')
    expect(slot.textContent).toBe(output)
  })
  it('restores the same blank line when the provider initially flattens the post', async () => {
    const source = fixture()
    const original = source.innerHTML
    translate.mockImplementation((_type, payload: { texts: string[] }) => Promise.resolve({
      translations: payload.texts.length === 1
        ? ['今天，我们宣布推出 ChatGPT。它来了：chatgpt.com']
        : ['今天，我们宣布推出 ChatGPT。', '它来了：chatgpt.com'],
    }))
    translator = new PageTranslator()
    translator.start({ range: 'all' })
    await settle()
    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts).toEqual(['Today, we are announcing ChatGPT.', 'It is here: chatgpt.com'])
    expect(slotFor(source)?.textContent).toBe('今天，我们宣布推出 ChatGPT。\n\n它来了：chatgpt.com')
    expect(slotFor(source)?.querySelector('a')).not.toBeNull()
    translator.stop()
    expect(source.innerHTML).toBe(original)
  })
  it('refreshes translations when only the visible paragraph break changes', async () => {
    fixture()
    translate.mockImplementation((_type, payload: { texts: string[] }) => Promise.resolve({
      translations: payload.texts.map(text => text.split('\n').map(line => line ? `译：${line}` : '').join('\n')),
    }))
    translator = new PageTranslator()
    translator.start({ range: 'all' })
    await settle()
    const span = document.querySelector('[data-testid="tweetText"] > span')!
    span.textContent = 'Today, we are announcing ChatGPT.\nIt is here: '
    await settle()
    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts[0]).toBe('Today, we are announcing ChatGPT.\nIt is here: chatgpt.com')
  })
})
