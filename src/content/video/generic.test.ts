import { describe, expect, it } from 'vitest'
import { cuesFromTrack, pickTextTrack } from './generic.ts'

const track = (language: string, kind = 'subtitles', mode = 'disabled') => ({
  kind,
  language,
  label: language,
  mode,
})

describe('pickTextTrack', () => {
  it('prefers the reader’s source language, treating auto as English', () => {
    const tracks = [track('zh-CN'), track('en-US'), track('ja')]
    expect(pickTextTrack(tracks, 'auto')?.language).toBe('en-US')
    expect(pickTextTrack(tracks, 'ja')?.language).toBe('ja')
  })

  it('falls back to the track the site is already showing, then the first', () => {
    const tracks = [track('de'), track('fr', 'captions', 'showing')]
    expect(pickTextTrack(tracks, 'auto')?.language).toBe('fr')
    expect(pickTextTrack([track('de'), track('fr')], 'auto')?.language).toBe('de')
  })

  it('ignores chapters and metadata tracks', () => {
    expect(pickTextTrack([track('en', 'chapters'), track('en', 'metadata')], 'auto')).toBeNull()
  })
})

describe('cuesFromTrack', () => {
  it('converts seconds to milliseconds, strips tags and drops empty cues', () => {
    const cues = cuesFromTrack([
      { startTime: 1.5, endTime: 3, text: '<v Bob>Hello   <i>there</i>\nfriend' },
      { startTime: 3, endTime: 4, text: '   ' },
    ])
    expect(cues).toEqual([{ startMs: 1500, endMs: 3000, text: 'Hello there friend' }])
  })
})
