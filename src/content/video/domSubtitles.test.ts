// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildSelector, presetFor } from './domSubtitles.ts'

function html(markup: string): void {
  document.body.innerHTML = markup
}

describe('buildSelector', () => {
  it('uses an id when there is one', () => {
    html('<div id="player"><p id="cap">hi</p></div>')
    expect(buildSelector(document.getElementById('cap')!)).toBe('#cap')
  })

  it('prefers stable class names and stops as soon as the path is unique', () => {
    html(
      '<div class="player"><div class="subtitle-panel active"><span class="line x1">one</span></div>' +
        '<div class="other"><span class="line">two</span></div></div>',
    )
    const target = document.querySelector('.subtitle-panel span')!
    const selector = buildSelector(target)
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(target)
    // 「active」这种状态类和带数字的类不进选择器，它们下一秒就会变。
    expect(selector).not.toMatch(/active|x1/)
  })

  it('falls back to nth-of-type when siblings look identical', () => {
    html('<ul class="subs"><li>a</li><li>b</li><li>c</li></ul>')
    const target = document.querySelectorAll('li')[1]!
    const selector = buildSelector(target)
    expect(document.querySelector(selector)).toBe(target)
  })
})

describe('presetFor', () => {
  it('knows bilibili and nothing else', () => {
    expect(presetFor('www.bilibili.com')).toMatch(/bili-subtitle/)
    expect(presetFor('example.com')).toBeNull()
  })
})
