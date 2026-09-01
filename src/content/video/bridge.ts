/**
 * 隔离世界与页面世界之间的一条线。
 *
 * 为什么要有页面世界的脚本：字幕轨列表在 `ytInitialPlayerResponse` 里，
 * 那是页面自己的变量，内容脚本看不到；而字幕地址上的 `pot`（proof-of-origin token）
 * 是播放器用 BotGuard 现算的，只出现在它自己发出的请求里——少了它，
 * timedtext 返回 200 和一个空 body，比报错还难查。
 *
 * 两边只能靠 DOM 事件说话。detail 一律走 JSON 字符串：跨世界传对象会被结构化克隆，
 * 原型、Map、undefined 各有各的脾气，传字符串没有任何歧义。
 */

export const REQUEST_EVENT = 'fanfan:yt-request'
export const RESPONSE_EVENT = 'fanfan:yt-response'

export type BridgePayload =
  /** 当前视频的 id 与全部字幕轨。 */
  | { kind: 'captions' }
  /**
   * 让播放器自己去取一次字幕，好把 `pot` 带出来。
   *
   * 这会真的把原生字幕打开——没有别的办法让 BotGuard 出票。调用方负责在拿到票之后
   * 决定是留着（我们把原生字幕藏起来自己画）还是恢复原状。
   */
  | { kind: 'prime'; languageCode: string; force?: boolean }
  /** 恢复调用 prime 之前的原生字幕开关状态。 */
  | { kind: 'restore' }
  /** 在页面世界里同源取一段文本：带 cookie、带正确的 referer。 */
  | { kind: 'fetch'; url: string }

/** 加上关联 id 之后才是真正过线的那个对象。 */
export type BridgeRequest = BridgePayload & { id: string }

export type BridgeResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }

export interface CaptionsData {
  videoId: string
  tracks: unknown[]
  /** 页面世界此刻已经抓到的 pot，可能为空。 */
  pot: string
}
