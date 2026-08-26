import { afterEach, describe, expect, it } from 'vitest'
import { MESSAGES, type MessageKey } from './messages.ts'
import { currentLanguage, resolveLanguage, setLanguage, t } from './index.ts'

const KEYS = Object.keys(MESSAGES) as MessageKey[]

afterEach(() => setLanguage('zh-CN'))

describe('文案目录', () => {
  it('每条文案两种语言都不为空', () => {
    const empty = KEYS.filter(
      (key) => !MESSAGES[key]['zh-CN']?.trim() || !MESSAGES[key].en?.trim(),
    )
    expect(empty).toEqual([])
  })

  /**
   * 占位符必须两边一致。
   *
   * 只在中文里写了 `{count}`、英文里漏掉，是漏译之外最隐蔽的一种坏法：
   * 类型系统看不见它，中文界面上一切正常，英文界面上那个数字就这么没了。
   * 反过来更糟——英文里多一个 `{count}`，界面上会直接出现一串花括号。
   */
  it('同一条文案的占位符，中英两边一一对应', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()

    const mismatched = KEYS.filter((key) => {
      const zh = placeholders(MESSAGES[key]['zh-CN'])
      const en = placeholders(MESSAGES[key].en)
      return zh.join(',') !== en.join(',')
    })
    expect(mismatched).toEqual([])
  })

  /** 英文版里不该再出现汉字——那是漏译，而漏译在英文界面上就是一句中文突然冒出来。 */
  it('英文文案里没有残留的汉字', () => {
    const leftover = KEYS.filter((key) => /[一-鿿]/.test(MESSAGES[key].en))
    expect(leftover).toEqual([])
  })
})

describe('取文案', () => {
  it('跟着当前语言走', () => {
    setLanguage('zh-CN')
    expect(t('popup.stat.saved')).toBe('收藏')
    setLanguage('en')
    expect(t('popup.stat.saved')).toBe('Saved')
  })

  it('填占位符', () => {
    setLanguage('en')
    expect(t('popup.action.review_count', { count: 12 })).toBe('Review 12 cards')
    setLanguage('zh-CN')
    expect(t('popup.action.review_count', { count: 12 })).toBe('开始复习 12 张卡片')
  })

  /** 少传一个参数时，宁可界面上留一个 `{count}`，也不要整个页面炸掉。 */
  it('缺参数时原样留着占位符，不抛异常', () => {
    setLanguage('en')
    expect(t('popup.action.review_count')).toBe('Review {count} cards')
    expect(t('popup.action.review_count', {})).toBe('Review {count} cards')
  })

  it('键不存在时把键本身显示出来，便于一眼定位', () => {
    expect(t('nope.not.a.key' as MessageKey)).toBe('nope.not.a.key')
  })
})

describe('语言解析', () => {
  it('指定了就用指定的，不再看浏览器', () => {
    expect(resolveLanguage('en')).toBe('en')
    expect(resolveLanguage('zh-CN')).toBe('zh-CN')
  })

  it('auto 落到一个真实语言上', () => {
    expect(['zh-CN', 'en']).toContain(resolveLanguage('auto'))
  })

  it('切到同一个语言不算切换', () => {
    setLanguage('en')
    const before = currentLanguage()
    setLanguage('en')
    expect(currentLanguage()).toBe(before)
  })
})
