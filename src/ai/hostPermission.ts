import { t } from '@/i18n/index.ts'

/**
 * Turn a user-entered API base URL into the narrowest host permission Chrome
 * can grant. Paths are deliberately discarded: host permissions are origin
 * scoped even when the model endpoint lives below `/v1`.
 */
export function optionalApiOrigin(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    throw new Error(t('error.host.invalid_url'))
  }

  if (parsed.protocol === 'https:') return `${parsed.origin}/*`
  if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') {
    return 'http://localhost/*'
  }
  throw new Error(t('error.host.https_required'))
}

/**
 * Custom gateways are optional, so their host access is requested only after
 * the user clicks "测试连接". Calling request directly (rather than awaiting a
 * preliminary contains check) preserves Chrome's user-gesture requirement.
 */
export async function requestOptionalApiAccess(rawUrl: string): Promise<void> {
  const origin = optionalApiOrigin(rawUrl)
  const granted = await chrome.permissions.request({ origins: [origin] })
  if (!granted) throw new Error(t('error.host.not_granted', { origin: new URL(rawUrl).origin }))
}
