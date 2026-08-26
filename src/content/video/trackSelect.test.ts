import { describe, expect, it } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { chooseTrack } from './trackSelect.ts'
import type { CaptionTrack } from './timedtext.ts'

const track = (languageCode: string, patch: Partial<CaptionTrack> = {}): CaptionTrack => ({
  baseUrl: `https://x.test/timedtext?lang=${languageCode}`,
  languageCode,
  name: { simpleText: languageCode },
  ...patch,
})

describe('chooseTrack', () => {
  it('同一语言里优先人工轨——自动字幕没有标点，翻出来明显更差', () => {
    const chosen = chooseTrack(
      [track('en', { kind: 'asr' }), track('en')],
      { sourceLanguage: 'en', targetLanguage: 'zh-CN' },
    )
    expect(chosen?.track.kind).toBeUndefined()
  })

  it('没有人工轨时退回自动轨，并在理由里说明', () => {
    // 理由是要显示在面板上的界面文案，跟着界面语言走。要断言中文就得先把语言钉住：
    // 测试环境里 navigator.language 是英文，不钉的话这一条会在英文文案上失败。
    setLanguage('zh-CN')
    const chosen = chooseTrack([track('en', { kind: 'asr' })], {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    })
    expect(chosen?.track.kind).toBe('asr')
    expect(chosen?.reason).toContain('自动生成')
  })

  it('绝不选目标语言的轨——把中文再翻成中文是破坏而不是功能', () => {
    expect(
      chooseTrack([track('zh-Hans'), track('zh-CN')], { targetLanguage: 'zh-CN' }),
    ).toBeNull()
  })

  it('目标语言的轨存在时也跳过它，选别的', () => {
    const chosen = chooseTrack([track('zh-Hans'), track('en')], { targetLanguage: 'zh-CN' })
    expect(chosen?.track.languageCode).toBe('en')
  })

  it('地区变体按主语言匹配', () => {
    const chosen = chooseTrack([track('de'), track('en-GB')], {
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
    })
    expect(chosen?.track.languageCode).toBe('en-GB')
  })

  it('源语言设为自动时取默认轨，仍然人工优先', () => {
    const chosen = chooseTrack(
      [track('fr', { kind: 'asr' }), track('fr')],
      { sourceLanguage: 'auto', targetLanguage: 'zh-CN' },
    )
    expect(chosen?.track.kind).toBeUndefined()
  })

  it('指定的源语言没有轨时不放弃，退回默认轨', () => {
    const chosen = chooseTrack([track('ja')], { sourceLanguage: 'en', targetLanguage: 'zh-CN' })
    expect(chosen?.track.languageCode).toBe('ja')
  })

  it('忽略没有地址的轨', () => {
    const chosen = chooseTrack(
      [{ baseUrl: '', languageCode: 'en' }, track('ja')],
      { targetLanguage: 'zh-CN' },
    )
    expect(chosen?.track.languageCode).toBe('ja')
  })

  it('没有任何轨时返回 null', () => {
    expect(chooseTrack([], { targetLanguage: 'zh-CN' })).toBeNull()
  })
})
