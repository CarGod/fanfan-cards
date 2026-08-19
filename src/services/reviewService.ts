import { createId, dateKey } from '@/shared/utils.ts'
import { gradeCard, type ReviewIntensity } from '@/flashcard/scheduler.ts'
import {
  appendReviewLog,
  bumpActivity,
  removeReviewLog,
} from '@/storage/repositories/activityRepo.ts'
import { getEntry, updateEntry } from '@/storage/repositories/vocabularyRepo.ts'
import type { ReviewGrade, ReviewState, VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * Everything needed to take one review back.
 *
 * "Go to the previous card" is only honest if it can undo: the grade has
 * already been written to the card's schedule, appended to the review log and
 * counted into the day's total. Moving an index backwards without reversing
 * those three writes would silently inflate the dashboard and corrupt the
 * scheduling history — the two things the log exists to keep trustworthy.
 */
export interface ReviewRecord {
  entryId: string
  logId: string
  previousReview: ReviewState
  /** Local calendar day the review was counted against. */
  day: string
}

export interface ReviewOutcome {
  entry: VocabularyEntry
  record: ReviewRecord
}

/**
 * One graded review = three writes: the card's new schedule, an immutable log
 * line, and the day's counter. The log is what makes the dashboard honest and
 * what a future scheduler upgrade would be trained/tuned against.
 */
export async function submitReview(
  entryId: string,
  grade: ReviewGrade,
  now: number = Date.now(),
  intensity: ReviewIntensity = 'standard',
): Promise<ReviewOutcome | null> {
  const entry = await getEntry(entryId)
  if (!entry) return null

  const nextReview = gradeCard(entry.review, grade, now, intensity)
  const updated = await updateEntry(entryId, { review: nextReview })
  if (!updated) return null

  const logId = createId('r')
  const day = dateKey(now)

  await appendReviewLog({
    id: logId,
    entryId,
    word: entry.word,
    grade,
    levelBefore: entry.review.level,
    levelAfter: nextReview.level,
    reviewedAt: now,
  })
  await bumpActivity(day, { reviewed: 1 })

  return { entry: updated, record: { entryId, logId, previousReview: entry.review, day } }
}

/** Reverses all three writes of {@link submitReview}. */
export async function undoReview(record: ReviewRecord): Promise<VocabularyEntry | null> {
  const restored = await updateEntry(record.entryId, { review: record.previousReview })
  await removeReviewLog(record.logId)
  await bumpActivity(record.day, { reviewed: -1 })
  return restored
}
