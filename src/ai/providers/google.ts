import { t } from '@/i18n/index.ts'
import { classifySelection, truncate } from '@/shared/utils.ts'
import { TARGET_LANGUAGES } from '@/shared/language.ts'
import {
  AIError,
  type AIProvider,
  type ExplainWordInput,
  type GenerateExampleInput,
  type GeneratedExample,
  type SummarizeInput,
  type SummaryResult,
  type TranslateBatchInput,
  type TranslateInput,
  type TranslateResult,
  type WordExplanation,
} from '@/types/ai.ts'
import { statusToCode, toNetworkError } from '../http.ts'
import { guessLemma } from './mock.ts'

/**
 * 谷歌翻译的免费接口（`client=gtx`）。
 *
 * 这是不配 Key 时的默认后端：能给词典义、整句和整段的译文，也能翻字幕——
 * 但它是翻译，不是模型，**判断不了一个词在这句话里指什么**。所以 `contextual`
 * 是 false，卡片上语境那一栏只会诚实地说「要 Key 才有」。
 *
 * 接口不是官方公开的：没有 SLA，形状可能变，中国大陆网络多半连不上。
 * 解析都放在下面几个纯函数里，形状一变，改的地方就在这几行。
 */
const BASE = 'https://translate.googleapis.com/translate_a'
const TIMEOUT_MS = 15_000
/** `translate_a/t` 是 GET，正文全在 URL 上；超过这个长度就分几次发。 */
const MAX_URL_CHARS = 6_000
const MAX_BATCH_ITEMS = 12

/** 目标语言在设置里存的是代码，传给 provider 的却是显示名；这里认回去。 */
function targetCode(name: string): string {
  return TARGET_LANGUAGES.find((item) => item.name === name || item.code === name)?.code ?? 'zh-CN'
}

// --- 纯解析 ------------------------------------------------------------------

export interface GoogleDictGroup {
  partOfSpeech: string
  terms: string[]
  /** 第一个译名的回译——也就是同义词。 */
  reverse: string[]
}

export interface GoogleSingle {
  translation: string
  dict: GoogleDictGroup[]
  definitions: Array<{ partOfSpeech: string; gloss: string }>
  examples: string[]
  source: string
}

/** `translate_a/single?dj=1` 的返回。缺什么就空什么，绝不抛。 */
export function parseSingle(raw: unknown): GoogleSingle {
  const data = (raw ?? {}) as Record<string, unknown>
  const sentences = Array.isArray(data['sentences']) ? (data['sentences'] as Array<Record<string, unknown>>) : []
  const translation = sentences
    .map((item) => (typeof item['trans'] === 'string' ? item['trans'] : ''))
    .join('')
    .trim()

  const dict = (Array.isArray(data['dict']) ? (data['dict'] as Array<Record<string, unknown>>) : []).map(
    (group) => {
      const entries = Array.isArray(group['entry']) ? (group['entry'] as Array<Record<string, unknown>>) : []
      const first = entries[0]
      return {
        partOfSpeech: typeof group['pos'] === 'string' ? group['pos'] : '',
        terms: Array.isArray(group['terms']) ? (group['terms'] as unknown[]).filter(isString) : [],
        reverse:
          first && Array.isArray(first['reverse_translation'])
            ? (first['reverse_translation'] as unknown[]).filter(isString)
            : [],
      }
    },
  )

  const definitions: GoogleSingle['definitions'] = []
  for (const group of Array.isArray(data['definitions'])
    ? (data['definitions'] as Array<Record<string, unknown>>)
    : []) {
    const pos = typeof group['pos'] === 'string' ? group['pos'] : ''
    for (const entry of Array.isArray(group['entry']) ? (group['entry'] as Array<Record<string, unknown>>) : []) {
      if (typeof entry['gloss'] === 'string' && entry['gloss'].trim()) {
        definitions.push({ partOfSpeech: pos, gloss: entry['gloss'].trim() })
      }
    }
  }

  const examplesRaw = (data['examples'] as Record<string, unknown> | undefined)?.['example']
  const examples = (Array.isArray(examplesRaw) ? (examplesRaw as Array<Record<string, unknown>>) : [])
    .map((item) => (typeof item['text'] === 'string' ? stripTags(item['text']) : ''))
    .filter(Boolean)

  return {
    translation,
    dict,
    definitions,
    examples,
    source: typeof data['src'] === 'string' ? data['src'] : '',
  }
}

/**
 * `translate_a/t` 的返回。带 `sl=auto` 时每一项是 `["译文", "en"]`，
 * 指定了源语言时是裸字符串；两种都认。数量对不上就返回 null，让调用方逐条重来。
 */
export function parseBatch(raw: unknown, expected: number): string[] | null {
  if (!Array.isArray(raw)) return null
  const items = raw.map((item) => {
    if (typeof item === 'string') return item
    if (Array.isArray(item) && typeof item[0] === 'string') return item[0]
    return null
  })
  if (items.length !== expected || items.some((item) => item === null)) return null
  return items as string[]
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function stripTags(text: string): string {
  return text.replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim()
}

// --- 传输 --------------------------------------------------------------------

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    return await getJsonOnce<T>(url, signal)
  } catch (error) {
    if (!(error instanceof AIError) || !error.retryable || signal?.aborted) throw error
    await new Promise((resolve) => setTimeout(resolve, 600))
    return await getJsonOnce<T>(url, signal)
  }
}

