import type { SubtitleMode } from './subtitleOverlay.ts'

/**
 * 播放器控制栏里的那颗按钮，以及点开后的设置面板。
 *
 * 挂进 YouTube 自己的 `.ytp-right-controls`，而不是浮在播放器上：那一排是读者已经知道
 * 「设置在这里」的地方，全屏、剧场模式、迷你播放器都跟着它走，我们不需要为每种形态各写
 * 一套定位。代价是必须长得像原生控件——所以尺寸和类名都跟着 `ytp-button` 走。
 */

/**
 * 按钮上显示的是**字幕现在到底在不在**，不是读者点没点开关。
 *
 * 这两件事会分开，而且恰恰在最需要看清的时候分开：开关记着上次的选择，一进页面就是
 * 打开的，可正片前面还有三十秒广告，什么都取不到。图标要是这时候亮着，它就在说谎。
 */
export type ControlStatus = 'off' | 'loading' | 'on' | 'error'

export interface ControlState {
  /** 读者的意愿，面板里那个开关。 */
  enabled: boolean
  /** 眼前的事实，按钮的颜色。 */
  status: ControlStatus
  mode: SubtitleMode
  fontScale: number
  /** 字幕底衬的不透明度，0 是完全透明。 */
  background: number
  /** 选中的是哪条轨，显示给读者看，让「翻的不是我要的那条」变成可诊断的。 */
  trackLabel: string
  /** 出错时的一句话，为空表示正常。 */
  error: string
}

export interface ControlHandlers {
  onToggle: (enabled: boolean) => void
  onMode: (mode: SubtitleMode) => void
  onFontScale: (scale: number) => void
  onBackground: (opacity: number) => void
}

const STATUS_LABEL: Record<ControlStatus, string> = {
  off: '双语字幕',
  loading: '双语字幕（正在准备）',
  on: '双语字幕（已开启）',
  error: '双语字幕（暂时不可用）',
}

export const BUTTON_CLASS = 'fanfan-subtitle-button' 
export const PANEL_CLASS = 'fanfan-subtitle-panel'

/**
 * viewBox 紧贴图形本身，不留任何余量。
 *
 * 前一版照抄播放器的 36×36 坐标系，图形画在中间，靠 viewBox 的留白去凑大小——
 * 留多少全靠猜，结果就是比旁边一排原生图标小一圈。viewBox 收紧之后，
 * svg 有多大图形就有多大，尺寸只剩一个数要调。
 *
 * 形状是一个字幕框加长短两行：长短不一才读得出是「两种语言」，两行等长只是「字幕」。
 *
 * 字符串首尾不留换行。`innerHTML` 会把它们变成空白文本节点，每个在按钮里占一个行盒，
 * 把图标从垂直中心挤下去——这正是它看起来没对齐的原因。
 */
const MARK =
  '<svg viewBox="0 0 26 19" width="100%" height="100%" aria-hidden="true" focusable="false">' +
  '<rect x="1" y="1" width="24" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<rect x="5" y="6" width="8" height="2.2" rx="1.1" fill="currentColor"/>' +
  '<rect x="5" y="11" width="16" height="2.2" rx="1.1" fill="currentColor"/>' +
  '</svg>'

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
    const { enabled, status, mode, fontScale, background, trackLabel, error } = this.state
    this.button.setAttribute('aria-label', STATUS_LABEL[status])
    this.button.dataset['on'] = String(status === 'on')
    this.button.dataset['status'] = status
    this.button.title =
      error || (status === 'on' && trackLabel ? `双语字幕 · ${trackLabel}` : STATUS_LABEL[status])

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
      row(
        '背景',
        segmented(
          [
            { value: 0, label: '无' },
            { value: 0.4, label: '浅' },
            { value: 0.7, label: '中' },
            { value: 0.9, label: '深' },
          ],
          background,
          (next) => this.handlers.onBackground(next),
        ),
      ),
    )

    if (error) {
      this.panel.append(note(error, true))
    } else if (status === 'loading') {
      this.panel.append(note(trackLabel || '正在准备…', false))
    } else if (status === 'on' && trackLabel) {
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
