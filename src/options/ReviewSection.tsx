import { Field, SegmentedControl, Toggle } from '@/components/index.tsx'
import { INTENSITY_SCALE, BASE_INTERVALS } from '@/flashcard/scheduler.ts'
import type { Settings } from '@/types/settings.ts'
import { DAY_MS } from '@/shared/utils.ts'
import { useI18n } from '@/i18n/react.ts'

type Translate = ReturnType<typeof useI18n>['t']

/**
 * Review settings.
 *
 * The honest framing matters here. "艾宾浩斯记忆曲线" is not a mode you switch
 * on — scheduling by due date *is* the forgetting curve, and it is what every
 * mode below selects from. What genuinely differs between products is the order
 * you meet the due cards in, and how aggressive the intervals are. So those are
 * the two knobs, and the copy says which one is doing the real work.
 */
/*
 * 表里存的是键，不是文案：这个数组在模块加载时就求值了，直接放 `t()` 的结果会
 * 把语言冻结在那一刻，之后用户改设置也不再变。取文案的动作留到渲染里。
 */
const MODES = [
  {
    value: 'curve',
    label: 'options.review.mode.curve',
    hint: 'options.review.mode.curve_hint',
  },
  { value: 'recent', label: 'options.review.mode.recent', hint: 'options.review.mode.recent_hint' },
  {
    value: 'hardest',
    label: 'options.review.mode.hardest',
    hint: 'options.review.mode.hardest_hint',
  },
  { value: 'random', label: 'options.review.mode.random', hint: 'options.review.mode.random_hint' },
] as const

const INTENSITIES = [
  { value: 'relaxed', label: 'options.review.intensity.relaxed' },
  { value: 'standard', label: 'options.review.intensity.standard' },
  { value: 'intensive', label: 'options.review.intensity.intensive' },
] as const

function describeIntensity(t: Translate, intensity: Settings['reviewIntensity']): string {
  const days = (ms: number) => Math.max(1, Math.round((ms * INTENSITY_SCALE[intensity]) / DAY_MS))
  return t('options.review.intensity.hint', {
    mastered: days(BASE_INTERVALS[3]),
    familiar: days(BASE_INTERVALS[2]),
  })
}

export function ReviewSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}) {
  const { t } = useI18n()
  const activeMode = MODES.find((mode) => mode.value === settings.reviewMode) ?? MODES[0]!

  return (
    <>
      <section className="card section-card">
        <div className="section-title">{t('options.review.title')}</div>
        <div className="section-desc">
          {t('options.review.desc_lead')}
          <strong>{t('options.review.desc_em')}</strong>
          {t('options.review.desc_tail')}
        </div>

        <Field label={t('options.review.mode.label')} hint={t(activeMode.hint)}>
          <SegmentedControl
            value={settings.reviewMode}
            options={MODES.map((mode) => ({ value: mode.value, label: t(mode.label) }))}
            onChange={(next) => void update({ reviewMode: next })}
          />
        </Field>

        <Field
          label={t('options.review.intensity.label')}
          hint={describeIntensity(t, settings.reviewIntensity)}
        >
          <SegmentedControl
            value={settings.reviewIntensity}
            options={INTENSITIES.map((item) => ({ value: item.value, label: t(item.label) }))}
            onChange={(next) => void update({ reviewIntensity: next })}
          />
        </Field>

        <Field label={t('options.review.goal.label')} hint={t('options.review.goal.hint')}>
          <input
            type="number"
            min={1}
            max={500}
            value={settings.dailyReviewGoal}
            onChange={(event) => void update({ dailyReviewGoal: Number(event.target.value) || 20 })}
          />
        </Field>
      </section>

      <section className="card section-card">
        <div className="section-title">{t('options.review.reminder.title')}</div>
        <div className="section-desc">
          {t('options.review.reminder.desc_lead')}
          <strong>{t('options.review.reminder.desc_em')}</strong>
          {t('options.review.reminder.desc_tail')}
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('options.review.reminder.toggle')}</div>
            <div className="faint">{t('options.review.reminder.toggle_desc')}</div>
          </div>
          <Toggle
            checked={settings.reminderEnabled}
            onChange={(next) => void update({ reminderEnabled: next })}
            label={t('options.review.reminder.toggle_aria')}
          />
        </div>

        {settings.reminderEnabled ? (
          <Field
            label={t('options.review.reminder.time_label')}
            hint={t('options.review.reminder.time_hint')}
          >
            <input
              type="time"
              value={settings.reminderTime}
              onChange={(event) => void update({ reminderTime: event.target.value || '20:00' })}
            />
          </Field>
        ) : null}
      </section>
    </>
  )
}
