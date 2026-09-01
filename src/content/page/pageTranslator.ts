import { sendMessage } from '@/services/messaging.ts'
import { AIError } from '@/types/ai.ts'
import {
  TRANSLATED_MARK,
  batchUnits,
  collectUnits,
  type TranslationUnit,
} from './walker.ts'
import { clearAllSlots, clearSlot, createSlot, fillSlot, sweepOrphanSlots } from './slot.ts'
import { LineRetryBudget } from './lineRetry.ts'
import { ChangeWatcher } from './watcher.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'



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
/**
 * 并发的出厂值。读者可以在设置里调，但**这里仍然是每一次运行的起点**——
 * 撞到限流之后翻译器会自己往下退，而退让的结果不写回设置：
 * 那是一次网络状况，不是读者改了主意。
 */
const DEFAULT_CONCURRENT = 3
/** Consecutive failed batches before the run gives up. */
const MAX_FAILURES = 3
/**
 * 一轮里最多因为限流重排多少**批**。
 *
 * 按批算而不是按段落算：一批有多少段由内容长短决定（`BATCH_LIMITS`），
 * 拿段落数当上限，等于批一大就只允许重来两次——而那恰恰是最需要重来的时候。
 *
 * 限流可以靠慢下来解决，所以被拒的那批应该重来；但不能无限重来：服务商如果
 * 一直在拒（配额用完、被封），无限重排就是一个安静的死循环，而读者看到的是
 * 进度永远差最后几段。到顶之后按普通失败处理，让它停下来。
 */
const MAX_RATE_LIMIT_REQUEUES = 12
/** Per request. Larger batches mean fewer round trips but a longer tail latency. */
const BATCH_LIMITS = { maxUnits: 12, maxChars: 3000 }

export type TranslatorState = 'idle' | 'running'

export interface PageTranslatorOptions {
  onStateChange?: (state: TranslatorState, stats: { done: number; pending: number }) => void
  onError?: (message: string) => void
}

export class PageTranslator {
  private readonly watcher = new ChangeWatcher(
    (unit) => {
      clearSlot(unit.element)
      if (unit.text.length >= 2) this.enqueue(unit)
      void this.flush()
    },
    () => {
      sweepOrphanSlots()
      this.absorbNewUnits()
    },
  )
  private readonly lineRetries = new LineRetryBudget()
  /** 换行被压平、等着逐行补一次的段落。等主队列排空再处理。 */
  private lineShapeLost: TranslationUnit[] = []
  /**
   * 这一轮**此刻**允许几个请求同时在飞。
   *
   * 从设置读进来，撞到限流就往下减。分成「设置值」和「当前值」两个东西，
   * 是因为它们回答的是不同问题：设置说的是「我愿意跑多快」，
   * 当前值说的是「服务商此刻让我跑多快」。
   */
  private concurrency = DEFAULT_CONCURRENT
  /** 这一轮已经因为限流重排过多少批。 */
  private requeues = 0
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

