// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { SubtitleOverlay } from './subtitleOverlay.ts'
import type { Cue } from './timedtext.ts'

const cues: Cue[] = [
  { startMs: 0, endMs: 1000, text: 'This is the best local model' },
  { startMs: 1000, endMs: 2000, text: 'that you can run today' },
  { startMs: 5000, endMs: 6000, text: 'weights stay on your machine' },
]

let overlay: SubtitleOverlay

beforeEach(() => {
  document.body.innerHTML = ''
  overlay = new SubtitleOverlay({ mode: 'bilingual', fontScale: 1, background: 0.7 })
  document.body.append(overlay.element)
})

const source = () => document.querySelector('.fanfan-subtitle-overlay-source') as HTMLElement
const translation = () =>
  document.querySelector('.fanfan-subtitle-overlay-translation') as HTMLElement

describe('字幕叠加层', () => {
  it('双语模式同时显示原文与译文', () => {
    overlay.render(cues, ['这是最好的本地模型'], 500)
    expect(source().textContent).toBe('This is the best local model')
    expect(translation().textContent).toBe('这是最好的本地模型')
    expect(source().style.display).toBe('')
  })

  it('仅译文模式把原文藏起来，但仍然保留在 DOM 里', () => {
    overlay.setOptions({ mode: 'translationOnly', fontScale: 1, background: 0.7 })
    overlay.render(cues, ['这是最好的本地模型'], 500)
    expect(source().style.display).toBe('none')
    expect(translation().textContent).toBe('这是最好的本地模型')
  })

  it('切换模式立刻生效，不用等到下一句', () => {
    overlay.render(cues, ['这是最好的本地模型'], 500)
    overlay.setOptions({ mode: 'translationOnly', fontScale: 1, background: 0.7 })
    overlay.render(cues, ['这是最好的本地模型'], 500)
    expect(source().style.display).toBe('none')
  })

  it('译文还没到时显示占位，而不是让整行消失', () => {
    // 字幕行忽有忽无比慢一点更难受。
    overlay.render(cues, [], 500)
    expect(source().textContent).toBe('This is the best local model')
    expect(translation().textContent).toBe('…')
  })

  it('译文迟到后能补上——refresh 让下一次 render 不被去重挡住', () => {
    overlay.render(cues, [], 500)
    overlay.refresh()
    overlay.render(cues, ['这是最好的本地模型'], 500)
    expect(translation().textContent).toBe('这是最好的本地模型')
  })

  it('落在没有字幕的空隙里整层隐藏', () => {
    overlay.render(cues, ['a', 'b', 'c'], 3000)
    expect(overlay.element.style.visibility).toBe('hidden')
  })

  it('不吃点击——播放器的控件在它下面', () => {
    expect(overlay.element.style.pointerEvents).toBe('none')
  })

  it('标了 notranslate，别的翻译扩展不会再翻我们的译文', () => {
    expect(overlay.element.getAttribute('translate')).toBe('no')
    expect(overlay.element.classList.contains('notranslate')).toBe(true)
  })

  it('字号跟着播放器宽度走，不跟着窗口走', () => {
    const sizeOf = (element: HTMLElement) => Number.parseFloat(element.style.fontSize)

    // 一个 1280 宽的播放器，译文大约 25px——对着 YouTube 自己的默认字号调的。
    overlay.setPlayerWidth(1280)
    const normal = sizeOf(translation())
    expect(normal).toBeGreaterThan(20)
    expect(normal).toBeLessThan(30)

    // 全屏，播放器变宽，字跟着变大。第一版用 vw，拉宽窗口就变大，
    // 而播放器根本没变——那是把字幕锚在了错误的参照物上。
    overlay.setPlayerWidth(1920)
    expect(sizeOf(translation())).toBeGreaterThan(normal)
  })

  it('倍率作用于两行，且译文始终大于原文', () => {
    const sizeOf = (element: HTMLElement) => Number.parseFloat(element.style.fontSize)
    overlay.setPlayerWidth(1280)
    const before = sizeOf(translation())

    overlay.setOptions({ mode: 'bilingual', fontScale: 0.8, background: 0.7 })
    expect(sizeOf(translation())).toBeLessThan(before)
    // 译文是读者真正要看的那一行，不能比原文小。
    expect(sizeOf(translation())).toBeGreaterThan(sizeOf(source()))
  })

  // 小屏上的迷你播放器和 4K 全屏是同一段代码，两头都不能失控。
  it('两头都收住：迷你播放器不会小到看不见，全屏不会大到糊满画面', () => {
    const sizeOf = (element: HTMLElement) => Number.parseFloat(element.style.fontSize)
    overlay.setPlayerWidth(300)
    expect(sizeOf(translation())).toBeGreaterThanOrEqual(13)
    overlay.setPlayerWidth(3840)
    expect(sizeOf(translation())).toBeLessThanOrEqual(46)
  })

  it('底衬不透明度可调，调到没有时改由描边扛住画面', () => {
    overlay.setOptions({ mode: 'bilingual', fontScale: 1, background: 0 })
    expect(overlay.element.style.getPropertyValue('--ff-subtitle-bg')).toBe('rgba(8, 8, 8, 0)')
    expect(overlay.element.dataset['bare']).toBe('true')

    overlay.setOptions({ mode: 'bilingual', fontScale: 1, background: 0.7 })
    expect(overlay.element.dataset['bare']).toBe('false')
  })
})
