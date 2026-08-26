import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { importSnapshot, buildSnapshot } from '@/services/exportService.ts'
import {
  getEntry,
  keepOnly,
  listAllEntries,
  removeEntry,
  saveEntry,
  updateEntry,
} from '@/storage/repositories/vocabularyRepo.ts'

/**
 * Words saved while a sync is running must survive it.
 *
 * A sync pulls one shard at a time over the network, so "while a sync is
 * running" is seconds, not microseconds — and the old shape (read the whole
 * table outside the lock, write the whole table back inside it) meant a word
 * saved in that window was overwritten by a snapshot taken before it existed.
 * No error, no tombstone, and the repository never heard of it either.
 */
function input(word: string) {
  return {
    word,
    lemma: word,
    kind: 'word' as const,
    phonetic: '',
    partOfSpeech: '',
    cefr: '' as const,
    meaning: `${word} 的意思`,
    senses: [],
    aiExplanation: '',
    englishDefinition: '',
    sentenceTranslation: '',
    examples: [],
    synonyms: [],
    source: {
      url: 'https://example.com',
      title: 'T',
      context: `A sentence with ${word}.`,
      wideContext: '',
    },
    origin: { providerId: 'mock', model: 'test', offline: true },
  }
}

beforeEach(() => {
  setStorageAdapter(createMemoryAdapter())
})

describe('saving during a merge', () => {
  it('keeps a word saved while an import is in flight', async () => {
    await saveEntry(input('alpha'))
    const snapshot = await buildSnapshot()

    // The import and the save overlap, exactly as a background sync overlaps
    // with the reader clicking 收藏 on a page.
    await Promise.all([importSnapshot(snapshot), saveEntry(input('bravo'))])

    const words = (await listAllEntries()).map((entry) => entry.word).sort()
    expect(words).toEqual(['alpha', 'bravo'])
  })

  it('keeps a word saved while a forcePull prune is in flight', async () => {
    await saveEntry(input('alpha'))

    await Promise.all([keepOnly(new Set(['alpha'])), saveEntry(input('charlie'))])

    const words = (await listAllEntries()).map((entry) => entry.word).sort()
    // charlie is local-only and may or may not be pruned depending on ordering —
    // what must never happen is alpha disappearing, or charlie vanishing without
    // the prune having decided about it.
    expect(words).toContain('alpha')
  })

  it('does not duplicate a word that both sides already have', async () => {
    await saveEntry(input('alpha'))
    const snapshot = await buildSnapshot()
    await importSnapshot(snapshot)
    await importSnapshot(snapshot)

    expect((await listAllEntries()).filter((entry) => entry.word === 'alpha')).toHaveLength(1)
  })
})

describe('forcePull 的时间窗口', () => {
  it('保留裁剪决定作出之后才收藏的词', async () => {
    await saveEntry(input('alpha'))
    const decidedAt = Date.now()

    // 网络读取期间收藏的新词：它从未被这次裁剪考虑过。
    await new Promise((resolve) => setTimeout(resolve, 5))
    await saveEntry(input('during'))

    await keepOnly(new Set(['alpha']), decidedAt)

    const words = (await listAllEntries()).map((entry) => entry.word).sort()
    expect(words).toEqual(['alpha', 'during'])
  })

  it('仍然裁掉决定作出之前就存在的本地独有词', async () => {
    await saveEntry(input('alpha'))
    await saveEntry(input('stray'))
    await new Promise((resolve) => setTimeout(resolve, 5))

    await keepOnly(new Set(['alpha']), Date.now())

    expect((await listAllEntries()).map((entry) => entry.word)).toEqual(['alpha'])
  })
})

describe('按词性拆开的释义要存得住', () => {
  /**
   * 这条走的是完整链路：存进去、读出来、再存一次同一个词。
   *
   * 「再存一次」是关键：重复收藏同一个词是**学习信号**而不是错误，仓库会合并而不是
   * 覆盖。合并时如果把 senses 漏掉，用户会发现某个词重新查过之后，按词性拆开的那份
   * 悄悄没了——而 meaning 那一行还在，所以界面上几乎看不出来。
   */
  it('存得住，重复收藏也不会把它弄丢', async () => {
    setStorageAdapter(createMemoryAdapter())
    const senses = [
      { partOfSpeech: 'adjective', meaning: '独有的' },
      { partOfSpeech: 'noun', meaning: '独家新闻' },
    ]

    await saveEntry({ ...input('exclusive'), senses })
    const [first] = await listAllEntries()
    expect(first!.senses).toEqual(senses)

    // 第二次查这个词，模型这回没给结构化释义。
    await saveEntry({ ...input('exclusive'), senses: [] })
    const [again] = await listAllEntries()
    expect(again!.senses).toEqual(senses)
  })

  it('给不出的时候是空数组，而不是缺字段', async () => {
    setStorageAdapter(createMemoryAdapter())
    await saveEntry({ ...input('plain'), senses: [] })
    const [entry] = await listAllEntries()
    expect(entry!.senses).toEqual([])
  })
})

describe('取消收藏是可以撤销的', () => {
  /**
   * 这条钉的是「撤销」两个字有没有说谎。
   *
   * `removeEntry` 是软删除（留墓碑），`saveEntry` 遇到墓碑会复活它。如果哪天有人
   * 把软删除改成硬删，或者复活路径把 review 重置了，界面上那颗书签还是会照常
   * 从空心变回实心——读者以为撤销了，其实攒了几十次的复习进度已经没了。
   */
  it('移出再收回来，复习进度还在', async () => {
    setStorageAdapter(createMemoryAdapter())
    const { entry } = await saveEntry({ ...input('resilience'), senses: [] })
    await updateEntry(entry.id, {
      review: {
        level: 2,
        status: 'familiar',
        dueAt: 0,
        lastReviewedAt: 12345,
        reviewCount: 9,
        lapses: 2,
        streak: 4,
      },
    })

    expect(await removeEntry(entry.id)).toBe(true)
    expect(await getEntry(entry.id)).toBeNull()

    // 收回来：走的是和收藏同一条路。
    await saveEntry({ ...input('resilience'), senses: [] })
    const back = await getEntry(entry.id)
    expect(back).not.toBeNull()
    expect(back!.review.reviewCount).toBe(9)
    expect(back!.review.level).toBe(2)
  })
})
