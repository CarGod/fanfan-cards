import { describe, expect, it } from 'vitest'
import { DAY_MS } from '@/shared/utils.ts'
import type { VocabularyEntry, ReviewState } from '@/types/vocabulary.ts'
import {
  BASE_INTERVALS,
  buildReviewQueue,
  countDue,
  gradeCard,
  intervalFor,
  levelHistogram,
  nextLevel,
} from './scheduler.ts'

const NOW = new Date(2026, 5, 1, 12, 0, 0).getTime()

function review(patch: Partial<ReviewState> = {}): ReviewState {
  return {
    level: 0,
    status: 'new',
    dueAt: NOW,
    lastReviewedAt: null,
    reviewCount: 0,
    lapses: 0,
    streak: 0,
    ...patch,
  }
}

function entry(
  id: string,
  patch: Partial<ReviewState> = {},
  overrides: Partial<VocabularyEntry> = {},
): VocabularyEntry {
  return {
    id,
    word: id,
    normalized: id,
    lemma: id,
    kind: 'word',
    phonetic: '',
    partOfSpeech: '',
    cefr: '',
    meaning: '',
    aiExplanation: '',
    englishDefinition: '',
    sentenceTranslation: '',
    examples: [],
    synonyms: [],
    source: { url: '', title: '', context: '', wideContext: '', capturedAt: NOW },
    origin: { providerId: 'mock', model: 'test', offline: true },
    review: review(patch),
    tags: [],
    notes: '',
    favorite: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

describe('nextLevel', () => {
  it('resets to 0 on forgot, from any level', () => {
    expect(nextLevel(3, 'forgot')).toBe(0)
    expect(nextLevel(0, 'forgot')).toBe(0)
  })

  it('steps down on hard and up on good', () => {
    expect(nextLevel(2, 'hard')).toBe(1)
    expect(nextLevel(0, 'hard')).toBe(0)
    expect(nextLevel(2, 'good')).toBe(3)
    expect(nextLevel(3, 'good')).toBe(3)
  })

  it('jumps two levels on easy but never past mastered', () => {
    expect(nextLevel(0, 'easy')).toBe(2)
    expect(nextLevel(2, 'easy')).toBe(3)
  })
})

describe('gradeCard', () => {
  it('schedules a level-0 card inside the same session', () => {
    const next = gradeCard(review(), 'forgot', NOW)
    expect(next.level).toBe(0)
    expect(next.dueAt).toBe(NOW + BASE_INTERVALS[0])
    expect(next.reviewCount).toBe(1)
  })

  it('counts a lapse only when a promoted word is forgotten', () => {
    expect(gradeCard(review({ level: 2 }), 'forgot', NOW).lapses).toBe(1)
    expect(gradeCard(review({ level: 0 }), 'forgot', NOW).lapses).toBe(0)
  })

  it('keeps the status projection in sync with the level', () => {
    expect(gradeCard(review({ level: 1 }), 'good', NOW).status).toBe('familiar')
    expect(gradeCard(review({ level: 2 }), 'good', NOW).status).toBe('mastered')
  })

  it('stretches the interval as the streak grows, up to 3x', () => {
    const first = gradeCard(review({ level: 0, streak: 0 }), 'good', NOW)
    expect(first.dueAt - NOW).toBe(BASE_INTERVALS[1])

    const long = gradeCard(review({ level: 0, streak: 10 }), 'good', NOW)
    expect(long.dueAt - NOW).toBe(BASE_INTERVALS[1] * 3)
  })

  it('breaks the streak on a failed recall', () => {
    expect(gradeCard(review({ streak: 5, level: 3 }), 'forgot', NOW).streak).toBe(0)
    expect(gradeCard(review({ streak: 5, level: 1 }), 'hard', NOW).streak).toBe(0)
  })
})

describe('intervalFor', () => {
  it('caps at 90 days', () => {
    expect(intervalFor(3, 100)).toBeLessThanOrEqual(90 * DAY_MS)
  })
})

describe('buildReviewQueue', () => {
  const entries = [
    entry('mastered-due', { level: 3, dueAt: NOW - DAY_MS }),
    entry('new-due', { level: 0, dueAt: NOW - 60_000 }),
    entry('future', { level: 1, dueAt: NOW + 5 * DAY_MS }),
    entry('learning-overdue', { level: 1, dueAt: NOW - 10 * DAY_MS }),
  ]

  it('returns only due cards, weakest first', () => {
    const queue = buildReviewQueue(entries, { now: NOW })
    expect(queue.map((e) => e.id)).toEqual(['new-due', 'learning-overdue', 'mastered-due'])
  })

  it('respects the limit', () => {
    expect(buildReviewQueue(entries, { now: NOW, limit: 2 })).toHaveLength(2)
  })

  it('tops up with the soonest cards only when asked', () => {
    const queue = buildReviewQueue(entries, { now: NOW, limit: 10, allowAhead: true })
    expect(queue.map((e) => e.id)).toEqual([
      'new-due',
      'learning-overdue',
      'mastered-due',
      'future',
    ])
  })

  it('is empty when nothing is due and look-ahead is off', () => {
    expect(buildReviewQueue([entry('a', { dueAt: NOW + DAY_MS })], { now: NOW })).toEqual([])
  })
})

describe('countDue / levelHistogram', () => {
  it('counts by due date and by level', () => {
    const entries = [
      entry('a', { level: 0, dueAt: NOW - 1 }),
      entry('b', { level: 3, dueAt: NOW + DAY_MS }),
      entry('c', { level: 0, dueAt: NOW }),
    ]
    expect(countDue(entries, NOW)).toBe(2)
    expect(levelHistogram(entries)).toEqual({ 0: 2, 1: 0, 2: 0, 3: 1 })
  })
})

describe('review modes', () => {
  const now = NOW
  const entries = [
    entry('easy-old', { level: 3, dueAt: now - DAY_MS, lapses: 0 }),
    entry('struggling', { level: 1, dueAt: now - 2 * DAY_MS, lapses: 7 }),
    entry('fresh', { level: 0, dueAt: now - 60_000, lapses: 0 }),
  ]

  it('memory-curve mode meets the weakest cards first', () => {
    const queue = buildReviewQueue(entries, { now, mode: 'curve' })
    expect(queue.map((item) => item.id)).toEqual(['fresh', 'struggling', 'easy-old'])
  })

  it('hardest mode drills the ones that keep being forgotten', () => {
    const queue = buildReviewQueue(entries, { now, mode: 'hardest' })
    expect(queue[0]?.id).toBe('struggling')
  })

  it('random mode still only draws from cards that are due', () => {
    const withFuture = [...entries, entry('later', { dueAt: now + DAY_MS })]
    const queue = buildReviewQueue(withFuture, { now, mode: 'random', random: () => 0 })
    expect(queue).toHaveLength(3)
    expect(queue.some((item) => item.id === 'later')).toBe(false)
  })
})

describe('review intensity', () => {
  it('stretches or compresses every interval by one honest multiplier', () => {
    const relaxed = gradeCard(review({ level: 0 }), 'good', NOW, 'relaxed')
    const standard = gradeCard(review({ level: 0 }), 'good', NOW, 'standard')
    const intensive = gradeCard(review({ level: 0 }), 'good', NOW, 'intensive')

    expect(relaxed.dueAt).toBeGreaterThan(standard.dueAt)
    expect(intensive.dueAt).toBeLessThan(standard.dueAt)
    expect(standard.dueAt - NOW).toBe(BASE_INTERVALS[1])
  })

  it('still respects the 90-day ceiling at the most relaxed setting', () => {
    expect(intervalFor(3, 100, 'relaxed')).toBeLessThanOrEqual(90 * DAY_MS)
  })
})
