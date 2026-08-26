import type {
  Envelope,
  ErrorKind,
  MessageRequest,
  MessageResponse,
  MessageType,
  Reply,
} from '@/types/messages.ts'
import { SyncError, type SyncErrorCode } from '@/types/sync.ts'
import { AIError, type AIErrorCode } from '@/types/ai.ts'
import { isContextInvalidated } from '@/shared/extensionContext.ts'
import { t } from '@/i18n/index.ts'

/**
 * Typed `chrome.runtime` messaging.
 *
 * Errors cross the boundary as data (`{ok:false, error:{code}}`) rather than as
 * rejected promises, because structured-clone drops custom Error subclasses and
 * the UI needs the code, not a string.
 */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: MessageRequest<T>,
): Promise<MessageResponse<T>> {
  const envelope: Envelope<T> = { type, payload }

  let reply: Reply<T> | undefined
  try {
    reply = (await chrome.runtime.sendMessage(envelope)) as Reply<T> | undefined
  } catch (error) {
    // Two different failures land here and they need different advice: a worker
    // that was asleep is retryable, an orphaned script never will be.
    if (isContextInvalidated(error)) {
      throw new AIError('stale_context', 'Extension context invalidated', 'mock')
    }
    throw new AIError(
      'network',
      error instanceof Error ? error.message : t('error.messaging.no_response'),
      'mock',
    )
  }

  if (!reply) throw new AIError('unknown', t('error.messaging.empty_reply'), 'mock')
  if (!reply.ok) throw rebuild(reply.error)
  return reply.data
}

export type Handler<T extends MessageType> = (
  payload: MessageRequest<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<MessageResponse<T>>

export type HandlerMap = { [T in MessageType]?: Handler<T> }

/**
 * Registers the background router. `sendResponse` is called asynchronously, so
 * the listener must return `true` synchronously to keep the channel open.
 */
export function registerHandlers(handlers: HandlerMap): void {
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const envelope = raw as Envelope | undefined
    if (!envelope || typeof envelope.type !== 'string') return false

    const handler = handlers[envelope.type] as Handler<MessageType> | undefined
    if (!handler) return false

    handler(envelope.payload, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        const { kind, code } = classify(error)
        const message = error instanceof Error ? error.message : String(error)
        /*
         * An AIError or a SyncError is a message we already put in front of the
         * user — a rejected key, a rate limit, a remote that moved on.
         * `console.error` files those into chrome://extensions' Errors list,
         * where they look like the extension crashed and pile up until someone
         * clicks "Clear all". Only genuinely unexpected failures belong there;
         * the rest still show in devtools as warnings.
         */
        const log = kind === 'internal' ? console.error : console.warn
        log(`[fanfan] handler ${envelope.type} failed:`, error)
        sendResponse({ ok: false, error: { kind, code, message } })
      })

    return true
  })
}

/** Which error class this is, so the other side can rebuild the same one. */
function classify(error: unknown): { kind: ErrorKind; code: string } {
  if (error instanceof AIError) return { kind: 'ai', code: error.code }
  if (error instanceof SyncError) return { kind: 'sync', code: error.code }
  return { kind: 'internal', code: 'internal' }
}

/**
 * Rebuilds the error on the receiving side.
 *
 * The class matters, not just the text: the sync UI decides whether to offer
 * 「用远端覆盖本地」 by looking at a `SyncError`'s code, and an `AIError` with
 * code `unknown` — which is what every sync failure used to become — tells it
 * nothing.
 */
function rebuild(error: { kind: ErrorKind; code: string; message: string }): Error {
  if (error.kind === 'sync') return new SyncError(error.code as SyncErrorCode, error.message)
  const code = (error.code === 'internal' ? 'unknown' : error.code) as AIErrorCode
  return new AIError(code, error.message, 'mock')
}
