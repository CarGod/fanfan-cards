import { sendMessage } from '@/services/messaging.ts'
import { AIError } from '@/types/ai.ts'
import {
  TRANSLATED_MARK,
  TRANSLATION_CLASS,
  batchUnits,
  collectUnits,
  directText,
  type TranslationUnit,
} from './walker.ts'
import { clearAllSlots, clearSlot, createSlot, fillSlot, sweepOrphanSlots } from './slot.ts'

/** Whitespace-insensitive, so a reflow is not mistaken for new content. */
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * True for our own injected nodes, and for anything inside one.
 *
 * `1` rather than `Node.ELEMENT_NODE`: this runs inside someone else's page,
 * where `Node` is a global the page is free to overwrite — and a content script
 * that trusts page globals breaks on exactly the sites that do unusual things.
 * The numeric values are fixed by the DOM spec and cannot be shadowed.
 */
const ELEMENT_NODE = 1

function isOurs(node: Node): boolean {
  const element = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement
  return Boolean(element?.closest?.(`.${TRANSLATION_CLASS}`))
}

/**
 * Bilingual page translation.
 *
 * Three rules shape this file, all learned from read-frog's engine:
 *
 * 1. **Never touch the original.** Translations are appended as siblings marked
 *    `notranslate`. Nothing is replaced, so "turn it off" is a DOM removal, not
 *    an attempt to reconstruct the page from memory.
 * 2. **Order by what the reader is looking at, do not wait for them to get
 *    there.** This used to be gated on an IntersectionObserver, which saved
 *    requests but spent them at the worst moment: you arrive at a paragraph and
 *    only then does its request start, so every screen costs a visible
 *    「翻译中…」. Now everything on the page is queued at once and the queue is
 *    re-sorted by distance from the viewport before each round, so the same
 *    requests happen in a better order — and the concurrency cap, not the
 *    scroll position, is what keeps the burst bounded.
 * 3. **Never block the main thread.** Work is chunked and yields between
 *    batches; a page that stutters while translating feels broken even when the
 *    translation is good.
 */


/**
 * How many requests may be in flight at once.
 *
 * The batch itself was never the bottleneck — a batch is already one model call
 * for up to ten paragraphs. The bottleneck was that `flush` awaited each request
 * before starting the next, so scrolling through a long article translated it
 * one request at a time no matter how fast the provider answered.
 *
 * Three is deliberate rather than "as many as possible": every provider rate
 * limits, and a burst of twenty requests earns a 429 that fails the whole run.
 */
const MAX_CONCURRENT = 3
/** Consecutive failed batches before the run gives up. */
const MAX_FAILURES = 3
/** Quiet period a rescan waits for… */
const RESCAN_QUIET = 400
/** …and the longest it will wait for that quiet to arrive. */
const RESCAN_MAX_WAIT = 2000
/** Per request. Larger batches mean fewer round trips but a longer tail latency. */
const BATCH_LIMITS = { maxUnits: 12, maxChars: 3000 }

export type TranslatorState = 'idle' | 'running'

export interface PageTranslatorOptions {
  onStateChange?: (state: TranslatorState, stats: { done: number; pending: number }) => void
  onError?: (message: string) => void
}

export class PageTranslator {
  private mutations: MutationObserver | null = null
  private rescan: ReturnType<typeof setTimeout> | null = null
  /** When the pending rescan must run at the latest; 0 when none is pending. */
  private rescanDueAt = 0
  private queue: TranslationUnit[] = []
  private flushing = false
  private state: TranslatorState = 'idle'
  private done = 0
  private failures = 0
  /**
   * Every unit we know about, keyed by element.
   *
   * Kept so a rescan can tell "new on the page" from "already handled" without
   * consulting the DOM marks alone — an element can lose our attribute (a
   * framework re-render replacing the node's attributes is common on
   * infinite-scroll sites) while its translation slot is still sitting there.
   */
  private units: TranslationUnit[] = []
  private walkOptions: { range?: 'content' | 'all'; targetLanguage?: string } = {}
  private readonly options: PageTranslatorOptions

  constructor(options: PageTranslatorOptions = {}) {
    this.options = options
  }

  isRunning(): boolean {
    return this.state === 'running'
  }

  toggle(options: { range?: 'content' | 'all'; targetLanguage?: string } = {}): void {
    if (this.state === 'running') this.stop()
    else this.start(options)
  }

