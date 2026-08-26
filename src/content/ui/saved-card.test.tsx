// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { setLanguage } from '@/i18n/index.ts'
import { SavedWordCard } from './SavedWordCard.tsx'

vi.mock('@/services/speech.ts', () => ({ speak: vi.fn(), warmUpVoices: vi.fn() }))

/**
 * 翻翻模式点开的那张卡。
 *
 * 它最有价值的一段是**当初收藏时的那句原文**——脱离语境的单词表背不下来，
 * 而那一句是读者自己读到过的，比模型编的例句更容易把记忆勾回来。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const entry = (over: Partial<VocabularyEntry> = {}): VocabularyEntry =>
  ({
    id: 'w1',
    word: 'posttraining',
    lemma: 'posttraining',
    normalized: 'posttraining',
    kind: 'word',
    phonetic: '',
    partOfSpeech: 'adjective',
    cefr: '',
    meaning: '训练之后的',
    senses: [],
    sentenceTranslation: '六月份我离开了 OpenAI。',
    examples: [],
    synonyms: [],
    source: {
      url: 'https://x.com/j_upward/status/1',
      title: 'Jonathan Ward on X',
      context: 'In June, I left OpenAI after five years as a posttraining researcher.',
      wideContext: '',
      capturedAt: 0,
    },
    deletedAt: null,
    ...over,
  }) as VocabularyEntry

let container: HTMLDivElement
let root: Root

function render(value: VocabularyEntry, enriching = false, enrichFailed = false): void {
  act(() => {
    root.render(
      <SavedWordCard
        entry={value}
        enriching={enriching}
        enrichFailed={enrichFailed}
        inLibrary
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    )
  })
}

beforeEach(() => {
  // 语言写死，不跟着测试环境走——jsdom 报的是 en-US，而这几条断言的是中文文案。
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('例句与翻译', () => {
  it('把当初收藏时的那句原文和它的翻译一起显示出来', () => {
    render(entry())
    expect(container.textContent).toContain('In June, I left OpenAI')
    expect(container.textContent).toContain('六月份我离开了 OpenAI。')
  })

  /** 标出那个词，眼睛才知道该落在哪儿——和划词卡用的是同一段渲染。 */
  it('句子里的那个词被标出来', () => {
    render(entry())
    expect(container.querySelector('mark')?.textContent).toBe('posttraining')
  })

  /**
   * 叫「例句」不叫「原文」。
   *
   * 划词卡上那一段是**这一页此刻**的句子，所以叫原文；这里那句话来自当初收藏它的
   * 地方，和眼前这一页毫无关系。继续叫「原文」会让读者以为说的是他正在读的这句。
   */
  it('标题是「例句与翻译」，不是「原文与翻译」', () => {
    render(entry())
    const labels = [...container.querySelectorAll('.label')].map((l) => l.textContent ?? '')
    expect(labels.some((l) => l.includes('例句与翻译'))).toBe(true)
    expect(labels.some((l) => l.includes('原文'))).toBe(false)
  })

  it('顺带说明它来自哪儿', () => {
    render(entry())
    expect(container.textContent).toContain('Jonathan Ward on X')
  })

  it('没有译文时，句子照样显示', () => {
    render(entry({ sentenceTranslation: '' }))
    expect(container.textContent).toContain('In June, I left OpenAI')
  })
})

describe('缺字段也不能塌', () => {
  /**
   * 词卡可能来自更早的版本、别人导出的 JSON、或者一次半路失败的同步。
   * 这里抛一次异常，塌掉的不是这张卡，是整个内容脚本的界面——
   * 读者会发现划词突然彻底没反应了。
   */
  it('source 整个不在时也画得出来', () => {
    expect(() => render(entry({ source: undefined as never }))).not.toThrow()
    expect(container.textContent).toContain('训练之后的')
  })

  it('source 在但没有句子时，不显示这一段', () => {
    render(entry({ source: { url: '', title: '', context: '', wideContext: '', capturedAt: 0 } }))
    const labels = [...container.querySelectorAll('.label')].map((l) => l.textContent ?? '')
    expect(labels.some((l) => l.includes('例句与翻译'))).toBe(false)
    expect(container.textContent).toContain('训练之后的')
  })

  it('什么内容都没有时，说一句，而不是给一张空卡', () => {
    render(
      entry({
        meaning: '',
        senses: [],
        sentenceTranslation: '',
        source: { url: '', title: '', context: '', wideContext: '', capturedAt: 0 },
      }),
    )
    expect(container.textContent).toContain('还没有')
  })
})

