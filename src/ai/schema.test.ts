import { describe, expect, it, vi } from 'vitest'
import { AIError } from '@/types/ai.ts'
import { coerceExplanation, coerceSynonyms } from './schema.ts'

const GOOD = {
  word: 'accused',
  lemma: 'accuse',
  kind: 'word',
  phonetic: "ə'kjuːz",
  partOfSpeech: 'verb',
  cefr: 'B2',
  meaning: '指控，控告',
  senses: [],
  contextMeaning: '此处为被动结构，表示“被指控”。',
  englishDefinition: 'to say that someone has done something wrong',
  sentenceTranslation: '试管婴儿机构的工作人员被指误导英国父母。',
  examples: [
    { sentence: 'He was accused of leaking the report.', translation: '他被指控泄露了那份报告。' },
  ],
  synonyms: [{ word: 'charge', meaning: '正式提出指控，法律色彩更强' }],
}

describe('coerceExplanation', () => {
  it('passes a well-formed response straight through', () => {
    const result = coerceExplanation(GOOD, 'accused')
    expect(result.meaning).toBe('指控，控告')
    expect(result.sentenceTranslation).toContain('试管婴儿')
    expect(result.synonyms).toEqual([{ word: 'charge', meaning: '正式提出指控，法律色彩更强' }])
  })

  /**
   * The regression this rewrite exists for. One malformed field used to fail the
   * whole `safeParse`, empty every field, and surface as "shape mismatch" — even
   * though the explanation itself was perfectly good.
   */
  it('keeps a good explanation when one field has the wrong shape', () => {
    for (const broken of [
      { ...GOOD, synonyms: { charge: '正式指控' } },
      { ...GOOD, synonyms: 'charge, blame' },
      { ...GOOD, synonyms: 42 },
      { ...GOOD, phonetic: null },
      { ...GOOD, kind: 12345 },
      { ...GOOD, examples: 'not a list' },
    ]) {
      const result = coerceExplanation(broken, 'accused')
      expect(result.meaning, JSON.stringify(broken.synonyms)).toBe('指控，控告')
      expect(result.contextMeaning).not.toBe('')
    }
  })

  it('normalises the phonetic into slashes, and never invents one', () => {
    expect(coerceExplanation(GOOD, 'accused').phonetic).toBe("/ə'kjuːz/")
    expect(coerceExplanation({ ...GOOD, phonetic: '' }, 'accused').phonetic).toBe('')
    expect(coerceExplanation({ ...GOOD, phonetic: '[əˈkjuːz]' }, 'accused').phonetic).toBe('/əˈkjuːz/')
  })

  it('falls back to the selected text when the model echoes nothing', () => {
    expect(coerceExplanation({ ...GOOD, word: '' }, 'accused').word).toBe('accused')
  })

  it('marks a multi-word selection as a phrase even if the model says otherwise', () => {
    expect(coerceExplanation({ ...GOOD, word: 'roll back', kind: 'word' }, 'roll back').kind).toBe(
      'phrase',
    )
  })

  // Only a genuinely empty answer is a failure — that is the case the user
  // cannot act on, and it deserves the raw response for diagnosis.
  it('fails only when nothing usable came back', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => coerceExplanation({ 单词: 'accused' }, 'accused')).toThrow(AIError)
    expect(() => coerceExplanation(null, 'accused')).toThrow(AIError)
    // One surviving field is enough to be worth showing.
    expect(coerceExplanation({ contextMeaning: '此处指…' }, 'accused').contextMeaning).toBe('此处指…')
  })
})

describe('coerceSynonyms', () => {
  it('accepts every shape models actually send', () => {
    expect(coerceSynonyms([{ word: 'charge', meaning: '指控' }])).toEqual([
      { word: 'charge', meaning: '指控' },
    ])
    expect(coerceSynonyms(['charge', 'blame'])).toEqual([
      { word: 'charge', meaning: '' },
      { word: 'blame', meaning: '' },
    ])
    expect(coerceSynonyms('charge, blame，责怪')).toEqual([
      { word: 'charge', meaning: '' },
      { word: 'blame', meaning: '' },
      { word: '责怪', meaning: '' },
    ])
    expect(coerceSynonyms({ charge: '正式指控' })).toEqual([{ word: 'charge', meaning: '正式指控' }])
  })

  it('drops junk instead of throwing', () => {
    expect(coerceSynonyms(null)).toEqual([])
    expect(coerceSynonyms(42)).toEqual([])
    expect(coerceSynonyms([null, '', { meaning: 'no word' }, 'ok'])).toEqual([
      { word: 'ok', meaning: '' },
    ])
  })

  it('caps the list so one runaway response cannot flood the card', () => {
    expect(coerceSynonyms(Array.from({ length: 20 }, (_, i) => `w${i}`))).toHaveLength(6)
  })
})
