/**
 * Detects an orphaned content script.
 *
 * When the extension is reloaded or updated, content scripts already injected
 * into open tabs keep running, but their `chrome.*` APIs are torn out from
 * under them: `chrome.storage` and `chrome.runtime.onMessage` become
 * `undefined`, and every later call throws
 * `Cannot read properties of undefined`.
 *
 * This is not just a developer annoyance — it happens to every user on every
 * extension update, on every tab they have open. The right behaviour is to stop
 * cleanly and tell them to refresh, not to throw into the void.
 */
export function isExtensionAlive(): boolean {
  try {
    return Boolean(chrome?.runtime?.id)
  } catch {
    // Accessing chrome.runtime can itself throw in an invalidated context.
    return false
  }
}

/** True when an error is the "your script outlived its extension" failure. */
export function isContextInvalidated(error: unknown): boolean {
  if (!isExtensionAlive()) return true
  const message = error instanceof Error ? error.message : String(error)
  return /Extension context invalidated|message port closed|receiving end does not exist/i.test(
    message,
  )
}
