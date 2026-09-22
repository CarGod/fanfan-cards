import { describe, expect, it } from 'vitest'
import { chunkTexts, parseBatch, parseSingle } from './google.ts'

// 下面的 JSON 是 2026-09-22 用 curl 打 translate.googleapis.com 实际拿回来的形状，
// 删掉了和解析无关的调试字段。接口一变，先在这里对新形状。
const SINGLE_WORD = {
  sentences: [
    { trans: '迁移', orig: 'migration', backend: 3 },
    { translit: 'Qiānyí', src_translit: 'ˌmīˈɡrāSH(ə)n' },
  ],
  dict: [
    {
      pos: 'noun',
      terms: ['洄游', '徒动'],
      entry: [{ word: '洄游', reverse_translation: ['migration', 'relocation'], score: 0.0019 }],
      base_form: 'migration',
    },
  ],
  src: 'en',
  definitions: [
    {
      pos: 'noun',
      entry: [
        { gloss: 'seasonal movement of animals from one region to another.', example: 'x' },
        { gloss: 'movement from one part of something to another.' },
      ],
    },
  ],
  examples: {
    example: [
      { text: 'there is virtually no cell <b>migration</b> in plants' },
      { text: "this butterfly's annual <b>migration</b> across North America" },
    ],
  },
}

describe('parseSingle', () => {
  it('reads translation, dictionary groups, definitions and examples', () => {
    const parsed = parseSingle(SINGLE_WORD)
    expect(parsed.translation).toBe('迁移')
    expect(parsed.dict[0]).toEqual({
      partOfSpeech: 'noun',
      terms: ['洄游', '徒动'],
      reverse: ['migration', 'relocation'],
    })
    expect(parsed.definitions[0]?.gloss).toMatch(/seasonal movement/)
    // <b> 标签去掉，例句是干净的句子。
    expect(parsed.examples[0]).toBe('there is virtually no cell migration in plants')
    expect(parsed.source).toBe('en')
  })

  it('joins multi-sentence translations and tolerates missing sections', () => {
    const parsed = parseSingle({
      sentences: [{ trans: '第一句。', orig: 'One.' }, { trans: '第二句。', orig: 'Two.' }],
      src: 'en',
    })
    expect(parsed.translation).toBe('第一句。第二句。')
    expect(parsed.dict).toEqual([])
    expect(parsed.examples).toEqual([])
  })

  it('never throws on garbage', () => {
    expect(parseSingle(null).translation).toBe('')
    expect(parseSingle('nope').translation).toBe('')
  })
})

describe('parseBatch', () => {
  it('accepts the [text, lang] shape that sl=auto returns', () => {
    expect(parseBatch([['你好世界', 'en'], ['今天发货。', 'en']], 2)).toEqual(['你好世界', '今天发货。'])
  })

  it('accepts bare strings', () => {
    expect(parseBatch(['a', 'b'], 2)).toEqual(['a', 'b'])
  })

  it('rejects a count mismatch so the caller can retry one by one', () => {
    expect(parseBatch([['only one', 'en']], 2)).toBeNull()
    expect(parseBatch({ not: 'an array' }, 1)).toBeNull()
  })
})

describe('chunkTexts', () => {
  it('splits by item count', () => {
    const chunks = chunkTexts(Array.from({ length: 25 }, (_, i) => `t${i}`))
    expect(chunks.map((c) => c.length)).toEqual([12, 12, 1])
  })

  it('splits by encoded length so the GET URL stays short', () => {
    const long = '中'.repeat(700) // 每个汉字编码后 9 个字符
    const chunks = chunkTexts([long, long, long])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toHaveLength(3)
  })
})
