/** Contracts between the app and any LLM behind it. */

import { t, type MessageKey } from '@/i18n/index.ts'
import type {
  CefrLevel,
  ExampleSentence,
  SelectionKind,
  Synonym,
  WordSense,
} from './vocabulary.ts'

export type { Synonym, CefrLevel, ExampleSentence, WordSense }

export type ProviderId = 'mock' | 'openai' | 'claude' | 'deepseek' | 'gemini' | 'custom'

/** The structured explanation every provider must return. */
export interface WordExplanation {
  word: string
  lemma: string
  kind: SelectionKind
  phonetic: string
  partOfSpeech: string
  /** CEFR band of the word (A1-C2), or '' if the model will not commit. */
  cefr: CefrLevel
  /** 基础中文释义（脱离语境的词典义）。一行，不带词性前缀。 */
  meaning: string
  /**
   * 按词性拆开的释义，只在**不同词性意思确实不同**时才有内容。
   *
   * 单义词、离线词典、以及没按格式回话的模型，这里都是空数组——
   * 显示时退回 {@link meaning}。
   */
  senses: WordSense[]
  /** 结合当前网页上下文的解释——必须说明"在这里指什么"。 */
  contextMeaning: string
  /** English definition, learner-friendly. */
  englishDefinition: string
  /** Translation of the sentence the word was met in. */
  sentenceTranslation: string
  examples: ExampleSentence[]
  synonyms: Synonym[]
}

/** Language codes, resolved from settings by the background handler. */
export interface LanguagePair {
  source: string
  target: string
}

/**
 * Which half of the explanation to generate.
 *
 * Latency here is dominated by output length, not by the network: the full
 * card is eleven fields and several hundred CJK tokens, which is many seconds
 * on a fast model. `core` is the part the reader is actually waiting for;
 * `extras` is fetched straight after and merged in while they read.
 */
export type ExplainDetail = 'core' | 'extras' | 'full'

export interface ExplainWordInput {
  /** The exact selected text. */
  text: string
  /** How many example sentences to generate; 0 turns them off entirely. */
  exampleCount?: number
  /** Defaults to `full`. */
  detail?: ExplainDetail
  /** Omitted only in tests; defaults to auto -> 简体中文. */
  languages?: LanguagePair
  /** Sentence the selection sits in. */
  context: string
  /** Wider window (paragraph) — helps with pronouns and domain terms. */
  wideContext?: string
  pageTitle?: string
  pageUrl?: string
}

export interface TranslateInput {
  text: string
  /** Target language name, e.g. `简体中文`. */
  targetLanguage: string
  context?: string
}

export interface TranslateResult {
  translation: string
  /** Optional note when the translation needed a judgement call. */
  note?: string
}

export interface TranslateBatchInput {
  /** Source segments, in order. */
  texts: string[]
  targetLanguage: string
  /** Page title and similar, to steer domain vocabulary. */
  hint?: string
}

export interface GenerateExampleInput {
  word: string
  meaning?: string
  /** Roughly CEFR: keep generated sentences at or below the learner's level. */
  difficulty?: 'easy' | 'medium' | 'hard'
  /** Reuse the domain the user met the word in (e.g. software engineering). */
  domainHint?: string
  /** Display name of the language the translation should be written in. */
  targetLanguage?: string
}

export interface GeneratedExample {
  sentence: string
  translation: string
}

export interface SummarizeInput {
  text: string
  /** Max sentences in the summary. */
  maxSentences?: number
  /** Display name of the language the summary should be written in. */
  targetLanguage?: string
}

export interface SummaryResult {
  summary: string
  keyTerms: string[]
}

/**
 * The abstraction every backend implements.
 *
 * Deliberately narrow: four verbs, all returning plain data. Providers own
 * transport, auth and JSON coercion; callers never see provider-shaped types.
 */
export interface AIProvider {
  readonly id: ProviderId
  readonly label: string
  readonly model: string
  /** True for providers that never leave the device. */
  readonly offline: boolean

  explainWord(input: ExplainWordInput, signal?: AbortSignal): Promise<WordExplanation>
  translate(input: TranslateInput, signal?: AbortSignal): Promise<TranslateResult>
  /**
   * Translates several segments in one request.
   *
   * Page translation is dominated by round trips, not by tokens: one request
   * per paragraph would be both slow and rate-limit bait. Implementations must
   * return exactly `texts.length` items, in order.
   */
  translateBatch(input: TranslateBatchInput, signal?: AbortSignal): Promise<string[]>
  generateExample(input: GenerateExampleInput, signal?: AbortSignal): Promise<GeneratedExample>
  summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummaryResult>
}

/** Stable error codes so the UI can react without string matching. */
export type AIErrorCode =
  | 'no_api_key'
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'refused'
  | 'aborted'
  | 'stale_context'
  | 'unknown'

/**
 * Codes that mean "the same request might work if you send it again".
 *
 * `auth` and `no_api_key` are deliberately absent: retrying a rejected key just
 * spends another round trip to be told the same thing. `bad_response` is absent
 * too, because it usually means the base URL points at a web page — but the
 * specific case of an empty body is a cut connection, so that one is raised
 * with `retryable` set explicitly.
 */
const RETRYABLE_CODES: ReadonlySet<AIErrorCode> = new Set(['network', 'timeout', 'rate_limit'])

export class AIError extends Error {
  readonly code: AIErrorCode
  readonly providerId: ProviderId
  readonly status?: number
  /** From a 429's `Retry-After`, when the provider bothered to send one. */
  readonly retryAfterSeconds?: number
  /** Overrides the default for this code; see `RETRYABLE_CODES`. */
  private readonly retryableOverride?: boolean

  constructor(
    code: AIErrorCode,
    message: string,
    providerId: ProviderId,
    status?: number,
    options: { retryable?: boolean; retryAfterSeconds?: number } = {},
  ) {
    super(message)
    this.name = 'AIError'
    this.code = code
    this.providerId = providerId
    if (status !== undefined) this.status = status
    if (options.retryable !== undefined) this.retryableOverride = options.retryable
    if (options.retryAfterSeconds !== undefined) this.retryAfterSeconds = options.retryAfterSeconds
  }

  get retryable(): boolean {
    return this.retryableOverride ?? RETRYABLE_CODES.has(this.code)
  }
}

/**
 * 错误码对应的界面文案。
 *
 * 表里存的是**键**，取文案是函数。写成 `Record<AIErrorCode, string>` 常量的话，
 * 每条文案在模块加载那一刻就求值定死了，用户之后在设置页改界面语言，这张表还停在
 * 旧语言上——而它偏偏是最少被人盯着看的一块界面。
 */
const AI_ERROR_KEYS: Record<AIErrorCode, MessageKey> = {
  no_api_key: 'error.ai.no_api_key',
  auth: 'error.ai.auth',
  rate_limit: 'error.ai.rate_limit',
  network: 'error.ai.network',
  timeout: 'error.ai.timeout',
  bad_response: 'error.ai.bad_response',
  refused: 'error.ai.refused',
  aborted: 'error.ai.aborted',
  stale_context: 'error.ai.stale_context',
  unknown: 'error.ai.unknown',
}

export function aiErrorMessage(code: AIErrorCode): string {
  return t(AI_ERROR_KEYS[code] ?? AI_ERROR_KEYS.unknown)
}
