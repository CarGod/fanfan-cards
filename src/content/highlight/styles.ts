import type { Backdrop } from './backdrop.ts'

/**
 * 翻翻模式高亮的那张表。
 *
 * 单独一个 style 元素，不跟译文那张 5KB 的大表混在一起：换主题时要整段替换文本，
 * 只重解析这 1KB 比重解析整张表便宜，而且翻翻模式关掉时它跟着一起消失。
 *
 * 三件事定了这张表的形状，每一件都踩过或者查过：
 *
 * 1. **一级一个名字，四个，不是八个。** CSS.highlights 里一个 Highlight 只带一套样式，
 *    要画四种颜色就得注册四个名字。深浅两套不再各占一个名字——每多一个在 CSS 里
 *    出现的 highlight 名字，宿主页面每次样式重算时**每一个元素**都要多解一份
 *    ComputedStyle。那笔账记在别人的页面上。深浅之别写进规则正文。
 *
 * 2. **选择器一律通配。** 写成 html[data-fanfan-backdrop='dark'] 加伪元素，会让 Blink
 *    置上 HasNonUniversalHighlightPseudoStyles，把宿主页面拖进 highlight 的样式缓存
 *    失效路径，同样是每次重算都记账——只为省下一次字符串替换，而那个替换一次换主题
 *    才发生一回。html 上仍然写 data-fanfan-backdrop，但它只是个看得见的接缝。
 *
 * 3. **颜色写死成 rgba，不用 var()。** design-token.css 根本到不了宿主页面；
 *    而且自定义属性在这个伪元素里，Chrome 116 上读不到（整条声明被丢掉，一点色都没有），
 *    134 之后又是从**宿主页面的元素**上读——随便哪个站点定义了同名变量就能把
 *    我们的颜色劫走。代价是这八个值和阶梯 token 之间没有机制保证同步，
 *    只有 styles.test.ts 里那条跨文件断言盯着。
 */

export const HIGHLIGHT_STYLE_ID = 'fanfan-highlight-style'

/*
 * 为什么只有 background-color。
 *
 * 这个伪元素认得的属性就那么几样（颜色、背景色、文字装饰、text-shadow），
 * 圆角、内边距、边框一个都没有。剩下的三样也各有各的不能用：
 *
 * - color：最上层高亮的 color 会连原始元素的下划线和着重号一起重画。
 *   在别人的文章里那是越界。
 * - text-shadow：Chrome 是叠加而不是替换，压不住页面自己的阴影。
 * - text-decoration：下划线试过，被否了——标记本身开始比它标的那个词更显眼。
 *
 * 于是只剩 alpha 一根杠杆，八个 alpha 是一组约束的解，不是审美偏好：
 * 洗色对页面底 >= 1.25:1（看得见）；页面自己的正文对比度被吃掉不超过四成
 * （还读得下去）；四级的洗色对比、明度差、彩度三样同时单调递减（认得出是一条阶梯）。
 * 最差的一格是浅底 3 级压在 #eeeeee 上的 1.253:1，和深底 0 级在 #212121 上
 * 留下 0.663 的正文对比——两条线都是贴着floor过的，所以改任何一个 alpha 之前
 * 先去看 styles.test.ts 里那张表。
 */

/*
 * 0 陌生：品牌橙。
 *
 * 整条阶梯上唯一一处橙，也是唯一必须让读者一眼认出「这是那个扩展加的」的地方——
 * 一个刚收藏的词，按定义就是 0 级，所以读者第一次遇见被标出来的词，遇见的总是品牌橙。
 *
 * 1 学习中：--ff-amber-500。橙烧下去，还在暖的一侧。
 * 2 熟悉：--ff-blue-500。温度过界，从暖到冷；彩度砍到零头，读到这一级基本不停。
 */
