// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { findUnitAt } from './walker.ts'
import { TRANSLATION_CLASS } from './walker.ts'

/**
 * `findUnitAt` decides what "this paragraph" means when the cursor is somewhere
 * inside it. Hover hands you the deepest element under the pointer, which is
 * almost never the thing a reader means.
 */
function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('findUnitAt', () => {
  it('climbs from an inline child to the paragraph that owns the text', () => {
    mount('<p id="p">A migration can <em id="em">lock a table</em> for minutes in production.</p>')
    const unit = findUnitAt(document.getElementById('em'))
    expect(unit?.element.id).toBe('p')
  })

  it('returns the element itself when it already holds the text', () => {
    mount('<p id="p">A migration can lock a table for minutes in production.</p>')
    expect(findUnitAt(document.getElementById('p'))?.element.id).toBe('p')
  })

  /*
   * x.com 的推文正文。
   *
   * 它建在 React Native Web 上，正文那个 `<div data-testid="tweetText">` 计算出来是
   * `display: inline`——标签是块级的，样式是行内的。整页翻译一直认得它（`directText`
   * 按标签折叠行内子节点，不看计算样式），而悬停这条路多看了一眼计算样式，于是从唯一
   * 装着正文的那个元素上直接爬了过去，一路爬到 body 也找不到东西。
   *
   * 两条路必须用同一条规则，否则「整页能翻、单段不能」这种事会一直冒出来。
   */
  it('计算样式是 inline 的块级元素，照样是一段（x.com 的推文正文）', () => {
    mount(
      '<div data-testid="cellInnerDiv"><article data-testid="tweet"><div>' +
        '<div dir="auto" lang="en" data-testid="tweetText" id="tt">' +
        '<span id="sp">It has not been used yet, but would you look at that. Codex for scale.</span>' +
        '</div></div></article></div>',
    )

    // 真实页面上这个 div 的 display 就是 inline，jsdom 里造不出来，只能把它按住。
    const native = window.getComputedStyle
    window.getComputedStyle = ((element: Element) =>
      ({
        display: element.id === 'tt' ? 'inline' : 'block',
        fontFamily: '',
        visibility: 'visible',
      }) as unknown as CSSStyleDeclaration) as typeof window.getComputedStyle

    try {
      const unit = findUnitAt(document.getElementById('sp'), {
        isHidden: () => false,
        fontFamilyOf: () => '',
      })
      expect(unit?.element.id).toBe('tt')
    } finally {
      window.getComputedStyle = native
    }
  })

  it('refuses code, which is not prose', () => {
    mount('<pre id="c">ALTER TABLE users ADD COLUMN email_verified boolean;</pre>')
    expect(findUnitAt(document.getElementById('c'))).toBeNull()
  })

  it('refuses text already in the target language', () => {
    mount('<p id="p">中文段落不应该被翻译，因为它已经是目标语言了。</p>')
    expect(findUnitAt(document.getElementById('p'), { targetLanguage: 'zh-CN' })).toBeNull()
  })

  it('refuses our own translation output, so the gesture cannot recurse', () => {
    mount(`<div id="t" class="${TRANSLATION_CLASS}">这是我们插入的译文。</div>`)
    expect(findUnitAt(document.getElementById('t'))).toBeNull()
  })

  it('stops at the first ancestor that qualifies, not the largest', () => {
    mount(
      '<article id="a"><p id="p1">The safe pattern is to make every migration idempotent and reversible.</p>' +
        '<p id="p2">Add the new column first, then backfill it in batches.</p></article>',
    )
    expect(findUnitAt(document.getElementById('p1'))?.element.id).toBe('p1')
  })

  it('gives up rather than returning the whole document', () => {
    mount('<p id="p">ok</p>')
    // Two characters is below the floor: translating "ok" on its own is noise.
    expect(findUnitAt(document.getElementById('p'))).toBeNull()
  })
})
