import { z } from 'zod'
import {
  AIError,
  type CefrLevel,
  type ExampleSentence,
  type ExplainDetail,
  type ProviderId,
  type Synonym,
  type WordExplanation,
} from '@/types/ai.ts'
import { classifySelection, isPhrase, normalizeWord, truncate } from '@/shared/utils.ts'

/**
 * Two representations of the same contract:
 *
 * - `wordExplanationSchema` (zod) validates and repairs whatever a model returns.
 * - `WORD_EXPLANATION_JSON_SCHEMA` is sent to providers that support strict
 *   structured output (OpenAI `json_schema`, Gemini `responseSchema`, Anthropic
 *   `output_config.format`).
 *
 * They are hand-kept in sync and a unit test fails if the key sets diverge —
 * a generated schema was tried first, but strict mode needs exact control over
 * `required` / `additionalProperties`, which is easier to read written out.
 */

const stringOrEmpty = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => (typeof value === 'string' ? value.trim() : ''))

export const wordExplanationSchema = z.object({
  word: stringOrEmpty,
  lemma: stringOrEmpty,
  kind: z
    .union([
      z.literal('word'),
      z.literal('phrase'),
      z.literal('sentence'),
      z.string(),
      z.null(),
      z.undefined(),
    ])
    .transform((value) =>
      value === 'sentence' ? 'sentence' : value === 'phrase' ? 'phrase' : 'word',
    ),
  phonetic: stringOrEmpty,
  partOfSpeech: stringOrEmpty,
  meaning: stringOrEmpty,
  contextMeaning: stringOrEmpty,
  englishDefinition: stringOrEmpty,
  sentenceTranslation: stringOrEmpty,
  example: stringOrEmpty,
  exampleTranslation: stringOrEmpty,
  // Models drop back to a bare string list surprisingly often, even with the
  // shape spelled out. Accept both rather than losing the field.
  synonyms: z
    .union([
      z.array(z.union([z.string(), z.object({ word: z.string(), meaning: z.string().optional() })])),
      z.null(),
      z.undefined(),
    ])
    .transform((value) => {
      if (!Array.isArray(value)) return []
      return value
        .map((item) =>
          typeof item === 'string'
            ? { word: item.trim(), meaning: '' }
            : { word: (item.word ?? '').trim(), meaning: (item.meaning ?? '').trim() },
        )
        .filter((item) => item.word.length > 0)
    }),
})

export const WORD_EXPLANATION_KEYS = [
  'word',
  'lemma',
  'kind',
  'phonetic',
  'partOfSpeech',
  'cefr',
  'meaning',
  'contextMeaning',
  'englishDefinition',
  'sentenceTranslation',
  'example',
  'exampleTranslation',
  'synonyms',
] as const

/** What the reader is waiting for: what does this word mean, here. */
export const CORE_KEYS = [
  'word',
  'lemma',
  'kind',
  'phonetic',
  'partOfSpeech',
  'cefr',
  'meaning',
  'contextMeaning',
  'englishDefinition',
] as const

/** Worth having, not worth waiting for. */
export const EXTRA_KEYS = ['sentenceTranslation', 'examples', 'synonyms'] as const

export const WORD_EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...WORD_EXPLANATION_KEYS],
  properties: {
    word: { type: 'string', description: 'The selected surface form, unchanged.' },
    lemma: { type: 'string', description: 'Dictionary form, e.g. "migrations" -> "migration".' },
    kind: { type: 'string', enum: ['word', 'phrase', 'sentence'] },
    phonetic: { type: 'string', description: 'IPA of the lemma, wrapped in slashes. "" if unknown.' },
    partOfSpeech: { type: 'string', description: 'noun / verb / adjective / phrase ...' },
    cefr: {
      type: 'string',
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', ''],
      description: 'CEFR band of this word. Empty string if genuinely unsure — never guess.',
    },
    meaning: { type: 'string', description: 'Context-free Chinese dictionary sense, short.' },
    contextMeaning: {
      type: 'string',
      description: 'Chinese explanation of what the word means IN THIS SENTENCE.',
    },
    englishDefinition: { type: 'string', description: 'Learner-friendly definition in the source language.' },
    sentenceTranslation: {
      type: 'string',
      description: 'Full translation of the SENTENCE the word appeared in.',
    },
    examples: {
      type: 'array',
      description: 'New example sentences in the source language, each with a translation.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sentence', 'translation'],
        properties: {
          sentence: { type: 'string' },
          translation: { type: 'string' },
        },
      },
    },
    synonyms: {
      type: 'array',
      description: '2-4 near-synonyms, each with a short gloss so the list teaches something.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['word', 'meaning'],
        properties: {
          word: { type: 'string' },
          meaning: { type: 'string', description: 'Short gloss, and how it differs from the headword.' },
        },
      },
    },
  },
} as const

