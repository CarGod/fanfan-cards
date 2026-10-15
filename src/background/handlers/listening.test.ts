import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startListening, transcribeListening, updateListening } from './listening.ts'
import { resolveForTranslation as resolveProvider } from '../providerHealth.ts'
vi.mock('../providerHealth.ts', () => ({ resolveForTranslation: vi.fn() }))
vi.mock('@/storage/repositories/settingsRepo.ts', () => ({ getSettings: async () => ({ videoSubtitleTargetLanguage: 'zh-CN' }), isHostEnabled: () => true }))
const sender = { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'doc', url: 'https://example.com' } as chrome.runtime.MessageSender
const session = '7041f9fb-63f2-4348-bdf0-d57278333a85'
const runtimeSend = vi.fn(async (message: { op: string }) => ({ text: message.op === 'transcribe' ? 'Recognized speech' : '' }))
const refine = vi.fn(async () => ({ original: 'Corrected speech', translation: '翻译' }))
describe('listening privacy and ownership', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage: runtimeSend }, offscreen: { hasDocument: async () => true } })
    vi.mocked(resolveProvider).mockResolvedValue({ provider: { refineTranscript: refine } } as unknown as Awaited<ReturnType<typeof resolveProvider>>)
  })
  afterEach(async () => { await updateListening({ session, revision: 0, stop: true }, sender); vi.clearAllMocks(); vi.unstubAllGlobals() })
  it('passes text only to the configured AI and blocks foreign tabs', async () => {
    await startListening({ session, revision: 0 }, sender)
    const chunk = { session, revision: 0, audio: 'YXVkaW8=', title: 'Test' }
    await expect(transcribeListening(chunk, { ...sender, tab: { id: 2 } } as chrome.runtime.MessageSender)).rejects.toThrow()
    expect(refine).not.toHaveBeenCalled()
    expect(await transcribeListening(chunk, sender)).toEqual({ original: 'Corrected speech', translation: '翻译' })
    expect(refine).toHaveBeenCalledWith({ text: 'Recognized speech', context: '', title: 'Test', targetLanguage: '简体中文' }, expect.any(AbortSignal))
  })
  it('does not download a model when no contextual AI is configured', async () => {
    vi.mocked(resolveProvider).mockResolvedValue({ provider: {} } as Awaited<ReturnType<typeof resolveProvider>>)
    await expect(startListening({ session, revision: 0 }, sender)).rejects.toThrow('配置 AI')
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
  it('never sends stale transcription to AI after a seek', async () => {
    let complete!: (value: { text: string }) => void
    await startListening({ session, revision: 0 }, sender)
    runtimeSend.mockImplementation((message) => message.op === 'transcribe' ? new Promise((resolve) => { complete = resolve }) : Promise.resolve({ text: '' }))
    const result = transcribeListening({ session, revision: 0, audio: 'YXVkaW8=', title: 'Test' }, sender)
    await updateListening({ session, revision: 1 }, sender)
    complete({ text: 'Obsolete speech' })
    await expect(result).rejects.toThrow('失效')
    expect(refine).not.toHaveBeenCalled()
  })
})
