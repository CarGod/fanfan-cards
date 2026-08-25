import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import {
  appendReviewLog,
  bumpActivity,
  mergeActivity,
  mergeReviewLog,
  readActivity,
  readReviewLog,
} from '@/storage/repositories/activityRepo.ts'
import type { ReviewLogEntry } from '@/types/vocabulary.ts'

/**
 * The repository is meant to *be* the learning record. Sync used to write
 * `meta/reviews.json` and `meta/activity.json` on every run and read them on
 * none — so a second device, starting with an empty local log, replaced months
 * of history with its own on its first push.
 */
const review = (id: string, at: number): ReviewLogEntry => ({
  id,
  entryId: `e-${id}`,
  word: id,
  grade: 'good',
  levelBefore: 1,
  levelAfter: 2,
  reviewedAt: at,
})

beforeEach(() => {
  setStorageAdapter(createMemoryAdapter())
})

describe('mergeReviewLog', () => {
  it('takes the union of both devices rather than replacing', async () => {
    await appendReviewLog(review('local', 1000))
    const added = await mergeReviewLog([review('remote', 500), review('local', 1000)])

    expect(added).toBe(1)
    expect((await readReviewLog()).map((entry) => entry.id)).toEqual(['remote', 'local'])
  })

  it('is idempotent — syncing twice adds nothing', async () => {
    await mergeReviewLog([review('a', 1)])
    await mergeReviewLog([review('a', 1)])
    expect(await readReviewLog()).toHaveLength(1)
  })
})

describe('mergeActivity', () => {
  it('keeps the larger count per day rather than replacing', async () => {
    await bumpActivity('2026-08-19', { saved: 5, reviewed: 1 })
    await mergeActivity([{ date: '2026-08-19', saved: 2, reviewed: 9, lookups: 3 }])

    const map = await readActivity()
    expect(map['2026-08-19']).toMatchObject({ saved: 5, reviewed: 9, lookups: 3 })
  })

  it('is idempotent — the dashboard does not inflate every sync', async () => {
    const day = [{ date: '2026-08-19', saved: 4, reviewed: 4, lookups: 0 }]
    await mergeActivity(day)
    await mergeActivity(day)
    expect((await readActivity())['2026-08-19']).toMatchObject({ saved: 4, reviewed: 4 })
  })

  it('adopts days this device has never seen', async () => {
    await mergeActivity([{ date: '2026-08-01', saved: 3, reviewed: 0, lookups: 0 }])
    expect(Object.keys(await readActivity())).toEqual(['2026-08-01'])
  })
})
