/**
 * Language pair configuration.
 *
 * Source is what the user is reading (auto-detected by default, or pinned).
 * Target is what explanations are written in — fixed by the user, never
 * detected: it is the language they think in, and having it change per page
 * would make the product feel unreliable.
 */

export interface SourceLanguage {
  code: string
  label: string
  /** Prompt-facing name. */
  name: string
  /** A selection must contain this script to be worth looking up. */
  script: RegExp | null
}

export interface TargetLanguage {
  code: string
  label: string
  name: string
  /**
   * Script of the user's own language. When it is non-Latin we can safely skip
   * selections written entirely in it — nobody looks up their native words.
   * Latin-script targets get `null`, because an English speaker reading German
   * is selecting Latin text and must still be served.
   */
  nativeScript: RegExp | null
}

const LATIN = /\p{Script=Latin}/u
const HAN = /\p{Script=Han}/u
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u
const HANGUL = /\p{Script=Hangul}/u
const CYRILLIC = /\p{Script=Cyrillic}/u

export const SOURCE_LANGUAGES: readonly SourceLanguage[] = [
  { code: 'auto', label: '自动识别', name: 'the language of the text', script: null },
  { code: 'en', label: '英语 English', name: 'English', script: LATIN },
  { code: 'ja', label: '日语 日本語', name: 'Japanese', script: JAPANESE },
  { code: 'ko', label: '韩语 한국어', name: 'Korean', script: HANGUL },
  { code: 'de', label: '德语 Deutsch', name: 'German', script: LATIN },
  { code: 'fr', label: '法语 Français', name: 'French', script: LATIN },
  { code: 'es', label: '西班牙语 Español', name: 'Spanish', script: LATIN },
  { code: 'ru', label: '俄语 Русский', name: 'Russian', script: CYRILLIC },
]

export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { code: 'zh-CN', label: '简体中文', name: '简体中文', nativeScript: HAN },
  { code: 'zh-TW', label: '繁體中文', name: '繁體中文', nativeScript: HAN },
  { code: 'en', label: 'English', name: 'English', nativeScript: null },
  { code: 'ja', label: '日本語', name: '日本語', nativeScript: JAPANESE },
  { code: 'ko', label: '한국어', name: '한국어', nativeScript: HANGUL },
  { code: 'de', label: 'Deutsch', name: 'Deutsch', nativeScript: null },
  { code: 'fr', label: 'Français', name: 'Français', nativeScript: null },
  { code: 'es', label: 'Español', name: 'Español', nativeScript: null },
  { code: 'ru', label: 'Русский', name: 'Русский', nativeScript: CYRILLIC },
]

export const DEFAULT_SOURCE = 'auto'
export const DEFAULT_TARGET = 'zh-CN'

export function sourceLanguage(code: string): SourceLanguage {
  return SOURCE_LANGUAGES.find((item) => item.code === code) ?? SOURCE_LANGUAGES[0]!
}

export function targetLanguage(code: string): TargetLanguage {
  return TARGET_LANGUAGES.find((item) => item.code === code) ?? TARGET_LANGUAGES[0]!
}

/** True when explanations should be written in Chinese. */
export function isChineseTarget(code: string): boolean {
  return code.startsWith('zh')
}

/**
 * Should a selection trigger a lookup at all?
 *
 * Two jobs: keep the pill away from punctuation and numbers, and keep it away
 * from the user's own language. Getting the second one wrong is what makes
 * these extensions feel like spyware — a pill popping up every time you select
 * a phone number on a page written in your own language.
 */
export function isLookupCandidate(
  text: string,
  languages: { source: string; target: string },
): boolean {
  const letters = [...text].filter((char) => /\p{L}/u.test(char))
  if (letters.length === 0) return false

  const source = sourceLanguage(languages.source)
  if (source.script) return letters.some((char) => source.script!.test(char))

  // Auto-detect: anything goes, except text made up entirely of the user's own
  // (non-Latin) script.
  const guard = targetLanguage(languages.target).nativeScript
  if (guard && letters.every((char) => guard.test(char))) return false
  return true
}


/**
 * Is this fragment worth sending to a translator?
 *
 * Page translation lives or dies on this predicate. Every false positive costs
 * money, latency, and — worst — puts a redundant line of text under something
 * that never needed one. On a page like x.com, without these rules, a Chinese
 * UI gets "translated" into identical Chinese, every @handle is echoed back,
 * and the result reads as vandalism rather than help.
 */
export function shouldTranslateText(text: string, targetCode: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false

  const letters = [...trimmed].filter((char) => /\p{L}/u.test(char))
  if (letters.length === 0) return false

  // A single token with no spaces that carries @ # / . or digits is a handle,
  // a URL, a domain or a model name — never prose. Plain single words like
  // "Home" stay translatable, because in a nav they genuinely need it.
  if (!/\s/.test(trimmed) && /[@#/\\.:0-9_]/.test(trimmed) && trimmed.length < 40) return false
  if (/^https?:\/\//i.test(trimmed)) return false

  // Text already in the reader's own script needs no translation. Only applies
  // to non-Latin targets: for a Latin-script target we cannot tell "English" from
  // "German" by script alone, so we translate and let the model decide.
  const guard = targetLanguage(targetCode).nativeScript
  if (guard) {
    const inTarget = letters.filter((char) => guard.test(char)).length
    if (inTarget / letters.length > 0.6) return false
  }

  return true
}

/**
 * True when a translation says nothing the original did not.
 *
 * The last line of defence: whatever the heuristics miss, a model handing back
 * the input unchanged must not become a duplicated line on the page.
 */
export function isRedundantTranslation(source: string, translation: string): boolean {
  const normalise = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const a = normalise(source)
  const b = normalise(translation)
  return b.length === 0 || a === b
}


/**
 * Things a translation must carry over verbatim.
 *
 * @handles, hashtags, URLs and emails are content, not decoration: a tweet
 * whose ten @mentions vanished has lost the point of the post. Models drop them
 * because "there is nothing to translate", and no amount of prompting makes
 * that reliable — read-frog reached the same conclusion about its own markup
 * and started asserting integrity on the way back instead of asking nicely.
 */
const VERBATIM_TOKEN = /(?:https?:\/\/\S+|(?:^|[\s(（])@[A-Za-z0-9_]{2,}|(?:^|[\s(（])#[^\s#]{2,}|[\w.+-]+@[\w-]+\.[\w.]+)/gu

export function verbatimTokens(text: string): string[] {
  return [...text.matchAll(VERBATIM_TOKEN)].map((match) => match[0].trim()).filter(Boolean)
}

/**
 * Puts back whatever the model silently dropped.
 *
 * Appending is not elegant, but the alternative — a translation that quietly
 * omits every person the post mentioned — is a lie about the content. Anything
 * still present is left exactly where the model put it.
 */
export function repairOmissions(source: string, translation: string): string {
  if (!translation.trim()) return translation

  const missing = verbatimTokens(source).filter((token) => !translation.includes(token))
  if (missing.length === 0) return translation

  return `${translation.trimEnd()}\n${[...new Set(missing)].join(' ')}`
}
