import { describe, expect, it } from 'vitest'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { missingFields, needsEnriching } from './enrichment.ts'

/**
 * 空 ≠ 缺。
 *
 * 这是这个模块存在的全部理由。有些字段**按设计**就该是空的：读者把例句关了、
 * 或者这张卡是整句。把它们当成缺，那些卡就永远补不完——每换一个页面点开一次，
 * 就发一次注定填不上任何东西的付费请求，而读者看到的只是一次无意义的骨架闪烁。
 *
 * 更一般的原则：**功能要跟设置走**。一个明确说过「我不要例句」的人，
 * 不该因为他的卡上没有例句而被反复扣费。
 */

const entry = (over: Partial<VocabularyEntry> = {}): VocabularyEntry =>
  ({
    kind: 'word',
    sentenceTranslation: '有翻译',
    examples: [{ sentence: 'a', translation: 'b' }],
    synonyms: [{ word: 'c', meaning: 'd' }],
    source: { url: '', title: '', context: '当初那一句', wideContext: '', capturedAt: 0 },
    ...over,
  }) as VocabularyEntry

const full = { exampleCount: 3 }
const noExamples = { exampleCount: 0 }

describe('哪些算缺', () => {
  it('都齐了就不缺', () => {
    expect(missingFields(entry(), full)).toEqual([])
  })

  it('缺哪个报哪个', () => {
    expect(missingFields(entry({ sentenceTranslation: '' }), full)).toEqual(['sentenceTranslation'])
    expect(missingFields(entry({ examples: [] }), full)).toEqual(['examples'])
    expect(missingFields(entry({ synonyms: [] }), full)).toEqual(['synonyms'])
  })
})

describe('跟着设置走', () => {
  /** 读者明确说过「我不要例句」，那没有例句就是对的。 */
  it('例句关了之后，没有例句不算缺', () => {
    expect(missingFields(entry({ examples: [] }), noExamples)).toEqual([])
  })

  it('例句关了，但缺翻译还是缺', () => {
    expect(missingFields(entry({ examples: [], sentenceTranslation: '' }), noExamples)).toEqual([
      'sentenceTranslation',
    ])
  })

  it('例句关了不影响近义词', () => {
    expect(missingFields(entry({ examples: [], synonyms: [] }), noExamples)).toEqual(['synonyms'])
  })
})

describe('整句卡', () => {
  /**
   * 提示词里就写死了：「examples 与 synonyms 返回空数组，它们对整句没有意义」。
   * 一整句话的「近义词」本来也不是个有意义的东西。
   */
  it('整句卡的例句和近义词都不算缺', () => {
    expect(missingFields(entry({ kind: 'sentence', examples: [], synonyms: [] }), full)).toEqual([])
  })

  it('整句卡还是要有整句翻译', () => {
    expect(
      missingFields(entry({ kind: 'sentence', examples: [], synonyms: [], sentenceTranslation: '' }), full),
    ).toEqual(['sentenceTranslation'])
  })
})

describe('值不值得发这次请求', () => {
  it('缺东西就值得', () => {
    expect(needsEnriching(entry({ synonyms: [] }), full)).toBe(true)
  })

  it('不缺就不值得', () => {
    expect(needsEnriching(entry(), full)).toBe(false)
  })

  /**
   * 没有当初那句原文就补不了。
   * 第二段要的正是「这个词在那一句里」的翻译和贴合语境的例句——
   * 脱离那句话去要，拿回来的是和这张卡毫无关系的通用内容。
   */
  it('没有原文就不值得——补回来的东西和这张卡没关系', () => {
    const orphan = entry({
      synonyms: [],
      source: { url: '', title: '', context: '', wideContext: '', capturedAt: 0 },
    })
    expect(needsEnriching(orphan, full)).toBe(false)
  })

  /** 这一条正是那个「永远补不完」的组合。 */
  it('例句关了的整句卡，永远不该再发请求', () => {
    const sentence = entry({ kind: 'sentence', examples: [], synonyms: [] })
    expect(needsEnriching(sentence, noExamples)).toBe(false)
  })
})
