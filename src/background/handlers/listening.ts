import { z } from 'zod'
import { resolveForTranslation } from '../providerHealth.ts'
import { AIError } from '@/types/ai.ts'
import { getSettings, isHostEnabled } from '@/storage/repositories/settingsRepo.ts'
import { targetLanguage } from '@/shared/language.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'

const sessionSchema = z.object({ session: z.string().uuid(), revision: z.number().int().nonnegative() })
const chunkSchema = sessionSchema.extend({ audio: z.string().min(1).max(3_000_000), title: z.string().max(300) })
type Session = { id: string; owner: string; revision: number; context: string[]; abort: AbortController; busy: boolean; language: string }
let active: Session | null = null
let creating: Promise<void> | null = null
const path = 'src/audio/index.html'
function owner(sender: chrome.runtime.MessageSender): string {
  if (sender.tab?.id === undefined || sender.id !== chrome.runtime.id) throw new Error('Invalid listening sender')
  return `${sender.tab.id}:${sender.frameId ?? 0}:${sender.documentId ?? ''}`
}
async function ensureDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  creating ??= chrome.offscreen.createDocument({ url: path, reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Run local speech recognition and decode player audio without uploading audio.' }).finally(() => { creating = null })
  await creating
}
async function local(op: string, audio?: string, language?: string, continuity?: string): Promise<{ text: string }> {
  const response = await chrome.runtime.sendMessage({ target: 'fanfan-local-asr', op, audio, language, continuity }) as { text?: string; error?: string } | undefined
  if (!response || response.error) throw new Error(response?.error ?? '本地识别未响应')
  return { text: response.text ?? '' }
}
function matches(session: Session, revision: number): boolean { return active === session && session.revision === revision }
function stale(): never { throw new AIError('aborted', '听译片段已失效', 'mock') }
function clear(): void {
  active?.abort.abort()
  active = null
  void local('stop').catch(() => undefined)
}
export async function startListening(payload: MessageRequest<'audio/start'>, sender: chrome.runtime.MessageSender): Promise<MessageResponse<'audio/start'>> {
  const { session: id, revision } = sessionSchema.parse(payload)
  const key = owner(sender)
  const settings = await getSettings()
  if (!isHostEnabled(settings, new URL(sender.url ?? '').hostname)) throw new Error('本站已停用翻翻')
  const { provider } = await resolveForTranslation(settings)
  if (!provider.refineTranscript) throw new Error('请先在翻翻设置中配置 AI 服务，听译需要 AI 纠错与翻译。')
  if (active && active.owner !== key) throw new Error('另一个页面正在听译，请先停止后重试。')
  if (active) clear()
  const session: Session = { id, owner: key, revision, context: [], abort: new AbortController(), busy: false, language: (settings.videoSubtitleSourceLanguage ?? 'auto').split('-')[0]! }
  active = session
  try {
    await ensureDocument()
    if (!matches(session, revision)) stale()
    await local('load')
    if (!matches(session, revision)) stale()
    return { ready: true }
  } catch (error) { if (active === session) clear(); throw error }
}
export async function updateListening(payload: MessageRequest<'audio/update'>, sender: chrome.runtime.MessageSender): Promise<{ ok: true }> {
  const { session: id, revision } = sessionSchema.parse(payload)
  if (active?.id === id && active.owner === owner(sender)) {
    if (!payload.stop) void local('heartbeat').catch(() => undefined)
    if (payload.stop) clear()
    else if (revision > active.revision) {
      active.revision = revision
      active.abort.abort()
      active.abort = new AbortController()
      active.context = []
    }
  }
  return { ok: true }
}
function owned(id: string, revision: number, sender: chrome.runtime.MessageSender): Session {
  const session = active
  if (!session || session.id !== id || session.owner !== owner(sender) || !matches(session, revision)) stale()
  return session
}
export async function recognizeListening(payload: MessageRequest<'audio/recognize'>, sender: chrome.runtime.MessageSender): Promise<{ text: string }> {
  const input = chunkSchema.parse(payload)
  const session = owned(input.session, input.revision, sender)
  if (session.busy) throw new Error('本地识别仍在处理中')
  session.busy = true
  try {
    const result = await local('transcribe', input.audio, session.language, `${session.id}:${input.revision}`)
    if (!matches(session, input.revision)) stale()
    return result
  } finally { session.busy = false }
}
export async function refineListening(payload: MessageRequest<'audio/refine'>, sender: chrome.runtime.MessageSender): Promise<MessageResponse<'audio/refine'>> {
  const input = sessionSchema.extend({ text: z.string().max(4000), title: z.string().max(300) }).parse(payload)
  const session = owned(input.session, input.revision, sender)
  if (!input.text.trim()) return { original: '', translation: '' }
  const settings = await getSettings()
  if (!matches(session, input.revision) || !isHostEnabled(settings, new URL(sender.url ?? '').hostname)) stale()
  const { provider } = await resolveForTranslation(settings)
  if (!provider.refineTranscript) throw new Error('请配置支持纠错与翻译的 AI 服务')
  const result = await provider.refineTranscript({
    text: input.text, context: session.context.join('\n'), title: input.title,
    targetLanguage: targetLanguage(settings.videoSubtitleTargetLanguage).name,
  }, session.abort.signal)
  if (!matches(session, input.revision)) stale()
  session.context.push(result.original)
  session.context = session.context.slice(-3)
  return result
}
export async function transcribeListening(payload: MessageRequest<'audio/chunk'>, sender: chrome.runtime.MessageSender): Promise<MessageResponse<'audio/chunk'>> {
  const { text } = await recognizeListening(payload, sender)
  return refineListening({ session: payload.session, revision: payload.revision, text: text.slice(0,4000), title: payload.title }, sender)
}
// A closed tab must not keep model memory or an in-flight text request alive.
export function registerListeningCleanup(): void {
  chrome.tabs.onRemoved.addListener((id) => { if (active?.owner.startsWith(`${id}:`)) clear() })
  chrome.tabs.onUpdated.addListener((id, change) => { if (change.status === 'loading' && active?.owner.startsWith(`${id}:`)) clear() })
}
