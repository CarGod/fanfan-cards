import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let listener: (m: unknown, s: unknown, respond: (r: unknown) => void) => boolean
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage?: (event: { data: object }) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.all.push(this) }
  reply(data: object) { this.onmessage?.({ data }) }
}
const sender = { id: 'extension' }
function load() { const respond = vi.fn(); listener({ target: 'fanfan-local-asr', op: 'load' }, sender, respond); return respond }
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); FakeWorker.all = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('chrome', { runtime: { id: 'extension', sendMessage: vi.fn(async () => undefined), onMessage: { addListener: (fn: typeof listener) => { listener = fn } } } })
  await import('./offscreen')
})
afterEach(() => { listener({ target: 'fanfan-local-asr', op: 'stop' }, sender, () => undefined); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('ordinary offscreen ASR entry', () => {
  it('selects Base by default and restarts in a clean Tiny worker exactly once on GPU init failure', async () => {
    const respond = load(), gpu = FakeWorker.all[0]!
    expect(gpu.postMessage.mock.calls[0]![0].profile).toBe('base-webgpu-q4f16')
    gpu.reply({ id: 1, error: 'GPU', errorCode: 'gpu-init-failed' })
    const cpu = FakeWorker.all[1]!
    gpu.reply({ fatal: true, error: 'late GPU loss' })
    expect(cpu.terminate).not.toHaveBeenCalled()
    expect(gpu.terminate).toHaveBeenCalledOnce()
    expect(cpu.postMessage.mock.calls[0]![0].profile).toBe('tiny')
    cpu.reply({ id: 2, text: '', fallback: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(respond).toHaveBeenCalledWith({ text: '', fallback: true })
    expect(FakeWorker.all).toHaveLength(2)
  })
  it('does not retry again if the Tiny fallback fails', async () => {
    const respond = load()
    FakeWorker.all[0]!.reply({ id: 1, error: 'GPU', errorCode: 'gpu-init-failed' })
    FakeWorker.all[1]!.reply({ id: 2, error: 'CPU failed', errorCode: 'gpu-init-failed' })
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWorker.all).toHaveLength(2)
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })
  it('does not create a second worker after a download failure', async () => {
    const respond = load(); FakeWorker.all[0]!.reply({ id: 1, error: 'network download failed' })
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWorker.all).toHaveLength(1)
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })
  it('terminates a pending load on stop and ignores its late result', async () => {
    const respond = load(), worker = FakeWorker.all[0]!
    listener({ target: 'fanfan-local-asr', op: 'stop' }, sender, () => undefined)
    worker.reply({ id: 1, text: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.terminate).toHaveBeenCalled()
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }))
  })
  it('stops and notifies the background when a GPU device is lost', async () => {
    load(); const worker = FakeWorker.all[0]!
    worker.reply({ fatal: true, error: 'device lost' })
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.terminate).toHaveBeenCalled()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'audio/fatal', payload: {} })
  })
})
