import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { AIError, type AIErrorCode, type WordExplanation } from '@/types/ai.ts'
import type { ContentCommand } from '@/types/messages.ts'
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { sendMessage } from '@/services/messaging.ts'
import { getSettings, isHostEnabled, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { getEntry, listEntries, watchEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { clamp, classifySelection, debounce, truncate } from '@/shared/utils.ts'
import {
  isExtensionAlive,
  isOrphaned,
  noteOrphanError,
  onOrphaned,
} from '@/shared/extensionContext.ts'
import { useI18n } from '@/i18n/react.ts'
import { PageTranslator } from '../page/pageTranslator.ts'
import { ParagraphTranslator } from '../page/paragraphTranslator.ts'
import { injectPageStyles, setTranslationMode } from '../page/styles.ts'
import { readSelection, type SelectionSnapshot } from '../dom/selection.ts'
import { isTypingTarget } from '../dom/editable.ts'
import { needsEnriching } from '@/shared/enrichment.ts'
import { placePanel, type AnchorBox, type Placement } from './position.ts'
import { decideSelectionAction } from './selectionTrigger.ts'
import { CardError, CardSkeleton, WordCard, type ExplainMeta } from './WordCard.tsx'
import { SavedWordCard } from './SavedWordCard.tsx'
import { SavedWordHighlighter } from '../highlight/highlighter.ts'
import { BrandMark } from '@/components/icons.tsx'

type Phase =
  | { kind: 'idle' }
  | { kind: 'trigger'; snapshot: SelectionSnapshot }
  | { kind: 'loading'; snapshot: SelectionSnapshot }
  | {
      kind: 'result'
      snapshot: SelectionSnapshot
      explanation: WordExplanation
      meta: ExplainMeta
      saved: VocabularyEntry | null
      /** Phase two is still in flight; the card shows placeholders for it. */
      enriching: boolean
    }
  | { kind: 'error'; snapshot: SelectionSnapshot; code: AIErrorCode; message: string }
  /**
   * 翻翻模式：点了页面上一个标出来的词。
   *
   * 它没有 `snapshot`——因为它不是一次划词：读者没有选中任何东西，
   * 内容也不来自这一次的请求，而是当初收藏时就存好的。所以定位靠的是那个词
   * 自己的矩形，不是选区的。
   */
  | {
      kind: 'saved'
      entry: VocabularyEntry
      rect: DOMRect
      /** 正在把缺的那几项补回来。界面据此显示骨架，而不是干等。 */
      enriching: boolean
      /** 试过了，但一项都没补到。骨架该换成一句说明，而不是凭空消失。 */
      enrichFailed?: boolean
      /**
       * 此刻还在词库里吗。
       *
       * 移出之后卡片不关，所以这个状态和「卡片开着」是两件事：内容还在 `entry` 里，
       * 只是它已经不在库里了，书签跟着变成空心。
       */
      inLibrary: boolean
    }

/**
 * The content-script UI.
 *
 * Design rules this component enforces:
 * - Never act on a selection the user did not finish making (debounced mouseup).
 * - Never cover the sentence being read (placement flips, never overlaps).
 * - Never block the page: one Escape, one outside click, or one scroll away
 *   from a pill and everything is gone.
 */
/**
 * One translator per page, owned outside React: its lifetime is the tab's, not
 * a component's, and it must survive every re-render of the card.
 */
const pageTranslator = new PageTranslator({
  onError: (message) => console.warn('[fanfan] page translation stopped:', message),
})

/**
 * 高亮层同样活在 React 之外。
 *
 * 它的生命周期是这个标签页的：卡片开开关关、组件重渲染多少次，页面上标出来的词
 * 都不该跟着闪一下。
 */
const highlighter = new SavedWordHighlighter()

/**
 * Same lifetime, same reason. Its key comes from settings, so it is told about
 * changes rather than rebuilt — rebuilding would drop the listeners mid-hover.
 */
const paragraphTranslator = new ParagraphTranslator({
  onError: (message) => console.warn('[fanfan] paragraph translation failed:', message),
})

export function App({ host }: { host: HTMLElement }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [orphaned, setOrphaned] = useState(isOrphaned)

  const [dragOffset, setDragOffset] = useState<Offset>(ZERO_OFFSET)
  const requestRef = useRef(0)
  /**
   * 这一次鼠标交互点中的是一个标出来的词。
   *
   * 从 mousedown 一直留到下一次 mousedown：mouseup 上的选区判定和 click 上的
   * 跳转拦截都要看它，而那两者都发生在 mousedown 之后。
   */
  const highlightHitRef = useRef(false)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /*
   * `explain` 的依赖是空数组（它要在整个查询过程里保持同一个身份），
   * 所以闭包里读不到最新的设置。用 ref 把当前值递进去。
   */
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const enabled = isHostEnabled(settings, location.hostname)

  /*
   * 扩展更新之后，这个页面上的脚本就和它失联了——每个开着的标签页都会这样。
   * 它自己什么也做不了，读者也不知道发生了什么，所以唯一有用的事就是把那句
   * 「刷新一下」说出来，并且**不自动消失**：这不是一条操作反馈，是一个待办。
   */
  useEffect(() => onOrphaned(() => setOrphaned(true)), [])
  const notice = orphaned ? t('card.notice.updated') : toast

  useEffect(() => {
    // Disabled on this site means disabled for every gesture, not just the card.
    paragraphTranslator.setKey(enabled ? settings.paragraphTriggerKey : 'off')
  }, [enabled, settings.paragraphTriggerKey])

  /*
   * 翻翻模式。
   *
   * 开关一开就扫一遍当前页，之后词库变了（收了新词、删了词）自动重扫——
   * 读者刚在这一页上收藏了一个词，翻到下一段应该就能看见它被标出来，
   * 而不是等到刷新。
   */
  const fanfanOn = enabled && settings.fanfanMode
  useEffect(() => {
    if (!fanfanOn) {
      highlighter.stop()
      return
    }
    let alive = true
    /*
     * `.catch` 不是可选的。
     *
     * 扩展一重载，这个页面上的脚本就和它失联了，之后每一次 chrome.storage 调用
     * 都会抛。不接住的话，它会变成一条未捕获的 Promise 拒绝，在读者的控制台里
     * 留下一行 `Extension context invalidated`——看起来像插件崩了，
     * 而它其实只是需要刷新一下。`noteOrphanError` 会把这件事接管过去：
     * 认出来、停下来、让界面说那句唯一有用的话。
     */
    void listEntries()
      .then((entries) => {
        if (alive) highlighter.start(entries, { showMastered: settingsRef.current.fanfanShowMastered })
      })
      .catch(noteOrphanError)
    const unwatch = watchEntries((entries) => highlighter.setEntries(entries))
    return () => {
      alive = false
      unwatch()
      highlighter.stop()
    }
  }, [fanfanOn])

  /*
   * 「标不标已掌握的词」单独走一条路，不进上面那个 effect 的依赖。
   *
   * 进去的话，拨一下这个开关会把整个高亮层拆掉重建——重新拉一遍词库、重新装观察器。
   * 它要的只是重新建一次索引再画一次，所以从 `setOptions` 递进去。
   */
  useEffect(() => {
    if (!fanfanOn) return
    highlighter.setOptions({ showMastered: settings.fanfanShowMastered })
  }, [fanfanOn, settings.fanfanShowMastered])

  /*
   * 点一个标出来的词，把那张卡拿出来。
   *
   * 判定放在 **mousedown**，不是 click——这一条是踩出来的。
   *
   * 划词那套逻辑挂在 mouseup 上，会启动一个 140ms 的防抖判定；它醒来时看到
   * 「没有选区、但界面开着」，判定为 dismiss。而卡片是 click 之后异步弹出来的，
   * 正好落在那 140ms 之前——于是卡片弹出来，再被自己人关掉，看起来就是
   * 「点一下闪一下」。mousedown 是唯一早于整套选区机制的时机。
   *
   * 命中之后立起 `highlightHitRef`，让 mouseup 上的选区判定和「点外面收起」
   * 这一次都让开。它一直留到下一次 mousedown 才重置，因为 click 比 mouseup 还晚，
   * 而链接的跳转要在 click 上才拦得住。
   */
  useEffect(() => {
    if (!fanfanOn) {
      highlightHitRef.current = false
      return
    }

    const onMouseDown = (event: MouseEvent): void => {
      if (isOurs(event, host)) return
      const hit = highlighter.hitAt(event.clientX, event.clientY)
      highlightHitRef.current = hit !== null
      if (!hit) return

      // 点一个标出来的词，要的是那张卡，不是选中这个词。
      event.preventDefault()

      void getEntry(hit.entryId)
        .then((entry) => {
          if (!entry) return
          // 「缺不缺」跟着设置走：例句关了就不算缺，整句卡本来也没有例句和近义词。
          const incomplete = needsEnriching(entry, settingsRef.current)
            setPhase({ kind: 'saved', entry, rect: hit.rect, enriching: incomplete, inLibrary: true })
          if (incomplete) void enrich(entry.id)
        })
        // 同上：失联之后这里会抛，接住它才不会变成控制台里那条红字。
        .catch(noteOrphanError)
    }

    /*
     * 拦掉这一次点击本身。
     *
     * 在 mousedown 上 preventDefault **拦不住**链接跳转——在 x.com 上，
     * 一条推文正文外面往往就套着一个 <a>，不拦的话点一个词就被带去别的页面。
     */
    const onClick = (event: MouseEvent): void => {
      if (!highlightHitRef.current || isOurs(event, host)) return
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      highlightHitRef.current = false
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [fanfanOn, host])

  /*
   * 显示模式跟着设置走，且**不需要重新翻译**——它只是一个 CSS 开关。
   * 读者在弹窗里拨一下，已经翻好的内容立刻变；改主意再拨回来，原文还在那儿。
   *
   * 生命周期挂在这里，而不是挂在整页翻译的启停上：整页翻译关掉之后，页面上
   * 可能还留着悬停翻译出来的段落，它们同样守这个模式。清理留给「这个站被禁用」
   * 和卸载——那才是我们真的要从别人 DOM 上撤干净的时刻。
   */
  useEffect(() => {
    setTranslationMode(enabled ? settings.translationMode : 'bilingual')
    return () => setTranslationMode('bilingual')
  }, [enabled, settings.translationMode])

  /*
   * Inject the translation stylesheet once, on mount.
   *
   * This used to be lazy — first keypress, first page-translate — and lazy is
   * how the paragraph gesture shipped with translations that had no styling at
   * all: the Chinese ran straight on from the English with no rail and no
   * spacing, and the two read as one mangled paragraph. One `<style>` element
   * on a page where the extension is already running is not worth an entire
   * class of "the styles were not there yet" bugs.
   */
  useEffect(() => {
    if (enabled) injectPageStyles()
  }, [enabled])

  /*
   * Pick up where the reader left off.
   *
   * Translation is remembered per host, so arriving on another page of a site
   * you already turned it on for should just translate — pressing the button
   * again on every article is not a feature, it is the state having been lost.
   */
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void sendMessage('page/shouldTranslate', {})
      .then((result) => {
        if (cancelled || !result.translating || pageTranslator.isRunning()) return
        injectPageStyles()
        pageTranslator.start({
          range: settings.pageTranslationRange,
          targetLanguage: settings.targetLanguage,
          concurrency: settings.pageTranslationConcurrency,
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, settings.pageTranslationRange, settings.targetLanguage, settings.pageTranslationConcurrency])
  const languages = useMemo(
    () => ({ source: settings.sourceLanguage, target: settings.targetLanguage }),
    [settings.sourceLanguage, settings.targetLanguage],
  )

  useEffect(() => {
    // 失联之后这里会抛。接住它，让 noteOrphanError 去说那句「刷新页面」。
    void getSettings().then(setSettings).catch(noteOrphanError)
    return watchSettings(setSettings)
  }, [])

  /*
   * 把词卡上缺的那几项补回来。
   *
   * 缺是怎么来的：查询分两段发出去，例句、整句翻译、近义词属于第二段。读者手快，
   * 在第二段回来之前就按了收藏——存下的就是一张只有释义的卡。
   *
   * 这一条和翻翻模式「不调 AI、秒开」的原则有张力，所以限制得很死：只在**确实缺**
   * 的时候发，只补缺的那几项，而且**一次会话里同一张卡只试一次**。补不上（模型没给、
   * 或者用的是离线词典）就把状态收掉，让界面说清楚，而不是每点一次就再花一次钱。
   */
  const enrichedRef = useRef(new Set<string>())
  const enrich = useCallback(async (id: string) => {
    if (enrichedRef.current.has(id)) {
      setPhase((prev) => (prev.kind === 'saved' ? { ...prev, enriching: false } : prev))
      return
    }
    enrichedRef.current.add(id)
    try {
      const result = await sendMessage('vocab/enrich', { id })
      setPhase((prev) =>
        prev.kind === 'saved' && prev.entry.id === id
          ? {
              ...prev,
              entry: result.entry ?? prev.entry,
              enriching: false,
              /*
               * 一项都没补到，就把这件事说出来。
               *
               * `filled` 这个字段本来就是为这一刻设计的（见 messages.ts 的注释），
               * 但之前没人读它：骨架转几秒然后凭空消失，卡片和点开前一模一样，
               * 读者既不知道刚刚发生过一次调用，也不知道是补不了还是自己点错了。
               */
              enrichFailed: (result.filled?.length ?? 0) === 0,
            }
          : prev,
      )
    } catch (error) {
      /*
       * 失败的这一次**没花钱**，所以要把这张卡放回去，下次点开还能再试。
       *
       * 之前是 id 一律留在 Set 里：一次 429、一次网络断开，就把这张卡在整个页面
       * 会话里烧掉了——读者点多少次都没反应，而这次请求根本没到模型，一分钱没花。
       * 判断正好反了：白花钱的那次（filled 为空）该被记住，没花钱的那次不该。
       */
      enrichedRef.current.delete(id)
      noteOrphanError(error)
      setPhase((prev) =>
        prev.kind === 'saved' && prev.entry.id === id
          ? { ...prev, enriching: false, enrichFailed: true }
          : prev,
      )
    }
  }, [])

  /*
   * 从翻翻模式的卡片上取消收藏。
   *
   * 移出之后这张卡就没有内容可显示了（它整个是从词库里读出来的），所以直接收起来。
   * 页面上那处高亮会自己消失——词库一变，高亮层就重新扫一遍。
   */
  const unsaveHighlighted = useCallback(async (id: string) => {
    try {
      await sendMessage('vocab/remove', { id })
      setPhase((prev) =>
        prev.kind === 'saved' && prev.entry.id === id ? { ...prev, inLibrary: false } : prev,
      )
    } catch (error) {
      noteOrphanError(error)
    }
  }, [])

  /*
   * 把刚移出去的那个词收回来。
   *
   * `removeEntry` 是软删除（留墓碑），而 `saveEntry` 遇到墓碑会**复活**它——
   * 复习进度、收藏时间、来源那一句全都还在。所以这不是「重新收藏一个新词」，
   * 是真的撤销。
   */
  const resaveHighlighted = useCallback(async (entry: VocabularyEntry) => {
    try {
      await sendMessage('vocab/save', {
        selection: entry.word,
        explanation: explanationFromEntry(entry),
        source: {
          url: entry.source?.url ?? '',
          title: entry.source?.title ?? '',
          context: entry.source?.context ?? '',
          wideContext: entry.source?.wideContext ?? '',
        },
        origin: entry.origin,
      })
      setPhase((prev) =>
        prev.kind === 'saved' && prev.entry.id === entry.id ? { ...prev, inLibrary: true } : prev,
      )
    } catch (error) {
      noteOrphanError(error)
    }
  }, [])

  const dismiss = useCallback(() => {
    requestRef.current++
    setPhase({ kind: 'idle' })
  }, [])

  // A dragged position belongs to the word it was dragged for. Keeping it for
  // the next lookup would park the card far away from the new selection.
  useEffect(() => {
    setDragOffset(ZERO_OFFSET)
    // 「这次是为哪一个词摆的位置」——划词看选区，翻翻模式看被点的那个词。
  }, [phase.kind === 'idle' ? null : phase.kind === 'saved' ? phase.entry.id : phase.snapshot])

  /**
   * 两段式查询，**两段一起发**。
   *
   * 这里的耗时是输出长度，不是网络：整张卡十一个字段、几百个中文 token，
   * 在快模型上也要好几秒。所以拆成两次请求——先要读者正在等的那一半
   * （这个词在这儿是什么意思），画出来；例句、整句翻译、近义词随后补进卡片。
   *
   * 关键在于第二段是**和第一段同时发出去的**，不是等第一段回来再发。
   * 两次请求用的是同一份输入，只差一个 `detail` 字段，彼此没有任何依赖——
   * 串行等于把两次输出的时间加起来，而读者感受到的是「解释出来了，
   * 例句还要再等一轮」。并发之后总时长是两者中较慢的那个。
   *
   * 代价是要在第一段回来**之前**就决定该不该发第二段，而这个决定有两个前提：
   *
   * - 句子不需要例句和近义词，卡片上根本不显示。用本地的 `classifySelection`
   *   提前判断，判错了就浪费一次请求——所以宁可保守：拿不准时不发。
   * - 离线词典一次就答完，没有第二段可言。
   */
  const explain = useCallback(
    async (
      snapshot: SelectionSnapshot,
      options: { forceOffline?: boolean; refresh?: boolean } = {},
    ) => {
      const requestId = ++requestRef.current
      setPhase({ kind: 'loading', snapshot })

      const base = {
        text: snapshot.text,
        context: snapshot.context.sentence,
        wideContext: snapshot.context.block,
        pageTitle: snapshot.context.pageTitle,
        pageUrl: snapshot.context.pageUrl,
        ...(options.forceOffline ? { forceOffline: true as const } : {}),
        ...(options.refresh ? { refresh: true as const } : {}),
      }

      /*
       * 该不该同时去要例句和近义词。
       *
       * 只在能提前确定的两种情况下放弃：本地已经判定这是个句子，或者用的是
       * 离线词典。其余一律并发——多花一次请求换掉一整轮等待，是划算的；
       * 而真判错了（模型说这是句子），下面会把结果丢掉，读者看不到任何异常。
       */
      const wantsExtras =
        !options.forceOffline &&
        settingsRef.current.provider !== 'mock' &&
        classifySelection(snapshot.text) !== 'sentence'

      /*
       * 两个请求一起出发。
       *
       * `catch` 必须**当场**挂上：core 先抛错时，一个没人接的 extras 拒绝
       * 会变成未捕获的 Promise 异常，在页面控制台里刷一条和读者无关的红字。
       */
      const extrasRequest = wantsExtras
        ? sendMessage('ai/explain', { ...base, detail: 'extras' }).catch(() => null)
        : null

      try {
        const core = await sendMessage('ai/explain', { ...base, detail: 'core' })
        if (requestId !== requestRef.current) return

        const existing = await sendMessage('vocab/lookup', {
          words: [snapshot.text, core.explanation.word, core.explanation.lemma],
        })
        if (requestId !== requestRef.current) return

        setPhase({
          kind: 'result',
          snapshot,
          explanation: core.explanation,
          meta: {
            providerId: core.providerId,
            model: core.model,
            offline: core.offline,
            cached: core.cached,
            downgradeReason: core.downgradeReason,
          },
          saved: existing.entry,
          /*
           * 是不是真的还有东西在路上。
           *
           * 三个条件缺一不可：确实发了第二段，模型没把它判成句子，也不是离线词典。
           * 判错了就说明这次并发白发了——那就当没发过，占位骨架不该亮起来，
           * 否则读者会一直等一个永远不会到的东西。
           */
          enriching:
            extrasRequest !== null && !core.offline && core.explanation.kind !== 'sentence',
        })

        // 本地判成词、模型判成句子：那一次并发白发了，结果丢掉。
        if (!extrasRequest || core.offline || core.explanation.kind === 'sentence') return

        const extras = await extrasRequest
        if (requestId !== requestRef.current) return
        if (!extras) {
          // 补充失败了。核心答案已经在屏幕上，那才是要紧的那一半——
          // 不能因为例句没来就把它换成一张报错卡。
          setPhase((prev) => (prev.kind === 'result' ? { ...prev, enriching: false } : prev))
          return
        }
        /*
         * 第二段回来时如果这个词已经被收藏了，**要写回词卡**。
         *
         * 这正是读者报的那个问题的根子：他手快，在第二段回来之前按了收藏——
         * 存下的就是一张只有释义的卡。而第二段其实几秒后就到了，代码却只把它
         * 更新到屏幕上那张卡上，没有落盘。于是那张卡从此永远缺着，
         * 直到某次点开时再花一次钱去要同一份内容。
         *
         * 补全那条路留着，但它从此只是兜底：真正该做的是**第一时间就别弄丢**。
         */
        const current = phaseRef.current
        if (current.kind === 'result' && current.saved) {
          void sendMessage('vocab/save', {
            selection: current.snapshot.text,
            explanation: { ...current.explanation, ...extras.explanation },
            source: {
              url: current.snapshot.context.pageUrl,
              title: current.snapshot.context.pageTitle,
              context: current.snapshot.context.sentence,
              wideContext: current.snapshot.context.block,
            },
            origin: {
              providerId: current.meta.providerId,
              model: current.meta.model,
              offline: current.meta.offline,
            },
          }).catch(noteOrphanError)
        }

        setPhase((prev) =>
          prev.kind === 'result'
            ? {
                ...prev,
                explanation: {
                  ...prev.explanation,
                  sentenceTranslation: extras.explanation.sentenceTranslation,
                  examples: extras.explanation.examples,
                  synonyms: extras.explanation.synonyms,
                },
                enriching: false,
              }
            : prev,
        )
      } catch (error) {
        if (requestId !== requestRef.current) return
        const code = error instanceof AIError ? error.code : 'unknown'
        setPhase({
          kind: 'error',
          snapshot,
          code,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [],
  )

  // --- selection listening -------------------------------------------------

  useEffect(() => {
    if (!enabled) return

    // Debounced so a drag-select does not fire on every intermediate mouseup.
    // NOTE: `fromOwnUi` is resolved by the caller *synchronously* — see
    // `decideSelectionAction` for why doing it in here silently breaks.
    const resolveSelection = debounce((altKey: boolean) => {
      const snapshot = readSelection(settings.maxSelectionLength, languages)
      const visible = phaseRef.current
      const action = decideSelectionAction({
        fromOwnUi: false,
        hasSelection: snapshot !== null,
        altKey,
        triggerMode: settings.triggerMode,
        uiVisible: visible.kind !== 'idle',
        sameSelectionAsVisible:
          visible.kind !== 'idle' &&
          visible.kind !== 'saved' &&
          snapshot !== null &&
          visible.snapshot.text === snapshot.text,
      })

      if (action === 'dismiss') setPhase({ kind: 'idle' })
      if (!snapshot) return
      if (action === 'explain') void explain(snapshot)
      if (action === 'showTrigger') setPhase({ kind: 'trigger', snapshot })
    }, 140)

    const handleSelection = (event: MouseEvent) => {
      // Must run while the event is still dispatching: `composedPath()` is
      // empty afterwards, so this check cannot be deferred into the debounce.
      if (isOurs(event, host)) return
      /*
       * 这一下点的是翻翻模式标出来的词，不是在划词。
       *
       * 不让开的话，这里的防抖判定会在 140ms 后醒来，看到「没有选区、界面却开着」，
       * 于是把刚弹出来的卡片关掉——表现成「点一下闪一下」。
       */
      if (highlightHitRef.current) return
      resolveSelection(event.altKey)
    }

    const onMouseDown = (event: MouseEvent) => {
      if (isOurs(event, host)) return
      /*
       * 点中标出来的词不算「点外面」——这一条是**省一帧闪烁**，不是正确性。
       *
       * 两个 mousedown 监听器都挂在 document 的捕获阶段，谁先跑取决于注册顺序，
       * 而注册顺序会随 effect 重跑而变，所以这个 ref 在这里不保证是新的。
       * 好在不新也不出错：卡片是在 getEntry 回来之后异步设的，无论如何都晚于
       * 这两个同步处理器。这里读到旧值最坏就是先关一下再开，闪一帧。
       *
       * 真正非拦不可的是 mouseup 上那个 140ms 的选区判定——它比卡片晚，
       * 而 mousedown 一定早于 mouseup，那里的 ref 一定是新的。
       */
      if (highlightHitRef.current) return
      if (phaseRef.current.kind !== 'idle') setPhase({ kind: 'idle' })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phaseRef.current.kind !== 'idle') dismiss()

      /*
       * 回车直接解释，不用去够鼠标。
       *
       * 只在小按钮亮着的时候接管回车——那一刻读者刚划完词、手还在键盘上，
       * 而页面上没有任何别的东西在等这个回车。其它时候一概不碰：
       * 在输入框里按回车是换行或提交，抢过来就是在坏别人的页面。
       */
      if (event.key !== 'Enter' || event.isComposing) return
      const visible = phaseRef.current
      if (visible.kind !== 'trigger') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      void explain(visible.snapshot)
    }

    // A stale anchor is worse than no pill; the card keeps its position because
    // the user put it there deliberately.
    const onScroll = () => {
      if (phaseRef.current.kind === 'trigger') setPhase({ kind: 'idle' })
    }

    document.addEventListener('mouseup', handleSelection, true)
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })

    return () => {
      resolveSelection.cancel()
      document.removeEventListener('mouseup', handleSelection, true)
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [enabled, settings.maxSelectionLength, settings.triggerMode, languages, host, explain, dismiss])

  // Context menu / keyboard shortcut arriving from the background worker.
  useEffect(() => {
    const listener = (raw: unknown) => {
      const command = raw as ContentCommand | undefined
      if (command?.type === 'content/explain-selection') {
        const snapshot = readSelection(settings.maxSelectionLength, languages)
        if (snapshot) void explain(snapshot)
      }
      if (command?.type === 'content/dismiss') dismiss()
      if (command?.type === 'content/toggle-page-translation') {
        injectPageStyles()
        pageTranslator.toggle({
          range: settings.pageTranslationRange,
          targetLanguage: settings.targetLanguage,
        })
        const running = pageTranslator.isRunning()
        setToast(running ? t('card.toast.translating_page') : t('card.toast.restored'))
        // Tell the worker, so the popup button can say "还原" instead of
        // offering to translate a page that is already translated.
        void sendMessage('page/state', { translating: running }).catch(() => undefined)
      }
    }
    if (!isExtensionAlive() || !chrome.runtime?.onMessage) return
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      if (chrome.runtime?.onMessage) chrome.runtime.onMessage.removeListener(listener)
    }
  }, [
    settings.maxSelectionLength,
    settings.pageTranslationRange,
    settings.targetLanguage,
    languages,
    explain,
    dismiss,
    t,
  ])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(timer)
  }, [toast])

  // Our users often run another selection/translation extension, and everyone
  // in this category claims z-index 2147483647. At equal z-index the last
  // element in the document wins, so re-append the host whenever we show
  // something. Moving a node preserves its shadow root and React tree.
  useEffect(() => {
    if (phase.kind === 'idle') return
    if (host.parentElement !== document.documentElement || host.nextElementSibling !== null) {
      document.documentElement.appendChild(host)
    }
  }, [phase.kind, host])

  // --- actions -------------------------------------------------------------

  const save = useCallback(async () => {
    if (phase.kind !== 'result' || saving) return
    setSaving(true)
    try {
      const { entry, created } = await sendMessage('vocab/save', {
        selection: phase.snapshot.text,
        explanation: phase.explanation,
        source: {
          url: phase.snapshot.context.pageUrl,
          title: phase.snapshot.context.pageTitle,
          context: phase.snapshot.context.sentence,
          wideContext: phase.snapshot.context.block,
        },
        origin: {
          providerId: phase.meta.providerId,
          model: phase.meta.model,
          offline: phase.meta.offline,
        },
      })
      setPhase({ ...phase, saved: entry })
      setToast(created ? t('card.toast.saved') : t('card.toast.updated'))
    } catch (error) {
      setToast(
        error instanceof Error
          ? t('card.toast.save_failed_reason', { reason: truncate(error.message, 60) })
          : t('card.toast.save_failed'),
      )
    } finally {
      setSaving(false)
    }
  }, [phase, saving, t])

  const remove = useCallback(async () => {
    if (phase.kind !== 'result' || !phase.saved) return
    const { removed } = await sendMessage('vocab/remove', { id: phase.saved.id })
    if (removed) {
      setPhase({ ...phase, saved: null })
      setToast(t('card.toast.removed'))
    }
  }, [phase, t])


  const openSettings = useCallback(() => {
    void sendMessage('options/open', {})
  }, [])

  // --- render --------------------------------------------------------------

  // Memoised so the measure effect below only re-runs when the anchor really
  // moves, not on every state change.
  const anchorRect =
    phase.kind === 'idle' ? null : phase.kind === 'saved' ? phase.rect : phase.snapshot.rect
  const anchor = useMemo<AnchorBox>(
    () =>
      anchorRect
        ? { top: anchorRect.top, bottom: anchorRect.bottom, left: anchorRect.left, right: anchorRect.right }
        : { top: 0, bottom: 0, left: 0, right: 0 },
    [anchorRect],
  )

  if (!enabled || phase.kind === 'idle') {
    return notice ? <Toast text={notice} /> : null
  }

  return (
    <>
      <FloatingLayer
        anchor={anchor}
        measureKey={phase.kind}
        offset={dragOffset}
        onDrag={setDragOffset}
      >
        {phase.kind === 'trigger' ? (
          <button
            className="trigger"
            // Keep the page selection highlighted while the card is open:
            // a default mousedown would collapse it the moment we are clicked.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void explain(phase.snapshot)}
          >
            <BrandMark size={16} className="mark" />
            <span>{truncate(phase.snapshot.text, 18)}</span>
            <span className="hint">{t('card.trigger.explain')}</span>
            {/*
              回车键提示。
              选完词手还在键盘上，去够鼠标点这个小按钮是最别扭的一段。标出来是因为
              「能按回车」这件事不写出来没人会去试——而试出来之后，这个手势就再也
              不用鼠标了。
            */}
            <kbd className="trigger-key">↵</kbd>
          </button>
        ) : null}

        {phase.kind === 'loading' ? (
          <CardSkeleton word={truncate(phase.snapshot.text, 28)} onClose={dismiss} />
        ) : null}

        {phase.kind === 'result' ? (
          <WordCard
            selection={phase.snapshot.text}
            sentence={phase.snapshot.context.sentence}
            explanation={phase.explanation}
            meta={phase.meta}
            savedEntry={phase.saved}
            saving={saving}
            enriching={phase.enriching}
            showEnglishDefinition={settings.showEnglishDefinition}
            autoSpeak={settings.autoSpeak}
            onSave={() => void save()}
            onRemove={() => void remove()}
            onClose={dismiss}
          />
        ) : null}

        {phase.kind === 'error' ? (
          <CardError
            word={truncate(phase.snapshot.text, 28)}
            code={phase.code}
            message={phase.message}
            onRetry={() => void explain(phase.snapshot, { refresh: true })}
            onOffline={() => void explain(phase.snapshot, { forceOffline: true })}
            onOpenSettings={openSettings}
            onClose={dismiss}
          />
        ) : null}

        {phase.kind === 'saved' ? (
          <SavedWordCard
            entry={phase.entry}
            enriching={phase.enriching}
            enrichFailed={phase.enrichFailed ?? false}
            inLibrary={phase.inLibrary}
            onSave={() => void resaveHighlighted(phase.entry)}
            onRemove={() => void unsaveHighlighted(phase.entry.id)}
            onClose={dismiss}
          />
        ) : null}
      </FloatingLayer>
      {notice ? <Toast text={notice} /> : null}
    </>
  )
}

function Toast({ text }: { text: string }) {
  return (
    <div className="toast" style={{ right: '20px', bottom: '20px' }} role="status">
      {text}
    </div>
  )
}

/**
 * Renders children off-screen for one frame to measure them, then positions.
 * Measuring beats guessing: card height varies with how much the model wrote.
 */
interface Offset {
  dx: number
  dy: number
}

const ZERO_OFFSET: Offset = { dx: 0, dy: 0 }

function FloatingLayer({
  anchor,
  measureKey,
  offset,
  onDrag,
  children,
}: {
  anchor: AnchorBox
  measureKey: string
  offset: Offset
  onDrag: (next: Offset) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Placement | null>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  /**
   * Drag by the card header.
   *
   * Automatic placement is right most of the time and wrong exactly when it
   * matters — when the card lands on the very paragraph the user is trying to
   * read. Rather than guess better, let them move it.
   *
   * Listeners go on `window` (not the element) so the drag survives the pointer
   * leaving the card, and `setPointerCapture` is avoided because the pointer
   * events would then bypass the host page's own handlers inconsistently.
   */
  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      // Only the header is a handle, and never its buttons.
      if (!target?.closest('.card-head') || target.closest('button')) return

      event.preventDefault()
      const originX = event.clientX
      const originY = event.clientY
      const base = offsetRef.current

      const move = (moveEvent: PointerEvent) => {
        onDrag({
          dx: base.dx + moveEvent.clientX - originX,
          dy: base.dy + moveEvent.clientY - originY,
        })
      }
      const stop = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    },
    [onDrag],
  )

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const next = placePanel(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPlace((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight
        ? prev
        : next,
    )
  }, [anchor])

  useLayoutEffect(() => {
    measure()
  }, [measure, measureKey])

  /**
   * Placement and card height depend on each other: the height cap comes from
   * the placement, and the placement's flip decision comes from the height. One
   * pass therefore settles on stale numbers — visibly so when the card is
   * flipped above a selection and then grows downwards over it. Observing the
   * real size closes the loop; `placePanel` is pure and idempotent, so this
   * converges after one extra frame instead of oscillating.
   */
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  // Keep a dragged card reachable: it may hang off the edge, but never so far
  // that its header — the only way to drag it back — is off screen.
  const size = ref.current?.getBoundingClientRect()
  const top = clamp(
    (place?.top ?? 0) + offset.dy,
    8 - (size ? size.height - 40 : 0),
    Math.max(8, window.innerHeight - 40),
  )
  const left = clamp(
    (place?.left ?? 0) + offset.dx,
    8 - (size ? size.width - 60 : 0),
    Math.max(8, window.innerWidth - 60),
  )

  return (
    <div
      ref={ref}
      className="layer"
      onPointerDown={startDrag}
      style={
        {
          top: `${top}px`,
          left: `${left}px`,
          visibility: place ? 'visible' : 'hidden',
          // Consumed by `.card`; lets the card grow into whatever room the
          // placement found instead of stopping at a fixed cap.
          '--ara-card-max': place ? `${place.maxHeight}px` : undefined,
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
}

/**
 * 从词卡还原出一份 explanation。
 *
 * 「收回去」走的是和收藏同一条路（`vocab/save`），而那条路要的是模型的输出格式。
 * 词卡上存的本来就是那份输出拆开之后的样子，拼回去即可——只有 `contextMeaning`
 * 在词卡里叫 `aiExplanation`，那是存储层当初起的名字。
 */
function explanationFromEntry(entry: VocabularyEntry): WordExplanation {
  return {
    word: entry.word,
    lemma: entry.lemma,
    kind: entry.kind,
    phonetic: entry.phonetic,
    partOfSpeech: entry.partOfSpeech,
    cefr: entry.cefr,
    meaning: entry.meaning,
    senses: entry.senses ?? [],
    contextMeaning: entry.aiExplanation,
    englishDefinition: entry.englishDefinition,
    sentenceTranslation: entry.sentenceTranslation,
    examples: entry.examples ?? [],
    synonyms: entry.synonyms ?? [],
  }
}

/** True when the event originated inside our shadow UI. */
function isOurs(event: Event, host: HTMLElement): boolean {
  return event.composedPath().includes(host)
}
