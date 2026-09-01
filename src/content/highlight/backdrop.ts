import { debounce } from '@/shared/utils.ts'

/**
 * 这一页的底色到底是深是浅。
 *
 * 翻翻模式的高亮是一层半透明的洗色，它必须**压在**页面本来的底色上才看得见——
 * 浅底上要用深一点的，深底上要用浅一点的。原来这件事交给
 * `@media (prefers-color-scheme: dark)`，那是错的，而且错得很安静：
 *
 * 媒体查询问的是**操作系统**是不是深色，而 chatgpt.com、GitHub、X 这些站点的
 * 深色是自己切的，和操作系统无关。一个把系统留在浅色、把 ChatGPT 开成深色的读者，
 * 拿到的是「浅底用的洗色」画在近黑的背景上——那层 0.16 的橙直接消失。
 * 页面上什么都没有，控制台里什么都没有，它看起来就只是「这个功能没用」。
 *
 * 所以这里不问系统，直接**量**：从正文往上走，把沿途每一层背景合成起来，
 * 算出真正画在文字底下的那个颜色，再看它的相对亮度。
 *
 * 全套算术都是纯函数，DOM 只从一个注入进来的 {@link StyleReader} 读。
 * 这不是为了好看：vitest 默认跑在 node 环境里，而 jsdom 连 `matchMedia` 都没有
 * （调它是**抛异常**，不是返回 false）——把读样式这一下拎出来，
 * 才能在没有浏览器的地方把阈值、合成、回退顺序逐条测掉。
 */

/** sRGB 0-255，alpha 0-1。 */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** 只有两档。中间那一档为什么不做，见 {@link classify}。 */
export type Backdrop = 'light' | 'dark'

/** `<html>` 上那个属性。只是个看得见的接缝——给 devtools 和测试看，不参与层叠。 */
export const BACKDROP_ATTRIBUTE = 'data-fanfan-backdrop'

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
/** Chrome 在 `color-scheme: dark` 下画的画布底色，不是纯黑。 */
const DARK_CANVAS: Rgba = { r: 18, g: 18, b: 18, a: 1 }

/**
 * 一个元素上我们要看的那几样。
 *
 * 收成一个对象而不是直接传 `CSSStyleDeclaration`，是为了让测试能手写一层假的背景，
 * 不必去搭一棵真的 DOM 树。
 */
export interface ElementStyle {
  backgroundColor: string
  backgroundImage: string
  color: string
  display: string
  opacity: string
  filter: string
  backdropFilter: string
  /** 只在根元素上读得有意义，见 {@link canvasColor}。 */
  colorScheme: string
}

export type StyleReader = (element: Element) => ElementStyle

/** 真·读样式。缺的字段一律退回「什么都没设」，jsdom 里有几样是 undefined。 */
export const readElementStyle: StyleReader = (element) => {
  const style = getComputedStyle(element) as CSSStyleDeclaration & {
    webkitBackdropFilter?: string
  }
  return {
    backgroundColor: style.backgroundColor || '',
    backgroundImage: style.backgroundImage || 'none',
    color: style.color || '',
    display: style.display || '',
    opacity: style.opacity || '1',
    filter: style.filter || 'none',
    backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
    colorScheme: style.colorScheme || '',
  }
}

const RGB_PATTERN =
  /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i
const HEX_PATTERN = /^#([\da-f]{3,8})$/i

const colorCache = new Map<string, Rgba | null>()

/**
 * 颜色字符串 → 数字。
 *
 * 快路只认 `rgb()` / `rgba()` / `#hex`，慢路把剩下的交给浏览器自己去解析。
 * 慢路不是可选的：Chrome 按**使用的颜色空间**序列化计算值，而 Tailwind v4 的
 * 默认调色板是 OKLCH——那种站点上 `background-color` 拿到手是
 * `oklch(0.21 0.006 285.9)`，用 rgb 的正则去套只会返回 null，
 * 于是一整块实心的深色卡片被当成「透明」，继续往上找，最后量到一个白色的画布。
 * 这正是要修的那个 bug，换了个地方重演。
 *
 * 慢路用 `OffscreenCanvas`：它不进页面的节点树，一个字节都不动别人的文档。
 */
