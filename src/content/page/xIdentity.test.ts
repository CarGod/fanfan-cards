// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://x.com/home"}
import { afterEach, describe, expect, it } from 'vitest'
import { collectUnits, directText, findUnitAt } from './walker.ts'
import { isRedundantTranslation } from '@/shared/language.ts'

declare const jsdom: { reconfigure(options: { url: string }): void }

const options = { range: 'all' as const, isHidden: () => false, fontFamilyOf: () => 'system-ui' }
const texts = () => collectUnits(document.body, options).map(u => u.text)
afterEach(() => { document.body.innerHTML = ''; jsdom.reconfigure({ url: 'https://x.com/home' }) })

describe('X identity rules', () => {
  it('skips authors at any nesting depth, including when scanning a subtree or hovering', () => {
    document.body.innerHTML = `<article>
      <div data-testid="User-Name"><div><a href="/OfficialLoganK"><div><span id="name">Logan Kilpatrick</span></div></a></div></div>
      <div data-testid="tweetText"><span id="reply">congrats!</span></div>
    </article>`
    expect(texts()).toEqual(['congrats!'])
    const name = document.querySelector('#name')!
    expect(collectUnits(name.parentElement!, options)).toEqual([])
    expect(findUnitAt(name, options)).toBeNull()
    expect(findUnitAt(document.querySelector('#reply'), options)?.text).toBe('congrats!')
  })
  it('keeps bios and mentions while skipping sidebar profile names', () => {
    document.body.innerHTML = `<aside><div data-testid="UserCell">
      <a href="/thsottiaux"><div><span>Tibo</span></div></a>
      <div><span>Codex &amp; ChatGPT </span><a href="/OpenAI">@OpenAI</a></div>
    </div></aside><article><div data-testid="tweetText">Thanks <a href="/OfficialLoganK">@OfficialLoganK</a>!</div></article>`
    expect(texts()).toEqual(['Codex & ChatGPT @OpenAI', 'Thanks @OfficialLoganK!'])
  })
  it('filters nested inline identity links but preserves topic and external links', () => {
    document.body.innerHTML = `<div><span><a href="/BrianRoemmele"><b>Brian Roemmele</b></a></span></div>
      <div><a href="/search?q=AI">NICE TO SEE YOU</a></div>
      <p><a href="https://example.com/Logan">Logan wrote this article.</a></p>`
    expect(texts()).toEqual(['NICE TO SEE YOU', 'Logan wrote this article.'])
  })
  it('does not guess from capitalization, short length, or a sentence-like display name', () => {
    document.body.innerHTML = `<div data-testid="UserName"><h2>I love building products</h2></div>
      <div data-testid="tweetText">Logan Kilpatrick announced a product.</div>
      <div data-testid="tweetText">lmao</div><div data-testid="tweetText">NICE TO SEE YOU</div>`
    expect(texts()).toEqual(['Logan Kilpatrick announced a product.', 'lmao', 'NICE TO SEE YOU'])
    expect(findUnitAt(document.querySelector('h2'), options)).toBeNull()
  })
  it.each(['https://twitter.com/home', 'https://mobile.x.com/home'])('also supports %s', url => {
    jsdom.reconfigure({ url })
    document.body.innerHTML = '<div data-testid="User-Name"><span>Tibo</span></div><p>Hello world</p>'
    expect(texts()).toEqual(['Hello world'])
  })
  it.each(['https://example.com', 'https://x.com.example.com'])('leaves other sites unchanged: %s', url => {
    jsdom.reconfigure({ url })
    document.body.innerHTML = '<div data-testid="User-Name"><span>Tibo</span></div><p><a href="/Logan">Logan Kilpatrick</a></p>'
    expect(texts()).toEqual(['Tibo', 'Logan Kilpatrick'])
  })
  it('skips a live host avatar row without dropping the broadcast title', () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><button>
      <div><div data-testid="UserAvatar-Container-unknown"></div><span><span id="host">Brian Roemmele</span></span></div>
      <div>LIVE! SCI-FI | SCI-FACT - MOVIE | RADIO 24/7</div>
    </button></div>`
    expect(texts()).toEqual(['LIVE! SCI-FI | SCI-FACT - MOVIE | RADIO 24/7'])
    expect(findUnitAt(document.querySelector('#host'), options)).toBeNull()
  })
  it('applies to newly inserted feed rows' , () => {
    document.body.innerHTML = '<div data-testid="tweetText">First post</div>'
    expect(texts()).toEqual(['First post'])
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="User-Name"><span>WorldofAI</span></div><div data-testid="tweetText">Second post</div>')
    expect(texts()).toEqual(['First post', 'Second post'])
  })
  it('preserves a mention nested inside a prose inline wrapper', () => {
    document.body.innerHTML = '<div data-testid="tweetText"><span>Thanks <a href="/theo">@theo</a>!</span></div>'
    expect(directText(document.body.firstElementChild!)).toBe('Thanks @theo!')
  })
})

describe('numbered duplicate responses', () => {
  it.each(['Tibo', 'Logan Kilpatrick', 'Theo - t3.gg', 'WorldofAI'])('rejects an echoed batch number for %s', name => {
    expect(isRedundantTranslation(name, `[1] ${name}`)).toBe(true)
  })
  it('keeps meaningful translations and numbered source content', () => {
    expect(isRedundantTranslation('congrats!', '[1] 恭喜！')).toBe(false)
    expect(isRedundantTranslation('[1] Tibo', '[2] Tibo')).toBe(false)
  })
})
