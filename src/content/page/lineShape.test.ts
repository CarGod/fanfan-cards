// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

/**
 * 原文的换行不是排版装饰。
 *
 * 地址、歌词、推文里分行写的那几句，塌成一整段之后读者要重新猜哪里断句——
 * 而他本来正是靠这些行看懂结构的。提示词里已经要求模型保留行数，
 * 但那是「请求时好好说」；这几条用例测的是说了不算数的时候会发生什么。
 */

const post = (lines: string[]) =>
  `<article><div data-testid="tweetText">${lines
    .map((line) => `<span>${line}</span>`)
    .join('<br>')}</div></article>`

const LINES = [
  'Ship the thing on Friday.',
  'Tell nobody it is late.',
  'Apologise on Monday morning.',
]

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

const slotText = () =>
  document.querySelector('.ara-translation')?.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  document.body.innerHTML = post(LINES)
})

afterEach(() => vi.useRealTimers())

describe('译文的换行结构', () => {
  it('模型守规矩时，一次请求就够，行数原样保留', async () => {
    translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
      Promise.resolve({
        translations: payload.texts.map((text) =>
          text.split('\n').map((line) => `译${line.length}`).join('\n'),
        ),
      }),
    )

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(slotText().split('\n')).toHaveLength(3)
  })

  it('模型把三行压成一段时，逐行重译一次，把结构拿回来', async () => {
    // 第一次整段来一行；第二次是逐行请求，按行数各回一条。
    translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
      Promise.resolve({
        translations:
          payload.texts.length === 1
            ? ['周五发版 别说晚了 周一再道歉']
            : payload.texts.map((text) => `译${text.length}`),
      }),
    )

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(2)
    // 第二次请求发的是三行，而不是又一整段。
    expect(translate.mock.calls[1]![1].texts).toHaveLength(3)
    expect(slotText().split('\n')).toHaveLength(3)
  })

  it('原文只有一行时，模型多给的换行会被合掉，也不会触发重译', async () => {
    document.body.innerHTML = post(['A single line that says one thing.'])
    translate.mockImplementation(() =>
      Promise.resolve({ translations: ['一句话，\n被模型断开了。'] }),
    )

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(slotText()).toBe('一句话， 被模型断开了。')
  })

  /**
   * 补救是第二次请求，花的是读者自己的 API 额度。
   *
   * 模型如果一贯不保留换行，一整页信息流会安静地把请求数翻一倍——
   * 那是个不该由我们替他做的决定，所以有上限。
   */
  it('模型一贯压平时，补救有上限，不会把整页的请求数翻倍', async () => {
    document.body.innerHTML = Array.from({ length: 20 }, () => post(LINES)).join('')
    translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
      Promise.resolve({ translations: payload.texts.map(() => '全都压成一行') }),
    )

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(200)

    const perLineCalls = translate.mock.calls.filter((call) => call[1].texts.length === 3)
    expect(perLineCalls.length).toBeGreaterThan(0)
    expect(perLineCalls.length).toBeLessThanOrEqual(8)
  })

  /**
   * 补救是第二次请求，主队列还在跑的时候不该跟它抢限流额度。
   *
   * 一次 429 废掉的是整轮翻译，换来的只是几段本来就读得懂的译文多了几个换行。
   * 所以补救排在主队列排空之后——这条用例钉的就是这个顺序。
   */
  it('补救排在主队列之后，不跟正在等的那一屏抢额度', async () => {
    document.body.innerHTML = Array.from({ length: 30 }, () => post(LINES)).join('')
    const sizes: number[] = []
    translate.mockImplementation((_t: string, payload: { texts: string[] }) => {
      sizes.push(payload.texts.length)
      return Promise.resolve({ translations: payload.texts.map(() => '全都压成一行') })
    })

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN' })
    await settle(400)

    // 逐行补救的请求恰好是 3 条文本；主批次是多段一次。
    const firstRetry = sizes.findIndex((size) => size === LINES.length)
    const lastBatch = sizes.map((size, i) => (size !== LINES.length ? i : -1)).filter((i) => i >= 0).pop()
    expect(firstRetry).toBeGreaterThan(-1)
    expect(firstRetry).toBeGreaterThan(lastBatch!)
  })
})
