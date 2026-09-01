import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { highlightCss } from './styles.ts'

/**
 * 翻翻模式那八个 alpha。
 *
 * 它们不是审美偏好，是一组约束的解——而那组约束在页面上**看不出来是不是还成立**。
 * 一个洗色淡到看不见，和这个功能没开，长得一模一样：没有报错，没有红色，
 * 只有「这东西好像没用」。原来那个 bug 就是这么活了一整个版本的。
 *
 * 所以这里把三件事钉死：
 *
 * 1. 深色那套**不再**由媒体查询决定。这条是那个 bug 的回归测试，而它写得出来，
 *    正是因为规则变成了一个返回字符串的纯函数——jsdom 里 `@media` 永远不匹配，
 *    挂在媒体查询下面的分支，这个仓库里没有任何一条测试能碰到。
 * 2. 颜色和 design-token.css 里的阶梯没有任何机制保持同步（自定义属性到不了宿主页面，
 *    见 styles.ts 顶上的第 3 条），所以只能靠这里逐通道比对。
 * 3. 洗色本身的三条线：看得见、读得下去、认得出是一条阶梯。
 */

const TOKENS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'design-token.css'),
  'utf8',
)

type Rgb = [number, number, number]

function token(name: string): Rgb {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(TOKENS)
  if (!match) throw new Error(`design-token.css 里找不到 ${name}`)
  return hex(match[1]!)
}

function hex(value: string): Rgb {
  const n = parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 浏览器合成背景色是在 gamma 编码的 sRGB 里做的，所以就是逐通道插值。 */
const over = (wash: Rgb, alpha: number, bg: Rgb): Rgb =>
  wash.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]!)) as Rgb

