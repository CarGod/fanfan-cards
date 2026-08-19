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
