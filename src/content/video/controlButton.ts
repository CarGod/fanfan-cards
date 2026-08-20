import type { SubtitleMode } from './subtitleOverlay.ts'

/**
 * 播放器控制栏里的那颗按钮，以及点开后的设置面板。
 *
 * 挂进 YouTube 自己的 `.ytp-right-controls`，而不是浮在播放器上：那一排是读者已经知道
 * 「设置在这里」的地方，全屏、剧场模式、迷你播放器都跟着它走，我们不需要为每种形态各写
 * 一套定位。代价是必须长得像原生控件——所以尺寸和类名都跟着 `ytp-button` 走。
 */

export interface ControlState {
  enabled: boolean
  mode: SubtitleMode
  fontScale: number
  /** 选中的是哪条轨，显示给读者看，让「翻的不是我要的那条」变成可诊断的。 */
  trackLabel: string
  /** 出错时的一句话，为空表示正常。 */
  error: string
}

export interface ControlHandlers {
  onToggle: (enabled: boolean) => void
  onMode: (mode: SubtitleMode) => void
  onFontScale: (scale: number) => void
}

export const BUTTON_CLASS = 'fanfan-subtitle-button'
export const PANEL_CLASS = 'fanfan-subtitle-panel'

/** 与品牌标记同形：一张卡片，右上角被掀起。16px 下只剩两个形状。 */
const MARK = `
<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
  <path d="M14 6h27l17 17v27a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8Z" fill="currentColor"/>
  <path d="M41 6 58 23H41Z" fill="rgba(0,0,0,0.45)"/>
</svg>`

export class SubtitleControl {
  private readonly button: HTMLButtonElement
  private readonly panel: HTMLElement
  private state: ControlState
  private open = false

  constructor(state: ControlState, private readonly handlers: ControlHandlers) {
    this.state = state

    this.button = document.createElement('button')
    // `ytp-button` 带来焦点样式、hover 与控制栏的自动隐藏行为，自己实现只会更差。
    this.button.className = `ytp-button ${BUTTON_CLASS}`
    this.button.type = 'button'
    this.button.innerHTML = MARK
    this.button.addEventListener('click', (event) => {
      event.stopPropagation()
      this.toggleOpen()
    })

    this.panel = document.createElement('div')
    this.panel.className = `${PANEL_CLASS} notranslate`
    this.panel.setAttribute('translate', 'no')
    this.panel.hidden = true
    // 面板里的点击不该冒泡到播放器——否则每次改设置都会顺手暂停视频。
    this.panel.addEventListener('click', (event) => event.stopPropagation())

    this.renderPanel()
  }

  get buttonElement(): HTMLButtonElement {
    return this.button
  }

  get panelElement(): HTMLElement {
    return this.panel
  }

  setState(state: ControlState): void {
    this.state = state
    this.renderPanel()
  }

  closePanel(): void {
    this.open = false
    this.panel.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
  }

  destroy(): void {
    this.button.remove()
    this.panel.remove()
  }

  private toggleOpen(): void {
    this.open = !this.open
    this.panel.hidden = !this.open
    this.button.setAttribute('aria-expanded', String(this.open))
  }

  private renderPanel(): void {
    const { enabled, mode, fontScale, trackLabel, error } = this.state
    this.button.setAttribute('aria-label', enabled ? '双语字幕（已开启）' : '双语字幕')
    this.button.dataset['on'] = String(enabled)
    this.button.title = error || (enabled ? `双语字幕 · ${trackLabel}` : '双语字幕')

    this.panel.replaceChildren()

    this.panel.append(
      row('双语字幕', toggle(enabled, (next) => this.handlers.onToggle(next))),
      row(
        '显示',
        segmented(
          [
            { value: 'bilingual' as const, label: '双语' },
            { value: 'translationOnly' as const, label: '仅译文' },
          ],
          mode,
          (next) => this.handlers.onMode(next),
        ),
      ),
      row(
        '字号',
        segmented(
          [
            { value: 0.85, label: '小' },
            { value: 1, label: '标准' },
            { value: 1.25, label: '大' },
          ],
          fontScale,
          (next) => this.handlers.onFontScale(next),
        ),
      ),
    )

    if (error) {
      this.panel.append(note(error, true))
    } else if (enabled && trackLabel) {
      this.panel.append(note(`字幕来源：${trackLabel}`, false))
    }
  }
}

function row(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = `${PANEL_CLASS}-row`
  const text = document.createElement('span')
  text.textContent = label
  wrapper.append(text, control)
  return wrapper
}

function toggle(on: boolean, onChange: (next: boolean) => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `${PANEL_CLASS}-toggle`
  button.dataset['on'] = String(on)
  button.setAttribute('role', 'switch')
  button.setAttribute('aria-checked', String(on))
  button.addEventListener('click', () => onChange(!on))
  return button
}

function segmented<T extends string | number>(
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  onChange: (next: T) => void,
): HTMLElement {
  const group = document.createElement('div')
  group.className = `${PANEL_CLASS}-segmented`
  group.setAttribute('role', 'radiogroup')

  for (const option of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = option.label
    button.dataset['value'] = String(option.value)
    button.dataset['active'] = String(option.value === current)
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(option.value === current))
    button.addEventListener('click', () => onChange(option.value))
    group.append(button)
  }
  return group
}

function note(text: string, isError: boolean): HTMLElement {
  const element = document.createElement('div')
  element.className = `${PANEL_CLASS}-note`
  element.dataset['error'] = String(isError)
  element.textContent = text
  return element
}

/**
 * 把按钮插进控制栏。
 *
 * 插在最左边而不是追加到末尾：末尾是全屏按钮，读者的肌肉记忆在那里，挤走它会让人点错。
 */
export function mountControl(controls: Element, control: SubtitleControl): void {
  controls.prepend(control.buttonElement)
}