export function parseColor(css: string): Rgba | null {
  const key = css.trim()
  if (!key) return TRANSPARENT
  if (key === 'transparent') return TRANSPARENT
  const cached = colorCache.get(key)
  if (cached !== undefined) return cached

  const parsed = parseRgb(key) ?? parseHex(key) ?? rasterise(key)
  colorCache.set(key, parsed)
  return parsed
}

function parseRgb(css: string): Rgba | null {
  const match = RGB_PATTERN.exec(css)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1)
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: Number.isFinite(alpha) ? alpha : 1,
  }
}

function parseHex(css: string): Rgba | null {
  const match = HEX_PATTERN.exec(css)
  if (!match) return null
  const digits = match[1]!
  const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16)
  const size = digits.length <= 4 ? 1 : 2
  if (digits.length !== size * 3 && digits.length !== size * 4) return null
  const at = (index: number): string => digits.slice(index * size, index * size + size)
  return {
    r: expand(at(0)),
    g: expand(at(1)),
    b: expand(at(2)),
    a: digits.length === size * 4 ? expand(at(3)) / 255 : 1,
  }
}

let canvas: OffscreenCanvasRenderingContext2D | null | undefined

/** 让浏览器自己去解析它认得而我们不认得的那些写法（oklch、color-mix、lab…）。 */
function rasterise(css: string): Rgba | null {
  if (canvas === undefined) {
    canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })
        : null
  }
  const context = canvas
  if (!context) return null

  try {
    // fillStyle 认不出来的值会被原样忽略，所以先放一个哨兵：赋值之后还是它，
    // 就说明这个字符串浏览器也不认。
    context.fillStyle = '#000000'
    context.fillStyle = css
    if (context.fillStyle === '#000000' && !/^(#000(000)?|black)$/i.test(css.trim())) return null

    context.clearRect(0, 0, 1, 1)
    context.fillRect(0, 0, 1, 1)
    return imageDataToRgba(context.getImageData(0, 0, 1, 1).data)
  } catch {
    return null
  }
}

/**
 * 画布上那一个像素 → 颜色。
 *
 * `getImageData` 给的是**没有**预乘的 RGBA：通道本身就是 0-255，只有 alpha 要除回 0-1。
 * （预乘只存在于画布的后备存储里；规范里说 put/getImageData 往返有损，损的正是这一步
 * 来回换算。）这里曾经又除了一次 alpha，后果不是「有点偏」而是彻底反过来——
 * 一个 6% 的白（Tailwind v4 的 `bg-white/5` 计算出来是 `oklab(... / 0.06)`，
 * 只有慢路认得）会被算成通道 4335 的颜色，亮度 1.16，于是近黑的页面被判成浅色，
 * 浅底那套洗色画在近黑背景上——正是这一整个改动要修的那个 bug，由修它的代码亲手重演。
 *
 * 单独拎出来是为了能测：jsdom 里没有 `OffscreenCanvas`，慢路整条跑不到。
 */
export function imageDataToRgba(data: ArrayLike<number>): Rgba {
  const [r, g, b, a] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
  if (a === 0) return TRANSPARENT
  return { r, g, b, a: a / 255 }
}

/**
 * 渐变里那几个色标的平均色。
 *
 * 计算值里的色标已经是具体颜色了，拿得到。取平均在这里够用：一段用在正文背后的
 * 渐变，明暗上基本是同一档——它要是不同档，正文自己先读不下去了。
 * `url()` 一律放弃，那是图片，静态读不出来（见 {@link backdropOf} 的 certain）。
 */
export function averageGradientStops(backgroundImage: string): Rgba | null {
  if (!backgroundImage || backgroundImage === 'none') return null
  if (backgroundImage.includes('url(')) return null

  const stops = backgroundImage.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi)
  if (!stops || stops.length === 0) return null

  const colors = stops.map(parseColor).filter((color): color is Rgba => color !== null)
  if (colors.length === 0) return null

  const total = colors.reduce(
    (sum, color) => ({
      r: sum.r + color.r,
      g: sum.g + color.g,
      b: sum.b + color.b,
      a: sum.a + color.a,
    }),
    { r: 0, g: 0, b: 0, a: 0 },
  )
  return {
    r: total.r / colors.length,
    g: total.g / colors.length,
    b: total.b / colors.length,
    a: total.a / colors.length,
  }
}

