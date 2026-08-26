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
const { saveSettings } = await import('@/storage/repositories/settingsRepo.ts')
const { App } = await import('./App.tsx')

/**
 * 划完词按回车直接解释。
 *
 * 手还在键盘上，去够鼠标点那个小按钮是整个手势里最别扭的一段。
 *
 * 但抢全局的回车是件危险事：在输入框里回车是换行或提交，抢过来坏的是**别人的页面**——
 * 读者在 x.com 上打了半条推文按回车，结果发不出去，他不会怀疑是划词插件。
 * 所以这里大半用例在测**什么时候不许接管**。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let host: HTMLElement

/*
 * 只数第一段。
 *
 * 一次解释会同时发出 core 和 extras 两个请求（并发是刻意的），数总数就把
 * 「触发了几次解释」和「一次解释发几个请求」混成一个数了。
 */
const explainCalls = () =>
  sendMessage.mock.calls.filter(
    (call) => call[0] === 'ai/explain' && (call[1] as { detail?: string })?.detail === 'core',
  ).length

/** 划一段词，让小按钮亮起来。 */
async function select(text: string): Promise<void> {
  document.body.innerHTML = `<p id="p">${text}</p><input id="box"><div id="editable" contenteditable="true">x</div>`
  const paragraph = document.getElementById('p')!
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  const rect = new DOMRect(10, 10, 60, 16)
  range.getBoundingClientRect = () => rect
  range.getClientRects = (() => [rect]) as unknown as Range['getClientRects']

  await act(async () => {
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(200)
  })
}

async function pressEnter(target: Element | Document = document, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...init }))
    await vi.advanceTimersByTimeAsync(50)
  })
}

const trigger = () => container.querySelector('.trigger')

beforeEach(async () => {
  sendMessage.mockReset()
  sendMessage.mockImplementation(async () => ({}))
  vi.useFakeTimers({ shouldAdvanceTime: true })
  setStorageAdapter(createMemoryAdapter())
  await saveSettings({ provider: 'deepseek', triggerMode: 'button' })

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

describe('划完词按回车', () => {
  it('小按钮上标着回车键，不用读者自己去试', async () => {
    await select('industry')
    expect(trigger()).not.toBeNull()
    expect(trigger()!.querySelector('kbd')).not.toBeNull()
  })

  it('按下就解释，不用去够鼠标', async () => {
    await select('industry')
    await pressEnter()
    expect(explainCalls()).toBe(1)
  })
})

describe('什么时候不许接管回车', () => {
  /** 没划词的时候，这个回车不是给我们的。 */
  it('小按钮没亮时不接管', async () => {
    document.body.innerHTML = '<p>nothing selected</p>'
    await pressEnter()
    expect(explainCalls()).toBe(0)
  })

  /** 在输入框里回车是换行或提交，抢过来坏的是别人的页面。 */
  it('焦点在输入框里时不接管', async () => {
    await select('industry')
    await pressEnter(document.getElementById('box')!)
    expect(explainCalls()).toBe(0)
  })

  it('焦点在可编辑区域里时不接管', async () => {
    await select('industry')
    await pressEnter(document.getElementById('editable')!)
    expect(explainCalls()).toBe(0)
  })

  /**
   * 输入法组合期间的回车是「确认候选词」，不是「确认操作」。
   * 中文输入法下这个键每打几个字就按一次——接管它等于让功能随机触发。
   */
  it('输入法组合期间不接管', async () => {
    await select('industry')
    await pressEnter(document, { isComposing: true })
    expect(explainCalls()).toBe(0)
  })
})
