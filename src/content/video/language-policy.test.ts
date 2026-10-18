// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YouTubeSubtitles } from './youtube.ts'
import { DomSubtitleWatcher } from './domSubtitles.ts'
import { isVideoInTargetLanguage } from '@/shared/videoLanguage.ts'
import { sendMessage } from '@/services/messaging.ts'
vi.mock('@/shared/videoLanguage.ts', () => ({ isVideoInTargetLanguage: vi.fn() }))
vi.mock('@/services/messaging.ts', () => ({ sendMessage: vi.fn() }))
const cues = [{ startMs: 0, endMs: 2000, text: '实际字幕' }]
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="captions">实际字幕</div>'
  vi.mocked(sendMessage).mockResolvedValue({ translations: ['translated'] })
  vi.mocked(isVideoInTargetLanguage).mockResolvedValue(false)
})
afterEach(() => vi.restoreAllMocks())
describe('video translation policy across subtitle paths', () => {
  it.each(['en', 'es', 'ja'])('YouTube permits %s when the preferred track is absent', async languageCode => {
    const yt = new YouTubeSubtitles()
    yt['enabled'] = true; yt['sourceLanguage'] = 'en'; yt['targetLanguage'] = 'zh-CN'
    yt['waitForContent'] = async () => ({ videoId: 'test', pot: '', tracks: [{ baseUrl: 'https://example.com/captions', languageCode }] })
    yt['fetchCues'] = async () => cues
    yt['startRendering'] = vi.fn()
    const translate = vi.fn(async () => undefined); yt['translateAll'] = translate
    await yt['load']()
    expect(yt['status']).toBe('on')
    expect(translate).toHaveBeenCalled()
    yt.destroy()
  })
  it('YouTube same-target is quiet and can restart when the target changes', async () => {
    const yt = new YouTubeSubtitles()
    yt['enabled'] = true; yt['sourceLanguage'] = 'en'; yt['targetLanguage'] = 'zh-CN'
    yt['waitForContent'] = async () => ({ videoId: 'test', pot: '', tracks: [{ baseUrl: 'https://example.com/captions', languageCode: 'zh' }] })
    yt['fetchCues'] = async () => cues
    yt['startRendering'] = vi.fn()
    yt['teardownRun'] = vi.fn()
    const translate = vi.fn(async () => undefined); yt['translateAll'] = translate
    vi.mocked(isVideoInTargetLanguage).mockResolvedValueOnce(true)
    await yt['load']()
    expect(yt['status']).toBe('off'); expect(yt['error']).toBe(''); expect(yt['enabled']).toBe(true)
    expect(translate).not.toHaveBeenCalled()
    yt['targetLanguage'] = 'en'
    await yt['load']()
    expect(yt['status']).toBe('on')
    expect(translate).toHaveBeenCalledWith(expect.any(Number), 'en')
    yt.destroy()
  })
  it('DOM subtitles skip same-target without a message or request', async () => {
    const watcher = new DomSubtitleWatcher()
    watcher['lastText'] = '实际字幕'
    vi.mocked(isVideoInTargetLanguage).mockResolvedValueOnce(true)
    await watcher['translate']('实际字幕')
    expect(sendMessage).not.toHaveBeenCalled()
    expect(watcher['cache'].get('实际字幕')).toBe('')
    watcher.destroy()
  })
  it('DOM subtitles do not submit a stale line after language detection', async () => {
    const watcher = new DomSubtitleWatcher()
    let resolve!: (same: boolean) => void
    vi.mocked(isVideoInTargetLanguage).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    watcher['lastText'] = 'old'
    const pending = watcher['translate']('old')
    watcher['lastText'] = 'new'; watcher['languageRun'] += 1
    resolve(false); await pending
    expect(sendMessage).not.toHaveBeenCalled()
    watcher.destroy()
  })
})
