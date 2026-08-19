import type {
  Envelope,
  MessageRequest,
  MessageResponse,
  MessageType,
  Reply,
} from '@/types/messages.ts'
import { AIError, type AIErrorCode } from '@/types/ai.ts'
import { isContextInvalidated } from '@/shared/extensionContext.ts'

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
      error instanceof Error ? error.message : '扩展后台未响应，请刷新页面重试',
      'mock',
    )
  }

  if (!reply) throw new AIError('unknown', '后台没有返回结果', 'mock')
  if (!reply.ok) {
    const code = (reply.error.code === 'internal' ? 'unknown' : reply.error.code) as AIErrorCode
    throw new AIError(code, reply.error.message, 'mock')
  }
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
        const code = error instanceof AIError ? error.code : 'internal'
        const message = error instanceof Error ? error.message : String(error)
        /*
         * An AIError is a message from the provider that we already put in
         * front of the user — a rejected key, a rate limit, a malformed
         * response. `console.error` files those into chrome://extensions'
         * Errors list, where they look like the extension crashed and pile up
         * until someone clicks "Clear all". Only genuinely unexpected failures
         * belong there; the rest still show in devtools as warnings.
         */
        const log = error instanceof AIError ? console.warn : console.error
        log(`[fanfan] handler ${envelope.type} failed:`, error)
        sendResponse({ ok: false, error: { code, message } })
      })

    return true
  })
}
