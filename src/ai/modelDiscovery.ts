import type { ProviderConfig, Settings } from '@/types/settings.ts'
import { normalizeBaseUrl } from './providers/openaiCompatible.ts'

type DiscoveryProvider = keyof Settings['providers']

export interface DiscoveredModel {
  id: string
  name?: string
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[]
  fetchedAt: number
}

const ERROR_MESSAGES = {
  invalid_config: 'The model-list API address is invalid.',
  no_api_key: 'An API key is required to fetch models.',
  auth: 'The provider rejected the API key or access to its model list.',
  rate_limit: 'The provider is rate limiting model-list requests. Try again later.',
  unsupported: 'This endpoint does not provide a compatible model list.',
  http: 'The provider could not return its model list.',
  network: 'The model list could not be fetched. Check network and API access.',
  timeout: 'Fetching the model list timed out.',
  aborted: 'Fetching the model list was cancelled.',
  bad_response: 'The provider returned an invalid model list.',
  empty: 'No candidate text models were found.',
  limit: 'The model list exceeded the safety limit.',
  redirect: 'Model-list redirects are not allowed.',
} as const

export type DiscoveryErrorCode = keyof typeof ERROR_MESSAGES

/** Never retain a response body, request URL, credential, or upstream error. */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode
  readonly status: number | undefined

  constructor(code: DiscoveryErrorCode, status?: number) {
    super(ERROR_MESSAGES[code])
    this.name = 'DiscoveryError'
    this.code = code
    this.status = status
  }
}

export const MODEL_DISCOVERY_LIMITS = {
  timeoutMs: 20_000,
  pages: 10,
  entries: 5_000,
  pageBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
} as const

const DEFAULT_BASES: Record<DiscoveryProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  mimo: 'https://api.xiaomimimo.com/v1',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  custom: '',
}

/**
 * Match the corresponding generation provider's base-path convention. In
 * particular, an Anthropic SDK base is a root (it appends /v1), while Gemini
 * bases already include their version. Never probe another host or path.
 * This pure helper is also useful for isolating the settings page's cache.
 */
