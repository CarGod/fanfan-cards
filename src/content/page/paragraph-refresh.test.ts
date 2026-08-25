// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { ParagraphTranslator } = await import('./paragraphTranslator.ts')

/**
 * The paragraph gesture must follow its paragraph.
 *
 * Whole-page translation learned to re-translate expanded posts; this one did
 * not, because the mechanism lived inside the page translator instead of being
 * shared. A paragraph translated behind 「显示更多」 kept a half-sentence of
 * Chinese under text that had since grown four lines longer.
 */
const TRUNCATED = 'Many drugs work by binding to a specific target in the body and blocking what it does. Traditionally, that has meant weeks of expert work per target,'
const FULL = `${TRUNCATED} sifting through a large number of candidates to identify the few that work. We wanted to test if a model could design novel protein binders from scratch.`

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

let paragraph: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_t: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map((text) => `[译:${text.length}]`) }),
  )
  document.body.innerHTML = `<article><p id="p"><span>${TRUNCATED}</span></p></article>`
  paragraph = document.getElementById('p')!
  // jsdom has no layout, so the gesture is told what is under the cursor.
  document.elementFromPoint = () => paragraph.querySelector('span')
})

afterEach(() => {
  vi.useRealTimers()
})

/** Hover, then press the trigger key — the gesture as a reader performs it. */
async function gesture(translator: InstanceType<typeof ParagraphTranslator>) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '`' }))
  await settle(50)
  return translator
}

describe('整段翻译跟随内容变化', () => {
  it('展开后重新翻译那一段', async () => {
    const translator = new ParagraphTranslator()
    translator.setKey('backtick')
    await gesture(translator)

    expect(translate).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ara-translation')?.textContent).toBe(`[译:${TRUNCATED.length}]`)

    // 「显示更多」：同一个元素，文本变长。
    paragraph.querySelector('span')!.textContent = FULL
    await settle(2500)

    expect(translate).toHaveBeenCalledTimes(2)
    expect(translate.mock.calls[1]![1].texts[0]).toContain('protein binders')
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(1)
    expect(document.querySelector('.ara-translation')?.textContent).toBe(`[译:${FULL.length}]`)
    translator.destroy()
  })

  it('收起之后不再跟随——那是用户说的「不用翻这段」', async () => {
    const translator = new ParagraphTranslator()
    translator.setKey('backtick')
    await gesture(translator)
    expect(translate).toHaveBeenCalledTimes(1)

    // 再按一次收起译文。
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '`' }))
    await gesture(translator)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(0)

    paragraph.querySelector('span')!.textContent = FULL
    await settle(2500)

    expect(translate).toHaveBeenCalledTimes(1)
    translator.destroy()
  })
})
