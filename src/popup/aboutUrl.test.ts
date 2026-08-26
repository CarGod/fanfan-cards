import { describe, expect, it } from 'vitest'
import { aboutUrl } from './Popup.tsx'

/**
 * 项目主页跟着**界面语言**走，不跟着浏览器走。
 *
 * 读者把界面切成英文，是在说「英文我读得动」——那这个链接就该带他去英文页，
 * 而不是去一个他刚刚主动切走的语言。这条只有点下去才看得出来，
 * 而没有人会为了验证一个链接反复切语言。
 */
describe('关于此项目的链接', () => {
  it('中文界面去中文页', () => {
    expect(aboutUrl('zh-CN')).toBe('https://luffyliu.com/fanfan-cards/')
  })

  it('英文界面去英文页', () => {
    expect(aboutUrl('en')).toBe('https://luffyliu.com/en/fanfan-cards/')
  })

  it('两个地址都是 https，且都以斜杠收尾', () => {
    for (const url of [aboutUrl('zh-CN'), aboutUrl('en')]) {
      expect(url.startsWith('https://')).toBe(true)
      expect(url.endsWith('/')).toBe(true)
    }
  })
})
