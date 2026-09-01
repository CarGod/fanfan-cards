import { sendMessage } from '@/services/messaging.ts'
import {
  TRANSLATED_MARK,
  TRANSLATION_CLASS,
  findUnitAt,
  type TranslationUnit,
} from './walker.ts'
import { clearSlot, createSlot, fillSlot, sourceForSlot } from './slot.ts'
import { LineRetryBudget } from './lineRetry.ts'
import { ChangeWatcher, type WatchedUnit } from './watcher.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'

/**
 * Translate one paragraph, on demand.
 *
 * Whole-page translation answers "I cannot read this page"; this answers the far
 * more common "I can read this page, except that bit". Reading stays in English
 * — which is the entire point of the product — and the translation is a thing
 * you reach for, not a mode you enter.
 *
 * Hold a key, hover, and the paragraph under the cursor is outlined so you can
 * see what you are about to ask for; release or move away and nothing happened.
 * Triggering again on a translated paragraph takes the translation back off, so
 * the gesture is its own undo.
 */

export const HOVER_CLASS = 'ara-paragraph-hover'

/** Keys that can arm the gesture. `off` disables it entirely. */
export type ParagraphTriggerKey = 'off' | 'backtick' | 'alt' | 'ctrl' | 'shift'

export interface ParagraphTranslatorOptions {
  targetLanguage?: () => string
  onError?: (message: string) => void
}

/** True while the configured key is held. */
/**
 * 反引号那个键，按**物理位置**认，不按打出来的字符认。
 *
 * `event.key` 给的是输入法处理之后的结果：中文输入法开着的时候，这个键打出来的是
 * `·`，不是 `` ` ``。只比对反引号字符，等于告诉所有中文用户「这个手势不存在」——
 * 而他们看到的现象是按了没反应，没有任何线索。`event.code` 是键盘上的位置，
 * 与布局和输入法都无关。
 */
function isBacktickKey(event: KeyboardEvent): boolean {
  if (event.code === 'Backquote') return true
  // 有些环境（远程桌面、部分虚拟键盘）不给 code，那就退回认字符，两种都收。
  return event.key === '`' || event.key === '·'
}

function matches(key: ParagraphTriggerKey, event: KeyboardEvent | MouseEvent): boolean {
  switch (key) {
    case 'alt':
      return event.altKey
    case 'ctrl':
      return event.ctrlKey || event.metaKey
    case 'shift':
      return event.shiftKey
    case 'backtick':
      return 'key' in event && isBacktickKey(event)
    default:
      return false
  }
}

/**
 * Typing must never translate a paragraph.
 *
 * Backtick is the default precisely because it collides with no modifier, but
 * that also makes it a character someone might be typing — in a comment box, a
 * search field, or a code editor mounted on the page.
 */
function isTyping(): boolean {
  const active = document.activeElement
  if (!active) return false
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true
  return active instanceof HTMLElement && active.isContentEditable
}

export class ParagraphTranslator {
  private key: ParagraphTriggerKey = 'off'
  private armed = false
  private hovered: TranslationUnit | null = null
  /*
   * 高亮画在谁身上。
   *
   * 通常就是原文自己，但「仅译文」模式下原文是 display:none 的——描一个看不见的
   * 元素等于没描，读者按下键之前不知道自己要翻的是哪一段。那时候描的是译文。
   */
  private outlined: Element | null = null
  private pointer: { x: number; y: number } | null = null
  private readonly inFlight = new WeakSet<Element>()
  /*
   * A paragraph you translated by hand deserves the same honesty as a
   * whole-page one: if it was behind 「显示更多」 and you then expand it, the
   * translation underneath must follow. This was only wired into the page
   * translator, so the gesture translated once and never looked again.
   */
  private readonly watcher = new ChangeWatcher((unit) => void this.retranslate(unit))
  /*
   * 整段翻译是一次一段的手势，没有「一轮」可言——额度用完就不再补救，
   * 直到读者重新按下触发键（`setKey` 会重置）。
   */
  private readonly lineRetries = new LineRetryBudget()
  private readonly options: ParagraphTranslatorOptions
  private bound = false

  constructor(options: ParagraphTranslatorOptions = {}) {
    this.options = options
  }

  setKey(key: ParagraphTriggerKey): void {
    this.key = key
    if (key === 'off') this.disarm()
    if (!this.bound && key !== 'off') this.bind()
    // 重新启用这个手势，就重新给一次补救额度。
    if (key !== 'off') this.lineRetries.reset()
  }

