import { REQUEST_EVENT, RESPONSE_EVENT, type BridgeRequest } from './bridge.ts'

/**
 * 页面世界（MAIN world）里的那半边。
 *
 * 这里**没有** `chrome.runtime`——MAIN world 的内容脚本拿不到任何扩展 API，
 * 所以这个文件不能 import 任何碰 chrome 的东西，也单独打一个包。它只做三件事：
 * 读播放器的数据、把播放器请求里的 `pot` 记下来、替隔离世界发同源请求。
 *
 * 它在 document_start 运行，因为要在播放器发出第一个 timedtext 请求**之前**
 * 把 fetch 挂上——晚一步，票就从眼皮底下飞过去了。
 */

let capturedPot = ''
let captionsWereOn: boolean | null = null

function notePot(url: string): void {
  if (!url || url.indexOf('/api/timedtext') < 0) return
  const match = /[?&]pot=([^&]+)/.exec(url)
  if (match && match[1]) capturedPot = decodeURIComponent(match[1])
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof (input as { url?: unknown }).url === 'string') {
    return (input as { url: string }).url
  }
  return ''
}

/*
 * 钩子必须是透明的。任何一处提前 return 或者吞掉异常都会让播放器行为变形，
 * 而这种坏法在页面上表现成「视频偶尔转圈」，几乎不可能被联想到字幕功能上。
 */
function installHooks(): void {
  const nativeFetch = window.fetch
  window.fetch = function patchedFetch(this: unknown, ...args: unknown[]) {
    try {
      notePot(urlOf(args[0]))
    } catch {
      /* 记票失败就是没票，不能连累这次请求 */
    }
    return (nativeFetch as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof window.fetch

  const nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function patchedOpen(this: unknown, ...args: unknown[]) {
    try {
      notePot(String(args[1] ?? ''))
    } catch {
      /* 同上 */
    }
    return (nativeOpen as (...a: unknown[]) => unknown).apply(this, args)
  } as typeof XMLHttpRequest.prototype.open
}

interface MoviePlayer extends HTMLElement {
  getPlayerResponse?: () => unknown
  isSubtitlesOn?: () => boolean
  loadModule?: (name: string) => void
  unloadModule?: (name: string) => void
  setOption?: (module: string, option: string, value: unknown) => void
}

function moviePlayer(): MoviePlayer | null {
  return document.getElementById('movie_player') as MoviePlayer | null
}

/**
 * 优先问播放器要，而不是读 `ytInitialPlayerResponse`。
 *
 * YouTube 是单页应用：换一个视频，那个全局变量常常还停在进站时的第一个视频上，
 * 于是字幕对不上画面——而这看起来像「翻译错了」，不像「读了旧数据」。
 */
function playerResponse(): Record<string, any> | null {
  const player = moviePlayer()
  if (player && typeof player.getPlayerResponse === 'function') {
    try {
      const response = player.getPlayerResponse()
      if (response) return response as Record<string, any>
    } catch {
      /* 播放器还没就绪，往下走 */
    }
  }
  return (window as any).ytInitialPlayerResponse ?? null
}

function readCaptions(): { videoId: string; tracks: unknown[]; pot: string } {
  const response = playerResponse()
  const tracks =
    response?.['captions']?.['playerCaptionsTracklistRenderer']?.['captionTracks'] ?? []
  return {
    videoId: String(response?.['videoDetails']?.['videoId'] ?? ''),
    tracks: Array.isArray(tracks) ? tracks : [],
    pot: capturedPot,
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 逼播放器去要一次字幕，从它的请求里把票捡回来。
 *
 * 记下原本的开关状态：读者要是本来关着字幕，我们开完不还回去，
 * 他关掉我们的功能之后会发现 YouTube 的字幕自己冒了出来。
 */
async function primeCaptions(languageCode: string, force: boolean): Promise<{ pot: string }> {
  /*
   * 贴片广告期间播放器也会去取字幕，抓到的票是**广告那一支**的。
   * 拿它去取正片的字幕，服务端回 200 和一个空 body——不是错误码，是空的。
   * 所以取不到内容时要能把旧票丢掉重来一次。
   */
  if (force) capturedPot = ''
  if (capturedPot) return { pot: capturedPot }

  const player = moviePlayer()
  if (!player) return { pot: '' }

  if (captionsWereOn === null) {
    captionsWereOn = typeof player.isSubtitlesOn === 'function' ? !!player.isSubtitlesOn() : false
  }

  try {
    player.loadModule?.('captions')
    player.setOption?.('captions', 'track', { languageCode })
  } catch {
    /* 有些形态下没有这些方法，那就只能等播放器自己去取 */
  }

  // 票是异步来的，最多等四秒；等不到就按「拿不到票」处理，而不是无限等下去。
  for (let waited = 0; waited < 4000 && !capturedPot; waited += 100) {
    await sleep(100)
  }
  return { pot: capturedPot }
}

function restoreCaptions(): { restored: boolean } {
  const player = moviePlayer()
  if (!player || captionsWereOn === null) return { restored: false }
  if (!captionsWereOn) {
    try {
      player.setOption?.('captions', 'track', {})
      player.unloadModule?.('captions')
    } catch {
      /* 恢复失败不该抛给对面 */
    }
  }
  captionsWereOn = null
  return { restored: true }
}

async function handle(request: BridgeRequest): Promise<unknown> {
  switch (request.kind) {
    case 'captions':
      return readCaptions()
    case 'prime':
      return primeCaptions(request.languageCode, request.force === true)
    case 'restore':
      return restoreCaptions()
    case 'fetch': {
      const response = await fetch(request.url, { credentials: 'include' })
      return { status: response.status, body: await response.text() }
    }
    default:
      throw new Error('unknown request')
  }
}

function reply(id: string, ok: boolean, payload: unknown): void {
  const detail = ok
    ? JSON.stringify({ id, ok: true, data: payload })
    : JSON.stringify({ id, ok: false, error: String(payload) })
  document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }))
}

document.addEventListener(REQUEST_EVENT, (event) => {
  let request: BridgeRequest
  try {
    request = JSON.parse(String((event as CustomEvent).detail)) as BridgeRequest
  } catch {
    return
  }
  handle(request).then(
    (data) => reply(request.id, true, data),
    (error) => reply(request.id, false, error instanceof Error ? error.message : error),
  )
})

/*
 * 换视频了，上一支的票不能用在这一支上。
 *
 * **只清票，不清 `captionsWereOn`。** 这两个值的生命周期不一样，一起清是个 bug：
 * 隔离世界在同一个 `yt-navigate-finish` 上也挂了监听器，它要做的正是
 * teardownRun → restore，把我们替读者打开的原生字幕关回去。而这个文件的监听器
 * 注册在 document_start、对面注册在 document_idle，Blink 按注册顺序派发——
 * 所以清空必定先跑，restore 到手时 `captionsWereOn` 已经是 null，第一道闸直接
 * return，unloadModule 永远执行不到。
 *
 * 表现是：读者本来关着的 YouTube 原生字幕，从第二支视频起就一直开着，
 * 而且他从没开过它。`captionsWereOn` 的清除本来就由 restoreCaptions() 自己在
 * 末尾负责，这里不该插手。
 */
window.addEventListener('yt-navigate-finish', () => {
  capturedPot = ''
})

installHooks()
