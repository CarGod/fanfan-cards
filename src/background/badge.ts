import { listEntries, watchEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { getSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { readActivity, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue, remainingToday } from '@/flashcard/scheduler.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'

/**
 * 工具栏图标上的数字：**今天还要复习几张**。
 *
 * 不是「一共到期几张」——那个数会随着词库变大一直涨，看着只会焦虑。设置里有
 * 「每日复习目标」，角标就按它算：目标减去今天已复习的，再不超过实际到期的数。
 * 今天的目标完成了，角标就消失，哪怕还有到期的词。
 *
 * 词库、活动记录、设置任一变了就重算；到期和「今天」都是随时间推移变的，
 * 所以再用一个半小时的闹钟兜底（跨过零点后已复习数归零，角标会回来）。
 */
const ALARM = 'ara:badge'
const BADGE_COLOR = '#ff6a3d'

export function registerBadge(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void refreshBadge()
  })
  watchEntries(() => void refreshBadge())
  watchSettings(() => void refreshBadge())
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.activity]) void refreshBadge()
  })
}

export async function ensureBadgeAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM)
  if (!existing) chrome.alarms.create(ALARM, { periodInMinutes: 30 })
  await refreshBadge()
}

export async function refreshBadge(): Promise<void> {
  // 冒烟测试用的假 chrome 没有 action；真浏览器里总有。
  const action = chrome.action as typeof chrome.action | undefined
  if (!action?.setBadgeText) return
  const [entries, settings, activity] = await Promise.all([listEntries(), getSettings(), readActivity()])
  const remaining = remainingToday(
    countDue(entries),
    settings.dailyReviewGoal,
    todayActivity(activity).reviewed,
  )
  const text = remaining === 0 ? '' : remaining > 99 ? '99+' : String(remaining)
  await action.setBadgeBackgroundColor?.({ color: BADGE_COLOR })
  await action.setBadgeText({ text })
}
