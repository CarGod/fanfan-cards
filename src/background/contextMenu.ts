import { t } from '@/i18n/index.ts'

export const CONTEXT_MENU_ID = 'ai-reader-explain'
let pending: Promise<void> = Promise.resolve()

/** Install, startup and language restoration may arrive together. Keep the
 * entire remove/create pair serialized, including Chrome's async callbacks. */
export function refreshContextMenu(): Promise<boolean> {
  const next = pending.then(async () => {
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.removeAll(() => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve()
      })
    })
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: t('background.menu.explain', { name: t('app.name') }),
        contexts: ['selection'],
      }, () => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve()
      })
    })
  })
  // A failed browser operation must not poison later refreshes or produce an
  // unhandled rejection; lastError is consumed in its own callback above.
  pending = next.catch(() => undefined)
  return next.then(() => true, () => false)
}
