import { describe, expect, it } from 'vitest'
import { getASRGPUAdapter, isGPUInitializationFailure } from './gpuSupport'
describe('GPU capability and fallback classification', () => {
  it('requires an adapter with shader-f16 before any model download', async () => {
    expect(await getASRGPUAdapter(undefined)).toBeNull()
    expect(await getASRGPUAdapter({ requestAdapter: async () => null })).toBeNull()
    expect(await getASRGPUAdapter({ requestAdapter: async () => ({ features: new Set<string>() }) })).toBeNull()
    const adapter = { features: new Set(['shader-f16']) }
    expect(await getASRGPUAdapter({ requestAdapter: async () => adapter })).toBe(adapter)
  })
  it('does not turn network/model failures into a second model download', () => {
    for (const text of ['Failed to fetch', 'HTTP 403 GPU model', 'Network error', '404 not found', 'download failed']) expect(isGPUInitializationFailure(new Error(text))).toBe(false)
    expect(isGPUInitializationFailure(new Error('WebGPU shader compilation failed'))).toBe(true)
    expect(isGPUInitializationFailure(new Error('Out of memory'))).toBe(false)
  })
})
