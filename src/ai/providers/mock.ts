import { classifySelection, normalizeWord, truncate } from '@/shared/utils.ts'
import type {
  AIProvider,
  CefrLevel,
  ExplainWordInput,
  GenerateExampleInput,
  GeneratedExample,
  SummarizeInput,
  SummaryResult,
  TranslateBatchInput,
  TranslateInput,
  TranslateResult,
  WordExplanation,
} from '@/types/ai.ts'

/**
 * Offline provider — the default, so the product is fully explorable with zero
 * setup (install, select a word, save, review). It is deliberately *honest*:
 * it never pretends to have understood the context, it tells the user what it
 * can and cannot do and points at the settings page.
 *
 * It also doubles as the fallback when a configured provider fails, so a dead
 * API key degrades the experience instead of breaking it.
 */

interface DictEntry {
  phonetic: string
  pos: string
  cefr: CefrLevel
  meaning: string
  english: string
  example: string
  exampleZh: string
  synonyms: Array<{ word: string; meaning: string }>
  /** Domain note surfaced as the "contextual" reading when the word is polysemous. */
  note?: string
}

/**
 * A small seed dictionary skewed towards what the target user actually meets:
 * engineering docs, READMEs, tech news. Not a general dictionary and does not
 * pretend to be one.
 */
