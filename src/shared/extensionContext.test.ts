import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 扩展每更新一次，用户当时开着的每一个标签页都会变成孤儿脚本。
 *
 * 之前的表现是每一次悬停、每一次翻译都往控制台扔一条
 * `Extension context invalidated`——看起来像插件坏了，其实只是需要刷新一下。
 * 这里钉住的是那三件该做的事：认出来、只锁一次、通知所有人。
 */

/** 每个用例要一份全新的模块状态：孤儿标记是一次性的，跨用例会互相污染。 */
async function freshModule() {
  vi.resetModules()
  return import('./extensionContext.ts')
}

const aliveChrome = { runtime: { id: 'abc' } }

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('chrome', aliveChrome)
})

describe('noteOrphanError', () => {
  it('认得出 AIError 上的 stale_context 码', async () => {
    const { noteOrphanError, isOrphaned } = await freshModule()
    expect(isOrphaned()).toBe(false)
    expect(noteOrphanError(Object.assign(new Error('后台没响应'), { code: 'stale_context' }))).toBe(
      true,
    )
    expect(isOrphaned()).toBe(true)
  })

  it('也认得出原始的错误文本', async () => {
    const { noteOrphanError } = await freshModule()
    expect(noteOrphanError(new Error('Extension context invalidated'))).toBe(true)
  })

  /*
   * 这条最重要：普通的失败不能被当成失联。
   * 认错了的后果是一次 429 就把整个页面的功能永久关掉，还叫用户去刷新。
   */
  it('普通失败不算失联', async () => {
    const { noteOrphanError, isOrphaned } = await freshModule()
    expect(noteOrphanError(Object.assign(new Error('rate limited'), { code: 'rate_limit' }))).toBe(
      false,
    )
    expect(isOrphaned()).toBe(false)
  })

  it('chrome.runtime 整个没了也算失联', async () => {
    const { noteOrphanError } = await freshModule()
    vi.stubGlobal('chrome', { runtime: undefined })
    expect(noteOrphanError(new Error('随便什么错'))).toBe(true)
  })

  it('只锁一次，订阅者只被叫醒一次', async () => {
    const { noteOrphanError, onOrphaned } = await freshModule()
    const listener = vi.fn()
    onOrphaned(listener)

    noteOrphanError(new Error('Extension context invalidated'))
    noteOrphanError(new Error('Extension context invalidated'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  // 界面可能在失联之后才挂载（读者正好这时候划了个词），那也得看到提示。
  it('已经失联之后再订阅，立刻就被告知', async () => {
    const { noteOrphanError, onOrphaned } = await freshModule()
    noteOrphanError(new Error('Extension context invalidated'))

    const listener = vi.fn()
    onOrphaned(listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('退订之后不再被叫醒', async () => {
    const { noteOrphanError, onOrphaned } = await freshModule()
    const listener = vi.fn()
    onOrphaned(listener)()
    noteOrphanError(new Error('Extension context invalidated'))
    expect(listener).not.toHaveBeenCalled()
  })
})
