import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, LevelChip } from '@/components/index.tsx'
import { ArrowLeftIcon, ArrowRightIcon, SpeakerIcon } from '@/components/icons.tsx'
import { useEntries, useSettings } from '@/components/hooks.ts'
import { speak } from '@/services/speech.ts'
import { submitReview, undoReview, type ReviewRecord } from '@/services/reviewService.ts'
import { type ReviewGrade, type VocabularyEntry } from '@/types/vocabulary.ts'
import { formatDue, safeHostname } from '@/shared/utils.ts'
import { useI18n } from '@/i18n/react.ts'
import type { MessageKey } from '@/i18n/index.ts'
import { buildReviewQueue, countDue, gradeCard } from './scheduler.ts'

/**
 * 存的是文案键，不是文案本身。
 *
 * 这个数组在模块加载时就求值了，真去调 `t()` 会把语言冻在那一刻——用户之后改设置
 * 按钮上还是旧语言。键在使用处再翻。
 */
const GRADES: ReadonlyArray<{ grade: ReviewGrade; labelKey: MessageKey; className: string }> = [
  { grade: 'forgot', labelKey: 'flashcard.grade.forgot', className: 'btn btn-ghost grade-btn' },
  { grade: 'hard', labelKey: 'flashcard.grade.hard', className: 'btn btn-ghost grade-btn' },
  { grade: 'good', labelKey: 'flashcard.grade.good', className: 'btn btn-primary grade-btn' },
  { grade: 'easy', labelKey: 'flashcard.grade.easy', className: 'btn btn-ghost grade-btn' },
]

/**
 * Flashcard review.
 *
 * The queue is snapshotted when a session starts and is *not* recomputed as
 * cards are graded — a card graded "forgot" becomes due again in ten minutes,
 * and letting it re-enter the same session would make the session never end.
 * Keyboard first: space flips, 1-4 grade, because that is how people actually
 * grind cards.
 */
