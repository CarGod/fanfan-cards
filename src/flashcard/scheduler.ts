import { DAY_MS, clamp } from '@/shared/utils.ts'
import type {
  FamiliarityLevel,
  ReviewGrade,
  ReviewState,
  VocabularyEntry,
} from '@/types/vocabulary.ts'
import { REVIEW_STATUS_BY_LEVEL } from '@/types/vocabulary.ts'

/**
 * A deliberately small spaced-repetition scheduler.
 *
 * SM-2 tracks an ease factor per card and needs a lot of reviews before its
 * numbers mean anything; with a hand-curated list of a few hundred words, a
 * four-level ladder is easier to reason about, easier to explain in the UI
 * ("陌生 / 学习中 / 熟悉 / 掌握"), and produces near-identical intervals for the
 * first month. The `streak` multiplier is what keeps well-known words from
 * coming back every week forever.
 *
 * Everything here is pure: `now` is injected, so the behaviour is testable and
 * the same function runs in the page and (later) during sync reconciliation.
 */

/** Base interval per level, in milliseconds. */
export const BASE_INTERVALS: Record<FamiliarityLevel, number> = {
  0: 10 * 60 * 1000, // 10 minutes — stay in this session
  1: 1 * DAY_MS,
  2: 3 * DAY_MS,
  3: 7 * DAY_MS,
}

const MAX_INTERVAL = 90 * DAY_MS

/**
 * Multiplier on every interval.
 *
 * The forgetting curve is personal: the same schedule that feels comfortable to
 * one reader has another forgetting words between reviews. Rather than pretend
 * to infer that from a few dozen grades, expose one honest knob.
 */
export type ReviewIntensity = 'relaxed' | 'standard' | 'intensive'

export const INTENSITY_SCALE: Record<ReviewIntensity, number> = {
  relaxed: 1.6,
  standard: 1,
  intensive: 0.6,
}

/**
 * Queue ordering. `curve` is the actual spaced-repetition mode; the rest are
 * different ways to walk the same set of due cards.
 */
export type ReviewMode = 'curve' | 'recent' | 'random' | 'hardest'

export function nextLevel(level: FamiliarityLevel, grade: ReviewGrade): FamiliarityLevel {
  switch (grade) {
    case 'forgot':
      return 0
    case 'hard':
      return clamp(level - 1, 0, 3) as FamiliarityLevel
    case 'good':
      return clamp(level + 1, 0, 3) as FamiliarityLevel
    case 'easy':
      return clamp(level + 2, 0, 3) as FamiliarityLevel
  }
}

/** Streak stretches the interval, but never past three times the base. */
export function intervalFor(
  level: FamiliarityLevel,
  streak: number,
  intensity: ReviewIntensity = 'standard',
): number {
  const multiplier = Math.min(1 + 0.4 * Math.max(0, streak - 1), 3)
  const scaled = BASE_INTERVALS[level] * multiplier * INTENSITY_SCALE[intensity]
  return Math.min(Math.round(scaled), MAX_INTERVAL)
}

export function gradeCard(
  review: ReviewState,
  grade: ReviewGrade,
  now: number = Date.now(),
  intensity: ReviewIntensity = 'standard',
): ReviewState {
  const level = nextLevel(review.level, grade)
  // `hard` means "I got there, but slowly" — it demotes the level, so treating
  // it as a streak success would stretch the interval of a card the user is
  // actively struggling with.
  const success = grade === 'good' || grade === 'easy'
  const streak = success ? review.streak + 1 : 0

  return {
    level,
    status: REVIEW_STATUS_BY_LEVEL[level],
    dueAt: now + intervalFor(level, streak, intensity),
    lastReviewedAt: now,
    reviewCount: review.reviewCount + 1,
    lapses: review.lapses + (grade === 'forgot' && review.level > 0 ? 1 : 0),
    streak,
  }
}

export function isDue(entry: VocabularyEntry, now: number = Date.now()): boolean {
  return entry.review.dueAt <= now
}

export interface QueueOptions {
  now?: number
  limit?: number
  /** When nothing is due, fill the session with the soonest cards instead. */
  allowAhead?: boolean
  mode?: ReviewMode
  /** Injected so `random` mode stays testable. */
  random?: () => number
}

/**
 * Orderings, one per mode.
 *
 * - `curve`: weakest first, then most overdue. A learner opening a 20-card
 *   session should meet the words they keep forgetting, not the ones they know.
 * - `recent`: newest first — "what did I read today".
 * - `hardest`: most lapses first, then weakest. A deliberate drill.
 * - `random`: shuffled, so the deck is not memorised by position.
 */
const ORDERINGS: Record<
  Exclude<ReviewMode, 'random'>,
  (a: VocabularyEntry, b: VocabularyEntry) => number
> = {
  curve: (a, b) => a.review.level - b.review.level || a.review.dueAt - b.review.dueAt,
  recent: (a, b) => b.createdAt - a.createdAt,
  hardest: (a, b) => b.review.lapses - a.review.lapses || a.review.level - b.review.level,
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * Builds a session.
 *
 * Every mode selects from the same set — the cards that are actually due —
 * because that is what spaced repetition means. The mode only decides the order
 * you meet them in.
 */
export function buildReviewQueue(
  entries: VocabularyEntry[],
  options: QueueOptions = {},
): VocabularyEntry[] {
  const now = options.now ?? Date.now()
  const limit = options.limit ?? 20
  const mode = options.mode ?? 'curve'
  const random = options.random ?? Math.random

  const dueEntries = entries.filter((entry) => isDue(entry, now))
  const due =
    mode === 'random' ? shuffle(dueEntries, random) : [...dueEntries].sort(ORDERINGS[mode])

  if (due.length >= limit || !options.allowAhead) return due.slice(0, limit)

  // Reviewing ahead of schedule always takes the soonest cards, whatever the
  // mode: pulling a card forward only makes sense if it was nearly due anyway.
  const ahead = entries
    .filter((entry) => !isDue(entry, now))
    .sort((a, b) => a.review.dueAt - b.review.dueAt)
    .slice(0, limit - due.length)

  return [...due, ...ahead]
}

export function countDue(entries: VocabularyEntry[], now: number = Date.now()): number {
  return entries.reduce((total, entry) => total + (isDue(entry, now) ? 1 : 0), 0)
}

export function levelHistogram(entries: VocabularyEntry[]): Record<FamiliarityLevel, number> {
  const histogram: Record<FamiliarityLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const entry of entries) histogram[entry.review.level]++
  return histogram
}
