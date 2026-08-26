import { useMemo } from 'react'
import { StatCard, levelColor } from '@/components/index.tsx'
import { useActivity, useEntries, useSettings } from '@/components/hooks.ts'
import { computeStreak, recentDays, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue, levelHistogram } from '@/flashcard/scheduler.ts'
import { familiarityLabel, type FamiliarityLevel } from '@/types/vocabulary.ts'
import { formatRelative, safeHostname, truncate } from '@/shared/utils.ts'
import { useI18n } from '@/i18n/react.ts'

/**
 * The dashboard answers one question: "is this working?"
 *
 * Everything shown is a fact derived from stored data — no vanity metric, no
 * estimate. Growth is the product's retention loop, so the numbers that move
 * when the user reads (saved) and when the user studies (reviewed, streak) get
 * top billing.
 */
export function Dashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { t } = useI18n()
  const { entries, loading } = useEntries()
  const activity = useActivity()
  const { settings } = useSettings()

  const stats = useMemo(() => {
    const now = Date.now()
    const today = todayActivity(activity, now)
    return {
      total: entries.length,
      due: countDue(entries, now),
      streak: computeStreak(activity, now),
      today,
      histogram: levelHistogram(entries),
      week: recentDays(activity, 14, now),
      mastered: entries.filter((entry) => entry.review.level === 3).length,
      recent: entries.slice(0, 6),
    }
  }, [entries, activity])

  const goal = settings.dailyReviewGoal
  const goalPercent = Math.min(100, Math.round((stats.today.reviewed / goal) * 100))
  const maxBar = Math.max(1, ...stats.week.map((day) => day.saved + day.reviewed))

  return (
    <div>
      <h1 className="page-title">{t('common.dashboard')}</h1>
      <p className="page-sub">
        {loading
          ? t('dashboard.sub.loading')
          : stats.total === 0
            ? t('dashboard.sub.empty')
            : t('dashboard.sub.summary', { total: stats.total, mastered: stats.mastered })}
      </p>

      <div className="stat-grid">
        <StatCard
          label={t('dashboard.stat.total')}
          value={stats.total}
          foot={t('dashboard.stat.total_foot', { count: stats.today.saved })}
        />
        <StatCard
          label={t('common.due')}
          value={stats.due}
          foot={
            stats.due > 0 ? (
              <a
                href="#/flashcard"
                onClick={(event) => {
                  event.preventDefault()
                  onNavigate('#/flashcard')
                }}
              >
                {t('dashboard.stat.due_action')}
              </a>
            ) : (
              t('dashboard.stat.due_none')
            )
          }
        />
        <StatCard
          label={t('dashboard.stat.reviewed_today')}
          value={stats.today.reviewed}
          foot={t('dashboard.stat.goal_foot', { goal })}
        />
        <StatCard
          label={t('dashboard.stat.streak')}
          value={t('dashboard.stat.streak_days', { count: stats.streak })}
          foot={stats.streak > 0 ? t('dashboard.stat.streak_keep') : t('dashboard.stat.streak_start')}
        />
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div className="section-title">{t('dashboard.goal.title')}</div>
            <div className="faint">
              {t('dashboard.goal.progress', { reviewed: stats.today.reviewed, goal })}
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {goalPercent}%
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${goalPercent}%` }} />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div className="card card-pad">
          <div className="section-title">{t('dashboard.chart.title')}</div>
          <div className="faint" style={{ marginBottom: 4 }}>
            {t('dashboard.chart.hint')}
          </div>
          <div className="bars">
            {stats.week.map((day, position) => {
              const total = day.saved + day.reviewed
              const isToday = position === stats.week.length - 1
              return (
                <div
                  className="bar-col"
                  key={day.date}
                  title={t('dashboard.chart.bar_title', {
                    date: day.date,
                    saved: day.saved,
                    reviewed: day.reviewed,
                  })}
                >
                  <div
                    className={[
                      'bar',
                      total > 0 ? '' : 'bar-empty',
                      isToday && total > 0 ? 'bar-today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ height: `${Math.max(3, (total / maxBar) * 100)}%` }}
                  />
                  <div className="bar-label">{day.date.slice(8)}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="section-title">{t('dashboard.levels.title')}</div>
          <div className="faint" style={{ marginBottom: 10 }}>
            {t('dashboard.levels.hint')}
          </div>
          <div className="level-bar">
            {([0, 1, 2, 3] as FamiliarityLevel[]).map((level) => {
              const count = stats.histogram[level]
              const width = stats.total ? (count / stats.total) * 100 : 0
              return (
                <div
                  key={level}
                  className="level-seg"
                  style={{ width: `${width}%`, background: levelColor(level) }}
                  title={t('dashboard.levels.item_title', {
                    label: familiarityLabel(level),
                    count,
                  })}
                />
              )
            })}
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {([0, 1, 2, 3] as FamiliarityLevel[]).map((level) => (
              <div className="row-between" key={level}>
                <span className="row" style={{ gap: 7 }}>
                  <span className="level-dot" style={{ background: levelColor(level) }} />
                  <span className="muted">{familiarityLabel(level)}</span>
                </span>
                <span className="mono">{stats.histogram[level]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="section-title">{t('dashboard.recent.title')}</div>
          <a
            href="#/vocabulary"
            onClick={(event) => {
              event.preventDefault()
              onNavigate('#/vocabulary')
            }}
          >
            {t('dashboard.recent.all')}
          </a>
        </div>
        {stats.recent.length === 0 ? (
          <div className="faint">{t('dashboard.recent.empty')}</div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {stats.recent.map((entry) => (
              <div className="row-between" key={entry.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{entry.word}</strong>
                    <span className="faint">{truncate(entry.meaning, 28)}</span>
                  </div>
                  <div className="faint">
                    {safeHostname(entry.source.url) || t('dashboard.recent.unknown_source')} ·{' '}
                    {formatRelative(entry.createdAt)}
                  </div>
                </div>
                <span className="chip">
                  <span className="level-dot" style={{ background: levelColor(entry.review.level) }} />
                  {familiarityLabel(entry.review.level)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
