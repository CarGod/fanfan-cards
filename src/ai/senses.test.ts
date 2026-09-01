import { beforeEach, describe, expect, it } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { coerceExplanation, joinSenses } from './schema.ts'

/**
 * 按词性拆开的释义。
 *
 * 存成结构化的，不是存一串「形容词：独有的；名词：独家新闻」。字符串好看，
 * 但一旦想「只复习它作动词时的用法」「按词性给词库分组」，就得回头解析那个分号——
 * 而解析自己拼出来的字符串，是把已经有的结构又丢掉一次。
 */

const raw = (over: Record<string, unknown> = {}) => ({
  word: 'exclusive',
  lemma: 'exclusive',
  kind: 'word',
  phonetic: '/ɪkˈskluːsɪv/',
  partOfSpeech: 'noun',
  cefr: 'B2',
  meaning: '独家的',
  contextMeaning: '这里指独家消息',
  englishDefinition: 'not shared',
  ...over,
})

const parse = (over: Record<string, unknown> = {}) =>
  coerceExplanation(raw(over), 'exclusive', 'mock', 'core')

beforeEach(() => setLanguage('zh-CN'))

describe('模型返回的 senses', () => {
  it('按词性存成结构化的，不把词性烤进文本里', () => {
    const out = parse({
      senses: [
        { partOfSpeech: 'adjective', meaning: '独有的，排外的' },
        { partOfSpeech: 'noun', meaning: '独家新闻' },
      ],
    })
    expect(out.senses).toEqual([
      { partOfSpeech: 'adjective', meaning: '独有的，排外的' },
      { partOfSpeech: 'noun', meaning: '独家新闻' },
    ])
    // 存的是英文标签，不是「形容词」——筛选和分组才不受界面语言影响。
    expect(out.senses[0]!.partOfSpeech).toBe('adjective')
  })

  /**
   * 展示文本由 senses 推导，而不是用模型给的 meaning。
   *
   * 两个字段各自由模型填，就迟早会对不上：卡片上写「形容词：独有的」，
   * 而按词性筛选时那条词卡却归在名词下。让一个从另一个推出来，矛盾就无处存在。
   */
  it('那一行展示文本由 senses 拼出来，覆盖模型给的 meaning', () => {
    const out = parse({
      meaning: '模型顺手写的一行',
      senses: [
        { partOfSpeech: 'adjective', meaning: '独有的' },
        { partOfSpeech: 'noun', meaning: '独家新闻' },
      ],
    })
    expect(out.meaning).toBe('形容词：独有的；名词：独家新闻')
  })

  it('词性译名跟着界面语言走，存的那份不动', () => {
    const out = parse({ senses: [{ partOfSpeech: 'adjective', meaning: 'exclusive' }] })
    setLanguage('en')
    expect(joinSenses(out.senses)).toBe('adjective：exclusive')
    setLanguage('zh-CN')
    expect(joinSenses(out.senses)).toBe('形容词：exclusive')
    expect(out.senses[0]!.partOfSpeech).toBe('adjective')
  })

  it('表里没有的词性原样显示，而不是丢掉或硬归类', () => {
    const out = parse({ senses: [{ partOfSpeech: 'phrasal verb', meaning: '放弃' }] })
    expect(joinSenses(out.senses)).toBe('phrasal verb：放弃')
  })
})

describe('模型没按格式回话时', () => {
  it('完全没给 senses，就退回它给的 meaning', () => {
    const out = parse()
    expect(out.senses).toEqual([])
    expect(out.meaning).toBe('独家的')
  })

  it('给成字符串数组也收下', () => {
    const out = parse({ senses: ['独有的', '独家新闻'] })
    expect(out.senses).toEqual([
      { partOfSpeech: '', meaning: '独有的' },
      { partOfSpeech: '', meaning: '独家新闻' },
    ])
    expect(out.meaning).toBe('独有的；独家新闻')
  })

  it('给成别的形状就当没给，不让整次查询失败', () => {
    expect(parse({ senses: 'adjective: 独有的' }).senses).toEqual([])
    expect(parse({ senses: { a: 1 } }).senses).toEqual([])
    expect(parse({ senses: null }).senses).toEqual([])
  })

  it('空释义的条目丢掉——一个只有词性的行没有信息', () => {
    const out = parse({
      senses: [
        { partOfSpeech: 'noun', meaning: '' },
        { partOfSpeech: 'verb', meaning: '排除' },
      ],
    })
    expect(out.senses).toEqual([{ partOfSpeech: 'verb', meaning: '排除' }])
  })

  /** 模型偶尔会把每一个细微义项都拆一条，卡片会被撑爆。 */
  it('最多留三条', () => {
    const out = parse({
      senses: Array.from({ length: 6 }, (_, i) => ({ partOfSpeech: 'noun', meaning: `义项${i}` })),
    })
    expect(out.senses).toHaveLength(3)
  })
})