  start(options: { range?: 'content' | 'all'; targetLanguage?: string } = {}): void {
    if (this.state === 'running') return
    this.state = 'running'
    this.done = 0
    this.failures = 0
    this.emit()

    this.walkOptions = {
      ...(options.range ? { range: options.range } : {}),
      ...(options.targetLanguage ? { targetLanguage: options.targetLanguage } : {}),
    }
    const units = collectUnits(document.body, this.walkOptions)
    this.units = units

    /*
     * Everything already on the page is queued now, not when it scrolls into
     * view.
     *
     * Viewport gating saved requests, but it spent them at the worst possible
     * moment: the reader arrives at a paragraph and *then* the request starts,
     * so every screen costs a visible 「翻译中…」. Since the queue is ordered by
     * distance from the viewport and only three requests run at a time, eager
     * queueing costs the same requests in a better order — what you are looking
     * at is still translated first, and the rest is ready before you get there.
     */
    for (const unit of units) this.enqueue(unit)
    this.watchForNewContent()
    void this.flush()
  }

  /**
   * Keep translating as the page grows.
   *
   * Infinite-scroll feeds are exactly the pages someone turns this on for, and
   * on those the article you were reading when you pressed the button is a
   * fraction of what you will read. Without this, translation silently stops
   * applying to everything loaded afterwards, which reads as the feature having
   * broken rather than having finished.
   *
   * Debounced because these sites mutate the DOM continuously; rescanning on
   * every mutation would spend more time walking the tree than translating.
   */
  private watchForNewContent(): void {
    this.mutations = new MutationObserver((records) => {
      const worthRescanning = records.some((record) => {
        // Our own insertions and edits must never trigger a rescan, or the
        // observer feeds itself forever.
        if (isOurs(record.target)) return false
        if (record.type === 'characterData') return true
        /*
         * Text nodes count, not just elements.
         *
         * Expanding a post usually replaces its text rather than adding markup,
         * and assigning `textContent` produces a childList record whose added
         * node is a *text* node. An element-only check sees nothing at all —
         * which is precisely how a translation ends up frozen at the truncated
         * version while the English underneath it grew four lines longer.
         */
        return [...record.addedNodes].some((node) => !isOurs(node))
      })
      if (!worthRescanning) return
      this.scheduleRescan()
    })
    /*
     * `characterData` matters as much as `childList` here.
     *
     * A post behind 「显示更多」 is translated while it is still truncated, and
     * expanding it often only replaces the text inside the same element — no
     * nodes added, nothing for a childList-only observer to see. The result is a
     * translation that stops mid-sentence under a paragraph that goes on for
     * another four lines, which reads worse than no translation at all.
     */
    this.mutations.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

  }

  /**
   * Debounce with a ceiling.
   *
   * A plain debounce never fires on a feed that never goes quiet: x.com mutates
   * the DOM continuously — relative timestamps ticking over, images arriving,
   * rows recycling as you scroll — and every one of those pushed the timer back
   * another 400ms. Expanding a post produced a mutation like any other, and the
   * rescan that would have noticed the longer text simply never ran. That is why
   * a translation could sit truncated under four extra lines of English while
   * the mechanism meant to fix it was, in principle, working.
   *
   * So: settle for 400ms of quiet, but never wait more than RESCAN_MAX_WAIT for
   * it.
   */
  private scheduleRescan(): void {
    if (this.rescanDueAt === 0) this.rescanDueAt = Date.now() + RESCAN_MAX_WAIT
    if (this.rescan) clearTimeout(this.rescan)
    const wait = Math.max(0, Math.min(RESCAN_QUIET, this.rescanDueAt - Date.now()))
    this.rescan = setTimeout(() => {
      this.rescan = null
      this.rescanDueAt = 0
      sweepOrphanSlots()
      this.refreshChangedUnits()
      this.absorbNewUnits()
    }, wait)
  }

  /**
   * Re-translate anything whose source text changed under us.
   *
   * The unit list remembers the exact text each translation was made from, so
   * "the paragraph grew" is a string comparison rather than a guess. Whitespace
   * is normalised first: sites re-flow text constantly, and re-translating a
   * paragraph because two spaces became one would be a request per reflow.
   */
  private refreshChangedUnits(): void {
    if (this.state !== 'running') return
    for (const unit of this.units) {
      if (!unit.element.isConnected) continue
      // A unit still waiting for its answer will be filled with the right text;
      // touching it now would strand the in-flight request.
      if (unit.element.getAttribute(TRANSLATED_MARK) === 'pending') continue

      const current = directText(unit.element)
      if (normalise(current) === normalise(unit.text)) continue

      unit.text = current
      clearSlot(unit.element)
      if (current.length >= 2) this.enqueue(unit)
    }
    if (this.queue.length > 0) void this.flush()
  }

