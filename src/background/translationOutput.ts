import { targetLanguage } from '@/shared/language.ts'

/** A provider sometimes returns the complete source beside its translation.
 * Remove only an exact, long source prefix/suffix followed by real target-script
 * prose. Never strip arbitrary Latin text: model names and quotes can belong in
 * the translation. Latin-to-Latin pairs cannot be distinguished safely here. */
export function removeSourceEcho(source: string, output: string, targetCode: string): string {
  const text = source.trim()
  const value = output.trim()
  const script = targetLanguage(targetCode).nativeScript
  if (!script || script.test(text) || text.length < 40 || (text.match(/\p{L}+/gu)?.length ?? 0) < 6) return value

  // Only whitespace may differ from the exact input. Keep case, words and
  // punctuation intact so a merely similar phrase is not treated as an echo.
  const exact = text.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  const prefix = value.match(new RegExp(`^${exact}(?=\\s|[：:|—–-]|$)`, 'u'))
  const suffix = value.match(new RegExp(`(?:^|\\s|[：:|—–-])(${exact})$`, 'u'))
  const remainder = prefix ? value.slice(prefix[0].length).replace(/^[\s：:|—–-]+/u, '')
    : suffix ? value.slice(0, suffix.index).replace(/[\s：:|—–-]+$/u, '') : null
  if (remainder === null) return value
  const letters = [...remainder].filter((char) => /\p{L}/u.test(char))
  const targetLetters = letters.filter((char) => script.test(char)).length
  return targetLetters >= 4 && targetLetters / letters.length >= 0.4 ? remainder : value
}
