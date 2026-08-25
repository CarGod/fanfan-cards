import type { AIProvider } from '@/types/ai.ts'
import { providerMeta, type Settings } from '@/types/settings.ts'
import { ClaudeProvider } from './providers/claude.ts'
import { GeminiProvider } from './providers/gemini.ts'
import { MockProvider } from './providers/mock.ts'
import { OpenAICompatibleProvider } from './providers/openaiCompatible.ts'

export interface ResolvedProvider {
  provider: AIProvider
  /** Set when we silently downgraded to the offline provider. */
  downgradeReason?: string
}

/**
 * The one place that turns settings into a provider.
 *
 * Never throws: an unconfigured or broken provider config downgrades to the
 * offline dictionary, because the user is mid-sentence and wants *something*.
 * The reason is returned so the UI can nudge them to the settings page.
 */
export function resolveProvider(settings: Settings): ResolvedProvider {
  const meta = providerMeta(settings.provider)

  if (settings.provider === 'mock') return { provider: new MockProvider() }

  const config = settings.providers[settings.provider]
  const apiKey = config.apiKey.trim()
  const model = config.model.trim() || meta.defaultModel
  const baseUrl = config.baseUrl.trim() || meta.defaultBaseUrl

  if (meta.requiresKey && !apiKey) {
    return {
      provider: new MockProvider(),
      downgradeReason: `${meta.label} 尚未填写 API Key，已使用离线词典`,
    }
  }

  try {
    switch (settings.provider) {
      case 'claude':
        return { provider: new ClaudeProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) }) }
      case 'gemini':
        return { provider: new GeminiProvider({ apiKey, model, baseUrl }) }
      case 'openai':
        return {
          provider: new OpenAICompatibleProvider({
            id: 'openai',
            label: meta.label,
            apiKey,
            model,
            baseUrl,
            structuredOutput: 'json_schema',
          }),
        }
      case 'deepseek':
        return {
          provider: new OpenAICompatibleProvider({
            id: 'deepseek',
            label: meta.label,
            apiKey,
            model,
            baseUrl,
            // DeepSeek implements `json_object` but not `json_schema`.
            structuredOutput: 'json_object',
          }),
        }
      case 'custom':
        return {
          provider: new OpenAICompatibleProvider({
            id: 'custom',
            label: meta.label,
            apiKey,
            model,
            baseUrl,
            structuredOutput: 'json_object',
          }),
        }
    }
  } catch (error) {
    return {
      provider: new MockProvider(),
      downgradeReason: `${meta.label} 配置有误（${error instanceof Error ? error.message : String(error)}），已使用离线词典`,
    }
  }
}

export function offlineProvider(): AIProvider {
  return new MockProvider()
}

export { MockProvider } from './providers/mock.ts'
export { ClaudeProvider } from './providers/claude.ts'
export { GeminiProvider } from './providers/gemini.ts'
export { OpenAICompatibleProvider } from './providers/openaiCompatible.ts'
export * from './schema.ts'
export * from './prompts.ts'
export { extractJson } from './json.ts'
