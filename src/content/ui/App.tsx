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
import { clamp, debounce, truncate } from '@/shared/utils.ts'
import { isExtensionAlive, isOrphaned, onOrphaned } from '@/shared/extensionContext.ts'
import { PageTranslator } from '../page/pageTranslator.ts'
import { ParagraphTranslator } from '../page/paragraphTranslator.ts'
import { injectPageStyles } from '../page/styles.ts'
import { readSelection, type SelectionSnapshot } from '../dom/selection.ts'
import { placePanel, type AnchorBox, type Placement } from './position.ts'
import { decideSelectionAction } from './selectionTrigger.ts'
import { CardError, CardSkeleton, WordCard, type ExplainMeta } from './WordCard.tsx'
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
 * Same lifetime, same reason. Its key comes from settings, so it is told about
 * changes rather than rebuilt — rebuilding would drop the listeners mid-hover.
 */
const paragraphTranslator = new ParagraphTranslator({
  onError: (message) => console.warn('[fanfan] paragraph translation failed:', message),
})

export function App({ host }: { host: HTMLElement }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [orphaned, setOrphaned] = useState(isOrphaned)

  const [dragOffset, setDragOffset] = useState<Offset>(ZERO_OFFSET)
  const requestRef = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const enabled = isHostEnabled(settings, location.hostname)

  /*
   * 扩展更新之后，这个页面上的脚本就和它失联了——每个开着的标签页都会这样。
   * 它自己什么也做不了，读者也不知道发生了什么，所以唯一有用的事就是把那句
   * 「刷新一下」说出来，并且**不自动消失**：这不是一条操作反馈，是一个待办。
   */
  useEffect(() => onOrphaned(() => setOrphaned(true)), [])
  const notice = orphaned ? '扩展已更新，刷新页面后继续使用' : toast

  useEffect(() => {
    // Disabled on this site means disabled for every gesture, not just the card.
    paragraphTranslator.setKey(enabled ? settings.paragraphTriggerKey : 'off')
  }, [enabled, settings.paragraphTriggerKey])

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
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, settings.pageTranslationRange, settings.targetLanguage])
  const languages = useMemo(
    () => ({ source: settings.sourceLanguage, target: settings.targetLanguage }),
    [settings.sourceLanguage, settings.targetLanguage],
  )

  useEffect(() => {
    void getSettings().then(setSettings)
    return watchSettings(setSettings)
  }, [])

  const dismiss = useCallback(() => {
    requestRef.current++
    setPhase({ kind: 'idle' })
  }, [])

  // A dragged position belongs to the word it was dragged for. Keeping it for
  // the next lookup would park the card far away from the new selection.
  useEffect(() => {
    setDragOffset(ZERO_OFFSET)
  }, [phase.kind === 'idle' ? null : phase.snapshot])

  /**
   * Two-phase lookup.
   *
   * Latency here is output length, not network: the full card is eleven fields
   * and several hundred CJK tokens, which is many seconds on a fast model. So
   * we ask for the half the reader is waiting for — what does this word mean,
   * here — render it, and fetch the example, sentence translation and synonyms
   * while they read, merging them into the card in place.
   *
   * The offline dictionary answers instantly and completely, so it skips
   * phase two entirely.
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
          enriching: !core.offline && core.explanation.kind !== 'sentence',
        })

        /*
         * Phase two exists to fetch examples and synonyms. A sentence card
         * shows neither, so for a sentence the whole second round trip is
         * latency spent on output nobody will see.
         */
        if (core.offline || core.explanation.kind === 'sentence') return

        try {
          const extras = await sendMessage('ai/explain', { ...base, detail: 'extras' })
          if (requestId !== requestRef.current) return
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
        } catch {
          // The core answer is already on screen and is the part that matters;
          // a failed enrichment must not replace it with an error card.
          if (requestId !== requestRef.current) return
          setPhase((prev) => (prev.kind === 'result' ? { ...prev, enriching: false } : prev))
        }
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
          visible.kind !== 'idle' && snapshot !== null && visible.snapshot.text === snapshot.text,
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
      resolveSelection(event.altKey)
    }

    const onMouseDown = (event: MouseEvent) => {
      if (isOurs(event, host)) return
      if (phaseRef.current.kind !== 'idle') setPhase({ kind: 'idle' })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phaseRef.current.kind !== 'idle') dismiss()
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
        setToast(running ? '正在翻译整页…' : '已还原原文')
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
      setToast(created ? '已收藏，进入复习队列' : '已更新词卡中的这条记录')
    } catch (error) {
      setToast(error instanceof Error ? `收藏失败：${truncate(error.message, 60)}` : '收藏失败')
    } finally {
      setSaving(false)
    }
  }, [phase, saving])

  const remove = useCallback(async () => {
    if (phase.kind !== 'result' || !phase.saved) return
    const { removed } = await sendMessage('vocab/remove', { id: phase.saved.id })
    if (removed) {
      setPhase({ ...phase, saved: null })
      setToast('已从词卡移除')
    }
  }, [phase])

  const openBook = useCallback(() => {
    void sendMessage('app/open', { route: '#/vocabulary' })
  }, [])

  const openSettings = useCallback(() => {
    void sendMessage('options/open', {})
  }, [])

  // --- render --------------------------------------------------------------

  // Memoised so the measure effect below only re-runs when the anchor really
  // moves, not on every state change.
  const snapshot = phase.kind === 'idle' ? null : phase.snapshot
  const anchor = useMemo<AnchorBox>(
    () => (snapshot ? toAnchor(snapshot) : { top: 0, bottom: 0, left: 0, right: 0 }),
    [snapshot],
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
            <span className="hint">解释</span>
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
            onOpenBook={openBook}
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

function toAnchor(snapshot: SelectionSnapshot): AnchorBox {
  const { rect } = snapshot
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
}

/** True when the event originated inside our shadow UI. */
function isOurs(event: Event, host: HTMLElement): boolean {
  return event.composedPath().includes(host)
}
