// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUTTON_CLASS, PANEL_CLASS, SubtitleControl, mountControl } from './controlButton.ts'
import type { ControlState } from './controlButton.ts'

/**
 * 控制栏按钮。它长在 YouTube 自己的控件排里，所以既要像原生控件，
 * 又不能把播放器的行为带偏——面板里改设置时视频不该暂停。
 */
const base: ControlState = {
  enabled: false,
  status: 'off',
  mode: 'bilingual',
  fontScale: 1,
  background: 0.7,
  trackLabel: 'English',
  error: '',
}

const handlers = {
  onToggle: vi.fn(),
  onMode: vi.fn(),
  onFontScale: vi.fn(),
  onBackground: vi.fn(),
}

let control: SubtitleControl

beforeEach(() => {
  document.body.innerHTML = '<div class="ytp-right-controls"><button class="ytp-fullscreen-button">全屏</button></div>'
  handlers.onToggle.mockReset()
  handlers.onMode.mockReset()
  handlers.onFontScale.mockReset()
  handlers.onBackground.mockReset()
  control = new SubtitleControl({ ...base }, handlers)
  document.body.append(control.panelElement)
})

const panelRows = () => [...document.querySelectorAll(`.${PANEL_CLASS}-row`)]

describe('控制栏按钮', () => {
  it('插在控制栏最左边，不挤掉全屏按钮', () => {
    const controls = document.querySelector('.ytp-right-controls')!
    mountControl(controls, control)

    // 末尾是全屏，读者的肌肉记忆在那里。
    expect(controls.firstElementChild?.classList.contains(BUTTON_CLASS)).toBe(true)
    expect(controls.lastElementChild?.classList.contains('ytp-fullscreen-button')).toBe(true)
  })

  it('沿用 ytp-button，以便继承焦点样式与控制栏自动隐藏', () => {
    expect(control.buttonElement.classList.contains('ytp-button')).toBe(true)
  })

  it('点击按钮开合面板', () => {
    expect(control.panelElement.hidden).toBe(true)
    control.buttonElement.click()
    expect(control.panelElement.hidden).toBe(false)
    expect(control.buttonElement.getAttribute('aria-expanded')).toBe('true')
    control.buttonElement.click()
    expect(control.panelElement.hidden).toBe(true)
  })

  it('面板里的点击不冒泡——否则每改一次设置就顺手暂停了视频', () => {
    const onPlayerClick = vi.fn()
    document.body.addEventListener('click', onPlayerClick)
    control.panelElement.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onPlayerClick).not.toHaveBeenCalled()
  })

  it('开关、显示模式、字号、背景四项都能回调出去', () => {
    const toggle = control.panelElement.querySelector(`.${PANEL_CLASS}-toggle`) as HTMLElement
    toggle.click()
    expect(handlers.onToggle).toHaveBeenCalledWith(true)

    const modeButtons = panelRows()[1]!.querySelectorAll('button')
    ;(modeButtons[1] as HTMLElement).click()
    expect(handlers.onMode).toHaveBeenCalledWith('translationOnly')

    const sizeButtons = panelRows()[2]!.querySelectorAll('button')
    ;(sizeButtons[2] as HTMLElement).click()
    expect(handlers.onFontScale).toHaveBeenCalledWith(1.25)

    const backgroundButtons = panelRows()[3]!.querySelectorAll('button')
    ;(backgroundButtons[0] as HTMLElement).click()
    expect(handlers.onBackground).toHaveBeenCalledWith(0)
  })

  it('当前选项被标出来，读者能看到自己处在哪一档', () => {
    control.setState({ ...base, mode: 'translationOnly', fontScale: 1.25, background: 0 })
    const active = [...control.panelElement.querySelectorAll('button[data-active="true"]')].map(
      (button) => button.getAttribute('data-value'),
    )
    expect(active).toEqual(['translationOnly', '1.25', '0'])
  })

  it('字幕真的在显示时，按钮才标记为开，并把字幕来源写进 title', () => {
    control.setState({
      ...base,
      enabled: true,
      status: 'on',
      trackLabel: 'English (auto-generated)',
    })
    expect(control.buttonElement.dataset['on']).toBe('true')
    expect(control.buttonElement.title).toContain('English (auto-generated)')
  })

  /*
   * 开关记着上次的选择，一进页面就是打开的；可正片前面还有三十秒广告，
   * 什么都取不到。图标要是这时候就亮着，它就在说谎——而读者只会觉得功能坏了。
   */
  it('开关打开但字幕还没上屏时，按钮不亮', () => {
    control.setState({ ...base, enabled: true, status: 'loading', trackLabel: '广告播放中' })
    expect(control.buttonElement.dataset['on']).toBe('false')
    expect(control.buttonElement.dataset['status']).toBe('loading')
    // 面板里照实说在等什么，而不是干等着。
    expect(control.panelElement.querySelector(`.${PANEL_CLASS}-note`)?.textContent).toBe('广告播放中')
  })

  it('出错时按钮同样不亮', () => {
    control.setState({ ...base, enabled: true, status: 'error', error: '这个视频没有可用的字幕轨' })
    expect(control.buttonElement.dataset['on']).toBe('false')
    expect(control.buttonElement.dataset['status']).toBe('error')
  })

  it('出错时按钮的提示换成错误本身，而不是继续假装正常', () => {
    control.setState({ ...base, enabled: true, status: 'error', error: '这个视频没有可用的字幕轨' })
    expect(control.buttonElement.title).toBe('这个视频没有可用的字幕轨')
    const note = control.panelElement.querySelector(`.${PANEL_CLASS}-note`)
    expect(note?.getAttribute('data-error')).toBe('true')
    expect(note?.textContent).toBe('这个视频没有可用的字幕轨')
  })

  /*
   * 模板字符串首尾的换行会变成空白文本节点，每个在按钮里占一个行盒，
   * 把图标从垂直中心挤下去。这个 bug 上线过一次，长得像「样式没写好」，
   * 其实是 DOM 里多了两个看不见的节点。
   */
  it('按钮里只有图标，没有空白文本节点', () => {
    expect(control.buttonElement.childNodes).toHaveLength(1)
    expect(control.buttonElement.firstChild?.nodeName.toLowerCase()).toBe('svg')
  })

  it('标了 notranslate，别的翻译扩展不会来翻我们的设置面板', () => {
    expect(control.panelElement.getAttribute('translate')).toBe('no')
  })

  it('销毁后不在页面上留任何节点', () => {
    mountControl(document.querySelector('.ytp-right-controls')!, control)
    control.destroy()
    expect(document.querySelector(`.${BUTTON_CLASS}`)).toBeNull()
    expect(document.querySelector(`.${PANEL_CLASS}`)).toBeNull()
  })
})
