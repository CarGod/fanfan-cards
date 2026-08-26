import { HOVER_CLASS } from './paragraphTranslator.ts'
import { HIGHLIGHT_NAME } from '../highlight/highlighter.ts'
import { TRANSLATED_MARK, TRANSLATION_CLASS } from './walker.ts'

/**
 * Styles for the injected translations.
 *
 * These are the one part of the extension that cannot live in the shadow root:
 * a translation sits inside the article's own layout and must inherit its
 * measure, font size and colour, or it reads as a foreign object stapled to the
 * page. So the rules are scoped tightly to our class, use `inherit` wherever the
 * host page should win, and are marked `!important` only where a site's
 * aggressive resets would otherwise erase them.
 */
/**
 * 仅译文模式下该藏起来的原文。
 *
 * 单独导出成常量，是为了让这条规则**可测**：它的每一个限定条件都对应一种
 * 「藏错了」的坏法，而 CSS 藏错了不会报错，只会让页面上少一块东西——
 * 恰恰是最难被发现的那类问题。
 */
export const HIDDEN_IN_TRANSLATION_ONLY =
  `[${TRANSLATED_MARK}='done']` +
  `:has(+ .${TRANSLATION_CLASS})` +
  `:not(:has([${TRANSLATED_MARK}]))`

const STYLE_ID = 'fanfan-page-translation-style'