/** Narrows the canonical schema to one phase, so we ask for nothing extra. */
export function explanationJsonSchema(detail: ExplainDetail): object {
  if (detail === 'full') return WORD_EXPLANATION_JSON_SCHEMA
  const keys: readonly string[] = detail === 'core' ? CORE_KEYS : EXTRA_KEYS
  const properties = Object.fromEntries(
    Object.entries(WORD_EXPLANATION_JSON_SCHEMA.properties).filter(([key]) => keys.includes(key)),
  )
  return { type: 'object', additionalProperties: false, required: [...keys], properties }
}

const STRICT_FIELDS = {
  word: z.string(),
  lemma: z.string(),
  kind: z.enum(['word', 'phrase', 'sentence']),
  phonetic: z.string(),
  partOfSpeech: z.string(),
  cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', '']),
  meaning: z.string(),
  contextMeaning: z.string(),
  englishDefinition: z.string(),
  sentenceTranslation: z.string(),
  examples: z.array(z.object({ sentence: z.string(), translation: z.string() })),
  synonyms: z.array(z.object({ word: z.string(), meaning: z.string() })),
}

/** The same narrowing for SDKs that take a zod schema. */
export function strictExplanationSchemaFor(detail: ExplainDetail) {
  if (detail === 'full') return z.object(STRICT_FIELDS)
  const keys: readonly string[] = detail === 'core' ? CORE_KEYS : EXTRA_KEYS
  return z.object(
    Object.fromEntries(Object.entries(STRICT_FIELDS).filter(([key]) => keys.includes(key))),
  )
}

export const translationSchema = z.object({
  translation: stringOrEmpty,
  note: stringOrEmpty.optional(),
})

export const TRANSLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translation', 'note'],
  properties: {
    translation: { type: 'string' },
    note: { type: 'string', description: 'Empty string unless a judgement call was needed.' },
  },
} as const

export const BATCH_TRANSLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      description: 'One translation per input segment, same order, same count.',
      items: { type: 'string' },
    },
  },
} as const

export const strictBatchTranslationSchema = z.object({ translations: z.array(z.string()) })

/**
 * Models drop or merge segments; a shifted array would put every paragraph's
 * translation under the wrong paragraph, which is worse than missing text.
 * Pad and trim to the expected length so the mapping stays positional.
 */
export function coerceBatchTranslations(raw: unknown, expected: number): string[] {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const list = Array.isArray(source['translations']) ? source['translations'] : []
  const out: string[] = []
  for (let i = 0; i < expected; i++) {
    const value = list[i]
    out.push(typeof value === 'string' ? value.trim() : '')
  }
  return out
}

export const exampleSchema = z.object({
  sentence: stringOrEmpty,
  translation: stringOrEmpty,
})

export const EXAMPLE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sentence', 'translation'],
  properties: {
    sentence: { type: 'string' },
    translation: { type: 'string' },
  },
} as const

export const summarySchema = z.object({
  summary: stringOrEmpty,
  keyTerms: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => (Array.isArray(value) ? value.filter(Boolean) : [])),
})

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keyTerms'],
  properties: {
    summary: { type: 'string' },
    keyTerms: { type: 'array', items: { type: 'string' } },
  },
} as const

/**
 * Does this explanation actually teach the reader anything?
 *
 * The cache must answer this on the way in *and* on the way out. Validating
 * only on write is not enough: entries written by an older, buggier build stay
 * in storage for days, and a cache hit skips every check the new code added —
 * so a fixed bug keeps being served from disk long after it was fixed.
 */
