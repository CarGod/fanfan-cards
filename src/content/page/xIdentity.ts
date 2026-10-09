/** X identity labels are UI metadata, even when a display name is a sentence. */
const X_HOST = /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i
const IDENTITY = '[data-testid="User-Name"], [data-testid="UserName"]'
// Live cards have no profile link: only the row directly holding an avatar is identity.
const LIVE_IDENTITY = '[data-testid="sidebarColumn"] button div:has(> [data-testid^="UserAvatar-Container-"])'
const PROSE = '[data-testid="tweetText"], [data-testid="UserDescription"], p, blockquote'
const RESERVED_ROUTES = new Set([
  'home', 'explore', 'notifications', 'messages', 'search', 'settings', 'compose',
  'i', 'login', 'logout', 'signup', 'tos', 'privacy', 'jobs', 'about', 'download',
])

export function isXIdentity(element: Element): boolean {
  const location = element.ownerDocument.location
  if (!location || !X_HOST.test(location.hostname)) return false
  if (element.closest(IDENTITY)) return true
  // Mentions are part of the sentence; never remove them from tweet/bio input.
  if (element.closest(PROSE)) return false
  if (element.closest(LIVE_IDENTITY)) return true
  const link = element.closest('a[href]')
  if (!link) return false
  // Sidebar bios lack UserDescription; keep their inline @mentions too.
  // Standalone handles are already rejected by the language filter.
  if (/^@[a-zA-Z0-9_]{1,15}$/.test(link.textContent?.trim() ?? '')) return false
  try {
    const url = new URL(link.getAttribute('href')!, location.href)
    if (!X_HOST.test(url.hostname)) return false
    const match = /^\/([a-zA-Z0-9_]{1,15})\/?$/.exec(url.pathname)
    return !!match && !RESERVED_ROUTES.has(match[1]!.toLowerCase())
  } catch {
    return false
  }
}
