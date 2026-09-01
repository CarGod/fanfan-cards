// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUEST_EVENT, RESPONSE_EVENT, type BridgePayload } from './bridge.ts'

/**
 * 页面世界那半边。
 *
 * 这个文件里的东西无法用普通方式测：它在 import 的那一刻就给 `window.fetch` 和
 * `XMLHttpRequest` 挂钩子、往 document 上挂监听器。但**不测的代价已经付过一次**——
 * 「换视频之后原生字幕关不回去」在真实浏览器上藏了一整个版本，而它只需要这里
 * 三十行就能钉住。
 */

const TICKET = 'ticket-from-the-player'

interface FakePlayer extends HTMLElement {
  isSubtitlesOn: () => boolean
  loadModule: (name: string) => void
  unloadModule: (name: string) => void
  setOption: (module: string, option: string, value: unknown) => void
}

/** 一个够用的假播放器：读者本来**关着**原生字幕。 */
function mountPlayer(): FakePlayer {
  const player = document.createElement('div') as unknown as FakePlayer
  player.id = 'movie_player'
  player.isSubtitlesOn = () => false
  player.unloadModule = vi.fn()
  player.setOption = vi.fn()
  // 播放器被要求打开字幕时，会自己去取一次 timedtext——票就是从这次请求里捡到的。
  player.loadModule = vi.fn(() => {
    void window.fetch(`https://www.youtube.com/api/timedtext?v=abc&pot=${TICKET}&exp=xpe`)
  })
  document.body.append(player)
  return player
}

/** 向页面世界要一件事，等它回话。 */
function ask<T>(payload: BridgePayload): Promise<T> {
  const id = `test-${Math.random().toString(36).slice(2)}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('页面世界没有回话')), 8000)
    function onResponse(event: Event): void {
      const reply = JSON.parse(String((event as CustomEvent).detail))
      if (reply.id !== id) return
      clearTimeout(timer)
      document.removeEventListener(RESPONSE_EVENT, onResponse)
      reply.ok ? resolve(reply.data as T) : reject(new Error(reply.error))
    }
    document.addEventListener(RESPONSE_EVENT, onResponse)
    document.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ ...payload, id }) }),
    )
  })
}

/*
 * 钩子包的是 import 那一刻的 `window.fetch`，所以桩必须先于 import 装好——
 * 否则真的会打到网络上去。
 */
window.fetch = vi.fn(async () => new Response('')) as unknown as typeof window.fetch
await import('./mainWorld.ts')

describe('页面世界：原生字幕的开与关', () => {
  let player: FakePlayer

  beforeEach(async () => {
    document.body.innerHTML = ''
    player = mountPlayer()
    /*
     * 票和「原生字幕原状」都是模块级状态，会从上一条用例漏过来。
     * 导航事件清票、restore 清原状——两件事各归各的，正是被测代码的分工。
     */
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'))
    await ask({ kind: 'restore' })
    vi.clearAllMocks()
  })

  it('替读者打开原生字幕是为了拿票，拿完要还回去', async () => {
    await ask({ kind: 'prime', languageCode: 'en' })
    expect(player.loadModule).toHaveBeenCalledWith('captions')

    await ask({ kind: 'restore' })
    expect(player.unloadModule).toHaveBeenCalledWith('captions')
  })

  /**
   * 这条是回归测试，钉的是一个真实存在过的 bug。
   *
   * 两个世界都监听 `yt-navigate-finish`，而页面世界在 document_start 注册、
   * 隔离世界在 document_idle 注册，所以页面世界这边**必定先跑**。它当时顺手把
   * `captionsWereOn` 一起清成了 null，于是隔离世界紧接着发来的 restore 撞上
   * 「状态是 null 就什么都不做」那道闸，直接空转。
   *
   * 后果不在控制台里，在画面上：读者从没开过的 YouTube 原生字幕，从第二支视频
   * 起就一直挂着。
   */
  it('换视频之后，restore 依然把原生字幕关得回去', async () => {
    await ask({ kind: 'prime', languageCode: 'en' })
    expect(player.loadModule).toHaveBeenCalledWith('captions')

    // 读者点了下一支视频。
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'))

    await ask({ kind: 'restore' })
    expect(player.unloadModule).toHaveBeenCalledWith('captions')
  })

  it('换视频之后，上一支的票不再被复用', async () => {
    const first = await ask<{ pot: string }>({ kind: 'prime', languageCode: 'en' })
    expect(first.pot).toBe(TICKET)

    window.dispatchEvent(new CustomEvent('yt-navigate-finish'))

    // 票已经清空，所以这一次必须重新去问播放器要，而不是把旧票直接递回来。
    vi.clearAllMocks()
    await ask({ kind: 'prime', languageCode: 'en' })
    expect(player.loadModule).toHaveBeenCalledWith('captions')
  })

  it('读者本来就开着原生字幕时，我们不去替他关掉', async () => {
    player.isSubtitlesOn = () => true
    await ask({ kind: 'prime', languageCode: 'en' })

    await ask({ kind: 'restore' })
    expect(player.unloadModule).not.toHaveBeenCalled()
  })
})
