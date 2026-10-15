import { describe, expect, it } from 'vitest'
import { removeSourceEcho } from './translationOutput.ts'

const source = 'these LLMs, the way they’re designed, I much rather have a four like a Opus 4.5 quality model run'
const translated = '这些大语言模型，就它们的设计而言，我宁愿让一个类似 Opus 4.5 质量的模型运行在'
describe('source echoes in translation output', () => {
  it('removes only the exact long source prefix or suffix while retaining model names', () => {
    expect(removeSourceEcho(source, `${source} ${translated}`, 'zh-CN')).toBe(translated)
    expect(removeSourceEcho(source, `${translated}\n${source}`, 'zh-CN')).toBe(translated)
    expect(removeSourceEcho(source, `${source.replaceAll(' ', '\n')}\n${translated}`, 'zh-CN')).toBe(translated)
  })
  it('does not strip standalone model names, legitimate Latin fragments, or internal quotes', () => {
    expect(removeSourceEcho('Opus 4.5', 'Opus 4.5 模型质量很高', 'zh-CN')).toBe('Opus 4.5 模型质量很高')
    expect(removeSourceEcho(source, translated, 'zh-CN')).toBe(translated)
    const quoted = `他说「${source}」，意思是这些模型的运行方式。`
    expect(removeSourceEcho(source, quoted, 'zh-CN')).toBe(quoted)
    const unrelated = `The English sentence is different. ${translated}`
    expect(removeSourceEcho(source, unrelated, 'zh-CN')).toBe(unrelated)
  })
  it('leaves pure echoes for the existing retry validator and avoids guessing Latin targets', () => {
    expect(removeSourceEcho(source, source, 'zh-CN')).toBe(source)
    expect(removeSourceEcho(source, `${source} OK`, 'zh-CN')).toBe(`${source} OK`)
    expect(removeSourceEcho(source, `${source} Eine deutsche Übersetzung.`, 'de')).toBe(`${source} Eine deutsche Übersetzung.`)
  })
})
