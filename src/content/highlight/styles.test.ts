import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FANFAN_PALETTE,
  FANFAN_PALETTES,
  FANFAN_PALETTE_IDS,
} from '@/shared/fanfanPalette.ts'
import { highlightCss } from './styles.ts'

type Rgb = [number, number, number]

function parseRgba(value: string): { rgb: Rgb; alpha: number } {
  const parts = value.match(/[\d.]+/g)?.map(Number)
  if (!parts || parts.length !== 4) throw new Error(`Invalid rgba value: ${value}`)
  return { rgb: parts.slice(0, 3) as Rgb, alpha: parts[3]! }
}

function hex(value: string): Rgb {
  const n = parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 浏览器在 gamma 编码的 sRGB 里合成背景色；保留浮点，避免 1.25 门槛被取整伪装。 */
const over = (wash: Rgb, alpha: number, bg: Rgb): Rgb =>
  wash.map((channel, index) => alpha * channel + (1 - alpha) * bg[index]!) as Rgb

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

/** sRGB → OKLab，跨色相签名用感知距离而不是逐 RGB 通道差。 */
function oklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const deltaEok = (a: Rgb, b: Rgb): number => {
  const first = oklab(a)
  const second = oklab(b)
  return Math.hypot(...first.map((value, index) => value - second[index]!))
}

function washes(css: string): Array<{ level: number; rgba: string }> {
  return [
    ...css.matchAll(
      /::highlight\(fanfan-saved-(\d)\)\s*\{\s*background-color:\s*(rgba\([^)]+\))/g,
    ),
  ].map((match) => ({ level: Number(match[1]), rgba: match[2]! }))
}

const BEDS = {
  light: {
    text: hex('#1a1a1a'),
    values: [hex('#ffffff'), hex('#f6f8fa'), hex('#eeeeee')],
  },
  dark: {
    text: hex('#ececec'),
    values: [hex('#0d0d0d'), hex('#212121'), hex('#0d1117')],
  },
} as const

const VISIBILITY_FLOOR = 1.249
const RETENTION_FLOOR = 0.6
const TEXT_CONTRAST_FLOOR = 7
const SIGNATURE_MEAN_FLOOR = 0.03
const SIGNATURE_CELL_FLOOR = 0.025

describe('翻翻高亮的六套主题', () => {
  it('生产色值与已验收的设计实验页逐通道一致', () => {
    const source = readFileSync(
      new URL('../../../docs/design/fanfan-palette-lab/palette-data.js', import.meta.url),
      'utf8',
    )
    const window: Record<string, unknown> = {}
    runInNewContext(source, { window })
    const lab = window['FanfanPaletteLabData'] as {
      PALETTES: Record<string, { light: string[]; dark: string[] }>
    }

    expect(Object.keys(lab.PALETTES)).toEqual([...FANFAN_PALETTE_IDS])
    for (const id of FANFAN_PALETTE_IDS) {
      for (const backdrop of ['light', 'dark'] as const) {
        expect(lab.PALETTES[id]?.[backdrop].map(parseRgba)).toEqual(
          FANFAN_PALETTES[id][backdrop].map(parseRgba),
        )
      }
    }
  })

  it('默认主题是暖日麦田', () => {
    expect(DEFAULT_FANFAN_PALETTE).toBe('warmField')
    expect(highlightCss('light', true)).toBe(highlightCss('light', true, 'warmField'))
  })

  it('六套主题的亮暗四档逐项进入最终 CSS', () => {
    expect(FANFAN_PALETTE_IDS).toHaveLength(6)
    for (const id of FANFAN_PALETTE_IDS) {
      for (const backdrop of ['light', 'dark'] as const) {
        const actual = washes(highlightCss(backdrop, true, id))
        expect(actual.map((item) => item.level)).toEqual([0, 1, 2, 3])
        expect(actual.map((item) => item.rgba)).toEqual([...FANFAN_PALETTES[id][backdrop]])
      }
    }
  })

  it('深浅由实际页面底色决定，不含系统主题媒体查询', () => {
    for (const id of FANFAN_PALETTE_IDS) {
      const light = highlightCss('light', true, id)
      const dark = highlightCss('dark', true, id)
      expect(light).not.toContain('prefers-color-scheme')
      expect(dark).not.toContain('prefers-color-scheme')
      expect(dark).not.toBe(light)
    }
  })

  it('隐藏已掌握后，它的普通与强制颜色选择器都不输出', () => {
    for (const id of FANFAN_PALETTE_IDS) {
      for (const backdrop of ['light', 'dark'] as const) {
        expect(highlightCss(backdrop, false, id)).not.toContain('fanfan-saved-3')
      }
    }
  })

  it('普通模式只修改背景；强制颜色模式同时交出前景与背景', () => {
    for (const id of FANFAN_PALETTE_IDS) {
      const css = highlightCss('light', true, id)
      const normal = css.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n\}\n/g, '')
      expect(normal.match(/::highlight\(fanfan-saved-\d\)/g)).toHaveLength(4)
      expect([...normal.matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1])).toEqual([
        'background-color',
        'background-color',
        'background-color',
        'background-color',
      ])
      expect(css).toContain('background-color: Highlight')
      expect(css).toContain('color: HighlightText')
    }
  })

  it('每个常见底色都满足可见度、正文留存、正文对比和严格递减', () => {
    for (const id of FANFAN_PALETTE_IDS) {
      for (const backdrop of ['light', 'dark'] as const) {
        const config = BEDS[backdrop]
        for (const bed of config.values) {
          const originalTextContrast = contrast(config.text, bed)
          const series = FANFAN_PALETTES[id][backdrop].map((value, level) => {
            const { rgb, alpha } = parseRgba(value)
            const composited = over(rgb, alpha, bed)
            const visibility = contrast(composited, bed)
            const textContrast = contrast(config.text, composited)
            const label = `${id}/${backdrop}/L${level}/rgb(${bed.join()})`

            expect(visibility, `${label} visibility`).toBeGreaterThanOrEqual(VISIBILITY_FLOOR)
            expect(textContrast / originalTextContrast, `${label} retention`).toBeGreaterThanOrEqual(
              RETENTION_FLOOR,
            )
            expect(textContrast, `${label} text contrast`).toBeGreaterThanOrEqual(
              TEXT_CONTRAST_FLOOR,
            )
            return visibility
          })

          for (let level = 1; level < series.length; level++) {
            expect(
              series[level - 1],
              `${id}/${backdrop}/L${level - 1} must exceed L${level}`,
            ).toBeGreaterThan(series[level]!)
          }
        }
      }
    }
  })

  it('任意两主题的 L0-L2 都形成可辨认的 OKLab 色彩签名', () => {
    for (const backdrop of ['light', 'dark'] as const) {
      for (const bed of BEDS[backdrop].values) {
        for (let first = 0; first < FANFAN_PALETTE_IDS.length; first++) {
          for (let second = first + 1; second < FANFAN_PALETTE_IDS.length; second++) {
            const firstId = FANFAN_PALETTE_IDS[first]!
            const secondId = FANFAN_PALETTE_IDS[second]!
            const deltas = [0, 1, 2].map((level) => {
              const a = parseRgba(FANFAN_PALETTES[firstId][backdrop][level]!)
              const b = parseRgba(FANFAN_PALETTES[secondId][backdrop][level]!)
              return deltaEok(over(a.rgb, a.alpha, bed), over(b.rgb, b.alpha, bed))
            })
            const label = `${firstId}/${secondId}/${backdrop}/rgb(${bed.join()})`
            expect(
              deltas.reduce((total, value) => total + value, 0) / deltas.length,
              `${label} mean signature`,
            ).toBeGreaterThanOrEqual(SIGNATURE_MEAN_FLOOR)
            expect(
              deltas.filter((value) => value >= SIGNATURE_CELL_FLOOR).length,
              `${label} corresponding cells`,
            ).toBeGreaterThanOrEqual(2)
          }
        }
      }
    }
  })
})
