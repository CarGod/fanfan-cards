import { describe, expect, it } from 'vitest'
import { localASRConfig, localASRThreads, type LocalASRProfile } from './asrConfig'

describe('local ASR runtime profiles', () => {
  it('defaults normal listening to the verified Base GPU model', () => {
    expect(localASRConfig()).toEqual({ model: 'Xenova/whisper-base', revision: '64da57285918e20ea79ea5c88eed7197933abaa8', device: 'webgpu', dtype: 'q4f16' })
  })
  it('exposes only pinned internal Base candidates', () => {
    expect(localASRConfig('base').device).toBe('wasm')
    expect(localASRConfig('base-webgpu-q4f16')).toMatchObject({ model: 'Xenova/whisper-base', device: 'webgpu', dtype: 'q4f16' })
    expect(() => localASRConfig('__proto__' as LocalASRProfile)).toThrow()
    expect(() => localASRConfig('unknown' as LocalASRProfile)).toThrow()
  })
  it('falls back without isolated shared memory and caps CPU occupancy at four', () => {
    expect(localASRThreads(false, true, 16)).toBe(1)
    expect(localASRThreads(true, false, 16)).toBe(1)
    expect(localASRThreads(true, true, 16)).toBe(4)
    expect(localASRThreads(true, true, 2)).toBe(2)
    expect(localASRThreads(true, true, NaN)).toBe(1)
  })
})
