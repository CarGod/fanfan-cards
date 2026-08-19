import { truncate } from '@/shared/utils.ts'
import { AIError, type AIErrorCode, type ProviderId } from '@/types/ai.ts'

export const DEFAULT_TIMEOUT_MS = 30_000

/**
 * One retry, then give up.
 *
 * The failures worth retrying are the ones that are not about this request:
 * a connection cut mid-response, a timeout, a 429. Retrying more than once
 * turns a provider hiccup into a long silent stall, and retrying an auth error
 * spends a round trip to be told the same thing — so `AIError.retryable`
 * decides, not the call site.
 */
const RETRY_DELAY_MS = 700
/** A 429 usually names its own wait; honour it, but never stall the UI. */
const MAX_RETRY_AFTER_MS = 4000

/**
 * All provider traffic goes through here so every backend produces the same
 * error vocabulary. The UI switches on `AIError.code`, never on a message.
 */
export async function postJson<T>(options: {
  url: string
  headers: Record<string, string>
  body: unknown
  providerId: ProviderId
  signal?: AbortSignal | undefined
  timeoutMs?: number
}): Promise<T> {
  try {
    return await postJsonOnce<T>(options)
  } catch (error) {
    if (!(error instanceof AIError) || !error.retryable) throw error
    // An abort is the user's decision, never something to undo by retrying.
    if (options.signal?.aborted) throw error
    await delay(retryDelayFor(error), options.signal)
    return await postJsonOnce<T>(options)
  }
}

function retryDelayFor(error: AIError): number {
  if (error.code !== 'rate_limit') return RETRY_DELAY_MS
  const seconds = Number(error.retryAfterSeconds ?? 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_DELAY_MS
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new AIError('aborted', '请求已取消', 'mock'))
      },
      { once: true },
    )
  })
}

async function postJsonOnce<T>(options: {
  url: string
  headers: Record<string, string>
  body: unknown
  providerId: ProviderId
  signal?: AbortSignal | undefined
  timeoutMs?: number
}): Promise<T> {
  const { url, headers, body, providerId } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const signals = [AbortSignal.timeout(timeoutMs)]
  if (options.signal) signals.push(options.signal)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    })
  } catch (error) {
    throw toNetworkError(error, providerId, options.signal)
  }

  if (!response.ok) {
    const detail = await safeText(response)
    const retryAfter = Number(response.headers.get('retry-after') ?? '')
    throw new AIError(
      statusToCode(response.status),
      summarise(detail, response.status),
      providerId,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {},
    )
  }

  /*
   * Read as text first, so a failure can say what actually came back.
   *
   * "Response body was not valid JSON" is true and useless: the three things
   * that produce it need three different fixes. An empty body usually means the
   * connection was cut mid-response; an HTML body means a gateway or proxy
   * answered instead of the model (a captive portal, a company egress filter, a
   * wrong base URL pointing at a web page); anything else is the provider
   * returning something genuinely unexpected. The snippet tells them apart.
   */
  const raw = await safeText(response)
  if (!raw.trim()) {
    throw new AIError(
      'bad_response',
      `${providerId} 返回了空的响应体（HTTP ${response.status}）——通常是连接被中断`,
      providerId,
      response.status,
      { retryable: true },
    )
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const contentType = response.headers.get('content-type') ?? '未标注'
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(raw)
    const hint = looksLikeHtml
      ? '返回的是网页而不是接口响应，通常意味着 API 地址填错了，或请求被网关/代理拦下'
      : `content-type: ${contentType}`
    throw new AIError(
      'bad_response',
      `${providerId} 的响应不是 JSON（${hint}）：${truncate(raw, 200)}`,
      providerId,
      response.status,
    )
  }
}

export function statusToCode(status: number): AIErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'network'
  return 'unknown'
}

export function toNetworkError(
  error: unknown,
  providerId: ProviderId,
  callerSignal?: AbortSignal | undefined,
): AIError {
  if (error instanceof AIError) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return callerSignal?.aborted
      ? new AIError('aborted', 'Request cancelled', providerId)
      : new AIError('timeout', 'Request timed out', providerId)
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new AIError('timeout', 'Request timed out', providerId)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new AIError('network', message || 'Network request failed', providerId)
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/** Provider error bodies are long and noisy; keep the useful half. */
function summarise(detail: string, status: number): string {
  const trimmed = detail.trim()
  if (!trimmed) return `HTTP ${status}`
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string }
    const message = parsed.error?.message ?? parsed.message
    if (message) return `HTTP ${status}: ${message}`
  } catch {
    // fall through to the raw body
  }
  return `HTTP ${status}: ${trimmed.slice(0, 300)}`
}