  start(
    options: {
      range?: 'content' | 'all'
      targetLanguage?: string
      /** 最多几个请求同时在飞。撞到限流会从这个值往下退。 */
      concurrency?: number
    } = {},
  ): void {
    if (this.state === 'running') return
    this.state = 'running'
    this.done = 0
    this.failures = 0
    // 补救额度按「一轮翻译」计：重新开一次整页翻译，就该重新给一次机会。
    this.lineRetries.reset()
    this.lineShapeLost = []
    // 每一轮都从设置值重新起步：上一轮退让到 1，不该拖累这一轮。
    this.concurrency = clampConcurrency(options.concurrency)
    this.requeues = 0
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
  /**
   * One watcher does three jobs on one debounce: notice translated paragraphs
   * whose text changed, sweep placeholders whose source is gone, and pick up
   * content the page loaded after we started.
   */
  private watchForNewContent(): void {
    this.watcher.begin()
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

  /**
   * 停下来，但**不碰页面上已经有的译文**。
   *
   * 和 `stop()` 的区别就在这里：`stop()` 是读者主动点「还原页面」，清干净是他要的；
   * 而扩展更新导致的失联不是他要求的任何事，把他已经读到一半的译文一起抹掉，
   * 只会让一次本可以无感的更新变成一次数据丢失。
   */
  pause(): void {
    this.watcher.stop()
    // 排队中的那些永远等不到译文了，占位符得撤掉，不然页面上留一排「翻译中…」。
    for (const unit of this.queue) clearSlot(unit.element)
    this.queue = []
    this.state = 'idle'
    this.emit()
  }

  stop(): void {
    this.watcher.stop()
    this.units = []
    this.queue = []
    this.lineShapeLost = []
    this.state = 'idle'

    clearAllSlots()
    /*
     * 这里**不碰**显示模式。
     *
     * 它曾经在这里被清掉，理由是「关掉翻译要把页面还原成进来之前的样子」。
     * 但显示模式现在整页和整段共用：关掉整页翻译之后，读者悬停翻译出来的段落
     * 还在页面上，凭什么因为整页停了就把它们的原文放回来。撤干净的时机是
     * 「这个站被禁用」或者内容脚本卸载，那两处都在 App 里。
     */
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
        while (batches.length < this.concurrency && this.queue.length > 0) {
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

      // 主队列空了，限流额度这才轮得到补救用。
      if (this.state === 'running' && this.lineShapeLost.length > 0) {
        const pending = this.lineShapeLost
        this.lineShapeLost = []
        await this.lineRetries.retranslate(pending)
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

      const lost: TranslationUnit[] = []
      batch.forEach((unit, index) => {
        const outcome = fillSlot(unit.element, unit.text, result.translations[index] ?? '')
        if (outcome === 'rejected') return
        this.watcher.watch(unit)
        if (outcome === 'line-shape-lost') lost.push(unit)
      })
      // Consecutive, not cumulative: a run that keeps succeeding has recovered.
      this.failures = 0
      this.done += batch.length
      this.emit()

      /*
       * 换行被压平的那几段先攒着，**不在这里补**。
       *
       * 补救是第二次请求，而这一刻主队列还在跑。就地补等于在限流额度里和
       * 「读者正在等的那一屏」抢——一次 429 废掉的是整轮翻译，换来的只是
       * 几段本来就已经读得懂的译文多了几个换行。攒到队列排空再说。
       */
      if (lost.length > 0) this.lineShapeLost.push(...lost)
    } catch (error) {
      for (const unit of batch) {
        // Leave the original untouched and drop our placeholder: a page full of
        // error text would be worse than a page with nothing added.
        clearSlot(unit.element)
      }
      /*
       * 扩展刚更新过，这个脚本已经和它失联了。再试多少次都是同一个结果，
       * 而每一次都会往控制台扔一条看起来像 bug 的错误。安静地停住，
       * 让界面去说那句唯一有用的话：刷新页面。
       */
      if (noteOrphanError(error)) {
        this.pause()
        return
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
      /*
       * 撞到限流不是失败，是「你太快了」。
       *
       * 把并发砍半（最低 1）继续跑，而**不计入失败次数**——限流是可以靠慢下来
       * 解决的，而按失败处理会让连续三次限流把整轮翻译停掉。既然并发交给了读者，
       * 他把它调到 8 之后撞线是必然的；那时该退让的是我们，不是把他的翻译弄挂。
       */
      if (
        error instanceof AIError &&
        error.code === 'rate_limit' &&
        this.requeues < MAX_RATE_LIMIT_REQUEUES
      ) {
        const next = Math.max(1, Math.floor(this.concurrency / 2))
        if (next !== this.concurrency) {
          this.concurrency = next
          console.warn(`[fanfan] rate limited — 并发降到 ${next}`)
        }

        /*
         * 把这一批放回队列，而不是丢掉。
         *
         * 限流失败和内容失败不是一回事：内容有问题重试多少次都一样，而限流只是
         * 「你太快了」——慢下来再来一次就能成。丢掉它的后果是页面上留下几个
         * 没翻的洞，而且没有任何东西告诉读者那是限流，他只会觉得这个功能不稳。
         *
         * 上面的 catch 已经把槽和标记清掉了，所以这里重排是干净的。
         */
        this.requeues += 1
        for (const unit of batch) this.enqueue(unit)
        return
      }

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

/** 设置值可能来自旧版本或被手改过，收进合法区间再用。 */
function clampConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENT
  return Math.min(8, Math.max(1, Math.floor(value as number)))
}