const CSS = `
/*
 * The paragraph about to be translated.
 *
 * An outline rather than a background: a background would fight whatever the
 * site already paints there, and on a dark site a light wash makes the text
 * unreadable for exactly as long as the key is held.
 */
.${HOVER_CLASS} {
  outline: 2px solid rgba(255, 106, 61, 0.85) !important;
  outline-offset: 2px;
  border-radius: 3px;
  cursor: pointer;
}

/*
 * A translation must read as *ours* without fighting the page.
 *
 * 边线是品牌橙。
 *
 * 设计令牌里原本的分工是「紫色 = 模型写的字，橙色 = 你该做的动作」，而这里
 * 曾经用紫色。现在页面上的规则改成了「橙色 = 我们加在你页面上的东西」——
 * 译文、翻翻模式的高亮都归它；紫色退回卡片内部，只标 AI 写的那段语境解释。
 * 页面上本来也只有我们加的东西才需要被认出来，是谁写的是打开卡片之后的事。
 *
 * 用半透明的中间调而不是固定颜色，是为了在白底文章和 x.com 的近黑底上
 * 都还成立。Without it the
 * Chinese runs straight on from the English and the two look like one mangled
 * paragraph — which is exactly how this shipped and exactly how it read.
 *
 * !important only on the two properties a site's reset would otherwise erase.
 */
.${TRANSLATION_CLASS} {
  display: block;
  margin: 0.45em 0 0.85em !important;
  font-family: inherit;
  font-size: 0.96em;
  line-height: 1.75;
  color: inherit;
  /* Translations keep the original's line structure, so they need to render it. */
  white-space: pre-wrap;
  opacity: 0.94;
  border-left: 3px solid rgba(255, 106, 61, 0.75) !important;
  padding-left: 0.75em;
  animation: ara-translation-in 220ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
}

/*
 * 仅译文模式。
 *
 * 藏原文，而不是删原文——「关掉翻译」必须能把页面还原成我们进来之前的样子，
 * 而这一整个功能的第一条规则就是不动原文。所以这里只是一个 CSS 开关，
 * 切换是瞬时的，读者改主意不用重新翻一遍。
 *
 * 整页翻译和悬停整段翻译共用这一条规则：读者选的是「我想怎么读译文」，
 * 而这件事不会因为译文是整页来的还是单段来的就变一次。
 *
 * 两个限定条件各有各的伤疤：
 *
 * 1. :not(:has(...)) —— 自己有译文、肚子里还装着别的译文的元素不能藏。
 *    collectUnits 会让一个 li 既是一段、它的子块又各自是一段；藏掉外层，
 *    里层那几段译文会跟着一起消失。
 * 2. 只藏 done 的 —— 译文还没回来、或者被判定为「原样复读」而撤掉的段落，
 *    原文必须留着。否则读者看到的是一片空白，而那片空白正是翻译失败的地方。
 */
html[data-fanfan-translation-mode='translation-only'] ${HIDDEN_IN_TRANSLATION_ONLY} {
  display: none !important;
}

/*
 * 原文不在了，译文就是正文。
 *
 * 那根橙色边线的意思是「这是我们附加的东西」——原文藏起来之后它就在说谎了，
 * 所以撤掉，字号和不透明度也还原成正文的样子。
 *
 * 间距必须自己补上：原文 display:none 之后，它的段间距一起没了，
 * 而译文在双语模式下用的是「贴着原文」的紧凑间距（上 0.45em）。不补的话，
 * 整页的段落会糊成一坨——这一条是写完才发现的，因为它在双语模式下完全看不出来。
 */
html[data-fanfan-translation-mode='translation-only']
  .${TRANSLATION_CLASS}:not([data-ara-inline]) {
  border-left: none !important;
  padding-left: 0;
  margin: 0 0 1em !important;
  font-size: 1em;
  opacity: 1 !important;
}

/*
 * 行内译文在仅译文模式下取代的是原文本身，不再是补充说明——
 * 所以那对括号要去掉，左边那点让位的空隙也不需要了。
 */
html[data-fanfan-translation-mode='translation-only']
  .${TRANSLATION_CLASS}[data-ara-inline] {
  margin: 0 !important;
  opacity: 1 !important;
}

html[data-fanfan-translation-mode='translation-only']
  .${TRANSLATION_CLASS}[data-ara-inline]::before,
html[data-fanfan-translation-mode='translation-only']
  .${TRANSLATION_CLASS}[data-ara-inline]::after {
  content: '';
}

/*
 * 翻翻模式：词库里的词。
 *
 * 用 ::highlight() 而不是给元素加背景色，因为这些高亮根本不是元素——
 * 它们是 Range，浏览器直接画在文字上，页面的节点树一个字节都没动。
 * 代价是这个伪元素只认得几个属性：background-color、color、text-decoration
 * 和 text-shadow。圆角、内边距、边框全都不支持，所以样式必须靠这几样撑住。
 *
 * 一层很淡的品牌橙，没有下划线。读者是来读文章的，不是来看标记的——
 * 荧光笔式的实心块会把注意力从句子上拽走，而这个功能的意义恰恰是
 * 「你读着读着，认出一个你查过的词」。加过下划线，试出来太吵：
 * 标记本身开始比它标的那个词更显眼。
 */
::highlight(${HIGHLIGHT_NAME}) {
  background-color: rgba(255, 106, 61, 0.16);
}

/*
 * 停在标出来的词上时，光标变成手形。
 *
 * 为什么不写在 ::highlight() 里：那个伪元素只认得颜色、背景和文字装饰几样属性，
 * cursor 不在其中——高亮是 Range 不是元素，没有盒子可以挂光标。所以由脚本做
 * 命中测试、在 html 上打个标记，这里只负责把光标改掉。
 *
 * 连通配选择器一起写，是因为 cursor 虽然会继承，但页面上任何一条给具体元素设了 cursor
 * 的规则都会把它挡住——而那正是「文章正文里的一个词」最常见的处境。
 * 覆盖范围看着吓人，实际只在指针**正停在那个词上**的那一刻存在。
 */
html[data-fanfan-word-hover],
html[data-fanfan-word-hover] * {
  cursor: pointer !important;
}

@media (prefers-color-scheme: dark) {
  ::highlight(${HIGHLIGHT_NAME}) {
    /* 深色底上同样的透明度会被吞掉，提一点点才看得出是同一个颜色。 */
    background-color: rgba(255, 138, 94, 0.24);
  }
}

@keyframes ara-translation-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 0.94;
    transform: none;
  }
}

.${TRANSLATION_CLASS}[data-ara-inline] {
  display: inline;
  margin: 0 0 0 0.35em !important;
  border-left: none !important;
  padding-left: 0;
  opacity: 0.88;
}

.${TRANSLATION_CLASS}[data-ara-inline]::before {
  content: '（';
}

.${TRANSLATION_CLASS}[data-ara-inline]::after {
  content: '）';
}

/*
 * Waiting.
 *
 * A shimmering bar rather than the words 「翻译中…」: on a feed with thirty
 * requests in flight, thirty copies of the same sentence is noise, while a
 * moving band reads as "working" at a glance and takes up exactly the room the
 * text will need. The slot reserves its line either way, so the page reflows
 * once instead of twice.
 */
.ara-translation-pending {
  min-height: 1.25em;
  border-left-color: rgba(255, 106, 61, 0.3) !important;
  animation: none;
}

.ara-translation-pending::after {
  content: '';
  display: block;
  height: 0.75em;
  width: min(62%, 22em);
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    rgba(255, 106, 61, 0.16) 0%,
    rgba(255, 106, 61, 0.38) 50%,
    rgba(255, 106, 61, 0.16) 100%
  );
  background-size: 200% 100%;
  animation: ara-shimmer 1.1s ease-in-out infinite;
}

@keyframes ara-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.${TRANSLATION_CLASS}[data-ara-inline].ara-translation-pending::before,
.${TRANSLATION_CLASS}[data-ara-inline].ara-translation-pending::after {
  content: '';
}

.${TRANSLATION_CLASS}[data-ara-inline].ara-translation-pending::after {
  display: inline-block;
  height: 0.7em;
  width: 4em;
  vertical-align: middle;
}

/* Someone who asked the OS for less motion gets the result, not the show. */
@media (prefers-reduced-motion: reduce) {
  .${TRANSLATION_CLASS},
  .ara-translation-pending::after {
    animation: none !important;
  }
}
`

export function injectPageStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head?.appendChild(style)
}

export function removePageStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}

/**
 * 切到「仅译文」或切回「双语」。
 *
 * 记在 `<html>` 上而不是记在每一段上：切换要立刻生效在**已经翻好的**内容上，
 * 逐段改类意味着遍历整页，而读者拨一下开关期待的是瞬时。
 */
export function setTranslationMode(mode: 'bilingual' | 'translationOnly'): void {
  const root = document.documentElement
  if (mode === 'translationOnly') {
    root.setAttribute('data-fanfan-translation-mode', 'translation-only')
  } else {
    root.removeAttribute('data-fanfan-translation-mode')
  }
}
