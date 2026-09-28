import { DOCUMENT_KEY } from '@/configuration/document.ts'
import { CONFIG_STATE_KEY } from '@/configuration/state.ts'
import { SYNC_PREFIX, synchronizeConfiguration } from '@/configuration/service.ts'

const ALARM = 'fanfan:configuration-retry'
const PERIOD_MINUTES = 1
export function registerConfigurationSync(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let lastStarted = -Infinity
  let pendingEdit = false
  const run = (rememberEdit = false) => {
    if (running) { pendingEdit ||= rememberEdit; return }
    running = true
    lastStarted = Date.now()
    void Promise.resolve(synchronizeConfiguration()).finally(() => {
      running = false
      if (pendingEdit) { pendingEdit = false; run() }
    })
  }
  const schedule = () => {
    clearTimeout(timer)
    // Coalesce keystrokes and rapid switches; the alarm covers worker termination and failures.
    timer = setTimeout(() => run(true), 1500)
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith(SYNC_PREFIX))) schedule()
    if (area === 'local' && changes[DOCUMENT_KEY]) schedule()
    const modeChange = changes[CONFIG_STATE_KEY]
    if (area === 'local' && modeChange &&
      (modeChange.newValue as { mode?: string } | undefined)?.mode !== (modeChange.oldValue as { mode?: string } | undefined)?.mode) schedule()
  })
  chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) run() })
  const ensureAlarm = async () => {
    if (!chrome.alarms) return
    const alarm = await chrome.alarms.get(ALARM)
    // Upgrade existing five-minute alarms too; they survive extension updates.
    if (alarm?.periodInMinutes !== PERIOD_MINUTES) {
      await chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES })
    }
  }
  const wake = () => { void ensureAlarm().catch(() => undefined); run() }
  chrome.runtime.onStartup.addListener(wake)
  chrome.runtime.onInstalled.addListener(wake)
  chrome.windows?.onFocusChanged?.addListener((windowId) => {
    if (windowId >= 0 && Date.now() - lastStarted >= 15000) run()
  })
  void ensureAlarm().catch(() => undefined)
  run()
}
