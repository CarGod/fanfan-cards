/** Capture player audio locally; soft boundaries flush, navigation/seek discard. */
export type CaptureStatus = 'idle' | 'waiting' | 'recording' | 'paused' | 'seeking' | 'buffering' | 'stopped' | 'error'
export type CaptureReason = 'start' | 'pause' | 'seek' | 'rate' | 'buffering' | 'resume' | 'chunk' | 'changed' | 'ended' | 'user' | 'unavailable' | 'silent'

export interface AudioChunk {
  sessionId: string
  revision: number
  startMs: number
  endMs: number
  wallDurationMs: number
  playbackRate: number
  bytes: number
  rms: number
}

export interface CaptureSnapshot {
  sessionId: string
  status: CaptureStatus
  reason: CaptureReason
  revision: number
  chunks: number
  rms: number
  mediaTimeMs: number
  playbackRate: number
  recent: AudioChunk[]
  events: Array<{ reason: CaptureReason; revision: number; mediaTimeMs: number; playbackRate: number }>
}

interface CapturableVideo extends HTMLVideoElement { captureStream?: () => MediaStream }

/** Each recording is independently finalized; MediaRecorder timeslices are not standalone files. */
export class PlayerAudioCapture {
  private stream: MediaStream | null = null
  private audio: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private timer = 0
  private cutTimer = 0
  private finishRecording: ((reason: 'chunk' | 'pause' | 'buffering' | 'ended') => void) | null = null
  private finalizing = new Set<MediaRecorder>()
  private ending = false
  private recordStarted = 0
  private quietSince = 0
  private listeners: Array<() => void> = []
  private active = false
  private key = ''
  private lastTime = 0
  private lastWall = 0
  private silentSince = 0
  private waitingSince = 0
  private buffering = false
  private latest: Blob | null = null
  private data: CaptureSnapshot = this.empty()

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly identity: () => string,
    private readonly publish: (snapshot: CaptureSnapshot) => void,
    private readonly permitted: () => boolean = () => true,
    private readonly chunkDurationMs = 3000,
  ) {}

  private empty(): CaptureSnapshot {
    return { sessionId: '', status: 'idle', reason: 'start', revision: 0, chunks: 0, rms: 0, mediaTimeMs: 0, playbackRate: 1, recent: [], events: [] }
  }

  get snapshot(): CaptureSnapshot { return structuredClone(this.data) }
  get sample(): Blob | null { return this.latest }
  get running(): boolean { return this.active }

  start(): void {
    this.stop('user')
    this.data = this.empty()
    this.data.sessionId = crypto.randomUUID()
    this.key = this.identity()
    this.latest = null
    const capture = (this.video as CapturableVideo).captureStream
    if (!capture || typeof MediaRecorder === 'undefined' || !this.permitted()) {
      this.update('error', 'unavailable')
      return
    }
    try {
      this.active = true
      this.stream = capture.call(this.video)
      // Captured video tracks are never needed. Stopping these does not stop the source element.
      this.stream.getVideoTracks().forEach((track) => track.stop())
      this.context = new AudioContext()
      const context = this.context
      void context.resume().catch(() => { if (this.active && this.context === context) this.fail() })
      this.listen(this.video, 'pause', () => this.boundary('pause'))
      this.listen(this.video, 'seeking', () => this.boundary('seek'))
      this.listen(this.video, 'seeked', () => this.boundary('resume'))
      this.listen(this.video, 'ratechange', () => this.boundary('rate'))
      this.listen(this.video, 'waiting', () => { this.buffering = true; this.boundary('buffering') })
      this.listen(this.video, 'playing', () => { this.buffering = false; this.boundary('resume') })
      this.listen(this.video, 'ended', () => this.finishEnd())
      for (const event of ['emptied', 'loadstart']) this.listen(this.video, event, () => this.stop('changed'))
      this.listen(window, 'pagehide', () => this.stop('changed'))
      this.listen(this.stream, 'addtrack', () => {
        try { this.attachAudio() } catch { this.fail() }
      })
      this.waitingSince = performance.now()
      this.lastTime = this.video.currentTime
      this.lastWall = performance.now()
      this.update('waiting', 'start')
      this.attachAudio()
      this.timer = window.setInterval(() => this.tick(), 100)
      this.tick()
    } catch {
      this.fail()
    }
  }

  private listen(target: EventTarget, event: string, listener: () => void): void {
    target.addEventListener(event, listener)
    this.listeners.push(() => target.removeEventListener(event, listener))
  }

  private attachAudio(): void {
    if (!this.active || !this.stream || !this.context || this.audio) return
    const track = this.stream.getAudioTracks().find((item) => item.readyState === 'live')
    if (!track) return
    this.audio = new MediaStream([track])
    this.source = this.context.createMediaStreamSource(this.audio)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser) // Never connect to destination: no doubled playback.
    this.listen(track, 'ended', () => { if (this.video.ended || this.ending || (Number.isFinite(this.video.duration) && this.video.currentTime >= this.video.duration - 0.1)) this.finishEnd(); else this.fail() })
    this.listen(track, 'mute', () => this.boundary('buffering'))
    this.listen(track, 'unmute', () => this.boundary('resume'))
  }

  private valid(): boolean {
    return this.active && this.video.isConnected && this.key === this.identity() && this.permitted()
  }

  private tick(): void {
    if (!this.active) return
    if (!this.valid()) { this.stop('changed'); return }
    const now = performance.now()
    const time = this.video.currentTime
    const expected = (now - this.lastWall) / 1000 * this.video.playbackRate
    // Guard discontinuities even if a site does not dispatch a normal seek event.
    if (this.recorder && Math.abs(time - this.lastTime - expected) > 0.75) this.boundary('seek')
    this.lastTime = time
    this.lastWall = now
    if (this.video.ended || this.ending) { this.finishEnd(); return }
    let status: CaptureStatus = 'recording'
    if (this.video.seeking) status = 'seeking'
    else if (this.video.paused) status = 'paused'
    else if (!this.audio) status = 'waiting'
    else if (this.buffering || this.video.readyState < 3 || this.audio.getAudioTracks().some((track) => track.muted)) status = 'buffering'
    if (status !== 'recording') {
      if (this.recorder) {
        if (status === 'paused' || status === 'buffering') this.finishRecording?.(status === 'paused' ? 'pause' : 'buffering')
        else this.invalidate()
      }
      this.data.rms = 0
      this.silentSince = 0
      if (status === 'waiting' && now - this.waitingSince > 8000) { this.fail(); return }
      this.data.status = status
      this.emit()
      return
    }
    if (this.analyser) {
      const samples = new Float32Array(this.analyser.fftSize)
      this.analyser.getFloatTimeDomainData(samples)
      this.data.rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    }
    if (this.data.rms < 0.0001) {
      if (!this.silentSince) this.silentSince = now
    } else this.silentSince = 0
    this.data.status = 'recording'
    // Silence is a warning, not a claim of a broken or inaccessible source.
    if (this.silentSince && now - this.silentSince > 5000) this.data.reason = 'silent'
    else if (this.data.reason === 'silent') this.data.reason = 'resume'
    if (!this.recorder) this.record()
    // Prefer a short natural speech pause over cutting through a word at a fixed timer.
    if (this.data.rms < 0.008) {
      if (!this.quietSince) this.quietSince = now
      if (now - this.recordStarted >= 1400 && now - this.quietSince >= 150) this.finishRecording?.('chunk')
    } else this.quietSince = 0
    this.emit()
  }

  private boundary(reason: CaptureReason): void {
    if (!this.active) return
    if (reason === 'pause' || reason === 'buffering') {
      this.finishRecording?.(reason)
    } else if (reason === 'seek' || reason === 'rate') {
      this.invalidate()
      this.latest = null
    }
    this.lastTime = this.video.currentTime
    this.lastWall = performance.now()
    this.update(this.video.paused ? 'paused' : this.video.seeking ? 'seeking' : 'waiting', reason)
  }

  private finishEnd(): void {
    if (!this.active) return
    this.ending = true
    this.finishRecording?.('ended')
    if (this.finalizing.size === 0) this.stop('ended')
  }

  private invalidate(): void {
    this.data.revision += 1
    this.finishRecording = null
    if (this.cutTimer) clearTimeout(this.cutTimer)
    this.cutTimer = 0
    const recorder = this.recorder
    this.recorder = null
    this.finalizing.clear()
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  private record(): void {
    if (!this.audio) return
    const revision = this.data.revision
    const sessionId = this.data.sessionId
    const startMs = this.video.currentTime * 1000
    const started = performance.now()
    this.recordStarted = started
    this.quietSince = 0
    const playbackRate = this.video.playbackRate
    let endMs = startMs
    let wallDurationMs = 0
    let complete = false
    const parts: Blob[] = []
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime))
      const recorder = new MediaRecorder(this.audio, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined)
      this.recorder = recorder
      recorder.ondataavailable = (event) => { if (event.data.size) parts.push(event.data) }
      recorder.onerror = () => { if (this.recorder === recorder) this.fail() }
      recorder.onstop = () => {
        this.finalizing.delete(recorder)
        if (this.recorder === recorder) this.recorder = null
        if (!complete || !this.valid() || revision !== this.data.revision || sessionId !== this.data.sessionId) {
          if (this.ending && this.valid() && !this.finalizing.size) this.stop('ended')
          return
        }
        const blob = new Blob(parts, { type: recorder.mimeType })
        if (!blob.size || blob.size > 2 * 1024 * 1024 || endMs <= startMs) {
          if (this.ending && !this.finalizing.size) this.stop('ended')
          return
        }
        this.latest = blob // Keep only the most recent complete sample.
        this.data.chunks += 1
        this.data.recent.push({ sessionId, revision, startMs, endMs, wallDurationMs, playbackRate, bytes: blob.size, rms: this.data.rms })
        this.data.recent = this.data.recent.slice(-20)
        this.update(this.video.paused || this.ending ? 'paused' : 'recording', 'chunk')
        if (this.ending && !this.finalizing.size) this.stop('ended')
      }
      recorder.start()
      this.finishRecording = (reason) => {
        if (this.recorder !== recorder || !this.valid()) return
        clearTimeout(this.cutTimer)
        this.cutTimer = 0
        this.finishRecording = null
        endMs = this.video.currentTime * 1000
        wallDurationMs = performance.now() - started
        complete = !this.video.seeking && playbackRate === this.video.playbackRate
        complete &&= Math.abs((endMs - startMs) - wallDurationMs * playbackRate) < 500
        this.recorder = null
        this.finalizing.add(recorder)
        recorder.stop()
        if (reason === 'chunk' && this.valid() && !this.video.paused && !this.video.ended && !this.ending) this.record()
      }
      this.cutTimer = window.setTimeout(() => this.finishRecording?.('chunk'), this.chunkDurationMs / Math.max(1, playbackRate))
    } catch { this.fail() }
  }

  private update(status: CaptureStatus, reason: CaptureReason): void {
    this.data.status = status
    this.data.reason = reason
    this.data.events.push({ reason, revision: this.data.revision, mediaTimeMs: this.video.currentTime * 1000, playbackRate: this.video.playbackRate })
    this.data.events = this.data.events.slice(-40)
    this.emit()
  }

  private emit(): void {
    this.data.mediaTimeMs = this.video.currentTime * 1000
    this.data.playbackRate = this.video.playbackRate
    this.publish(this.snapshot)
  }

  private fail(): void {
    this.stop('unavailable')
    this.update('error', 'unavailable')
  }

  stop(reason: CaptureReason = 'user'): void {
    this.active = false
    this.ending = false
    this.invalidate()
    for (const dispose of this.listeners.splice(0)) dispose()
    if (this.timer) clearInterval(this.timer)
    this.timer = 0
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context) void this.context.close().catch(() => undefined)
    this.stream = null
    this.audio = null
    this.source = null
    this.analyser = null
    this.context = null
    this.latest = null
    this.buffering = false
    this.silentSince = 0
    this.data.rms = 0
    this.update('stopped', reason)
  }
}