export function FlashcardPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { t } = useI18n()
  const { entries, loading } = useEntries()
  const { settings } = useSettings()
  const [session, setSession] = useState<VocabularyEntry[] | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  /**
   * Grades already submitted in this session, keyed by position.
   *
   * Keyed rather than stacked because a card can be skipped (→) without being
   * graded, so position and grade order do not line up.
   */
  const [records, setRecords] = useState<Record<number, ReviewRecord>>({})
  const graded = Object.keys(records).length

  const dueCount = useMemo(() => countDue(entries), [entries])
  const current = session?.[index] ?? null
  const finished = session !== null && index >= session.length

  const start = useCallback(
    (allowAhead: boolean) => {
      const queue = buildReviewQueue(entries, {
        limit: settings.dailyReviewGoal,
        allowAhead,
        mode: settings.reviewMode,
      })
      setSession(queue)
      setIndex(0)
      setFlipped(false)
      setRecords({})
    },
    [entries, settings.dailyReviewGoal, settings.reviewMode],
  )

  const grade = useCallback(
    async (value: ReviewGrade) => {
      if (!current) return
      const position = index
      // Advance immediately: waiting on storage would make the deck feel laggy.
      setIndex((prev) => prev + 1)
      setFlipped(false)

      const outcome = await submitReview(current.id, value, Date.now(), settings.reviewIntensity)
      if (outcome) setRecords((prev) => ({ ...prev, [position]: outcome.record }))
    },
    [current, index, settings.reviewIntensity],
  )

  /** Skip forward without grading — the card stays due. */
  const goNext = useCallback(() => {
    if (!session || index >= session.length) return
    setIndex((prev) => prev + 1)
    setFlipped(false)
  }, [session, index])

  /**
   * Step back, undoing the grade if that card was already graded.
   *
   * Without the undo this would silently double-count: the grade is already in
   * the review log and the day's total, so re-grading the same card would
   * inflate both.
   */
  const goPrevious = useCallback(() => {
    if (index === 0) return
    const target = index - 1
    const record = records[target]

    setIndex(target)
    setFlipped(false)

    if (record) {
      setRecords((prev) => {
        const next = { ...prev }
        delete next[target]
        return next
      })
      void undoReview(record)
    }
  }, [index, records])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!session) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrevious()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
        return
      }
      if (!current) return

      if (event.key === ' ') {
        event.preventDefault()
        setFlipped((prev) => !prev)
        return
      }
      // Enter is "carry on": reveal, then accept. Holding it walks the deck.
      if (event.key === 'Enter') {
        event.preventDefault()
        if (flipped) void grade('good')
        else setFlipped(true)
        return
      }
      if (!flipped) return
      const shortcut = GRADES[Number(event.key) - 1]
      if (shortcut) void grade(shortcut.grade)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, current, flipped, grade, goNext, goPrevious])

  if (loading) return <p className="muted">{t('common.loading')}</p>

  if (entries.length === 0) {
    return (
      <div className="card">
        <Empty
          emoji="🃏"
          title={t('flashcard.empty.title')}
          hint={t('flashcard.empty.hint')}
          action={
            <button className="btn btn-primary" onClick={() => onNavigate('#/vocabulary')}>
              {t('flashcard.empty.action')}
            </button>
          }
        />
      </div>
    )
  }

  if (session === null) {
    return (
      <div className="flash-wrap">
        <h1 className="page-title">{t('flashcard.title')}</h1>
        <p className="page-sub">
          {dueCount > 0
            ? t('flashcard.start.due_sub', { count: dueCount, limit: settings.dailyReviewGoal })
            : t('flashcard.start.clear_sub')}
        </p>
        <div className="card card-pad">
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-primary btn-lg" onClick={() => start(false)} disabled={dueCount === 0}>
              {t('flashcard.start.begin', { count: Math.min(dueCount, settings.dailyReviewGoal) })}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => start(true)}>
              {t('flashcard.start.ahead')}
            </button>
          </div>
          <div className="faint" style={{ marginTop: 12 }}>
            {t('flashcard.start.shortcuts')}
          </div>
        </div>
      </div>
    )
  }

  if (finished || session.length === 0) {
    return (
      <div className="flash-wrap">
        <div className="card">
          <Empty
            emoji="🎉"
            title={
              graded > 0 ? t('flashcard.done.title', { count: graded }) : t('flashcard.done.empty_title')
            }
            hint={graded > 0 ? t('flashcard.done.hint') : undefined}
            action={
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setSession(null)}>
                  {t('flashcard.done.back')}
                </button>
                <button className="btn btn-primary" onClick={() => onNavigate('#/dashboard')}>
                  {t('flashcard.done.dashboard')}
                </button>
              </div>
            }
          />
        </div>
      </div>
    )
  }

  const card = current as VocabularyEntry
  const progress = Math.round((index / session.length) * 100)

  return (
    <div className="flash-wrap focus-mode">
      <div className="flash-progress">
        <span>
          {index + 1} / {session.length}
        </span>
        <div className="progress-track" style={{ flex: 1 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <LevelChip level={card.review.level} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={goPrevious}
          disabled={index === 0}
          title={t('flashcard.nav.previous_title')}
          aria-label={t('flashcard.nav.previous')}
        >
          <ArrowLeftIcon size={14} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={goNext}
          title={t('flashcard.nav.next_title')}
          aria-label={t('flashcard.nav.next')}
        >
          <ArrowRightIcon size={14} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSession(null)}>
          {t('flashcard.nav.end')}
        </button>
      </div>

      <div className="card flash-card" onClick={() => setFlipped((prev) => !prev)}>
        {!flipped ? (
          <div className="flash-front">
            <div className="flash-word">{card.word}</div>
            {card.phonetic ? <div className="mono muted">{card.phonetic}</div> : null}
            {card.cefr ? (
              <span className="cefr" data-band={card.cefr[0]}>
                CEFR {card.cefr}
              </span>
            ) : null}
            <button
              className="btn btn-ghost btn-sm"
              onClick={(event) => {
                event.stopPropagation()
                speak(card.lemma || card.word)
              }}
            >
              <SpeakerIcon size={15} />
              {t('flashcard.card.speak')}
            </button>
            <div className="flash-hint">{t('flashcard.card.front_hint')}</div>
          </div>
        ) : (
          <div className="flash-back">
            <div>
              <div className="detail-label">{t('flashcard.card.meaning')}</div>
              <div style={{ fontSize: 16 }}>{card.meaning || t('flashcard.card.no_meaning')}</div>
            </div>
            {card.aiExplanation ? (
              <div>
                <div className="detail-label">{t('flashcard.card.context_meaning')}</div>
                <div className="context-block">{card.aiExplanation}</div>
              </div>
            ) : null}
            {card.englishDefinition ? (
              <div>
                <div className="detail-label">{t('flashcard.card.english')}</div>
                <div className="muted">{card.englishDefinition}</div>
              </div>
            ) : null}
            {card.examples.length ? (
              <div>
                <div className="detail-label">{t('flashcard.card.examples')}</div>
                <ol className="example-list">
                  {card.examples.map((item) => (
                    <li key={item.sentence}>
                      <div style={{ fontStyle: 'italic' }}>{item.sentence}</div>
                      <div className="faint">{item.translation}</div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {card.source.context ? (
              <div>
                <div className="detail-label">{t('flashcard.card.source_context')}</div>
                <div className="quote">{card.source.context}</div>
                {card.sentenceTranslation ? (
                  <div className="faint" style={{ marginTop: 4 }}>{card.sentenceTranslation}</div>
                ) : null}
                <div className="faint" style={{ marginTop: 4 }}>
                  {safeHostname(card.source.url)}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {flipped ? (
        <div className="grade-row">
          {GRADES.map((option, position) => {
            const preview = gradeCard(card.review, option.grade, Date.now(), settings.reviewIntensity)
            return (
              <button
                key={option.grade}
                className={option.className}
                onClick={() => void grade(option.grade)}
                title={t('flashcard.grade.shortcut', { key: position + 1 })}
              >
                {t(option.labelKey)}
                <small>{formatDue(preview.dueAt)}</small>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="faint" style={{ textAlign: 'center', marginTop: 16 }}>
          {t('flashcard.card.flip_hint')}
        </div>
      )}
    </div>
  )
}
