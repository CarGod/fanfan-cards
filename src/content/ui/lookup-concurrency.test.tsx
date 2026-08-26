// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMessage = vi.fn()
vi.mock('@/services/messaging.ts', () => ({
  sendMessage: (type: string, payload: unknown) => sendMessage(type, payload),
}))
vi.mock('@/services/speech.ts', () => ({ speak: vi.fn(), warmUpVoices: vi.fn() }))

const { createMemoryAdapter, setStorageAdapter } = await import('@/storage/area.ts')
const { saveSettings } = await import('@/storage/repositories/settingsRepo.ts')
const { App } = await import('./App.tsx')

/**
 * 例句和近义词要和释义**同时**去要，不是等释义回来再去要。
 *
 * 两次请求用的是同一份输入，只差一个 `detail` 字段，彼此没有依赖——串行等于
 * 把两次输出的时间加起来，而读者感受到的是「解释出来了，例句还要再等一轮」。
 *
 * 这条从代码上看不出来：串行和并发写出来长得差不多，跑起来也都对，只是慢一倍。
 * 所以要看**请求发出的时刻**，而不是看结果。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let host: HTMLElement
/** 每个 detail 各留一个「手动放行」的开关，好把回来的顺序捏在手里。 */
let release: Record<string, (value: unknown) => void>
let sentAt: string[]

const explanation = (over: Record<string, unknown> = {}) => ({
  word: 'impressive',
  lemma: 'impressive',
  kind: 'word',
  phonetic: '',
  partOfSpeech: 'adjective',
  cefr: 'B1',
  meaning: '令人赞叹的',
  senses: [],
  contextMeaning: '',
  englishDefinition: '',
  sentenceTranslation: '',
  examples: [],
  synonyms: [],
  ...over,
})

function wire(): void {
  release = {}
  sentAt = []
  sendMessage.mockImplementation((type: string, payload: { detail?: string }) => {
    if (type === 'vocab/lookup') return Promise.resolve({ entry: null })
    if (type !== 'ai/explain') return Promise.resolve({})
    const detail = payload.detail ?? 'full'
    sentAt.push(detail)
    return new Promise((resolve) => {
      release[detail] = resolve as (value: unknown) => void
    })
  })
}

async function selectAndExplain(text: string): Promise<void> {
  document.body.innerHTML = `<p id="p">${text}</p>`
  const paragraph = document.getElementById('p')!
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  // jsdom 的 Range 没有位置信息，而选区读取要靠它决定卡片摆在哪。
  const rect = new DOMRect(10, 10, 60, 16)
  range.getBoundingClientRect = () => rect
  range.getClientRects = (() => [rect]) as unknown as Range['getClientRects']

  await act(async () => {
    // 按住 Alt 划词 = 直接解释，跳过小按钮那一步。
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, altKey: true }))
    await vi.advanceTimersByTimeAsync(200)
  })
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setStorageAdapter(createMemoryAdapter())
  await saveSettings({ provider: 'deepseek', triggerMode: 'button' })
  wire()

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
  vi.useRealTimers()
})

describe('查询的两段并发', () => {
  it('释义还没回来，例句的请求就已经发出去了', async () => {
    await selectAndExplain('impressive')

    // core 还悬着没放行——这一刻 extras 就该已经在路上了。
    expect(sentAt).toContain('core')
    expect(sentAt).toContain('extras')
  })

  it('两段都回来之后，例句补进同一张卡', async () => {
    await selectAndExplain('impressive')

    await act(async () => {
      release['core']!({
        explanation: explanation(),
        providerId: 'deepseek',
        model: 'x',
        offline: false,
        cached: false,
      })
      await vi.advanceTimersByTimeAsync(50)
    })
    await act(async () => {
      release['extras']!({
        explanation: explanation({
          examples: [{ sentence: 'An impressive result.', translation: '一个令人赞叹的结果。' }],
        }),
        providerId: 'deepseek',
        model: 'x',
        offline: false,
        cached: false,
      })
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(container.textContent).toContain('An impressive result.')
  })

  /**
   * 句子卡片上根本不显示例句和近义词，所以那次请求是纯浪费。
   * 本地的 classifySelection 提前判断，判得出来就不发。
   */
  it('选的是整句时不发第二段——那次输出没人会看', async () => {
    await selectAndExplain('The chip delivers impressive performance on real workloads today.')

    expect(sentAt).toContain('core')
    expect(sentAt).not.toContain('extras')
  })

  /** 离线词典一次就答完，没有第二段可言。 */
  it('离线词典不发第二段', async () => {
    // 存设置会通过 watchSettings 触发一次组件更新，所以整件事都要包在 act 里。
    await act(async () => {
      await saveSettings({ provider: 'mock' })
      await vi.advanceTimersByTimeAsync(50)
    })
    wire()

    await selectAndExplain('impressive')
    expect(sentAt).not.toContain('extras')
  })
})
