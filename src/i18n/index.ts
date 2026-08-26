import { MESSAGES, type MessageKey } from './messages.ts'
import type { ResolvedLanguage, UiLanguage } from './types.ts'

export type { MessageKey } from './messages.ts'
export type { ResolvedLanguage, UiLanguage } from './types.ts'
export { UI_LANGUAGES } from './types.ts'

/**
 * 界面文案。
 *
 * 为什么不用 Chrome 原生的 `chrome.i18n` + `_locales/`：它只认浏览器的界面语言，
 * **运行时改不了**。而这个产品的读者是在学英语的人——把界面切成英文是他主动的
 * 练习选择，不是他系统语言的副产品。所以自己实现一层，`_locales/` 只留给
 * `manifest.json` 里那几项（名称、描述、快捷键说明），那些确实只能跟浏览器走。
 *
 * 取值同步、切换广播：`t()` 在渲染里被调用，不能是 Promise。
 */

function browserLanguage(): ResolvedLanguage {
  // chrome.i18n 在内容脚本里也有；取不到时退回页面的 navigator。
  let tag = ''
  try {
    tag = chrome?.i18n?.getUILanguage?.() ?? ''
  } catch {
    /* 上下文失效或没有这个 API，往下走 */
  }
  if (!tag) tag = navigator.language || ''
  return tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** `auto` 落地成一个真实语言。 */
export function resolveLanguage(preference: UiLanguage): ResolvedLanguage {
  return preference === 'auto' ? browserLanguage() : preference
}

let current: ResolvedLanguage = browserLanguage()
const listeners = new Set<() => void>()

export function currentLanguage(): ResolvedLanguage {
  return current
}

/**
 * 切换界面语言。传 `auto` 表示重新跟随浏览器。
 *
 * 只在真的变了的时候广播——否则设置页每存一次都会让所有订阅者重渲染一遍。
 */
export function setLanguage(preference: UiLanguage): void {
  const next = resolveLanguage(preference)
  if (next === current) return
  current = next
  for (const listener of [...listeners]) listener()
}

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 取一条文案。
 *
 * 占位符写成 `{name}`，缺参数时原样留着——宁可界面上出现一个 `{count}`，
 * 也不要因为少传一个参数把整个页面炸掉。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key]
  /*
   * 键打错了是开发期的事，但它不该在用户面前变成一片空白。把键本身显示出来：
   * 一眼能看出是哪条没接上，而不是对着空按钮猜。
   */
  if (!entry) return key
  const template = entry[current] ?? entry['zh-CN']
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
