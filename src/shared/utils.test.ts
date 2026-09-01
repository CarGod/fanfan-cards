import { describe, expect, it } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { dayDiff, formatDue, hashString, isPhrase, normalizeWord, truncate } from './utils.ts'

describe('normalizeWord', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeWord('  “Migration,” ')).toBe('migration')
    expect(normalizeWord('Database migration.')).toBe('database migration')
  })

  it('keeps inner hyphens and apostrophes', () => {
    expect(normalizeWord("state-of-the-art")).toBe('state-of-the-art')
    expect(normalizeWord("don't")).toBe("don't")
  })

  it('collapses whitespace', () => {
    expect(normalizeWord('roll   back')).toBe('roll back')
  })
})

describe('isPhrase', () => {
  it('detects multi-word selections', () => {
    expect(isPhrase('migration')).toBe(false)
    expect(isPhrase('roll back')).toBe(true)
  })
})

describe('dayDiff', () => {
  it('counts calendar days, not 24h windows', () => {
    const late = new Date(2026, 0, 1, 23, 30).getTime()
    const early = new Date(2026, 0, 2, 0, 30).getTime()
    expect(dayDiff(late, early)).toBe(1)
  })
})

describe('formatDue', () => {
  const now = new Date(2026, 0, 10, 12).getTime()

  it('labels overdue cards as reviewable', () => {
    setLanguage('zh-CN')
    expect(formatDue(now - 1000, now)).toBe('待复习')
    expect(formatDue(new Date(2026, 0, 11, 9).getTime(), now)).toBe('明天')
  })

  /*
   * 语言切换后必须跟着变。
   *
   * 这一条挡的是「模块顶层求值」那个错：把文案写成模块级常量时，第一个用例照样
   * 通过，只有换过语言之后才露馅——而那正是没人会手动去点的路径。
   */
  it('follows the interface language', () => {
    setLanguage('en')
    expect(formatDue(now - 1000, now)).toBe('Due now')
    expect(formatDue(new Date(2026, 0, 11, 9).getTime(), now)).toBe('Tomorrow')
    setLanguage('zh-CN')
  })
})

describe('hashString', () => {
  it('is stable and collision-free for near-identical inputs', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('truncate', () => {
  it('adds an ellipsis only when needed', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello world', 8)).toBe('hello w…')
  })
})
