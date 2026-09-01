// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKDROP_ATTRIBUTE,
  BACKDROP_PIVOT,
  averageGradientStops,
  backdropFromTextColor,
  backdropOf,
  canvasColor,
  classify,
  compositeOver,
  imageDataToRgba,
  parseColor,
  relativeLuminance,
  readElementStyle,
  samplePageBackdrop,
  watchPageBackdrop,
  type ElementStyle,
  type Rgba,
  type StyleReader,
} from './backdrop.ts'

/**
 * 「这个词的背后是深是浅」。
 *
 * 这一层修的是一个**安静的** bug：深色那套原来挂在 `@media (prefers-color-scheme: dark)`
 * 下面，问的是操作系统；而 chatgpt.com 在浅色系统上照样是深色页，于是浅底的洗色
 * 画在近黑背景上直接消失。页面上没有报错，控制台里没有报错，它看起来只是「没用」。
 *
 * 所以这里的用例大半在测**判错的那些路**：半透明的卡片、渐变、图片、
 * `display: contents`、整页反色，以及一层背景都没有时该退回哪里。
 */

const style = (over: Partial<ElementStyle> = {}): ElementStyle => ({
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  color: 'rgb(0, 0, 0)',
  display: 'block',
  opacity: '1',
  filter: 'none',
  backdropFilter: 'none',
  colorScheme: 'normal',
  ...over,
})

/** 用一张表当样式来源：不必去搭真实的层叠，也就不会连带测到 jsdom 的实现。 */
const reader = (table: Map<Element, Partial<ElementStyle>>): StyleReader =>
  (element) => style(table.get(element))

const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a })

describe('解析颜色', () => {
  it('认得 rgb 和 rgba', () => {
    expect(parseColor('rgb(13, 13, 13)')).toEqual(rgba(13, 13, 13))
    expect(parseColor('rgba(255, 106, 61, 0.3)')).toEqual(rgba(255, 106, 61, 0.3))
  })

  /** Chrome 的现代写法：斜杠分隔的 alpha，还可能是百分比。 */
  it('认得斜杠写法和百分号 alpha', () => {
    expect(parseColor('rgb(10 20 30 / 0.5)')).toEqual(rgba(10, 20, 30, 0.5))
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual(rgba(10, 20, 30, 0.5))
  })

  it('认得三位、六位和带 alpha 的八位十六进制', () => {
    expect(parseColor('#fff')).toEqual(rgba(255, 255, 255))
    expect(parseColor('#0d1117')).toEqual(rgba(13, 17, 23))
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 2)
  })

  /**
   * 慢路那一格像素。
   *
   * `getImageData` 给的是**没有**预乘的 RGBA。这里曾经又除了一次 alpha，
   * 后果不是「有点偏」而是彻底反过来：Tailwind v4 的 `bg-white/5` 算出来是
   * `oklab(... / 0.06)`（只有慢路认得），除两次之后通道变成四千多，亮度 1.16，
   * 于是近黑的页面被判成浅色——这一整个模块要修的那个 bug，由修它的代码亲手重演。
   *
   * 单独测这一步，是因为 jsdom 里没有 OffscreenCanvas，慢路整条跑不到。
   */
  it('画布那一格像素不再被多除一次 alpha', () => {
    expect(imageDataToRgba([255, 255, 255, 13])).toMatchObject({ r: 255, g: 255, b: 255 })
    expect(imageDataToRgba([255, 255, 255, 13]).a).toBeCloseTo(0.051, 3)
    expect(imageDataToRgba([0, 0, 0, 0])).toEqual(rgba(0, 0, 0, 0))
  })

  /** 「没设背景」和「设成透明」是同一件事：往上再找一层。 */
  it('空字符串和 transparent 都是完全透明', () => {
    expect(parseColor('')).toEqual(rgba(0, 0, 0, 0))
    expect(parseColor('transparent')).toEqual(rgba(0, 0, 0, 0))
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual(rgba(0, 0, 0, 0))
  })
})

