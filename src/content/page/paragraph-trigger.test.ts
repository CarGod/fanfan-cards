// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const translate = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: { texts: string[] }) => translate(type, payload),
}))

const { ParagraphTranslator } = await import('./paragraphTranslator.ts')

/**
 * 触发键按**物理位置**认，不按打出来的字符认。
 *
 * 这条上线时是错的，而且错得没有任何线索：中文输入法开着的时候，反引号那个键打出来的
 * 是 `·`，`event.key` 就不是反引号了。于是所有中文用户按下去都毫无反应——功能在他们
 * 那里等于不存在，控制台里也不会有任何东西。
 */
const TEXT =
  'It has not been used yet, but would you look at that. Codex for scale, and it keeps going.'

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

let translator: InstanceType<typeof ParagraphTranslator>

beforeEach(() => {
  vi.useFakeTimers()
  translate.mockReset()
  translate.mockImplementation((_type: string, payload: { texts: string[] }) =>
    Promise.resolve({ translations: payload.texts.map(() => '译文') }),
  )
  document.body.innerHTML = `<article><p id="p"><span>${TEXT}</span></p></article>`
  const paragraph = document.getElementById('p')!
  // jsdom 没有排版，所以直接告诉手势光标底下是什么。
  document.elementFromPoint = () => paragraph.querySelector('span')
  translator = new ParagraphTranslator()
  translator.setKey('backtick')
})

afterEach(() => {
  translator.destroy()
  vi.useRealTimers()
})

async function press(init: KeyboardEventInit): Promise<void> {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }))
  window.dispatchEvent(new KeyboardEvent('keydown', init))
  await settle(50)
}

describe('整段翻译的触发键', () => {
  it('中文输入法下打出的是 · ，同一个键，同样要触发', async () => {
    await press({ code: 'Backquote', key: '·' })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('英文输入法下的反引号照旧', async () => {
    await press({ code: 'Backquote', key: '`' })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  /*
   * 别的键盘布局在同一个位置打出别的字符（AZERTY 上是 ²）。
   * 这一条只有认物理位置才过得去。
   */
  it('换一种键盘布局，同一个位置仍然是它', async () => {
    await press({ code: 'Backquote', key: '²' })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  /*
   * 远程桌面和部分虚拟键盘根本不给 code。
   * 这一条只有认字符才过得去——两个判据各挡一头，缺一不可。
   */
  it('拿不到 code 时退回认字符', async () => {
    await press({ key: '·' })
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('别的键不触发——不然满键盘都是这个手势', async () => {
    await press({ code: 'KeyA', key: 'a' })
    await press({ code: 'Digit1', key: '1' })
    expect(translate).not.toHaveBeenCalled()
  })

  it('松开之后手势解除，光标再移动也不会连着翻', async () => {
    await press({ code: 'Backquote', key: '·' })
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Backquote', key: '·' }))
    document.body.insertAdjacentHTML(
      'beforeend',
      `<p id="q"><span>${TEXT} And here is another paragraph entirely.</span></p>`,
    )
    document.elementFromPoint = () => document.getElementById('q')!.querySelector('span')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20 }))
    await settle(50)

    expect(translate).toHaveBeenCalledTimes(1)
  })
})
