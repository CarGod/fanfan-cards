// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalListening } from './localListening.ts'
import { sendMessage } from '@/services/messaging.ts'
import type { CaptureSnapshot } from './audioCapture.ts'
vi.mock('@/services/messaging.ts', () => ({ sendMessage: vi.fn() }))
function snapshot(patch: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return { sessionId: 'capture', status: 'recording', reason: 'chunk', revision: 0, chunks: 0, rms: .1, mediaTimeMs: 6000, playbackRate: 1, recent: [], events: [], ...patch }
}
const sample = { arrayBuffer: async () => new Uint8Array([1,2]).buffer } as Blob
const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve() }
describe('local listening lifecycle', () => {
  let listening: LocalListening | undefined
  afterEach(() => { listening?.stop(); vi.clearAllMocks(); vi.useRealTimers() })
  it('does not cancel model setup on capture.start initial empty stopped event', async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ready: true })
    listening = new LocalListening(() => undefined, () => undefined)
    await listening.start()
    listening.observe(snapshot({ sessionId: '', status: 'stopped' }), null)
    expect(listening.active).toBe(true)
    listening.bind(snapshot())
    expect(listening.active).toBe(true)
  })
  it('discards late captions across seeks, only translates one text at a time', async () => {
    let finish!: (value: { original: string; translation: string }) => void
    vi.mocked(sendMessage).mockImplementation(async (type) => {
      if (type === 'audio/refine') return new Promise((resolve) => { finish = resolve })
      return type === 'audio/recognize' ? { text: 'speech' } : { ready: true }
    })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start()
    listening.bind(snapshot())
    listening.observe(snapshot({ chunks: 1 }), sample)
    await flush()
    listening.observe(snapshot({ chunks: 2 }), sample)
    expect(vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'audio/refine')).toHaveLength(1)
    listening.observe(snapshot({ revision: 1, chunks: 2, reason: 'seek' }), null)
    finish({ original: 'Old speech', translation: '旧字幕' })
    await flush()
    expect(caption).not.toHaveBeenCalledWith('Old speech', '旧字幕')
    expect(vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'audio/refine')).toHaveLength(1)
  })
  it('shows both lines and clears them on stop', async () => {
    vi.mocked(sendMessage).mockImplementation(async (type) => type === 'audio/refine' ? { original: 'Earth', translation: '地球' } : type === 'audio/recognize' ? { text: 'speech' } : { ready: true })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start()
    listening.bind(snapshot())
    listening.observe(snapshot({ chunks: 1 }), sample)
    await flush()
    expect(caption).toHaveBeenCalledWith('Earth', '地球')
    listening.stop()
    expect(caption).toHaveBeenLastCalledWith('', '')
    expect(listening.active).toBe(false)
  })
  it('drains every queued sentence after ended and retains the last caption', async () => {
    vi.useFakeTimers()
    const completions: Array<(value: { original: string; translation: string }) => void> = []
    vi.mocked(sendMessage).mockImplementation(async (type) => type === 'audio/refine'
      ? new Promise((resolve) => completions.push(resolve)) : type === 'audio/recognize' ? { text: 'speech' } : { ready: true })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start(); listening.bind(snapshot())
    for (let chunks = 1; chunks <= 3; chunks++) { listening.observe(snapshot({ chunks }), sample); await flush() }
    listening.observe(snapshot({ chunks: 3, status: 'stopped', reason: 'ended', revision: 1 }), null)
    expect(listening.active).toBe(true)
    for (let i = 0; i < 3; i++) { completions[i]!({ original: `sentence ${i}`, translation: `句子 ${i}` }); await flush() }
    expect(caption).toHaveBeenCalledWith('sentence 0', '句子 0')
    expect(caption).toHaveBeenCalledWith('sentence 1', '句子 1')
    expect(caption).toHaveBeenLastCalledWith('sentence 2', '句子 2')
    expect(listening.active).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(caption).toHaveBeenLastCalledWith('sentence 2', '句子 2')
  })

  it('keeps a result arriving after pause, until playback or an explicit stop', async () => {
    vi.useFakeTimers()
    let complete!: (value: { original: string; translation: string }) => void
    vi.mocked(sendMessage).mockImplementation(async (type) => type === 'audio/refine'
      ? new Promise((resolve) => { complete = resolve }) : type === 'audio/recognize' ? { text: 'speech' } : { ready: true })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start(); listening.bind(snapshot())
    listening.observe(snapshot({ chunks: 1, status: 'paused' }), sample)
    await flush()
    complete({ original: 'Last word.', translation: '最后一个词。' })
    await flush(); await vi.advanceTimersByTimeAsync(15_000)
    expect(caption).toHaveBeenLastCalledWith('Last word.', '最后一个词。')
    expect(listening.active).toBe(true)
  })

  it('recognizes ahead of a slow translation and waits for both stages at end', async () => {
    const completions: Array<(value: { original: string; translation: string }) => void> = []
    let recognized = 0
    vi.mocked(sendMessage).mockImplementation(async (type) => {
      if (type === 'audio/recognize') return { text: `speech ${++recognized}` }
      if (type === 'audio/refine') return new Promise(resolve => completions.push(resolve))
      return { ready: true }
    })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start(); listening.bind(snapshot())
    for (let chunks = 1; chunks <= 3; chunks++) { listening.observe(snapshot({ chunks }), sample); await flush() }
    expect(recognized).toBe(3)
    expect(completions).toHaveLength(1)
    listening.observe(snapshot({ chunks: 3, status: 'stopped', reason: 'ended', revision: 1 }), null)
    expect(listening.active).toBe(true)
    for (let i = 0; i < 3; i++) {
      completions[i]!({ original: `speech ${i + 1}`, translation: `译文 ${i + 1}` }); await flush()
    }
    expect(caption).toHaveBeenLastCalledWith('speech 3', '译文 3')
    expect(listening.active).toBe(false)
  })

  it('waits for an in-flight final recognition before finishing, rejects stale seek results', async () => {
    let recognize!: (value: { text: string }) => void
    vi.mocked(sendMessage).mockImplementation(async type => {
      if (type === 'audio/recognize') return new Promise(resolve => { recognize = resolve })
      if (type === 'audio/refine') return { original: 'Final words', translation: '最后一句' }
      return { ready: true }
    })
    const caption = vi.fn()
    listening = new LocalListening(() => undefined, caption)
    await listening.start(); listening.bind(snapshot())
    listening.observe(snapshot({ chunks: 1 }), sample); await flush()
    listening.observe(snapshot({ chunks: 1, revision: 1, reason: 'seek' }), null)
    recognize({ text: 'stale' }); await flush()
    expect(vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'audio/refine')).toHaveLength(0)
    listening.observe(snapshot({ chunks: 2, revision: 1 }), sample); await flush()
    listening.observe(snapshot({ chunks: 2, revision: 2, status: 'stopped', reason: 'ended' }), null)
    expect(listening.active).toBe(true)
    recognize({ text: 'Final words' }); await flush()
    expect(caption).toHaveBeenLastCalledWith('Final words', '最后一句')
    expect(listening.active).toBe(false)
  })

})
