import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveProvider } from './index.ts'
import { t } from '@/i18n/index.ts'
import { DEFAULT_SETTINGS, providerMeta, type Settings } from '@/types/settings.ts'

function settingsFor(provider: Settings['provider'], patch: Partial<{ apiKey: string; model: string; baseUrl: string }> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    provider,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(provider === 'mock' || provider === 'google'
        ? {}
        : { [provider]: { apiKey: 'k', model: '', baseUrl: '', ...patch } }),
    } as Settings['providers'],
  }
}

describe('resolveProvider', () => {
  // "I left the model and API address blank, is that broken?" — no, and this
  // test is what guarantees it stays that way.
  it('falls back to the catalogue defaults when model and base URL are blank', () => {
    for (const id of ['deepseek', 'mimo', 'openai', 'gemini'] as const) {
      const { provider, downgradeReason } = resolveProvider(settingsFor(id))
      expect(downgradeReason, `${id} should not downgrade`).toBeUndefined()
      expect(provider.id).toBe(id)
      expect(provider.model).toBe(providerMeta(id).defaultModel)
    }
  })

  it('uses an explicit model when one is given', () => {
    const { provider } = resolveProvider(settingsFor('deepseek', { model: 'deepseek-v4-pro' }))
    expect(provider.model).toBe('deepseek-v4-pro')
  })

  // A missing key must never surface as a crash mid-reading.
  //
  // 比的是 `t()` 的返回值而不是写死的中文片段：这条消息现在有中英两版，断言任何
  // 一版的字面量都会在另一种界面语言下变成假失败。这样写还顺带把「用了哪个键、
  // 填了哪个占位符」也一起断言了，比原来的 `toContain('API Key')` 更严。
  it('downgrades to the free translator instead of throwing when the key is missing', () => {
    const { provider, downgradeReason } = resolveProvider(settingsFor('deepseek', { apiKey: '' }))
    expect(provider.id).toBe('google')
    expect(provider.contextual).toBe(false)
    expect(downgradeReason).toBe(
      t('error.provider.no_key_free', { provider: providerMeta('deepseek').label }),
    )
  })

  it('uses the free translator as the zero-setup default', () => {
    const { provider, downgradeReason } = resolveProvider(DEFAULT_SETTINGS)
    expect(provider.id).toBe('google')
    expect(downgradeReason).toBeUndefined()
  })

  it('treats OpenAI with a gateway endpoint as the same provider, not a downgrade', () => {
    const { provider, downgradeReason } = resolveProvider(
      settingsFor('openai', { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-pro' }),
    )
    expect(downgradeReason).toBeUndefined()
    expect(provider.id).toBe('openai')
    expect(provider.model).toBe('mimo-v2.6-pro')
  })

  it('never throws for a provider that needs a base URL it does not have', () => {
    const { provider, downgradeReason } = resolveProvider(settingsFor('custom'))
    expect(provider.id).toBe('google')
    expect(downgradeReason).toBeTruthy()
  })
})


afterEach(() => vi.unstubAllGlobals())

it('honors configured thinking for translation only on recognized endpoints', async () => {
  for (const [id, baseUrl, disabled] of [
    ['deepseek', '', true],
    ['mimo', '', true],
    ['openai', 'https://api.xiaomimimo.com/v1', true],
    ['openai', 'https://api.xiaomimimo.com.example.test/v1', false],
    ['openai', 'https://other.example/v1', false],
  ] as const) {
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)))
      const content = '{"translation":"你好","translations":["你好"]}'
      if (JSON.parse(String(init.body)).stream) return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    const { provider } = resolveProvider({ ...settingsFor(id, { baseUrl }), thinkingLevel: 'off' })
    await provider.translate({ text: 'hello', targetLanguage: 'zh-CN' })
    await provider.translateBatch!({ texts: ['hello'], targetLanguage: 'zh-CN' })
    for (const request of requests) {
      expect(request['thinking']).toEqual(disabled ? { type: 'disabled' } : undefined)
      expect(request['reasoning_effort']).toBeUndefined()
      expect(request['stream']).toBe(disabled ? true : undefined)
    }
  }
})


it.each(['off', 'low', 'high'] as const)('uses saved %s thinking for every MiMo operation', async thinkingLevel => {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)))
    const content = JSON.stringify(requests.length === 3 ? { original: 'Hello', translation: '你好' } : requests.length === 2 ? { translations: ['你好'] } : { translation: '你好' })
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  const { provider } = resolveProvider({ ...settingsFor('mimo'), thinkingLevel })
  await provider.translate({ text: 'hello', targetLanguage: 'zh-CN' })
  await provider.translateBatch({ texts: ['hello'], targetLanguage: 'zh-CN' })
  await provider.refineTranscript!({ text: 'Hello', targetLanguage: 'zh-CN', context: '', title: '' })
  expect(requests).toHaveLength(3)
  for (const request of requests) expect(request.thinking).toEqual({ type: thinkingLevel === 'off' ? 'disabled' : 'enabled' })
})
