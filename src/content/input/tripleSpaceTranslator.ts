/**
 * Three quick Space presses inside an editable field translate its contents.
 *
 * This module deliberately owns both gesture recognition and DOM replacement.
 * Keeping them together makes the important invariant testable: the first two
 * spaces are real browser input, while the third is consumed and the other two
 * are removed before any text is sent to the model.
 */

const DEFAULT_MAX_GAP_MS = 450
const FORM_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel'])
const SPACE_PAIR = /^[ \u00a0]{2}$/

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement

export interface InputTranslationResult {
  translation: string
  targetLanguage: string
}

export type InputTranslationStatus =
  | { kind: 'translating'; target: HTMLElement }
  | { kind: 'done'; target: HTMLElement; targetLanguage: string }
  | { kind: 'busy'; target: HTMLElement }
  | { kind: 'changed'; target: HTMLElement }
  | { kind: 'error'; target: HTMLElement; error: unknown }
  | { kind: 'cancelled'; target: HTMLElement }

interface ControllerOptions {
  translate: (text: string) => Promise<InputTranslationResult>
  onStatus?: (status: InputTranslationStatus) => void
  /** Injectable clock keeps timing tests deterministic. */
  now?: () => number
  maxGapMs?: number
}

interface EditableSnapshot {
  text: string
  caret: number
}

interface TriggerSnapshot {
  /** Full field contents after removing the two trigger spaces. */
  expectedText: string
  /** Trimmed model input. Empty contents never trigger. */
  source: string
}

interface HostPosition {
  parent: Node | null
  index: number
}

/**
 * Installs one capture listener for the host page.
 *
 * There is no global "currently translating" switch: different editors can
 * translate concurrently, while a second gesture on the same editor is folded
 * into the request already in flight.
 */
export class TripleSpaceInputTranslator {
  private readonly translate: ControllerOptions['translate']
  private readonly onStatus: NonNullable<ControllerOptions['onStatus']>
  private readonly now: () => number
  private readonly maxGapMs: number
  private readonly inFlight = new WeakSet<Element>()
  /** Iterable companion to inFlight, used to tear down target-bound UI on stop. */
  private readonly activeTargets = new Set<HTMLElement>()

  private owner: Document | null = null
  private lastTarget: EditableTarget | null = null
  private lastAt = 0
  private count = 0
  private generation = 0
  private composing = false

  constructor(options: ControllerOptions) {
    this.translate = options.translate
    this.onStatus = options.onStatus ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS
  }

  start(owner: Document = document): void {
    if (this.owner === owner) return
    this.stop()
    this.owner = owner
    owner.addEventListener('keydown', this.handleKeyDown, true)
    owner.addEventListener('compositionstart', this.handleCompositionStart, true)
    owner.addEventListener('compositionend', this.handleCompositionEnd, true)
  }

  stop(): void {
    if (this.owner) {
      this.owner.removeEventListener('keydown', this.handleKeyDown, true)
      this.owner.removeEventListener('compositionstart', this.handleCompositionStart, true)
      this.owner.removeEventListener('compositionend', this.handleCompositionEnd, true)
    }
    for (const target of this.activeTargets) this.onStatus({ kind: 'cancelled', target })
    this.activeTargets.clear()
    this.owner = null
    this.generation++
    this.composing = false
    this.resetSequence()
  }

  private readonly handleCompositionStart = (): void => {
    this.composing = true
    this.resetSequence()
  }

