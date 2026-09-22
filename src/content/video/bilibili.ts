import { z } from 'zod'
import type { Settings } from '@/types/settings.ts'
import { CueSourceError, type CueSource } from './cueSource.ts'
import type { Cue } from './timedtext.ts'

/**
 * B 站。
 *
 * 播放器不是标准 `<track>`，字幕是它自己往 DOM 里画的。但整条字幕是一个带时间轴的
 * JSON 文件，播放器打开字幕时会去取它——我们借播放器的手：在它的字幕菜单里替读者
 * 选上那条轨，看它请求了哪个文件，再把同一个文件拿一份。这样就和 YouTube 一样能按
 * 时间轴对齐、提前翻好。
 *
 * 为什么不直接调 B 站的接口：2026-09 实测，`x/player/v2` 之类的接口一旦被风控盯上
 * 就开始返回**看起来正常的假数据**（字幕列表被删得只剩一条，文件内容是别的视频的），
 * 不报错、不可察觉。播放器自己的请求带着完整的指纹签名，永远拿到的是真的。
 *
 * 番剧（/bangumi/）不走 BV 号，先不管。
 */

export const BILIBILI_HOST = /(^|\.)bilibili\.com$/

export interface BilibiliMedia {
  bvid: string
  /** 分 P，从 1 开始。 */
  page: number
}

const BV_ID = /^BV[0-9A-Za-z]{10}$/

/** 视频页 `/video/BVxxx/?p=2`，或者收藏夹播放页 `/list/...?bvid=BVxxx`。 */
export function parseBilibiliUrl(href: string): BilibiliMedia | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!BILIBILI_HOST.test(url.hostname)) return null
  const bvid = url.pathname.match(/\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1] ?? url.searchParams.get('bvid')
  if (!bvid || !BV_ID.test(bvid)) return null
  const page = Number(url.searchParams.get('p') ?? '1')
  return { bvid, page: Number.isInteger(page) && page > 0 ? page : 1 }
}

/**
 * 挑一条轨：先要读者源语言的人工字幕，再要同语言的 AI 字幕；都没有就第一条。
 *
 * 为什么不挑到就放弃：B 站的 AI 字幕一律标「中文」（`ai-zh`），内容却是说什么写什么，
 * 一个中文 up 主放的英文片段照样是英文。语言标签不可信，拿到轨再看内容。
 */
export function pickBilibiliSubtitle<T extends { lan: string }>(
  list: readonly T[],
  sourceLanguage: string,
): T | null {
  if (list.length === 0) return null
  const want = (sourceLanguage === 'auto' ? 'en' : sourceLanguage).toLowerCase()
  const isAi = (item: T): boolean => item.lan.toLowerCase().startsWith('ai-')
  const language = (item: T): string => item.lan.toLowerCase().replace(/^ai-/, '')
  return (
    list.find((item) => !isAi(item) && language(item).startsWith(want)) ??
    list.find((item) => language(item).startsWith(want)) ??
    list[0]!
  )
}

/** B 站字幕 JSON 的 `body` → 我们的 Cue。秒转毫秒，空行丢掉，按时间排好。 */
export function cuesFromBilibili(body: ReadonlyArray<{ from: number; to: number; content: string }>): Cue[] {
  const cues: Cue[] = []
  for (const item of body) {
    const text = item.content.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const startMs = Math.round(item.from * 1000)
    cues.push({ startMs, endMs: Math.max(startMs, Math.round(item.to * 1000)), text })
  }
  cues.sort((a, b) => a.startMs - b.startMs)
  return cues
}

const bodySchema = z.object({
  body: z.array(z.object({ from: z.number(), to: z.number(), content: z.string() })),
})

/** 2026-09 实测的播放器结构。 */
const LANGUAGE_ITEM = '.bpx-player-ctrl-subtitle-language-item[data-lan]'
const ACTIVE_CLASS = 'bpx-state-active'
/** 挂在 `<html>` 上：样式表据此把 B 站自己画的字幕藏起来（见 styles.ts）。 */
export const HIDE_NATIVE_ATTR = 'data-fanfan-hide-native-subs'
export const NATIVE_SUBTITLE_SELECTOR = '.bpx-player-subtitle-wrap'
/** 播放器取字幕文件的地址长这样。 */
const SUBTITLE_FILE = /hdslb\.com\/bfs\/(?:ai_)?subtitle\//

const MENU_WAIT_MS = 6_000
/** 换 P 之后播放器要先把新视频拉起来才去取字幕，给它一点时间。 */
const REQUEST_WAIT_MS = 5_000
const POLL_MS = 300

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface LanguageItem {
  lan: string
  element: HTMLElement
}

