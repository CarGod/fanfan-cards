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

/*
 * 一旦发现自己是孤儿，就把这件事记下来，只记一次。
 *
 * 这不是开发期的小烦恼：扩展每更新一次，用户当时开着的每一个标签页都会变成这样。
 * 之前的表现是每一次悬停、每一次翻译都往控制台扔一条 `Extension context invalidated`,
 * 看起来像插件坏了——而它其实只是需要刷新一下。所以要做三件事：认出来、停下来、
 * 说一句人话。
 */
let orphaned = false
const orphanListeners = new Set<() => void>()

/** 已经确认失联。这个状态只会从 false 变成 true。 */
export function isOrphaned(): boolean {
  return orphaned
}

/** 失联时回调一次。返回退订函数。 */
export function onOrphaned(listener: () => void): () => void {
  if (orphaned) {
    listener()
    return () => undefined
  }
  orphanListeners.add(listener)
  return () => orphanListeners.delete(listener)
}

/**
 * 判断这个错误是不是「脚本活得比扩展久」。是的话顺手把状态锁上并通知所有人。
 *
 * 调用方拿到 true 之后应当**安静地**停下来：不重试、不报错、不动页面上已有的译文。
 */
export function noteOrphanError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code !== 'stale_context' && !isContextInvalidated(error)) return false

  if (!orphaned) {
    orphaned = true
    for (const listener of [...orphanListeners]) listener()
    orphanListeners.clear()
  }
  return true
}