export function isUsableExplanation(
  explanation: WordExplanation | null | undefined,
  detail: ExplainDetail = 'full',
): boolean {
  if (!explanation) return false
  if (detail === 'extras') {
    return Boolean(
      explanation.sentenceTranslation.trim() ||
        explanation.examples.length ||
        explanation.synonyms.length,
    )
  }
  return Boolean(
    explanation.meaning.trim() ||
      explanation.contextMeaning.trim() ||
      explanation.englishDefinition.trim(),
  )
}

/**
 * Turns whatever the model sent into a usable explanation, field by field.
 *
 * The previous version ran one `safeParse` over the whole object, which is
 * all-or-nothing: a single malformed field — `synonyms` returned as an object
 * instead of an array, say — failed the parse, everything fell back to empty,
 * and a perfectly good explanation with correct `meaning` and `contextMeaning`
 * was thrown away with a "shape mismatch" error.
 *
 * Models not following the contract is a certainty, not an exception (the same
 * conclusion read-frog reached about translation providers). So each field is
 * coerced independently and a bad one costs only itself. We only fail the whole
 * lookup when nothing usable came back at all.
 */
export function coerceExplanation(
  raw: unknown,
  selectedText: string,
  providerId: ProviderId = 'mock',
  detail: ExplainDetail = 'full',
): WordExplanation {
  const source: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

  const text = (key: string): string => {
    const value = source[key]
    if (typeof value === 'string') return value.trim()
    // Some models wrap a single value in an array, or send a number.
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
    return ''
  }

  const meaning = text('meaning')
  const contextMeaning = text('contextMeaning')
  const englishDefinition = text('englishDefinition')

  // The extras phase legitimately carries none of the core fields.
  if (detail !== 'extras' && !meaning && !contextMeaning && !englishDefinition) {
    console.warn('[fanfan] model returned no usable fields:', raw)
    throw new AIError(
      'bad_response',
      `模型返回的字段与约定不符：${truncate(JSON.stringify(raw ?? null), 200)}`,
      providerId,
    )
  }

  const word = text('word') || selectedText.trim()
  const kindValue = text('kind')
  /*
   * What the user selected is a fact about the selection, not an opinion the
   * model gets to hold: a full sentence stays a sentence even when the model
   * labels it "phrase" (which is what it did for "The roots of education are
   * bitter, but the fruit is sweet."). Only the word/phrase distinction is left
   * to the model, since it knows about idioms and proper nouns.
   */
  const local = classifySelection(selectedText || word)

  return {
    word,
    lemma: text('lemma') || normalizeWord(word),
    kind:
      local === 'sentence'
        ? 'sentence'
        : kindValue === 'phrase' || kindValue === 'sentence' || isPhrase(word)
          ? 'phrase'
          : 'word',
    phonetic: normalizePhonetic(text('phonetic')),
    partOfSpeech: text('partOfSpeech'),
    cefr: coerceCefr(text('cefr')),
    meaning,
    contextMeaning,
    englishDefinition,
    sentenceTranslation: text('sentenceTranslation'),
    examples: coerceExamples(source['examples'], text('example'), text('exampleTranslation')),
    synonyms: coerceSynonyms(source['synonyms']),
  }
}

/**
 * Accepts the list shape, and still understands the single `example` /
 * `exampleTranslation` pair — models fall back to it, and entries cached or
 * saved before the list existed use it.
 */
export function coerceExamples(
  value: unknown,
  fallbackSentence = '',
  fallbackTranslation = '',
): ExampleSentence[] {
  const clean = (sentence: string, translation: string): ExampleSentence | null => {
    const trimmed = sentence.trim()
    return trimmed ? { sentence: trimmed, translation: translation.trim() } : null
  }

  let items: Array<ExampleSentence | null> = []
  if (Array.isArray(value)) {
    items = value.map((item) => {
      if (typeof item === 'string') return clean(item, '')
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const sentence = typeof record['sentence'] === 'string' ? record['sentence'] : ''
        const translation = typeof record['translation'] === 'string' ? record['translation'] : ''
        return clean(sentence, translation)
      }
      return null
    })
  }

  const list = items.filter((item): item is ExampleSentence => item !== null)
  if (list.length > 0) return list.slice(0, 6)

  const single = clean(fallbackSentence, fallbackTranslation)
  return single ? [single] : []
}

