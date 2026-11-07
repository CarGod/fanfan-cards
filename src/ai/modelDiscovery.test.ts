import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig, Settings } from '@/types/settings.ts'
import {
  DiscoveryError,
  discoverModels,
  modelDiscoveryEndpoint,
  MODEL_DISCOVERY_LIMITS,
} from './modelDiscovery.ts'

const CONFIG: ProviderConfig = { apiKey: 'test-key-only', model: '', baseUrl: '' }
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const modelList = (...ids: string[]) => json({ data: ids.map(id => ({ id })) })
const geminiModel = (id: string) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('model discovery endpoints', () => {
  it.each([
    ['openai', '', 'https://api.openai.com/v1/models'],
    ['deepseek', '', 'https://api.deepseek.com/v1/models'],
    ['mimo', '', 'https://api.xiaomimimo.com/v1/models'],
    ['claude', '', 'https://api.anthropic.com/v1/models'],
    ['gemini', '', 'https://generativelanguage.googleapis.com/v1beta/models'],
    ['openai', ' https://gateway.example/proxy/v1/chat/completions/ ', 'https://gateway.example/proxy/v1/models'],
    ['deepseek', 'https://api.deepseek.com/', 'https://api.deepseek.com/models'],
    ['mimo', 'https://gateway.example/xiaomi/v1/', 'https://gateway.example/xiaomi/v1/models'],
    ['claude', 'https://gateway.example/anthropic/', 'https://gateway.example/anthropic/v1/models'],
    ['gemini', 'https://gateway.example/google/v1/', 'https://gateway.example/google/v1/models'],
    ['custom', 'https://gateway.example/custom/chat/completions', 'https://gateway.example/custom/models'],
    ['custom', 'http://localhost:11434/v1', 'http://localhost:11434/v1/models'],
  ] as const)('matches %s generation base %s', (provider, baseUrl, expected) => {
    expect(modelDiscoveryEndpoint(provider, { ...CONFIG, baseUrl })).toBe(expected)
  })

  it.each([
    '', 'not a URL', 'javascript:alert(1)', 'http://gateway.example/v1',
    'https://user:secret@gateway.example/v1', 'https://gateway.example/v1?key=secret',
    'https://gateway.example/v1#secret', 'https://gateway.example/v1?', 'https://gateway.example/v1#',
  ])('rejects unsafe or empty custom address without a fetch: %s', async baseUrl => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels('custom', { ...CONFIG, baseUrl })).rejects.toMatchObject({ code: 'invalid_config' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is pure, independent of API key and model, and does not contact a server', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(modelDiscoveryEndpoint('openai', { ...CONFIG, apiKey: 'other-key', model: 'other-model' }))
      .toBe(modelDiscoveryEndpoint('openai', CONFIG))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('provider model-list requests', () => {
  it.each(['', '  \t  '])('fetches a custom localhost model list with blank key %j and no Authorization header', async apiKey => {
    const fetchMock = vi.fn().mockResolvedValue(modelList('local-chat-model'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await discoverModels('custom', { ...CONFIG, baseUrl: 'http://localhost:11434/v1', apiKey })
    expect(result.models).toEqual([{ id: 'local-chat-model' }])
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://localhost:11434/v1/models', expect.objectContaining({
      method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', credentials: 'omit',
    }))
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(headers.has('authorization')).toBe(false)
  })

  it.each(['openai', 'deepseek', 'mimo', 'custom'] as const)('%s uses only its current endpoint and Bearer header', async provider => {
    const fetchMock = vi.fn().mockResolvedValue(modelList('zeta-text', 'alpha-text', 'alpha-text'))
    vi.stubGlobal('fetch', fetchMock)
    const config = { ...CONFIG, apiKey: ' test-key-only ', ...(provider === 'custom' ? { baseUrl: 'https://gateway.example/v1' } : {}) }
    const start = Date.now()
    const result = await discoverModels(provider, config)
    expect(result.models).toEqual([{ id: 'alpha-text' }, { id: 'zeta-text' }])
    expect(result.fetchedAt).toBeGreaterThanOrEqual(start)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(modelDiscoveryEndpoint(provider, config), expect.objectContaining({
      method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer test-key-only' },
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
    }))
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.body).toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('test-key-only')
  })

  it('uses Claude browser headers, cursor pagination, and display names', async () => {
    const cursor = 'claude-last?query=one&two'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: 'claude-z', display_name: 'Claude Z' }], has_more: true, last_id: cursor }))
      .mockResolvedValueOnce(json({ data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: false, last_id: 'claude-a' }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await discoverModels('claude', CONFIG)).models).toEqual([
      { id: 'claude-a', name: 'Claude A' }, { id: 'claude-z', name: 'Claude Z' },
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/models?limit=1000')
    const second = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(second.origin + second.pathname).toBe('https://api.anthropic.com/v1/models')
    expect(second.searchParams.get('limit')).toBe('1000')
    expect(second.searchParams.get('after_id')).toBe(cursor)
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({
      accept: 'application/json', 'x-api-key': CONFIG.apiKey,
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    })
  })

  it('uses Gemini header auth, preserves pagination endpoint, and filters generation methods', async () => {
    const token = 'https://untrusted.example/next?token=not-an-endpoint'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ models: [
        { ...geminiModel('gemini-z'), displayName: 'Gemini Z' },
        { name: 'models/embed-model', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/unsupported-model' },
        { ...geminiModel('gemini-flash-preview-tts') },
      ], nextPageToken: token }))
      .mockResolvedValueOnce(json({ models: [geminiModel('gemini-a'), geminiModel('gemini-z')] }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await discoverModels('gemini', { ...CONFIG, baseUrl: 'https://gateway.example/google/v1beta' })).models).toEqual([
      { id: 'gemini-a' }, { id: 'gemini-z', name: 'Gemini Z' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gateway.example/google/v1beta/models?pageSize=1000')
    const second = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(second.origin + second.pathname).toBe('https://gateway.example/google/v1beta/models')
    expect(second.searchParams.get('pageToken')).toBe(token)
    expect(second.searchParams.get('pageSize')).toBe('1000')
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toEqual({ accept: 'application/json', 'x-goog-api-key': CONFIG.apiKey })
  })

  it('does not follow arbitrary next URLs or invent OpenAI-compatible pagination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ id: 'a' }], next: 'https://untrusted.example/next', has_more: true, last_id: 'a' }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await discoverModels('custom', { ...CONFIG, baseUrl: 'https://gateway.example/v1' })).models).toEqual([{ id: 'a' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps candidate text and vision models but excludes dedicated non-text families', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [
      ...['gpt-6-luna', 'unknown-text-model', 'qwen-vl', 'mimo-v2.6-flash', 'deepseek-flash',
        'text-embedding-3-small', 'whisper-1', 'tts-1-hd', 'gpt-4o-mini-transcribe',
        'mimo-v2.5-asr', 'mimo-v2.5-tts-voiceclone', 'mimo-voiceclone', 'mimo-voicedesign', 'dall-e-3', 'gpt-image-1',
        'gemini-flash-preview-image-generation', 'gpt-4o-audio-preview', 'gpt-realtime',
        'text-moderation-latest', 'reranker-v2', 'sora-2', 'imagen-3.0-generate-002', 'veo-3',
      ].map(id => ({ id })),
      { id: 'explicit-audio-output', output_modalities: ['audio'] },
      { id: 'multimodal-chat', input_modalities: ['text', 'image'], output_modalities: ['text'] },
      { id: 'bad\nmodel' }, { id: '\u0085control' }, { id: '\u202espoof' }, { id: '' }, { id: 123 }, { id: 'a'.repeat(513) }, null,
    ] })))
    const result = await discoverModels('openai', CONFIG)
    expect(result.models.map(m => m.id)).toEqual([
      'deepseek-flash', 'gpt-6-luna', 'mimo-v2.6-flash', 'multimodal-chat', 'qwen-vl', 'unknown-text-model',
    ])
    for (const model of result.models) expect(model).not.toHaveProperty('supportsJson')
  })

  it('deduplicates models without losing useful display names or exposing other metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: [
      { id: 'deepseek-flash' },
      { id: ' deepseek-flash ', name: ' DeepSeek Flash ', secret_metadata: 'ignore' },
      { id: 'deepseek-flash', name: 'Later duplicate' },
      { id: 'second', name: 'bad\nlabel' },
    ] })))
    expect((await discoverModels('deepseek', CONFIG)).models).toEqual([
      { id: 'deepseek-flash', name: 'DeepSeek Flash' }, { id: 'second' },
    ])
  })
})