describe('合成与亮度', () => {
  it('半透明白压在黑上是中灰', () => {
    expect(compositeOver(rgba(255, 255, 255, 0.5), rgba(0, 0, 0))).toMatchObject({
      r: 127.5,
      g: 127.5,
      b: 127.5,
    })
  })

  it('完全透明的一层等于没有这一层', () => {
    expect(compositeOver(rgba(255, 255, 255, 0), rgba(13, 13, 13))).toEqual(rgba(13, 13, 13))
  })

  it('白是 1，黑是 0', () => {
    expect(relativeLuminance(rgba(255, 255, 255))).toBeCloseTo(1, 6)
    expect(relativeLuminance(rgba(0, 0, 0))).toBeCloseTo(0, 6)
  })

  it('渐变取色标的平均色，图片则认不出来', () => {
    const average = averageGradientStops(
      'linear-gradient(rgb(0, 0, 0) 0%, rgb(100, 100, 100) 100%)',
    )
    expect(average).toMatchObject({ r: 50, g: 50, b: 50 })
    expect(averageGradientStops('url("photo.jpg")')).toBeNull()
  })
})

describe('深浅的分界线', () => {
  /**
   * 分界取的是对比枢轴：黑字和白字在这个亮度上对比度相等。
   * 不用 `(r+g+b)/3 > 128`，那个的真实亮度高得多，会把大量中蓝色的页面框架判成浅色。
   */
  it('枢轴落在 0.179 附近，也就是 #757575 那一档', () => {
    expect(BACKDROP_PIVOT).toBeCloseTo(0.1791, 4)
    expect(classify(relativeLuminance(rgba(255, 255, 255)))).toBe('light')
    expect(classify(relativeLuminance(rgba(13, 13, 13)))).toBe('dark')
    expect(classify(relativeLuminance(rgba(59, 91, 192)))).toBe('dark')
  })

  /**
   * 迟滞。换主题带过渡动画，采样落在中途时亮度会在分界线附近来回跨——
   * 没有迟滞的话，那几百毫秒里整张 CSS 表被换来换去，页面上就是高亮在闪。
   */
  it('已经判成深色时，要亮过一截才改口', () => {
    expect(classify(0.2, 'dark')).toBe('dark')
    expect(classify(0.27, 'dark')).toBe('light')
  })

  it('已经判成浅色时，要暗过一截才改口', () => {
    expect(classify(0.17, 'light')).toBe('light')
    expect(classify(0.15, 'light')).toBe('dark')
  })

  it('字很亮说明底很深，中间那段灰不表态', () => {
    expect(backdropFromTextColor('rgb(236, 236, 236)')).toBe('dark')
    expect(backdropFromTextColor('rgb(26, 26, 26)')).toBe('light')
    expect(backdropFromTextColor('rgb(136, 136, 136)')).toBeNull()
  })

  it('一层背景都没有时，画布颜色跟着 color-scheme 走', () => {
    expect(canvasColor({ colorScheme: 'normal', prefersDark: false })).toEqual(rgba(255, 255, 255))
    expect(canvasColor({ colorScheme: 'dark', prefersDark: false })).toEqual(rgba(18, 18, 18))
    // 声明成两种都行时，才轮到系统偏好说话。
    expect(canvasColor({ colorScheme: 'light dark', prefersDark: true })).toEqual(rgba(18, 18, 18))
    expect(canvasColor({ colorScheme: 'light dark', prefersDark: false })).toEqual(
      rgba(255, 255, 255),
    )
  })
})