  private readonly handleCompositionEnd = (): void => {
    this.composing = false
    this.resetSequence()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = findEditableTarget(event.target)
    const plainSpace =
      event.key === ' ' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey

    // keyCode 229 covers browsers that fail to expose isComposing while an IME
    // candidate is active. Auto-repeat is never a deliberate "three presses".
    if (
      !plainSpace ||
      !target ||
      this.composing ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat
    ) {
      this.resetSequence()
      return
    }

    const at = this.now()
    if (target !== this.lastTarget || at - this.lastAt > this.maxGapMs) {
      this.count = 1
    } else {
      this.count++
    }
    this.lastTarget = target
    this.lastAt = at

    if (this.count < 3) return
    this.resetSequence()

    const trigger = consumeTriggerSpaces(target)
    if (!trigger) return

    // The browser may insert the third space after keydown. Prevent it only
    // after all guards pass, so empty/unsupported fields keep normal typing.
    event.preventDefault()

    if (this.inFlight.has(target)) {
      this.onStatus({ kind: 'busy', target })
      return
    }

    const generation = this.generation
    this.inFlight.add(target)
    this.activeTargets.add(target)
    this.onStatus({ kind: 'translating', target })

    void this.translate(trigger.source)
      .then(async (result) => {
        if (generation !== this.generation) return
        if (!target.isConnected) {
          this.onStatus({ kind: 'cancelled', target })
          return
        }
        const current = readEditable(target)
        // Never overwrite characters typed while the model was answering.
        if (!current || current.text !== trigger.expectedText) {
          this.onStatus({ kind: 'changed', target })
          return
        }
        if (!result.translation.trim()) {
          this.onStatus({
            kind: 'error',
            target,
            error: new Error('The model returned an empty translation'),
          })
          return
        }
        if (!(await replaceEditable(target, result.translation))) {
          this.onStatus({
            kind: 'error',
            target,
            error: new Error('The host editor cancelled or reverted the translated text'),
          })
          return
        }
        this.onStatus({ kind: 'done', target, targetLanguage: result.targetLanguage })
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.onStatus({ kind: 'error', target, error })
      })
      .finally(() => {
        this.inFlight.delete(target)
        this.activeTargets.delete(target)
      })
  }

  private resetSequence(): void {
    this.lastTarget = null
    this.lastAt = 0
    this.count = 0
  }
}

/** Find the actual editor even when a rich editor dispatches from a child span. */
function findEditableTarget(target: EventTarget | null): EditableTarget | null {
  const element = target instanceof Element ? target : null
  if (!element) return null

  if (element instanceof HTMLTextAreaElement) {
    return element.disabled || element.readOnly ? null : element
  }
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase()
    return element.disabled || element.readOnly || !FORM_INPUT_TYPES.has(type) ? null : element
  }

  // The closest explicit contenteditable boundary wins. A nested
  // contenteditable="false" region must stay inert even though its ancestor is
  // editable.
  let current: Element | null = element
  while (current) {
    const attribute = current.getAttribute('contenteditable')
    if (attribute !== null) {
      if (attribute === 'false') return null
      return current instanceof HTMLElement ? current : null
    }
    current = current.parentElement
  }

  return element instanceof HTMLElement && element.isContentEditable ? element : null
}

function consumeTriggerSpaces(target: EditableTarget): TriggerSnapshot | null {
  const snapshot = readEditable(target)
  if (!snapshot || snapshot.caret < 2) return null
  const pair = snapshot.text.slice(snapshot.caret - 2, snapshot.caret)
  if (!SPACE_PAIR.test(pair)) return null

  const expectedText =
    snapshot.text.slice(0, snapshot.caret - 2) + snapshot.text.slice(snapshot.caret)
  const source = expectedText.trim()
  if (!source) return null

  if (!deleteEditableRange(target, snapshot.caret - 2, snapshot.caret, expectedText)) return null
  return { expectedText, source }
}

function readEditable(target: EditableTarget): EditableSnapshot | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart
    const end = target.selectionEnd
    if (start === null || end === null || start !== end) return null
    return { text: target.value, caret: start }
  }

  const selection = target.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null
  const node = selection.anchorNode
  if (!node || (node !== target && !target.contains(node))) return null

  try {
    const prefix = target.ownerDocument.createRange()
    prefix.selectNodeContents(target)
    prefix.setEnd(node, selection.anchorOffset)
    return { text: target.textContent ?? '', caret: prefix.toString().length }
  } catch {
    return null
  }
}

function deleteEditableRange(
  target: EditableTarget,
  start: number,
  end: number,
  nextValue: string,
): boolean {
  if (!dispatchBeforeInput(target, 'deleteContentBackward', null)) return false
  if (!target.isConnected) return false

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    setFormValue(target, nextValue)
    try {
      target.setSelectionRange(start, start)
    } catch {
      return false
    }
    emitInput(target, 'deleteContentBackward', null)
    return target.value === nextValue
  }

  const from = textPointAt(target, start)
  const to = textPointAt(target, end)
  if (!from || !to) return false

  const range = target.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  range.deleteContents()
  range.collapse(true)
  const selection = target.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  emitInput(target, 'deleteContentBackward', null)
  return (target.textContent ?? '') === nextValue
}

