import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { getEntry, saveEntry, updateEntry } from '@/storage/repositories/vocabularyRepo.ts'
import { saveSettings } from '@/storage/repositories/settingsRepo.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'

const explain = vi.fn()
vi.mock('./handlers/explain.ts', () => ({ handleExplain: (p: unknown) => explain(p) }))

const { handleEnrichEntry } = await import('./handlers/enrich.ts')
const { missingFields } = await import('@/shared/enrichment.ts')

/**
 * 把词卡上缺的那几项补回来。
 *
 * 缺是怎么来的：查询分两段发出去，例句、整句翻译、近义词属于第二段。读者手快，
 * 在第二段回来之前就按了收藏——存下的就是一张只有释义的卡。
 *
 * 这一条**会自动花读者的 API 额度**，所以约束比功能本身更该被钉住：
 * 不缺就不发、补不上不重写、已有的绝不覆盖。
 */

const input = (over: Record<string, unknown> = {}) => ({
  word: 'attention',
  lemma: 'attention',
  kind: 'word' as const,
  phonetic: '',
  partOfSpeech: 'noun',
  cefr: '' as const,
  meaning: '注意，注意力',
  senses: [],
  aiExplanation: '',
  englishDefinition: '',
  sentenceTranslation: '',
  examples: [],
  synonyms: [],
  source: {
    url: 'https://x.com',
    title: 'Nick on X',
    context: "In case you haven't been paying attention, ChatGPT Work now has...",
    wideContext: '',
  },
  origin: { providerId: 'deepseek', model: 'x', offline: false },
  ...over,
})

const extras = (over: Record<string, unknown> = {}) => ({
  explanation: {
    sentenceTranslation: '如果你还没注意到，ChatGPT Work 现在有…',
    examples: [{ sentence: 'Pay attention to the details.', translation: '注意细节。' }],
    synonyms: [{ word: 'focus', meaning: '专注，强调集中' }],
    ...over,
  },
  providerId: 'deepseek',
  model: 'x',
  offline: false,
  cached: false,
})

async function save(over: Record<string, unknown> = {}): Promise<VocabularyEntry> {
  const { entry } = await saveEntry(input(over) as never)
  return entry
}

beforeEach(async () => {
  explain.mockReset()
  setStorageAdapter(createMemoryAdapter())
  await saveSettings({ provider: 'deepseek' })
})

describe('哪些算缺', () => {
  it('第二段负责的三项，缺哪个报哪个', async () => {
    const entry = await save()
    expect(missingFields(entry, { exampleCount: 3 })).toEqual([
      'sentenceTranslation',
      'examples',
      'synonyms',
    ])
  })

  it('都齐了就一个都不报', async () => {
    const entry = await save({
      sentenceTranslation: '有了',
      examples: [{ sentence: 'a', translation: 'b' }],
      synonyms: [{ word: 'focus', meaning: '专注' }],
    })
    expect(missingFields(entry, { exampleCount: 3 })).toEqual([])
  })
})

describe('补全', () => {
  it('缺什么补什么，写回词卡', async () => {
    const entry = await save()
    explain.mockResolvedValue(extras())

    const result = await handleEnrichEntry({ id: entry.id })
    expect(result.filled.sort()).toEqual(['examples', 'sentenceTranslation', 'synonyms'])

    const stored = await getEntry(entry.id)
    expect(stored!.sentenceTranslation).toContain('如果你还没注意到')
    expect(stored!.examples).toHaveLength(1)
    expect(stored!.synonyms).toHaveLength(1)
  })

  /** 只发第二段。整张卡重查一遍是另一笔钱，而缺的从来只有这三项。 */
  it('只要第二段，不重新查整张卡', async () => {
    const entry = await save()
    explain.mockResolvedValue(extras())

    await handleEnrichEntry({ id: entry.id })
    expect(explain).toHaveBeenCalledTimes(1)
    expect(explain.mock.calls[0]![0].detail).toBe('extras')
  })

  /** 补充要贴着当初那句话，否则拿回来的是和这张卡毫无关系的通用例句。 */
  it('带上当初收藏时的那句原文', async () => {
    const entry = await save()
    explain.mockResolvedValue(extras())

    await handleEnrichEntry({ id: entry.id })
    expect(explain.mock.calls[0]![0].context).toContain("haven't been paying attention")
  })
})

