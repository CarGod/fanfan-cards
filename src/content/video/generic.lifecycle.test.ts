// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenericVideoSubtitles, TrackCueSource, HOST_CLASS, CHIP_CLASS } from './generic.ts'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import { getSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'

const mocks = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn(), translate: vi.fn(), sameTarget: vi.fn() }))
vi.mock('@/shared/videoLanguage.ts', () => ({ isVideoInTargetLanguage: mocks.sameTarget }))
vi.mock('@/storage/repositories/settingsRepo.ts', () => ({
  getSettings: vi.fn(), isHostEnabled: () => true, saveSettings: vi.fn().mockResolvedValue({}), watchSettings: vi.fn(() => () => undefined),
}))
vi.mock('@/shared/extensionContext.ts', () => ({ noteOrphanError: () => false, onOrphaned: () => () => undefined }))
vi.mock('@/services/messaging.ts', () => ({ sendMessage: (...args: unknown[]) => mocks.translate(...args) }))
vi.mock('./bilibili.ts', async (original) => ({
  ...await original<typeof import('./bilibili.ts')>(),
  isBilibiliPlayer: () => true,
  BilibiliCueSource: class { load = mocks.load; release = mocks.release; key = () => 'same-media' },
}))
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const cues = [{ startMs: 0, endMs: 5000, text: 'This is an English sentence about the world.' }]
function video(parent: HTMLElement = document.body): HTMLVideoElement {
  const el = document.createElement('video')
  Object.defineProperty(el, 'clientWidth', { value: 640 })
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360, x: 0, y: 0, toJSON: () => ({}) })
  parent.append(el)
  return el
}
function pointer() { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 })) }
const host = () => document.querySelector<HTMLElement>(`.${HOST_CLASS}`)!
const chip = () => document.querySelector<HTMLButtonElement>(`.${CHIP_CLASS}`)!
let generic: GenericVideoSubtitles
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.sameTarget.mockResolvedValue(false)
  document.body.innerHTML = ''
  document.querySelectorAll(`.${HOST_CLASS}`).forEach(el => el.remove())
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(0), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.mocked(getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, videoSubtitleAuto: true })
  mocks.load.mockImplementation(() => new Promise(() => undefined))
  mocks.translate.mockResolvedValue({ translations: ['译文'] })
  generic = new GenericVideoSubtitles()
})
afterEach(() => { generic.destroy(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('generic subtitle controls during viewing', () => {
  it('silently skips same-target captions, stays hidden on hover and restarts after a target change', async () => {
    mocks.load.mockResolvedValue(cues)
    mocks.sameTarget.mockResolvedValue(true)
    video(); await generic.start(); await flush()
    expect(chip().dataset.status).toBe('off')
    pointer(); await vi.advanceTimersByTimeAsync(20)
    expect(host().dataset.show).toBe('false')
    expect(mocks.translate).not.toHaveBeenCalled()
    mocks.sameTarget.mockResolvedValue(false)
    const next = { ...DEFAULT_SETTINGS, videoSubtitleAuto: true, videoSubtitleTargetLanguage: 'es' }
    vi.mocked(getSettings).mockResolvedValue(next)
    vi.mocked(watchSettings).mock.calls[0]![0](next)
    await flush()
    expect(chip().dataset.status).toBe('on')
    expect(mocks.translate).toHaveBeenCalledWith('page/translate', expect.objectContaining({ targetLanguage: 'es' }))
  })

  it('only shows loading after interaction and hides again while preparation continues', async () => {
    video(); await generic.start(); await flush()
    expect(chip().dataset.status).toBe('loading')
    expect(host().dataset.show).toBe('false')
    pointer(); await vi.advanceTimersByTimeAsync(20)
    expect(host().dataset.show).toBe('true')
    await vi.advanceTimersByTimeAsync(2600)
    expect(host().dataset.show).toBe('false')
    expect(chip().dataset.status).toBe('loading')
    pointer(); await vi.advanceTimersByTimeAsync(20)
    expect(host().dataset.show).toBe('true')
  })

  it('ends a stalled subtitle load, aborts it and ignores a late completion', async () => {
    let resolve!: (value: typeof cues) => void
    mocks.load.mockImplementation(() => new Promise(r => { resolve = r }))
    video(); await generic.start(); await flush()
    const signal = mocks.load.mock.calls[0]![2] as AbortSignal
    await vi.advanceTimersByTimeAsync(20_001)
    expect(signal.aborted).toBe(true)
    expect(chip().dataset.status).toBe('error')
    expect(mocks.release).toHaveBeenCalled()
    expect(host().dataset.show).toBe('false')
    resolve(cues); await flush()
    expect(chip().dataset.status).toBe('error')
    expect(mocks.translate).not.toHaveBeenCalled()
  })

  it('catches settings failures instead of remaining in loading', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(getSettings).mockResolvedValueOnce({ ...DEFAULT_SETTINGS, videoSubtitleAuto: true }).mockRejectedValueOnce(new Error('storage failed'))
    video(); await generic.start(); await flush()
    expect(chip().dataset.status).toBe('error')
    expect(mocks.load).not.toHaveBeenCalled()
    vi.mocked(console.warn).mockRestore()
  })

  it('keeps an unstarted video off and permits explicit start and cancellation', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, videoSubtitleAuto: false })
    video(); await generic.start()
    expect(chip().dataset.status).toBe('off')
    expect(mocks.load).not.toHaveBeenCalled()
    chip().click(); await flush()
    expect(chip().dataset.status).toBe('loading')
    const signal = mocks.load.mock.calls[0]![2] as AbortSignal
    chip().click()
    expect(chip().dataset.status).toBe('off')
    expect(signal.aborted).toBe(true)
  })

  it('does not apply the preparation deadline to active AI translation', async () => {
    mocks.load.mockResolvedValue(cues)
    mocks.translate.mockImplementation(() => new Promise(() => undefined))
    video(); await generic.start(); await flush()
    expect(chip().dataset.status).toBe('on')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(chip().dataset.status).toBe('on')
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('shows only the fullscreen video and restores the other host on exit', async () => {
    const player = document.createElement('div'); document.body.append(player)
    video(player); video()
    await generic.start(); await flush(); await vi.advanceTimersByTimeAsync(20)
    const hosts = [...document.querySelectorAll<HTMLElement>(`.${HOST_CLASS}`)]
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(hosts[0]!.style.display).toBe('')
    expect(hosts[1]!.style.display).toBe('none')
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(hosts[1]!.style.display).toBe('')
  })

  it('does not duplicate controls on repeated start and removes timers/hosts on destroy', async () => {
    video(); await Promise.all([generic.start(), generic.start()]); await flush()
    expect(document.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1)
    pointer(); await vi.advanceTimersByTimeAsync(20)
    generic.destroy()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(document.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(0)
    expect(mocks.load.mock.calls[0]![2].aborted).toBe(true)
    await generic.start(); await flush()
    expect(document.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1)
  })

  it('ignores an earlier startup completion after destroy and restart', async () => {
    let resolve!: (settings: typeof DEFAULT_SETTINGS) => void
    vi.mocked(getSettings).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    video(); const oldStart = generic.start(); generic.destroy()
    await generic.start(); await flush()
    resolve(DEFAULT_SETTINGS); await oldStart
    expect(watchSettings).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(1)
  })

  it('does not mount after destruction while startup settings are pending', async () => {
    let resolve!: (settings: typeof DEFAULT_SETTINGS) => void
    vi.mocked(getSettings).mockImplementationOnce(() => new Promise(r => { resolve = r }))
    video(); const started = generic.start(); generic.destroy()
    resolve(DEFAULT_SETTINGS); await started
    expect(document.querySelectorAll(`.${HOST_CLASS}`)).toHaveLength(0)
  })
})

describe('native subtitle preservation', () => {
  it('keeps currently displayed subtitles during preparation and restores them on cancel', async () => {
    const el = video()
    const track = { kind: 'subtitles', language: 'en', label: 'English', mode: 'showing', cues: [] }
    Object.defineProperty(el, 'textTracks', { value: [track] })
    const source = new TrackCueSource(); const controller = new AbortController()
    const loading = source.load(el, DEFAULT_SETTINGS, controller.signal)
    const rejected = expect(loading).rejects.toThrow()
    expect(track.mode).toBe('showing')
    controller.abort(); source.release()
    await vi.advanceTimersByTimeAsync(201); await rejected
    expect(track.mode).toBe('showing')
  })
})
