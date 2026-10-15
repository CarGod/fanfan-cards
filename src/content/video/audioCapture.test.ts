// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerAudioCapture } from './audioCapture.ts'

class Track extends EventTarget {
  readyState = 'live'
  muted = false
  constructor(readonly kind: string) { super() }
  stop(): void { this.readyState = 'ended' }
}
class Stream extends EventTarget {
  constructor(readonly tracks: Track[] = []) { super() }
  getTracks(): Track[] { return this.tracks }
  getAudioTracks(): Track[] { return this.tracks.filter((track) => track.kind === 'audio') }
  getVideoTracks(): Track[] { return this.tracks.filter((track) => track.kind === 'video') }
}
class Recorder {
  static instances: Recorder[] = []
  static isTypeSupported(): boolean { return true }
  state = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() { Recorder.instances.push(this) }
  start(): void { this.state = 'recording' }
  stop(): void {
    this.state = 'inactive'
    // Browser delivery is asynchronous; this also exercises late callbacks after invalidation.
    queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['real sample fixture']) }); this.onstop?.() })
  }
}
let audioLevel = 0.1
class Context {
  static instances: Context[] = []
  close = vi.fn(async () => undefined)
  constructor() { Context.instances.push(this) }
  resume = async (): Promise<void> => undefined
  createMediaStreamSource = (): { connect: () => void; disconnect: () => void } => ({ connect() {}, disconnect() {} })
  createAnalyser = (): { fftSize: number; getFloatTimeDomainData: (data: Float32Array) => void } => ({ fftSize: 2048, getFloatTimeDomainData: (data) => data.fill(audioLevel) })
}

let video: HTMLVideoElement
let session: PlayerAudioCapture
let stream: Stream
let key: string
let allowed: boolean

