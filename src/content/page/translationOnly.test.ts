// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { HIDDEN_IN_TRANSLATION_ONLY, setTranslationMode } from './styles.ts'
import { TRANSLATED_MARK } from './walker.ts'

/**
 * 「仅译文」是藏原文，不是删原文。
 *
 * 藏错了不会报错，只会让页面上少一块东西——最难被发现的那类问题。所以这条规则的
 * 每一个限定条件都有一条用例钉着，每一条都对应一种真实的「藏错了」。
 */

const hidden = (id: string) => document.getElementById(id)!.matches(HIDDEN_IN_TRANSLATION_ONLY)

beforeEach(() => {
  document.body.innerHTML = ''
  setTranslationMode('bilingual')
})

describe('仅译文模式：哪些原文该藏起来', () => {
  it('翻好的那一段，藏', () => {
    document.body.innerHTML = `
      <p id="a" ${TRANSLATED_MARK}="done">Original</p>
      <div class="ara-translation">译文</div>`
    expect(hidden('a')).toBe(true)
  })

  /**
   * 整页翻译和悬停整段翻译共用同一条规则。
   *
   * 译文槽长得一模一样，也不再记来路——读者选的是「我想怎么读译文」，
   * 这件事不会因为译文是整页来的还是单段来的就变一次。
   */
  it('悬停翻译单段插入的，一样藏', () => {
    document.body.innerHTML = `
      <p id="a" ${TRANSLATED_MARK}="done">Original</p>
      <span class="ara-translation" data-ara-inline>译文</span>`
    expect(hidden('a')).toBe(true)
  })

  /** 藏掉外层，里层那几段译文会跟着一起消失——页面上就是凭空少一块。 */
  it('自己有译文、肚子里还装着别的译文的元素，不藏', () => {
    document.body.innerHTML = `
      <li id="outer" ${TRANSLATED_MARK}="done">Lead text
        <ul><li id="inner" ${TRANSLATED_MARK}="done">Nested</li>
        <div class="ara-translation">内层译文</div></ul>
      </li>
      <div class="ara-translation">外层译文</div>`
    expect(hidden('outer')).toBe(false)
    expect(hidden('inner')).toBe(true)
  })

  /** 译文还没回来就把原文藏了，读者看到的是一片空白。 */
  it('还在翻译中的，不藏', () => {
    document.body.innerHTML = `
      <p id="a" ${TRANSLATED_MARK}="pending">Original</p>
      <div class="ara-translation ara-translation-pending"></div>`
    expect(hidden('a')).toBe(false)
  })

  /** 译文被判定为「原样复读」而撤掉之后，原文是那里仅有的内容。 */
  it('没有译文槽的，不藏', () => {
    document.body.innerHTML = `<p id="a" ${TRANSLATED_MARK}="done">Original</p>`
    expect(hidden('a')).toBe(false)
  })

  it('完全没被翻译过的段落，不藏', () => {
    document.body.innerHTML = `<p id="a">Just a paragraph</p>`
    expect(hidden('a')).toBe(false)
  })
})

describe('切换是瞬时的，且不留痕', () => {
  it('切到仅译文会在 html 上留标记，切回来就摘掉', () => {
    setTranslationMode('translationOnly')
    expect(document.documentElement.getAttribute('data-fanfan-translation-mode')).toBe(
      'translation-only',
    )

    setTranslationMode('bilingual')
    expect(document.documentElement.hasAttribute('data-fanfan-translation-mode')).toBe(false)
  })

  /**
   * 关掉整页翻译**不该**顺手改掉显示模式。
   *
   * 这个标记曾经在 `PageTranslator.stop()` 里被清掉，当时的理由是「不留痕」。
   * 但整页和整段共用这一个模式：整页停了之后，读者悬停翻译出来的段落还在页面上，
   * 凭什么因为整页停了就把它们的原文放回来。
   */
  it('关掉整页翻译不会顺手把模式改回双语', async () => {
    const { PageTranslator } = await import('./pageTranslator.ts')
    setTranslationMode('translationOnly')

    new PageTranslator().stop()
    expect(document.documentElement.getAttribute('data-fanfan-translation-mode')).toBe(
      'translation-only',
    )
  })
})
