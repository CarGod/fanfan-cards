import { DOCUMENT_KEY } from '@/configuration/document.ts'
import { CONFIG_STATE_KEY } from '@/configuration/state.ts'
import { SYNC_PREFIX, synchronizeConfiguration } from '@/configuration/service.ts'

const ALARM = 'fanfan:configuration-retry'
export function registerConfigurationSync(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => { void synchronizeConfiguration() }
  const schedule = () => {
    clearTimeout(timer)
    // Coalesce keystrokes and rapid switches; the alarm covers worker termination and failures.
    timer = setTimeout(run, 1500)
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && Object.keys(changes).some((key) => key.startsWith(SYNC_PREFIX))) schedule()
    if (area === 'local' && changes[DOCUMENT_KEY]) schedule()
    const modeChange = changes[CONFIG_STATE_KEY]
    if (area === 'local' && modeChange &&
      (modeChange.newValue as { mode?: string } | undefined)?.mode !== (modeChange.oldValue as { mode?: string } | undefined)?.mode) schedule()
  })
  chrome.alarms?.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) run() })
  chrome.runtime.onStartup.addListener(run)
  chrome.runtime.onInstalled.addListener(run)
  void (async () => {
    if (chrome.alarms && !await chrome.alarms.get(ALARM)) {
      await chrome.alarms.create(ALARM, { periodInMinutes: 5 })
    }
  })().catch(() => undefined)
  run()
}
