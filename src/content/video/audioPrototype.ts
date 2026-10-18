import { LocalListening } from './localListening.ts'
import { t } from '@/i18n/index.ts'
import { getSettings, isHostEnabled, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { callMainWorld } from './youtube.ts'
import type { CaptionsData } from './bridge.ts'
import { parseBilibiliUrl } from './bilibili.ts'
import { PlayerAudioCapture, type CaptureSnapshot, type CaptureStatus } from './audioCapture.ts'

export const AUDIO_HOST = 'fanfan-audio-prototype'
const YOUTUBE = /(^|\.)youtube\.com$/

export function mediaIdentity(video: HTMLVideoElement, href = location.href): string {
  const url = new URL(href)
  const bili = parseBilibiliUrl(href)
  const page = YOUTUBE.test(url.hostname) ? url.searchParams.get('v') ?? url.pathname
    : bili ? `${bili.bvid}:${bili.page}` : `${url.origin}${url.pathname}${url.search}`
  return `${page}|${video.currentSrc}`
}

export function hasTextSubtitles(video: HTMLVideoElement): boolean {
  return Array.from(video.textTracks).some((track) => track.kind === 'subtitles' || track.kind === 'captions') ||
    !!video.querySelector('track[kind="subtitles"],track[kind="captions"],track:not([kind])')
}

const CSS = `
:host{all:initial;position:absolute;z-index:10;pointer-events:none;font:12px/1 system-ui,sans-serif;color:#fff}
:host([hidden]){display:none!important}
*{box-sizing:border-box}
.card{position:absolute;right:12px;top:12px;max-width:calc(100% - 24px);pointer-events:none;opacity:0;transition:opacity .15s}
:host([data-controls]) .card,.card:has(.start:focus-visible){opacity:1;pointer-events:auto}
.start{display:flex;align-items:center;gap:7px;height:32px;max-width:100%;padding:0 11px;border:1px solid #ffffff30;border-radius:16px;background:#16191e99;color:#fff;font:inherit;font-weight:500;cursor:pointer;box-shadow:0 1px 4px #0002;backdrop-filter:blur(10px);transition:background .15s,border-color .15s}
.start[aria-pressed="true"]{background:#ff6b35;border-color:transparent}
.start:hover{background:#16191ee6;border-color:#ffffff70}
.start:focus-visible{outline:2px solid #fff;outline-offset:3px}
.icon{display:flex;align-items:center;justify-content:center;gap:2px;width:14px;height:14px;flex:none}
.icon i{display:block;width:2px;height:6px;border-radius:1px;background:currentColor}.icon i:nth-child(2){height:12px}.icon i:nth-child(3){height:9px}
.start[aria-pressed="true"] .icon{border:1px solid #ffffff70;border-radius:50%;width:16px;height:16px}
.start[aria-pressed="true"] .icon i{display:none}
.start[aria-pressed="true"] .icon:after{content:"";width:6px;height:6px;background:currentColor;border-radius:1px}
.label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
:host([data-status="error"]) .start{border-color:#ffc58c80;color:#ffddba}
.subtitles{position:absolute;bottom:52px;left:5%;width:90%;text-align:center;pointer-events:none;font:500 var(--fanfan-caption-size,16px)/1.4 system-ui,sans-serif;text-shadow:0 1px 3px #000,0 0 6px #000}
.subtitles[hidden]{display:none}.subtitles div{width:fit-content;max-width:100%;margin:2px auto;padding:2px 8px;border-radius:4px;background:#0009;white-space:pre-wrap;overflow-wrap:anywhere}.subtitles .original{font-size:.85em;color:#eee}
@media(prefers-reduced-motion:reduce){.start{transition:none}}
`

const STATUS_KEYS = {
  idle: 'video.audio.ready', waiting: 'video.audio.waiting', recording: 'video.audio.recording',
  paused: 'video.audio.paused', seeking: 'video.audio.seeking', buffering: 'video.audio.buffering',
  stopped: 'video.audio.stopped', error: 'video.audio.error',
} as const satisfies Record<CaptureStatus, Parameters<typeof t>[0]>

class AudioBinding {
  readonly host = document.createElement('div')
  readonly capture: PlayerAudioCapture
  private readonly startButton = document.createElement('button')
  private readonly subtitles = document.createElement('div')
  private readonly original = document.createElement('div')
  private readonly translation = document.createElement('div')
  private readonly listening: LocalListening
  private readonly label = document.createElement('span')
  private container: HTMLElement | null = null
  private restorePosition: string | null = null
  private hideTimer = 0
  private readonly revealControls = (event: PointerEvent): void => {
    const rect = this.video.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      this.hideControls()
      return
    }
    this.host.setAttribute('data-controls', '')
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => this.host.removeAttribute('data-controls'), 2200)
  }
  private readonly hideControls = (): void => {
    clearTimeout(this.hideTimer)
    this.host.removeAttribute('data-controls')
  }
  available = false
  probePending = false
  private key: string
  private readonly onMediaChange = (): void => {
    this.available = false
    this.settledAt = performance.now()
    this.stop('changed')
    this.position()
  }
  private readonly onFinishedSeek = (): void => {
    if (!this.capture.running && this.capture.snapshot.reason === 'ended') this.stop('changed')
  }
  settledAt = performance.now()

  constructor(readonly video: HTMLVideoElement, private readonly beforeStart: () => void) {
    this.key = mediaIdentity(video)
    this.host.className = `${AUDIO_HOST} notranslate`
    this.host.setAttribute('translate', 'no')
    this.host.hidden = true
    const shadow = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = CSS
    const card = document.createElement('div')
    card.className = 'card'
    card.addEventListener('click', (event) => event.stopPropagation())
    card.addEventListener('keydown', (event) => event.stopPropagation())
    this.startButton.type = 'button'
    this.startButton.className = 'start'
    const icon = document.createElement('span')
    icon.className = 'icon'
    icon.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 3; i++) icon.append(document.createElement('i'))
    this.label.className = 'label'
    this.label.textContent = t('video.audio.start')
    this.startButton.append(icon, this.label)
    this.startButton.setAttribute('aria-pressed', 'false')
    this.startButton.title = t('video.audio.model_hint')
    this.listening = new LocalListening(() => {
      if (this.listening.error && this.capture.running) this.capture.stop()
      this.render(this.capture.snapshot)
    }, (original, translation) => {
      this.original.textContent = original
      this.translation.textContent = translation
      this.subtitles.hidden = !original
    })
    this.startButton.addEventListener('click', () => {
      this.refreshIdentity()
      if (this.listening.active || this.capture.running) { this.stop(); this.render(this.capture.snapshot) }
      else if (this.available) {
        this.beforeStart()
        void this.startListening()
      }
    })
    this.subtitles.className = 'subtitles'
    this.subtitles.hidden = true
    this.original.className = 'original'
    this.subtitles.append(this.original, this.translation)
    card.append(this.startButton)
    shadow.append(style, card, this.subtitles)
    this.capture = new PlayerAudioCapture(video, () => mediaIdentity(video), (snapshot) => { this.listening.observe(snapshot, this.capture?.sample ?? null); this.render(snapshot) }, () => this.available && !this.adPlaying(), 3000)
    video.addEventListener('loadstart', this.onMediaChange)
    video.addEventListener('emptied', this.onMediaChange)
    video.addEventListener('seeking', this.onFinishedSeek)
    this.position()
  }

  private async startListening(): Promise<void> {
    try {
      if (!await this.listening.start() || !this.available) return
      this.capture.start()
      this.listening.bind(this.capture.snapshot)
    } catch { this.stop() }
  }

  adPlaying(): boolean { return !!this.video.closest('.ad-showing, .ad-interrupting') }

  refreshIdentity(): void {
    const key = mediaIdentity(this.video)
    if (this.key === key) return
    this.key = key
    this.settledAt = performance.now()
    this.available = false
    this.stop('changed')
  }

  setAvailable(available: boolean): void {
    this.available = available
    if (!available && (this.capture.running || this.listening.active)) this.stop('changed')
    this.position()
  }

  position(): void {
    const rect = this.video.getBoundingClientRect()
    this.host.style.setProperty('--fanfan-caption-size', `${Math.max(12, Math.min(18, rect.width / 40))}px`)
    const full = document.fullscreenElement
    let parent = this.video.parentElement
    // Player controls often live beside the video, outside its immediate wrapper.
    while (parent?.parentElement && parent.parentElement !== document.body) {
      const candidate = parent.parentElement
      const bounds = candidate.getBoundingClientRect()
      if (Math.abs(bounds.width - rect.width) > 24 || Math.abs(bounds.height - rect.height) > 24 || candidate.querySelectorAll('video').length !== 1) break
      parent = candidate
    }
    if (!parent) { this.host.hidden = true; return }
    if (this.container !== parent) {
      this.detachContainer()
      this.container = parent
      if (getComputedStyle(parent).position === 'static') {
        this.restorePosition = parent.style.position
        parent.style.position = 'relative'
      }
      parent.addEventListener('pointermove', this.revealControls)
      parent.addEventListener('pointerdown', this.revealControls)
      parent.addEventListener('pointerleave', this.hideControls)
      parent.append(this.host)
    }
    const base = parent.getBoundingClientRect()
    this.host.hidden = !this.available || rect.width < 240 || rect.height < 100 || rect.bottom <= 0 || rect.top >= innerHeight || (!!full && !full.contains(this.video)) || full === this.video
    Object.assign(this.host.style, { left: `${rect.left - base.left + parent.scrollLeft - parent.clientLeft}px`, top: `${rect.top - base.top + parent.scrollTop - parent.clientTop}px`, width: `${rect.width}px`, height: `${rect.height}px` })

  }

  private detachContainer(): void {
    this.hideControls()
    if (!this.container) return
    this.container.removeEventListener('pointermove', this.revealControls)
    this.container.removeEventListener('pointerdown', this.revealControls)
    this.container.removeEventListener('pointerleave', this.hideControls)
    if (this.restorePosition !== null && this.container.style.position === 'relative') this.container.style.position = this.restorePosition
    this.restorePosition = null
    this.container = null
  }

  private render(snapshot: CaptureSnapshot): void {
    this.host.dataset['timings'] = JSON.stringify(this.listening.timings)
    this.host.dataset['diagnostics'] = JSON.stringify(snapshot)
    this.host.dataset['status'] = snapshot.status
    const running = !!this.capture?.running
    const compactKey = snapshot.status === 'recording' ? 'video.audio.compact_recording'
      : snapshot.status === 'paused' ? 'video.audio.compact_paused'
      : snapshot.status === 'error' ? 'video.audio.compact_error'
      : running ? 'video.audio.compact_waiting' : 'video.audio.start'
    this.label.textContent = this.listening.error ? this.listening.state
      : snapshot.status === 'paused' && this.listening.active ? '听译已暂停'
      : this.listening.active ? (this.capture.running ? 'AI 听译 · 开' : this.listening.state === '正在加载本地模型' ? 'AI 听译 · 加载' : 'AI 听译 · 收尾') : t(compactKey)
    this.startButton.setAttribute('aria-pressed', String(running || this.listening.active))
    this.startButton.setAttribute('aria-label', `${t(STATUS_KEYS[snapshot.status])} · ${t(running || this.listening.active ? 'video.audio.stop' : 'video.audio.start')}`)
    this.startButton.title = this.listening.error || `${this.listening.fallback ? t('video.audio.fallback') + '。' : ''}${t('video.audio.model_hint')}`
    if (this.listening.active && this.listening.fallback) this.label.textContent += ' · Tiny'
  }

  fail(): void { this.capture.stop(); this.listening.fail(new Error(t('video.audio.gpu_lost'))) }
  stop(reason: 'user' | 'changed' = 'user'): void { this.listening.stop(); this.capture.stop(reason) }
  destroy(): void {
    this.video.removeEventListener('loadstart', this.onMediaChange)
    this.video.removeEventListener('emptied', this.onMediaChange)
    this.video.removeEventListener('seeking', this.onFinishedSeek)
    this.stop()
    this.detachContainer()
    this.host.remove()
  }
}

