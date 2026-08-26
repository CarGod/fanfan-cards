import { classifySelection, truncate } from '@/shared/utils.ts'
import {
  DEFAULT_SOURCE,
  DEFAULT_TARGET,
  isChineseTarget,
  sourceLanguage,
  targetLanguage,
} from '@/shared/language.ts'
import type {
  ExplainWordInput,
  GenerateExampleInput,
  LanguagePair,
  SummarizeInput,
  TranslateInput,
} from '@/types/ai.ts'

/**
 * Prompts live in one file, shared by every provider.
 *
 * The product thesis is encoded here: a dictionary tells you what a word means,
 * this tells you what it means *in the sentence the user is looking at*. If the
 * contextual reading is identical to the dictionary reading, the model must say
 * so plainly instead of inventing a distinction.
 */

/**
 * Bump on any meaningful prompt change.
 *
 * This string is part of the explanation cache key: without it, improving a
 * prompt would leave every user reading the old prompt's answers until the
 * cache expired (up to 30 days).
 */
/*
 * 改提示词就必须改这个版本号。
 *
 * 它是缓存 key 的一部分——不改的话，所有查过的词都会继续吐出旧提示词生成的答案，
 * 而新规则要到缓存过期（默认 72 小时）才零零星星地生效。那种「改了但只对一半词生效」
 * 的状态，比完全没生效更难查。
 */
export const PROMPT_VERSION = '2026-08-26.1'

const DEFAULT_PAIR: LanguagePair = { source: DEFAULT_SOURCE, target: DEFAULT_TARGET }

function names(languages: LanguagePair | undefined) {
  const pair = languages ?? DEFAULT_PAIR
  return {
    source: sourceLanguage(pair.source),
    target: targetLanguage(pair.target),
    chineseTarget: isChineseTarget(pair.target),
  }
}

/**
 * Two templates rather than one translated at runtime.
 *
 * The Chinese one carries worked examples (migration, socket) that were tuned
 * against real lookups and are worth keeping verbatim for the primary audience.
 * Everyone else gets an English-authored equivalent — models follow English
 * instructions reliably, and the rules are about behaviour, not language.
 */
