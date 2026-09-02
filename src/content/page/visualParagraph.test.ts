// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_IN_TRANSLATION_ONLY } from './styles.ts'
import { SEGMENT_SOURCE_CLASS } from './walker.ts'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

const SOURCE =
  'You can use <a href="#gift">gift card balances</a> for purchases. ' +
  '<b>Mobile purchases are excluded.</b><!--react-marker--><br><br>' +
  'Note that you cannot choose how much balance to use for a specific purchase.<br><br>' +
  'Trials may still require a payment method.<br>Check the amount before confirming.'

const EXPECTED = [
  'You can use gift card balances for purchases. Mobile purchases are excluded.',
  'Note that you cannot choose how much balance to use for a specific purchase.',
  'Trials may still require a payment method.\nCheck the amount before confirming.',
]

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_type: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map((text) => `译：${text}`) }),
  )
  document.body.innerHTML = `<article><p id="copy">${SOURCE}</p></article>`
})

afterEach(() => vi.useRealTimers())

describe('one DOM paragraph containing several visual paragraphs', () => {
  it('does not drop the middle of a long FAQ when twelve queued units exceed the character limit', async () => {
    const faqs = Array.from({ length: 10 }, (_, index) => {
      const question = `What happens under gift-card rule ${index + 1} for this account?`
      const answer =
        `Gift-card answer ${index + 1} explains the purchase, refund, activation, delivery, and account restrictions in detail. ` +
        'The retailer and the account holder should verify the order information before taking another action. '
          .repeat(6)
          .trim()
      return { question, answer }
    })
    document.body.innerHTML = `<article>${faqs
      .map(({ question, answer }) => `<h3>${question}</h3><p>${answer}</p>`)
      .join('')}</article>`

    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(500)

    const expected = faqs.flatMap(({ question, answer }) => [question, answer])
    const sent = translate.mock.calls.flatMap((call) => call[1].texts)
    expect(sent).toEqual(expected)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(expected.length)
    translator.stop()
  })

  it('translates every visual paragraph independently and inserts each result under its source', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(100)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(translate.mock.calls[0]![1].texts).toEqual(EXPECTED)

    const sources = [...document.querySelectorAll<HTMLElement>(`.${SEGMENT_SOURCE_CLASS}`)]
    expect(sources).toHaveLength(3)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(3)
    for (const source of sources) {
      const slot = source.nextElementSibling
      expect(slot?.classList.contains('ara-translation')).toBe(true)
      expect(slot?.textContent).toContain('译：')
    }
    // No aggregate translation is appended after the whole <p>.
    expect(document.getElementById('copy')?.nextElementSibling).toBeNull()
    translator.stop()
  })

  it('keeps translation-only mode segment-local and restores the exact source DOM on stop', async () => {
    const original = document.getElementById('copy')!.innerHTML
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(100)

    const sources = [...document.querySelectorAll<HTMLElement>(`.${SEGMENT_SOURCE_CLASS}`)]
    expect(sources).toHaveLength(3)
    expect(sources.every((source) => source.matches(HIDDEN_IN_TRANSLATION_ONLY))).toBe(true)

    translator.stop()
    expect(document.querySelectorAll(`.${SEGMENT_SOURCE_CLASS}, .ara-translation`)).toHaveLength(0)
    expect(document.getElementById('copy')!.innerHTML).toBe(original)

    // A second click/run must build the same three pairs, not reuse stale ids or
    // nest source wrappers left by the previous run.
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(100)
    expect(document.querySelectorAll(`.${SEGMENT_SOURCE_CLASS}`)).toHaveLength(3)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(3)
    translator.stop()
    expect(document.getElementById('copy')!.innerHTML).toBe(original)
  })

  it('re-translates only the visual paragraph whose text changes in place', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(100)

    const changed = document.querySelectorAll<HTMLElement>(`.${SEGMENT_SOURCE_CLASS}`)[1]!
    changed.textContent =
      'Note that you cannot choose how much balance to use; the full balance is applied first.'
    await settle(600)

    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts).toEqual([
      'Note that you cannot choose how much balance to use; the full balance is applied first.',
    ])
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(3)
    translator.stop()
  })

  it('re-segments and re-translates when a dynamic page replaces the paragraph contents', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(100)

    document.getElementById('copy')!.innerHTML =
      'A newly loaded first paragraph.<br><br>A newly loaded second paragraph.'
    await settle(700)

    const sent = translate.mock.calls.flatMap((call) => call[1].texts)
    expect(sent).toContain('A newly loaded first paragraph.')
    expect(sent).toContain('A newly loaded second paragraph.')
    expect(document.querySelectorAll(`.${SEGMENT_SOURCE_CLASS}`)).toHaveLength(2)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(2)
    translator.stop()
  })

  it('retries only an empty batch member instead of leaving a permanent middle hole', async () => {
    translate.mockImplementationOnce((_type: string, payload: { texts: string[] }) =>
      Promise.resolve({
        translations: payload.texts.map((text, index) => (index === 1 ? '' : `译：${text}`)),
      }),
    )
    translate.mockImplementation((_type: string, payload: { texts: string[] }) =>
      Promise.resolve({ translations: payload.texts.map((text) => `补译：${text}`) }),
    )

    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(200)

    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts).toEqual([EXPECTED[1]])
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(EXPECTED.length)
    translator.stop()
  })
})
