/**
 * Domain model for the user's personal English knowledge base.
 *
 * Everything the product is about lives in this file: a `VocabularyEntry` is not
 * a translation result, it is a durable learning asset (the word + the sentence
 * the user actually met it in + the AI's contextual reading of it + the review
 * history that follows).
 */

import { t, type MessageKey } from '@/i18n/index.ts'

/*
 * 这里的标签存的是**文案键**，取值走下面那几个函数。
 *
 * 直接写 `{ A1: t('...') }` 会在模块加载那一刻就把语言定死——之后用户在设置页
 * 换成英文，这些标签还是旧的，而且因为它们散在词卡、面板、词库三处，测试里几乎
 * 看不出来。存键、用的时候再取，是唯一不会踩这个坑的写法。
 */

/**
 * CEFR band, or '' when the model would not commit to one.
 *
 * Not the same axis as familiarity: CEFR is a property of the word (how hard it
 * is in general), familiarity is a property of *this reader's* memory of it.
 * Both are useful and neither substitutes for the other.
 */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | ''

export const CEFR_HINT_KEYS: Record<Exclude<CefrLevel, ''>, MessageKey> = {
  A1: 'vocabulary.cefr.a1',
  A2: 'vocabulary.cefr.a2',
  B1: 'vocabulary.cefr.b1',
  B2: 'vocabulary.cefr.b2',
  C1: 'vocabulary.cefr.c1',
  C2: 'vocabulary.cefr.c2',
}

/** Plain-language gloss for a CEFR band, in the current interface language. */
export function cefrHint(level: Exclude<CefrLevel, ''>): string {
  return t(CEFR_HINT_KEYS[level])
}

/** One example sentence and its translation. */
export interface ExampleSentence {
  sentence: string
  translation: string
}

/**
 * 一个词性下的释义。
 *
 * 分开存，而不是存一串「形容词：独有的；名词：独家新闻」。字符串好看，但一旦想
 * 「只复习它作动词时的用法」「按词性给词库分组」，就得回头去解析那个分号——
 * 而解析自己拼出来的字符串，是把已经有的结构又丢掉一次。
 */
export interface WordSense {
  /**
   * 词性，存**英文规范标签**（noun / verb / adjective …），不是「形容词」。
   *
   * 存标签而不是存译名，是为了让筛选和分组不受界面语言影响：读者把界面切成英文，
   * 他按词性分的那些组不该跟着散架。译名在显示时由 {@link partOfSpeechLabel} 给。
   * 模型给了个归不了类的词性时原样保留——显示得出来，总比丢掉强。
   */
  partOfSpeech: string
  /** 这个词性下的意思，用目标语言书写，**不带**词性前缀。 */
  meaning: string
}

/**
 * 词性标签 → 界面语言里的说法。
 *
 * 只覆盖常见的那些。表里没有的原样显示：模型偶尔会给出 "phrasal verb" 这类东西，
 * 显示成它本来的样子，比显示成空白或者硬塞进某一类要诚实。
 */
const PART_OF_SPEECH_KEYS: Record<string, MessageKey> = {
  noun: 'pos.noun',
  verb: 'pos.verb',
  adjective: 'pos.adjective',
  adverb: 'pos.adverb',
  pronoun: 'pos.pronoun',
  preposition: 'pos.preposition',
  conjunction: 'pos.conjunction',
  interjection: 'pos.interjection',
  determiner: 'pos.determiner',
  numeral: 'pos.numeral',
  phrase: 'pos.phrase',
}

export function partOfSpeechLabel(partOfSpeech: string): string {
  const key = PART_OF_SPEECH_KEYS[partOfSpeech.trim().toLowerCase()]
  return key ? t(key) : partOfSpeech
}

/** A related word plus what it means — a bare list of words teaches nothing. */
export interface Synonym {
  word: string
  meaning: string
}

/** 熟悉度等级。0 陌生 / 1 学习中 / 2 熟悉 / 3 掌握。 */
export type FamiliarityLevel = 0 | 1 | 2 | 3

/** Human-readable projection of {@link FamiliarityLevel}. */
export type ReviewStatus = 'new' | 'learning' | 'familiar' | 'mastered'

export const FAMILIARITY_LABEL_KEYS: Record<FamiliarityLevel, MessageKey> = {
  0: 'vocabulary.familiarity.new',
  1: 'vocabulary.familiarity.learning',
  2: 'vocabulary.familiarity.familiar',
  3: 'vocabulary.familiarity.mastered',
}

/** Label for a familiarity level, in the current interface language. */
export function familiarityLabel(level: FamiliarityLevel): string {
  return t(FAMILIARITY_LABEL_KEYS[level])
}

export const REVIEW_STATUS_BY_LEVEL: Record<FamiliarityLevel, ReviewStatus> = {
  0: 'new',
  1: 'learning',
  2: 'familiar',
  3: 'mastered',
}

