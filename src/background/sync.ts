import { runSync, type SyncMode, type SyncResult } from '@/sync/syncService.ts'
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
 * True while a sync is running **in this worker**.
 *
 * Two jobs. First, a sync that pulls remote words writes to `ara:words`, which
 * would trip the change listener and schedule another sync; skipping that saves
 * a pointless round trip.
 *
 * Second, and the reason this file now owns every sync: a module-level flag is
 * per JavaScript context. The options page used to call `runSync()` directly, in
 * *its* context, where this variable does not exist — so the page and the worker
 * could sync at the same time, read the same HEAD, and the loser came back with
 * 「远端已前进」 about a commit this very device had just pushed. Every caller
 * now goes through `requestSync`, so there is one flag and one owner.
 *
 * In-memory is fine: losing the flag to a worker restart costs one redundant
 * sync, never correctness.
 */
let syncing = false
/**
 * Shared with in-flight callers so a second request joins rather than queues.
 *
 * Keyed by mode, because joining is only correct when the two callers want the
 * same thing. Handing a 「用远端覆盖本地」 request the promise of a plain merge
 * that happened to be running made the UI report a destructive operation as
 * done when it had never run — the worst shape a bug can take in this feature.
 */
let inFlight: { mode: SyncMode; promise: Promise<SyncResult> } | null = null

/**
 * The one entry point for running a sync.
 *
 * A second request while one is running gets the *same* promise rather than a
 * second round trip — pressing 「立即同步」 twice should mean "sync", not "sync
 * twice".
 */
export async function requestSync(mode: SyncMode = 'merge'): Promise<SyncResult> {
  // Same intent: join. Different intent: wait for the current one, then do it.
  if (inFlight) {
    if (inFlight.mode === mode) return inFlight.promise
    await inFlight.promise.catch(() => undefined)
    return requestSync(mode)
  }
  syncing = true
  const promise = runSync(mode).finally(() => {
    syncing = false
    inFlight = null
  })
  inFlight = { mode, promise }
  return promise
}

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
  try {
    await requestSync()
  } catch (error) {
    // The failure is already recorded in sync state for the options page; an
    // unhandled rejection here would just noise up the worker console.
    console.warn('[fanfan] scheduled sync failed:', error)
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
