import type { Settings } from '@/types/settings.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * 这张词卡还缺什么。
 *
 * 放在共用的地方，是因为它有两个调用方：内容脚本在发请求**之前**先判一次
 * （好把界面切成「补充中」，省掉一次往返的空白），后台在真的要花钱之前再判一次。
 * 两边各写一份的结局是其中一份先学会看设置、另一份还在只看字段空不空，
 * 而那种走散的表现是「界面转圈，后台什么也没做」。
 *
 * **空 ≠ 缺。** 这是这个函数存在的全部理由：有些字段按设计就该是空的，
 * 把它们当成缺，就会永远补不完——每换一个页面点开都发一次注定落空的请求。
 */
export function missingFields(
  entry: VocabularyEntry,
  settings: Pick<Settings, 'exampleCount'>,
): string[] {
  const missing: string[] = []

  if (!entry.sentenceTranslation?.trim()) missing.push('sentenceTranslation')

  /*
   * 整句卡没有例句和近义词，这是提示词里写死的
   * （prompts.ts：「examples 与 synonyms 返回空数组，它们对整句没有意义」）。
   * 一整句话的「近义词」本来也不是个有意义的东西。
   */
  if (entry.kind === 'sentence') return missing

  /*
   * 读者把例句关了（设置里「不要例句」），那没有例句就是**对的**，不是缺。
   * 这条不看设置的话，他的每一张卡都会被永远判成缺——而他恰恰是那个
   * 明确说过「我不要这个」的人。
   */
  if (settings.exampleCount > 0 && !entry.examples?.length) missing.push('examples')

  if (!entry.synonyms?.length) missing.push('synonyms')

  return missing
}

/** 值不值得为这张卡发一次请求。 */
export function needsEnriching(
  entry: VocabularyEntry,
  settings: Pick<Settings, 'exampleCount'>,
): boolean {
  // 没有当初那句原文就补不了——第二段要的正是「这个词在那一句里」。
  if (!entry.source?.context) return false
  return missingFields(entry, settings).length > 0
}
