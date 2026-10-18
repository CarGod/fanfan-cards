import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), wasm: { numThreads: 1, proxy: false, wasmPaths: '' }, webgpu: { adapter: null, device: Promise.resolve({ lost: new Promise(() => undefined) }) } }))
vi.mock('@huggingface/transformers', () => ({ env: { backends: { onnx: { wasm: mocks.wasm, webgpu: mocks.webgpu } } }, pipeline: mocks.pipeline }))
vi.mock('./whisperLanguage', () => ({ automaticLanguageOptions: vi.fn(() => ({})) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

describe('ASR worker initialization', () => {
  it('defaults to Base q4f16 on a capable GPU', async () => {
    mocks.pipeline.mockResolvedValue({})
    const scope = { crossOriginIsolated: true, postMessage: vi.fn(), onmessage: undefined as unknown as (e: { data: object }) => Promise<void> }
    vi.stubGlobal('self', scope)
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } })
    await import('./worker')
    await scope.onmessage({ data: { id: 1 } })
    expect(mocks.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-base', expect.objectContaining({ device: 'webgpu', dtype: 'q4f16' }))
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ fallback: false, runtime: expect.objectContaining({ profile: 'base-webgpu-q4f16' }) }))
  })
  it('uses Tiny before downloading Base if no GPU is available', async () => {
    mocks.pipeline.mockResolvedValue({})
    const scope = { crossOriginIsolated: true, postMessage: vi.fn(), onmessage: undefined as unknown as (e: { data: object }) => Promise<void> }
    vi.stubGlobal('self', scope); vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    await import('./worker'); await scope.onmessage({ data: { id: 1 } })
    expect(mocks.pipeline).toHaveBeenCalledTimes(1)
    expect(mocks.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'Xenova/whisper-tiny', expect.objectContaining({ device: 'wasm' }))
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ fallback: true }))
  })
  it('reports GPU initialization failure for a clean-worker retry, but never retries a download error', async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error('WebGPU shader initialization failed')).mockRejectedValueOnce(new Error('Failed to fetch'))
    const scope = { crossOriginIsolated: true, postMessage: vi.fn(), onmessage: undefined as unknown as (e: { data: object }) => Promise<void> }
    vi.stubGlobal('self', scope); vi.stubGlobal('navigator', { hardwareConcurrency: 8, gpu: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } })
    await import('./worker'); await scope.onmessage({ data: { id: 1 } })
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, errorCode: 'gpu-init-failed' }))
    await scope.onmessage({ data: { id: 2 } })
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, errorCode: undefined }))
    expect(mocks.pipeline).toHaveBeenCalledTimes(2)
  })
  it('shares an in-flight initialization and rejects a different candidate profile', async () => {
    let resolve!: (value: unknown) => void
    mocks.pipeline.mockReturnValue(new Promise(r => { resolve = r }))
    const postMessage = vi.fn()
    const scope = { crossOriginIsolated: true, postMessage, onmessage: undefined as unknown as (e: { data: object }) => Promise<void> }
    vi.stubGlobal('self', scope)
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    await import('./worker')
    const a = scope.onmessage({ data: { id: 1, profile: 'base' } })
    const b = scope.onmessage({ data: { id: 2, profile: 'base' } })
    await scope.onmessage({ data: { id: 3, profile: 'base-webgpu-q4f16' } })
    expect(mocks.pipeline).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, error: expect.any(String) }))
    resolve({})
    await Promise.all([a, b])
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, runtime: expect.objectContaining({ profile: 'base', device: 'wasm' }) }))
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, runtime: expect.objectContaining({ profile: 'base' }) }))
  })
  it('permits a fresh initialization after a failed model load', async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({})
    const scope = { crossOriginIsolated: false, postMessage: vi.fn(), onmessage: undefined as unknown as (e: { data: object }) => Promise<void> }
    vi.stubGlobal('self', scope)
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    await import('./worker')
    await scope.onmessage({ data: { id: 1 } })
    await scope.onmessage({ data: { id: 2 } })
    expect(mocks.pipeline).toHaveBeenCalledTimes(2)
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, runtime: expect.objectContaining({ profile: 'tiny', threads: 1 }) }))
  })
})