/**
 * What the user selected.
 *
 * `sentence` exists because the card's shape depends on it: example sentences,
 * synonyms and a lemma are meaningful for a word or a phrase and meaningless
 * for a whole sentence — nobody needs three more sentences "using" a sentence.
 */
export type SelectionKind = 'word' | 'phrase' | 'sentence'

/** Spaced-repetition state attached to every entry. */
export interface ReviewState {
  /** 熟悉度等级 0-3。 */
  level: FamiliarityLevel
  /** Derived from `level`; stored so exports stay self-describing. */
  status: ReviewStatus
  /** Epoch ms of the next scheduled review. `0` means "due now". */
  dueAt: number
  /** Epoch ms of the last graded review, or `null` if never reviewed. */
  lastReviewedAt: number | null
  /** Total graded reviews. */
  reviewCount: number
  /** Times the user forgot a word they had previously promoted. */
  lapses: number
  /** Consecutive successful reviews. */
  streak: number
}

/** Where a word was met. This is the part a dictionary app throws away. */
export interface WordSource {
  url: string
  title: string
  /** The sentence containing the selection. */
  context: string
  /** A slightly wider window (usually the paragraph), for flashcard backs. */
  wideContext: string
  /** Epoch ms of capture. */
  capturedAt: number
}

/** Which model produced the explanation, so results stay auditable. */
export interface ExplanationOrigin {
  providerId: string
  model: string
  /** True when produced by the offline Mock provider (no API key configured). */
  offline: boolean
}

export interface VocabularyEntry {
  /** Stable id: `w_<base36 time>_<random>`. */
  id: string
  /** The selected surface form, as it appeared on the page. */
  word: string
  /** Lowercased + trimmed key used for dedupe and search. */
  normalized: string
  /** Dictionary form when the surface form is inflected (`migrations` -> `migration`). */
  lemma: string
  kind: SelectionKind
  /** IPA, e.g. `/maɪˈɡreɪʃn/`. Empty string when unknown. */
  phonetic: string
  /** e.g. `noun`, `verb`, `phrase`. */
  partOfSpeech: string
  /** CEFR difficulty of the word itself; '' when unknown. */
  cefr: CefrLevel
  /**
   * 基础中文释义 — the context-free dictionary sense.
   *
   * 有 {@link VocabularyEntry.senses} 时，这一条是由它拼出来的。保留它不是冗余：
   * 词库列表、闪卡背面、导出的 Markdown、搜索，全都只需要一行能读的字，
   * 让它们各自去拼一遍才是重复。
   */
  meaning: string
  /**
   * 按词性拆开的释义。
   *
   * 旧词卡和离线词典给不出这个，所以可能是空数组——调用方必须能只靠
   * {@link VocabularyEntry.meaning} 活下去。
   */
  senses: WordSense[]
  /** 结合上下文的 AI 解释 — the product's core value. */
  aiExplanation: string
  /** English-to-English definition, for learners past the beginner stage. */
  englishDefinition: string
  /** Translation of the sentence this word was met in. */
  sentenceTranslation: string
  /**
   * Generated example sentences.
   *
   * A list rather than one sentence: a single example shows one collocation,
   * and it is the *contrast* between two or three that teaches how a word is
   * actually used. How many (0-6) is a user setting.
   */
  examples: ExampleSentence[]
  synonyms: Synonym[]
  source: WordSource
  origin: ExplanationOrigin
  review: ReviewState
  tags: string[]
  notes: string
  favorite: boolean
  createdAt: number
  updatedAt: number
  /**
   * Tombstone. Deleting locally cannot simply drop the row: the next sync would
   * pull the word back from another device, which had no way of knowing it was
   * deleted. A dated tombstone propagates the deletion and is purged once every
   * device has certainly seen it.
   */
  deletedAt: number | null
}

/** One graded review, kept for the dashboard and for future SRS tuning. */
export interface ReviewLogEntry {
  id: string
  entryId: string
  word: string
  /** Grade the user gave themselves. */
  grade: ReviewGrade
  levelBefore: FamiliarityLevel
  levelAfter: FamiliarityLevel
  reviewedAt: number
}

/**
 * Self-graded recall quality, Anki-style but reduced to four buttons.
 *
 * 四个档位的按钮文案不在这里：它们只出现在闪卡页，和各自的按钮样式绑在一起，
 * 所以键写在 `flashcard/FlashcardPage.tsx` 的 `GRADES` 里（`flashcard.grade.*`）。
 */
export type ReviewGrade = 'forgot' | 'hard' | 'good' | 'easy'

/** Per-day rollup powering the streak counter and the dashboard chart. */
export interface DailyActivity {
  /** `YYYY-MM-DD` in the user's local timezone. */
  date: string
  /** Words saved that day. */
  saved: number
  /** Cards reviewed that day. */
  reviewed: number
  /** Lookups performed that day (saved or not). */
  lookups: number
}
