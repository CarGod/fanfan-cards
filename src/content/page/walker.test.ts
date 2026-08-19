// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { batchUnits, collectUnits, TRANSLATION_CLASS } from './walker.ts'

/**
 * jsdom does no layout, so the walker takes its layout inputs as injectable
 * functions. Everything below tests the part that actually decides what gets
 * sent to a model — which is where a mistake corrupts someone's page.
 */
function parse(html: string): Element {
  document.body.innerHTML = html
  return document.body
}

const noLayout = {
  isHidden: () => false,
  heightOf: () => 100,
  viewportHeight: 800,
  fontFamilyOf: () => 'system-ui',
  range: 'all' as const,
  targetLanguage: 'zh-CN',
}

function textsOf(html: string, options = {}) {
  return collectUnits(parse(html), { ...noLayout, ...options }).map((unit) => unit.text)
}

describe('collectUnits', () => {
  it('treats an element that directly holds text as one unit', () => {
    expect(textsOf('<p>Hello world</p>')).toEqual(['Hello world'])
  })

  it('folds inline children into their parent instead of splitting them', () => {
    expect(textsOf('<p>A <b>bold</b> and <a href="#">linked</a> sentence.</p>')).toEqual([
      'A bold and linked sentence.',
    ])
  })

  it('splits a container that holds both its own text and block children', () => {
    expect(textsOf('<div>Intro text<p>First</p><p>Second</p></div>')).toEqual([
      'Intro text',
      'First',
      'Second',
    ])
  })

  // Translating code samples corrupts them, and icon-font ligatures are glyph
  // names rather than words.
  it('never walks into code, pre, scripts or form controls', () => {
    expect(textsOf('<pre>const x = 1</pre><code>npm run build</code>')).toEqual([])
    expect(textsOf('<p>Real text</p><script>var a = "text"</script>')).toEqual(['Real text'])
    expect(textsOf('<textarea>draft</textarea><input value="x">')).toEqual([])
  })

  it('honours translate="no" and .notranslate, including on ancestors', () => {
    expect(textsOf('<p translate="no">Leave me</p>')).toEqual([])
    expect(textsOf('<div class="notranslate"><p>Inside</p></div>')).toEqual([])
  })

  // Our own output is marked notranslate; without this the translator would
  // translate its own translations on the next pass.
  it('never picks up its own output', () => {
    expect(textsOf(`<div class="${TRANSLATION_CLASS}">译文</div>`)).toEqual([])
  })

  it('skips hidden elements', () => {
    const hidden = (element: Element) => element.tagName === 'ASIDE'
    expect(textsOf('<p>Shown</p><aside>Hidden</aside>', { isHidden: hidden })).toEqual(['Shown'])
  })

  it('ignores fragments with no letters at all', () => {
    expect(textsOf('<p>—</p><p>3.14</p><p>Real</p>')).toEqual(['Real'])
  })

  /**
   * The failure mode this guards: a flat container holding an entire article
   * becomes one unit, so viewport gating has nothing to gate and the whole page
   * is queued at once (read-frog hit this on docs.docker.com).
   */
  it('descends into a container too tall to be one unit', () => {
    const html = '<div>Huge intro<p>One</p><p>Two</p></div>'
    const tall = { ...noLayout, heightOf: (el: Element) => (el.tagName === 'DIV' ? 9000 : 50) }
    expect(textsOf(html, tall)).toEqual(['One', 'Two'])
  })

  it('still emits a tall element that has no block children to descend into', () => {
    const tall = { ...noLayout, heightOf: () => 9000 }
    expect(textsOf('<p>One very long paragraph</p>', tall)).toEqual(['One very long paragraph'])
  })
})

describe('what is worth translating', () => {
  // The x.com failure in one test: a Chinese UI got a duplicate Chinese line
  // under every nav item, and every @handle was echoed back verbatim.
  it('skips text already in the reader’s language, and skips handles', () => {
    expect(textsOf('<p>主页</p><p>Home</p>')).toEqual(['Home'])
    expect(textsOf('<p>@BytePlusGlobal</p><p>Arena.ai</p><p>Real prose here</p>')).toEqual([
      'Real prose here',
    ])
  })

  it('skips ligature icon fonts, whose text nodes are glyph names', () => {
    const iconish = { fontFamilyOf: (el: Element) => (el.tagName === 'I' ? 'Material Icons' : 'ui') }
    expect(textsOf('<p>Real text</p><div><i>keyboard_return</i></div>', iconish)).toEqual([
      'Real text',
    ])
  })

  it('skips screen-reader-only text, which has nowhere visible to go', () => {
    expect(textsOf('<span class="sr-only">Skip to content</span><p>Body</p>')).toEqual(['Body'])
  })
})

describe('translation range', () => {
  const html =
    '<nav><a href="#">Home</a> <a href="#">Explore</a></nav>' +
    '<main><p>The actual article body.</p></main>' +
    '<footer>All rights reserved worldwide</footer>'

  it('skips page chrome by default, which is interface rather than reading', () => {
    expect(textsOf(html, { range: 'content' })).toEqual(['The actual article body.'])
  })

  it('translates chrome too when asked', () => {
    expect(textsOf(html, { range: 'all' })).toEqual([
      'Home Explore',
      'The actual article body.',
      'All rights reserved worldwide',
    ])
  })

  // Sites do put the headline in a <header> inside the article; skipping that
  // would lose the one line the reader most wants (read-frog's #940).
  it('keeps chrome that lives inside the article', () => {
    const withHeader = '<article><header><h1>The headline itself</h1></header><p>Body</p></article>'
    expect(textsOf(withHeader, { range: 'content' })).toEqual(['The headline itself', 'Body'])
  })
})

describe('batchUnits', () => {
  const unit = (text: string) => ({ element: document.createElement('p'), text })

  it('bounds a batch by count', () => {
    const batches = batchUnits(Array.from({ length: 25 }, (_, i) => unit(`p${i}`)), { maxUnits: 10 })
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5])
  })

  it('bounds a batch by characters', () => {
    const batches = batchUnits([unit('a'.repeat(80)), unit('b'.repeat(80))], { maxChars: 100 })
    expect(batches).toHaveLength(2)
  })

  // Dropping or truncating it would silently lose page content.
  it('gives an oversized paragraph its own batch rather than dropping it', () => {
    const batches = batchUnits([unit('x'.repeat(5000)), unit('short')], { maxChars: 100 })
    expect(batches[0]).toHaveLength(1)
    expect(batches[0]![0]!.text).toHaveLength(5000)
  })
})

describe('line structure', () => {
  // A multi-line post collapsed into one string reads as a run-on for the
  // reader and, worse, invites the model to summarise instead of translate.
  it('keeps <br> as a line break instead of swallowing it', () => {
    const html = '<div>BIG NEWS: launches AI<br><br>MORE INFO: here<br>Invited: @nero_eth</div>'
    expect(textsOf(html)).toEqual(['BIG NEWS: launches AI\n\nMORE INFO: here\nInvited: @nero_eth'])
  })

  it('still collapses ordinary runs of whitespace inside a line', () => {
    expect(textsOf('<p>  A   sentence\n  with   spacing.  </p>')).toEqual(['A sentence with spacing.'])
  })
})
