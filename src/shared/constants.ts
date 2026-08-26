/*
 * 产品名不再是常量。
 *
 * 它是要跟着界面语言变的一条文案（`app.name`），而常量在模块加载时就定死了。
 * 留一个 `APP_NAME` 在这儿，下一个人一定会顺手 import——所以直接不给这个机会。
 */

/** All chrome.storage keys live here so migrations have one place to look. */
export const STORAGE_KEYS = {
  meta: 'ara:meta',
  settings: 'ara:settings',
  words: 'ara:words',
  activity: 'ara:activity',
  reviewLog: 'ara:reviewLog',
  explainCache: 'ara:cache:explain',
  translationCache: 'ara:cache:translation',
  syncState: 'ara:syncState',
} as const

export const SCHEMA_VERSION = 6

/** Element id of the shadow host injected into pages. */
export const CONTENT_HOST_ID = 'fanfan-root'

/** Review log is a rolling window; the dashboard only ever reads the tail. */
export const REVIEW_LOG_LIMIT = 3000
/** Explain cache is an LRU keyed by (provider, model, word, context). */
export const EXPLAIN_CACHE_LIMIT = 300
/**
 * Page translation is many small segments, so its cache needs far more slots —
 * and its own key, or a single long article would evict every word explanation.
 */
export const TRANSLATION_CACHE_LIMIT = 3000

export const APP_PAGE = 'src/app/index.html'
export const OPTIONS_PAGE = 'src/options/index.html'