  private absorbNewUnits(): void {
    if (this.state !== 'running') return
    const seen = new Set(this.units.map((unit) => unit.element))
    const fresh = collectUnits(document.body, this.walkOptions).filter(
      (unit) => !seen.has(unit.element) && !unit.element.hasAttribute(TRANSLATED_MARK),
    )
    if (fresh.length === 0) return
    this.units = [...this.units, ...fresh]
    for (const unit of fresh) this.enqueue(unit)
    void this.flush()
  }

  stop(): void {
    this.mutations?.disconnect()
    this.mutations = null
    if (this.rescan) clearTimeout(this.rescan)
    this.rescan = null
    this.rescanDueAt = 0
    this.units = []
    this.queue = []
    this.state = 'idle'

    clearAllSlots()
    this.emit()
  }

  private enqueue(unit: TranslationUnit): void {
    if (unit.element.hasAttribute(TRANSLATED_MARK)) return
    // Marked before the request goes out: a second observer callback for the
    // same element must not produce a second translation under it. The visible
    // placeholder waits until the request is actually sent, so a long queue
    // does not litter the page with "翻译中…" lines that sit there for a minute.
    unit.element.setAttribute(TRANSLATED_MARK, 'pending')
    this.queue.push(unit)
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true

    try {
      while (this.queue.length > 0 && this.state === 'running') {
        // Re-sorted every round: if the reader jumps to the end of a long page,
        // the next requests should be for what is now on screen, not for what
        // was on screen when the run started.
        this.sortByDistanceFromViewport()
        const batches: TranslationUnit[][] = []
        while (batches.length < MAX_CONCURRENT && this.queue.length > 0) {
          const [batch] = batchUnits(this.queue.splice(0, BATCH_LIMITS.maxUnits), BATCH_LIMITS)
          if (!batch) break
          batches.push(batch)
        }
        if (batches.length === 0) break
        await Promise.all(batches.map((batch) => this.translateBatch(batch)))
        // Give the page a frame between rounds; a burst of DOM writes on a busy
        // article is exactly when a stutter is most visible.
        await yieldToMain()
      }
    } finally {
      this.flushing = false
    }
  }

  private async translateBatch(batch: TranslationUnit[]): Promise<void> {
    for (const unit of batch) unit.element.after(createSlot(unit.element))

    try {
      const result = await sendMessage('page/translate', {
        texts: batch.map((unit) => unit.text),
        hint: document.title,
      })

      batch.forEach((unit, index) => {
        fillSlot(unit.element, unit.text, result.translations[index] ?? '')
      })
      // Consecutive, not cumulative: a run that keeps succeeding has recovered.
      this.failures = 0
      this.done += batch.length
      this.emit()
    } catch (error) {
      for (const unit of batch) {
        // Leave the original untouched and drop our placeholder: a page full of
        // error text would be worse than a page with nothing added.
        clearSlot(unit.element)
      }
      this.options.onError?.(error instanceof Error ? error.message : String(error))

      /*
       * A failed batch loses that batch, not the whole run.
       *
       * `stop()` here used to tear the run down and remove every translation
       * already on the page — so one transient empty response, after the
       * provider had already answered twenty batches, wiped all of them. The
       * paragraphs whose request failed simply stay untranslated; scrolling
       * back over them queues them again.
       *
       * Two failure kinds still end the run, because continuing would only
       * repeat them: a rejected key, and a run where nothing is getting through.
       */
      const fatal = error instanceof AIError && (error.code === 'auth' || error.code === 'no_api_key')
      this.failures += 1
      if (fatal || this.failures >= MAX_FAILURES) this.stop()
    }
  }

  /**
   * Nearest-first, with what is below the fold slightly favoured over what has
   * already been read past.
   */
  private sortByDistanceFromViewport(): void {
    if (this.queue.length < 2) return
    const distance = new Map<Element, number>()
    for (const unit of this.queue) {
      const top = unit.element.getBoundingClientRect().top
      distance.set(unit.element, top >= 0 ? top : -top * 1.5)
    }
    this.queue.sort(
      (a, b) => (distance.get(a.element) ?? 0) - (distance.get(b.element) ?? 0),
    )
  }

  private emit(): void {
    this.options.onStateChange?.(this.state, { done: this.done, pending: this.queue.length })
  }
}




function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}
