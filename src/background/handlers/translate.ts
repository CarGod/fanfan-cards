import { resolveProvider } from '@/ai/index.ts'
import { PROMPT_VERSION } from '@/ai/prompts.ts'
import { AIError } from '@/types/ai.ts'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  readTranslations,
  translationKey,
  writeTranslations,
} from '@/storage/repositories/translationCacheRepo.ts'
import { isRedundantTranslation, repairOmissions, targetLanguage } from '@/shared/language.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

/**
 * Translate the contents of an editable field after the three-spaces gesture.
 *
 * Unlike page translation this uses the provider's single-text endpoint: an
 * input may be a complete draft, so preserving it as one unit gives the model
 * the context it needs. It still shares the translation cache with page mode;
 * same provider, model, target and source text mean the desired output is the
 * same, regardless of which gesture asked for it.
 */
export async function handleTranslateInput(
  payload: MessageRequest<'input/translate'>,
): Promise<MessageResponse<'input/translate'>> {
  const settings = await getSettings()
  const targetCode =
    settings.inputTranslationTargetLanguage === 'follow'
      ? settings.targetLanguage
      : settings.inputTranslationTargetLanguage
  const target = targetLanguage(targetCode)
  const { provider, downgradeReason } = resolveProvider(settings)

  // The offline dictionary can explain a known word, but it cannot honestly
  // translate an arbitrary draft. Never replace the user's text with its
  // diagnostic "[offline] ..." placeholder.
  if (provider.offline) {
    throw new AIError(
      'no_api_key',
      downgradeReason ?? 'Input translation requires a configured model',
      provider.id,
    )
  }

  const text = payload.text.trim()
  if (!text) return { translation: '', targetLanguage: target.code }

  const key = translationKey({
    providerId: provider.id,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    target: target.code,
    text,
  })
  const [cached] = await readTranslations([key])
  if (cached !== null && cached !== undefined) {
    return { translation: cached, targetLanguage: target.code }
  }

  const result = await provider.translate({ text, targetLanguage: target.name })
  const translation = repairOmissions(text, result.translation).trim()
  if (!translation) {
    throw new AIError('bad_response', 'The model returned an empty translation', provider.id)
  }

  await writeTranslations([[key, translation]])
  return { translation, targetLanguage: target.code }
}

/**
 * Batch translation for whole-page mode.
 *
 * Cached per segment rather than per request: toggling translation off and on,
 * re-opening an article, or scrolling back up must not re-pay for text that was
 * already translated. Segments are the right unit because the key is the text
 * itself — the same paragraph on two different pages hits the same entry.
 */
export async function handleTranslatePage(
  payload: MessageRequest<'page/translate'>,
): Promise<MessageResponse<'page/translate'>> {
  const settings = await getSettings()
  const { provider } = resolveProvider(settings)
  const target = targetLanguage(payload.targetLanguage ?? settings.targetLanguage)

  const keys = payload.texts.map((text) =>
    translationKey({
      providerId: provider.id,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      target: target.code,
      text,
    }),
  )

  const cached = await readTranslations(keys)
  /*
   * Validate cache hits with the same rule used at insertion time. Older runs
   * may have cached a model's empty/source-echo response; treating that as a
   * hit makes the hole survive every toggle until the cache expires.
   */
  const translations: Array<string | null> = cached.map((value, index) =>
    usableTranslation(payload.texts[index] ?? '', value),
  )
  const misses = payload.texts
    .map((text, index) => ({ text, index }))
    .filter((item) => translations[item.index] === null)

  if (misses.length === 0) {
    return { translations: translations.map((value) => value ?? '') }
  }

  const fresh = await provider.translateBatch({
    texts: misses.map((item) => item.text),
    targetLanguage: target.name,
    ...(payload.hint ? { hint: payload.hint } : {}),
  })

  const toCache: Array<[string, string]> = []
  const unresolved: Array<{ text: string; index: number }> = []
  misses.forEach((item, position) => {
    const value = usableTranslation(item.text, fresh[position] ?? null)
    translations[item.index] = value
    const key = keys[item.index]
    if (key && value) toCache.push([key, value])
    else unresolved.push(item)
  })

  /*
   * A missing member in a model array is not allowed to shift every following
   * paragraph. Retry only the unresolved sources one at a time: a one-item
   * response has no positional ambiguity and this extra cost occurs only after
   * the provider has already broken the batch contract.
   */
  for (const item of unresolved) {
    try {
      const [raw] = await provider.translateBatch({
        texts: [item.text],
        targetLanguage: target.name,
        ...(payload.hint ? { hint: payload.hint } : {}),
      })
      const value = usableTranslation(item.text, raw ?? null)
      translations[item.index] = value
      const key = keys[item.index]
      if (key && value) toCache.push([key, value])
    } catch (error) {
      // Preserve valid members of the original batch. The content-side bounded
      // retry gets one more chance without turning one failed fallback into a
      // failure for every paragraph that was already translated correctly.
      console.warn('[fanfan] individual page-translation retry failed:', error)
    }
  }

  await writeTranslations(toCache)
  return { translations: translations.map((value) => value ?? '') }
}

function usableTranslation(source: string, value: string | null): string | null {
  if (value === null) return null
  const repaired = repairOmissions(source, value).trim()
  if (!repaired || isRedundantTranslation(source, repaired)) return null
  return repaired
}
