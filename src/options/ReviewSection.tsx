import { Field, SegmentedControl, Toggle } from '@/components/index.tsx'
import { INTENSITY_SCALE, BASE_INTERVALS } from '@/flashcard/scheduler.ts'
import type { Settings } from '@/types/settings.ts'
import { DAY_MS } from '@/shared/utils.ts'

/**
 * Review settings.
 *
 * The honest framing matters here. "艾宾浩斯记忆曲线" is not a mode you switch
 * on — scheduling by due date *is* the forgetting curve, and it is what every
 * mode below selects from. What genuinely differs between products is the order
 * you meet the due cards in, and how aggressive the intervals are. So those are
 * the two knobs, and the copy says which one is doing the real work.
 */
const MODES = [
  {
    value: 'curve' as const,
    label: '记忆曲线',
    hint: '按遗忘曲线到期顺序，最生疏的先来。这是真正的间隔重复，默认。',
  },
  { value: 'recent' as const, label: '最新优先', hint: '最近收藏的先复习——“今天读到的那些词”。' },
  { value: 'hardest' as const, label: '最难优先', hint: '按遗忘次数排序，专攻反复记不住的。' },
  { value: 'random' as const, label: '随机', hint: '打乱顺序，避免靠位置记住答案。' },
]

const INTENSITIES = [
  { value: 'relaxed' as const, label: '宽松' },
  { value: 'standard' as const, label: '标准' },
  { value: 'intensive' as const, label: '紧凑' },
]

function describeIntensity(intensity: Settings['reviewIntensity']): string {
  const days = (ms: number) => Math.max(1, Math.round((ms * INTENSITY_SCALE[intensity]) / DAY_MS))
  return `掌握后约 ${days(BASE_INTERVALS[3])} 天后再见，熟悉约 ${days(BASE_INTERVALS[2])} 天`
}

export function ReviewSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}) {
  const activeMode = MODES.find((mode) => mode.value === settings.reviewMode) ?? MODES[0]!

  return (
    <>
      <section className="card section-card">
        <div className="section-title">复习方式</div>
        <div className="section-desc">
          所有模式都只从<strong>已经到期</strong>的卡片里选——那才是间隔重复的含义。模式决定的是你按什么顺序遇到它们。
        </div>

        <Field label="排序模式" hint={activeMode.hint}>
          <SegmentedControl
            value={settings.reviewMode}
            options={MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
            onChange={(next) => void update({ reviewMode: next })}
          />
        </Field>

        <Field label="间隔强度" hint={describeIntensity(settings.reviewIntensity)}>
          <SegmentedControl
            value={settings.reviewIntensity}
            options={INTENSITIES}
            onChange={(next) => void update({ reviewIntensity: next })}
          />
        </Field>

        <Field
          label="每天复习多少张"
          hint="一次会话的上限，也是学习面板上进度环的分母。"
        >
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
        <div className="section-title">每日提醒</div>
        <div className="section-desc">
          只在<strong>确实有卡片到期、且你今天还没完成目标</strong>时才提醒。无条件响的提醒最终都会被关掉。
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>开启提醒</div>
            <div className="faint">到点后弹一条系统通知，点击直接进入复习</div>
          </div>
          <Toggle
            checked={settings.reminderEnabled}
            onChange={(next) => void update({ reminderEnabled: next })}
            label="开启每日提醒"
          />
        </div>

        {settings.reminderEnabled ? (
          <Field label="提醒时间" hint="按你本机时区的时间。">
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
