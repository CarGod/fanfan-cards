import { getConfigState } from './state.ts'
import { synchronizeConfiguration } from './service.ts'

/** The local filesystem offers no change event here. Poll only visible settings
 * pages, including the AI tab. Background alarms cover closed/hidden pages. */
export function startConfigurationPolling(): () => void {
  let stopped = false
  let running = false
  let lastStarted = -Infinity
  const check = () => {
    if (stopped || document.visibilityState === 'hidden' || running || Date.now() - lastStarted < 1000) return
    running = true
    lastStarted = Date.now()
    void (async () => {
      const state = await getConfigState()
      if (!stopped && state.mode === 'directory') await synchronizeConfiguration()
    })().catch(() => undefined).finally(() => { running = false })
  }
  const timer = setInterval(check, 15000)
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
  check()
  return () => {
    stopped = true
    clearInterval(timer)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', check)
  }
}
