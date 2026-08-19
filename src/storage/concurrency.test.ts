import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { importSnapshot, buildSnapshot } from '@/services/exportService.ts'
import { keepOnly, listAllEntries, saveEntry } from '@/storage/repositories/vocabularyRepo.ts'

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
