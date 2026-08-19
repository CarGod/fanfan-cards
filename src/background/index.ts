import { APP_PAGE, OPTIONS_PAGE } from '@/shared/constants.ts'
import { registerHandlers } from '@/services/messaging.ts'
import { initStorage } from '@/storage/migrations.ts'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import type { ContentCommand } from '@/types/messages.ts'
import { handleExplain } from './handlers/explain.ts'
import { handleLookupWord, handleRemoveWord, handleSaveWord } from './handlers/vocabulary.ts'
import { handleTranslatePage } from './handlers/translate.ts'
import { handlePageState, handleShouldTranslate } from './handlers/pageState.ts'
import { ensureSyncAlarm, registerSyncScheduler, requestSync } from './sync.ts'
import { ensureReminderAlarm, registerReminder } from './reminder.ts'

/**
 * MV3 service worker.
 *
 * It is ephemeral: Chrome kills it after ~30s idle and restarts it on the next
 * event. Nothing here may hold state in module scope beyond caches that are safe
 * to lose — every durable fact lives in chrome.storage. Listeners are registered
 * at the top level (not inside async callbacks) so a cold start still receives
 * the event that woke the worker.
 */

const CONTEXT_MENU_ID = 'ai-reader-explain'

// Registered in the first synchronous turn, before any await: a listener added
// later would miss the very event that woke this worker up.
registerSyncScheduler()
registerReminder()

registerHandlers({
  ping: async () => ({ ok: true, version: chrome.runtime.getManifest().version }),
  'ai/explain': handleExplain,
  'vocab/save': handleSaveWord,
  'vocab/lookup': handleLookupWord,
  'vocab/remove': handleRemoveWord,
  'settings/get': async () => ({ settings: await getSettings() }),
  'page/translate': handleTranslatePage,
  'page/state': handlePageState,
  'sync/run': async (payload) => requestSync(payload.mode ?? 'merge'),
  'page/shouldTranslate': handleShouldTranslate,
  'app/open': async (payload) => {
    await openAppPage(payload.route)
    return { opened: true }
  },
  'options/open': async () => {
    // Content scripts cannot call `openOptionsPage` themselves.
    await chrome.runtime.openOptionsPage()
    return { opened: true }
  },
})

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await initStorage()
    createContextMenu()
    await ensureSyncAlarm()
    await ensureReminderAlarm()
    if (details.reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`${OPTIONS_PAGE}?welcome=1`) })
    }
  })()
})

// Menus live in a separate store that survives worker restarts but not browser
// restarts, so re-assert them on startup as well as on install.
chrome.runtime.onStartup.addListener(() => {
  void initStorage()
  createContextMenu()
  void ensureSyncAlarm()
  void ensureReminderAlarm()
})

/*
 * No tab bookkeeping any more.
 *
 * These two listeners used to forget a tab's translation state on close and on
 * navigation. Both were correct for tab-keyed state and both were the bug:
 * navigating within a site is exactly when the reader wants translation to keep
 * going. The state now belongs to the host and is asked for by each content
 * script as it loads.
 */

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return
  void sendToContent(tab.id, { type: 'content/explain-selection' })
})

chrome.commands?.onCommand.addListener((command, tab) => {
  if (command === 'explain-selection' && tab?.id) {
    void sendToContent(tab.id, { type: 'content/explain-selection' })
  }
  if (command === 'translate-page' && tab?.id) {
    void sendToContent(tab.id, { type: 'content/toggle-page-translation' })
  }
  if (command === 'open-app') void openAppPage('#/dashboard')
})

function createContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '用 AI Reader 解释「%s」',
      contexts: ['selection'],
    })
  })
}

async function sendToContent(tabId: number, command: ContentCommand): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, command)
  } catch {
    // No content script on this tab (chrome:// page, PDF viewer, or the page
    // loaded before the extension did). Silently ignoring is correct here.
  }
}

/** Reuse an already-open app tab instead of piling up duplicates. */
async function openAppPage(route = '#/dashboard'): Promise<void> {
  const base = chrome.runtime.getURL(APP_PAGE)
  const url = `${base}${route}`
  const existing = await chrome.tabs.query({ url: `${base}*` })
  const target = existing[0]

  if (target?.id !== undefined) {
    await chrome.tabs.update(target.id, { active: true, url })
    if (target.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true })
    return
  }
  await chrome.tabs.create({ url })
}
