// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { directText } from './walker.ts'

/**
 * "Expanded posts get re-translated" rests entirely on comparing the text we
 * translated against the text that is there now. Two ways to get it wrong, and
 * both are visible to the user: miss a real change and the translation stays a
 * truncated fragment under a paragraph that kept going; treat a reflow as a
 * change and every idle feed burns requests forever.
 */
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('change detection for re-translation', () => {
  it('sees a truncated post growing when it is expanded', () => {
    const post = mount('<div id="p">Been working on a storyboard non-stop for the last 3 days.</div>')
    const before = directText(post)

    // What 「显示更多」 does: same element, longer text, no nodes added.
    post.textContent =
      'Been working on a storyboard non-stop for the last 3 days. But getting those 60 seconds right can take days of thinking.'

    expect(normalise(directText(post))).not.toBe(normalise(before))
  })

  it('ignores a reflow that only changes whitespace', () => {
    const post = mount('<div id="p">A lot of people   underestimate\n  how much work goes in.</div>')
    const before = directText(post)
    post.innerHTML = 'A lot of people underestimate how much work goes in.'

    expect(normalise(directText(post))).toBe(normalise(before))
  })

  it('sees text replaced with different text of the same length', () => {
    const post = mount('<div id="p">The final video might be sixty.</div>')
    const before = directText(post)
    post.textContent = 'The final video might be thirty.'

    expect(normalise(directText(post))).not.toBe(normalise(before))
  })

  it('folds inline children in, so styling a word is not a change', () => {
    const post = mount('<div id="p">getting motion design right</div>')
    const before = directText(post)
    post.innerHTML = 'getting <em>motion design</em> right'

    expect(normalise(directText(post))).toBe(normalise(before))
  })
})
