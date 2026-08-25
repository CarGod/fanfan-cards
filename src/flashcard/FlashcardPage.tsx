import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, LevelChip } from '@/components/index.tsx'
import { ArrowLeftIcon, ArrowRightIcon, SpeakerIcon } from '@/components/icons.tsx'
import { useEntries, useSettings } from '@/components/hooks.ts'
import { speak } from '@/services/speech.ts'
import { submitReview, undoReview, type ReviewRecord } from '@/services/reviewService.ts'
import { REVIEW_GRADE_LABELS, type ReviewGrade, type VocabularyEntry } from '@/types/vocabulary.ts'
import { formatDue, safeHostname } from '@/shared/utils.ts'
import { buildReviewQueue, countDue, gradeCard } from './scheduler.ts'

const GRADES: ReadonlyArray<{ grade: ReviewGrade; hint: string; className: string }> = [
  { grade: 'forgot', hint: '重新开始', className: 'btn btn-ghost grade-btn' },
  { grade: 'hard', hint: '降一级', className: 'btn btn-ghost grade-btn' },
  { grade: 'good', hint: '升一级', className: 'btn btn-primary grade-btn' },
  { grade: 'easy', hint: '直接掌握', className: 'btn btn-ghost grade-btn' },
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

  if (loading) return <p className="muted">加载中…</p>

  if (entries.length === 0) {
    return (
      <div className="card">
        <Empty
          emoji="🃏"
          title="还没有可复习的卡片"
          hint="收藏的每个单词都会自动变成一张闪卡。"
          action={
            <button className="btn btn-primary" onClick={() => onNavigate('#/vocabulary')}>
              去看看词卡
            </button>
          }
        />
      </div>
    )
  }

  if (session === null) {
    return (
      <div className="flash-wrap">
        <h1 className="page-title">闪卡复习</h1>
        <p className="page-sub">
          {dueCount > 0
            ? `有 ${dueCount} 张卡片到期了，本次最多复习 ${settings.dailyReviewGoal} 张。`
            : '今天没有到期的卡片——你可以提前复习最接近到期的那些。'}
        </p>
        <div className="card card-pad">
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-primary btn-lg" onClick={() => start(false)} disabled={dueCount === 0}>
              开始复习（{Math.min(dueCount, settings.dailyReviewGoal)} 张）
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => start(true)}>
              提前复习
            </button>
          </div>
          <div className="faint" style={{ marginTop: 12 }}>
            快捷键：空格翻面 · 回车确认（记得）· ← 上一张（撤销评分）· → 跳过 ·
            1 忘记 · 2 模糊 · 3 记得 · 4 掌握
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
            title={graded > 0 ? `本轮完成，复习了 ${graded} 张` : '当前没有需要复习的卡片'}
            hint={graded > 0 ? '记忆最牢的时机是刚好快要忘记的时候，明天再来。' : undefined}
            action={
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setSession(null)}>
                  返回
                </button>
                <button className="btn btn-primary" onClick={() => onNavigate('#/dashboard')}>
                  看看数据
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
          title="上一张（←）——已评分的会撤销"
          aria-label="上一张"
        >
          <ArrowLeftIcon size={14} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={goNext}
          title="下一张（→）——跳过，不评分"
          aria-label="下一张"
        >
          <ArrowRightIcon size={14} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setSession(null)}>
          结束
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
              朗读
            </button>
            <div className="flash-hint">先想一想它在原句里的意思 · 空格或回车翻面</div>
          </div>
        ) : (
          <div className="flash-back">
            <div>
              <div className="detail-label">基础释义</div>
              <div style={{ fontSize: 16 }}>{card.meaning || '（无）'}</div>
            </div>
            {card.aiExplanation ? (
              <div>
                <div className="detail-label">语境含义</div>
                <div className="context-block">{card.aiExplanation}</div>
              </div>
            ) : null}
            {card.englishDefinition ? (
              <div>
                <div className="detail-label">English</div>
                <div className="muted">{card.englishDefinition}</div>
              </div>
            ) : null}
            {card.examples.length ? (
              <div>
                <div className="detail-label">例句</div>
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
                <div className="detail-label">当时的原文</div>
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
                title={`快捷键 ${position + 1}`}
              >
                {REVIEW_GRADE_LABELS[option.grade]}
                <small>{formatDue(preview.dueAt)}</small>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="faint" style={{ textAlign: 'center', marginTop: 16 }}>
          空格 / 回车翻面 · ← 上一张 · → 跳过
        </div>
      )}
    </div>
  )
}
