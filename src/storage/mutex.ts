/**
 * `chrome.storage` has no transactions: a read-modify-write on the word map can
 * be lost if two saves interleave (e.g. two tabs saving at once). Every write
 * path funnels through this per-key serial queue.
 */
const chains = new Map<string, Promise<unknown>>()

export function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  // Keep the chain alive but never let a rejection poison the next writer.
  chains.set(
    key,
    next.catch(() => undefined),
  )
  return next
}
