export type LocalASRProfile = 'tiny' | 'base' | 'base-webgpu' | 'base-webgpu-q4f16'
export type LocalASRDevice = 'wasm' | 'webgpu'

const base = { model: 'Xenova/whisper-base', revision: '64da57285918e20ea79ea5c88eed7197933abaa8' }
const PROFILES = {
  tiny: { model: 'Xenova/whisper-tiny', revision: '5332fcc35e32a33b86612b9a57a89be7906102b1', device: 'wasm', dtype: 'q8' },
  base: { ...base, device: 'wasm', dtype: 'q8' },
  'base-webgpu': { ...base, device: 'webgpu', dtype: 'q8' },
  'base-webgpu-q4f16': { ...base, device: 'webgpu', dtype: 'q4f16' },
} as const

/** Pinned runtime profiles; normal listening prefers Base GPU and can fall back to Tiny CPU. */
export function localASRConfig(profile: LocalASRProfile = 'base-webgpu-q4f16') {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error('Invalid local ASR configuration')
  return PROFILES[profile]
}

export function localASRThreads(isolated: boolean, sharedMemory: boolean, hardwareConcurrency: number): number {
  if (!isolated || !sharedMemory) return 1
  // Eight threads were slower than four on the validation device; leave cores for video.
  return Math.max(1, Math.min(4, Math.floor(hardwareConcurrency) || 1))
}