  destroy(): void {
    this.watcher.stop()
    this.disarm()
    if (!this.bound) return
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
    window.removeEventListener('mousemove', this.onMouseMove, true)
    window.removeEventListener('blur', this.onBlur)
    this.bound = false
  }

  private bind(): void {
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    window.addEventListener('mousemove', this.onMouseMove, true)
    window.addEventListener('blur', this.onBlur)
    this.bound = true
  }

  private onMouseMove = (event: MouseEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY }
    if (this.armed) this.updateHover()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.key === 'off' || isTyping()) return
    if (!matches(this.key, event)) return
    if (event.repeat) return
    this.armed = true
    this.updateHover()
    // The paragraph is translated on the key *press*, not on a click: the
    // cursor is already where the reader is looking, so asking them to also
    // click would add a step and risk following a link.
    if (this.hovered) void this.translate(this.hovered)
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.key === 'off') return
    /*
     * A modifier reports itself as *not* held on its own keyup, while backtick
     * reports the key that was released. So the two cases test opposite things,
     * and collapsing them into one condition — as an earlier version did with
     * `matches(...) || !matches(...)` — is a tautology that disarms on every
     * key in the keyboard.
     */
    const released =
      this.key === 'backtick' ? isBacktickKey(event) : !matches(this.key, event)
    if (released) this.disarm()
  }

  private onBlur = (): void => this.disarm()

  private disarm(): void {
    this.armed = false
    this.clearHover()
  }

  private clearHover(): void {
    this.outlined?.classList.remove(HOVER_CLASS)
    this.outlined = null
    this.hovered = null
  }

  private updateHover(): void {
    if (!this.pointer) return
    const under = document.elementFromPoint(this.pointer.x, this.pointer.y)

    /*
     * 悬停在译文上，算作悬停在它的原文上。
     *
     * `findUnitAt` 会把我们自己插入的节点直接判掉，所以不先换成原文的话，
     * 「仅译文」模式下翻完一段就再也悬停不到它——这个手势最要紧的那一半
     * （再按一次收起）就没了。
     */
    const fromSlot = sourceForSlot(under)
    const unit = findUnitAt(fromSlot ?? under, {
      ...(this.options.targetLanguage ? { targetLanguage: this.options.targetLanguage() } : {}),
    })
    if (!unit) {
      this.clearHover()
      return
    }

    // 原文可能是藏着的，那就描它的译文——描一个看不见的元素等于没描。
    const outline = fromSlot
      ? (under?.closest(`.${TRANSLATION_CLASS}`) ?? unit.element)
      : unit.element

    /*
     * 段落没变、但该描的东西变了，也要重画。
     *
     * 只比段落是不够的：鼠标从原文挪到它自己的译文上，段落是同一个，
     * 高亮却应当跟着挪过去。少了这半个判断，高亮会留在原文上——
     * 而仅译文模式下原文是看不见的，读者眼里就是「高亮没了」。
     */
    if (unit.element === this.hovered?.element && outline === this.outlined) return

    this.clearHover()
    this.hovered = unit
    this.outlined = outline
    outline.classList.add(HOVER_CLASS)
  }

  /** The paragraph grew (or changed); replace its translation with a fresh one. */
  private async retranslate(unit: WatchedUnit): Promise<void> {
    clearSlot(unit.element)
    await this.translate(unit)
  }

  private async translate(unit: TranslationUnit): Promise<void> {
    const { element, text } = unit

    // Same gesture, second time: take it back off.
    if (element.getAttribute(TRANSLATED_MARK) === 'done') {
      this.watcher.forget(element)
      clearSlot(element)
      return
    }
    if (this.inFlight.has(element)) return
    this.inFlight.add(element)

    element.setAttribute(TRANSLATED_MARK, 'pending')
    element.after(createSlot(element))
    try {
      const result = await sendMessage('page/translate', {
        texts: [text],
        hint: document.title,
      })
      const outcome = fillSlot(element, text, result.translations[0] ?? '')
      if (outcome !== 'rejected') {
        this.watcher.watch({ element, text })
        // 换行被压平了，逐行重译一次——整段翻译尤其吃这个亏：读者点的就是这一段。
        if (outcome === 'line-shape-lost') await this.lineRetries.retranslate([{ element, text }])
      }
    } catch (error) {
      clearSlot(element)
      // 失联之后每一次悬停都会再报一次同样的错。停掉手势，交给界面提示刷新。
      if (noteOrphanError(error)) {
        this.setKey('off')
        return
      }

      this.options.onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      this.inFlight.delete(element)
    }
  }
}
