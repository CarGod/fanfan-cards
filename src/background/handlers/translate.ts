import { resolveProvider } from '@/ai/index.ts'
import { PROMPT_VERSION } from '@/ai/prompts.ts'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  readTranslations,
  translationKey,
  writeTranslations,
} from '@/storage/repositories/translationCacheRepo.ts'
import { targetLanguage } from '@/shared/language.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

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
  const target = targetLanguage(settings.targetLanguage)

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
  const misses = payload.texts
    .map((text, index) => ({ text, index }))
    .filter((item) => cached[item.index] === null)

  if (misses.length === 0) {
    return { translations: cached.map((value) => value ?? '') }
  }

  const fresh = await provider.translateBatch({
    texts: misses.map((item) => item.text),
    targetLanguage: target.name,
    ...(payload.hint ? { hint: payload.hint } : {}),
  })

  const translations = [...cached]
  const toCache: Array<[string, string]> = []
  misses.forEach((item, position) => {
    const value = fresh[position] ?? ''
    translations[item.index] = value
    const key = keys[item.index]
    if (key) toCache.push([key, value])
  })

  await writeTranslations(toCache)
  return { translations: translations.map((value) => value ?? '') }
}