describe('多词性释义', () => {
  it('按词性分行显示', () => {
    render(
      entry({
        meaning: '形容词：独有的；名词：独家新闻',
        senses: [
          { partOfSpeech: 'adjective', meaning: '独有的，排外的' },
          { partOfSpeech: 'noun', meaning: '独家新闻' },
        ],
      }),
    )
    const rows = [...container.querySelectorAll('.sense-row')].map((r) => r.textContent)
    expect(rows).toEqual(['形容词独有的，排外的', '名词独家新闻'])
  })

  it('没有 senses 时退回那一行 meaning', () => {
    render(entry({ meaning: '注意，注意力', senses: [] }))
    expect(container.querySelector('.sense-list')).toBeNull()
    expect(container.textContent).toContain('注意，注意力')
  })

  /**
   * 这一节原来只看 meaning 是否非空。
   *
   * 生产里 meaning 是从 senses 推导出来的、所以碰巧非空——但那是个脆耦合：
   * 任何一条「有结构化释义、没有那行汇总文本」的数据都会让整节凭空消失，
   * 而消失的东西没人会去找。这条用例就是那个组合。
   */
  it('只有 senses、没有 meaning 时，这一节也要显示出来', () => {
    render(
      entry({
        meaning: '',
        senses: [{ partOfSpeech: 'verb', meaning: '执行，运行' }],
      }),
    )
    expect(container.querySelector('.sense-list')).not.toBeNull()
    expect(container.textContent).toContain('执行，运行')
  })
})

describe('取消收藏之后卡片留在原地', () => {
  const bookmark = () => container.querySelectorAll<HTMLButtonElement>('.card-head .icon-btn')[0]!

  it('在库里时是实心，点它是移出', () => {
    const onRemove = vi.fn()
    act(() => {
      root.render(
        <SavedWordCard
          entry={entry()}
          enriching={false}
          enrichFailed={false}
          inLibrary
          onSave={() => {}}
          onRemove={onRemove}
          onClose={() => {}}
        />,
      )
    })
    expect(bookmark().querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
    act(() => bookmark().click())
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  /**
   * 移出之后卡片**不关**。
   *
   * 内容还在手里，而读者常常是想确认一下再决定。关掉等于逼他重新去页面上找那个词——
   * 而那个词的高亮此刻已经没了。
   */
  it('移出之后内容还在，书签变空心，点它是收回来', () => {
    const onSave = vi.fn()
    act(() => {
      root.render(
        <SavedWordCard
          entry={entry()}
          enriching={false}
          enrichFailed={false}
          inLibrary={false}
          onSave={onSave}
          onRemove={() => {}}
          onClose={() => {}}
        />,
      )
    })
    expect(container.textContent).toContain('训练之后的')
    expect(bookmark().querySelector('svg')!.getAttribute('fill')).toBe('none')
    act(() => bookmark().click())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('两种状态在读屏软件那里也分得开', () => {
    render(entry())
    expect(bookmark().getAttribute('aria-pressed')).toBe('true')
    act(() => {
      root.render(
        <SavedWordCard
          entry={entry()}
          enriching={false}
          enrichFailed={false}
          inLibrary={false}
          onSave={() => {}}
          onRemove={() => {}}
          onClose={() => {}}
        />,
      )
    })
    expect(bookmark().getAttribute('aria-pressed')).toBe('false')
  })
})