export function modelDiscoveryEndpoint(provider: DiscoveryProvider, config: ProviderConfig): string {
  const raw = config.baseUrl.trim() || DEFAULT_BASES[provider]
  if (!raw) throw new DiscoveryError('invalid_config')
  const base = provider === 'claude' || provider === 'gemini'
    ? raw.replace(/\/+$/, '')
    : normalizeBaseUrl(raw)
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new DiscoveryError('invalid_config')
  }
  // Match optionalApiOrigin, and never put credentials into a URL or inherit
  // hidden query/fragment parameters from a pasted address.
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
    || url.username || url.password || raw.includes('?') || raw.includes('#')) {
    throw new DiscoveryError('invalid_config')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${provider === 'claude' ? '/v1/models' : '/models'}`
  return url.href
}

function headersFor(provider: DiscoveryProvider, key: string): Record<string, string> {
  if (provider === 'claude') {
    return {
      accept: 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  if (provider === 'gemini') return { accept: 'application/json', 'x-goog-api-key': key }
  // MiMo supports Bearer as well as api-key; match its generation transport.
  // A custom/local gateway can expose its list without authentication.
  return { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }
}

/**
 * Fetch only on an explicit settings-page action. The caller obtains any host
 * permission before calling; this module neither reads storage nor retries.
 * A model's presence is not a claim that it supports strict JSON or every
 * generation feature. Keep unknown text candidates, excluding clear mismatches.
 *
 * Official contracts:
 * https://developers.openai.com/api/reference/resources/models/methods/list
 * https://platform.claude.com/docs/en/api/models/list
 * https://api-docs.deepseek.com/api/list-models/
 * https://ai.google.dev/api/models
 * https://mimo.mi.com/docs/en-US/api/model/list-models-get
 */
export async function discoverModels(
  provider: DiscoveryProvider,
  config: ProviderConfig,
  options: { signal?: AbortSignal } = {},
): Promise<ModelDiscoveryResult> {
  if (options.signal?.aborted) throw new DiscoveryError('aborted')
  const endpoint = modelDiscoveryEndpoint(provider, config)
  const key = config.apiKey.trim()
  if (!key && provider !== 'custom') throw new DiscoveryError('no_api_key')

  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, MODEL_DISCOVERY_LIMITS.timeoutMs)

  try {
    const models = new Map<string, DiscoveredModel>()
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    let entries = 0
    let totalBytes = 0
    for (let page = 0; page < MODEL_DISCOVERY_LIMITS.pages; page++) {
      // Tokens are data, never URLs. Every page uses the original endpoint.
      const url = new URL(endpoint)
      if (provider === 'claude') {
        url.searchParams.set('limit', '1000')
        if (cursor) url.searchParams.set('after_id', cursor)
      } else if (provider === 'gemini') {
        url.searchParams.set('pageSize', '1000')
        if (cursor) url.searchParams.set('pageToken', cursor)
      }
      const response = await abortable(fetch(url.href, {
        method: 'GET',
        headers: headersFor(provider, key),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }), controller.signal)
      if (response.redirected || response.type === 'opaqueredirect'
        || (response.status >= 300 && response.status < 400)) {
        discardBody(response)
        throw new DiscoveryError('redirect')
      }
      if (!response.ok) {
        discardBody(response)
        const status = response.status
        throw new DiscoveryError(
          status === 401 || status === 403 ? 'auth'
            : status === 429 ? 'rate_limit'
              : status === 404 || status === 405 ? 'unsupported' : 'http', status,
        )
      }
      const parsed = await readBoundedJson(response, controller.signal, MODEL_DISCOVERY_LIMITS.totalBytes - totalBytes)
      totalBytes += parsed.bytes
      const body = record(parsed.value)
      const items = body?.[provider === 'gemini' ? 'models' : 'data']
      if (!Array.isArray(items)) throw new DiscoveryError('bad_response')
      entries += items.length
      if (entries > MODEL_DISCOVERY_LIMITS.entries) throw new DiscoveryError('limit')
      for (const item of items) {
        const model = candidateModel(provider, item)
        if (model && (!models.has(model.id) || (!models.get(model.id)?.name && model.name))) {
          models.set(model.id, model)
        }
      }
      cursor = nextCursor(provider, body!)
      if (!cursor) {
        if (!models.size) throw new DiscoveryError('empty')
        return { models: [...models.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), fetchedAt: Date.now() }
      }
      if (seenCursors.has(cursor)) throw new DiscoveryError('bad_response')
      seenCursors.add(cursor)
    }
    // Do not present a silently truncated list as a successful complete list.
    throw new DiscoveryError('limit')
  } catch (error) {
    if (controller.signal.aborted) throw new DiscoveryError(timedOut ? 'timeout' : 'aborted')
    if (error instanceof DiscoveryError) throw error
    // Fetch deliberately hides redirects/CORS details. Never echo its message.
    throw new DiscoveryError('network')
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) return undefined
  return value.trim() || undefined
}

function candidateModel(provider: DiscoveryProvider, value: unknown): DiscoveredModel | undefined {
  const item = record(value)
  if (!item) return undefined
  if (provider === 'gemini' && (!Array.isArray(item['supportedGenerationMethods'])
    || !item['supportedGenerationMethods'].includes('generateContent'))) return undefined
  const rawId = safeText(item[provider === 'gemini' ? 'name' : 'id'], 512)
  const id = provider === 'gemini' ? rawId?.replace(/^models\//, '') : rawId
  if (!id || /\s/.test(id)) return undefined

  // Input image/audio support is useful and is not grounds for exclusion.
  // Explicit non-text outputs and dedicated non-chat families are mismatches.
  const outputs = item['output_modalities']
  if (Array.isArray(outputs) && outputs.length > 0 && outputs.every(x => typeof x === 'string')
    && !outputs.includes('text')) return undefined
  if (/(?:^|[\/:_.-])(?:embeddings?|rerank(?:er)?|moderation|whisper|tts|asr|voiceclone|voicedesign|transcrib(?:e|ing|er)|transcription|speech|audio|realtime|image(?:gen)?|imagen|dall-e|sora|veo)(?:[\/:_.-]|$)/i.test(id)) return undefined
  const name = safeText(item[provider === 'gemini' ? 'displayName' : provider === 'claude' ? 'display_name' : 'name'], 200)
  return name && name !== id ? { id, name } : { id }
}

function nextCursor(provider: DiscoveryProvider, body: Record<string, unknown>): string | undefined {
  if (provider === 'claude') {
    if (body['has_more'] !== undefined && typeof body['has_more'] !== 'boolean') throw new DiscoveryError('bad_response')
    if (body['has_more'] !== true) return undefined
    const cursor = safeText(body['last_id'], 2048)
    if (!cursor) throw new DiscoveryError('bad_response')
    return cursor
  }
  if (provider === 'gemini') {
    const raw = body['nextPageToken']
    if (raw === undefined || raw === '') return undefined
    const cursor = safeText(raw, 2048)
    if (!cursor) throw new DiscoveryError('bad_response')
    return cursor
  }
  return undefined
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

/** Abort both a stalled header request and a stalled body reader promptly. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DiscoveryError('aborted'))
    if (signal.aborted) {
      operation.catch(() => {})
      aborted()
      return
    }
    signal.addEventListener('abort', aborted, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

async function readBoundedJson(response: Response, signal: AbortSignal, remainingBytes: number): Promise<{ value: unknown; bytes: number }> {
  const limit = Math.min(MODEL_DISCOVERY_LIMITS.pageBytes, remainingBytes)
  if (Number(response.headers.get('content-length')) > limit) {
    discardBody(response)
    throw new DiscoveryError('limit')
  }
  if (!response.body) throw new DiscoveryError('bad_response')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let done = false
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal)
      if (chunk.done) {
        done = true
        break
      }
      bytes += chunk.value.byteLength
      if (bytes > limit) throw new DiscoveryError('limit')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    try {
      return { value: JSON.parse(text) as unknown, bytes }
    } catch {
      throw new DiscoveryError('bad_response')
    }
  } finally {
    if (!done) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
