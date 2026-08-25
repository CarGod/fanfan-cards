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
    throw new Error('API 地址不是有效的网址')
  }

  if (parsed.protocol === 'https:') return `${parsed.origin}/*`
  if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') {
    return 'http://localhost/*'
  }
  throw new Error('API 地址必须使用 HTTPS；本机调试可使用 http://localhost')
}

/**
 * Custom gateways are optional, so their host access is requested only after
 * the user clicks "测试连接". Calling request directly (rather than awaiting a
 * preliminary contains check) preserves Chrome's user-gesture requirement.
 */
export async function requestOptionalApiAccess(rawUrl: string): Promise<void> {
  const origin = optionalApiOrigin(rawUrl)
  const granted = await chrome.permissions.request({ origins: [origin] })
  if (!granted) throw new Error(`未授权访问 ${new URL(rawUrl).origin}，无法连接这个 API 地址`)
}
