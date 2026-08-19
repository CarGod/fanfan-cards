import { sendMessage } from '@/services/messaging.ts'
import { TRANSLATED_MARK, findUnitAt, type TranslationUnit } from './walker.ts'
import { clearSlot, createSlot, fillSlot } from './slot.ts'

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
function matches(key: ParagraphTriggerKey, event: KeyboardEvent | MouseEvent): boolean {
  switch (key) {
    case 'alt':
      return event.altKey
    case 'ctrl':
      return event.ctrlKey || event.metaKey
    case 'shift':
      return event.shiftKey
    case 'backtick':
      return 'key' in event && event.key === '`'
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
  private pointer: { x: number; y: number } | null = null
  private readonly inFlight = new WeakSet<Element>()
  private readonly options: ParagraphTranslatorOptions
  private bound = false

  constructor(options: ParagraphTranslatorOptions = {}) {
    this.options = options
  }

  setKey(key: ParagraphTriggerKey): void {
    this.key = key
    if (key === 'off') this.disarm()
    if (!this.bound && key !== 'off') this.bind()
  }

  destroy(): void {
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
      this.key === 'backtick' ? event.key === '`' : !matches(this.key, event)
    if (released) this.disarm()
  }

  private onBlur = (): void => this.disarm()

  private disarm(): void {
    this.armed = false
    this.clearHover()
  }

  private clearHover(): void {
    if (this.hovered) this.hovered.element.classList.remove(HOVER_CLASS)
    this.hovered = null
  }

  private updateHover(): void {
    if (!this.pointer) return
    const element = document.elementFromPoint(this.pointer.x, this.pointer.y)
    const unit = findUnitAt(element, {
      ...(this.options.targetLanguage ? { targetLanguage: this.options.targetLanguage() } : {}),
    })
    if (unit?.element === this.hovered?.element) return
    this.clearHover()
    if (!unit) return
    this.hovered = unit
    unit.element.classList.add(HOVER_CLASS)
  }

  private async translate(unit: TranslationUnit): Promise<void> {
    const { element, text } = unit

    // Same gesture, second time: take it back off.
    if (element.getAttribute(TRANSLATED_MARK) === 'done') {
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
      fillSlot(element, text, result.translations[0] ?? '')
    } catch (error) {
      clearSlot(element)
      this.options.onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      this.inFlight.delete(element)
    }
  }
}
