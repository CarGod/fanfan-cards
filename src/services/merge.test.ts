import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { listAllEntries, mergeEntries } from '@/storage/repositories/vocabularyRepo.ts'
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
    senses: [],
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

describe('合并结果必须真的落地', () => {
  /**
   * 这一组钉的是一个真实存在过的 bug，而它的坏法是**静默的**。
   *
   * `mergeEntries` 曾经拿 `decide()` 的返回值和两个入参比**引用**：
   * `winner === entry ? {...entry} : existing`。而 `resolveConflict` 在最常见的
   * 那条路上返回的是一个新对象（编辑取较新一方、复习状态取较近一次、计数取最大值）——
   * 两个引用判断同时不成立，于是落到 `existing`：逐字段合出来的结果被整个丢掉。
   *
   * 后果是同步只剩下删除还有效。另一台设备上写的笔记、改过的释义、攒下的复习进度，
   * 拉下来之后一律消失，而两边都显示「同步成功」。
   *
   * 单测 `resolveConflict` 本身是发现不了的——它一直是对的，错的是没人用它的结果。
   * 所以这几条走的是 `mergeEntries`，看的是**存进去之后**读出来是什么。
   */
  const stored = async () => (await listAllEntries())[0]!

  beforeEach(() => setStorageAdapter(createMemoryAdapter()))

  it('远端更新的编辑要被采纳', async () => {
    await mergeEntries([entry({ notes: '本地笔记', updatedAt: 100 })], resolveConflict)
    await mergeEntries(
      [entry({ id: 'w-remote', notes: '手机上写的笔记', updatedAt: 999 })],
      resolveConflict,
    )
    expect((await stored()).notes).toBe('手机上写的笔记')
  })

  it('远端的复习进度要被采纳', async () => {
    await mergeEntries([entry({ updatedAt: 100 })], resolveConflict)
    await mergeEntries(
      [
        entry({
          id: 'w-remote',
          updatedAt: 999,
          review: {
            level: 2,
            status: 'familiar',
            dueAt: 0,
            lastReviewedAt: 500,
            reviewCount: 7,
            lapses: 1,
            streak: 3,
          },
        }),
      ],
      resolveConflict,
    )
    expect((await stored()).review.reviewCount).toBe(7)
  })

  /** 计数取两边最大值——回退的计数在读者眼里就是数据丢了。 */
  it('两边的复习次数取最大值，而不是被某一边覆盖', async () => {
    await mergeEntries(
      [
        entry({
          updatedAt: 999,
          review: { level: 1, status: 'learning', dueAt: 0, lastReviewedAt: 900, reviewCount: 9, lapses: 0, streak: 1 },
        }),
      ],
      resolveConflict,
    )
    await mergeEntries(
      [
        entry({
          id: 'w-remote',
          updatedAt: 100,
          review: { level: 3, status: 'mastered', dueAt: 0, lastReviewedAt: 50, reviewCount: 20, lapses: 4, streak: 5 },
        }),
      ],
      resolveConflict,
    )
    const out = await stored()
    expect(out.review.reviewCount).toBe(20)
    expect(out.review.lapses).toBe(4)
  })

  /** id 沿用本地那份：换成远端的会让复习记录和开着的卡片全部指空。 */
  it('合并之后 id 还是本地那一个', async () => {
    await mergeEntries([entry({ id: 'local-id', updatedAt: 100 })], resolveConflict)
    await mergeEntries([entry({ id: 'remote-id', updatedAt: 999 })], resolveConflict)
    expect((await stored()).id).toBe('local-id')
  })
})
