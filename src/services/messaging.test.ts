import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMessage } from './messaging.ts'
import { isContextInvalidated } from '@/shared/extensionContext.ts'

const closed = 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
const transport = vi.fn()

beforeEach(() => {
  transport.mockReset()
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage: transport } })
})
afterEach(() => vi.unstubAllGlobals())

describe('translation message recovery', () => {
  it.each([closed, 'The message port closed before a response was received.', 'Could not establish connection. Receiving end does not exist.'])('retries a temporary disconnect once: %s', async message => {
    transport.mockRejectedValueOnce(new Error(message))
      .mockResolvedValueOnce({ ok: true, data: { translations: ['你好'] } })
    expect(isContextInvalidated(new Error(message))).toBe(false)
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).resolves.toEqual({ translations: ['你好'] })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(transport.mock.calls[1]).toEqual(transport.mock.calls[0])
  })

  it('bounds persistent disconnects and reports a recoverable network failure', async () => {
    transport.mockRejectedValue(new Error(closed))
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).rejects.toMatchObject({ code: 'network' })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('does not retry when a reload invalidates the context during a request', async () => {
    transport.mockImplementationOnce(async () => {
      vi.stubGlobal('chrome', { runtime: undefined })
      throw new Error(closed)
    })
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).rejects.toMatchObject({ code: 'stale_context' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('recognizes explicit context invalidation even if the runtime ID remains', async () => {
    transport.mockRejectedValue(new Error('Extension context invalidated.'))
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).rejects.toMatchObject({ code: 'stale_context' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('never replays a potentially completed mutation', async () => {
    transport.mockRejectedValue(new Error(closed))
    await expect(sendMessage('sync/run', { mode: 'merge' })).rejects.toMatchObject({ code: 'network' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('does not replay a provider error delivered successfully over the channel', async () => {
    transport.mockResolvedValue({ ok: false, error: { kind: 'ai', code: 'rate_limit', message: 'Rate limited' } })
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).rejects.toMatchObject({ code: 'rate_limit' })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('does not retry unrelated transport errors', async () => {
    transport.mockRejectedValue(new Error('Unexpected transport failure'))
    await expect(sendMessage('page/translate', { texts: ['Hello'] })).rejects.toMatchObject({ code: 'network', message: 'Unexpected transport failure' })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})

it('stops waiting when an extension reload leaves the message unresolved', async () => {
  vi.useFakeTimers()
  try {
    transport.mockImplementation(() => new Promise(() => {}))
    const result = sendMessage('page/translate', { texts: ['Hello'] })
    const assertion = expect(result).rejects.toMatchObject({ code: 'stale_context' })
    vi.stubGlobal('chrome', { runtime: undefined })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('bounds a silent background request without replaying it', async () => {
  vi.useFakeTimers()
  try {
    transport.mockImplementation(() => new Promise(() => {}))
    const result = sendMessage('page/translate', { texts: ['Hello'] })
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
    expect(transport).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

/*
 * 「翻译响应较慢」只说给正在等的人听。
 *
 * 它曾经挂在每一个 page/translate 上：读者没碰任何开关，视频字幕在后台跑、
 * 无限滚动的新段落在补译、站点记住的整页翻译自己续上了——任何一批超过 8 秒，
 * 右下角就冒出一句「请勿重复点击」，读者根本不知道自己点了什么。
 */
describe('slow translation notice', () => {
  const notices: unknown[] = []
  const listen = (event: Event) => notices.push((event as CustomEvent<unknown>).detail)

  beforeEach(() => {
    notices.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('window', new EventTarget())
    window.addEventListener('fanfan:translation-notice', listen)
  })
  afterEach(() => vi.useRealTimers())

  it('stays quiet for a request nobody is waiting on', async () => {
    let answer: (value: unknown) => void = () => undefined
    transport.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    const result = sendMessage('page/translate', { texts: ['Hello'] })
    await vi.advanceTimersByTimeAsync(10_000)
    answer({ ok: true, data: { translations: ['你好'] } })
    await expect(result).resolves.toEqual({ translations: ['你好'] })
    expect(notices).toEqual([])
  })

  it('tells the reader once their own request passes eight seconds', async () => {
    let answer: (value: unknown) => void = () => undefined
    transport.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    const result = sendMessage('page/translate', { texts: ['Hello'] }, { notifySlow: true })
    await vi.advanceTimersByTimeAsync(7_999)
    expect(notices).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(notices).toHaveLength(1)
    answer({ ok: true, data: { translations: ['你好'] } })
    await expect(result).resolves.toEqual({ translations: ['你好'] })
    expect(vi.getTimerCount()).toBe(0)
  })
})
