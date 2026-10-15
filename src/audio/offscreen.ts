import { RollingAudio } from './rollingAudio.ts'
let worker: Worker | null = null
let sequence = 0
let epoch = 0
const rolling = new RollingAudio()
let idleTimer: ReturnType<typeof setTimeout> | undefined
let pending: { id: number; resolve: (value: { text: string }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null

function reset(): void {
  epoch++
  rolling.clear()
  clearTimeout(idleTimer)
  worker?.terminate()
  worker = null
  if (pending) { clearTimeout(pending.timer); pending.reject(new Error('本地识别已停止')); pending = null }
}
function run(samples?: Float32Array, language?: string): Promise<{ text: string }> {
  if (pending) return Promise.reject(new Error('本地识别忙碌，请稍后重试'))
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; text: string; error?: string }>) => {
      if (pending?.id !== event.data.id) return
      const task = pending
      pending = null
      clearTimeout(task.timer)
      if (event.data.error) task.reject(new Error(event.data.error))
      else task.resolve({ text: event.data.text })
    }
    worker.onerror = () => reset()
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending = { id, resolve, reject, timer: setTimeout(() => reset(), samples ? 90_000 : 240_000) }
    worker!.postMessage({ id, samples, language }, samples ? [samples.buffer] : [])
  })
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'fanfan-local-asr' || sender.id !== chrome.runtime.id || sender.tab) return false
  clearTimeout(idleTimer)
  idleTimer = setTimeout(reset, 300_000)
  if (message.op === 'heartbeat') { respond({ text: '' }); return false }
  if (message.op === 'stop') { reset(); respond({ text: '' }); return false }
  const currentEpoch = epoch
  void (async () => {
    if (message.op === 'load') return run()
    if (message.op !== 'transcribe' || typeof message.audio !== 'string' || message.audio.length > 3_000_000) throw new Error('无效音频')
    const bytes = Uint8Array.from(atob(message.audio), (c) => c.charCodeAt(0))
    const context = new AudioContext({ sampleRate: 16000 })
    try {
      const decoded = await context.decodeAudioData(bytes.buffer)
      if (currentEpoch !== epoch) throw new Error('识别已取消')
      if (decoded.duration > 15) throw new Error('音频片段过长')
      const mono = new Float32Array(decoded.length)
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const values = decoded.getChannelData(channel)
        for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + values[i]! / decoded.numberOfChannels
      }
      // Whisper can hallucinate on silent input. Do not transcribe near-silence.
      const rms = Math.sqrt(mono.reduce((sum, value) => sum + value * value, 0) / mono.length)
      // Rolling audio context repairs words cut at the previous boundary. These are
      // revised caption windows, not append-only transcript fragments.
      if (rms < 0.001) { rolling.clear(); return { text: '' } }
      const window = rolling.append(mono, String(message.continuity ?? ''))
      return await run(window, typeof message.language === 'string' && /^[a-z]{2,3}$/.test(message.language) ? message.language : undefined)
    } finally { await context.close() }
  })().then(respond, () => respond({ error: '本地语音识别失败，请检查模型下载网络、音轨或可用内存后重试。' }))
  return true
})
