/**
 * 翻翻模式的六套高亮主题。
 *
 * 这份表同时供设置页预览和宿主网页上的 CSS Custom Highlight 使用，是生产色值的
 * 唯一来源。高亮伪元素不能可靠读取扩展自己的 CSS variables，所以最终仍会把这里的
 * rgba 实值写进注入样式；但不再维护另一份手写 CSS 常量。
 */

export const FANFAN_PALETTE_IDS = [
  'warmField',
  'glacierBay',
  'wisteriaNocturne',
  'mintForest',
  'cherryCloud',
  'mistStudy',
] as const

export type FanfanPaletteId = (typeof FANFAN_PALETTE_IDS)[number]
export type FanfanBackdrop = 'light' | 'dark'
export type FanfanPaletteColors = readonly [string, string, string, string]

export const DEFAULT_FANFAN_PALETTE: FanfanPaletteId = 'warmField'

export interface FanfanPaletteDefinition {
  id: FanfanPaletteId
  labelKey:
    | 'fanfan.palette.warm_field'
    | 'fanfan.palette.glacier_bay'
    | 'fanfan.palette.wisteria_nocturne'
    | 'fanfan.palette.mint_forest'
    | 'fanfan.palette.cherry_cloud'
    | 'fanfan.palette.mist_study'
  summaryKey:
    | 'fanfan.palette.warm_field.summary'
    | 'fanfan.palette.glacier_bay.summary'
    | 'fanfan.palette.wisteria_nocturne.summary'
    | 'fanfan.palette.mint_forest.summary'
    | 'fanfan.palette.cherry_cloud.summary'
    | 'fanfan.palette.mist_study.summary'
  light: FanfanPaletteColors
  dark: FanfanPaletteColors
}

export const FANFAN_PALETTES: Readonly<Record<FanfanPaletteId, FanfanPaletteDefinition>> = {
  warmField: {
    id: 'warmField',
    labelKey: 'fanfan.palette.warm_field',
    summaryKey: 'fanfan.palette.warm_field.summary',
    light: [
      'rgba(255, 70, 0, 0.277)',
      'rgba(210, 100, 0, 0.257)',
      'rgba(150, 112, 0, 0.218)',
      'rgba(115, 100, 80, 0.175)',
    ],
    dark: [
      'rgba(255, 125, 20, 0.282)',
      'rgba(255, 190, 30, 0.187)',
      'rgba(220, 210, 60, 0.155)',
      'rgba(190, 175, 150, 0.162)',
    ],
  },
  glacierBay: {
    id: 'glacierBay',
    labelKey: 'fanfan.palette.glacier_bay',
    summaryKey: 'fanfan.palette.glacier_bay.summary',
    light: [
      'rgba(0, 85, 225, 0.219)',
      'rgba(0, 105, 195, 0.208)',
      'rgba(20, 105, 165, 0.184)',
      'rgba(95, 110, 135, 0.184)',
    ],
    dark: [
      'rgba(40, 150, 255, 0.311)',
      'rgba(55, 170, 255, 0.244)',
      'rgba(80, 180, 230, 0.201)',
      'rgba(160, 185, 215, 0.155)',
    ],
  },
  wisteriaNocturne: {
    id: 'wisteriaNocturne',
    labelKey: 'fanfan.palette.wisteria_nocturne',
    summaryKey: 'fanfan.palette.wisteria_nocturne.summary',
    light: [
      'rgba(205, 0, 220, 0.204)',
      'rgba(155, 25, 210, 0.181)',
      'rgba(110, 50, 175, 0.162)',
      'rgba(115, 100, 130, 0.179)',
    ],
    dark: [
      'rgba(235, 80, 255, 0.315)',
      'rgba(195, 105, 255, 0.280)',
      'rgba(160, 120, 235, 0.248)',
      'rgba(190, 170, 205, 0.162)',
    ],
  },
  mintForest: {
    id: 'mintForest',
    labelKey: 'fanfan.palette.mint_forest',
    summaryKey: 'fanfan.palette.mint_forest.summary',
    light: [
      'rgba(0, 135, 55, 0.258)',
      'rgba(0, 120, 85, 0.216)',
      'rgba(45, 105, 55, 0.183)',
      'rgba(100, 115, 102, 0.188)',
    ],
    dark: [
      'rgba(30, 220, 100, 0.231)',
      'rgba(40, 215, 145, 0.206)',
      'rgba(100, 205, 115, 0.183)',
      'rgba(160, 195, 170, 0.151)',
    ],
  },
  cherryCloud: {
    id: 'cherryCloud',
    labelKey: 'fanfan.palette.cherry_cloud',
    summaryKey: 'fanfan.palette.cherry_cloud.summary',
    light: [
      'rgba(255, 0, 30, 0.200)',
      'rgba(230, 35, 70, 0.200)',
      'rgba(190, 65, 95, 0.188)',
      'rgba(125, 100, 108, 0.181)',
    ],
    dark: [
      'rgba(255, 80, 90, 0.340)',
      'rgba(255, 110, 130, 0.259)',
      'rgba(240, 140, 160, 0.201)',
      'rgba(205, 175, 185, 0.158)',
    ],
  },
  mistStudy: {
    id: 'mistStudy',
    labelKey: 'fanfan.palette.mist_study',
    summaryKey: 'fanfan.palette.mist_study.summary',
    light: [
      'rgba(100, 70, 45, 0.215)',
      'rgba(75, 90, 105, 0.206)',
      'rgba(70, 80, 105, 0.170)',
      'rgba(100, 98, 95, 0.170)',
    ],
    dark: [
      'rgba(205, 165, 125, 0.247)',
      'rgba(175, 185, 200, 0.201)',
      'rgba(165, 175, 200, 0.187)',
      'rgba(185, 180, 175, 0.160)',
    ],
  },
}

export const FANFAN_PALETTE_LIST: readonly FanfanPaletteDefinition[] =
  FANFAN_PALETTE_IDS.map((id) => FANFAN_PALETTES[id])

export function isFanfanPaletteId(value: unknown): value is FanfanPaletteId {
  return typeof value === 'string' && FANFAN_PALETTE_IDS.some((id) => id === value)
}

/** `warmBlue` 只存在于未发布过的设计实现中；在 v8 内直接折叠，不制造新迁移版本。 */
export function coerceFanfanPaletteId(value: unknown): FanfanPaletteId {
  if (value === 'warmBlue') return 'warmField'
  return isFanfanPaletteId(value) ? value : DEFAULT_FANFAN_PALETTE
}

export function fanfanPaletteColors(
  palette: FanfanPaletteId,
  backdrop: FanfanBackdrop,
): FanfanPaletteColors {
  return FANFAN_PALETTES[palette][backdrop]
}