describe('不该发的时候不发', () => {
  it('不缺就不发——翻翻模式的卖点是不调 AI', async () => {
    const entry = await save({
      sentenceTranslation: '有了',
      examples: [{ sentence: 'a', translation: 'b' }],
      synonyms: [{ word: 'focus', meaning: '专注' }],
    })

    const result = await handleEnrichEntry({ id: entry.id })
    expect(explain).not.toHaveBeenCalled()
    expect(result.filled).toEqual([])
  })

  /**
   * 没有当初那句原文就不补。
   * 脱离那句话去要，拿回来的是通用例句——而这张卡存在的全部意义就是那句话。
   */
  it('没有原文就不发', async () => {
    const entry = await save({
      source: { url: '', title: '', context: '', wideContext: '' },
    })
    const result = await handleEnrichEntry({ id: entry.id })
    expect(explain).not.toHaveBeenCalled()
    expect(result.filled).toEqual([])
  })

  /**
   * 读者把例句关了，那没有例句就是**对的**。
   *
   * 不看设置的话，他的每一张卡都会被永远判成缺——每换一个页面点开一次就发一次
   * 注定填不上任何东西的请求。而他恰恰是那个明确说过「我不要这个」的人。
   */
  it('例句关了之后，只缺例句的卡不再发请求', async () => {
    await saveSettings({ exampleCount: 0 })
    const entry = await save({
      sentenceTranslation: '有翻译',
      synonyms: [{ word: 'focus', meaning: '专注' }],
    })

    const result = await handleEnrichEntry({ id: entry.id })
    expect(explain).not.toHaveBeenCalled()
    expect(result.filled).toEqual([])
  })

  /** 整句卡的例句和近义词是提示词里写死为空的，永远补不上。 */
  it('整句卡只缺例句和近义词时不发请求', async () => {
    const entry = await save({ kind: 'sentence', sentenceTranslation: '有翻译' })
    const result = await handleEnrichEntry({ id: entry.id })
    expect(explain).not.toHaveBeenCalled()
    expect(result.filled).toEqual([])
  })

  it('词卡不在了就安静返回', async () => {
    const result = await handleEnrichEntry({ id: 'nope' })
    expect(explain).not.toHaveBeenCalled()
    expect(result.entry).toBeNull()
  })
})

describe('拿回来的东西不合用时', () => {
  /** 离线词典给不出第二段，写回空值只会让这张卡看起来「补过了但还是空的」。 */
  it('降级到离线词典时不写回', async () => {
    const entry = await save()
    explain.mockResolvedValue({ ...extras(), offline: true })

    const result = await handleEnrichEntry({ id: entry.id })
    expect(result.filled).toEqual([])
    expect((await getEntry(entry.id))!.sentenceTranslation).toBe('')
  })

  it('模型什么都没给时不写回，也不报错', async () => {
    const entry = await save()
    explain.mockResolvedValue(
      extras({ sentenceTranslation: '', examples: [], synonyms: [] }),
    )

    const result = await handleEnrichEntry({ id: entry.id })
    expect(result.filled).toEqual([])
  })

  /**
   * 已有的绝不覆盖。
   *
   * 卡上已经有的东西，是当初那次查询、或者读者自己编辑过的结果。一次「补全」
   * 把它们换成新生成的，是在他没要求的情况下改他的资料。
   */
  it('已经有的那几项一个都不动', async () => {
    const entry = await save({
      sentenceTranslation: '这是我自己写的翻译',
      synonyms: [{ word: 'mine', meaning: '我自己加的' }],
    })
    explain.mockResolvedValue(extras())

    await handleEnrichEntry({ id: entry.id })
    const stored = await getEntry(entry.id)
    expect(stored!.sentenceTranslation).toBe('这是我自己写的翻译')
    expect(stored!.synonyms).toEqual([{ word: 'mine', meaning: '我自己加的' }])
    // 只有当时确实空着的例句被补上了。
    expect(stored!.examples).toHaveLength(1)
  })
})

describe('并发与竞态', () => {
  /**
   * 内容脚本那份去重活不过一次页面跳转，而 service worker 是全局的。
   * 两个标签页几乎同时点开同一个词，不去重就是两次全价请求，
   * 而且后写的会盲覆盖先写的。
   */
  it('同一张卡在途只跑一次，第二个调用搭车', async () => {
    const entry = await save()
    let release: (v: unknown) => void = () => {}
    explain.mockReturnValue(new Promise((r) => { release = r }))

    const a = handleEnrichEntry({ id: entry.id })
    const b = handleEnrichEntry({ id: entry.id })
    release(extras())
    const [ra, rb] = await Promise.all([a, b])

    expect(explain).toHaveBeenCalledTimes(1)
    expect(ra.filled).toEqual(rb.filled)
  })

  it('跑完之后允许再跑（不是永久上锁）', async () => {
    const entry = await save()
    explain.mockResolvedValue(extras({ sentenceTranslation: '', examples: [], synonyms: [] }))

    await handleEnrichEntry({ id: entry.id })
    await handleEnrichEntry({ id: entry.id })
    expect(explain).toHaveBeenCalledTimes(2)
  })

  /**
   * 「缺不缺」是在网络往返**之前**算的，而这次往返可能要几十秒。
   *
   * 期间同步可能拉下来另一台设备补好的内容，读者也可能自己编辑过。
   * 拿几十秒前的判断原样写回，就是用模型输出覆盖掉这期间真实发生过的事。
   */
  it('在途期间别人填上了，就不再覆盖', async () => {
    const entry = await save()
    let release: (v: unknown) => void = () => {}
    explain.mockReturnValue(new Promise((r) => { release = r }))

    const task = handleEnrichEntry({ id: entry.id })
    // 请求还在飞的时候，同步把内容拉下来了。
    await updateEntry(entry.id, { sentenceTranslation: '另一台设备补好的翻译' })
    release(extras())
    const result = await task

    expect(result.filled).not.toContain('sentenceTranslation')
    expect((await getEntry(entry.id))!.sentenceTranslation).toBe('另一台设备补好的翻译')
  })
})
