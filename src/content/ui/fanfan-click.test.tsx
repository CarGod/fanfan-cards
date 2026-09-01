// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn<(type: string, payload?: unknown) => Promise<unknown>>()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: unknown) => sendMessage(type, payload),
}))
vi.mock('@/services/speech.ts', () => ({ speak: vi.fn(), warmUpVoices: vi.fn() }))

const { createMemoryAdapter, setStorageAdapter } = await import('@/storage/area.ts')
const { saveEntry } = await import('@/storage/repositories/vocabularyRepo.ts')
const { saveSettings } = await import('@/storage/repositories/settingsRepo.ts')
const { App } = await import('./App.tsx')

/**
 * 点一个翻翻模式标出来的词，卡片要留在屏幕上。
 *
 * 这条是回归测试，钉的是一个真实存在过的 bug：卡片弹出来，然后自己消失。
 *
 * 成因是三个监听器的时序。划词那套逻辑挂在 mouseup 上，启动一个 140ms 的防抖
 * 判定；它醒来时看到「没有选区、界面却开着」，判定为 dismiss。而卡片是在
 * click 之后异步弹出来的，正好落在那 140ms 之前——于是自己人把它关掉了。
 *
 * 这种坏法没有任何报错，控制台干净，代码读起来也全都对。只有把三个监听器
 * 一起跑起来才看得见。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeHighlight {
  readonly ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

let container: HTMLDivElement
let root: Root
let host: HTMLElement

const card = () => container.querySelector('.card')

/** jsdom 里 Range 没有位置信息，所以直接告诉它光标落在哪个字符上。 */
function pointAtWord(word: string): void {
  const node = [...document.querySelectorAll('p')]
    .flatMap((p) => [...p.childNodes])
    .filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
    .find((n) => n.data.includes(word))!
  ;(document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = () => {
    const range = document.createRange()
    const at = node.data.indexOf(word) + 1
    range.setStart(node, at)
    range.setEnd(node, at)
    return range
  }
}

function pointAtNothing(): void {
  ;(document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = () => null
}

const mouse = (type: string) =>
  act(() => {
    document.querySelector('p')!.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }),
    )
  })

/** 完整的一次点击：三个事件按浏览器的真实顺序发出来。 */
async function clickWord(word: string): Promise<void> {
  pointAtWord(word)
  mouse('mousedown')
  mouse('mouseup')
  mouse('click')
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(async () => {
  sendMessage.mockReset()
  /*
   * 按真实契约回话。
   *
   * 回一个空对象 `{}` 会让「补不到就说一句」那条路读到 undefined——
   * 而那正是这个桩在替代的东西：一个说得出「补上了哪几项」的后台。
   */
  sendMessage.mockImplementation(async (type: string) =>
    type === 'vocab/enrich' ? { entry: null, filled: [] } : {},
  )
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('Highlight', FakeHighlight)
  vi.stubGlobal('CSS', { highlights: new Map() })
  setStorageAdapter(createMemoryAdapter())

  await saveSettings({ fanfanMode: true })
  await saveEntry({
    word: 'migration',
    lemma: 'migration',
    kind: 'word',
    phonetic: '',
    partOfSpeech: 'noun',
    cefr: '',
    meaning: '迁移',
    senses: [],
    aiExplanation: '',
    englishDefinition: '',
    sentenceTranslation: '',
    examples: [],
    synonyms: [],
    // 字段名是 context 不是 sentence——写错的那一版让卡片直接抛异常。
    source: { url: 'https://x.com', title: 'x', context: 'A database migration takes minutes.' },
    origin: 'ai',
  } as never)

  document.body.innerHTML = '<p>A database migration takes minutes.</p>'
  container = document.createElement('div')
  document.body.append(container)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(container)
  await act(async () => {
    root.render(<App host={host} />)
    await Promise.resolve()
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('点击翻翻模式标出来的词', () => {
  it('卡片弹出来，并且留在屏幕上', async () => {
    await clickWord('migration')
    expect(card()).not.toBeNull()

    /*
     * 关键的一步：把 mouseup 上那个 140ms 的防抖跑完。
     * bug 就发生在这里——卡片在这一刻被自己人关掉。
     */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card()).not.toBeNull()
    expect(card()!.textContent).toContain('migration')
  })

  it('卡片里是收藏时就存好的释义，不需要问任何人', async () => {
    await clickWord('migration')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card()!.textContent).toContain('迁移')
  })

  it('点在没标出来的地方，什么都不弹', async () => {
    pointAtNothing()
    mouse('mousedown')
    mouse('mouseup')
    mouse('click')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card()).toBeNull()
  })

  it('卡片开着时点别处，收起来', async () => {
    await clickWord('migration')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card()).not.toBeNull()

    pointAtNothing()
    mouse('mousedown')
    mouse('mouseup')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card()).toBeNull()
  })

  /**
   * 缺内容时自动补，但**同一张卡一次会话只试一次**。
   *
   * 这一条会自动花读者的 API 额度。补不上（模型没给、或者用的是离线词典）时
   * 每点一次就再花一次钱，是个不该由我们替他做的决定。
   */
  it('缺内容时自动去补，补不上也不会点一次花一次钱', async () => {
    // 先换 DOM 再存词：存词会立刻重画一次高亮，而重扫 DOM 是 350ms 防抖的。
    document.body.innerHTML = '<p>Pay attention to this.</p>'
    await act(async () => {
      await saveEntry({
        word: 'attention',
        lemma: 'attention',
        kind: 'word',
        phonetic: '',
        partOfSpeech: 'noun',
        cefr: '',
        meaning: '注意',
        senses: [],
        aiExplanation: '',
        englishDefinition: '',
        sentenceTranslation: '',
        examples: [],
        synonyms: [],
        source: { url: 'https://x.com', title: 'x', context: 'Pay attention to this.' },
        origin: { providerId: 'deepseek', model: 'x', offline: false },
      } as never)
      await vi.advanceTimersByTimeAsync(50)
    })

    await clickWord('attention')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    const enrichCalls = () =>
      sendMessage.mock.calls.filter((call) => call[0] === 'vocab/enrich').length
    expect(enrichCalls()).toBe(1)

    // 关掉再点开同一个词：不该再花一次钱。
    pointAtNothing()
    mouse('mousedown')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    await clickWord('attention')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(enrichCalls()).toBe(1)
  })
})
