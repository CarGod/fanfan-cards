import { listEntries, watchEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { countDue } from '@/flashcard/scheduler.ts'

/**
 * 工具栏图标上的待复习数。
 *
 * 复习提醒默认是关的，弹窗要点开才看得见数字——「记」这一环原本没有任何被动触达。
 * 角标是成本最低的那种：不弹窗、不响，只是图标角上多一个数，读者顺手就能看到。
 *
 * 词库一变（收藏、复习、删除、同步）就重算；到期是随时间推移发生的，所以再用一个
 * 半小时的闹钟兜底。角标只显示到期数，没有到期就是空的，不显示 0。
 */
const ALARM = 'ara:badge'
const BADGE_COLOR = '#ff6a3d'

export function registerBadge(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void refreshBadge()
  })
  watchEntries(() => void refreshBadge())
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
  const due = countDue(await listEntries())
  const text = due === 0 ? '' : due > 99 ? '99+' : String(due)
  await action.setBadgeBackgroundColor?.({ color: BADGE_COLOR })
  await action.setBadgeText({ text })
}
