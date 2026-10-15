import { OPTIONS_NAVIGATION_KEY } from '@/shared/optionsNavigation.ts'

/** Native opening reuses settings without requiring access to users' tab URLs. */
export async function openModelSettings(): Promise<{ opened: true }> {
  await chrome.storage.local.set({ [OPTIONS_NAVIGATION_KEY]: { section: 'model', requestedAt: Date.now() } })
  await chrome.runtime.openOptionsPage()
  return { opened: true }
}
