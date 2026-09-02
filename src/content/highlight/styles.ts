import {
  DEFAULT_FANFAN_PALETTE,
  fanfanPaletteColors,
  type FanfanPaletteId,
} from '@/shared/fanfanPalette.ts'
import type { Backdrop } from './backdrop.ts'

/**
 * 翻翻模式高亮的样式表。
 *
 * 它单独待在一个 style 元素里：切换主题或网页深浅时只替换这一小段文本，关闭模式
 * 后则整张移除。一个熟悉度对应一个 Highlight 名字，避免为亮暗两套重复注册 Range。
 *
 * 颜色必须输出为 rgba 实值。扩展自己的 design-token.css 到不了宿主网页；Chrome 的
 * `::highlight()` 在旧版本里也读不到自定义属性，新版本还可能从宿主元素继承同名变量。
 * 六套生产色值因此集中在 `shared/fanfanPalette.ts`，由设置预览和这里共同读取。
 */

export const HIGHLIGHT_STYLE_ID = 'fanfan-highlight-style'

function highlightRule(level: number, color: string): string {
  return `
::highlight(fanfan-saved-${level}) {
  background-color: ${color} !important;
}
`
}

/**
 * Windows 强制颜色模式把阶梯交给系统。
 *
 * 系统高对比度下半透明主题色会被覆盖，四档无法可靠表达；显式同时设置系统前景与背景，
 * 避免只换了其中一边而让文字消失。已掌握关闭时连它的选择器都不输出，少给宿主页留
 * 一个无用的 Highlight 样式名字。
 */
function forcedColorsCss(showMastered: boolean): string {
  const selectors = [0, 1, 2, ...(showMastered ? [3] : [])]
    .map((level) => `  ::highlight(fanfan-saved-${level})`)
    .join(',\n')

  return `
@media (forced-colors: active) {
${selectors} {
    background-color: Highlight !important;
    color: HighlightText !important;
  }
}
`
}

/** 根据实际页面底色、显示范围和用户主题生成最终注入样式。 */
export function highlightCss(
  backdrop: Backdrop,
  showMastered: boolean,
  palette: FanfanPaletteId = DEFAULT_FANFAN_PALETTE,
): string {
  const colors = fanfanPaletteColors(palette, backdrop)
  const levels = showMastered ? [0, 1, 2, 3] : [0, 1, 2]
  return (
    levels.map((level) => highlightRule(level, colors[level]!)).join('') +
    forcedColorsCss(showMastered)
  )
}

/** 装上或者原地换掉样式表。换主题只会触发一次字符串替换。 */
export function applyHighlightStyles(css: string, doc: Document = document): void {
  const head = doc.head ?? doc.documentElement
  if (!head) return
  let style = doc.getElementById(HIGHLIGHT_STYLE_ID)
  if (!style) {
    style = doc.createElement('style')
    style.id = HIGHLIGHT_STYLE_ID
    head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}

export function removeHighlightStyles(doc: Document = document): void {
  doc.getElementById(HIGHLIGHT_STYLE_ID)?.remove()
}
