import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import { isVideoInTargetLanguage } from '@/shared/videoLanguage.ts'
import { startListening, transcribeListening, updateListening } from './listening.ts'
import { resolveForTranslation as resolveProvider } from '../providerHealth.ts'
vi.mock('@/shared/videoLanguage.ts', () => ({ isVideoInTargetLanguage: vi.fn() }))
vi.mock('../providerHealth.ts', () => ({ resolveForTranslation: vi.fn() }))
vi.mock('@/storage/repositories/settingsRepo.ts', () => ({ getSettings: vi.fn(async () => ({ videoListeningEnabled: true, videoSubtitleTargetLanguage: 'zh-CN', videoSubtitleSourceLanguage: 'en' })), isHostEnabled: () => true, watchSettings: vi.fn((listener) => { settingsWatch.listener = listener; return () => undefined }) }))
const settingsWatch = vi.hoisted(() => ({ listener: undefined as undefined | ((s: unknown) => void) }))
const sender = { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'doc', url: 'https://example.com' } as chrome.runtime.MessageSender
const session = '7041f9fb-63f2-4348-bdf0-d57278333a85'
const runtimeSend = vi.fn(async (message: { op: string }) => ({ text: message.op === 'transcribe' ? 'Recognized speech' : '' }))
const refine = vi.fn(async (_input?: unknown, _signal?: AbortSignal) => ({ original: 'Corrected speech', translation: '翻译' }))
describe('listening privacy and ownership', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({ videoListeningEnabled: true, enabled: true, videoSubtitleTargetLanguage: 'zh-CN', videoSubtitleSourceLanguage: 'en' } as Awaited<ReturnType<typeof getSettings>>)
    vi.mocked(isVideoInTargetLanguage).mockResolvedValue(false)
    runtimeSend.mockImplementation(async message => ({ text: message.op === 'transcribe' ? 'Recognized speech' : '' }))
    vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage: runtimeSend }, offscreen: { hasDocument: async () => true } })
    vi.mocked(resolveProvider).mockResolvedValue({ provider: { refineTranscript: refine } } as unknown as Awaited<ReturnType<typeof resolveProvider>>)
  })
  afterEach(async () => { await updateListening({ session, revision: 0, stop: true }, sender); vi.clearAllMocks(); vi.unstubAllGlobals() })
  it('blocks disabled listening before downloading a model or resolving AI', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({ videoListeningEnabled: false } as Awaited<ReturnType<typeof getSettings>>)
    await expect(startListening({ session, revision: 0 }, sender)).rejects.toThrow('设置')
    expect(runtimeSend).not.toHaveBeenCalled()
    expect(resolveProvider).not.toHaveBeenCalled()
  })
  it('cancels a start when the setting is disabled during provider resolution', async () => {
    let complete!: (value: Awaited<ReturnType<typeof resolveProvider>>) => void
    vi.mocked(resolveProvider).mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
    const result = startListening({ session, revision: 0 }, sender)
    const rejected = expect(result).rejects.toThrow('失效')
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    settingsWatch.listener!({ videoListeningEnabled: false, enabled: true })
    complete({ provider: { refineTranscript: refine } } as unknown as Awaited<ReturnType<typeof resolveProvider>>)
    await rejected
    expect(runtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ op: 'load' }))
  })
  it('stops an active session and rejects its next queued chunk when disabled', async () => {
    await startListening({ session, revision: 0 }, sender)
    settingsWatch.listener!({ videoListeningEnabled: false, enabled: true })
    await expect(transcribeListening({ session, revision: 0, audio: 'YXVkaW8=', title: '' }, sender)).rejects.toThrow('失效')
    expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ op: 'stop' }))
    expect(refine).not.toHaveBeenCalled()
  })
  it('aborts in-flight AI translation and rejects its late result when disabled', async () => {
    let finish!: (value: { original: string; translation: string }) => void
    refine.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    await startListening({ session, revision: 0 }, sender)
    const result = transcribeListening({ session, revision: 0, audio: 'YXVkaW8=', title: '' }, sender)
    const rejected = expect(result).rejects.toThrow('失效')
    await vi.waitFor(() => expect(refine).toHaveBeenCalled())
    const signal = refine.mock.calls[0]![1] as AbortSignal
    settingsWatch.listener!({ videoListeningEnabled: false, enabled: true })
    expect(signal.aborted).toBe(true)
    finish({ original: 'late', translation: '迟到' })
    await rejected
  })
  it('does not force the caption preference into ASR and silently skips same-target speech', async () => {
    vi.mocked(isVideoInTargetLanguage).mockResolvedValue(true)
    await startListening({ session, revision: 0 }, sender)
    expect(await transcribeListening({ session, revision: 0, audio: 'YXVkaW8=', title: 'Test' }, sender)).toEqual({ original: '', translation: '' })
    expect(runtimeSend).toHaveBeenCalledWith(expect.objectContaining({ op: 'transcribe', language: undefined }))
    expect(refine).not.toHaveBeenCalled()
  })
  it('reads the current video target for each speech window', async () => {
    await startListening({ session, revision: 0 }, sender)
    vi.mocked(getSettings).mockResolvedValue({ videoListeningEnabled: true, videoSubtitleTargetLanguage: 'es' } as Awaited<ReturnType<typeof getSettings>>)
    vi.mocked(isVideoInTargetLanguage).mockResolvedValueOnce(true)
    await transcribeListening({ session, revision: 0, audio: 'YXVkaW8=', title: 'Test' }, sender)
    expect(isVideoInTargetLanguage).toHaveBeenCalledWith(['Recognized speech'], 'es')
    expect(refine).not.toHaveBeenCalled()
  })
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
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    await updateListening({ session, revision: 1 }, sender)
    complete({ text: 'Obsolete speech' })
    await expect(result).rejects.toThrow('失效')
    expect(refine).not.toHaveBeenCalled()
  })
})