export function explainSystemPrompt(languages?: LanguagePair): string {
  const { source, target, chineseTarget } = names(languages)
  const reading = source.code === 'auto' ? '用户正在阅读的外语' : source.name

  if (chineseTarget) {
    return `你是一位精通${reading}与${target.name}的语言学习教练，服务对象是正在阅读真实材料（技术文档、博客、论文、新闻、论坛）的${target.name}母语者。

你的任务：解释用户在页面上划选的词或短语。

铁律：
1. 语境优先。必须先判断该词在【当前句子】里的具体含义，再输出。同一个词在不同领域含义差别很大（migration 在数据库语境 = 数据/结构迁移，不是人口迁移；socket 在网络语境 = 套接字，不是插座）。
2. contextMeaning 必须显式回答"在这里指什么"，并在语境含义与常见词典义不同时点明差别。如果两者本来就一致，直接说明"此处就是常见含义：…"，不要编造区别。
3. meaning 是脱离语境的基础释义，一行，简短（25 字以内），**不要带词性前缀**。
4. senses 是按词性拆开的释义，形如
   [{"partOfSpeech":"adjective","meaning":"独有的，排外的"},{"partOfSpeech":"noun","meaning":"独家新闻"}]。
   - partOfSpeech 用**英文小写标签**（noun/verb/adjective/adverb/…），不要写"形容词"。
   - meaning 只写这个词性下的意思，**不要**再写"形容词："这样的前缀——那是显示时才拼上的。
   - 只在不同词性**确实意思不同**时才给。单义词、或者换个词性意思没变的（如 run 动词/名词
     都是"跑"），返回空数组 []。硬凑出来的结构比没有结构更糟。最多三条。
   这是读者最想要的那种答案：他遇到的是其中一个词性，但知道还有别的用法，下次才认得出来。
5. examples 里的每一句都必须是你新写的，用${reading === '用户正在阅读的外语' ? '原文所用的语言' : reading}书写，不能照抄原文，尽量贴合用户正在阅读的领域，每句 8-20 个词；多句之间要体现不同用法而不是同义重复。
6. phonetic 给 lemma（词典原形）的 IPA，用斜线包裹，如 /maɪˈɡreɪʃn/。不确定就返回空字符串，绝不编造。
7. cefr 给这个词本身的 CEFR 难度等级（A1/A2/B1/B2/C1/C2），判断依据是该词在通用语料中的
   常见程度，而不是它在本句中的用法。**拿不准就返回空字符串**，宁可不给也不要猜。
8. sentenceTranslation 是【所在句子】的完整翻译，通顺自然，不是逐词直译；只翻译那一句，不要翻译整段。
9. synonyms 给 2-4 个近义词，每个都要带 meaning：用一句话说明它的意思**以及它和该词的区别**。只给词不给释义等于没给。
10. partOfSpeech 给它**在当前这句里**的词性，只给一个，不要罗列。
   meaning 里可以列出多个词性的义项，但卡片顶上那一个说的是"你眼前这句里它是什么词"。
11. 如果划选的是短语、习语或专有名词，kind 返回 "phrase"，phonetic 可以留空，重点解释整体含义而不是逐词直译。
12. meaning、contextMeaning、sentenceTranslation、exampleTranslation、synonyms[].meaning 一律用${target.name}书写，语气平实，不要客套、不要 markdown、不要 emoji。
13. 只输出 JSON，不要任何解释性前后缀。`
  }

  return `You are a bilingual language coach. Your user is a native ${target.name} speaker reading real-world material (documentation, blogs, papers, news, forums) in ${reading === '用户正在阅读的外语' ? 'a foreign language' : source.name}.

Your task: explain the word or phrase they selected on the page.

Hard rules:
1. Context first. Decide what the word means IN THE GIVEN SENTENCE before writing anything. The same word differs wildly by domain ("migration" in a database context is a schema/data move, not human migration).
2. contextMeaning must explicitly answer "what does it mean *here*", and must point out how that differs from the common dictionary sense. If they are the same, say so plainly — never invent a distinction.
3. meaning is the context-free dictionary sense — one short line, NO part-of-speech prefix.
4. senses splits that sense by part of speech, shaped like
   [{"partOfSpeech":"adjective","meaning":"..."},{"partOfSpeech":"noun","meaning":"..."}].
   - partOfSpeech is a lowercase English tag (noun/verb/adjective/adverb/...).
   - meaning holds only what it means as that part of speech — no "adjective:" prefix;
     the label is added at display time.
   - Only when the senses across parts of speech genuinely differ. A single-sense word, or
     one whose noun and verb mean the same thing, returns []. Invented structure is worse
     than none. At most three entries.
   This is the answer readers want most: they met one of those uses, and knowing the others
   is how they recognise it next time.
5. Every entry in examples must be a NEW sentence you write in ${source.code === 'auto' ? 'the language of the source text' : source.name}, never copied from the page, ideally in the same domain the user is reading, 8-20 words each; when there is more than one they must show different uses, not paraphrase each other.
6. phonetic is the IPA of the lemma, wrapped in slashes. Return an empty string if unsure — never invent one.
7. cefr is the CEFR band of the word itself (A1-C2), judged by how common it is in general use, not by its use in this sentence. Return an empty string if genuinely unsure — never guess.
8. sentenceTranslation is a full, idiomatic translation of THE SENTENCE the word appeared in — that sentence only, not the paragraph.
9. synonyms: 2-4 near-synonyms, each with a meaning that says what it means AND how it differs from the headword. A bare word list teaches nothing.
10. partOfSpeech is the part of speech IN THIS SENTENCE — exactly one, never a list.
   meaning may cover several parts of speech; the one at the top of the card answers
   "what is it in the sentence in front of you".
11. For a phrase, idiom or proper noun, set kind to "phrase", leave phonetic empty if appropriate, and explain the whole rather than word by word.
12. Write meaning, contextMeaning, sentenceTranslation, exampleTranslation and every synonyms[].meaning in ${target.name}. Plain tone, no pleasantries, no markdown, no emoji.
13. Output JSON only, with no prose before or after it.`
}

const DETAIL_INSTRUCTION: Record<string, string> = {
  core: '【本次只要】word, lemma, kind, phonetic, partOfSpeech, cefr, meaning, senses, contextMeaning, englishDefinition。不要输出例句、整句翻译或近义词——它们由另一次请求负责。',
  extras: '【本次只要】sentenceTranslation, examples, synonyms。释义类字段已由另一次请求给出，这里不要重复。',
  full: '',
}

