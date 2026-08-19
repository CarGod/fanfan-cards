import { describe, expect, it } from 'vitest'
import { resolveConflict } from './exportService.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'

const T = 1_000_000

function entry(patch: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id: 'w1',
    word: 'migration',
    normalized: 'migration',
    lemma: 'migration',
    kind: 'word',
    phonetic: '',
    partOfSpeech: '',
    cefr: '',
    meaning: '迁移',
    aiExplanation: '',
    englishDefinition: '',
    sentenceTranslation: '',
    examples: [],
    synonyms: [],
    source: { url: '', title: '', context: '', wideContext: '', capturedAt: T },
    origin: { providerId: 'mock', model: 'x', offline: true },
    review: {
      level: 0,
      status: 'new',
      dueAt: T,
      lastReviewedAt: null,
      reviewCount: 0,
      lapses: 0,
      streak: 0,
    },
    tags: [],
    notes: '',
    favorite: false,
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
    ...patch,
  }
}

/**
 * Two machines, one library. These rules are what stop the second machine from
 * quietly undoing what you did on the first.
 */
describe('resolveConflict', () => {
  it('keeps the copy with more review history when neither was deleted', () => {
    const local = entry({ review: { ...entry().review, reviewCount: 5 } })
    const remote = entry({ review: { ...entry().review, reviewCount: 1 } })
    expect(resolveConflict(local, remote)).toBe(local)
    expect(resolveConflict(remote, local)).toBe(local)
  })

  // The bug this exists for: delete a word on the laptop, and the desktop —
  // which never saw the deletion — pushes it straight back.
  it('propagates a deletion to the device that still has the word', () => {
    const deletedHere = entry({ deletedAt: T + 500, updatedAt: T + 500 })
    const stillThere = entry({ updatedAt: T })
    expect(resolveConflict(deletedHere, stillThere)).toBe(deletedHere)
    expect(resolveConflict(stillThere, deletedHere)).toBe(deletedHere)
  })

  // …but a deletion must not be able to undo a later re-save, or a word the
  // user deliberately looked up again would vanish on the next sync.
  it('lets a newer save win over an older deletion', () => {
    const oldTombstone = entry({ deletedAt: T, updatedAt: T })
    const resaved = entry({ updatedAt: T + 5000 })
    expect(resolveConflict(oldTombstone, resaved)).toBe(resaved)
    expect(resolveConflict(resaved, oldTombstone)).toBe(resaved)
  })

  it('keeps a deletion when both sides deleted it', () => {
    const a = entry({ deletedAt: T + 1, updatedAt: T + 1 })
    const b = entry({ deletedAt: T + 2, updatedAt: T + 2 })
    expect(resolveConflict(a, b).deletedAt).toBeTruthy()
  })
})