/** source-over。浏览器合成背景色是在 gamma 编码的 sRGB 里做的，所以就是逐通道插值。 */
export function compositeOver(source: Rgba, target: Rgba): Rgba {
  if (source.a <= 0) return target
  if (source.a >= 1) return source
  const alpha = source.a + target.a * (1 - source.a)
  const mix = (from: number, to: number): number => source.a * from + (1 - source.a) * to
  return { r: mix(source.r, target.r), g: mix(source.g, target.g), b: mix(source.b, target.b), a: alpha }
}

/** WCAG 相对亮度。 */
export function relativeLuminance(color: Rgba): number {
  const channel = (value: number): number => {
    // 夹一道。任何一条解析路径给出越界的通道值，都会在这里变成一个荒谬的亮度，
    // 而亮度荒谬的后果是深浅判反——那是这一整个模块要修的那个 bug。
    const c = Math.min(Math.max(value, 0), 255) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * 分界线取的是**对比枢轴**：在这个亮度上，黑字和白字的对比度正好相等。
 *
 * `(Y+0.05)/0.05 = 1.05/(Y+0.05)` → `Y = √0.0525 − 0.05 ≈ 0.1791`（约 #757575）。
 * 它离 CIE 的感知中点（L* 50，Y ≈ 0.1842）不到 3%，两套完全不同的推导落在同一处，
 * 是个好兆头。不要用 `(r+g+b)/3 > 128` 或者 YIQ 那个 128：它们的真实亮度高得多，
 * 会把网页上大量的中蓝色框架判成浅色。
 */
export const BACKDROP_PIVOT = Math.sqrt(0.0525) - 0.05

/*
 * 迟滞。
 *
 * 换主题是有过渡动画的，采样正好落在中间时亮度会在分界线附近来回跨。没有迟滞的话
 * 那几百毫秒里整张 CSS 表会被换来换去——页面上就是高亮在闪。
 * 已经判成深色，要亮到 0.26 才改口；已经判成浅色，要暗到 0.16 才改口。
 */
const STAY_DARK_BELOW = 0.26
const STAY_LIGHT_ABOVE = 0.16

/**
 * 亮度 → 深浅。
 *
 * **不做第三档「中间灰」。** 三个理由，按分量排：一是 4 级 × 3 底 = 12 个要手调的
 * 颜色，没人调得完十二个，最后那一列一定是插值出来的，比左右两边都难看；
 * 二是中灰本来就极少当正文的底——真拿 #7c7c7c 垫在文字后面的站点，
 * 它自己的对比度先不合格了；三是真遇到说不准的情况，正确的答案不是再来一种颜色，
 * 而是一种**判错了也还成立**的画法（见 backdrop 判不准时的回退）。
 */
export function classify(luminance: number, previous?: Backdrop): Backdrop {
  if (previous === 'dark') return luminance >= STAY_DARK_BELOW ? 'light' : 'dark'
  if (previous === 'light') return luminance < STAY_LIGHT_ABOVE ? 'dark' : 'light'
  return luminance < BACKDROP_PIVOT ? 'dark' : 'light'
}

/**
 * 拿字的颜色反推底色。
 *
 * 背景是图片、是渐变、是 `backdrop-filter`——这些静态都读不出来，而字的颜色永远读得出来，
 * 并且**恰恰是站点照着「背后到底是什么」挑的那一个**。所以它比 `color-scheme` 和系统偏好
 * 都更接近事实：那两个说的是意图，这个说的是此刻真的画在屏幕上的东西。
 *
 * 要求它足够决断：中间那段灰（`#888` 两种主题下都常见）返回 null 往下走，
 * 而那一段本来也不影响结果。
 */
export function backdropFromTextColor(css: string): Backdrop | null {
  const color = parseColor(css)
  if (!color || color.a === 0) return null
  const luminance = relativeLuminance(color)
  if (luminance > 0.5) return 'dark'
  if (luminance < 0.08) return 'light'
  return null
}

export interface Environment {
  /** `getComputedStyle(html).colorScheme` —— 注意它给的是**声明的那一串**，不是解析结果。 */
  colorScheme: string
  prefersDark: boolean
}

/**
 * 一层背景都没有时，浏览器画的那块底。
 *
 * `<html>` 没有背景就用 `<body>` 的，两个都没有就是画布——白色，
 * 除非根元素的 `color-scheme` 是深色，那时 Chrome 画的是 #121212。
 */
export function canvasColor(environment: Environment): Rgba {
  const list = environment.colorScheme.toLowerCase()
  const dark = list.includes('dark') && (!list.includes('light') || environment.prefersDark)
  return dark ? DARK_CANVAS : WHITE
}

const MAX_DEPTH = 32

const INVERT_PATTERN = /\binvert\(\s*([\d.]+)\s*(%?)\s*\)/gi

/**
 * 这条 filter 到底把像素反过来了没有。
 *
 * 不能只看有没有 `invert(` 这几个字：把主题写成 `filter: invert(0)`（浅色态）和
 * `filter: invert(1)`（深色态）是很自然的写法，而子串判断会把浅色态也当成反色，
 * 于是一张白页被判成深色。
 *
 * `invert(a)` 是仿射的：`x → a + x(1 - 2a)`，斜率 `1 - 2a`。一串连乘，
 * 负数才是真的反过来了——这也顺带让「反两次」正确地等于没反。
 */
function invertsPixels(filter: string): boolean {
  if (!filter.includes('invert(')) return false
  let slope = 1
  for (const match of filter.matchAll(INVERT_PATTERN)) {
    const amount = Number(match[1]) / (match[2] === '%' ? 100 : 1)
    if (Number.isFinite(amount)) slope *= 1 - 2 * Math.min(Math.max(amount, 0), 1)
  }
  return slope < 0
}

export interface BackdropSample {
  color: Rgba
  /** 量得准不准。图片背景、`backdrop-filter`、混合模式都会让它变 false。 */
  certain: boolean
}

/**
 * 从这个元素往上走，把沿途的背景合成出来。
 *
 * 「取第一个不透明的祖先」是错的，而且错在最常见的那种深色页面上：
 * `rgba(255,255,255,0.06)` 铺在近黑的 body 上——GitHub 深色、X、Discord，
 * 以及每一套 Material / Tailwind 深色主题，卡片都是这么做的。取第一个非透明的
 * 会拿到**白色**，判成浅底，把浅底的洗色画在近黑的卡片上。合成不是优化，是修 bug。
 */
export function backdropOf(
  start: Element,
  read: StyleReader,
  options: { base?: Rgba; memo?: Map<Element, Rgba> } = {},
): BackdropSample {
  const base = options.base ?? WHITE
  const memo = options.memo
  const layers: Rgba[] = []
  const walked: Element[] = []
  let element: Element | null = start
  let depth = 0
  let inverted = false
  let certain = true
  let cached: Rgba | null = null

  while (element && depth++ < MAX_DEPTH) {
    const remembered = memo?.get(element)
    if (remembered) {
      cached = remembered
      break
    }
    walked.push(element)

    const style = read(element)

    // display: contents 不生成盒子，它的背景永远画不出来——但 getComputedStyle
    // 照样如实报给你。这一条不跳过，就会拿一个根本没画的颜色去当底。
    if (style.display === 'contents') {
      element = element.parentElement
      continue
    }

    // Dark Reader 的滤镜模式：整页 invert(1)。我们读到的每一个颜色都是**滤镜之前**的值，
    // 于是屏幕漆黑而我们算出「浅色」。三行代码，覆盖的正是最需要这个功能的一批人。
    if (invertsPixels(style.filter)) inverted = !inverted

    // 背后画的是别的东西的模糊拷贝——可能是一个滚到下面去的兄弟节点，静态推不出来。
    if (style.backdropFilter !== 'none') {
      certain = false
      break
    }

    const opacity = Number(style.opacity)
    const scale = Number.isFinite(opacity) ? opacity : 1

    /*
     * 同一个元素上，背景图画在背景色**上面**。
     *
     * layers 的约定是「下标越小越靠上」，所以图要先 push、色后 push。
     * 反过来写的话，一个深色底 + 一层不透明白渐变的元素会被算成深色——
     * 而浏览器画出来是白的。
     */
    if (style.backgroundImage !== 'none') {
      const gradient = averageGradientStops(style.backgroundImage)
      if (gradient) layers.push({ ...gradient, a: gradient.a * scale })
      else {
        certain = false
        break
      }
    }

    const color = parseColor(style.backgroundColor)
    if (color && color.a > 0) layers.push({ ...color, a: color.a * scale })

    if ((layers[layers.length - 1]?.a ?? 0) >= 0.999) break
    element = element.parentElement
  }

  /*
   * 反色滤镜要一路查到根，哪怕背景早就找齐了。
   *
   * Dark Reader 把 `filter: invert(1)` 挂在 `<html>` 上，而正文往往在 body 或者
   * 更下面就已经碰到一层不透明的背景——上面那个循环到那里就停了，
   * 于是滤镜永远看不见。它影响的是**整棵子树**画出来的样子，所以必须单独走完。
   * 通常只多读一两个元素。
   */
  let above: Element | null = element?.parentElement ?? null
  let extra = 0
  while (above && extra++ < MAX_DEPTH) {
    if (invertsPixels(read(above).filter)) inverted = !inverted
    above = above.parentElement
  }

  // 从底往上合成。
  let out = cached ?? base
  for (let i = layers.length - 1; i >= 0; i--) out = compositeOver(layers[i]!, out)
  if (inverted) out = { r: 255 - out.r, g: 255 - out.g, b: 255 - out.b, a: out.a }

  // 路径压缩：把答案写回沿途每一个元素。不写的话，同一篇文章里几百处命中
  // 会把同一根「脊椎」反复走上几百遍。
  if (memo && certain) for (const seen of walked) memo.set(seen, out)

  return { color: out, certain: certain && (layers.length > 0 || cached !== null) }
}

export interface SampleOptions {
  read?: StyleReader
  prefersDark?: () => boolean
}

/**
 * jsdom 里 `matchMedia` **不是个函数，调它会抛**——所以这一下必须探一探再用。
 * 不探的话，整个翻翻模式的测试会在调用高亮层的第一行就炸掉。
 */
function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/**
 * 这一页此刻是深底还是浅底。
 *
 * 回退顺序是有讲究的，尤其是第 2 条排在 `color-scheme` 和系统偏好**前面**：
 * 那两个说的是意图，字的颜色说的是事实。
 */
export function samplePageBackdrop(
  doc: Document,
  previous?: Backdrop,
  options: SampleOptions = {},
): Backdrop {
  const read = options.read ?? readElementStyle
  const prefersDark = options.prefersDark ?? systemPrefersDark
  const probe = doc.body ?? doc.documentElement
  if (!probe) return 'light'

  const environment: Environment = {
    colorScheme: read(doc.documentElement).colorScheme ?? '',
    prefersDark: prefersDark(),
  }
  const base = canvasColor(environment)

  // 1. 真的量出来的。
  const measured = backdropOf(probe, read, { base })
  if (measured.certain) return classify(relativeLuminance(measured.color), previous)

  // 2. 字的颜色反推。图片、渐变、backdrop-filter 全靠它兜底。
  const fromText = backdropFromTextColor(read(probe).color)
  if (fromText) return fromText

  // 3./4./5. color-scheme，其次系统偏好，都没有就当浅色——白是 Chrome 的画布默认色，
  // 而浅底那套洗色本来就是已经上线在跑的那一套。
  return classify(relativeLuminance(base), previous)
}

/** 整个功能里唯一一次写宿主页面：`<html>` 上一个属性。 */
export function applyBackdropAttribute(value: Backdrop, doc: Document = document): void {
  doc.documentElement?.setAttribute(BACKDROP_ATTRIBUTE, value)
}

export function clearBackdropAttribute(doc: Document = document): void {
  doc.documentElement?.removeAttribute(BACKDROP_ATTRIBUTE)
}

export interface WatchOptions extends SampleOptions {
  doc?: Document
  /** 属性一变到重新量之间的防抖。 */
  delayMs?: number
  /** 再量一次的间隔，用来等过渡动画走完。 */
  settleMs?: number
}

export interface BackdropWatch {
  /** 立刻重量一次。给「观察不到的换主题」当兜底，见下。 */
  resample: () => void
  stop: () => void
}

/**
 * 主题一变就回调。
 *
 * **不列属性名。** Tailwind 用 `class`，GitHub 用 `data-color-mode`，Bootstrap 用
 * `data-bs-theme`，下一个站会自己发明一个——维护这份清单是输定的。
 * 只盯 `<html>` 和 `<body>` 两个节点、不看子树、任何属性变了就重新量一次：
 * 量一次是几十微秒，比维护清单便宜，也比清单准。
 *
 * 量两次是因为换主题基本都带 200ms 的 `background-color` 过渡——
 * t=0 那一下拿到的是**旧颜色**。第二次落在过渡结束之后。
 *
 * 有一种切法这里观察不到：直接给 `<link rel=stylesheet>` 加 `disabled`。
 * html 和 body 上什么都没变，没有任何信号。为它单开一个轮询不值得，
 * 所以留了 {@link BackdropWatch.resample}——重画的时候顺手再量一次，
 * 几十微秒，把这个洞收在下一次页面有任何动静的时刻。
 */
export function watchPageBackdrop(
  onChange: (value: Backdrop) => void,
  options: WatchOptions = {},
): BackdropWatch {
  const doc = options.doc ?? document
  const delayMs = options.delayMs ?? 200
  const settleMs = options.settleMs ?? 400
  let current: Backdrop | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined

  const emit = (): void => {
    const next = samplePageBackdrop(doc, current, options)
    if (next === current) return
    current = next
    onChange(next)
  }

  const schedule = debounce(() => {
    emit()
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(emit, settleMs)
  }, delayMs)

  /*
   * 我们自己写在 `<html>` 上的那两个属性不算「页面变了」。
   *
   * 不滤掉的话：悬停标记一开一关就触发一次重量，而 applyBackdropAttribute 写下的
   * 结果本身又会再触发一次——一个由自己喂自己的循环，靠防抖和「值没变就不回调」
   * 勉强收敛。与其让它收敛，不如让它根本不发生。
   */
  const observer = new MutationObserver((records) => {
    if (records.every((record) => record.attributeName?.startsWith('data-fanfan-'))) return
    schedule()
  })
  observer.observe(doc.documentElement, { attributes: true })
  if (doc.body) observer.observe(doc.body, { attributes: true })

  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  media?.addEventListener('change', schedule)
  // 在后台标签页里换了主题的情况。
  doc.addEventListener('visibilitychange', schedule)

  emit()

  return {
    resample: emit,
    stop: () => {
      observer.disconnect()
      media?.removeEventListener('change', schedule)
      doc.removeEventListener('visibilitychange', schedule)
      schedule.cancel()
      if (settleTimer) clearTimeout(settleTimer)
    },
  }
}
