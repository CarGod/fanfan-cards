import { t } from '@/i18n/index.ts'
import { sendMessage } from '@/services/messaging.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { isInSourceLanguage } from '@/shared/language.ts'
import { storage } from '@/storage/area.ts'
import { getSettings, watchSettings, isHostEnabled } from '@/storage/repositories/settingsRepo.ts'
import { injectVideoStyles } from './styles.ts'

/**
 * 自己画字幕的播放器：B 站、Vimeo、各家课程平台。
 *
 * 它们的字幕不在 `<track>` 里，是播放器往 DOM 里写的一行字。我们不去猜每家的接口，
 * 只盯着那个位置：文字一变就翻译，把译文贴在它下面。哪个位置由读者点一下告诉我们
 * （或者用内置的预设），记住这个网站，下次自动接上。
 *
 * 用这条路的代价是译文晚半拍——原文出现之后才开始翻。对「看懂正在说什么」够用，
 * 对逐字对齐不够。真正的时间轴翻译只有拿到整条字幕轨才做得到，那是 `<track>` 那条路。
 */

export const LINE_CLASS = 'fanfan-dom-subtitle'
export const PICK_BOX_CLASS = 'fanfan-pick-box'
export const PICK_HINT_CLASS = 'fanfan-pick-hint'
/** 存在 settings 之外：这是每台机器、每个站各自的事，不该跟着配置同步走。 */
export const SELECTORS_KEY = STORAGE_KEYS.videoSubtitleSelectors

/**
 * 认识的站点。选择器指向**稳定的容器**，不是每一行都重建的那个节点。
 *
 * B 站不在这里：它有字幕接口，走 `bilibili.ts` 拿整条轨，比盯 DOM 好得多。
 * 这里留给那些只能盯 DOM 的站。
 */
export const PRESETS: ReadonlyArray<{ host: RegExp; selector: string }> = []

const CHECK_THROTTLE_MS = 120
const LOOKUP_INTERVAL_MS = 1000

const UNSTABLE_CLASS = /\d|active|hover|focus|selected|current|show|hidden|visible|open/i

/**
 * 给读者点中的元素造一个下次还认得出的选择器。
 *
 * 先用 id；没有就往上走几层，每层取标签名加最多两个看起来稳定的类名（带数字、带
 * 状态词的多半是随机生成或随时变的）。每一步都验证一下唯一性，唯一了就停。
 * 实在不唯一，补 `:nth-of-type`。
 */
