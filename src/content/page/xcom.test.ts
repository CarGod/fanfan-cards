// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

/**
 * A post shaped the way x.com shapes one: a container of inline spans separated
 * by `<br>`, with 「显示更多」 appending more spans rather than rewriting a
 * single text node.
 *
 * The earlier test replaced `textContent` on a `<p>`, which is not what the site
 * actually does — and passing that test is exactly why the real page still
 * showed a translation frozen at the truncated version.
 */
const line = (text: string) => `<span>${text}</span><br><br>`

const COLLAPSED =
  line('If @durov wants Telegram to truly capture the US market, .gram is a massive branding misfire.') +
  line('You can not launch a metric domain in a nation that measures distance in football fields.') +
  line('Give Americans .pound.') +
  '<span>Or better yet, go full volumetric</span>'

const EXPANDED =
  COLLAPSED.replace('go full volumetric</span>', 'go full volumetric liberty:</span>') +
  '<br><br>' +
  line('yourname.gallon') +
  '<span>Now that would be an American internet domain.</span>'

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map((text) => `[译]${text.length}`) }),
  )
  document.body.innerHTML = `<article><div data-testid="tweetText">${COLLAPSED}</div></article>`
})

afterEach(() => vi.useRealTimers())

describe('x.com 的「显示更多」', () => {
  it('展开后重新翻译，而不是把截断版留在下面', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)
    expect(translate).toHaveBeenCalledTimes(1)
    const first = translate.mock.calls[0]![1].texts[0] as string

    // 展开：容器里追加了新的 span，容器本身没有被替换。
    document.querySelector('[data-testid="tweetText"]')!.innerHTML = EXPANDED
    await settle(600)

    expect(translate).toHaveBeenCalledTimes(2)
    const second = translate.mock.calls[1]![1].texts[0] as string
    expect(second.length).toBeGreaterThan(first.length)
    expect(second).toContain('yourname.gallon')
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(1)
    translator.stop()
  })

  it('信息流持续变更时仍然补上展开的内容', async () => {
    const translator = new PageTranslator()
    translator.start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)
    expect(translate).toHaveBeenCalledTimes(1)

    // x.com 上时间戳、图片、虚拟滚动在不停改 DOM。纯防抖会被这些无关变更
    // 一直推后，重扫永远不发生——这正是译文停在截断版的原因。
    const noise = document.createElement('div')
    document.body.append(noise)
    const ticker = setInterval(() => {
      noise.textContent = `13小时 ${Date.now()}`
    }, 100)

    document.querySelector('[data-testid="tweetText"]')!.innerHTML = EXPANDED

    // 全程都有变更，一刻不停；上限必须让重扫照样跑起来。
    await settle(2500)
    clearInterval(ticker)

    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts[0]).toContain('yourname.gallon')
    translator.stop()
  })
})
