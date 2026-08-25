/**
 * Domain model for the user's personal English knowledge base.
 *
 * Everything the product is about lives in this file: a `VocabularyEntry` is not
 * a translation result, it is a durable learning asset (the word + the sentence
 * the user actually met it in + the AI's contextual reading of it + the review
 * history that follows).
 */

/**
 * CEFR band, or '' when the model would not commit to one.
 *
 * Not the same axis as familiarity: CEFR is a property of the word (how hard it
 * is in general), familiarity is a property of *this reader's* memory of it.
 * Both are useful and neither substitutes for the other.
 */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | ''

export const CEFR_HINTS: Record<Exclude<CefrLevel, ''>, string> = {
  A1: '入门',
  A2: '基础',
  B1: '中级',
  B2: '中高级',
  C1: '高级',
  C2: '精通',
}

/** One example sentence and its translation. */
export interface ExampleSentence {
  sentence: string
  translation: string
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

export const FAMILIARITY_LABELS: Record<FamiliarityLevel, string> = {
  0: '陌生',
  1: '学习中',
  2: '熟悉',
  3: '掌握',
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
  /** 基础中文释义 — the context-free dictionary sense. */
  meaning: string
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

/** Self-graded recall quality, Anki-style but reduced to four buttons. */
export type ReviewGrade = 'forgot' | 'hard' | 'good' | 'easy'

export const REVIEW_GRADE_LABELS: Record<ReviewGrade, string> = {
  forgot: '忘记了',
  hard: '有点模糊',
  good: '记得',
  easy: '完全掌握',
}

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
