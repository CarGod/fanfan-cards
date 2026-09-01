// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { ParagraphTranslator, HOVER_CLASS } = await import('./paragraphTranslator.ts')
const { setTranslationMode } = await import('./styles.ts')

/**
 * 「再按一次收起」必须在两种显示模式下都成立。
 *
 * 这个手势的设计里写着「它自己就是自己的撤销」。可「仅译文」模式一开，原文是
 * display:none 的——而收起靠的正是悬停原文。藏起来的东西悬停不到，翻完一段就
 * 再也退不回去，除非切模式或者刷新页面。
 *
 * 这条回归是把显示模式从「只管整页」扩到「也管整段」时引出来的，
 * 而它在双语模式下完全看不出来。
 */
const TEXT =
  'It has not been used yet, but would you look at that. Codex for scale, and it keeps going.'

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

let translator: InstanceType<typeof ParagraphTranslator>

const paragraph = () => document.getElementById('p')!
const slot = () => document.querySelector('.ara-translation')

/** jsdom 没有排版，所以直接告诉手势光标底下是什么。 */
const pointAt = (element: () => Element | null) => {
  document.elementFromPoint = () => element() as Element
}

async function press(): Promise<void> {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }))
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', key: '`' }))
  await settle(50)
}

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_type: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map(() => '译文') }),
  )
  document.body.innerHTML = `<article><p id="p"><span>${TEXT}</span></p></article>`
  pointAt(() => paragraph().querySelector('span'))
  translator = new ParagraphTranslator()
  translator.setKey('backtick')
})

afterEach(() => {
  translator.destroy()
  setTranslationMode('bilingual')
  vi.useRealTimers()
})

describe('悬停译文也能收起', () => {
  it('悬停在译文上按一次，译文收起、原文回来', async () => {
    await press()
    expect(slot()).not.toBeNull()

    // 读者的鼠标现在停在译文上——尤其是仅译文模式下，那里只剩译文。
    pointAt(() => slot())
    await press()

    expect(slot()).toBeNull()
    expect(paragraph().hasAttribute('data-ara-translated')).toBe(false)
  })

  it('仅译文模式下同样退得回来', async () => {
    setTranslationMode('translationOnly')
    await press()
    expect(slot()).not.toBeNull()

    pointAt(() => slot())
    await press()

    expect(slot()).toBeNull()
  })

  /** 描一个 display:none 的元素等于没描——读者按下键之前得知道自己要动哪一段。 */
  it('悬停译文时，高亮画在译文上，而不是画在藏起来的原文上', async () => {
    await press()
    const translation = slot()!

    // 键一直按着没松，鼠标挪到译文上——这时候只更新高亮，还没有触发收起。
    pointAt(() => translation)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }))

    expect(translation.classList.contains(HOVER_CLASS)).toBe(true)
    expect(paragraph().classList.contains(HOVER_CLASS)).toBe(false)
  })

  it('悬停原文时，高亮还是画在原文上', async () => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', key: '`' }))
    expect(paragraph().classList.contains(HOVER_CLASS)).toBe(true)
  })
})