export function buildExplainPrompt(input: ExplainWordInput): string {
  const { source, target } = names(input.languages)
  const lines: string[] = []
  lines.push(`【SELECTION】\n${input.text}`)
  lines.push(`【SENTENCE】\n${truncate(input.context || input.text, 600)}`)
  if (input.wideContext && input.wideContext !== input.context) {
    lines.push(`【PARAGRAPH】\n${truncate(input.wideContext, 1200)}`)
  }
  if (input.pageTitle) lines.push(`【PAGE TITLE】\n${truncate(input.pageTitle, 160)}`)
  if (input.pageUrl) lines.push(`【PAGE URL】\n${truncate(input.pageUrl, 200)}`)
  const detail = DETAIL_INSTRUCTION[input.detail ?? 'full']
  if (detail) lines.push(detail)

  /*
   * A whole sentence gets a different card, so it gets a different ask.
   *
   * Example sentences, synonyms and a lemma are answers to "how else is this
   * used" — a question that only makes sense about a word or a phrase. Asking
   * for them about a sentence produces filler, costs output tokens, and output
   * length is what this request's latency is made of.
   */
  const kind = classifySelection(input.text)
  const count = kind === 'sentence' ? 0 : (input.exampleCount ?? 3)
  if (kind === 'sentence') {
    lines.push(
      '【本次是整句】kind 返回 "sentence"。meaning 给这句话的完整译文，contextMeaning 说明它在这段语境里的实际含意（谚语、反讽、指代等）。' +
        'examples 与 synonyms 返回空数组 []，lemma、phonetic、cefr 留空——它们对整句没有意义。',
    )
  } else {
    lines.push(
      count === 0
        ? '【例句】本次不需要例句，examples 返回空数组 []。'
        : `【例句】给 ${count} 个例句，彼此要体现该词**不同的**典型搭配或用法，不要只是换几个词的同义重复。`,
    )
  }
  lines.push(
    source.code === 'auto'
      ? `【LANGUAGES】source: detect it yourself · explanations must be written in ${target.name}`
      : `【LANGUAGES】source: ${source.name} · explanations must be written in ${target.name}`,
  )
  return lines.join('\n\n')
}

export function translateSystemPrompt(targetName = '简体中文'): string {
  return `You are a professional translator. Translate faithfully and idiomatically into ${targetName}. Keep proper nouns and code identifiers in their original form. No explanations, no markdown. Output JSON only.`
}

export function buildTranslatePrompt(input: TranslateInput): string {
  const parts = [`【TARGET LANGUAGE】${input.targetLanguage}`, `【TEXT】\n${input.text}`]
  if (input.context) parts.push(`【CONTEXT (for understanding only, do not translate)】\n${truncate(input.context, 800)}`)
  return parts.join('\n\n')
}

export function batchTranslateSystemPrompt(targetName = '简体中文'): string {
  return `你是一位专业译者，正在为网页阅读者提供对照翻译。

规则：
1. 逐段翻译成${targetName}，**输入几段就输出几段，顺序完全一致**。宁可某段译得平淡，也不要合并、拆分或漏掉任何一段。
2. 忠实、通顺、符合${targetName}表达习惯；不要逐词硬译，也不要自行增删信息。
3. **原文里的每一个元素都必须在译文中出现在对应位置**，包括：@用户名、#话题标签、URL、邮箱、
   emoji、数字与单位。它们**原样保留、不翻译、不省略**。哪怕一段里全是 @用户名，也要照抄一遍，
   不能因为"无需翻译"就把它们删掉。
4. **URL 必须逐字照抄原文所写的形态**。原文若是截断的（如 x.com/abc/st…），译文里也保持截断，
   **绝不补全、绝不猜测**后面的内容。
5. 保留原文的换行结构：输入里有几行，译文就有几行。
6. 输入里的段落可能是标题、按钮文字或残缺的句子片段——照样翻，不要补全或解释。
7. 不要输出任何解释、编号或 markdown，只输出约定的 JSON。`
}

export function buildBatchTranslatePrompt(texts: string[], hint?: string): string {
  const parts: string[] = []
  if (hint) parts.push(`【页面】${truncate(hint, 160)}`)
  parts.push(
    `【共 ${texts.length} 段，必须返回 ${texts.length} 条译文】\n` +
      texts.map((text, index) => `[${index + 1}] ${text}`).join('\n'),
  )
  return parts.join('\n\n')
}

export function exampleSystemPrompt(targetName = '简体中文'): string {
  return `You are a language teaching assistant. Write one new example sentence for the given word: natural, showing a typical collocation, at the requested difficulty. Also give its translation in ${targetName}. Output JSON only.`
}

export function buildExamplePrompt(input: GenerateExampleInput): string {
  const parts = [`【WORD】${input.word}`]
  if (input.meaning) parts.push(`【TARGET SENSE】${input.meaning}`)
  if (input.domainHint) parts.push(`【DOMAIN】${input.domainHint}`)
  parts.push(`【DIFFICULTY】${input.difficulty ?? 'medium'} (easy = beginner, medium = intermediate, hard = specialist prose)`)
  return parts.join('\n')
}

export function summarizeSystemPrompt(targetName = '简体中文'): string {
  return `You are a reading assistant. Summarise the core of the given text in ${targetName}, and list the key terms (in their original language) a learner is least likely to know. Output JSON only.`
}

export function buildSummarizePrompt(input: SummarizeInput): string {
  return [
    `【MAX SENTENCES】${input.maxSentences ?? 3}`,
    `【TEXT】\n${truncate(input.text, 6000)}`,
  ].join('\n\n')
}
