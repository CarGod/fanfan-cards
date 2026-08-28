import type { AIProvider } from '@/types/ai.ts'
import { t } from '@/i18n/index.ts'
import { providerLabel, providerMeta, type Settings } from '@/types/settings.ts'
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
      downgradeReason: t('error.provider.no_key_offline', { provider: providerLabel(meta) }),
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
            // o 系列 / gpt-5 认 reasoning_effort。
            reasoning: 'openai',
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
            /*
             * DeepSeek 的 reasoning_effort **默认是 high**。
             * 此前一个参数都不发，等于每次查词都跑在最高推理档上——
             * 而查词恰恰是这个产品里最延迟敏感的动作。
             */
            reasoning: 'deepseek',
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
            /*
             * 自建端点什么都不发。
             *
             * 「OpenAI 兼容」是个很宽的说法：Ollama、LM Studio、各种网关都自称兼容，
             * 而它们对不认识的字段常常直接 400。为了一点加速把一个本来能用的配置
             * 弄坏，不划算。
             */
            reasoning: 'none',
          }),
        }
    }
  } catch (error) {
    return {
      provider: new MockProvider(),
      downgradeReason: t('error.provider.bad_config_offline', {
        provider: providerLabel(meta),
        reason: error instanceof Error ? error.message : String(error),
      }),
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
