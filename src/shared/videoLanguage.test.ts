import { afterEach, describe, expect, it, vi } from 'vitest'
import { videoLanguageWindows, isVideoInTargetLanguage, isReliableTargetLanguage, primaryLanguage } from './videoLanguage.ts'
const result = (language: string, reliable = true): chrome.i18n.LanguageDetectionResult => ({ isReliable: reliable, languages: [{ language, percentage: 100 }] })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('video language eligibility', () => {
  it('groups short Chinese cues and ignores punctuation/numbers', () => {
    expect(videoLanguageWindows(['你好', '1913', '……', '他发现'])).toEqual(['你好\n他发现'])
  })
  it('normalizes regional language tags without treating Latin scripts as English', () => {
    expect(primaryLanguage('pt_BR')).toBe('pt')
    expect(isReliableTargetLanguage(result('zh-TW'), 'zh-CN')).toBe(true)
    expect(isReliableTargetLanguage(result('es'), 'en')).toBe(false)
  })
  it.each(['en', 'es', 'ja'])('allows %s captions for a Chinese target', async lang => {
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async () => result(lang) } })
    expect(await isVideoInTargetLanguage(['foreign text'], 'zh-CN')).toBe(false)
  })
  it('skips reliable Chinese only for a Chinese target, not after a target switch', async () => {
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async () => result('zh') } })
    expect(await isVideoInTargetLanguage(['这是中文字幕'], 'zh-CN')).toBe(true)
    expect(await isVideoInTargetLanguage(['这是中文字幕'], 'en')).toBe(false)
  })
  it('does not treat product names or acronyms inside reliable Chinese as foreign sentences', async () => {
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async () => result('zh') } })
    expect(await isVideoInTargetLanguage(['今天讲 ChatGPT 和 AI 的应用', 'API 怎么使用'], 'zh-CN')).toBe(true)
    expect(await isVideoInTargetLanguage(['这段是中文。This is an English sentence.'], 'zh-CN')).toBe(false)
  })
  it('never suppresses a mixed track based on its dominant language', async () => {
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async (text: string) => result(text === '中文' ? 'zh' : 'es') } })
    expect(await isVideoInTargetLanguage(['中文', 'español'], 'zh-CN')).toBe(false)
    expect(isReliableTargetLanguage({ isReliable: true, languages: [{ language: 'zh', percentage: 99 }, { language: 'en', percentage: 1 }] }, 'zh-CN')).toBe(false)
  })
  it('allows unavailable, failed and unreliable detection', async () => {
    vi.stubGlobal('chrome', undefined)
    expect(await isVideoInTargetLanguage(['未知文字'], 'zh-CN')).toBe(false)
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async () => result('zh', false) } })
    expect(await isVideoInTargetLanguage(['未知文字'], 'zh-CN')).toBe(false)
    vi.stubGlobal('chrome', { i18n: { detectLanguage: async () => { throw new Error('unavailable') } } })
    expect(await isVideoInTargetLanguage(['未知文字'], 'zh-CN')).toBe(false)
  })
  it('does not let a stalled detector block translation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('chrome', { i18n: { detectLanguage: () => new Promise(() => undefined) } })
    const pending = isVideoInTargetLanguage(['未知文字'], 'zh-CN')
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toBe(false)
  })
})
