import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import type { ThinkingLevel } from '@/types/ai.ts'
import { resolveProvider } from '../index.ts'
import { OpenAICompatibleProvider } from './openaiCompatible.ts'
import { applyOpenAIParameters } from './openaiParameters.ts'

afterEach(() => vi.unstubAllGlobals())

function parameters(model: string, level?: ThinkingLevel) {
  const body: Record<string, unknown> = { model, max_tokens: 4000, temperature: 0.2 }
  applyOpenAIParameters(body, level)
  return body
}

describe('official OpenAI model parameters', () => {
  it.each(['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-terra', 'gpt-5.1', 'gpt-5.2', 'gpt-5.6-sol', 'gpt-6-luna-2026-10-01'])(
    '%s can disable reasoning without sending deprecated max_tokens', model => {
      const body = parameters(model, 'off')
      expect(body).toEqual({ model, max_completion_tokens: 4000, temperature: 0.2, reasoning_effort: 'none' })
    },
  )

  it.each(['low', 'high'] as const)('Luna %s reasoning excludes incompatible sampling', level => {
    expect(parameters('gpt-6-luna', level)).toEqual({
      model: 'gpt-6-luna', max_completion_tokens: 4000, reasoning_effort: level,
    })
  })

  it('omitted effort is not treated as disabled reasoning', () => {
    expect(parameters('gpt-6-luna')).toEqual({ model: 'gpt-6-luna', max_completion_tokens: 4000 })
  })

  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'o3', 'o4-mini'])('%s falls back to low when off is unavailable', model => {
    expect(parameters(model, 'off')).toEqual({ model, max_completion_tokens: 4000, reasoning_effort: 'low' })
  })

  it.each(['gpt-5', 'gpt-5-mini', 'gpt-5-nano'])('uses minimal for %s rather than inventing none', model => {
    expect(parameters(model, 'off')).toEqual({ model, max_completion_tokens: 4000, reasoning_effort: 'minimal' })
  })

  it.each(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano-2025-04-14', 'gpt-3.5-turbo'])(
    '%s never receives reasoning_effort', model => {
      for (const level of ['off', 'low', 'high', undefined] as const) {
        expect(parameters(model, level)).toEqual({ model, max_tokens: 4000, temperature: 0.2 })
      }
    },
  )

  it.each(['gpt-6-luna-pro', 'gpt-6-luna-chat-latest', 'gpt-6.9-new', 'unknown-model', 'constructor', '__proto__'])(
    '%s does not inherit unverified effort/sampling support', model => {
      expect(parameters(model, 'off')).toEqual({ model, max_completion_tokens: 4000 })
    },
  )
})

const ANSWERS: Record<string, object> = {
  word_explanation: { word: 'hello', meaning: '你好', contextMeaning: '问候' },
  translation: { translation: '你好' },
  batch_translation: { translations: ['你好'] },
  example_sentence: { sentence: 'Hello, friend.', translation: '你好，朋友。' },
  summary: { summary: '问候', keyTerms: ['hello'] },
  transcript: { original: 'Hello', translation: '你好' },
}

function captureRequests() {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    requests.push(body)
    const name = body.response_format?.json_schema?.name ?? 'translation'
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ANSWERS[name]) } }] }))
  })
  return requests
}

describe('OpenAI wire requests', () => {
  it.each(['off', 'low', 'high'] as const)('resolves saved Luna %s settings into the real request', async thinkingLevel => {
    const requests = captureRequests()
    const { provider } = resolveProvider({
      ...DEFAULT_SETTINGS, provider: 'openai', thinkingLevel,
      providers: { ...DEFAULT_SETTINGS.providers, openai: { apiKey: 'test-key', model: 'gpt-6-luna', baseUrl: '' } },
    })
    await provider.translate({ text: 'Hello', targetLanguage: 'zh-CN' })
    expect(requests[0]).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 4000, reasoning_effort: thinkingLevel === 'off' ? 'none' : thinkingLevel })
    expect(requests[0]).not.toHaveProperty('max_tokens')
    expect(requests[0]?.temperature).toBe(thinkingLevel === 'off' ? 0.2 : undefined)
  })

  it('applies the fix to every shared operation while preserving budgets and strict schemas', async () => {
    const requests = captureRequests()
    const provider = new OpenAICompatibleProvider({
      id: 'openai', label: 'OpenAI', apiKey: 'test-key', model: 'gpt-6-luna',
      baseUrl: 'https://api.openai.com/v1', structuredOutput: 'json_schema', reasoning: 'openai', thinkingLevel: 'off',
    })
    await provider.explainWord({ text: 'hello', context: 'Hello, friend.', thinkingLevel: 'high' })
    await provider.translate({ text: 'Hello', targetLanguage: 'zh-CN' })
    await provider.translateBatch({ texts: ['Hello'], targetLanguage: 'zh-CN' })
    await provider.generateExample({ word: 'hello' })
    await provider.summarize({ text: 'Hello, friend.' })
    await provider.refineTranscript({ text: 'Hello', context: '', title: '', targetLanguage: 'zh-CN' })
    expect(requests.map(r => r.max_completion_tokens)).toEqual([4000, 4000, 8000, 1500, 2000, 2200])
    for (const request of requests) {
      expect(request).not.toHaveProperty('max_tokens')
      expect(request).toMatchObject({ reasoning_effort: 'none', temperature: 0.2, response_format: { type: 'json_schema', json_schema: { strict: true } } })
    }
  })

  it('honors per-lookup effort when no provider-wide level was supplied', async () => {
    const requests = captureRequests()
    const provider = new OpenAICompatibleProvider({
      id: 'openai', label: 'OpenAI', apiKey: 'test-key', model: 'gpt-6-luna',
      baseUrl: 'https://api.openai.com/v1', structuredOutput: 'json_schema', reasoning: 'openai',
    })
    await provider.explainWord({ text: 'hello', context: 'Hello.', thinkingLevel: 'high' })
    expect(requests[0]?.reasoning_effort).toBe('high')
    expect(requests[0]).not.toHaveProperty('temperature')
  })

  it.each(['https://gateway.example/v1', 'https://api.openai.com.example/v1'])(
    'does not apply official model rules to gateway %s', async baseUrl => {
      const requests = captureRequests()
      const { provider } = resolveProvider({
        ...DEFAULT_SETTINGS, provider: 'openai', thinkingLevel: 'off',
        providers: { ...DEFAULT_SETTINGS.providers, openai: { apiKey: 'test-key', model: 'gpt-6-luna', baseUrl } },
      })
      await provider.translate({ text: 'Hello', targetLanguage: 'zh-CN' })
      expect(requests[0]).toMatchObject({ max_tokens: 4000, temperature: 0.2 })
      expect(requests[0]).not.toHaveProperty('max_completion_tokens')
      expect(requests[0]).not.toHaveProperty('reasoning_effort')
    },
  )
})
