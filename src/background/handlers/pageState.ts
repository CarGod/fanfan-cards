import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

/**
 * Which sites are currently being translated.
 *
 * Keyed by host rather than by tab. Tab-keyed state broke in both directions:
 * on a single-page app the tab keeps translating while its URL changes, and on
 * a full reload the tab id survives while the content script does not — so the
 * popup button and the page disagreed about whether translation was on.
 *
 * `chrome.storage.session` is the right home: wiped when the browser closes,
 * survives the service worker being recycled, and needs no cleanup at all now
 * that entries are not tied to a tab's lifetime.
 */
const PREFIX = 'ara:translateHost:'

function keyFor(host: string): string {
  return `${PREFIX}${host}`
}

/** Empty for pages with no host of their own (about:, data:, file:). */
export function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export async function handlePageState(
  payload: MessageRequest<'page/state'>,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse<'page/state'>> {
  const host = hostOf(sender.tab?.url ?? sender.url)
  if (!host) return { ok: true }

  if (payload.translating) await chrome.storage.session.set({ [keyFor(host)]: true })
  else await chrome.storage.session.remove(keyFor(host))

  return { ok: true }
}

/**
 * Answered on every content-script load.
 *
 * This is what makes the setting stick: a reader who turned translation on for
 * a site gets it on the next page of that site too, without pressing anything.
 */
export async function handleShouldTranslate(
  _payload: MessageRequest<'page/shouldTranslate'>,
  sender: chrome.runtime.MessageSender,
): Promise<MessageResponse<'page/shouldTranslate'>> {
  return { translating: await isHostTranslating(hostOf(sender.tab?.url ?? sender.url)) }
}

export async function isHostTranslating(host: string): Promise<boolean> {
  if (!host) return false
  const key = keyFor(host)
  const result = await chrome.storage.session.get(key)
  return result[key] === true
}