async function replaceEditable(target: EditableTarget, value: string): Promise<boolean> {
  const maintainFocus = hasEditingFocus(target)

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    if (!dispatchBeforeInput(target, 'insertReplacementText', value)) return false
    // A controlled host is allowed to replace its node from beforeinput. The
    // old target is now stale and must never be focused or mutated.
    if (!target.isConnected) return false
    const hostPosition = captureHostPosition(target)
    setFormValue(target, value)
    if (maintainFocus) setFormSelection(target, value.length)
    emitInput(target, 'insertReplacementText', value)
    // React/Vue may synchronously reconcile during `input`. Re-assert the
    // caret only when this exact node still owns the editing focus; never steal
    // it from a control the user chose while the model was answering.
    if (maintainFocus) restoreFormFocusAndSelection(target, value.length)
    // A framework may intentionally remount the control after consuming the
    // event. Never touch/focus the detached stale node; accept the edit only
    // when the replacement at the same host position reflects the new value.
    if (!target.isConnected) return replacementReflectsValue(hostPosition, target, value)
    return target.value === value
  }

  // Draft.js owns an immutable EditorState. Replacing its DOM children makes
  // the translated text visible without updating that state; the next Delete
  // then reconciles against the old model and produces stuck/duplicated text.
  // A plain-text paste is Draft's public browser transaction: its onPaste path
  // replaces the current SelectionState and pushes a new EditorState.
  if (isDraftEditor(target)) {
    return replaceDraftEditor(target, value, maintainFocus)
  }

  if (!dispatchBeforeInput(target, 'insertReplacementText', value)) return false
  if (!target.isConnected) return false

  const hostPosition = captureHostPosition(target)
  const owner = target.ownerDocument
  target.replaceChildren(owner.createTextNode(value))
  if (maintainFocus) placeContentEditableCaretAtEnd(target)
  emitInput(target, 'insertReplacementText', value)
  if (maintainFocus) restoreContentEditableFocusAndSelection(target)
  if (!target.isConnected) return replacementReflectsValue(hostPosition, target, value)
  return (target.textContent ?? '') === value
}

function isDraftEditor(target: HTMLElement): boolean {
  return (
    target.classList.contains('public-DraftEditor-content') &&
    target.closest('.DraftEditor-root') !== null &&
    target.getAttribute('contenteditable') !== 'false'
  )
}

async function replaceDraftEditor(
  target: HTMLElement,
  value: string,
  maintainFocus: boolean,
): Promise<boolean> {
  // A paste transaction needs the editor's real selection. Never focus it just
  // to manufacture one after the user has moved to another control.
  if (!maintainFocus || !target.isConnected) return false

  const original = target.textContent ?? ''
  const position = captureHostPosition(target)
  if (!(await dispatchPlainTextPaste(target, value, original))) return false
  await letControlledEditorCommit()

  if (!target.isConnected) return replacementReflectsValue(position, target, value)
  if ((target.textContent ?? '') === value) {
    restoreContentEditableFocusAndSelection(target)
    return true
  }

  // A custom paste hook should either accept the full replacement or leave the
  // editor alone. If it made a partial change, undo the accepted EditorState
  // transaction. Pasting the original again is unsafe when the host selection
  // failed to sync — it could append a second ghost copy for the same reason.
  if ((target.textContent ?? '') !== original && target.isConnected) {
    dispatchDraftUndo(target)
    await letControlledEditorCommit()
  }
  return false
}

/**
 * Select the actual leaf text (not the contenteditable wrapper) so Draft can
 * map the DOM range back to block/leaf keys before handling the paste.
 */
