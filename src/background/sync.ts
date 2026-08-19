import { runSync } from '@/sync/syncService.ts'
import { getSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'

/**
 * Scheduled background sync.
 *
 * `chrome.alarms`, never `setInterval`: a timer inside a service worker dies
 * silently when Chrome reclaims the worker, which is the worst kind of failure —
 * it looks like it is working. Alarms survive and wake the worker back up.
 */
const ALARM = 'ara:sync'
/** One-shot debounce alarm fired after the library changes. */
const ALARM_SOON = 'ara:sync-soon'
/**
 * MV3 clamps alarms to 30 seconds. That doubles as a good debounce window:
 * saving five words in a row produces one sync half a minute after the last
 * one, not five syncs and five commits.
 */
const DEBOUNCE_MINUTES = 0.5

/**
 * True while a sync is running.
 *
 * A sync that pulls remote words writes to `ara:words`, which would trip the
 * change listener and schedule another sync. That loop terminates on its own
 * (the second pass finds nothing to commit), but skipping it saves a pointless
 * round trip. In-memory is fine: losing the flag to a worker restart costs one
 * redundant sync, never correctness.
 */
let syncing = false

export function registerSyncScheduler(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM && alarm.name !== ALARM_SOON) return
    void safeSync()
  })

  // Re-evaluate whenever the user changes sync settings in any surface.
  watchSettings(() => void ensureSyncAlarm())

  // Saving, editing or deleting a word should reach the repository without the
  // user thinking about it. Waiting up to 30 minutes for the periodic alarm
  // makes the repo feel stale exactly when the user just did something.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || syncing) return
    if (!changes[STORAGE_KEYS.words]) return
    void scheduleSyncSoon()
  })
}

async function safeSync(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await runSync()
  } catch (error) {
    // The failure is already recorded in sync state for the options page; an
    // unhandled rejection here would just noise up the worker console.
    console.warn('[fanfan] scheduled sync failed:', error)
  } finally {
    syncing = false
  }
}

/**
 * Debounced by construction: re-creating an alarm resets its countdown, so a
 * burst of saves collapses into a single sync. (The same behaviour is a hazard
 * for periodic alarms — see `ensureSyncAlarm` — and exactly what we want here.)
 */
export async function scheduleSyncSoon(): Promise<void> {
  const { sync } = await getSettings()
  if (!sync.enabled || !sync.autoSync || !sync.token.trim()) return
  chrome.alarms.create(ALARM_SOON, { delayInMinutes: DEBOUNCE_MINUTES })
}

/**
 * Creating an alarm that already exists resets its countdown, so a worker that
 * restarts every few minutes would never actually fire a periodic alarm. Always
 * check first.
 */
export async function ensureSyncAlarm(): Promise<void> {
  const { sync } = await getSettings()
  const wanted = sync.enabled && sync.autoSync && sync.token.trim() !== ''

  const existing = await chrome.alarms.get(ALARM)
  if (!wanted) {
    if (existing) await chrome.alarms.clear(ALARM)
    await chrome.alarms.clear(ALARM_SOON)
    return
  }
  if (existing && existing.periodInMinutes === sync.intervalMinutes) return

  await chrome.alarms.clear(ALARM)
  chrome.alarms.create(ALARM, {
    delayInMinutes: sync.intervalMinutes,
    periodInMinutes: sync.intervalMinutes,
  })
}