/** 菜单里的语言项。主字幕、副字幕两组各列一遍，按 lan 去重只留第一组。 */
function languageItems(): LanguageItem[] {
  const seen = new Set<string>()
  const items: LanguageItem[] = []
  for (const element of document.querySelectorAll<HTMLElement>(LANGUAGE_ITEM)) {
    const lan = element.dataset['lan'] ?? ''
    if (!lan || seen.has(lan)) continue
    seen.add(lan)
    items.push({ lan, element })
  }
  return items
}

async function waitForLanguageItems(): Promise<LanguageItem[]> {
  const deadline = Date.now() + MENU_WAIT_MS
  for (;;) {
    const items = languageItems()
    if (items.length > 0 || Date.now() >= deadline) return items
    await sleep(POLL_MS)
  }
}

/**
 * 播放器请求过的字幕文件，按先后。
 *
 * 自己记一份而不是每次去翻 `performance` 的缓冲区：B 站页面几分钟就能发上千个请求，
 * 缓冲区默认只留 250 条，读者看了一会儿再点开关时，一开始那条早被挤掉了。
 */
const requestLog: string[] = []
let logging = false

function ensureRequestLog(): void {
  if (logging) return
  logging = true
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (SUBTITLE_FILE.test(entry.name) && !requestLog.includes(entry.name)) requestLog.push(entry.name)
    }
  })
  observer.observe({ type: 'resource', buffered: true })
}

/** 等播放器发出一个快照里没有的字幕文件请求。 */
async function waitForNewSubtitleRequest(known: ReadonlySet<string>): Promise<string | null> {
  const deadline = Date.now() + REQUEST_WAIT_MS
  for (;;) {
    const fresh = requestLog.find((url) => !known.has(url))
    if (fresh) return fresh
    if (Date.now() >= deadline) return null
    await sleep(200)
  }
}

async function fetchSubtitleFile(url: string): Promise<Cue[]> {
  let last: CueSourceError = new CueSourceError('network')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(800)
    try {
      // CDN 回的是 `Access-Control-Allow-Origin: *`，带上 cookie 反而会被浏览器拦下。
      const response = await fetch(url, { credentials: 'omit' })
      if (!response.ok) {
        last = new CueSourceError('network', `${response.status} ${url}`)
        continue
      }
      const parsed = bodySchema.safeParse(await response.json())
      if (!parsed.success) throw new CueSourceError('network', `unexpected subtitle body ${url}`)
      return cuesFromBilibili(parsed.data.body)
    } catch (error) {
      last = error instanceof CueSourceError ? error : new CueSourceError('network', `${String(error)} ${url}`)
    }
  }
  throw last
}

export class BilibiliCueSource implements CueSource {
  /** 上一次用的文件：换 P 之后它还在记录里，不能再当成这一支的。 */
  private usedUrl = ''

  constructor() {
    ensureRequestLog()
  }

  key(): string {
    const media = parseBilibiliUrl(location.href)
    return media ? `${media.bvid}#${media.page}` : ''
  }

  async load(_video: HTMLVideoElement, settings: Settings): Promise<Cue[]> {
    const items = await waitForLanguageItems()
    // 没有语言项就是这支视频没字幕（AI 字幕要登录 B 站才有）。
    if (items.length === 0) throw new CueSourceError('no_track')
    const chosen = pickBilibiliSubtitle(items, settings.sourceLanguage)!

    const known = new Set(requestLog)
    if (!chosen.element.classList.contains(ACTIVE_CLASS)) chosen.element.click()
    let url = await waitForNewSubtitleRequest(known)
    // 播放器早就加载过这条字幕（页面一打开 CC 就是开着的），再点也不会请求：
    // 用它最近请求过的那个。
    if (!url) {
      const latest = requestLog.at(-1)
      if (latest && latest !== this.usedUrl) url = latest
    }
    if (!url) throw new CueSourceError('network', 'player made no subtitle request')

    const cues = await fetchSubtitleFile(url)
    this.usedUrl = url
    // 字幕是我们替读者打开的，原文在我们这层已经有了；它自己画的那行收起来，关掉时还回去。
    document.documentElement.setAttribute(HIDE_NATIVE_ATTR, '')
    return cues
  }

  release(): void {
    document.documentElement.removeAttribute(HIDE_NATIVE_ATTR)
  }
}

/** 这个 `<video>` 是不是 B 站视频页的播放器（侧栏悬停预览也是 `<video>`，不算）。 */
export function isBilibiliPlayer(video: HTMLVideoElement): boolean {
  if (!BILIBILI_HOST.test(location.hostname) || !parseBilibiliUrl(location.href)) return false
  return video.closest('#bilibili-player, .bpx-player-container') !== null
}