const DICTIONARY: Record<string, DictEntry> = {
  migration: {
    cefr: 'B2',
    phonetic: '/maɪˈɡreɪʃn/',
    pos: 'noun',
    meaning: '迁移；移民',
    english: 'the process of moving from one place, system, or version to another',
    example: 'We scheduled the database migration for Sunday night.',
    exampleZh: '我们把数据库迁移安排在周日晚上。',
    synonyms: [{ word: 'transfer', meaning: '' }, { word: 'move', meaning: '' }, { word: 'shift', meaning: '' }],
    note: '在软件语境中通常指数据库结构或数据从旧版本迁移到新版本，而非人口迁徙。',
  },
  deprecated: {
    cefr: 'C1',
    phonetic: '/ˈdeprəkeɪtɪd/',
    pos: 'adjective',
    meaning: '已弃用的；不推荐使用的',
    english: 'still available but no longer recommended, and likely to be removed',
    example: 'This flag is deprecated and will be removed in the next major release.',
    exampleZh: '这个参数已弃用，将在下一个大版本中移除。',
    synonyms: [{ word: 'obsolete', meaning: '' }, { word: 'outdated', meaning: '' }],
    note: '不等于"已删除"：功能通常还能用，但官方不再推荐，未来会移除。',
  },
  rollback: {
    cefr: 'C1',
    phonetic: '/ˈroʊlbæk/',
    pos: 'noun',
    meaning: '回滚；撤销',
    english: 'returning a system to a previous known-good state',
    example: 'The rollback took five minutes and restored the previous build.',
    exampleZh: '这次回滚花了五分钟，恢复到了上一个构建版本。',
    synonyms: [{ word: 'revert', meaning: '' }, { word: 'undo', meaning: '' }],
  },
  throttle: {
    cefr: 'C1',
    phonetic: '/ˈθrɑːtl/',
    pos: 'verb',
    meaning: '限流；节流',
    english: 'to deliberately limit the rate at which something happens',
    example: 'The API throttles clients that exceed 100 requests per minute.',
    exampleZh: '该 API 会对每分钟超过 100 次请求的客户端限流。',
    synonyms: [{ word: 'limit', meaning: '' }, { word: 'restrict', meaning: '' }],
  },
  overhead: {
    cefr: 'B2',
    phonetic: '/ˈoʊvərhed/',
    pos: 'noun',
    meaning: '额外开销；管理费用',
    english: 'extra cost in time, memory, or money that is not the useful work itself',
    example: 'Serialization adds noticeable overhead on every request.',
    exampleZh: '序列化会给每个请求带来明显的额外开销。',
    synonyms: [{ word: 'cost', meaning: '' }, { word: 'burden', meaning: '' }],
    note: '技术语境里多指性能/资源开销，而非会计上的"间接费用"。',
  },
  legacy: {
    cefr: 'B2',
    phonetic: '/ˈleɡəsi/',
    pos: 'adjective',
    meaning: '遗留的；老旧的',
    english: 'inherited from an older system and kept for compatibility',
    example: 'The legacy service still handles about ten percent of the traffic.',
    exampleZh: '这个遗留服务仍然承担大约一成的流量。',
    synonyms: [{ word: 'inherited', meaning: '' }, { word: 'outdated', meaning: '' }],
    note: '在技术文档里几乎总是"遗留系统"的意思，带轻微贬义，而非"遗产"。',
  },
  robust: {
    cefr: 'B2',
    phonetic: '/roʊˈbʌst/',
    pos: 'adjective',
    meaning: '健壮的；稳健的',
    english: 'able to keep working correctly under difficult or unexpected conditions',
    example: 'The parser is robust enough to survive malformed input.',
    exampleZh: '这个解析器足够健壮，能处理格式错误的输入。',
    synonyms: [{ word: 'resilient', meaning: '' }, { word: 'sturdy', meaning: '' }],
  },
  leverage: {
    cefr: 'C1',
    phonetic: '/ˈlevərɪdʒ/',
    pos: 'verb',
    meaning: '利用；借助',
    english: 'to use something you already have to get a better result',
    example: 'We leverage the existing cache instead of adding a new service.',
    exampleZh: '我们借助已有的缓存，而不是新增一个服务。',
    synonyms: [{ word: 'utilize', meaning: '' }, { word: 'exploit', meaning: '' }],
  },
  bottleneck: {
    cefr: 'B2',
    phonetic: '/ˈbɑːtlnek/',
    pos: 'noun',
    meaning: '瓶颈',
    english: 'the one part of a system that limits overall performance',
    example: 'Disk I/O turned out to be the real bottleneck.',
    exampleZh: '结果发现磁盘 I/O 才是真正的瓶颈。',
    synonyms: [{ word: 'constraint', meaning: '' }, { word: 'chokepoint', meaning: '' }],
  },
  idempotent: {
    cefr: 'C2',
    phonetic: '/aɪˈdempətənt/',
    pos: 'adjective',
    meaning: '幂等的',
    english: 'safe to apply more than once with the same end result',
    example: 'Make the endpoint idempotent so retries are safe.',
    exampleZh: '把这个接口做成幂等的，这样重试才安全。',
    synonyms: [],
  },
  arbitrary: {
    cefr: 'B2',
    phonetic: '/ˈɑːrbətreri/',
    pos: 'adjective',
    meaning: '任意的；武断的',
    english: 'chosen without a specific reason, or allowing any value',
    example: 'The limit of 512 characters is arbitrary but works in practice.',
    exampleZh: '512 字符这个上限是随意定的，但实践中够用。',
    synonyms: [{ word: 'random', meaning: '' }, { word: 'unconstrained', meaning: '' }],
  },
  concurrency: {
    cefr: 'C1',
    phonetic: '/kənˈkʌrənsi/',
    pos: 'noun',
    meaning: '并发',
    english: 'dealing with several tasks that overlap in time',
    example: 'Concurrency is not the same thing as parallelism.',
    exampleZh: '并发和并行不是一回事。',
    synonyms: [],
  },
  trivial: {
    cefr: 'B2',
    phonetic: '/ˈtrɪviəl/',
    pos: 'adjective',
    meaning: '微不足道的；很简单的',
    english: 'so small or simple that it needs no effort or attention',
    example: 'The fix is trivial once you find the right line.',
    exampleZh: '一旦找到那一行，修复就很简单了。',
    synonyms: [{ word: 'minor', meaning: '' }, { word: 'negligible', meaning: '' }],
  },
  compelling: {
    cefr: 'C1',
    phonetic: '/kəmˈpelɪŋ/',
    pos: 'adjective',
    meaning: '有说服力的；引人入胜的',
    english: 'convincing, or so interesting that it holds your attention',
    example: 'They made a compelling case for rewriting the module.',
    exampleZh: '他们给出了一个很有说服力的重写该模块的理由。',
    synonyms: [{ word: 'persuasive', meaning: '' }, { word: 'convincing', meaning: '' }],
  },
  nuance: {
    cefr: 'C1',
    phonetic: '/ˈnuːɑːns/',
    pos: 'noun',
    meaning: '细微差别',
    english: 'a small difference in meaning that matters',
    example: 'That nuance is easy to miss in translation.',
    exampleZh: '这个细微差别在翻译中很容易丢失。',
    synonyms: [{ word: 'subtlety', meaning: '' }],
  },
}

const SUFFIX_POS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(ing)$/, 'verb / gerund'],
  [/(tion|sion|ment|ness|ity|ance|ence)$/, 'noun'],
  [/(ous|ive|able|ible|al|ful|less|ic)$/, 'adjective'],
  [/(ly)$/, 'adverb'],
  [/(ed)$/, 'verb (past)'],
]

function guessPartOfSpeech(word: string): string {
  for (const [pattern, pos] of SUFFIX_POS) {
    if (pattern.test(word)) return pos
  }
  return ''
}