const HIGHLIGHT_CSS_LIGHT = `
::highlight(fanfan-saved-0) {
  background-color: rgba(255, 106, 61, 0.3) !important;
}

::highlight(fanfan-saved-1) {
  background-color: rgba(154, 91, 0, 0.21) !important;
}

::highlight(fanfan-saved-2) {
  background-color: rgba(59, 91, 192, 0.185) !important;
}
`

/*
 * 深底上同一个橙，只是 alpha 不同——不换成更浅的 --ff-flame-350。
 * 量下来饱和的 500 在近黑底上反而更省：同样的可见度，彩度更高，
 * 也就更认得出是「我们的那个橙」。
 */
const HIGHLIGHT_CSS_DARK = `
::highlight(fanfan-saved-0) {
  background-color: rgba(255, 106, 61, 0.26) !important;
}

::highlight(fanfan-saved-1) {
  background-color: rgba(232, 163, 61, 0.19) !important;
}

::highlight(fanfan-saved-2) {
  background-color: rgba(127, 168, 240, 0.17) !important;
}
`

/*
 * 3 掌握：--ff-ink-300，中性灰，没有色相。
 *
 * 一条温度阶梯的诚实终点是「没有温度」。为什么不用阶梯 token 里那个青绿：
 * #3dd9be 是高彩度的薄荷，在可见度下限逼出来的明度上，量下来比蓝色还扎眼——
 * 它退不下去，会把阶梯的最后一级变成最响的一级。
 *
 * 关掉「标出已掌握的词」时这两条根本不发出去，宿主页面就只背三个名字。
 */
const MASTERED_CSS_LIGHT = `
::highlight(fanfan-saved-3) {
  background-color: rgba(135, 141, 153, 0.245) !important;
}
`

const MASTERED_CSS_DARK = `
::highlight(fanfan-saved-3) {
  background-color: rgba(135, 141, 153, 0.19) !important;
}
`

/*
 * 强制颜色模式（Windows 高对比度）：整条阶梯交出去。
 *
 * 这时候调色板归操作系统管，我们的 alpha 本来就会被覆盖，四级的渐次在系统色里
 * 压根表达不出来。与其猜，不如退回系统的 Highlight/HighlightText——
 * 这也是整个功能里唯一一处我们设 color，因为在这个模式下**只设背景不设前景**
 * 才是真的会出事：系统可能把两者都换掉，落得字和底一个色。
 */
const FORCED_COLORS_CSS = `
@media (forced-colors: active) {
  ::highlight(fanfan-saved-0),
  ::highlight(fanfan-saved-1),
  ::highlight(fanfan-saved-2) {
    background-color: Highlight !important;
    color: HighlightText !important;
  }
}
`

/* 3 级那个名字同样只在标它的时候才出现——没注册的名字白白出现在选择器里，
   宿主页面每次样式重算就要为它多解一份 ComputedStyle。 */
const FORCED_COLORS_MASTERED_CSS = `
@media (forced-colors: active) {
  ::highlight(fanfan-saved-3) {
    background-color: Highlight !important;
    color: HighlightText !important;
  }
}
`

/**
 * 底色和「标不标已掌握的词」定下来之后，这张表长什么样。
 *
 * 纯函数。这一点是刻意的：媒体查询在 jsdom 里**永远不匹配**，所以只要深色那套还
 * 挂在 `@media (prefers-color-scheme: dark)` 下面，就没有任何一条单元测试能验证它
 * ——而那正是这次要修的 bug。写成一个返回字符串的函数，node 环境里直接断言。
 */
export function highlightCss(backdrop: Backdrop, showMastered: boolean): string {
  const dark = backdrop === 'dark'
  const base = dark ? HIGHLIGHT_CSS_DARK : HIGHLIGHT_CSS_LIGHT
  const mastered = showMastered
    ? (dark ? MASTERED_CSS_DARK : MASTERED_CSS_LIGHT) + FORCED_COLORS_MASTERED_CSS
    : ''
  return base + FORCED_COLORS_CSS + mastered
}

/** 装上或者原地换掉那张表。换主题走的就是这一下，一次字符串替换。 */
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