function state(values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) Object.defineProperty(video, name, { configurable: true, value, writable: true })
}
function event(name: string): void { video.dispatchEvent(new Event(name)) }
async function advance(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    if (!video.paused && !video.seeking) state({ currentTime: video.currentTime + 0.1 * video.playbackRate })
    await vi.advanceTimersByTimeAsync(100)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', Context)
  audioLevel = 0.1
  Recorder.instances = []
  Context.instances = []
  document.body.innerHTML = '<video></video>'
  video = document.querySelector('video')!
  state({ paused: false, seeking: false, ended: false, readyState: 4, currentTime: 10, playbackRate: 1 })
  stream = new Stream([new Track('audio'), new Track('video')])
  Object.assign(video, { captureStream: () => stream })
  key = 'first'
  allowed = true
  session = new PlayerAudioCapture(video, () => key, () => undefined, () => allowed)
})
afterEach(() => { session.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('player audio sessions', () => {
  it('records audio only, with a complete sample and media/wall time mapping', async () => {
    session.start()
    await advance(3100)
    expect(stream.getVideoTracks()[0]!.readyState).toBe('ended')
    expect(session.snapshot.chunks).toBe(1)
    expect(session.snapshot.recent[0]).toMatchObject({ startMs: 10000, playbackRate: 1, wallDurationMs: 3000 })
    expect(session.snapshot.recent[0]!.endMs).toBeCloseTo(13000)
    expect(session.sample?.type).toBe('audio/webm;codecs=opus')
    expect(session.snapshot.rms).toBeCloseTo(0.1)
  })

  it('flushes before pause and resumes without including the pause gap', async () => {
    session.start()
    await advance(1000)
    state({ paused: true }); event('pause')
    await advance(5000)
    expect(session.snapshot.status).toBe('paused')
    expect(session.snapshot.chunks).toBe(1)
    expect(session.snapshot.recent[0]!.endMs).toBeCloseTo(11000)
    state({ paused: false }); event('playing')
    await advance(3200)
    expect(session.snapshot.chunks).toBe(2)
    expect(session.snapshot.recent[1]!.startMs).toBeCloseTo(11100)
  })

  it('discards the unfinished old position on seek and starts at the destination', async () => {
    session.start()
    await advance(1000)
    state({ seeking: true, currentTime: 70 }); event('seeking')
    await advance(500)
    expect(session.snapshot.status).toBe('seeking')
    state({ seeking: false }); event('seeked')
    await advance(3200)
    expect(session.snapshot.chunks).toBe(1)
    expect(session.snapshot.recent[0]!.startMs).toBeCloseTo(70100)
    expect(session.snapshot.events.some((item) => item.reason === 'seek')).toBe(true)
  })

  it('splits on playback-rate changes and shortens 2× chunks to preserve the media duration', async () => {
    session.start()
    await advance(1000)
    state({ playbackRate: 2 }); event('ratechange')
    await advance(1700)
    const chunk = session.snapshot.recent[0]!
    expect(session.snapshot.chunks).toBe(1)
    expect(chunk.playbackRate).toBe(2)
    expect(chunk.endMs - chunk.startMs).toBeCloseTo(3000)
    expect(chunk.wallDurationMs).toBe(1500)
  })

  it('stops on a changed video ID, releases tracks and ignores late data', async () => {
    session.start()
    await advance(1000)
    key = 'second'
    await advance(200)
    expect(session.running).toBe(false)
    expect(session.snapshot.reason).toBe('changed')
    expect(session.snapshot.chunks).toBe(0)
    expect(session.sample).toBeNull()
    expect(stream.getTracks().every((track) => track.readyState === 'ended')).toBe(true)
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce()
  })

  it.each(['emptied', 'loadstart'])('immediately stops on %s without waiting for the timer', (name) => {
    session.start(); event(name)
    expect(session.running).toBe(false)
    expect(session.snapshot.reason).toBe('changed')
  })

  it('stops when an ad appears or the player is removed', async () => {
    session.start(); allowed = false
    await advance(100)
    expect(session.running).toBe(false)
    allowed = true
    session.start(); video.remove()
    await advance(100)
    expect(session.running).toBe(false)
  })

  it('flushes audio before buffering then resumes', async () => {
    session.start(); await advance(900)
    state({ readyState: 2 }); event('waiting')
    await advance(3500)
    expect(session.snapshot.status).toBe('buffering')
    expect(session.snapshot.chunks).toBe(1)
    state({ readyState: 4 }); event('playing')
    await advance(3200)
    expect(session.snapshot.chunks).toBe(2)
  })

  it('delivers a sub-second last fragment before ended, including pause-before-ended order', async () => {
    const delivered: Array<{ reason: string; chunks: number; hasAudio: boolean }> = []
    session = new PlayerAudioCapture(video, () => key, (value) => delivered.push({ reason: value.reason, chunks: value.chunks, hasAudio: !!session.sample }))
    session.start()
    await advance(600)
    state({ paused: true, ended: true }); event('pause'); event('ended')
    await vi.advanceTimersByTimeAsync(0)
    expect(session.snapshot.chunks).toBe(1)
    expect(session.snapshot.recent[0]!.endMs).toBeCloseTo(10600)
    expect(delivered.find((entry) => entry.reason === 'chunk')).toMatchObject({ chunks: 1, hasAudio: true })
    expect(delivered.at(-1)?.reason).toBe('ended')
    expect(session.running).toBe(false)
  })

  it('does not emit a finalizing sample after a seek or navigation', async () => {
    session.start(); await advance(600)
    state({ paused: true }); event('pause')
    state({ seeking: true, currentTime: 70 }); event('seeking')
    await vi.advanceTimersByTimeAsync(0)
    expect(session.snapshot.chunks).toBe(0)
  })

  it('cuts at a speech pause before the maximum window', async () => {
    session.start(); await advance(1400)
    audioLevel = 0
    await advance(400)
    expect(session.snapshot.chunks).toBe(1)
    expect(session.snapshot.recent[0]!.wallDurationMs).toBe(1700)
    expect(Recorder.instances[1]!.state).toBe('recording')
  })

  it('reports missing/forbidden capture and missing audio without claiming success', async () => {
    Object.assign(video, { captureStream: () => { throw new DOMException('cross origin', 'SecurityError') } })
    session.start()
    expect(session.snapshot.status).toBe('error')
    Object.assign(video, { captureStream: () => new Stream() })
    session.start(); await advance(8300)
    expect(session.snapshot.status).toBe('error')
    expect(session.running).toBe(false)
    expect(session.snapshot.chunks).toBe(0)
  })

  it('cannot accept callbacks from a previous session after restarting', async () => {
    session.start(); const oldId = session.snapshot.sessionId
    await advance(1000)
    const old = Recorder.instances[0]!
    session.stop()
    stream = new Stream([new Track('audio')]); session.start()
    old.ondataavailable?.({ data: new Blob(['stale']) }); old.onstop?.()
    expect(session.snapshot.sessionId).not.toBe(oldId)
    expect(session.snapshot.chunks).toBe(0)
    await advance(3100)
    expect(session.snapshot.recent.every((chunk) => chunk.sessionId === session.snapshot.sessionId)).toBe(true)
  })

  it('ignores a previous AudioContext resume rejection after a new session starts', async () => {
    const rejects: Array<(error: Error) => void> = []
    class PendingContext extends Context {
      override resume = (): Promise<void> => new Promise((_resolve, reject) => { rejects.push(reject) })
    }
    vi.stubGlobal('AudioContext', PendingContext)
    session.start()
    session.stop()
    stream = new Stream([new Track('audio')])
    session.start()
    rejects[0]!(new Error('old context closed'))
    await Promise.resolve()
    expect(session.running).toBe(true)
    rejects[1]!(new Error('current context unavailable'))
    await Promise.resolve()
    expect(session.running).toBe(false)
    expect(session.snapshot.status).toBe('error')
  })
})