describe('往上走一趟', () => {
  let root: HTMLElement
  let card: HTMLElement
  let text: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div id="card"><p id="text">hi</p></div></div>'
    root = document.getElementById('root')!
    card = document.getElementById('card')!
    text = document.getElementById('text')!
  })

  /**
   * 这是最要紧的一条。
   *
   * `rgba(255,255,255,0.06)` 铺在近黑的底上，是 GitHub 深色、X、Discord 和每一套
   * Material / Tailwind 深色主题做卡片的标准写法。「取第一个非透明的祖先」会拿到
   * **白色**，判成浅底——那正是这次要修的 bug，换个地方重演。
   */
  it('近黑底上那层 6% 的白卡片，判出来仍然是深色', () => {
    const read = reader(
      new Map([
        [card, { backgroundColor: 'rgba(255, 255, 255, 0.06)' }],
        [root, { backgroundColor: 'rgb(13, 13, 13)' }],
      ]),
    )

    const sample = backdropOf(text, read)
    expect(sample.certain).toBe(true)
    expect(classify(relativeLuminance(sample.color))).toBe('dark')
  })

  /** `display: contents` 不生成盒子，它的背景永远画不出来——但计算样式照样报给你。 */
  it('display: contents 那一层的背景不算数', () => {
    const read = reader(
      new Map([
        [card, { backgroundColor: 'rgb(255, 255, 255)', display: 'contents' }],
        [root, { backgroundColor: 'rgb(13, 13, 13)' }],
      ]),
    )

    expect(classify(relativeLuminance(backdropOf(text, read).color))).toBe('dark')
  })

  it('祖先上的 opacity 会把它自己的背景一起冲淡', () => {
    const read = reader(
      new Map([
        [card, { backgroundColor: 'rgb(255, 255, 255)', opacity: '0.5' }],
        [root, { backgroundColor: 'rgb(0, 0, 0)' }],
      ]),
    )

    expect(backdropOf(text, read).color.r).toBeCloseTo(127.5, 1)
  })

  /** 图片和 backdrop-filter 静态都读不出来。读不出来要**说**读不出来，而不是猜。 */
  it('背景是图片或者 backdrop-filter 时，如实说自己没把握', () => {
    const image = reader(new Map([[card, { backgroundImage: 'url("photo.jpg")' }]]))
    expect(backdropOf(text, image).certain).toBe(false)

    const blurred = reader(new Map([[card, { backdropFilter: 'blur(8px)' }]]))
    expect(backdropOf(text, blurred).certain).toBe(false)
  })

  /**
   * Dark Reader 的滤镜模式给整页套 `invert(1)`。我们读到的每个颜色都是**滤镜之前**的，
   * 于是屏幕漆黑而我们算出「浅色」。
   */
  it('整页反色时把结论也反过来', () => {
    const read = reader(
      new Map([
        [document.documentElement, { filter: 'invert(1) hue-rotate(180deg)' }],
        [root, { backgroundColor: 'rgb(255, 255, 255)' }],
      ]),
    )

    expect(classify(relativeLuminance(backdropOf(text, read).color))).toBe('dark')
  })

  /**
   * 同一个元素上，背景图画在背景色**上面**。
   *
   * 写反了的后果是整个判反：一个深底 + 一层不透明白渐变的元素，浏览器画出来是白的，
   * 而我们会说它是深色。
   */
  it('同一个元素上，背景图压在背景色上面', () => {
    const read = reader(
      new Map([
        [
          card,
          {
            backgroundColor: 'rgb(13, 13, 13)',
            backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255))',
          },
        ],
      ]),
    )

    expect(backdropOf(text, read).color).toMatchObject({ r: 255, g: 255, b: 255 })
    expect(classify(relativeLuminance(backdropOf(text, read).color))).toBe('light')
  })

  it('半透明的渐变压在不透明的背景色上，两层都要算进去', () => {
    const read = reader(
      new Map([
        [
          card,
          {
            backgroundColor: 'rgb(255, 255, 255)',
            backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0.9), rgba(0, 0, 0, 0.9))',
          },
        ],
      ]),
    )

    expect(backdropOf(text, read).color.r).toBeCloseTo(25.5, 1)
  })

  /**
   * 只看有没有 `invert(` 这几个字是不够的。
   *
   * 把主题写成 `invert(0)`（浅色态）和 `invert(1)`（深色态）是很自然的写法，
   * 子串判断会把浅色态也当成反色，于是一张白页被判成深色。
   */
  it('invert(0) 不算反色', () => {
    const read = reader(
      new Map([
        [document.documentElement, { filter: 'invert(0) hue-rotate(0deg)' }],
        [root, { backgroundColor: 'rgb(255, 255, 255)' }],
      ]),
    )

    expect(classify(relativeLuminance(backdropOf(text, read).color))).toBe('light')
  })

  it('反两次等于没反', () => {
    const read = reader(
      new Map([
        [document.documentElement, { filter: 'invert(1)' }],
        [card, { filter: 'invert(100%)' }],
        [root, { backgroundColor: 'rgb(255, 255, 255)' }],
      ]),
    )

    expect(classify(relativeLuminance(backdropOf(text, read).color))).toBe('light')
  })

  /** 一篇文章里几百处命中共用同一根「脊椎」，不做路径压缩就要把它反复走上几百遍。 */
  it('把答案写回沿途每一个元素', () => {
    const memo = new Map<Element, Rgba>()
    const read = reader(new Map([[root, { backgroundColor: 'rgb(13, 13, 13)' }]]))

    backdropOf(text, read, { memo })

    expect(memo.get(text)).toBeDefined()
    expect(memo.get(card)).toBeDefined()
    expect(memo.get(root)).toBeDefined()
  })
})

