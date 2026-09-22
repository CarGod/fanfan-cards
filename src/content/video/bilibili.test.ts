import { describe, expect, it } from 'vitest'
import { cuesFromBilibili, parseBilibiliUrl, pickBilibiliSubtitle } from './bilibili.ts'

describe('parseBilibiliUrl', () => {
  it('reads the BV id and the part number from a video page', () => {
    expect(parseBilibiliUrl('https://www.bilibili.com/video/BV1cS4y1Y7p4/?spm_id_from=333.788&p=3')).toEqual({
      bvid: 'BV1cS4y1Y7p4',
      page: 3,
    })
    expect(parseBilibiliUrl('https://www.bilibili.com/video/BV1cS4y1Y7p4')?.page).toBe(1)
  })

  it('accepts the bvid query used by list players', () => {
    expect(parseBilibiliUrl('https://www.bilibili.com/list/ml123?bvid=BV1jiumziEhS&p=2')).toEqual({
      bvid: 'BV1jiumziEhS',
      page: 2,
    })
  })

  it('ignores other hosts, bangumi pages and garbage', () => {
    expect(parseBilibiliUrl('https://www.youtube.com/watch?v=BV1cS4y1Y7p4')).toBeNull()
    expect(parseBilibiliUrl('https://www.bilibili.com/bangumi/play/ep123')).toBeNull()
    expect(parseBilibiliUrl('https://www.bilibili.com/video/BV12?p=abc')).toBeNull()
    expect(parseBilibiliUrl('not a url')).toBeNull()
  })
})

describe('pickBilibiliSubtitle', () => {
  const human = (lan: string) => ({ lan, lan_doc: lan })
  it('prefers a human track in the reader’s source language over the AI one', () => {
    const list = [human('ai-zh'), human('ai-en'), human('en-US')]
    expect(pickBilibiliSubtitle(list, 'auto')?.lan).toBe('en-US')
    expect(pickBilibiliSubtitle([human('ai-zh'), human('ai-en')], 'en')?.lan).toBe('ai-en')
  })

  it('falls back to the first track because AI tracks are labelled Chinese whatever they contain', () => {
    expect(pickBilibiliSubtitle([human('ai-zh')], 'auto')?.lan).toBe('ai-zh')
    expect(pickBilibiliSubtitle([], 'auto')).toBeNull()
  })
})

describe('cuesFromBilibili', () => {
  it('converts seconds to milliseconds, drops blanks and sorts', () => {
    expect(
      cuesFromBilibili([
        { from: 3.92, to: 5.2, content: ' 起诉书上的说法 ' },
        { from: 1.38, to: 3.92, content: '   ' },
        { from: 0.04, to: 1.38, content: 'Hello  there' },
      ]),
    ).toEqual([
      { startMs: 40, endMs: 1380, text: 'Hello there' },
      { startMs: 3920, endMs: 5200, text: '起诉书上的说法' },
    ])
  })

  it('never lets a cue end before it starts', () => {
    expect(cuesFromBilibili([{ from: 2, to: 1, content: 'x' }])[0]).toEqual({ startMs: 2000, endMs: 2000, text: 'x' })
  })
})
