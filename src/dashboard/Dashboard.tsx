import { useMemo } from 'react'
import { StatCard, levelColor } from '@/components/index.tsx'
import { useActivity, useEntries, useSettings } from '@/components/hooks.ts'
import { computeStreak, recentDays, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue, levelHistogram } from '@/flashcard/scheduler.ts'
import { FAMILIARITY_LABELS, type FamiliarityLevel } from '@/types/vocabulary.ts'
import { formatRelative, safeHostname, truncate } from '@/shared/utils.ts'

/**
 * The dashboard answers one question: "is this working?"
 *
 * Everything shown is a fact derived from stored data — no vanity metric, no
 * estimate. Growth is the product's retention loop, so the numbers that move
 * when the user reads (saved) and when the user studies (reviewed, streak) get
 * top billing.
 */
export function Dashboard({ onNavigate }: { onNavigate: (route: string) => void }) {
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
      <h1 className="page-title">学习面板</h1>
      <p className="page-sub">
        {loading
          ? '正在读取本地知识库…'
          : stats.total === 0
            ? '还没有收藏任何单词——去任意英文网页划词试试。'
            : `你的英语知识库里有 ${stats.total} 个词条，其中 ${stats.mastered} 个已掌握。`}
      </p>

      <div className="stat-grid">
        <StatCard label="词卡总数" value={stats.total} foot={`今日新增 ${stats.today.saved}`} />
        <StatCard
          label="待复习"
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
                开始复习 →
              </a>
            ) : (
              '今天没有到期的卡片'
            )
          }
        />
        <StatCard label="今日复习" value={stats.today.reviewed} foot={`目标 ${goal} 张`} />
        <StatCard
          label="连续学习"
          value={`${stats.streak} 天`}
          foot={stats.streak > 0 ? '保持住' : '今天学一个词就能开始'}
        />
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div className="section-title">今日目标</div>
            <div className="faint">
              已复习 {stats.today.reviewed} / {goal} 张
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
          <div className="section-title">最近两周</div>
          <div className="faint" style={{ marginBottom: 4 }}>
            每天的收藏 + 复习次数
          </div>
          <div className="bars">
            {stats.week.map((day, position) => {
              const total = day.saved + day.reviewed
              const isToday = position === stats.week.length - 1
              return (
                <div className="bar-col" key={day.date} title={`${day.date}：收藏 ${day.saved} · 复习 ${day.reviewed}`}>
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
          <div className="section-title">熟悉度分布</div>
          <div className="faint" style={{ marginBottom: 10 }}>
            越靠右说明掌握得越好
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
                  title={`${FAMILIARITY_LABELS[level]}：${count}`}
                />
              )
            })}
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {([0, 1, 2, 3] as FamiliarityLevel[]).map((level) => (
              <div className="row-between" key={level}>
                <span className="row" style={{ gap: 7 }}>
                  <span className="level-dot" style={{ background: levelColor(level) }} />
                  <span className="muted">{FAMILIARITY_LABELS[level]}</span>
                </span>
                <span className="mono">{stats.histogram[level]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="section-title">最近收藏</div>
          <a
            href="#/vocabulary"
            onClick={(event) => {
              event.preventDefault()
              onNavigate('#/vocabulary')
            }}
          >
            查看全部 →
          </a>
        </div>
        {stats.recent.length === 0 ? (
          <div className="faint">还没有记录。打开一篇英文文章，选中一个不认识的词就会出现在这里。</div>
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
                    {safeHostname(entry.source.url) || '未知来源'} · {formatRelative(entry.createdAt)}
                  </div>
                </div>
                <span className="chip">
                  <span className="level-dot" style={{ background: levelColor(entry.review.level) }} />
                  {FAMILIARITY_LABELS[entry.review.level]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
