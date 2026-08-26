import { describe, expect, it } from 'vitest'
import { t } from '@/i18n/index.ts'
import { optionalApiOrigin } from './hostPermission.ts'

describe('optionalApiOrigin', () => {
  it('requests only the origin of an HTTPS endpoint', () => {
    expect(optionalApiOrigin('https://gateway.example.com/v1/chat')).toBe(
      'https://gateway.example.com/*',
    )
  })

  it('allows the declared localhost development origin', () => {
    expect(optionalApiOrigin('http://localhost:11434/v1')).toBe('http://localhost/*')
  })

  /*
   * 断言比的是 `t()` 的返回值，不是写死的中文片段。
   *
   * 这两条消息现在有中英两版，测试环境解析出哪一版取决于 `navigator.language`——
   * 写死任何一种语言的片段，都会在另一种语言下变成假失败。比 `t()` 则两边都对，
   * 而且以后改文案也不用回来改测试。
   */
  it('rejects insecure remote endpoints', () => {
    expect(() => optionalApiOrigin('http://api.example.com/v1')).toThrow(
      t('error.host.https_required'),
    )
  })

  it('rejects malformed URLs', () => {
    expect(() => optionalApiOrigin('api.example.com/v1')).toThrow(t('error.host.invalid_url'))
  })
})