describe('safe discovery failures', () => {
  it.each(['openai', 'claude', 'deepseek', 'mimo', 'gemini'] as const)('does not fetch %s with a blank key', async provider => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels(provider, { ...CONFIG, apiKey: ' ', baseUrl: 'https://gateway.example' }))
      .rejects.toMatchObject({ code: 'no_api_key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [404, 'unsupported'], [405, 'unsupported'], [500, 'http']] as const)(
    'maps HTTP %s without reading or repeating sensitive error text', async (status, code) => {
      const response = new Response('sensitive upstream body https://secret.example test-key-only', { status })
      const read = vi.spyOn(response, 'text')
      const fetchMock = vi.fn().mockResolvedValue(response)
      vi.stubGlobal('fetch', fetchMock)
      const error = await discoverModels('openai', CONFIG).catch(value => value as DiscoveryError)
      expect(error).toBeInstanceOf(DiscoveryError)
      expect(error).toMatchObject({ code, status })
      expect(JSON.stringify(error)).not.toMatch(/sensitive|secret|test-key/)
      expect(String(error)).not.toMatch(/sensitive|secret|test-key/)
      expect(read).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['{broken JSON with test-key-only', '<html>gateway response</html>', '', 'null', '[]', '{"data":{}}'])
    ('rejects malformed response %s with a fixed message', async body => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
      await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'bad_response', message: 'The provider returned an invalid model list.' })
    })

  it.each([
    { data: [] }, { data: [{ id: 'text-embedding-3-small' }] }, { data: [{ wrong: 'shape' }] },
  ])('reports an empty candidate list', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(response)))
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'empty' })
  })

  it('blocks redirects without following Location or leaking provider error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { location: 'https://untrusted.example' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'redirect' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('rejects an unexpectedly already-redirected response defensively', async () => {
    const response = modelList('a')
    Object.defineProperty(response, 'redirected', { value: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'redirect' })
  })

  it('hides network/CORS/redirect TypeError details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('https://private.example?key=test-key-only')))
    const error = await discoverModels('openai', CONFIG).catch(value => value as DiscoveryError)
    expect(error).toMatchObject({ code: 'network' })
    expect(String(error)).not.toMatch(/private|test-key/)
    expect(error).not.toHaveProperty('cause')
  })
})