export function buildSelector(target: Element, root: Document | Element = document): string {
  if (target.id && /^[A-Za-z][\w-]*$/.test(target.id)) return `#${CSS.escape(target.id)}`

  const parts: string[] = []
  let node: Element | null = target
  for (let depth = 0; node && depth < 5 && node !== root; depth += 1) {
    const current: Element = node
    const tag = current.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') break
    const classes = Array.from(current.classList)
      .filter((name) => name.length > 2 && !UNSTABLE_CLASS.test(name))
      .slice(0, 2)
      .map((name) => `.${CSS.escape(name)}`)
      .join('')
    let part = `${tag}${classes}`
    const candidate = [part, ...parts].join(' > ')
    if (root.querySelectorAll(candidate).length === 1) {
      parts.unshift(part)
      return parts.join(' > ')
    }
    const parent: Element | null = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(' > ')
}

/** 匹配这个站的预设。 */
export function presetFor(hostname: string): string | null {
  return PRESETS.find((item) => item.host.test(hostname))?.selector ?? null
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hostParent(): HTMLElement {
  const full = document.fullscreenElement
  if (full instanceof HTMLElement && !(full instanceof HTMLVideoElement)) return full
  return document.documentElement
}

export class DomSubtitleWatcher {
  private selector: string | null = null
  private line: HTMLElement | null = null
  private lineText: HTMLElement | null = null
  private observer: MutationObserver | null = null
  private lookupTimer = 0
  private checkTimer = 0
  private frame = 0
  private lastText = ''
  private shownFor = ''
  private readonly cache = new Map<string, string>()
  private inFlight = new Set<string>()
  private disposers: Array<() => void> = []
  private picking: (() => void) | null = null
  private sourceLanguage = 'en'
  private targetLanguage = 'zh-CN'
  private languageRun = 0

  async start(): Promise<void> {
    const settings = await getSettings()
    if (!settings.enabled || !isHostEnabled(settings, location.hostname)) return
    this.sourceLanguage = settings.videoSubtitleSourceLanguage
    this.targetLanguage = settings.videoSubtitleTargetLanguage
    this.disposers.push(watchSettings((next) => {
      if (this.sourceLanguage === next.videoSubtitleSourceLanguage &&
          this.targetLanguage === next.videoSubtitleTargetLanguage) return
      this.sourceLanguage = next.videoSubtitleSourceLanguage
      this.targetLanguage = next.videoSubtitleTargetLanguage
      this.languageRun += 1
      this.cache.clear()
      this.inFlight.clear()
      this.lastText = ''
      this.hideLine()
      this.check()
    }))
    injectVideoStyles()

    const onPick = (): void => this.startPicking()
    document.addEventListener('fanfan:pick-subtitle', onPick)
    this.disposers.push(() => document.removeEventListener('fanfan:pick-subtitle', onPick))

    const stored = (await storage().get<Record<string, string>>(SELECTORS_KEY).catch(() => undefined)) ?? {}
    const selector = stored[location.hostname] ?? presetFor(location.hostname)
    if (selector) this.watch(selector)
  }

  destroy(): void {
    this.picking?.()
    this.unwatch()
    for (const dispose of this.disposers) dispose()
    this.disposers = []
  }

  /** 盯住一个选择器：元素还没出现就每秒找一次，出现了就跟着 DOM 变化走。 */
  watch(selector: string): void {
    this.unwatch()
    this.selector = selector
    this.observer = new MutationObserver(() => this.scheduleCheck())
    this.observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    this.lookupTimer = window.setInterval(() => this.check(), LOOKUP_INTERVAL_MS)
    this.check()
  }

  private unwatch(): void {
    this.languageRun += 1
    this.inFlight.clear()
    this.selector = null
    this.observer?.disconnect()
    this.observer = null
    if (this.lookupTimer) clearInterval(this.lookupTimer)
    this.lookupTimer = 0
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = 0
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.line?.remove()
    this.line = null
    this.lineText = null
    this.lastText = ''
    this.shownFor = ''
  }

  private scheduleCheck(): void {
    if (this.checkTimer) return
    this.checkTimer = window.setTimeout(() => {
      this.checkTimer = 0
      this.check()
    }, CHECK_THROTTLE_MS)
  }

  private target(): HTMLElement | null {
    if (!this.selector) return null
    try {
      return document.querySelector<HTMLElement>(this.selector)
    } catch {
      return null
    }
  }

  private check(): void {
    const element = this.target()
    const text = element ? normalizeText(element.innerText || element.textContent || '') : ''
    if (text === this.lastText) return
    this.lastText = text
    // 空行，或者这一行不是读者设置的源语言（中文 CC）：不画、不请求。
    if (!text || !isInSourceLanguage([text], this.sourceLanguage)) {
      this.hideLine()
      return
    }
    void this.translate(text)
  }

  private async translate(text: string): Promise<void> {
    const run = this.languageRun
    const cached = this.cache.get(text)
    if (cached !== undefined) {
      if (cached) this.showLine(text, cached)
      else this.hideLine()
      return
    }
    // 原文换了、译文还没到：先把上一句的译文收掉，别让它挂在不相干的句子下面。
    this.hideLine()
    if (this.inFlight.has(text)) return
    this.inFlight.add(text)
    try {
      const { translations } = await sendMessage('page/translate', { texts: [text], hint: document.title, targetLanguage: this.targetLanguage })
      if (run !== this.languageRun) return
      const translation = normalizeText(translations[0] ?? '')
      // 字幕本来就是目标语言时译文和原文一样，记成空串，下次直接不画也不再请求。
      const useful = translation && translation !== text ? translation : ''
      this.cache.set(text, useful)
      // 翻回来的时候字幕已经换行了：那就不画，等它的那一行自己回来。
      if (this.lastText === text && useful) this.showLine(text, useful)
    } catch (error) {
      if (noteOrphanError(error)) this.unwatch()
    } finally {
      if (run === this.languageRun) this.inFlight.delete(text)
    }
  }

  private ensureLine(): HTMLElement {
    if (this.line && this.lineText) return this.lineText
    this.line = document.createElement('div')
    this.line.className = `${LINE_CLASS} notranslate`
    this.line.setAttribute('translate', 'no')
    this.lineText = document.createElement('span')
    this.line.append(this.lineText)
    hostParent().append(this.line)
    return this.lineText
  }

  private showLine(source: string, translation: string): void {
    const node = this.ensureLine()
    node.textContent = translation
    this.shownFor = source
    this.line!.style.display = ''
    this.ensureLoop()
  }

  private hideLine(): void {
    this.shownFor = ''
    if (this.line) this.line.style.display = 'none'
  }

  private ensureLoop(): void {
    if (this.frame) return
    const tick = (): void => {
      this.frame = 0
      if (!this.line || !this.shownFor) return
      this.position()
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  /** 贴在原字幕下面；下面没地方了就贴上面。字号跟原字幕走。 */
  private position(): void {
    const element = this.target()
    const line = this.line
    if (!line) return
    if (!element) {
      line.style.display = 'none'
      return
    }
    const parent = hostParent()
    if (line.parentElement !== parent) parent.append(line)
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      line.style.display = 'none'
      return
    }
    line.style.display = ''
    const base = parent === document.documentElement ? { left: 0, top: 0 } : parent.getBoundingClientRect()
    const fontSize = parseFloat(getComputedStyle(element).fontSize) || 20
    line.style.fontSize = `${fontSize}px`
    line.style.maxWidth = `${Math.max(rect.width, innerWidth * 0.7)}px`
    line.style.left = `${rect.left + rect.width / 2 - base.left}px`
    const lineHeight = line.offsetHeight || fontSize * 1.5
    const below = rect.bottom + 6 + lineHeight <= innerHeight
    line.style.top = `${(below ? rect.bottom + 6 : rect.top - 6 - lineHeight) - base.top}px`
  }

  /**
   * 选字幕区域。
   *
   * 鼠标移到哪就框到哪，点一下定下来，Esc 取消。记住这个站，之后自动接上。
   */
  startPicking(): void {
    this.picking?.()
    const box = document.createElement('div')
    box.className = PICK_BOX_CLASS
    const hint = document.createElement('div')
    hint.className = `${PICK_HINT_CLASS} notranslate`
    hint.textContent = t('video.pick.hint')
    hostParent().append(box, hint)

    let hovered: Element | null = null
    const onMove = (event: MouseEvent): void => {
      box.style.display = 'none'
      const element = document.elementFromPoint(event.clientX, event.clientY)
      box.style.display = ''
      if (!element || element === box || element === hint) return
      hovered = element
      const rect = element.getBoundingClientRect()
      const base = hostParent() === document.documentElement ? { left: 0, top: 0 } : hostParent().getBoundingClientRect()
      box.style.left = `${rect.left - base.left}px`
      box.style.top = `${rect.top - base.top}px`
      box.style.width = `${rect.width}px`
      box.style.height = `${rect.height}px`
    }
    const finish = (): void => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey, true)
      box.remove()
      hint.remove()
      this.picking = null
    }
    const onClick = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      const target = hovered ?? (event.target instanceof Element ? event.target : null)
      finish()
      if (!target) return
      const selector = buildSelector(target)
      void this.remember(selector)
      this.watch(selector)
      this.flash(t('video.pick.saved'))
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      finish()
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey, true)
    this.picking = finish
  }

  private async remember(selector: string): Promise<void> {
    try {
      const stored = (await storage().get<Record<string, string>>(SELECTORS_KEY)) ?? {}
      await storage().set(SELECTORS_KEY, { ...stored, [location.hostname]: selector })
    } catch {
      // 记不住也不影响这一次；下次再点一下就是了。
    }
  }

  private flash(text: string): void {
    const note = document.createElement('div')
    note.className = `${PICK_HINT_CLASS} notranslate`
    note.textContent = text
    hostParent().append(note)
    setTimeout(() => note.remove(), 2600)
  }
}
