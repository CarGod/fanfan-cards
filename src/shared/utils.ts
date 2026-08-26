/** Small, dependency-free helpers shared by every entrypoint. */

import { currentLanguage, t } from '@/i18n/index.ts'
import type { SelectionKind } from '@/types/vocabulary.ts'

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/** Lowercase + strip surrounding punctuation. The dedupe/search key. */
export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .replace(/\s+/g, ' ')
}

export function isPhrase(text: string): boolean {
  return normalizeWord(text).includes(' ')
}

/** Terminal punctuation, allowing a closing quote or bracket after it. */
const SENTENCE_END = /[.!?。！？…]["'’”)\]]?\s*$/

/**
 * Word, phrase or sentence.
 *
 * Two signals, because either alone is wrong: terminal punctuation catches
 * "Be water, my friend." while length catches "the quick brown fox jumps over
 * the lazy dog" — which is a sentence in substance even though the user's
 * selection stopped short of the full stop.
 *
 * The three-word floor keeps a sloppily selected "Hello." a word, and the
 * eight-word ceiling leaves idioms alone: "as far as I am concerned" is six.
 */
export function classifySelection(text: string): SelectionKind {
  const trimmed = text.trim()
  if (!trimmed) return 'word'
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 3 && (SENTENCE_END.test(trimmed) || words.length >= 8)) return 'sentence'
  return words.length > 1 ? 'phrase' : 'word'
}

/** `YYYY-MM-DD` in local time — the unit the streak counter works in. */
export function dateKey(at: number = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function startOfDay(at: number = Date.now()): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** Days between two local calendar days (positive when `b` is later). */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
}

/*
 * 这两个函数在函数体里取文案，不在模块顶层。
 *
 * 它们的返回值是一句一句拼出来的界面文字，不是常量；写成模块级的表会让语言停在
 * 加载那一刻，而调用方（词库列表、闪卡预览、同步状态）恰好都是长驻页面。
 */
export function formatRelative(at: number, now: number = Date.now()): string {
  const diff = now - at
  if (diff < 60_000) return t('time.just_now')
  if (diff < 3_600_000) return t('time.minutes_ago', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('time.hours_ago', { count: Math.floor(diff / 3_600_000) })
  const days = dayDiff(at, now)
  if (days === 1) return t('time.yesterday')
  if (days < 30) return t('time.days_ago', { count: days })
  // 一个月以上就报日期。日期格式跟界面语言走，不然英文界面里会冒出 2026/1/10 这种
  // 只有中文读者才熟悉的排法。
  return new Date(at).toLocaleDateString(currentLanguage() === 'en' ? 'en-US' : 'zh-CN')
}

export function formatDue(dueAt: number, now: number = Date.now()): string {
  if (dueAt <= now) return t('time.due.now')
  const days = dayDiff(now, dueAt)
  if (days <= 0) return t('time.due.later_today')
  if (days === 1) return t('time.due.tomorrow')
  return t('time.due.in_days', { count: days })
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return wrapped
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Cheap, stable string hash (FNV-1a) used for cache keys. */
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