describe('量这一页', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
  })

  it('页面自己是深色时判深色，不问操作系统', () => {
    document.body.style.backgroundColor = '#0d0d0d'
    expect(samplePageBackdrop(document)).toBe('dark')
  })

  it('页面自己是浅色时判浅色', () => {
    document.body.style.backgroundColor = '#ffffff'
    expect(samplePageBackdrop(document)).toBe('light')
  })

  /**
   * 一层背景都没有、又量不准时，先看字的颜色。
   *
   * 它排在 `color-scheme` 和系统偏好**前面**是有理由的：那两个说的是意图，
   * 字的颜色说的是此刻真的画在屏幕上的东西——而且站点正是照着「背后是什么」挑的它。
   */
  it('背景读不出来时，拿字的颜色反推', () => {
    document.body.style.backgroundImage = 'url("photo.jpg")'
    document.body.style.color = '#ececec'
    expect(samplePageBackdrop(document)).toBe('dark')
  })

  /**
   * jsdom 里 `matchMedia` 不是个函数，**调它会抛**。不探一探就用的话，
   * 整个翻翻模式的测试会在第一行就炸掉——这条守的是那个。
   */
  it('环境里没有 matchMedia 也不抛异常', () => {
    expect(typeof window.matchMedia).not.toBe('function')
    expect(() => samplePageBackdrop(document)).not.toThrow()
  })

  it('系统偏好只在页面自己不表态时才轮得到说话', () => {
    document.body.style.backgroundColor = '#ffffff'
    expect(samplePageBackdrop(document, undefined, { prefersDark: () => true })).toBe('light')
  })
})

describe('盯着主题变', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('class')
    document.body.removeAttribute('style')
  })

  /**
   * 不列属性名：Tailwind 用 class，GitHub 用 data-color-mode，下一个站会自己发明一个。
   * 只盯 html 和 body 两个节点，任何属性变了就重新量一次。
   */
  it('站点换主题时重新量一次', async () => {
    document.body.style.backgroundColor = '#ffffff'
    const seen: string[] = []
    const watch = watchPageBackdrop((value) => seen.push(value))
    expect(seen).toEqual(['light'])

    document.body.style.backgroundColor = '#0d0d0d'
    document.documentElement.setAttribute('class', 'dark')
    await vi.advanceTimersByTimeAsync(250)

    expect(seen).toEqual(['light', 'dark'])
    watch.stop()
  })

  /**
   * 我们自己写在 html 上的属性不算「页面变了」。不滤掉的话，
   * applyBackdropAttribute 写下的结果会再触发一次量——一个自己喂自己的循环。
   */
  it('我们自己那几个属性不触发重量', async () => {
    document.body.style.backgroundColor = '#ffffff'
    let reads = 0
    const read: StyleReader = (element) => {
      reads++
      return readElementStyle(element)
    }
    const watch = watchPageBackdrop(() => undefined, { read })

    const before = reads
    document.documentElement.setAttribute(BACKDROP_ATTRIBUTE, 'light')
    document.documentElement.setAttribute('data-fanfan-word-hover', '')
    await vi.advanceTimersByTimeAsync(700)

    expect(reads).toBe(before)
    watch.stop()
    document.documentElement.removeAttribute(BACKDROP_ATTRIBUTE)
    document.documentElement.removeAttribute('data-fanfan-word-hover')
  })

  /** 换主题基本都带过渡动画，t=0 那一下拿到的是旧颜色。所以过一会儿再量一次。 */
  it('过渡动画走完之后再量一次，接住慢慢变过去的颜色', async () => {
    document.body.style.backgroundColor = '#ffffff'
    const seen: string[] = []
    const watch = watchPageBackdrop((value) => seen.push(value))

    document.documentElement.setAttribute('class', 'dark')
    await vi.advanceTimersByTimeAsync(250)
    expect(seen).toEqual(['light'])

    // 过渡走完，背景色这时才真的变过去。
    document.body.style.backgroundColor = '#0d0d0d'
    await vi.advanceTimersByTimeAsync(500)

    expect(seen).toEqual(['light', 'dark'])
    watch.stop()
  })
})