/** Models answer "B2", "b2", "B2 (中高级)" or "Level B2"; all mean B2. */
export function coerceCefr(value: string): CefrLevel {
  const match = /\b([ABC][12])\b/i.exec(value)
  return match ? (match[1]!.toUpperCase() as CefrLevel) : ''
}

/**
 * Accepts every shape models actually send: a list of objects (the contract), a
 * list of bare strings, a comma-separated string, or an object map of
 * word -> gloss. Anything else yields an empty list rather than an exception.
 */
export function coerceSynonyms(value: unknown): Synonym[] {
  const clean = (word: string, meaning: string): Synonym | null => {
    const trimmed = word.trim()
    return trimmed ? { word: trimmed, meaning: meaning.trim() } : null
  }

  let items: Array<Synonym | null> = []

  if (Array.isArray(value)) {
    items = value.map((item) => {
      if (typeof item === 'string') return clean(item, '')
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const word = typeof record['word'] === 'string' ? record['word'] : ''
        const meaning = typeof record['meaning'] === 'string' ? record['meaning'] : ''
        return clean(word, meaning)
      }
      return null
    })
  } else if (typeof value === 'string') {
    items = value.split(/[,，、;；]/).map((part) => clean(part, ''))
  } else if (value && typeof value === 'object') {
    items = Object.entries(value as Record<string, unknown>).map(([word, meaning]) =>
      clean(word, typeof meaning === 'string' ? meaning : ''),
    )
  }

  return items.filter((item): item is Synonym => item !== null).slice(0, 6)
}

/** Models return `ˈmaɪɡreɪʃn`, `/ˈmaɪɡreɪʃn/`, or `[ˈmaɪɡreɪʃn]`. Normalise to slashes. */
function normalizePhonetic(value: string): string {
  const trimmed = value.trim().replace(/^[[/]/, '').replace(/[\]/]$/, '').trim()
  return trimmed ? `/${trimmed}/` : ''
}

/**
 * Plain, transform-free mirrors of the schemas above.
 *
 * Providers with native structured output convert a zod schema to JSON Schema,
 * and unions/transforms convert badly. These stay boring on purpose: every
 * field required, every field a primitive. Repair still happens afterwards via
 * `coerceExplanation`.
 */
export const strictExplanationSchema = z.object({
  word: z.string(),
  lemma: z.string(),
  kind: z.enum(['word', 'phrase', 'sentence']),
  phonetic: z.string(),
  partOfSpeech: z.string(),
  cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', '']),
  meaning: z.string(),
  contextMeaning: z.string(),
  englishDefinition: z.string(),
  sentenceTranslation: z.string(),
  examples: z.array(z.object({ sentence: z.string(), translation: z.string() })),
  synonyms: z.array(z.object({ word: z.string(), meaning: z.string() })),
})

export const strictTranslationSchema = z.object({
  translation: z.string(),
  note: z.string(),
})

export const strictExampleSchema = z.object({
  sentence: z.string(),
  translation: z.string(),
})

export const strictSummarySchema = z.object({
  summary: z.string(),
  keyTerms: z.array(z.string()),
})

/**
 * Renders a JSON Schema as a compact key contract for the prompt.
 *
 * Endpoints that only support `{"type":"json_object"}` (DeepSeek, most
 * gateways) guarantee *valid JSON* and nothing about its shape. Without this,
 * the model invents its own key names, the response parses cleanly, every
 * field we look for is missing, and the card renders blank — a failure that
 * looks like the model said nothing rather than like a bug.
 */
export function describeSchemaForPrompt(schema: {
  required?: readonly string[]
  properties?: Record<string, { type?: string; description?: string; enum?: readonly string[] }>
}): string {
  const properties = schema.properties ?? {}
  const lines = Object.entries(properties).map(([key, spec]) => {
    const type = spec.enum ? spec.enum.map((value) => `"${value}"`).join(' | ') : (spec.type ?? 'string')
    const note = spec.description ? `  // ${spec.description}` : ''
    return `  "${key}": ${type},${note}`
  })
  return [
    '必须严格输出下面这个 JSON 对象，键名一字不差，不要增加或删除字段；',
    '不知道的字段返回空字符串 "" 或空数组 []，不要编造。',
    '{',
    ...lines,
    '}',
  ].join('\n')
}
