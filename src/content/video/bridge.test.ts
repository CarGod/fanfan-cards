// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { REQUEST_EVENT, RESPONSE_EVENT, type BridgeRequest } from './bridge.ts'
import { callMainWorld } from './youtube.ts'

/**
 * 隔离世界与页面世界之间只有这一条线，而它坏掉的方式是**安静的**：
 * id 对不上、事件名写错、监听器没摘干净——页面上什么都不会发生，
 * 控制台里也什么都不会有。所以这里逐条钉住。
 */

/** 一个假的页面世界：收到请求就按给定的方式回。 */
function fakeMainWorld(respond: (request: BridgeRequest) => unknown): () => void {
  const listener = (event: Event): void => {
    const request = JSON.parse(String((event as CustomEvent).detail)) as BridgeRequest
    const detail = JSON.stringify({ id: request.id, ok: true, data: respond(request) })
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }))
  }
  document.addEventListener(REQUEST_EVENT, listener)
  return () => document.removeEventListener(REQUEST_EVENT, listener)
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  vi.useRealTimers()
})

describe('callMainWorld', () => {
  it('一来一回，请求内容原样送达', async () => {
    const seen: BridgeRequest[] = []
    cleanups.push(
      fakeMainWorld((request) => {
        seen.push(request)
        return { pot: 'token-abc' }
      }),
    )

    await expect(callMainWorld({ kind: 'prime', languageCode: 'en' })).resolves.toEqual({
      pot: 'token-abc',
    })
    expect(seen[0]).toMatchObject({ kind: 'prime', languageCode: 'en' })
    expect(seen[0]!.id).toBeTruthy()
  })

  /*
   * 两个请求同时在飞是常态：拿票和取字幕挨着发。id 不对上，
   * 「取字幕」就会收到「拿票」的结果——而那是一个看起来完全合法的对象。
   */
  it('并发时各认各的 id，不会串台', async () => {
    cleanups.push(fakeMainWorld((request) => ({ echo: request.kind })))
    const [a, b] = await Promise.all([
      callMainWorld<{ echo: string }>({ kind: 'captions' }),
      callMainWorld<{ echo: string }>({ kind: 'restore' }),
    ])
    expect(a.echo).toBe('captions')
    expect(b.echo).toBe('restore')
  })

  it('别人的 id 一律不接', async () => {
    cleanups.push(
      fakeMainWorld(() => {
        document.dispatchEvent(
          new CustomEvent(RESPONSE_EVENT, {
            detail: JSON.stringify({ id: 'someone-else', ok: true, data: '不是给我们的' }),
          }),
        )
        return 'ours'
      }),
    )
    await expect(callMainWorld({ kind: 'captions' })).resolves.toBe('ours')
  })

  it('页面世界报的错带着原话过来，而不是变成一句 undefined', async () => {
    const listener = (event: Event): void => {
      const request = JSON.parse(String((event as CustomEvent).detail)) as BridgeRequest
      document.dispatchEvent(
        new CustomEvent(RESPONSE_EVENT, {
          detail: JSON.stringify({ id: request.id, ok: false, error: '字幕接口返回 429' }),
        }),
      )
    }
    document.addEventListener(REQUEST_EVENT, listener)
    cleanups.push(() => document.removeEventListener(REQUEST_EVENT, listener))

    await expect(callMainWorld({ kind: 'captions' })).rejects.toThrow('字幕接口返回 429')
  })

  // 没有页面脚本时必须失败，不能挂在那里——界面会永远停在「正在读取字幕…」。
  it('页面世界没人应答时超时失败', async () => {
    // 超时的那句话是界面文案，跟着界面语言走；断言中文就得先把语言钉住，
    // 否则测试环境按 navigator.language 走成英文。
    setLanguage('zh-CN')
    vi.useFakeTimers()
    const pending = callMainWorld({ kind: 'captions' })
    const assertion = expect(pending).rejects.toThrow('页面脚本没有响应')
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
  })

  /*
   * 泄漏的监听器不会报错，只会越积越多：每收一次回应就多解析一次 JSON，
   * 看视频看久了、换过几十支视频之后才慢慢显出来。所以只能直接盯住加与摘配平。
   */
  it('无论成败都摘掉监听器，不留一路只增不减的监听器', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const nativeAdd = document.addEventListener.bind(document)
    const nativeRemove = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === RESPONSE_EVENT) added.push(listener)
      nativeAdd(type, listener as EventListener, options)
    })
    vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
      if (type === RESPONSE_EVENT) removed.push(listener)
      nativeRemove(type, listener as EventListener, options)
    })
    cleanups.push(() => vi.restoreAllMocks())

    cleanups.push(fakeMainWorld(() => 'done'))
    await callMainWorld({ kind: 'captions' })
    expect(added).toHaveLength(1)
    expect(removed).toEqual(added)
  })

  it('超时那条路同样摘干净', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const nativeAdd = document.addEventListener.bind(document)
    const nativeRemove = document.removeEventListener.bind(document)
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === RESPONSE_EVENT) added.push(listener)
      nativeAdd(type, listener as EventListener, options)
    })
    vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
      if (type === RESPONSE_EVENT) removed.push(listener)
      nativeRemove(type, listener as EventListener, options)
    })
    cleanups.push(() => vi.restoreAllMocks())

    vi.useFakeTimers()
    const pending = callMainWorld({ kind: 'captions' })
    const assertion = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(20_000)
    await assertion
    expect(removed).toEqual(added)
    expect(added).toHaveLength(1)
  })
})
