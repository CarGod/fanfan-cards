import { REVIEW_LOG_LIMIT, STORAGE_KEYS } from '@/shared/constants.ts'
import { dateKey, DAY_MS } from '@/shared/utils.ts'
import type { DailyActivity, ReviewLogEntry } from '@/types/vocabulary.ts'
import { storage } from '../area.ts'
import { withLock } from '../mutex.ts'

export type ActivityMap = Record<string, DailyActivity>

export async function readActivity(): Promise<ActivityMap> {
  return (await storage().get<ActivityMap>(STORAGE_KEYS.activity)) ?? {}
}

export async function bumpActivity(
  day: string,
  delta: Partial<Omit<DailyActivity, 'date'>>,
): Promise<void> {
  await withLock(STORAGE_KEYS.activity, async () => {
    const map = await readActivity()
    const current: DailyActivity = map[day] ?? { date: day, saved: 0, reviewed: 0, lookups: 0 }
    // Undo passes negatives; a counter that could go below zero would make the
    // dashboard lie in the other direction.
    const atLeastZero = (value: number) => Math.max(0, value)
    map[day] = {
      date: day,
      saved: atLeastZero(current.saved + (delta.saved ?? 0)),
      reviewed: atLeastZero(current.reviewed + (delta.reviewed ?? 0)),
      lookups: atLeastZero(current.lookups + (delta.lookups ?? 0)),
    }
    await storage().set(STORAGE_KEYS.activity, map)
  })
}

export async function appendReviewLog(entry: ReviewLogEntry): Promise<void> {
  await withLock(STORAGE_KEYS.reviewLog, async () => {
    const log = (await storage().get<ReviewLogEntry[]>(STORAGE_KEYS.reviewLog)) ?? []
    log.push(entry)
    const trimmed = log.length > REVIEW_LOG_LIMIT ? log.slice(-REVIEW_LOG_LIMIT) : log
    await storage().set(STORAGE_KEYS.reviewLog, trimmed)
  })
}

/** Used by undo; the log is append-only in every other path. */
export async function removeReviewLog(id: string): Promise<boolean> {
  return withLock(STORAGE_KEYS.reviewLog, async () => {
    const log = (await storage().get<ReviewLogEntry[]>(STORAGE_KEYS.reviewLog)) ?? []
    const next = log.filter((entry) => entry.id !== id)
    if (next.length === log.length) return false
    await storage().set(STORAGE_KEYS.reviewLog, next)
    return true
  })
}

export async function readReviewLog(): Promise<ReviewLogEntry[]> {
  return (await storage().get<ReviewLogEntry[]>(STORAGE_KEYS.reviewLog)) ?? []
}

/**
 * Merge a review log pulled from the repository into the local one.
 *
 * The repository is meant to *be* the learning record — 「commit 历史就是你的学习
 * 记录」 — but sync only ever wrote `meta/reviews.json`, never read it. So a
 * second device, whose local log starts empty, overwrote months of history with
 * its own short one on its first sync. Merging by id makes the union of both
 * devices the thing that gets committed.
 */
export async function mergeReviewLog(incoming: ReviewLogEntry[]): Promise<number> {
  if (incoming.length === 0) return 0
  return withLock(STORAGE_KEYS.reviewLog, async () => {
    const log = (await storage().get<ReviewLogEntry[]>(STORAGE_KEYS.reviewLog)) ?? []
    const byId = new Map(log.map((entry) => [entry.id, entry]))
    let added = 0
    for (const entry of incoming) {
      if (!entry?.id || byId.has(entry.id)) continue
      byId.set(entry.id, entry)
      added++
    }
    if (added === 0) return 0
    // Newest kept: the log is a rolling window, and an old entry arriving from
    // another device must not push out a recent one.
    const merged = [...byId.values()].sort((a, b) => a.reviewedAt - b.reviewedAt)
    const trimmed =
      merged.length > REVIEW_LOG_LIMIT ? merged.slice(-REVIEW_LOG_LIMIT) : merged
    await storage().set(STORAGE_KEYS.reviewLog, trimmed)
    return added
  })
}

/**
 * Merge daily activity pulled from the repository.
 *
 * Per day, per counter, the **larger** of the two wins rather than the sum.
 * Summing is not idempotent: syncing twice would double the numbers, and a
 * dashboard that inflates every half hour is worse than one that is slightly
 * conservative. The cost is real and worth stating — two devices used on the
 * same day show the busier one's count, not the total.
 */
export async function mergeActivity(incoming: DailyActivity[]): Promise<number> {
  if (incoming.length === 0) return 0
  return withLock(STORAGE_KEYS.activity, async () => {
    const map = await readActivity()
    let changed = 0
    for (const day of incoming) {
      if (!day?.date) continue
      const current = map[day.date] ?? { date: day.date, saved: 0, reviewed: 0, lookups: 0 }
      const next: DailyActivity = {
        date: day.date,
        saved: Math.max(current.saved, day.saved ?? 0),
        reviewed: Math.max(current.reviewed, day.reviewed ?? 0),
        lookups: Math.max(current.lookups, day.lookups ?? 0),
      }
      if (
        next.saved !== current.saved ||
        next.reviewed !== current.reviewed ||
        next.lookups !== current.lookups ||
        !map[day.date]
      ) {
        map[day.date] = next
        changed++
      }
    }
    if (changed > 0) await storage().set(STORAGE_KEYS.activity, map)
    return changed
  })
}

/**
 * Consecutive days with at least one action (a save or a review), counting back
 * from today. Today not being active yet does not break the streak - a streak
 * that dies at 00:01 punishes the user for sleeping.
 */
export function computeStreak(activity: ActivityMap, now: number = Date.now()): number {
  const active = (day: string): boolean => {
    const record = activity[day]
    return !!record && record.saved + record.reviewed > 0
  }

  let streak = 0
  let cursor = active(dateKey(now)) ? now : now - DAY_MS

  while (active(dateKey(cursor))) {
    streak++
    cursor -= DAY_MS
    if (streak > 3650) break
  }
  return streak
}

/** Last `days` calendar days, oldest first, with gaps filled by zeroes. */
export function recentDays(
  activity: ActivityMap,
  days: number,
  now: number = Date.now(),
): DailyActivity[] {
  const out: DailyActivity[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKey(now - i * DAY_MS)
    out.push(activity[key] ?? { date: key, saved: 0, reviewed: 0, lookups: 0 })
  }
  return out
}

export function todayActivity(activity: ActivityMap, now: number = Date.now()): DailyActivity {
  const key = dateKey(now)
  return activity[key] ?? { date: key, saved: 0, reviewed: 0, lookups: 0 }
}

export function activeDaysCount(activity: ActivityMap): number {
  return Object.values(activity).filter((day) => day.saved + day.reviewed > 0).length
}
