import { sendMessage } from '@/services/messaging.ts'
import type { CaptureSnapshot } from './audioCapture.ts'

/** Ordered bounded queue: never replace a pending sentence with a newer one. */
export class LocalListening {
  private session = ''
  private revision = 0
  private captureRevision = -1
  private captureId = ''
  private seen = 0
  private busy = false
  private pending: Array<{ blob: Blob; snapshot: CaptureSnapshot }> = []
  private translating = false
  private texts: string[] = []
  private ended = false
  private paused = false
  private heartbeat = 0
  private clearCaptionTimer = 0
  timings = { recognitionMs: 0, translationMs: 0 }
  active = false
  state = ''
  error = ''
  fallback = false
  constructor(private readonly changed: () => void, private readonly caption: (original: string, translation: string) => void) {}

  async start(): Promise<boolean> {
    this.stop()
    this.active = true
    const id = this.session = crypto.randomUUID()
    this.error = ''
    this.state = '正在加载本地模型'
    this.changed()
    try {
      const result = await sendMessage('audio/start', { session: id, revision: 0 })
      if (!this.active || this.session !== id) return false
      this.fallback = result.fallback ?? false
      this.state = '等待语音'
      this.heartbeat = window.setInterval(() => { void this.update().catch(() => undefined) }, 20_000)
      this.changed()
      return true
    } catch (error) {
      if (this.session === id && this.active) this.fail(error)
      return false
    }
  }

  bind(snapshot: CaptureSnapshot): void {
    this.captureId = snapshot.sessionId
    this.captureRevision = snapshot.revision
    this.observe(snapshot, null)
  }

  observe(snapshot: CaptureSnapshot, sample: Blob | null): void {
    if (!this.active || !this.captureId || snapshot.sessionId !== this.captureId) return
    if (snapshot.status === 'error' || (snapshot.status === 'stopped' && snapshot.reason !== 'ended')) { this.stop(); return }
    this.paused = snapshot.status === 'paused'
    if (this.paused) clearTimeout(this.clearCaptionTimer)
    if (snapshot.status === 'stopped' && snapshot.reason === 'ended') { this.ended = true; clearTimeout(this.clearCaptionTimer) }
    if (snapshot.revision !== this.captureRevision) {
      this.captureRevision = snapshot.revision
      if (snapshot.reason === 'seek' || snapshot.reason === 'rate') {
        this.revision++
        this.pending = []
        this.texts = []
        this.clearCaption()
        const session = this.session
        void this.update().catch((error) => { if (this.active && this.session === session) this.fail(error) })
      }
    }
    if (snapshot.chunks > this.seen) {
      this.seen = snapshot.chunks
      if (sample) {
        if (this.pending.length >= 32) { this.fail(new Error('识别速度无法跟上播放，请降低倍速后重试。')); return }
        this.pending.push({ blob: sample, snapshot })
        void this.drain()
      }
    }
    this.finishIfDrained()
  }

  private async update(stop = false): Promise<void> {
    if (this.session) await sendMessage('audio/update', { session: this.session, revision: this.revision, stop })
  }

  private async drain(): Promise<void> {
    if (this.busy || !this.pending.length || !this.active) return
    const task = this.pending.shift()!
    this.busy = true
    const session = this.session
    const revision = this.revision
    this.state = '本地识别 · AI 翻译'
    this.changed()
    try {
      const bytes = new Uint8Array(await task.blob.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      if (!this.active || this.session !== session || this.revision !== revision) return
      const started = performance.now()
      const result = await sendMessage('audio/recognize', { session, revision, audio: btoa(binary), title: document.title.slice(0, 300) })
      if (!this.active || this.session !== session || this.revision !== revision) return
      this.timings.recognitionMs = Math.round(performance.now() - started)
      if (result.text.trim()) {
        if (this.texts.length >= 32) throw new Error('翻译速度无法跟上播放，请降低倍速后重试。')
        this.texts.push(result.text.slice(0, 4000))
        void this.translate()
      }
    } catch (error) {
      if (this.active && this.session === session && this.revision === revision) this.fail(error)
    } finally {
      // A previous session may finish after a new session has started.
      if (this.session === session) { this.busy = false; this.finishIfDrained(); this.changed(); void this.drain() }
    }
  }

  // Translation is ordered for context, but never blocks the next local ASR job.
  private async translate(): Promise<void> {
    if (this.translating || !this.texts.length || !this.active) return
    this.translating = true
    const session = this.session, revision = this.revision
    const text = this.texts.shift()!
    try {
      const started = performance.now()
      const result = await sendMessage('audio/refine', { session, revision, text, title: document.title.slice(0, 300) })
      if (!this.active || this.session !== session || this.revision !== revision) return
      this.timings.translationMs = Math.round(performance.now() - started)
      this.clearCaption()
      if (result.original) {
        this.caption(result.original, result.translation)
        if (!this.paused && !this.ended) this.clearCaptionTimer = window.setTimeout(() => this.clearCaption(), 12_000)
      }
      this.state = this.ended ? '正在完成最后一句' : 'AI 听译'
    } catch (error) {
      if (this.active && this.session === session && this.revision === revision) this.fail(error)
    } finally {
      if (this.session === session) { this.translating = false; this.finishIfDrained(); this.changed(); void this.translate() }
    }
  }

  private finishIfDrained(): void {
    if (!this.active || !this.ended || this.busy || this.pending.length || this.translating || this.texts.length) return
    void this.update(true).catch(() => undefined)
    clearInterval(this.heartbeat)
    clearTimeout(this.clearCaptionTimer)
    this.active = false
    this.fallback = false
    this.session = ''
    this.state = '听译完成'
    this.changed()
  }

  private clearCaption(): void { clearTimeout(this.clearCaptionTimer); this.caption('', '') }
  fail(error: unknown): void {
    this.stop()
    this.error = error instanceof Error ? error.message : '听译失败，请重试'
    this.state = '听译失败 · 重试'
    this.changed()
  }
  stop(): void {
    void this.update(true).catch(() => undefined)
    this.active = false
    this.fallback = false
    this.session = ''
    this.revision = 0
    this.captureRevision = -1
    this.captureId = ''
    this.seen = 0
    this.ended = false
    this.paused = false
    this.busy = false
    this.pending = []
    this.texts = []
    this.translating = false
    this.state = ''
    clearInterval(this.heartbeat)
    this.clearCaption()
  }
}
