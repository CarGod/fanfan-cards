/**
 * Typed message contract between content scripts and the background worker.
 *
 * Only content scripts need this hop — they have no API keys and are subject to
 * the host page's CSP. Extension pages (popup/options/app) talk to
 * `chrome.storage` through the repositories directly.
 */

import type { ExplainWordInput, WordExplanation, AIErrorCode } from './ai.ts'
import type { VocabularyEntry } from './vocabulary.ts'
import type { Settings } from './settings.ts'
import type { SyncErrorCode } from './sync.ts'

export interface SaveWordPayload {
  /**
   * Exactly what the user selected. Preferred over the model's echo, which is
   * sometimes the lemma ("mislead") rather than the surface form the user saw.
   */
  selection: string
  explanation: WordExplanation
  source: {
    url: string
    title: string
    context: string
    wideContext: string
  }
  origin: { providerId: string; model: string; offline: boolean }
}

/** request -> response map; keys double as the runtime discriminator. */
export interface MessageMap {
  ping: { req: Record<string, never>; res: { ok: true; version: string } }
  'ai/explain': {
    /**
     * `forceOffline` retries with the local dictionary after a provider error.
     * `refresh` skips the cache — what "retry" has to mean to be worth clicking.
     */
    req: ExplainWordInput & { forceOffline?: boolean; refresh?: boolean }
    // `detail` travels on ExplainWordInput; the two-phase flow is a content-side
    // decision, so the handler stays a single request/response.
    res: {
      explanation: WordExplanation
      providerId: string
      model: string
      offline: boolean
      cached: boolean
      /** Set when the configured provider was unusable and we downgraded. */
      downgradeReason?: string
    }
  }
  'vocab/save': { req: SaveWordPayload; res: { entry: VocabularyEntry; created: boolean } }
  /** Matches any of the given forms, so an inflected selection still hits. */
  'vocab/lookup': { req: { words: string[] }; res: { entry: VocabularyEntry | null } }
  'vocab/remove': { req: { id: string }; res: { removed: boolean } }
  'settings/get': { req: Record<string, never>; res: { settings: Settings } }
  'app/open': { req: { route?: string }; res: { opened: true } }
  'options/open': { req: Record<string, never>; res: { opened: true } }
  /**
   * Content script reporting whether this tab is currently translated.
   *
   * Keyed by **host**, not by tab.
   *
   * Tab-keyed state was wrong in the way users notice: on a single-page app the
   * tab keeps translating while its URL changes, and on a full reload the tab id
   * survives but the content script does not — so the button and the page
   * disagreed. "I turned this on for x.com" is what the reader actually meant,
   * and it holds across SPA navigation, reloads and new tabs on the same site.
   */
  'page/state': { req: { translating: boolean }; res: { ok: true } }
  /** Asked once on load: should this page translate itself without being told? */
  'page/shouldTranslate': { req: Record<string, never>; res: { translating: boolean } }
  /**
   * Run a sync, in the background.
   *
   * The options page used to call `runSync()` itself. That put a second copy of
   * the whole pull-merge-push in a different JavaScript context from the worker's
   * — and the mutex guarding it is a module-level variable, so the two contexts
   * could not see each other's. Two syncs then read the same HEAD, the first
   * won, and the second came back with 「远端已前进」 about a commit this very
   * device had just made. One owner, one lock.
   *
   * `mode` lets the user break a genuine deadlock by choosing a side.
   */
  'sync/run': {
    req: { mode?: 'merge' | 'forcePush' | 'forcePull' }
    res: {
      pushed: number
      pulled: number
      filesChanged: number
      repoFullName: string
      repoUrl: string
      changed: boolean
    }
  }
  /** Whole-page translation; batched because round trips dominate the cost. */
  'page/translate': {
    req: { texts: string[]; hint?: string }
    res: { translations: string[] }
  }
}

export type MessageType = keyof MessageMap
export type MessageRequest<T extends MessageType> = MessageMap[T]['req']
export type MessageResponse<T extends MessageType> = MessageMap[T]['res']

export interface Envelope<T extends MessageType = MessageType> {
  type: T
  payload: MessageRequest<T>
}

/**
 * A failure, carried across the message boundary with enough to rebuild it.
 *
 * `kind` exists because the codes overlap: `auth`, `rate_limit`, `network`,
 * `timeout` and `unknown` are both AI error codes and sync error codes, so the
 * code alone cannot say which class to reconstruct. Without it every sync
 * failure arrived as an AIError with code `unknown`, and the Chinese
 * explanations in `SYNC_ERROR_MESSAGES` — the whole point of having them —
 * never once rendered for a manual sync.
 */
export type ErrorKind = 'ai' | 'sync' | 'internal'

export type Reply<T extends MessageType> =
  | { ok: true; data: MessageResponse<T> }
  | {
      ok: false
      error: { kind: ErrorKind; code: AIErrorCode | SyncErrorCode | 'internal'; message: string }
    }

/**
 * Background -> content-script commands (context menu, keyboard shortcut).
 * These travel over `chrome.tabs.sendMessage`, the opposite direction to
 * {@link MessageMap}, and are fire-and-forget.
 */
export type ContentCommand =
  | { type: 'content/explain-selection' }
  | { type: 'content/dismiss' }
  | { type: 'content/toggle-page-translation' }
