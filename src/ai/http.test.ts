import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postJson } from './http.ts'
import { AIError } from '@/types/ai.ts'

/**
 * Retry policy.
 *
 * The rule this pins down is not "retry on failure" but "retry exactly the
 * failures that are not about this request". The message a user saw for weeks —
 * "返回了空的响应体，重试一次即可" — told them to do something the product was
 * not doing; these tests are what makes the sentence true.
 */

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const empty = () => new Response('', { status: 200 })

function call(fetchMock: typeof fetch) {
  vi.stubGlobal('fetch', fetchMock)
  return postJson<{ value: number }>({
    url: 'https://example.test/v1/chat',
    headers: {},
    body: {},
    providerId: 'deepseek',
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Runs a postJson call to completion, letting its retry delay elapse.
 *
 * The empty `catch` is load-bearing: without it the promise rejects while the
 * timers are being advanced and before the assertion has attached, which vitest
 * reports as an unhandled rejection — three red blocks under a passing suite.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  await vi.advanceTimersByTimeAsync(5000)
  return promise
}

describe('postJson retry', () => {
  it('retries an empty body once and returns the second answer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(empty()).mockResolvedValueOnce(ok({ value: 7 }))
    await expect(settle(call(fetchMock as unknown as typeof fetch))).resolves.toEqual({ value: 7 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after one retry rather than hammering the provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(empty())
    await expect(settle(call(fetchMock as unknown as typeof fetch))).rejects.toThrow(AIError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 and honours Retry-After', async () => {
    const limited = new Response('slow down', {
      status: 429,
      headers: { 'retry-after': '2' },
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(ok({ value: 1 }))
    await expect(settle(call(fetchMock as unknown as typeof fetch))).resolves.toEqual({ value: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a rejected key — the answer would be identical', async () => {
    const denied = new Response('invalid api key', { status: 401 })
    const fetchMock = vi.fn().mockResolvedValue(denied)
    await expect(settle(call(fetchMock as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'auth',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a body that is a web page — the base URL is simply wrong', async () => {
    const html = new Response('<!doctype html><html><body>404</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    const fetchMock = vi.fn().mockResolvedValue(html)
    await expect(settle(call(fetchMock as unknown as typeof fetch))).rejects.toMatchObject({
      code: 'bad_response',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