/** Crude lemmatiser, good enough to hit the seed dictionary more often. */
export function guessLemma(word: string): string {
  const w = normalizeWord(word)
  if (DICTIONARY[w]) return w
  const rules: ReadonlyArray<readonly [RegExp, string]> = [
    [/ies$/, 'y'],
    [/([^aeiou])es$/, '$1'],
    [/s$/, ''],
    [/ing$/, ''],
    [/ed$/, ''],
  ]
  for (const [pattern, replacement] of rules) {
    if (pattern.test(w)) {
      const candidate = w.replace(pattern, replacement)
      if (DICTIONARY[candidate]) return candidate
      if (DICTIONARY[`${candidate}e`]) return `${candidate}e`
    }
  }
  return w
}

const OFFLINE_HINT = '（离线词典模式：未配置 API Key，无法结合上下文推断。到设置页填入任一模型的 Key 即可获得语境解释。）'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class MockProvider implements AIProvider {
  readonly id = 'mock' as const
  readonly label = '离线词典'
  readonly model = 'local-heuristic-v1'
  readonly offline = true

  async explainWord(input: ExplainWordInput): Promise<WordExplanation> {
    await delay(120)
    // The seed dictionary is Chinese-only; for any other target the English
    // definition is the honest thing to show rather than a mismatched gloss.
    const chineseTarget = !input.languages || input.languages.target.startsWith('zh')
    const surface = input.text.trim()
    const normalized = normalizeWord(surface)
    const lemma = guessLemma(surface)
    const hit = DICTIONARY[lemma]
    const kind = classifySelection(surface)
    const phrase = kind !== 'word'

    if (hit) {
      const contextual = hit.note
        ? `${hit.note}\n本次出现在：「${truncate(input.context || surface, 120)}」`
        : `此处就是常见含义：${hit.meaning}。本次出现在：「${truncate(input.context || surface, 120)}」`
      return {
        word: surface,
        lemma,
        kind,
        phonetic: hit.phonetic,
        partOfSpeech: hit.pos,
        cefr: hit.cefr,
        meaning: chineseTarget ? hit.meaning : hit.english,
        // 离线词典每个词条只有一个义项，没有可拆的词性。
        senses: [],
        contextMeaning: chineseTarget
          ? `${contextual}\n${OFFLINE_HINT}`
          : `Offline dictionary: Chinese glosses only. Configure an API key for a real contextual explanation.\nSeen in: "${truncate(input.context || surface, 120)}"`,
        englishDefinition: hit.english,
        sentenceTranslation: '',
        examples: [{ sentence: hit.example, translation: hit.exampleZh }],
        synonyms: hit.synonyms,
      }
    }

    return {
      word: surface,
      lemma,
      kind,
      phonetic: '',
      partOfSpeech: phrase ? 'phrase' : guessPartOfSpeech(normalized),
      cefr: '',
      meaning: phrase ? '离线词典未收录该短语' : '离线词典未收录该词',
      senses: [],
      contextMeaning: `原句：「${truncate(input.context || surface, 160)}」\n${OFFLINE_HINT}`,
      englishDefinition: '',
      sentenceTranslation: '',
      examples: [],
      synonyms: [],
    }
  }

  async translate(input: TranslateInput): Promise<TranslateResult> {
    await delay(80)
    const lemma = guessLemma(input.text)
    const hit = DICTIONARY[lemma]
    return {
      translation: hit ? hit.meaning : `[离线模式] ${input.text}`,
      note: hit ? '' : '离线词典无法翻译整句，请配置模型 API Key。',
    }
  }

  async translateBatch(input: TranslateBatchInput): Promise<string[]> {
    await delay(60)
    // No offline engine can translate arbitrary prose. Saying so on every
    // paragraph is better than filling the page with plausible nonsense.
    return input.texts.map(() => '[离线词典无法翻译整段文字，请在设置页配置模型 API Key]')
  }

  async generateExample(input: GenerateExampleInput): Promise<GeneratedExample> {
    await delay(80)
    const hit = DICTIONARY[guessLemma(input.word)]
    if (hit) return { sentence: hit.example, translation: hit.exampleZh }
    return {
      sentence: `The word "${input.word}" appeared in something I was reading today.`,
      translation: `今天阅读时遇到了 "${input.word}" 这个词。`,
    }
  }

  async summarize(input: SummarizeInput): Promise<SummaryResult> {
    await delay(80)
    const sentences = input.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      summary: `[离线模式] 共 ${sentences.length} 句，首句：${truncate(sentences[0] ?? '', 120)}`,
      keyTerms: [],
    }
  }
}

export const OFFLINE_DICTIONARY_SIZE = Object.keys(DICTIONARY).length
