/** Video translation follows its explicit target, never the UI language or a source preference. */
export function primaryLanguage(code: string): string {
  return code.toLowerCase().replace(/_/g, '-').split('-')[0] ?? ''
}

/** Unknown and mixed results must never suppress foreign-language content. */
export function isReliableTargetLanguage(result: chrome.i18n.LanguageDetectionResult, target: string): boolean {
  const language = primaryLanguage(target)
  return !!language && result.isReliable && result.languages.length > 0 &&
    result.languages.every(item => item.percentage > 0 && primaryLanguage(item.language) === language) &&
    result.languages.reduce((sum, item) => sum + item.percentage, 0) >= 90
}

/** Merge short caption lines so CLD can judge natural language, not isolated words. */
export function videoLanguageWindows(texts: readonly string[]): string[] {
  const windows: string[] = []
  let current = ''
  for (const text of [...new Set(texts.map(value => value.trim()))]) {
    if (!/\p{L}/u.test(text)) continue
    current += `${current ? '\n' : ''}${text}`
    if (current.length >= 256) { windows.push(current); current = '' }
  }
  if (current) {
    if (windows.length && current.length < 128) windows[windows.length - 1] += `\n${current}`
    else windows.push(current)
  }
  return windows
}

/**
 * CLD is local and available to content scripts and extension workers. Short cues
 * are combined, while foreign scripts and individual foreign-language evidence
 * are retained: a dominant language must not suppress a multilingual track.
 * Missing, failed, unreliable or slow detection allows translation.
 */
export async function isVideoInTargetLanguage(texts: readonly string[], target: string): Promise<boolean> {
  const windows = videoLanguageWindows(texts)
  if (!windows.length) return false
  const language = primaryLanguage(target)
  const scripts: Record<string, RegExp> = {
    zh: /[\p{Script=Han}\p{Script=Latin}]/u,
    ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
    ko: /[\p{Script=Han}\p{Script=Hangul}]/u,
    ru: /\p{Script=Cyrillic}/u,
    en: /\p{Script=Latin}/u, es: /\p{Script=Latin}/u, fr: /\p{Script=Latin}/u,
    de: /\p{Script=Latin}/u, pt: /\p{Script=Latin}/u,
  }
  const script = scripts[language]
  if (script && windows.some(text => [...text].some(char => /\p{L}/u.test(char) && !script.test(char)))) return false
  // Chinese prose often contains product names and abbreviations (ChatGPT, AI,
  // API). Those are not an English sentence. Preserve standalone Latin cues and
  // multiword Latin phrases as foreign-language evidence before aggregating.
  if (language === 'zh' && texts.some(text => /\p{Script=Latin}/u.test(text) &&
    (!/\p{Script=Han}/u.test(text) || /\p{Script=Latin}+(?:[\s,;?!'’-]+\p{Script=Latin}+){2,}/u.test(text)))) return false
  const detectionWindows = language === 'zh'
    ? videoLanguageWindows(texts.map(text => text.replace(/\p{Script=Latin}[\p{Script=Latin}\p{N}._+-]*/gu, '')))
    : windows
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (typeof chrome?.i18n?.detectLanguage !== 'function') return false
    return await Promise.race([
      (async () => {
        const results = await Promise.all(detectionWindows.map(text => chrome.i18n.detectLanguage(text)))
        if (expired || !results.length) return false
        if (!results.every(result => isReliableTargetLanguage(result, target))) return false
        // Latin languages share an alphabet; Japanese also shares Han with Chinese.
        // Keep per-cue evidence in those cases instead of trusting the majority.
        if (language !== 'zh' && language !== 'ko' && language !== 'ru') {
          const cues = [...new Set(texts.filter(text => /\p{L}/u.test(text)))]
          const individual = await Promise.all(cues.map(text => chrome.i18n.detectLanguage(text)))
          if (individual.some(result => !result.languages.length || result.languages.some(item => primaryLanguage(item.language) !== language))) return false
        }
        return true
      })(),
      new Promise<boolean>(resolve => { timer = setTimeout(() => { expired = true; resolve(false) }, 3000) }),
    ])
  } catch { return false } finally { if (timer) clearTimeout(timer) }
}
