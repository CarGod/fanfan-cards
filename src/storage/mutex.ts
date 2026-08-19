/**
 * `chrome.storage` has no transactions: a read-modify-write on the word map can
 * be lost if two writers interleave. Every write path funnels through here.
 *
 * The lock has to be **cross-context**, which the obvious implementation is not.
 * An extension runs several independent JavaScript contexts — the service
 * worker, the options page, the flashcard app, the popup — and a module-level
 * queue exists once per context, so each one happily serialises against itself
 * while trampling the others. Reviewing a card in the app while the worker was
 * pulling from GitHub really did overwrite the review.
 *
 * Web Locks is the right primitive: extension pages and the service worker all
 * live on the same `chrome-extension://<id>` origin, so one named lock is shared
 * by all of them. Content scripts sit in the host page's origin and would *not*
 * share it — which is fine, because they never touch storage directly; they send
 * a message and let the worker write.
 *
 * The in-memory chain stays as a fallback for environments without Web Locks
 * (the test runner, chiefly), where a single context is all there is anyway.
 */
const chains = new Map<string, Promise<unknown>>()

function inThisContext<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  // Keep the chain alive but never let a rejection poison the next writer.
  chains.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

export async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks) return inThisContext(key, task)
  // Named per key, so saving a word never waits on a settings write.
  return (await locks.request(`fanfan:${key}`, task)) as T
}
