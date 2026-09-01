// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIError } from '@/types/ai.ts'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { PageTranslator } = await import('./pageTranslator.ts')

/**
 * 整页翻译的并发。
 *
 * 这个数字直接换来速度，也直接换来限流。把它交给读者之后，他调到 8 然后撞 429
 * 是**必然**的——那时该退让的是我们，而不是把他的整页翻译停掉。
 *
 * 而这件事只在真撞限流时才发生，开发机上几乎碰不到：一篇文章翻完了、看着挺好，
 * 谁也不知道换个限速严的服务商会是什么样。所以只能靠测试。
 */

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

/** 一篇够长的文章，好凑出多个批次。 */
function article(paragraphs: number): void {
  document.body.innerHTML = `<article>${Array.from(
    { length: paragraphs },
    (_, i) => `<p>Paragraph number ${i} talks about database migrations at length.</p>`,
  ).join('')}</article>`
}

/** 同一时刻在飞的请求峰值。 */
function trackInFlight(): { peak: () => number } {
  let live = 0
  let peak = 0
  translate.mockImplementation(
    (_t: string, payload: { texts: string[] }) =>
      new Promise((resolve) => {
        live += 1
        peak = Math.max(peak, live)
        setTimeout(() => {
          live -= 1
          resolve({ translations: payload.texts.map((text) => `译${text.length}`) })
        }, 20)
      }),
  )
  return { peak: () => peak }
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  /*
   * 假装扩展还活着。
   *
   * jsdom 里没有 `chrome` 全局，而 `isExtensionAlive()` 靠 `chrome.runtime.id`
   * 判断——不补的话它一律返回 false，于是**任何**错误都会被当成「扩展失联」，
   * 翻译器直接暂停。那样测出来的不是限流退让，是孤儿处理。
   */
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('并发数说了算', () => {
  it('设成 1 就一个一个来', async () => {
    article(40)
    const flight = trackInFlight()
    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 1 })
    await settle(500)
    expect(flight.peak()).toBe(1)
  })

  it('设成 6 就最多六个同时在飞', async () => {
    article(120)
    const flight = trackInFlight()
    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 6 })
    await settle(500)
    expect(flight.peak()).toBeGreaterThan(1)
    expect(flight.peak()).toBeLessThanOrEqual(6)
  })

  /** 设置值可能来自旧版本或被手改过。 */
  it('超出范围的值被收进合法区间', async () => {
    article(120)
    const flight = trackInFlight()
    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 99 })
    await settle(500)
    expect(flight.peak()).toBeLessThanOrEqual(8)
  })
})

describe('撞到限流时自动退让', () => {
  /**
   * 限流不是失败，是「你太快了」——它可以靠慢下来解决。
   * 按失败处理的话，连续三次限流就会把整轮翻译停掉，而那正是高并发下的常态。
   */
  it('限流之后，同时在飞的请求数真的降下来了', async () => {
    article(200)
    let live = 0
    let peakAfter = 0
    let limitsLeft = 8 // 第一轮整轮限流，逼它退让
    translate.mockImplementation(
      (_t: string, payload: { texts: string[] }) =>
        new Promise((resolve, reject) => {
          if (limitsLeft > 0) {
            limitsLeft -= 1
            // 异步 reject：同步 reject 时 live 根本没加过，测不出峰值。
            setTimeout(() => reject(new AIError('rate_limit', 'too fast', 'deepseek')), 5)
            return
          }
          live += 1
          peakAfter = Math.max(peakAfter, live)
          setTimeout(() => {
            live -= 1
            resolve({ translations: payload.texts.map(() => '译') })
          }, 20)
        }),
    )

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 8 })
    await settle(1500)

    /*
     * 两个条件缺一不可。
     *
     * 只断言「峰值降了」是空的：整轮被停掉时峰值也很低，测试照样绿。
     * 加上「整篇翻完了」，这两件事就不可能同时靠「什么都没做」满足。
     */
    expect(peakAfter).toBeGreaterThan(0)
    expect(peakAfter).toBeLessThanOrEqual(4)
    expect(document.querySelectorAll('.ara-translation').length).toBe(200)
  })

  /**
   * 限流不计入失败次数。
   *
   * 计入的话，连续三批限流就会 stop()——而 stop() 会把**页面上已有的译文全部清掉**。
   * 所以这里断言的是「最后整篇都翻完了」，不是「翻了一些」：
   * 后者在整轮被停掉的情况下也可能成立。
   */
  it('连续限流之后整篇仍然翻得完', async () => {
    article(24)
    let limitsLeft = 6
    translate.mockImplementation((_t: string, payload: { texts: string[] }) => {
      if (limitsLeft > 0) {
        limitsLeft -= 1
        return Promise.reject(new AIError('rate_limit', 'too fast', 'deepseek'))
      }
      return Promise.resolve({ translations: payload.texts.map(() => '译') })
    })

    new PageTranslator().start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 8 })
    await settle(2000)

    expect(document.querySelectorAll('.ara-translation').length).toBe(24)
  })

  /** 退让是这一轮的事，不该写回设置、也不该拖累下一轮。 */
  it('重新开一轮时回到设置值', async () => {
    article(200)
    const translator = new PageTranslator()

    translate.mockImplementation(
      () =>
        new Promise((_r, reject) =>
          setTimeout(() => reject(new AIError('rate_limit', 'x', 'deepseek')), 5),
        ),
    )
    translator.start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 6 })
    await settle(600)
    translator.stop()

    document.body.innerHTML = ''
    article(200)
    const flight = trackInFlight()
    translator.start({ range: 'all', targetLanguage: 'zh-CN', concurrency: 6 })
    await settle(600)
    // 退让到 1 之后，新一轮必须重新跑到 6 附近，而不是继续 1。
    expect(flight.peak()).toBeGreaterThan(3)
  })
})