async function getJsonOnce<T>(url: string, signal?: AbortSignal): Promise<T> {
  const signals = [AbortSignal.timeout(TIMEOUT_MS)]
  if (signal) signals.push(signal)
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.any(signals) })
  } catch (error) {
    throw toNetworkError(error, 'google', signal)
  }
  if (!response.ok) {
    throw new AIError(statusToCode(response.status), `Google Translate HTTP ${response.status}`, 'google', response.status)
  }
  const raw = await response.text()
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new AIError('bad_response', truncate(raw, 120), 'google', response.status)
  }
}

function singleUrl(text: string, sl: string, tl: string, parts: string[]): string {
  const params = new URLSearchParams({ client: 'gtx', sl, tl, dj: '1', q: text })
  for (const part of parts) params.append('dt', part)
  return `${BASE}/single?${params.toString()}`
}

function batchUrl(texts: string[], sl: string, tl: string): string {
  const params = new URLSearchParams({ client: 'gtx', sl, tl, format: 'text' })
  for (const text of texts) params.append('q', text)
  return `${BASE}/t?${params.toString()}`
}

// --- provider ----------------------------------------------------------------

export class GoogleFreeProvider implements AIProvider {
  readonly id = 'google' as const
  readonly label = 'Google Translate'
  readonly model = 'gtx'
  readonly offline = false
  readonly contextual = false

  async explainWord(input: ExplainWordInput, signal?: AbortSignal): Promise<WordExplanation> {
    const surface = input.text.trim()
    const kind = classifySelection(surface)
    const sl = input.languages?.source || 'auto'
    const tl = input.languages?.target || 'zh-CN'
    const context = (input.context ?? '').trim()
    const hint = t('free.context_hint')

    if (kind === 'sentence') {
      const res = parseSingle(await getJson(singleUrl(surface, sl, tl, ['t']), signal))
      return {
        word: surface,
        lemma: surface,
        kind,
        phonetic: '',
        partOfSpeech: '',
        cefr: '',
        meaning: res.translation,
        senses: [],
        contextMeaning: hint,
        englishDefinition: '',
        sentenceTranslation: res.translation,
        examples: [],
        synonyms: [],
      }
    }

    const wantsSentence = context.length > 0 && context !== surface
    const [word, sentence] = await Promise.all([
      getJson(singleUrl(surface, sl, tl, ['t', 'bd', 'md', 'ex']), signal).then(parseSingle),
      wantsSentence ? getJson(singleUrl(context, sl, tl, ['t']), signal).then(parseSingle) : null,
    ])

    const lemma = guessLemma(surface)
    const phrase = kind !== 'word'
    const primary = word.dict[0]
    const exampleCount = input.exampleCount ?? 3
    const exampleSentences = word.examples.slice(0, Math.max(0, exampleCount))
    // 例句是英文的，再花一次请求把它们翻过来；失败就只留原句，不让整张卡陪葬。
    const exampleTranslations =
      exampleSentences.length > 0
        ? await this.translateBatch({ texts: exampleSentences, targetLanguage: tl }, signal).catch(() =>
            exampleSentences.map(() => ''),
          )
        : []

    return {
      word: surface,
      lemma,
      kind,
      phonetic: '',
      partOfSpeech: primary?.partOfSpeech || (phrase ? 'phrase' : ''),
      cefr: '',
      meaning: word.translation || primary?.terms.slice(0, 3).join('；') || '',
      senses:
        word.dict.length >= 2
          ? word.dict
              .filter((group) => group.terms.length > 0)
              .map((group) => ({ partOfSpeech: group.partOfSpeech, meaning: group.terms.slice(0, 3).join('；') }))
          : [],
      contextMeaning: hint,
      englishDefinition: word.definitions[0]?.gloss ?? '',
      sentenceTranslation: sentence?.translation ?? '',
      examples: exampleSentences.map((sentenceText, index) => ({
        sentence: sentenceText,
        translation: exampleTranslations[index] ?? '',
      })),
      synonyms: (primary?.reverse ?? [])
        .filter((item) => item.toLowerCase() !== lemma && item.toLowerCase() !== surface.toLowerCase())
        .slice(0, 3)
        .map((item) => ({ word: item, meaning: primary?.terms[0] ?? '' })),
    }
  }

  async translate(input: TranslateInput, signal?: AbortSignal): Promise<TranslateResult> {
    const res = parseSingle(await getJson(singleUrl(input.text, 'auto', targetCode(input.targetLanguage), ['t']), signal))
    return { translation: res.translation }
  }

  async translateBatch(input: TranslateBatchInput, signal?: AbortSignal): Promise<string[]> {
    const tl = targetCode(input.targetLanguage)
    const out: string[] = []
    for (const chunk of chunkTexts(input.texts)) {
      const raw = await getJson(batchUrl(chunk, 'auto', tl), signal)
      const parsed = parseBatch(raw, chunk.length)
      if (parsed) {
        out.push(...parsed)
        continue
      }
      // 形状对不上就逐条来：一条一条的返回没有错位的可能。
      for (const text of chunk) {
        const res = parseSingle(await getJson(singleUrl(text, 'auto', tl, ['t']), signal))
        out.push(res.translation)
      }
    }
    return out
  }

  async generateExample(_input: GenerateExampleInput): Promise<GeneratedExample> {
    throw new AIError('refused', t('free.cannot_generate'), 'google')
  }

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummaryResult> {
    const { translation } = await this.translate(
      { text: input.text, targetLanguage: input.targetLanguage ?? 'zh-CN' },
      signal,
    )
    return { summary: translation, keyTerms: [] }
  }
}

/** 按条数和 URL 长度切批。 */
export function chunkTexts(texts: string[]): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0
  for (const text of texts) {
    const cost = encodeURIComponent(text).length + 3
    if (current.length > 0 && (current.length >= MAX_BATCH_ITEMS || length + cost > MAX_URL_CHARS)) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(text)
    length += cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}
