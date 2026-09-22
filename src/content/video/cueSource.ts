import type { Settings } from '@/types/settings.ts'
import type { Cue } from './timedtext.ts'

/**
 * 字幕从哪来。
 *
 * 双语层只关心一件事：这支视频的全部 cue（时间轴 + 原文）。至于 cue 是浏览器从
 * `<track>` 里解析的，还是从某个网站的接口里拿的，是这里各个实现的事。
 */

export type CueSourceFailure =
  /** 根本没有字幕。 */
  | 'no_track'
  /** 网站要登录才给字幕。 */
  | 'login'
  /** 接口没通，或者回来的东西不像字幕。 */
  | 'network'

export class CueSourceError extends Error {
  constructor(
    readonly reason: CueSourceFailure,
    readonly detail = '',
  ) {
    super(detail ? `${reason}: ${detail}` : reason)
    this.name = 'CueSourceError'
  }
}

export interface CueSource {
  /**
   * 当前这支媒体的身份。变了说明网站换了片子但 `<video>` 还是那一个（B 站换 P），
   * 手里的 cue 已经是上一支的。不实现就当它不会变。
   */
  key?(): string
  /** 拿全部 cue。拿不到抛 {@link CueSourceError} 说清楚为什么，好让按钮上直说。 */
  load(video: HTMLVideoElement, settings: Settings): Promise<Cue[]>
  /** 关掉双语时把动过的东西还原（比如 `<track>` 的 mode）。 */
  release(): void
}
