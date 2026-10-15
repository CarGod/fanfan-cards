import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

// Executable JS/WASM are bundled with the extension. Only model data is downloaded.
env.allowLocalModels = false
env.useBrowserCache = true
env.backends.onnx.wasm!.numThreads = 1
env.backends.onnx.wasm!.proxy = false
env.backends.onnx.wasm!.wasmPaths = new URL('../wasm/', import.meta.url).href
const createASR = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, options: { device: 'wasm'; dtype: 'q8'; revision: string }) => Promise<AutomaticSpeechRecognitionPipeline>
let model: AutomaticSpeechRecognitionPipeline | null = null
self.onmessage = async (event: MessageEvent<{ id: number; samples?: Float32Array; language?: string }>) => {
  const { id, samples, language } = event.data
  try {
    model ??= await createASR('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      device: 'wasm', dtype: 'q8', revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
    })
    if (!samples) { self.postMessage({ id, text: '' }); return }
    const output = await model(samples, { task: 'transcribe', ...(language ? { language } : {}), return_timestamps: false, max_new_tokens: 128 })
    self.postMessage({ id, text: Array.isArray(output) ? output[0]?.text ?? '' : output.text })
  } catch {
    self.postMessage({ id, error: '本地语音模型加载或识别失败，请检查网络与可用内存后重试。' })
  }
}