/** Independent of subtitle enable/auto preferences: capture ALWAYS needs its own explicit click. */
export class AudioPrototype {
  private bindings = new Map<HTMLVideoElement, AudioBinding>()
  private timer = 0
  private positionTimer = 0
  private unwatch: (() => void) | null = null
  private active = false
  private destroyed = false
  private readonly onRuntimeMessage = (message: { target?: string }): void => {
    if (message?.target === 'fanfan-listening-stopped') for (const binding of this.bindings.values()) binding.fail()
  }
  private readonly onNavigate = (): void => {
    for (const binding of this.bindings.values()) { binding.setAvailable(false); binding.stop('changed'); binding.settledAt = performance.now() }
  }

  async start(): Promise<void> {
    const settings = await getSettings()
    if (this.destroyed) return
    this.active = settings.videoListeningEnabled && isHostEnabled(settings, location.hostname)
    this.unwatch = watchSettings((next) => {
      this.active = next.videoListeningEnabled && isHostEnabled(next, location.hostname)
      if (!this.active) this.clear()
      else this.scan()
    })
    for (const event of ['popstate', 'yt-navigate-start']) window.addEventListener(event, this.onNavigate)
    this.timer = window.setInterval(() => this.scan(), 1000)
    this.positionTimer = window.setInterval(() => { for (const binding of this.bindings.values()) binding.position() }, 250)
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage)
    this.scan()
  }

  private scan(): void {
    if (!this.active || this.destroyed) return
    for (const [video, binding] of this.bindings) {
      if (!video.isConnected) { binding.destroy(); this.bindings.delete(video) }
      else binding.refreshIdentity()
    }
    for (const video of document.querySelectorAll('video')) {
      if (!this.bindings.has(video) && video.getBoundingClientRect().width >= 240) {
        const binding = new AudioBinding(video, () => {
          for (const other of this.bindings.values()) if (other.video !== video) other.stop()
        })
        this.bindings.set(video, binding)
      }
    }
    for (const binding of this.bindings.values()) void this.probe(binding)
  }

  private async probe(binding: AudioBinding): Promise<void> {
    if (binding.probePending) return
    const video = binding.video
    if (video.readyState < 2 || binding.adPlaying() || hasTextSubtitles(video)) { binding.setAvailable(false); return }
    const identity = mediaIdentity(video)
    if (YOUTUBE.test(location.hostname)) {
      if (location.pathname !== '/watch' || !video.closest('#movie_player')) { binding.setAvailable(false); return }
      binding.probePending = true
      try {
        const data = await callMainWorld<CaptionsData>({ kind: 'captions' })
        if (this.destroyed || !this.active || !video.isConnected || identity !== mediaIdentity(video)) return
        const expected = new URLSearchParams(location.search).get('v')
        binding.setAvailable(!!expected && data.videoId === expected && Array.isArray(data.tracks) && data.tracks.length === 0 && !binding.adPlaying())
      } catch { binding.setAvailable(false) }
      finally { binding.probePending = false }
    } else {
      // Give asynchronously inserted tracks/menus time to appear. A failed track remains a subtitle, not “none”.
      const bili = parseBilibiliUrl(location.href)
      const ready = performance.now() - binding.settledAt >= (bili ? 6000 : 3000)
      const menuHasTracks = !!document.querySelector('.bpx-player-ctrl-subtitle-language-item[data-lan]')
      binding.setAvailable(ready && !(bili && menuHasTracks))
    }
  }

  private clear(): void { for (const binding of this.bindings.values()) binding.destroy(); this.bindings.clear() }
  destroy(): void {
    this.destroyed = true
    this.active = false
    this.unwatch?.()
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage)
    clearInterval(this.timer)
    clearInterval(this.positionTimer)
    for (const event of ['popstate', 'yt-navigate-start']) window.removeEventListener(event, this.onNavigate)
    this.clear()
  }
}
