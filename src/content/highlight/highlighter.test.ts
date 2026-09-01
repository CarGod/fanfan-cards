// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { BACKDROP_ATTRIBUTE } from './backdrop.ts'
import { HIGHLIGHT_NAMES, highlightNameFor, SavedWordHighlighter } from './highlighter.ts'
import { HIGHLIGHT_STYLE_ID } from './styles.ts'

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

/**
 * `review` 故意**不**在默认值里。
 *
 * 熟悉度决定画哪一种颜色，而这一层是画在别人的页面上——一条从旧版本或者另一台设备
 * 同步过来、缺了这个字段的记录，不该让整页高亮消失。缺省就是 0 级，
 * 那也正是一个刚存下的词的样子。想指定等级的用例自己传 `level`。
 */
const entry = (over: Partial<VocabularyEntry> & { level?: 0 | 1 | 2 | 3 }): VocabularyEntry => {
  const { level, ...rest } = over
  return {
    id: 'w1',
    word: 'migration',
    normalized: 'migration',
    lemma: 'migration',
    deletedAt: null,
    ...(level === undefined ? {} : { review: { level } }),
    ...rest,
  } as VocabularyEntry
}

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

/** 所有等级加起来画了哪些 Range。 */
const painted = () =>
  HIGHLIGHT_NAMES.flatMap((name) => registry.get(name)?.ranges ?? [])

const paintedAt = (level: 0 | 1 | 2 | 3) => registry.get(highlightNameFor(level))?.ranges ?? []

/** 一个注册项都没剩。 */
const registered = () => HIGHLIGHT_NAMES.filter((name) => registry.has(name))

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
    expect(registered()).toEqual([])
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
    expect(registered()).toEqual([])
  })
})

describe('关掉', () => {
  /** 关掉必须什么都不剩——这个功能的整个卖点就是它不在页面上留东西。 */
  it('清空注册项，页面回到原样', () => {
    const before = document.body.innerHTML
    highlighter.start([entry({})])
    highlighter.stop()

    expect(registered()).toEqual([])
    expect(document.body.innerHTML).toBe(before)
  })

  it('停了之后词库再变也不会又画上去', () => {
    highlighter.start([entry({})])
    highlighter.stop()

    highlighter.setEntries([entry({})])
    expect(registered()).toEqual([])
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

describe('按熟悉度上色', () => {
  /**
   * 一个词库里的词该被标成什么颜色，取决于读者对它有多熟。
   *
   * 一个 Highlight 只带一套样式，所以四种颜色只能拆成四个注册项——这里钉死的是
   * 「哪个词进了哪一桶」，而不是颜色本身（颜色在 styles.test.ts 里量）。
   */
  beforeEach(() => {
    document.body.innerHTML = '<p>A database migration follows the schema.</p>'
  })

  const migration = (level: 0 | 1 | 2 | 3) =>
    entry({ id: 'a', word: 'migration', normalized: 'migration', lemma: 'migration', level })
  const schema = (level: 0 | 1 | 2 | 3) =>
    entry({ id: 'b', word: 'schema', normalized: 'schema', lemma: 'schema', level })

  it('两个熟悉度不同的词进两个不同的注册项', () => {
    highlighter.start([migration(0), schema(2)])

    expect(paintedAt(0).map((range) => range.toString())).toEqual(['migration'])
    expect(paintedAt(2).map((range) => range.toString())).toEqual(['schema'])
    expect(paintedAt(1)).toHaveLength(0)
  })

  /**
   * 以前只有一个名字，「一处都没命中就删掉」够用。拆成四个之后不够了：
   * 读者把最后一个 1 级的词复习升上去，1 级那一桶就空了——不删的话，
   * 那些已经作废的 Range 会一直画在页面上，而且从此再也不更新。
   */
  it('一个等级空掉之后，它的注册项要删掉，不能留着旧的 Range', () => {
    highlighter.start([migration(1)])
    expect(registered()).toEqual([highlightNameFor(1)])

    highlighter.setEntries([migration(2)])
    expect(registered()).toEqual([highlightNameFor(2)])
  })

  /**
   * `review` 在类型上是必填，但数据来自本地存储和另一台设备的同步。
   * 一条缺字段的记录不该让整页高亮消失——这一层是画在别人的页面上的。
   */
  it('记录里没有复习状态时当 0 级画，而不是抛异常', () => {
    expect(() => highlighter.start([entry({})])).not.toThrow()
    expect(paintedAt(0)).toHaveLength(1)
  })
})

describe('已经掌握的词', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p>A database migration follows the schema.</p>'
  })

  const mastered = entry({ id: 'a', normalized: 'migration', lemma: 'migration', level: 3 })

  it('关掉之后既不画，也点不开——它根本不该成为一次命中', () => {
    highlighter.start([mastered], { showMastered: false })

    expect(painted()).toHaveLength(0)
    expect(registered()).toEqual([])
  })

  it('拨回来立刻重画，不必等页面下一次变动', () => {
    highlighter.start([mastered], { showMastered: false })
    expect(painted()).toHaveLength(0)

    highlighter.setOptions({ showMastered: true })
    expect(paintedAt(3)).toHaveLength(1)
  })

  /** 关掉时那条 CSS 规则也不发出去——宿主页面每多背一个名字都要多解一份样式。 */
  it('关掉时连那一级的 CSS 规则都不注入', () => {
    highlighter.start([mastered], { showMastered: false })

    const css = document.getElementById(HIGHLIGHT_STYLE_ID)?.textContent ?? ''
    expect(css).not.toContain('::highlight(fanfan-saved-3) {')
  })
})

describe('底色', () => {
  /**
   * 这是那个 bug 的回归测试。
   *
   * 原来深色那套挂在 `@media (prefers-color-scheme: dark)` 下面，问的是**操作系统**；
   * 而 chatgpt.com 在浅色系统上照样是深色页，于是浅底用的 0.16 橙画在近黑背景上，
   * 直接消失。现在是从页面上量出来的。
   *
   * 顺带一提：jsdom 里 `@media` 规则**永远不匹配**，所以只要那套还挂在媒体查询下面，
   * 这条测试就根本写不出来——这也是把它改成一个纯函数的另一半理由。
   */
  const injectedCss = () => document.getElementById(HIGHLIGHT_STYLE_ID)?.textContent ?? ''

  it('页面自己是深色时用深底那套，哪怕操作系统是浅色', () => {
    document.body.style.backgroundColor = '#0d0d0d'
    highlighter.start([entry({})])

    expect(document.documentElement.getAttribute(BACKDROP_ATTRIBUTE)).toBe('dark')
    expect(injectedCss()).toContain('rgba(255, 106, 61, 0.26)')
    expect(injectedCss()).not.toContain('rgba(255, 106, 61, 0.3)')
  })

  it('浅色页面用浅底那套', () => {
    document.body.style.backgroundColor = '#ffffff'
    highlighter.start([entry({})])

    expect(document.documentElement.getAttribute(BACKDROP_ATTRIBUTE)).toBe('light')
    expect(injectedCss()).toContain('rgba(255, 106, 61, 0.3)')
  })

  /** 关掉之后一个痕迹都不留——包括那张表和那个属性。 */
  it('关掉之后样式表和属性都不留在页面上', () => {
    document.body.style.backgroundColor = '#0d0d0d'
    highlighter.start([entry({})])
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)).not.toBeNull()

    highlighter.stop()

    expect(document.getElementById(HIGHLIGHT_STYLE_ID)).toBeNull()
    expect(document.documentElement.hasAttribute(BACKDROP_ATTRIBUTE)).toBe(false)
  })
})
