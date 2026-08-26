// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { HIGHLIGHT_NAME, SavedWordHighlighter } from './highlighter.ts'

/**
 * 绘制层。
 *
 * 这一层的取舍是「不碰 DOM」——用 CSS Custom Highlight API 让浏览器直接把
 * Range 画在文字上。jsdom 没有这个 API，所以这里补一个够用的假的：
 * 它不画东西，但能回答「注册了几个 Range」「关掉之后还剩什么」，
 * 而那正是这一层唯一会坏的地方。
 */

class FakeHighlight {
  readonly ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

const registry = new Map<string, FakeHighlight>()

const entry = (over: Partial<VocabularyEntry>): VocabularyEntry =>
  ({
    id: 'w1',
    word: 'migration',
    normalized: 'migration',
    lemma: 'migration',
    deletedAt: null,
    ...over,
  }) as VocabularyEntry

let highlighter: SavedWordHighlighter

beforeEach(() => {
  registry.clear()
  vi.stubGlobal('Highlight', FakeHighlight)
  vi.stubGlobal('CSS', { highlights: registry })
  document.body.innerHTML = '<p id="p">A database migration takes minutes.</p>'
  highlighter = new SavedWordHighlighter()
})

afterEach(() => {
  highlighter.stop()
  vi.unstubAllGlobals()
})

const painted = () => registry.get(HIGHLIGHT_NAME)?.ranges ?? []

describe('绘制', () => {
  it('把命中的词注册成 Range，一个字节都不改 DOM', () => {
    const before = document.body.innerHTML
    highlighter.start([entry({})])

    expect(painted()).toHaveLength(1)
    expect(painted()[0]!.toString()).toBe('migration')
    // 这是整条技术路线的理由，所以要钉死。
    expect(document.body.innerHTML).toBe(before)
  })

  it('词库为空时不留下任何注册项', () => {
    highlighter.start([])
    expect(registry.has(HIGHLIGHT_NAME)).toBe(false)
  })

  it('词库变了就重画', () => {
    highlighter.start([])
    expect(painted()).toHaveLength(0)

    highlighter.setEntries([entry({})])
    expect(painted()).toHaveLength(1)
  })

  it('词被删掉之后不再画', () => {
    highlighter.start([entry({})])
    expect(painted()).toHaveLength(1)

    highlighter.setEntries([entry({ deletedAt: Date.now() })])
    expect(registry.has(HIGHLIGHT_NAME)).toBe(false)
  })
})

describe('关掉', () => {
  /** 关掉必须什么都不剩——这个功能的整个卖点就是它不在页面上留东西。 */
  it('清空注册项，页面回到原样', () => {
    const before = document.body.innerHTML
    highlighter.start([entry({})])
    highlighter.stop()

    expect(registry.has(HIGHLIGHT_NAME)).toBe(false)
    expect(document.body.innerHTML).toBe(before)
  })

  it('停了之后词库再变也不会又画上去', () => {
    highlighter.start([entry({})])
    highlighter.stop()

    highlighter.setEntries([entry({})])
    expect(registry.has(HIGHLIGHT_NAME)).toBe(false)
  })
})

describe('点击反查', () => {
  /** 高亮是 Range，收不到事件，所以点击只能从坐标反查回来。 */
  const caretInto = (text: string, offset: number) => {
    const node = [...document.querySelectorAll('p')]
      .flatMap((p) => [...p.childNodes])
      .filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
      .find((n) => n.data.includes(text))!
    ;(document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = () => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset)
      return range
    }
  }

  it('点在词上就找得到那张卡', () => {
    highlighter.start([entry({ id: 'card-1' })])
    caretInto('migration', 'A database '.length + 2)

    expect(highlighter.hitAt(10, 10)?.entryId).toBe('card-1')
  })

  it('点在词外面就什么都不返回——没命中的点击要原样还给页面', () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)

    expect(highlighter.hitAt(10, 10)).toBeNull()
  })

  /**
   * 同一个词一页里出现好几次是常态。
   *
   * 卡片必须弹在**被点的那一处**旁边，所以 id 和矩形要在同一次查找里一起拿到——
   * 分两次查会查到另一处同词高亮上去。
   */
  it('一次把卡片和被点那处的矩形一起给出来', () => {
    highlighter.start([entry({ id: 'card-1' })])
    caretInto('migration', 'A database '.length + 2)

    const hit = highlighter.hitAt(10, 10)
    expect(hit).not.toBeNull()
    expect(hit!.entryId).toBe('card-1')
    expect(hit!.rect).toBeDefined()
  })
})

describe('浏览器不支持时', () => {
  it('安静地什么都不做，而不是报错', () => {
    vi.stubGlobal('CSS', {})
    const quiet = new SavedWordHighlighter()

    expect(() => quiet.start([entry({})])).not.toThrow()
    expect(() => quiet.stop()).not.toThrow()
    expect(quiet.hitAt(10, 10)).toBeNull()
  })
})

describe('停在词上时的光标', () => {
  /**
   * `::highlight()` 认不得 `cursor`——它只支持颜色、背景和文字装饰几样。
   * 高亮是 Range 不是元素，没有盒子可以挂光标。所以只能自己做命中测试，
   * 在 html 上打个标记，由 CSS 去改光标。
   */
  const hovering = () => document.documentElement.hasAttribute('data-fanfan-word-hover')

  const caretInto = (text: string | null, offset = 0) => {
    ;(document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = () => {
      if (text === null) return null
      const node = [...document.querySelectorAll('p')]
        .flatMap((p) => [...p.childNodes])
        .filter((n): n is Text => n.nodeType === Node.TEXT_NODE)
        .find((n) => n.data.includes(text))!
      const range = document.createRange()
      const at = node.data.indexOf(text) + offset
      range.setStart(node, at)
      range.setEnd(node, at)
      return range
    }
  }

  const move = async () => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  }

  it('停在标出来的词上时打标记', async () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)
    await move()
    expect(hovering()).toBe(true)
  })

  it('移开就清掉', async () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)
    await move()
    expect(hovering()).toBe(true)

    caretInto(null)
    await move()
    expect(hovering()).toBe(false)
  })

  /**
   * 指针移出窗口之后 mousemove 就不发了。不单独清的话，标记会留在原地，
   * 表现成整页光标卡在手形上——这是这条实现唯一能出的丑。
   */
  it('鼠标离开页面时清掉', async () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)
    await move()

    document.dispatchEvent(new MouseEvent('mouseleave'))
    expect(hovering()).toBe(false)
  })

  it('滚动时清掉——页面动了，那个词已经不在指针底下了', async () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)
    await move()

    window.dispatchEvent(new Event('scroll'))
    expect(hovering()).toBe(false)
  })

  it('关掉翻翻模式之后不留这个标记', async () => {
    highlighter.start([entry({})])
    caretInto('migration', 2)
    await move()

    highlighter.stop()
    expect(hovering()).toBe(false)
  })
})
