import { isPhrase } from '@/shared/utils.ts'
import { findByAnyWord, removeEntry, saveEntry } from '@/storage/repositories/vocabularyRepo.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

export async function handleSaveWord(
  payload: MessageRequest<'vocab/save'>,
): Promise<MessageResponse<'vocab/save'>> {
  const { selection, explanation, source, origin } = payload

  return saveEntry({
    // The book should record what the reader saw, not the model's normalisation.
    word: selection.trim() || explanation.word,
    lemma: explanation.lemma,
    kind: explanation.kind === 'phrase' || isPhrase(explanation.word) ? 'phrase' : 'word',
    phonetic: explanation.phonetic,
    partOfSpeech: explanation.partOfSpeech,
    cefr: explanation.cefr,
    meaning: explanation.meaning,
    // 老模型/离线词典给不出结构化释义，那就是空数组——不去解析 meaning 反推。
    senses: explanation.senses ?? [],
    aiExplanation: explanation.contextMeaning,
    englishDefinition: explanation.englishDefinition,
    sentenceTranslation: explanation.sentenceTranslation,
    examples: explanation.examples,
    synonyms: explanation.synonyms,
    source,
    origin,
  })
}

export async function handleLookupWord(
  payload: MessageRequest<'vocab/lookup'>,
): Promise<MessageResponse<'vocab/lookup'>> {
  return { entry: await findByAnyWord(payload.words) }
}

export async function handleRemoveWord(
  payload: MessageRequest<'vocab/remove'>,
): Promise<MessageResponse<'vocab/remove'>> {
  return { removed: await removeEntry(payload.id) }
}
