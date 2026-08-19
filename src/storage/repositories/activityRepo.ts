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