const luminance = (rgb: Rgb): number => {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** CIELAB。明度差和彩度都要它——WCAG 那个比值在近黑处被 +0.05 主导，分辨不出深浅。 */
function lab(rgb: Rgb): { l: number; c: number } {
  const linear = rgb.map((value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  const [r, g, b] = linear
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (903.3 * t + 16) / 116)
  const a = 500 * (f(x) - f(y))
  const bStar = 200 * (f(y) - f(z))
  return { l: 116 * f(y) - 16, c: Math.hypot(a, bStar) }
}

/** 从生成出来的那张表里把 alpha 抠回来——测的是真的发出去的东西，不是一份副本。 */
function washes(css: string): Array<{ level: number; rgb: Rgb; alpha: number }> {
  const rules = [
    ...css.matchAll(
      /::highlight\(fanfan-saved-(\d)\)\s*\{\s*background-color:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g,
    ),
  ]
  return rules.map((match) => ({
    level: Number(match[1]),
    rgb: [Number(match[2]), Number(match[3]), Number(match[4])] as Rgb,
    alpha: Number(match[5]),
  }))
}

/**
 * 参考底色。
 *
 * 第一个是设计时用的那张床，后面两个是真实世界里最常见的两种「差一点」——
 * GitHub 的米白和 ChatGPT 的中深灰。约束要在这三张床上同时成立，
 * 因为它们才是这个功能真正被用的地方。
 */
const BEDS = {
  light: { text: hex('#1a1a1a'), beds: [hex('#ffffff'), hex('#f6f8fa'), hex('#eeeeee')] },
  dark: { text: hex('#ececec'), beds: [hex('#0d0d0d'), hex('#212121'), hex('#0d1117')] },
} as const

/** 洗色对页面底：看得见。 */
const VISIBILITY_FLOOR = 1.25
/** 页面自己的正文对比度还剩多少：读得下去。 */
const RETENTION_FLOOR = 0.6

describe('翻翻高亮的配色', () => {
  /**
   * 这条是那个 bug 的回归测试。
   *
   * 媒体查询问的是**操作系统**，而 chatgpt.com 在浅色系统上照样是深色页——
   * 于是浅底那层 0.16 的橙画在近黑背景上，直接消失。深浅现在由页面量出来的底色决定。
   */
  it('深色那套不由 prefers-color-scheme 决定', () => {
    for (const backdrop of ['light', 'dark'] as const) {
      expect(highlightCss(backdrop, true)).not.toContain('prefers-color-scheme')
    }
    expect(highlightCss('dark', true)).not.toBe(highlightCss('light', true))
  })

  it('四个熟悉度各有一条规则，深浅两套都齐', () => {
    for (const backdrop of ['light', 'dark'] as const) {
      expect(washes(highlightCss(backdrop, true)).map((wash) => wash.level)).toEqual([0, 1, 2, 3])
    }
  })

  /** 不标已掌握的词时，那个名字连在选择器里都不该出现——宿主页面每多一个都要多解一份样式。 */
  it('不标已掌握的词时，连它的名字都不出现在表里', () => {
    for (const backdrop of ['light', 'dark'] as const) {
      expect(highlightCss(backdrop, false)).not.toContain('fanfan-saved-3')
    }
  })

  /**
   * 这个伪元素只认得几个属性，而其中三个各有各的不能用（见 styles.ts）。
   * 唯一的例外是强制颜色模式：那时候**只设背景不设前景**才是真的会出事。
   */
  it('除了强制颜色模式，只设 background-color', () => {
    for (const backdrop of ['light', 'dark'] as const) {
      const css = highlightCss(backdrop, true)
      /*
       * 把每一个 forced-colors 块整段挖掉，而不是按它切片。
       *
       * 切片写过一版，它悄悄漏掉了一半：掌握那条规则排在第一个 @media 之后，
       * 于是被划进「强制颜色」那半边，永远不被检查——往那条规则里加一句
       * `color: red` 全套测试照样绿。所以下面那句 toHaveLength(4) 才是这条测试的
       * 骨头：它保证扫的是全部四条，而不是碰巧扫到的那几条。
       */
      const normal = css.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n\}\n/g, '')
      expect(normal).not.toContain('forced-colors')
      expect(normal.match(/::highlight\(fanfan-saved-\d\)/g)).toHaveLength(4)

      const properties = [...normal.matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1])
      expect([backdrop, new Set(properties)]).toEqual([
        backdrop,
        new Set(['background-color']),
      ])
    }

    const [, forced = ''] = highlightCss('light', true).split('@media (forced-colors: active)')
    expect(forced).toContain('color: HighlightText')
  })

  /**
   * 颜色写死成 rgba，因为自定义属性到不了宿主页面，也因为 Chrome 116 上
   * `::highlight()` 里根本读不到它们。代价是没有任何机制保证这八个值和阶梯 token
   * 同步——所以只能在这里逐通道比对。改 token 的人会在这里被拦下来。
   */
  it('每一个洗色都还是 design-token.css 里的那个颜色', () => {
    const expected: Record<'light' | 'dark', Record<number, Rgb>> = {
      light: {
        0: token('--ff-flame-500'),
        1: token('--ff-amber-500'),
        2: token('--ff-blue-500'),
        3: token('--ff-ink-300'),
      },
      dark: {
        0: token('--ff-flame-500'),
        1: token('--ff-amber-400'),
        2: token('--ff-blue-400'),
        3: token('--ff-ink-300'),
      },
    }

    for (const backdrop of ['light', 'dark'] as const) {
      for (const wash of washes(highlightCss(backdrop, true))) {
        expect([backdrop, wash.level, wash.rgb]).toEqual([
          backdrop,
          wash.level,
          expected[backdrop][wash.level],
        ])
      }
    }
  })

  for (const backdrop of ['light', 'dark'] as const) {
    const { text, beds } = BEDS[backdrop]

    for (const wash of washes(highlightCss(backdrop, true))) {
      for (const bed of beds) {
        const composited = over(wash.rgb, wash.alpha, bed)
        const label = `${backdrop} L${wash.level} 压在 rgb(${bed.join()}) 上`

        /** 看不见的洗色和「这个功能没开」长得一模一样。 */
        it(`${label}：看得见`, () => {
          expect(Number(contrast(composited, bed).toFixed(3))).toBeGreaterThanOrEqual(
            VISIBILITY_FLOOR,
          )
        })

        /**
         * 断的是**留存**，不是绝对的 4.5:1。
         *
         * 一个本来就贴着 AA 线发布的页面（#767676 压白底，4.54:1），
         * 垫上任何看得见的洗色都会掉到 4.5 以下——绝对值那条线在好页面上白过，
         * 在差页面上不可能过。留存在两种页面上意思一样。
         */
        it(`${label}：页面自己的正文还读得下去`, () => {
          const retention = contrast(text, composited) / contrast(text, bed)
          expect(Number(retention.toFixed(3))).toBeGreaterThanOrEqual(RETENTION_FLOOR)
        })
      }
    }

    /**
     * 「越熟越退」必须是**量得出来**的，不是说说而已。
     *
     * 三样同时单调递减：洗色对底的对比、明度差、彩度。其中彩度是主力——
     * 亮度只从 1.375 收到 1.283，退的是颜色的温度，这才让四级都待在同一条
     * 安静的带子里，而不是把整个亮度预算花在信号上。
     */
    it(`${backdrop}：可见度、明度差、彩度三样都随熟悉度递减`, () => {
      const bed = beds[0]!
      const measured = washes(highlightCss(backdrop, true)).map((wash) => {
        const composited = over(wash.rgb, wash.alpha, bed)
        return {
          visibility: contrast(composited, bed),
          lightness: Math.abs(lab(composited).l - lab(bed).l),
          chroma: lab(composited).c,
        }
      })

      for (const key of ['visibility', 'lightness', 'chroma'] as const) {
        const series = measured.map((item) => item[key])
        expect([key, series]).toEqual([key, [...series].sort((a, b) => b - a)])
      }
    })
  }
})
