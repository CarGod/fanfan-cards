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
  it('keeps the copy with more review history when the edits are the same age', () => {
    const local = entry({ review: { ...entry().review, reviewCount: 5 } })
    const remote = entry({ review: { ...entry().review, reviewCount: 1 } })
    expect(resolveConflict(local, remote).review.reviewCount).toBe(5)
    expect(resolveConflict(remote, local).review.reviewCount).toBe(5)
  })

  /*
   * The bug this exists for: write a note on the laptop, review the same word
   * twice on the phone, sync — and the note is gone, because the copy with more
   * reviews used to win outright.
   */
  it('never lets review history overwrite a newer edit', () => {
    const edited = entry({
      notes: '这里指数据库迁移，不是人口迁徙',
      updatedAt: T + 5000,
      review: { ...entry().review, reviewCount: 2 },
    })
    const reviewed = entry({
      notes: '',
      updatedAt: T,
      review: { ...entry().review, reviewCount: 9 },
    })

    for (const merged of [resolveConflict(edited, reviewed), resolveConflict(reviewed, edited)]) {
      expect(merged.notes).toBe('这里指数据库迁移，不是人口迁徙')
      // …and the reviews that really happened are still counted.
      expect(merged.review.reviewCount).toBe(9)
    }
  })

  it('follows the most recent review, not the highest level', () => {
    // Reviewed later and demoted: the schedule must follow that, or a word the
    // reader has just forgotten comes back marked as mastered.
    // The demoted copy must have *fewer* reviews than the mastered one, or the
    // fixture cannot tell "follow the latest review" apart from "follow the
    // bigger counter" — and a test that both rules pass proves nothing.
    const mastered = entry({
      review: { ...entry().review, level: 3, reviewCount: 9, lastReviewedAt: T },
    })
    const demoted = entry({
      review: { ...entry().review, level: 1, reviewCount: 4, lastReviewedAt: T + 9000 },
    })

    expect(resolveConflict(mastered, demoted).review.level).toBe(1)
    expect(resolveConflict(demoted, mastered).review.level).toBe(1)
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
