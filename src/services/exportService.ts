import { SCHEMA_VERSION } from '@/shared/constants.ts'
import { readActivity } from '@/storage/repositories/activityRepo.ts'
import { listAllEntries, mergeEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { readReviewLog } from '@/storage/repositories/activityRepo.ts'
import type { DailyActivity, ReviewLogEntry, VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * The knowledge base must be portable, or "个人英语知识资产" is just marketing.
 *
 * This snapshot format is also the payload the planned GitHub sync will commit,
 * which is why it carries its own version and is plain, diff-friendly JSON.
 */
export interface KnowledgeSnapshot {
  format: 'ai-reader-assistant/knowledge'
  version: number
  exportedAt: string
  counts: { entries: number; reviews: number; activeDays: number }
  entries: VocabularyEntry[]
  activity: Record<string, DailyActivity>
  reviewLog: ReviewLogEntry[]
}

export async function buildSnapshot(): Promise<KnowledgeSnapshot> {
  const [entries, activity, reviewLog] = await Promise.all([
    // Tombstones travel too, or a deletion never reaches the other device.
    listAllEntries(),
    readActivity(),
    readReviewLog(),
  ])

  return {
    format: 'ai-reader-assistant/knowledge',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      entries: entries.filter((entry) => !entry.deletedAt).length,
      reviews: reviewLog.length,
      activeDays: Object.values(activity).filter((day) => day.saved + day.reviewed > 0).length,
    },
    entries,
    activity,
    reviewLog,
  }
}

export interface ImportResult {
  added: number
  merged: number
  skipped: number
}

/**
 * Import is a merge, never a replace: the local copy is the user's asset and a
 * clumsy import must not be able to destroy it.
 *
 * Conflict rules, in order:
 * 1. A deletion wins if it happened after the other side last changed the word.
 *    Without this, deleting a word on one machine simply undoes itself the next
 *    time the other machine syncs.
 * 2. Otherwise the copy with more review history wins, since that is the side
 *    holding the learning the user would miss.
 */
export async function importSnapshot(raw: unknown): Promise<ImportResult> {
  const snapshot = raw as Partial<KnowledgeSnapshot>
  if (!snapshot || snapshot.format !== 'ai-reader-assistant/knowledge') {
    throw new Error('文件格式不正确：不是 翻翻词卡 导出的知识库')
  }
  if (!Array.isArray(snapshot.entries)) throw new Error('文件缺少 entries 字段')

  /*
   * Read, merge and write happen inside one lock.
   *
   * This function used to read the whole table here, merge in memory, and call
   * `replaceAll` at the end. `replaceAll` takes the lock — but the read did not,
   * so a word saved while a sync was pulling its shards got overwritten by a
   * snapshot taken before that word existed. No error, no tombstone, and the
   * repository never learned about it either. Confirmed with a repro before
   * this change: save 'alpha', then run an import and a save of 'bravo' at the
   * same time, and 'bravo' is simply gone.
   */
  return mergeEntries(snapshot.entries as VocabularyEntry[], resolveConflict)
}

/** Exported for testing: the rule that decides which copy of a word survives. */
export function resolveConflict(
  local: VocabularyEntry,
  remote: VocabularyEntry,
): VocabularyEntry {
  const localDeleted = local.deletedAt ?? 0
  const remoteDeleted = remote.deletedAt ?? 0

  // A deletion is only respected if it is newer than the other side's last
  // edit — otherwise re-saving a word on one device could never undo a stale
  // tombstone from another.
  if (localDeleted && localDeleted >= (remote.updatedAt ?? 0)) return local
  if (remoteDeleted && remoteDeleted >= (local.updatedAt ?? 0)) return remote
  if (localDeleted && !remoteDeleted) return remote
  if (remoteDeleted && !localDeleted) return local

  /*
   * Neither side wins outright, because neither side is wholly right.
   *
   * This used to be `remoteReviews > localReviews ? remote : local`, which
   * silently threw away the newer edit whenever the other device happened to
   * have reviewed more: write a note on your laptop, review the same word twice
   * on your phone, sync — and the note is gone, with nothing to say it ever
   * existed.
   *
   * So the two halves are decided separately, each by the thing that actually
   * knows the truth about it:
   *
   *   - the fields the reader edits (notes, meanings, source) come from
   *     whichever copy was **edited last**;
   *   - the review state comes from whichever copy was **reviewed last**,
   *     because the most recent grade is what the schedule must follow. Taking
   *     the higher level instead would resurrect a "mastered" the reader has
   *     since demoted.
   *
   * `reviewCount` and `lapses` take the maximum: both devices' reviews really
   * happened, and a counter that goes backwards after a sync reads as data loss
   * even when nothing was lost.
   */
  /*
   * On a tie there is no information about which edit came later, so fall back
   * to the copy carrying more learning history — the same tiebreak this rule
   * used to apply unconditionally. What changed is that it is now only a
   * tiebreak, and can no longer override a genuinely newer edit.
   */
  const localEdited = local.updatedAt ?? 0
  const remoteEdited = remote.updatedAt ?? 0
  const newerEdit =
    remoteEdited === localEdited
      ? (remote.review?.reviewCount ?? 0) > (local.review?.reviewCount ?? 0)
        ? remote
        : local
      : remoteEdited > localEdited
        ? remote
        : local
  const localReviewedAt = local.review?.lastReviewedAt ?? 0
  const remoteReviewedAt = remote.review?.lastReviewedAt ?? 0
  const newerReview = remoteReviewedAt > localReviewedAt ? remote : local

  return {
    ...newerEdit,
    review: {
      ...newerReview.review,
      reviewCount: Math.max(local.review?.reviewCount ?? 0, remote.review?.reviewCount ?? 0),
      lapses: Math.max(local.review?.lapses ?? 0, remote.review?.lapses ?? 0),
    },
  }
}

export function snapshotFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `ai-reader-vocabulary-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}

/** CSV for people who live in Anki / Excel. */
export function toCsv(entries: VocabularyEntry[]): string {
  const header = ['word', 'phonetic', 'meaning', 'aiExplanation', 'example', 'context', 'sourceUrl', 'level', 'createdAt']
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const rows = entries.map((entry) =>
    [
      entry.word,
      entry.phonetic,
      entry.meaning,
      entry.aiExplanation,
      entry.examples.map((item) => item.sentence).join(' | '),
      entry.source.context,
      entry.source.url,
      String(entry.review.level),
      new Date(entry.createdAt).toISOString(),
    ]
      .map(escape)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

/** Triggers a download from an extension page. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
