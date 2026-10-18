import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

import { getASRGPUAdapter, isGPUInitializationFailure, type ASRGPUAdapter } from './gpuSupport'
import { automaticLanguageOptions } from './whisperLanguage'
import { localASRConfig, localASRThreads, type LocalASRDevice, type LocalASRProfile } from './asrConfig'

// Executable JS/WASM are bundled with the extension. Only model data is downloaded.
env.allowLocalModels = false
env.useBrowserCache = true
env.backends.onnx.wasm!.numThreads = localASRThreads(self.crossOriginIsolated, typeof SharedArrayBuffer !== 'undefined', navigator.hardwareConcurrency)
env.backends.onnx.wasm!.proxy = false
env.backends.onnx.wasm!.wasmPaths = new URL('../wasm/', import.meta.url).href
const createASR = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, options: { device: LocalASRDevice; dtype: 'q8' | 'q4f16'; revision: string }) => Promise<AutomaticSpeechRecognitionPipeline>
let model: AutomaticSpeechRecognitionPipeline | null = null
let initialization: Promise<AutomaticSpeechRecognitionPipeline> | null = null
let activeProfile: LocalASRProfile = 'base-webgpu-q4f16'
let selectedProfile: LocalASRProfile = activeProfile
let deviceLost = false
async function initialize(profile: LocalASRProfile): Promise<AutomaticSpeechRecognitionPipeline> {
  selectedProfile = profile
  if (localASRConfig(profile).device === 'webgpu') {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<ASRGPUAdapter | null> } }).gpu
    const adapter = await getASRGPUAdapter(gpu)
    if (!adapter) selectedProfile = 'tiny'
    else (env.backends.onnx.webgpu as unknown as { adapter: ASRGPUAdapter }).adapter = adapter
  }
  const load = () => { const { model: name, ...options } = localASRConfig(selectedProfile); return createASR('automatic-speech-recognition', name, options) }
  let loaded: AutomaticSpeechRecognitionPipeline
  try { loaded = await load() } catch (error) {
    if (localASRConfig(selectedProfile).device === 'webgpu' && isGPUInitializationFailure(error)) throw Object.assign(new Error('GPU initialization failed'), { code: 'gpu-init-failed' })
    else throw error
  }
  if (localASRConfig(selectedProfile).device === 'webgpu') {
    const device = await (env.backends.onnx.webgpu as unknown as { device: Promise<{ lost: Promise<unknown> }> }).device
    void device.lost.then(() => { deviceLost = true; self.postMessage({ fatal: true, error: 'GPU 连接已中断，听译已停止。请重新开启听译。' }) })
  }
  return loaded
}
self.onmessage = async (event: MessageEvent<{ id: number; samples?: Float32Array; language?: string; profile?: LocalASRProfile }>) => {
  const { id, samples, language, profile } = event.data
  try {
    if (initialization && profile && profile !== activeProfile) throw new Error('Restart the worker to change its ASR profile')
    if (!initialization) {
      activeProfile = profile ?? 'base-webgpu-q4f16'
      initialization = initialize(activeProfile).catch((error: unknown) => {
        initialization = null
        throw error
      })
    }
    model = await initialization
    if (deviceLost) throw new Error('GPU device lost')
    if (!samples) {
      self.postMessage({ id, text: '', fallback: selectedProfile !== activeProfile, runtime: { ...localASRConfig(selectedProfile), profile: selectedProfile, requestedProfile: activeProfile,
        threads: env.backends.onnx.wasm!.numThreads, isolated: self.crossOriginIsolated,
        sharedMemory: typeof SharedArrayBuffer !== 'undefined' } })
      return
    }
    const output = await model(samples, { task: 'transcribe', ...(language ? { language } : automaticLanguageOptions(model.model.generation_config as unknown as Parameters<typeof automaticLanguageOptions>[0])), return_timestamps: false, max_new_tokens: language ? 128 : 131 })
    self.postMessage({ id, text: Array.isArray(output) ? output[0]?.text ?? '' : output.text })
  } catch (error) {
    self.postMessage({ id, errorCode: (error as { code?: string })?.code, error: '本地语音模型加载或识别失败，请检查网络与可用内存后重试。' })
  }
}
