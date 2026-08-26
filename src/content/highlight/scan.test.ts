// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { buildIndex, scanForSavedWords } from './scan.ts'

/**
 * 翻翻模式的第一半：在满页文字里认出「这是我收藏过的词」。
 *
 * 认错了的代价不对称：漏掉一个，读者什么都不会察觉；多标一个，
 * 他点开发现是张不相干的卡，这个功能就不可信了。所以这里的用例大半在测
 * **不该亮的地方不亮**。
 */

const BASE = {
  id: 'w1',
  word: 'migration',
  normalized: 'migration',
  lemma: 'migration',
  deletedAt: null,
} as VocabularyEntry

const index = (...entries: Array<Partial<VocabularyEntry>>) =>
  buildIndex(entries.map((e) => ({ ...BASE, ...e }) as VocabularyEntry))

const scan = (html: string, map: Map<string, string>) => {
  document.body.innerHTML = html
  return scanForSavedWords(document.body, map)
}

const words = (html: string, map: Map<string, string>) =>
  scan(html, map).map((hit) => hit.node.data.slice(hit.start, hit.end))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('词形索引', () => {
  it('normalized 和 lemma 两个形态都进表', () => {
    const map = index({ id: 'a', normalized: 'misleading', lemma: 'mislead' })
    expect(map.get('misleading')).toBe('a')
    expect(map.get('mislead')).toBe('a')
  })

  it('短语不进表——跨词匹配是另一套问题', () => {
    const map = index({ id: 'a', normalized: 'lock a table', lemma: 'lock a table' })
    expect(map.size).toBe(0)
  })

  it('删掉的卡不进表', () => {
    const map = index({ id: 'a', normalized: 'gone', deletedAt: Date.now() })
    expect(map.size).toBe(0)
  })
})

describe('匹配：该亮的', () => {
  it('认出保存过的词', () => {
    expect(words('<p>A database migration takes minutes.</p>', index({ normalized: 'migration' })))
      .toEqual(['migration'])
  })

  it('大小写不影响', () => {
    expect(words('<p>Migration and MIGRATION.</p>', index({ normalized: 'migration' })))
      .toEqual(['Migration', 'MIGRATION'])
  })

  it('同一页出现多次就标多次', () => {
    const hits = scan('<p>run and run</p>', index({ normalized: 'run' }))
    expect(hits).toHaveLength(2)
    expect(hits[0]!.start).not.toBe(hits[1]!.start)
  })

  it('带撇号的词按整词认', () => {
    expect(words("<p>It doesn't matter.</p>", index({ normalized: "doesn't" })))
      .toEqual(["doesn't"])
  })
})

describe('匹配：不该亮的', () => {
  /** 这是「只做全匹配」这个决定的直接后果，写下来免得日后被当成 bug。 */
  it('不做词形还原：migrations 不会因为存了 migration 就亮', () => {
    expect(words('<p>Two migrations ran.</p>', index({ normalized: 'migration' }))).toEqual([])
  })

  it('不匹配词的一部分', () => {
    expect(words('<p>immigration policy</p>', index({ normalized: 'migration' }))).toEqual([])
  })

  it('躲开我们自己插入的译文', () => {
    const map = index({ normalized: 'migration' })
    expect(words(`<div class="ara-translation">migration</div>`, map)).toEqual([])
  })

  it('躲开我们自己的界面', () => {
    const map = index({ normalized: 'migration' })
    expect(words(`<div id="${CONTENT_HOST_ID}"><p>migration</p></div>`, map)).toEqual([])
  })

  /** 代码里的 for 和英语里的 for 不是同一个东西。 */
  it('躲开代码块', () => {
    const map = index({ normalized: 'for' })
    expect(words('<pre>for (const x of y)</pre>', map)).toEqual([])
    expect(words('<p><code>for</code></p>', map)).toEqual([])
  })

  it('躲开脚本与样式', () => {
    const map = index({ normalized: 'migration' })
    expect(words('<script>var migration = 1</script>', map)).toEqual([])
    expect(words('<style>.migration{}</style>', map)).toEqual([])
  })

  /** 在读者正在打字的地方画高亮，会挡住光标。 */
  it('躲开输入区域', () => {
    const map = index({ normalized: 'migration' })
    expect(words('<textarea>migration</textarea>', map)).toEqual([])
    expect(words('<div contenteditable="true">migration</div>', map)).toEqual([])
  })

  it('词库是空的就什么都不扫', () => {
    expect(scan('<p>migration</p>', new Map())).toEqual([])
  })
})

describe('匹配：有上限', () => {
  /**
   * 上限不是性能保险，是观感保险。
   *
   * 一页上几百处高亮不叫「标出我认识的词」，叫把文章涂花了——
   * 读者的第一反应会是把这个功能关掉。
   */
  it('多到一定程度就停下', () => {
    document.body.innerHTML = `<p>${'run '.repeat(600)}</p>`
    const hits = scanForSavedWords(document.body, index({ normalized: 'run' }), { limit: 50 })
    expect(hits).toHaveLength(50)
  })
})
