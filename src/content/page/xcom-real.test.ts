// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

/**
 * The exact shape x.com produces, taken from a real page.
 *
 * One `[data-testid="tweetText"]` div holding a single span whose text carries
 * its own newlines, with a separate 「显示更多」 button as a sibling. Expanding
 * replaces the span's text and removes the button; the div itself — and with it
 * our `data-ara-id` — survives.
 */
const TRUNCATED = `Easy there. .gram hasn’t been approved yet.

Telegram really has applied for it, and the idea is that your username could become something like durov.gram.

But ICANN only closed applications last week. We don’t even know yet whether someone else applied for the same name.

So`

const FULL = `${TRUNCATED} this could be very cool. It just isn’t a done deal.

Follow me — I check the announcement before the hype takes over.`

const tweet = (text: string, withButton: boolean) => `
<div data-testid="cellInnerDiv"><article data-testid="tweet"><div>
  <div dir="auto" lang="en" data-testid="tweetText"><span>${text}</span></div>
  ${withButton ? '<button data-testid="tweet-text-show-more-link"><span>显示更多</span></button>' : ''}
</div></article></div>`

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map((t) => `[译:${t.length}]`) }),
  )
  document.body.innerHTML = tweet(TRUNCATED, true)
})

afterEach(() => vi.useRealTimers())

describe('x.com 真实结构', () => {
  it('展开后重新翻译；旧译文不会留在下面', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(1)
    // directText 会把文本内的换行折叠成空格，所以按内容判定而不是逐字比对。
    const sentFirst = translate.mock.calls[0]![1].texts[0] as string
    expect(sentFirst).toContain('whether someone else applied for the same name')
    expect(sentFirst).not.toContain('done deal')

    const node = document.querySelector('[data-testid="tweetText"]')!
    expect(node.getAttribute('data-ara-translated')).toBe('done')

    // 点开「显示更多」：span 文本被换成完整版，按钮消失，div 本身不变。
    node.querySelector('span')!.textContent = FULL
    document.querySelector('[data-testid="tweet-text-show-more-link"]')!.remove()
    await settle(2500)

    expect(translate).toHaveBeenCalledTimes(2)
    const sentSecond = translate.mock.calls[1]![1].texts[0] as string
    expect(sentSecond).toContain('done deal')
    expect(sentSecond).toContain('before the hype takes over')
    expect(sentSecond.length).toBeGreaterThan(sentFirst.length)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(1)
    // 关键：留在页面上的必须是新译文，不是那条截断的。
    expect(document.querySelector('.ara-translation')!.textContent).toBe(`[译:${sentSecond.length}]`)
    translator.stop()
  })
})
