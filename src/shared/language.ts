/**
 * Language pair configuration.
 *
 * Source is what the user is reading (auto-detected by default, or pinned).
 * Target is what explanations are written in — fixed by the user, never
 * detected: it is the language they think in, and having it change per page
 * would make the product feel unreliable.
 */

import type { MessageKey } from '@/i18n/index.ts'

export interface SourceLanguage {
  code: string
  /**
   * 下拉框里显示的名字，存的是文案键。
   *
   * 存键而不是存字：这两张表是模块级常量，写死文案等于把语言冻在模块加载那一刻。
   * 取值在 `Options.tsx` 的渲染里做。
   */
  labelKey: MessageKey
  /** Prompt-facing name. */
  name: string
  /** A selection must contain this script to be worth looking up. */
  script: RegExp | null
}

export interface TargetLanguage {
  code: string
  /** 同 {@link SourceLanguage.labelKey}：存键，渲染时再取。 */
  labelKey: MessageKey
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
  { code: 'auto', labelKey: 'language.source.auto', name: 'the language of the text', script: null },
  { code: 'en', labelKey: 'language.source.en', name: 'English', script: LATIN },
  { code: 'ja', labelKey: 'language.source.ja', name: 'Japanese', script: JAPANESE },
  { code: 'ko', labelKey: 'language.source.ko', name: 'Korean', script: HANGUL },
  { code: 'de', labelKey: 'language.source.de', name: 'German', script: LATIN },
  { code: 'fr', labelKey: 'language.source.fr', name: 'French', script: LATIN },
  { code: 'es', labelKey: 'language.source.es', name: 'Spanish', script: LATIN },
  { code: 'ru', labelKey: 'language.source.ru', name: 'Russian', script: CYRILLIC },
]

export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { code: 'zh-CN', labelKey: 'language.target.zh_cn', name: '简体中文', nativeScript: HAN },
  { code: 'zh-TW', labelKey: 'language.target.zh_tw', name: '繁體中文', nativeScript: HAN },
  { code: 'en', labelKey: 'language.target.en', name: 'English', nativeScript: null },
  { code: 'ja', labelKey: 'language.target.ja', name: '日本語', nativeScript: JAPANESE },
  { code: 'ko', labelKey: 'language.target.ko', name: '한국어', nativeScript: HANGUL },
  { code: 'de', labelKey: 'language.target.de', name: 'Deutsch', nativeScript: null },
  { code: 'fr', labelKey: 'language.target.fr', name: 'Français', nativeScript: null },
  { code: 'es', labelKey: 'language.target.es', name: 'Español', nativeScript: null },
  { code: 'ru', labelKey: 'language.target.ru', name: 'Русский', nativeScript: CYRILLIC },
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

/**
 * 让译文的行结构和原文对上。
 *
 * 提示词里已经写了「输入几行、译文就几行」，但那是**请求时好好说**——
 * 和 @用户名 那件事一模一样，说了不算数。原文里的换行不是排版装饰：地址、诗、
 * 歌词、推文里分行的那几句，塌成一整段之后读者要重新去猜哪里断句，
 * 而他本来是靠这些行看懂结构的。
 *
 * 这里只做**可靠**的修复，修不了就返回 `null`，让调用方去逐行重译——
 * 那条路的结构是拼出来的，模型没有插手的余地。
 *
 * 返回 `null` 的判断标准是「我没法确定哪句对哪行」。硬猜出来的断句比塌成一段更糟：
 * 塌了读者知道自己在读一整段，断错了他会以为那就是原文的结构。
 */
export function conformLineShape(source: string, translation: string): string | null {
  const sourceLines = source.split('\n')
  const filled = sourceLines.filter((line) => line.trim())
  const translated = translation.split('\n').filter((line) => line.trim())

  // 原文本来就是一行：译文里多出来的换行是模型自己加的，合掉。
  if (filled.length <= 1) {
    return translated.join(' ').trim()
  }

  // 行数对不上，只靠这一份译文没法知道哪句属于哪行。
  if (translated.length !== filled.length) return null

  return rejoinOnSkeleton(source, translated)
}

/**
 * 按**原文的骨架**把逐行译文拼回去。
 *
 * 不直接用译文自己的换行：空行要落在原文空行的位置上，模型少给或多给一个空行，
 * 都不该让译文和原文错开一行——错开一行的对照，比不分行更难读。
 *
 * 每行译文里自带的换行会被压平。不压的话「按行拼接」这个保证就漏了：
 * 一行译回来两行，结构又对不上，而那时已经没有下一轮兜底了。
 */
export function rejoinOnSkeleton(source: string, lines: readonly string[]): string {
  let cursor = 0
  return source
    .split('\n')
    .map((line) =>
      line.trim() ? (lines[cursor++] ?? '').replace(/\s*\n\s*/g, ' ').trim() : '',
    )
    .join('\n')
}
