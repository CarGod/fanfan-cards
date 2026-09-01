// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { contentIsReady } from './youtube.ts'

/**
 * 「广告一放，字幕功能就永久不工作」——这个 bug 就出在这一个判断上。
 *
 * 第一版只问了「有没有字幕轨」，而广告期间播放器给的是广告那一支的数据：没有轨，
 * 于是直接判失败，正片开始之后也不会再试。读者看到的是开关明明开着、字幕一直没有。
 */
const ad = { wantedVideoId: 'abc', playerVideoId: 'ad-xyz', adPlaying: true }

describe('contentIsReady', () => {
  it('广告在播就是没就绪，不是失败', () => {
    expect(contentIsReady(ad)).toBe(false)
  })

  /*
   * 广告标记刚摘掉、正片数据还没换上来的那一瞬间：只看广告标记会以为可以开始了，
   * 结果拿着广告的字幕地址去请求，换回一个空 body。
   */
  it('广告标记没了但播放器还停在广告那一支上，同样没就绪', () => {
    expect(contentIsReady({ ...ad, adPlaying: false })).toBe(false)
  })

  it('播放器报的 id 和地址栏对上了才算就绪', () => {
    expect(contentIsReady({ wantedVideoId: 'abc', playerVideoId: 'abc', adPlaying: false })).toBe(
      true,
    )
  })

  // 两头都可能暂时空着，那时候不该卡住——宁可让后面的取字幕去判断。
  it('地址栏或播放器暂时给不出 id 时不阻拦', () => {
    expect(contentIsReady({ wantedVideoId: '', playerVideoId: 'abc', adPlaying: false })).toBe(true)
    expect(contentIsReady({ wantedVideoId: 'abc', playerVideoId: '', adPlaying: false })).toBe(true)
  })

  it('但只要广告在播，缺 id 也不算就绪', () => {
    expect(contentIsReady({ wantedVideoId: '', playerVideoId: '', adPlaying: true })).toBe(false)
  })
})
