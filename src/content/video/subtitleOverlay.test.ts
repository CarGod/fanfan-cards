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
  overlay = new SubtitleOverlay({ mode: 'bilingual', fontScale: 1 })
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
    overlay.setOptions({ mode: 'translationOnly', fontScale: 1 })
    overlay.render(cues, ['这是最好的本地模型'], 500)
    expect(source().style.display).toBe('none')
    expect(translation().textContent).toBe('这是最好的本地模型')
  })

  it('切换模式立刻生效，不用等到下一句', () => {
    overlay.render(cues, ['这是最好的本地模型'], 500)
    overlay.setOptions({ mode: 'translationOnly', fontScale: 1 })
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

  it('字号倍率同时作用于两行，且译文略大于原文', () => {
    // CSS 会把 3.30vw 规范化成 3.3vw，所以比数值而不是比字符串。
    const sizeOf = (element: HTMLElement) => Number.parseFloat(element.style.fontSize)
    overlay.setOptions({ mode: 'bilingual', fontScale: 1.5 })
    expect(sizeOf(source())).toBeCloseTo(3.3, 2)
    expect(sizeOf(translation())).toBeCloseTo(3.6, 2)
    // 译文是读者真正要看的那一行，不能比原文小。
    expect(sizeOf(translation())).toBeGreaterThan(sizeOf(source()))
  })
})
