import { getSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { listEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { readActivity, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue } from '@/flashcard/scheduler.ts'
import { APP_PAGE } from '@/shared/constants.ts'

/**
 * Daily review reminder.
 *
 * Two rules keep this from becoming the notification everyone turns off:
 * it stays quiet when nothing is due, and it stays quiet when the user has
 * already hit their goal today. A reminder that fires regardless of whether
 * there is anything to do is just noise, and noise gets muted permanently.
 */
const ALARM = 'ara:reminder'

/**
 * Next occurrence of a wall-clock time, in local time.
 *
 * Pure and clock-injected so the "already past today" boundary is testable —
 * getting it wrong means the reminder either fires immediately on save or skips
 * a day.
 */
export function nextReminderAt(time: string, now: number = Date.now()): number {
  const [hours = 20, minutes = 0] = time.split(':').map((part) => Number(part))
  const next = new Date(now)
  next.setHours(hours, minutes, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 1)
  return next.getTime()
}

export function registerReminder(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void fireReminder()
  })

  chrome.notifications?.onClicked.addListener((id) => {
    if (!id.startsWith(ALARM)) return
    chrome.notifications.clear(id)
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${APP_PAGE}#/flashcard`) })
  })

  watchSettings(() => void ensureReminderAlarm())
}

export async function ensureReminderAlarm(): Promise<void> {
  const settings = await getSettings()
  const existing = await chrome.alarms.get(ALARM)

  if (!settings.reminderEnabled) {
    if (existing) await chrome.alarms.clear(ALARM)
    return
  }

  const when = nextReminderAt(settings.reminderTime)
  // Re-creating resets the countdown, so only touch it when the time moved.
  if (existing && Math.abs((existing.scheduledTime ?? 0) - when) < 60_000) return

  await chrome.alarms.clear(ALARM)
  chrome.alarms.create(ALARM, { when, periodInMinutes: 24 * 60 })
}

async function fireReminder(): Promise<void> {
  const settings = await getSettings()
  if (!settings.reminderEnabled) return

  const [entries, activity] = await Promise.all([listEntries(), readActivity()])
  const due = countDue(entries)
  if (due === 0) return

  const reviewedToday = todayActivity(activity).reviewed
  if (reviewedToday >= settings.dailyReviewGoal) return

  chrome.notifications?.create(`${ALARM}:${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: `有 ${due} 张卡片等你复习`,
    message:
      reviewedToday > 0
        ? `今天已复习 ${reviewedToday} 张，还差 ${Math.max(0, settings.dailyReviewGoal - reviewedToday)} 张到目标。`
        : '花几分钟，把今天遇到的词变成记得住的词。',
    priority: 0,
  })
}
