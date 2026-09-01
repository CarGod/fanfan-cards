import { TRANSLATED_MARK, TRANSLATION_CLASS, directText } from './walker.ts'

/**
 * Watches translated elements and says when their source text changed.
 *
 * This lives on its own because it is the third time the same bug has been
 * reported: a post translated while truncated, then expanded, leaving a
 * half-sentence of Chinese under four more lines of English. It was fixed for
 * whole-page translation and stayed broken for single-paragraph translation,
 * because the mechanism belonged to one translator instead of to translations.
 * A second copy would eventually be a copy without the debounce ceiling.
 *
 * Two rules earned the hard way:
 *
 * 1. **Text nodes count.** Expanding a post usually replaces its text rather
 *    than adding markup, and assigning `textContent` produces a childList record
 *    whose added node is a *text* node. An element-only check sees nothing.
 * 2. **The debounce needs a ceiling.** A feed never goes quiet — timestamps tick
 *    over, images arrive, rows recycle — so a plain debounce is pushed back
 *    forever and the rescan never runs at all.
 */

/** Quiet period a rescan waits for… */
const QUIET_MS = 400
/** …and the longest it will wait for that quiet to arrive. */
const MAX_WAIT_MS = 2000
/** `1`, not `Node.ELEMENT_NODE`: page scripts can overwrite globals. */
const ELEMENT_NODE = 1

export interface WatchedUnit {
  element: Element
  text: string
}

/** True for our own injected nodes, and for anything inside one. */
function isOurs(node: Node): boolean {
  const element = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement
  return Boolean(element?.closest?.(`.${TRANSLATION_CLASS}`))
}

/** Whitespace-insensitive, so a reflow is not mistaken for new content. */
export const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

export class ChangeWatcher {
  private observer: MutationObserver | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private dueAt = 0
  private readonly units = new Set<WatchedUnit>()

  constructor(
    private readonly onChanged: (unit: WatchedUnit) => void,
    /** Runs on every scheduled sweep, for work that is not about one unit. */
    private readonly onTick?: () => void,
  ) {}

  watch(unit: WatchedUnit): void {
    this.units.add(unit)
    this.start()
  }

  /** Starts watching without a unit — for callers that only need the tick. */
  begin(): void {
    this.start()
  }

  forget(element: Element): void {
    for (const unit of this.units) {
      if (unit.element === element) this.units.delete(unit)
    }
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.dueAt = 0
    this.units.clear()
  }

  /** Also runs a sweep now — callers use this after their own DOM edits. */
  check(): void {
    this.onTick?.()
    for (const unit of [...this.units]) {
      if (!unit.element.isConnected) {
        this.units.delete(unit)
        continue
      }
      // A unit waiting for its answer will be filled with the right text;
      // touching it now would strand the in-flight request.
      if (unit.element.getAttribute(TRANSLATED_MARK) === 'pending') continue

      const current = directText(unit.element)
      if (normalise(current) === normalise(unit.text)) continue

      unit.text = current
      this.onChanged(unit)
    }
  }

  private start(): void {
    if (this.observer) return
    this.observer = new MutationObserver((records) => {
      const interesting = records.some((record) => {
        if (isOurs(record.target)) return false
        if (record.type === 'characterData') return true
        return [...record.addedNodes].some((node) => !isOurs(node))
      })
      if (interesting) this.schedule()
    })
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  private schedule(): void {
    if (this.dueAt === 0) this.dueAt = Date.now() + MAX_WAIT_MS
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, Math.min(QUIET_MS, this.dueAt - Date.now()))
    this.timer = setTimeout(() => {
      this.timer = null
      this.dueAt = 0
      this.check()
    }, wait)
  }
}