async function dispatchPlainTextPaste(
  target: HTMLElement,
  value: string,
  expectedCurrent: string,
): Promise<boolean> {
  if (!selectEditableText(target)) return false
  notifySelectionChanged(target)
  // Draft applies DOM selection to EditorState in a React update. Let that
  // controlled update commit before the paste reads the model selection.
  await letControlledEditorCommit()
  if (
    !target.isConnected ||
    !hasEditingFocus(target) ||
    (target.textContent ?? '') !== expectedCurrent
  ) {
    return false
  }

  const event = createPlainTextPasteEvent(target, value)
  // Programmatically dispatched paste has no browser default action. Draft.js
  // proves it accepted the transaction by preventing default in editOnPaste.
  return !target.dispatchEvent(event)
}

function dispatchDraftUndo(target: HTMLElement): void {
  const view = target.ownerDocument.defaultView
  const KeyboardEventConstructor = view?.KeyboardEvent ?? KeyboardEvent
  const event = new KeyboardEventConstructor('keydown', {
    key: 'z',
    code: 'KeyZ',
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    metaKey: true,
  })
  // Draft 0.11's key binding still reads the legacy key code.
  try {
    Object.defineProperties(event, {
      keyCode: { value: 90 },
      which: { value: 90 },
    })
  } catch {
    // Modern constructors already expose enough data through key/code.
  }
  target.dispatchEvent(event)
}

function selectEditableText(target: HTMLElement): boolean {
  const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const first = nodes.find((node) => node.data.length > 0)
  let last: Text | undefined
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (nodes[index]!.data.length > 0) {
      last = nodes[index]
      break
    }
  }
  if (!first || !last) return false

  const range = target.ownerDocument.createRange()
  range.setStart(first, 0)
  range.setEnd(last, last.data.length)
  const selection = target.ownerDocument.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

function notifySelectionChanged(target: HTMLElement): void {
  const view = target.ownerDocument.defaultView
  const EventConstructor = view?.Event ?? Event
  target.ownerDocument.dispatchEvent(new EventConstructor('selectionchange'))
  target.dispatchEvent(new EventConstructor('select', { bubbles: true, composed: true }))
  const KeyboardEventConstructor = view?.KeyboardEvent ?? KeyboardEvent
  target.dispatchEvent(
    new KeyboardEventConstructor('keyup', {
      key: 'Shift',
      code: 'ShiftLeft',
      bubbles: true,
      composed: true,
    }),
  )
}

function createPlainTextPasteEvent(target: HTMLElement, value: string): Event {
  const view = target.ownerDocument.defaultView
  const clipboardData = createPlainTextDataTransfer(view, value)
  try {
    const ClipboardEventConstructor = view?.ClipboardEvent
    if (ClipboardEventConstructor) {
      return new ClipboardEventConstructor('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData,
      })
    }
  } catch {
    // Some browsers expose ClipboardEvent but reject constructed clipboardData.
  }

  const EventConstructor = view?.Event ?? Event
  const event = new EventConstructor('paste', { bubbles: true, cancelable: true, composed: true })
  Object.defineProperty(event, 'clipboardData', { configurable: true, value: clipboardData })
  return event
}

function createPlainTextDataTransfer(view: Window | null, value: string): DataTransfer {
  try {
    const DataTransferConstructor = (
      view as (Window & { DataTransfer?: typeof DataTransfer }) | null
    )?.DataTransfer
    if (DataTransferConstructor) {
      const transfer = new DataTransferConstructor()
      transfer.setData('text/plain', value)
      return transfer
    }
  } catch {
    // Fall back to the read-only surface used by Draft's DataTransfer wrapper.
  }

  return {
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: ['text/plain'],
    clearData: () => undefined,
    getData: (format: string) =>
      format === 'text/plain' || format === 'Text' || format === 'text' ? value : '',
    setData: () => undefined,
    setDragImage: () => undefined,
  }
}

