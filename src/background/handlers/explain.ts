import { resolveProvider } from '@/ai/index.ts'
import { MockProvider } from '@/ai/providers/mock.ts'
import { PROMPT_VERSION } from '@/ai/prompts.ts'
import { dateKey } from '@/shared/utils.ts'
import { bumpActivity } from '@/storage/repositories/activityRepo.ts'
import { cacheKey, readCache, writeCache } from '@/storage/repositories/cacheRepo.ts'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

/**
 * The hot path of the whole product.
 *
 * Order matters: settings -> provider -> cache -> model. Cache lookup happens
 * *after* the provider is known because the same word in the same sentence can
 * legitimately get a different answer from a different model, and a user who
 * upgrades from the offline dictionary to a real one must not keep seeing the
 * old placeholder answer.
 */
export async function handleExplain(
  payload: MessageRequest<'ai/explain'>,
): Promise<MessageResponse<'ai/explain'>> {
  const settings = await getSettings()
  const resolved = payload.forceOffline
    ? { provider: new MockProvider(), downgradeReason: undefined }
    : resolveProvider(settings)
  const provider = resolved.provider

  const text = payload.text.slice(0, settings.maxSelectionLength)
  const languages = { source: settings.sourceLanguage, target: settings.targetLanguage }
  const detail = payload.detail ?? 'full'
  const key = cacheKey({
    providerId: provider.id,
    model: provider.model,
    // Language pair is part of the identity of an answer: switching target
    // language must not keep serving the previous language's explanation.
    /*
     * 思考档位进 key。
     *
     * 它决定的是答案本身有多深——读者把它从 low 调到 high，期待的是更好的解释，
     * 而不是把之前那条低档答案再看一遍。
     */
    promptVersion: `${PROMPT_VERSION}/${languages.source}>${languages.target}/${detail}/ex${settings.exampleCount}/t${settings.thinkingLevel}`,
    text,
    context: payload.context,
  })

  const cached = payload.refresh ? null : await readCache(key, settings.cacheTtlHours, detail)
  if (cached) {
    return {
      explanation: cached,
      providerId: provider.id,
      model: provider.model,
      offline: provider.offline,
      cached: true,
      ...(resolved.downgradeReason ? { downgradeReason: resolved.downgradeReason } : {}),
    }
  }

  const explanation = await provider.explainWord({
    ...payload,
    text,
    languages,
    detail,
    exampleCount: settings.exampleCount,
    thinkingLevel: settings.thinkingLevel,
  })

  await Promise.all([
    writeCache(key, explanation, detail),
    // Only the first phase is a lookup; counting both would double the stat.
    detail === 'extras' ? Promise.resolve() : bumpActivity(dateKey(), { lookups: 1 }),
  ])

  return {
    explanation,
    providerId: provider.id,
    model: provider.model,
    offline: provider.offline,
    cached: false,
    ...(resolved.downgradeReason ? { downgradeReason: resolved.downgradeReason } : {}),
  }
}
