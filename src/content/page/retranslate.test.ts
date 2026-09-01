// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

/**
 * The whole chain, on a real DOM: observer -> debounce -> change detection ->
 * re-request -> slot updated.
 *
 * Written after a post behind 「显示更多」 was translated while truncated and
 * then left with a translation that stopped mid-sentence under four more lines
 * of English. Testing only the string comparison would have missed that the
 * observer was not watching for text changes at all.
 */
const SHORT = 'Been working on a storyboard non-stop for the last 3 days.'
const LONG = `${SHORT} But getting those 60 seconds right can take days of thinking, searching references and reworking every single frame.`

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_type: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map((text) => `[译] ${text.slice(0, 24)}`) }),
  )
  document.body.innerHTML = `<article><p id="post">${SHORT}</p></article>`
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PageTranslator re-translates expanded content', () => {
  it('translates the truncated post, then again in full once it expands', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate.mock.calls[0]![1].texts[0]).toBe(SHORT)

    // 「显示更多」: same element, longer text, no nodes added.
    document.getElementById('post')!.textContent = LONG
    await settle(600)

    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts[0]).toBe(LONG)

    const slot = document.querySelector('.ara-translation')
    expect(slot?.textContent).toContain('[译]')
    // One translation, not two stacked under each other.
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(1)
    translator.stop()
  })

  it('does not re-request when the page merely reflows the same words', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)
    expect(translate).toHaveBeenCalledTimes(1)

    // Same text, different whitespace and an inline wrapper — what a re-render does.
    document.getElementById('post')!.innerHTML =
      'Been working on a <span>storyboard</span>   non-stop for the last 3 days.'
    await settle(600)

    expect(translate).toHaveBeenCalledTimes(1)
    translator.stop()
  })

  it('leaves the page exactly as found when stopped', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)
    translator.stop()

    expect(document.querySelectorAll('.ara-translation')).toHaveLength(0)
    expect(document.getElementById('post')!.getAttributeNames()).toEqual(['id'])
  })
})