async function letControlledEditorCommit(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function captureHostPosition(target: HTMLElement): HostPosition {
  const parent = target.parentNode
  return { parent, index: parent ? Array.from(parent.childNodes).indexOf(target) : -1 }
}

/**
 * Controlled frameworks sometimes replace the editor while consuming `input`.
 * Validate the new node in place, but never focus or mutate it implicitly.
 */
function replacementReflectsValue(
  position: HostPosition,
  original: EditableTarget,
  value: string,
): boolean {
  if (!position.parent?.isConnected || position.index < 0) return false
  const replacement = position.parent.childNodes.item(position.index)
  if (original instanceof HTMLInputElement) {
    return (
      replacement instanceof HTMLInputElement &&
      replacement.type === original.type &&
      replacement.value === value
    )
  }
  if (original instanceof HTMLTextAreaElement) {
    return replacement instanceof HTMLTextAreaElement && replacement.value === value
  }
  return (
    replacement instanceof HTMLElement &&
    replacement.getAttribute('contenteditable') !== null &&
    (replacement.textContent ?? '') === value
  )
}

/** Use the native setter so React/Vue value trackers observe the input event. */
function setFormValue(target: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(target, value)
  else target.value = value
}

function emitInput(target: HTMLElement, inputType: string, data: string | null): void {
  const view = target.ownerDocument.defaultView
  try {
    const InputEventConstructor = view?.InputEvent
    if (InputEventConstructor) {
      target.dispatchEvent(
        new InputEventConstructor('input', { bubbles: true, composed: true, inputType, data }),
      )
      return
    }
  } catch {
    // Older pages may expose InputEvent but reject its constructor options.
  }
  const EventConstructor = view?.Event ?? Event
  target.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }))
}

/**
 * Let the host framework inspect or cancel the edit before touching its DOM.
 * This is the browser's normal editing protocol; skipping straight to `input`
 * leaves controlled editors with a visible value their internal state never
 * accepted, which is why the next Backspace/Delete can appear to do nothing.
 */
function dispatchBeforeInput(
  target: HTMLElement,
  inputType: string,
  data: string | null,
): boolean {
  const view = target.ownerDocument.defaultView
  try {
    const InputEventConstructor = view?.InputEvent
    if (InputEventConstructor) {
      return target.dispatchEvent(
        new InputEventConstructor('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType,
          data,
        }),
      )
    }
  } catch {
    // Fall through for older pages with a partial InputEvent constructor.
  }
  const EventConstructor = view?.Event ?? Event
  return target.dispatchEvent(
    new EventConstructor('beforeinput', { bubbles: true, cancelable: true, composed: true }),
  )
}

function hasEditingFocus(target: EditableTarget): boolean {
  const owner = target.ownerDocument
  if (owner.activeElement === target || target.contains(owner.activeElement)) return true
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false
  const selection = owner.getSelection()
  const node = selection?.anchorNode
  return Boolean(node && (node === target || target.contains(node)))
}

function setFormSelection(target: HTMLInputElement | HTMLTextAreaElement, caret: number): boolean {
  try {
    target.setSelectionRange(caret, caret)
    return true
  } catch {
    return false
  }
}

function restoreFormFocusAndSelection(
  target: HTMLInputElement | HTMLTextAreaElement,
  caret: number,
): void {
  if (!target.isConnected) return
  const active = target.ownerDocument.activeElement
  // A different focused control is a user/framework decision. `body` means
  // reconciliation dropped focus without choosing a replacement, so restoring
  // the still-connected editor is safe.
  if (active !== target && active !== target.ownerDocument.body) return
  if (active !== target) focusWithoutScroll(target)
  if (target.ownerDocument.activeElement === target) setFormSelection(target, caret)
}

function placeContentEditableCaretAtEnd(target: HTMLElement): void {
  if (!target.isConnected) return
  const range = target.ownerDocument.createRange()
  range.selectNodeContents(target)
  range.collapse(false)
  const selection = target.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function restoreContentEditableFocusAndSelection(target: HTMLElement): void {
  if (!target.isConnected) return
  const active = target.ownerDocument.activeElement
  if (active !== target && active !== target.ownerDocument.body) return
  if (active !== target) focusWithoutScroll(target)
  if (target.ownerDocument.activeElement === target) placeContentEditableCaretAtEnd(target)
}

function focusWithoutScroll(target: HTMLElement): void {
  try {
    target.focus({ preventScroll: true })
  } catch {
    target.focus()
  }
}

function textPointAt(
  root: HTMLElement,
  offset: number,
): { node: Node; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    last = node
    const length = node.data.length
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
  }

  if (remaining === 0 && last) return { node: last, offset: last.data.length }
  if (offset === 0) return { node: root, offset: 0 }
  return null
}
