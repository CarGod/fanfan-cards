// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioPrototype, hasTextSubtitles, mediaIdentity } from './audioPrototype.ts'

const settingsState = vi.hoisted(() => ({ enabled: true, listeners: [] as Array<(s: { videoListeningEnabled: boolean; enabled: boolean; blockedHosts: string[] }) => void> }))
vi.mock('@/storage/repositories/settingsRepo.ts', () => ({
  getSettings: async () => ({ videoListeningEnabled: settingsState.enabled, enabled: true, blockedHosts: [] }),
  isHostEnabled: () => true,
  watchSettings: (fn: typeof settingsState.listeners[number]) => { settingsState.listeners.push(fn); return () => undefined },
}))

describe('audio prototype media detection', () => {
  it('hides listening for unloaded/failed subtitle elements but ignores metadata tracks', () => {
    const video = document.createElement('video')
    video.innerHTML = '<track kind="metadata">'
    expect(hasTextSubtitles(video)).toBe(false)
    video.innerHTML = '<track kind="subtitles" src="failed.vtt">'
    expect(hasTextSubtitles(video)).toBe(true)
    video.innerHTML = '<track src="pending.vtt">'
    expect(hasTextSubtitles(video)).toBe(true)
  })
  it('distinguishes YouTube videos and Bilibili parts on a reused video element', () => {
    const video = document.createElement('video')
    expect(mediaIdentity(video, 'https://www.youtube.com/watch?v=one')).not.toBe(mediaIdentity(video, 'https://www.youtube.com/watch?v=two'))
    expect(mediaIdentity(video, 'https://www.bilibili.com/video/BV1cS4y1Y7p4?p=1')).not.toBe(mediaIdentity(video, 'https://www.bilibili.com/video/BV1cS4y1Y7p4?p=2'))
    expect(mediaIdentity(video, 'https://www.youtube.com/watch?v=one&t=3')).toBe(mediaIdentity(video, 'https://www.youtube.com/watch?v=one&t=8'))
  })
})

describe('audio prototype lifecycle', () => {
  let prototype: AudioPrototype | undefined
  afterEach(() => { prototype?.destroy(); vi.unstubAllGlobals(); prototype = undefined; settingsState.enabled = true; settingsState.listeners = []; document.body.innerHTML = ''; vi.useRealTimers() })

  it('keeps the feature off by default and removes its controls on a synced disable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } })
    settingsState.enabled = false
    const video = document.createElement('video'); document.body.append(video)
    Object.defineProperty(video, 'readyState', { value: 4 })
    video.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 450, width: 800, height: 450 }) as DOMRect
    prototype = new AudioPrototype(); await prototype.start()
    await vi.advanceTimersByTimeAsync(4000)
    expect(document.querySelector('.fanfan-audio-prototype')).toBeNull()
    settingsState.listeners[0]!({ videoListeningEnabled: true, enabled: true, blockedHosts: [] })
    await vi.advanceTimersByTimeAsync(4000)
    expect(document.querySelector('.fanfan-audio-prototype')).not.toBeNull()
    settingsState.listeners[0]!({ videoListeningEnabled: false, enabled: true, blockedHosts: [] })
    expect(document.querySelector('.fanfan-audio-prototype')).toBeNull()
  })

  it('hides immediately during loadstart and waits for the new video before showing again', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } })
    const video = document.createElement('video')
    document.body.append(video)
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
    video.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 450, width: 800, height: 450 }) as DOMRect
    prototype = new AudioPrototype()
    await prototype.start()
    await vi.advanceTimersByTimeAsync(3100)
    const host = document.querySelector<HTMLElement>('.fanfan-audio-prototype')!
    expect(host.hidden).toBe(false)
    video.dispatchEvent(new Event('loadstart'))
    expect(host.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(host.hidden).toBe(false)
    video.innerHTML = '<track kind="subtitles">'
    await vi.advanceTimersByTimeAsync(1000)
    expect(host.hidden).toBe(true)
    video.remove()
    await vi.advanceTimersByTimeAsync(1000)
    expect(document.querySelector('.fanfan-audio-prototype')).toBeNull()
  })
})