describe('pagination and resource bounds', () => {
  it.each([
    ['claude', { data: [], has_more: true }],
    ['claude', { data: [], has_more: 'true', last_id: 'a' }],
    ['claude', { data: [], has_more: true, last_id: '\n' }],
    ['gemini', { models: [], nextPageToken: 12 }],
    ['gemini', { models: [], nextPageToken: 'a'.repeat(2049) }],
  ] as const)('rejects malformed %s pagination metadata', async (provider, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)))
    await expect(discoverModels(provider, CONFIG)).rejects.toMatchObject({ code: 'bad_response' })
  })

  it.each(['claude', 'gemini'] as const)('stops a repeating %s cursor instead of looping', async provider => {
    const body = provider === 'claude'
      ? { data: [{ id: 'a' }], has_more: true, last_id: 'same' }
      : { models: [geminiModel('a')], nextPageToken: 'same' }
    const fetchMock = vi.fn().mockImplementation(async () => json(body))
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels(provider, CONFIG)).rejects.toMatchObject({ code: 'bad_response' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['claude', 'gemini'] as const)('caps %s pages and does not return silent partial success', async provider => {
    let page = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      page++
      return json(provider === 'claude'
        ? { data: [{ id: `model-${page}` }], has_more: true, last_id: `cursor-${page}` }
        : { models: [geminiModel(`model-${page}`)], nextPageToken: `cursor-${page}` })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels(provider, CONFIG)).rejects.toMatchObject({ code: 'limit' })
    expect(fetchMock).toHaveBeenCalledTimes(MODEL_DISCOVERY_LIMITS.pages)
  })

  it('counts all raw records, including duplicates and excluded candidates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ data: Array.from({ length: MODEL_DISCOVERY_LIMITS.entries + 1 }, () => ({ id: 'same' })) })))
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'limit' })
  })

  it('caps records across pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: Array.from({ length: 3000 }, () => ({ id: 'a' })), has_more: true, last_id: 'a' }))
      .mockResolvedValueOnce(json({ data: Array.from({ length: 3000 }, () => ({ id: 'b' })), has_more: false }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels('claude', CONFIG)).rejects.toMatchObject({ code: 'limit' })
  })

  it('rejects an oversized Content-Length before reading bytes', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(MODEL_DISCOVERY_LIMITS.pageBytes + 1) } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'limit' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces actual streamed bytes even when Content-Length is absent or false', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MODEL_DISCOVERY_LIMITS.pageBytes + 1)) },
      cancel,
    }), { headers: { 'content-length': '1' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(discoverModels('openai', CONFIG)).rejects.toMatchObject({ code: 'limit' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('caps bytes across otherwise valid pages', async () => {
    let page = 0
    const fetchMock = vi.fn().mockImplementation(async () => json({
      data: [{ id: `model-${++page}` }], has_more: true, last_id: `cursor-${page}`,
      ignored: 'a'.repeat(MODEL_DISCOVERY_LIMITS.pageBytes - 200),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels('claude', CONFIG)).rejects.toMatchObject({ code: 'limit' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})

describe('discovery cancellation and timeouts', () => {
  it('does not fetch with an already-cancelled signal', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(discoverModels('openai', CONFIG, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'aborted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels while waiting for headers, even if the transport never settles', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const result = discoverModels('openai', CONFIG, { signal: controller.signal })
    const checked = expect(result).rejects.toMatchObject({ code: 'aborted' })
    controller.abort('sensitive caller reason')
    await checked
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true)
  })

  it.each(['headers', 'body'] as const)('times out a stalled %s without another request', async stage => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }))
    const fetchMock = vi.fn().mockImplementation(() => stage === 'headers' ? new Promise(() => {}) : Promise.resolve(response))
    vi.stubGlobal('fetch', fetchMock)
    const result = discoverModels('openai', CONFIG)
    const checked = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(MODEL_DISCOVERY_LIMITS.timeoutMs)
    await checked
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true)
    if (stage === 'body') expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels a stalled response body immediately', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    let started!: () => void
    const bodyStarted = new Promise<void>(resolve => { started = resolve })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      pull() { started() }, cancel,
    }))))
    const result = discoverModels('openai', CONFIG, { signal: controller.signal })
    const checked = expect(result).rejects.toMatchObject({ code: 'aborted' })
    await bodyStarted
    await Promise.resolve()
    controller.abort()
    await checked
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('removes caller listeners and timers after success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelList('a')))
    await discoverModels('openai', CONFIG, { signal: controller.signal })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Keep the public provider parameter aligned with the settings schema.
const _typecheckProvider: Parameters<typeof discoverModels>[0] extends keyof Settings['providers'] ? true : never = true
void _typecheckProvider
