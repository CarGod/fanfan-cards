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
