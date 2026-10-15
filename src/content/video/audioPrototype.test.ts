// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioPrototype, hasTextSubtitles, mediaIdentity } from './audioPrototype.ts'

vi.mock('@/storage/repositories/settingsRepo.ts', () => ({
  getSettings: async () => ({ enabled: true, blockedHosts: [] }),
  isHostEnabled: () => true,
  watchSettings: () => () => undefined,
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
  afterEach(() => { prototype?.destroy(); prototype = undefined; document.body.innerHTML = ''; vi.useRealTimers() })

  it('hides immediately during loadstart and waits for the new video before showing again', async () => {
    vi.useFakeTimers()
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
