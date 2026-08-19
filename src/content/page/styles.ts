import { HOVER_CLASS } from './paragraphTranslator.ts'
import { TRANSLATION_CLASS } from './walker.ts'

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
 * The rail is violet because violet means "a model wrote this" everywhere else
 * in the product, and it is translucent mid-tone rather than a fixed colour so
 * it survives both a white article and x.com's near-black. Without it the
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
  border-left: 3px solid rgba(138, 123, 240, 0.75) !important;
  padding-left: 0.75em;
  animation: ara-translation-in 220ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
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
  border-left-color: rgba(138, 123, 240, 0.3) !important;
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
    rgba(138, 123, 240, 0.16) 0%,
    rgba(138, 123, 240, 0.38) 50%,
    rgba(138, 123, 240, 0.16) 100%
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
