import { describe, expect, it } from 'vitest'
import {
  isLookupCandidate,
  isRedundantTranslation,
  repairOmissions,
  shouldTranslateText,
  verbatimTokens,
  sourceLanguage,
  targetLanguage,
} from './language.ts'

const zh = { source: 'auto', target: 'zh-CN' }

describe('isLookupCandidate', () => {
  it('accepts words in the language being learned', () => {
    expect(isLookupCandidate('migration', zh)).toBe(true)
    expect(isLookupCandidate('roll back', zh)).toBe(true)
  })

  it('rejects selections with no letters at all', () => {
    expect(isLookupCandidate('  ', zh)).toBe(false)
    expect(isLookupCandidate('2026-08-17', zh)).toBe(false)
    expect(isLookupCandidate('$1,299.00', zh)).toBe(false)
  })

  // Nothing makes an extension feel more like spyware than a popup appearing
  // every time you select text written in your own language.
  it('stays out of the way of the user’s own language', () => {
    expect(isLookupCandidate('数据库迁移', zh)).toBe(false)
    expect(isLookupCandidate('数据库 migration', zh)).toBe(true)
  })

  it('still fires for a Latin-script learner whose own language is Latin too', () => {
    // An English speaker reading German selects Latin text; a "skip my own
    // script" rule would silence the extension entirely for them.
    expect(isLookupCandidate('Bahnhof', { source: 'auto', target: 'en' })).toBe(true)
  })

  it('honours a pinned source language', () => {
    expect(isLookupCandidate('migration', { source: 'ja', target: 'zh-CN' })).toBe(false)
    expect(isLookupCandidate('移行', { source: 'ja', target: 'zh-CN' })).toBe(true)
    expect(isLookupCandidate('Привет', { source: 'ru', target: 'zh-CN' })).toBe(true)
    expect(isLookupCandidate('Привет', { source: 'en', target: 'zh-CN' })).toBe(false)
  })
})

describe('language lookup', () => {
  it('falls back to safe defaults for unknown codes', () => {
    expect(sourceLanguage('klingon').code).toBe('auto')
    expect(targetLanguage('klingon').code).toBe('zh-CN')
  })
})

describe('shouldTranslateText', () => {
  const zh = 'zh-CN'

  it('translates ordinary prose', () => {
    expect(shouldTranslateText('Exciting news: it is topping the ranks.', zh)).toBe(true)
    expect(shouldTranslateText('Home', zh)).toBe(true)
  })

  // The x.com failure: a Chinese UI translated into identical Chinese, under
  // every nav item and every button.
  it('leaves text that is already in the reader’s language alone', () => {
    expect(shouldTranslateText('主页', zh)).toBe(false)
    expect(shouldTranslateText('显示翻译', zh)).toBe(false)
    expect(shouldTranslateText('正在关注', zh)).toBe(false)
  })

  it('still translates a mixed line that is mostly English', () => {
    expect(shouldTranslateText('Dreamina Seedance-2.5 is topping the 排行榜', zh)).toBe(true)
  })

  it('skips handles, domains, URLs and model names', () => {
    expect(shouldTranslateText('@BytePlusGlobal', zh)).toBe(false)
    expect(shouldTranslateText('Arena.ai', zh)).toBe(false)
    expect(shouldTranslateText('MiniMax-H3', zh)).toBe(false)
    expect(shouldTranslateText('https://arena.ai/jobs', zh)).toBe(false)
    expect(shouldTranslateText('#1', zh)).toBe(false)
  })

  it('skips fragments with nothing to translate', () => {
    expect(shouldTranslateText('   ', zh)).toBe(false)
    expect(shouldTranslateText('1,411', zh)).toBe(false)
    expect(shouldTranslateText('· — ·', zh)).toBe(false)
  })

  // A Latin-script reader learning another Latin-script language cannot be
  // served by the script test, so we translate rather than guess.
  it('does not use the script test when the reader’s language is Latin', () => {
    expect(shouldTranslateText('Guten Morgen', 'en')).toBe(true)
    expect(shouldTranslateText('Good morning', 'en')).toBe(true)
  })
})

describe('isRedundantTranslation', () => {
  it('catches a model handing the input straight back', () => {
    expect(isRedundantTranslation('主页', '主页')).toBe(true)
    expect(isRedundantTranslation('Follow', 'Follow')).toBe(true)
    expect(isRedundantTranslation('Follow', 'Follow.')).toBe(true)
    expect(isRedundantTranslation('Follow', '关注')).toBe(false)
  })

  it('treats an empty translation as nothing worth showing', () => {
    expect(isRedundantTranslation('Follow', '   ')).toBe(true)
  })
})

describe('repairOmissions', () => {
  // The x.com failure: a post listing ten @mentions came back translated as
  // "受邀用户：" with every handle silently dropped.
  it('puts back handles the model dropped', () => {
    const source = 'Invited user: @nero_eth @riaarora_ @jesus_chitty'
    expect(repairOmissions(source, '受邀用户：')).toBe(
      '受邀用户：\n@nero_eth @riaarora_ @jesus_chitty',
    )
  })

  it('leaves a translation alone when nothing went missing', () => {
    const source = 'Ask @nero_eth about it'
    expect(repairOmissions(source, '有问题问 @nero_eth')).toBe('有问题问 @nero_eth')
  })

  it('restores dropped URLs and hashtags too', () => {
    const source = 'Read https://example.com/post about #AI'
    const repaired = repairOmissions(source, '关于 AI 的文章')
    expect(repaired).toContain('https://example.com/post')
    expect(repaired).toContain('#AI')
  })

  it('does not mistake an email-like word inside prose for a handle', () => {
    expect(verbatimTokens('contact me at a@b.com')).toEqual(['a@b.com'])
  })

  it('leaves an empty translation empty rather than turning it into a token dump', () => {
    expect(repairOmissions('Invited: @a_bc', '')).toBe('')
  })
})
