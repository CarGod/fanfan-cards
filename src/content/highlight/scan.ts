import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { isEditable } from '../dom/editable.ts'
import { TRANSLATION_CLASS } from '../page/walker.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * 在页面文本里找出词库里已有的词。
 *
 * 纯逻辑，不碰绘制：这一层只回答「哪个文本节点的哪一段是我的哪张卡」，
 * 怎么画是下一层的事。分开是因为「匹配对不对」和「画得好不好看」是两种完全
 * 不同的错，混在一起会让前者永远查不出来。
 */

/** 一次命中：某个文本节点里的一段，对应哪张卡。 */
export interface WordHit {
  node: Text
  start: number
  end: number
  entryId: string
}

/**
 * 词形索引：一个形态一张卡。
 *
 * **只做全匹配**，不做词形还原。`migration` 存过就只认 `migration`，
 * 页面上的 `migrations` 不会亮——除非那张卡自己的 lemma 正好是它。
 * 这是一次刻意的取舍：算法猜词形（-s/-ed/-ing）在英语上错得又多又难看，
 * 而词库小的时候漏几个屈折形根本不影响读者，词库大了再说。
 */
export function buildIndex(entries: readonly VocabularyEntry[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const entry of entries) {
    if (entry.deletedAt) continue
    // 短语不参与：跨词的匹配和跨节点的选区都是另一套问题。
    for (const form of [entry.normalized, entry.lemma]) {
      const key = form?.trim().toLowerCase()
      if (!key || key.includes(' ')) continue
      // 先存的先赢：同一个形态被两张卡占用时，行为至少是确定的。
      if (!index.has(key)) index.set(key, entry.id)
    }
  }
  return index
}

/**
 * 一个「词」是什么。
 *
 * 允许词内的撇号和连字符（`don't`、`state-of-the-art` 里的每一段），
 * 但不允许它们出现在两端——`"word"` 里的引号不该被算进这个词。
 */
const WORD = /\p{L}[\p{L}\p{M}\p{Nd}]*(?:['’\-][\p{L}\p{M}\p{Nd}]+)*/gu

/** 这些元素里的文字不是读者在读的内容。 */
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
])

/**
 * 该不该扫这个文本节点。
 *
 * 三类要躲开，各有各的道理：我们自己插入的东西（译文、划词卡），
 * 读者正在输入的地方（在输入框里画高亮会挡住光标），
 * 以及代码块（`for` 是保存过的单词，但代码里的 `for` 不是同一个东西）。
 */
function shouldScan(node: Text): boolean {
  const text = node.data
  if (!text.trim()) return false

  let element = node.parentElement
  let depth = 0
  while (element && depth++ < 32) {
    if (SKIP_TAGS.has(element.tagName)) return false
    if (element.id === CONTENT_HOST_ID) return false
    if (element.classList?.contains(TRANSLATION_CLASS)) return false
    if (isEditable(element)) return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    element = element.parentElement
  }
  return true
}

/**
 * 扫一遍，把命中都找出来。
 *
 * 一次遍历、每个词查一次 Map——不是每个词扫一遍全文。一篇长文有几千个文本节点，
 * 词库有几百张卡，按词循环是几十万次匹配，按文本循环是几万次哈希查找。
 */
export function scanForSavedWords(
  root: Node,
  index: Map<string, string>,
  options: { limit?: number } = {},
): WordHit[] {
  const hits: WordHit[] = []
  if (index.size === 0) return hits
  /*
   * 上限不是性能保险，是**观感**保险：一页上几百处高亮不叫「标出我认识的词」，
   * 叫把文章涂花了，读者第一反应是关掉这个功能。
   */
  const limit = options.limit ?? 400

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    if (shouldScan(node)) {
      for (const match of node.data.matchAll(WORD)) {
        const word = match[0]
        const entryId = index.get(word.toLowerCase())
        if (!entryId) continue
        hits.push({
          node,
          start: match.index,
          end: match.index + word.length,
          entryId,
        })
        if (hits.length >= limit) return hits
      }
    }
    node = walker.nextNode() as Text | null
  }
  return hits
}
