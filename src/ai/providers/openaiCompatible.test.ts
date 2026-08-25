import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError } from '@/types/ai.ts'
import { OpenAICompatibleProvider } from './openaiCompatible.ts'

function provider(mode: 'json_schema' | 'json_object' | 'none') {
  return new OpenAICompatibleProvider({
    id: 'deepseek',
    label: 'test',
    apiKey: 'k',
    model: 'test-model',
    baseUrl: 'https://api.example.com/v1',
    structuredOutput: mode,
  })
}

const GOOD_JSON = JSON.stringify({
  word: 'misleading',
  lemma: 'mislead',
  kind: 'word',
  phonetic: '/mɪsˈliːdɪŋ/',
  partOfSpeech: 'adjective',
  cefr: 'B2',
  meaning: '误导性的',
  contextMeaning: '这里指让家长产生错误理解。',
  englishDefinition: 'giving a wrong impression',
  examples: [{ sentence: 'The chart is misleading.', translation: '这张图有误导性。' }],
  sentenceTranslation: '试管婴儿机构工作人员被指误导英国父母。',
  synonyms: [{ word: 'deceptive', meaning: '有意欺骗，比 misleading 主观恶意更强' }],
})

/** Captures the outgoing request so we can assert on the prompt we actually send. */
function stubChat(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const sent: Array<Record<string, unknown>> = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({ choices: [{ message, ...extra }] }), { status: 200 })
  })
  return sent
}

afterEach(() => vi.unstubAllGlobals())

const INPUT = { text: 'misleading', context: 'IVF staff accused of misleading UK parents.' }

describe('OpenAICompatibleProvider', () => {
  it('parses a well-formed response', async () => {
    stubChat({ content: GOOD_JSON })
    const result = await provider('json_object').explainWord(INPUT)
    expect(result.meaning).toBe('误导性的')
    expect(result.contextMeaning).toContain('家长')
  })

  // The blank-card regression: `json_object` guarantees valid JSON, not *our*
  // JSON. Without the field contract in the prompt the model invents key names,
  // everything parses, and the card renders empty.
  it('sends the field contract in the prompt when the endpoint cannot enforce a schema', async () => {
    const sent = stubChat({ content: GOOD_JSON })
    await provider('json_object').explainWord(INPUT)

    const messages = sent[0]?.['messages'] as Array<{ role: string; content: string }>
    const user = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(user).toContain('"contextMeaning"')
    expect(user).toContain('"examples"')
    expect(user).toContain('"sentenceTranslation"')
    expect(sent[0]?.['response_format']).toEqual({ type: 'json_object' })
  })

  it('relies on response_format instead when the endpoint does support a schema', async () => {
    const sent = stubChat({ content: GOOD_JSON })
    await provider('json_schema').explainWord(INPUT)

    const messages = sent[0]?.['messages'] as Array<{ role: string; content: string }>
    const user = messages.find((m) => m.role === 'user')?.content ?? ''
    expect(user).not.toContain('"contextMeaning"')
    expect(sent[0]?.['response_format']).toMatchObject({ type: 'json_schema' })
  })

  // A reasoning model burns its budget before writing any answer. "Model
  // returned no content" is true and useless; the cause has to be in the error.
  it('explains a length cutoff instead of reporting silence', async () => {
    stubChat({ content: '' }, { finish_reason: 'length' })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AIError)
    expect((error as AIError).code).toBe('bad_response')
    expect((error as AIError).message).toContain('finish_reason=length')
    expect((error as AIError).message).toContain('推理型模型')
  })

  it('recovers the answer when a gateway puts it in the reasoning channel', async () => {
    stubChat({ content: '', reasoning_content: `Let me think...\n${GOOD_JSON}` })
    const result = await provider('json_object').explainWord(INPUT)
    expect(result.meaning).toBe('误导性的')
  })

  it('reports the finish reason when there is nothing usable anywhere', async () => {
    stubChat({ content: '' }, { finish_reason: 'stop' })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect((error as AIError).message).toContain('finish_reason=stop')
  })

  // Valid JSON with the wrong keys used to render as a card with a word and an
  // empty body — indistinguishable from "the AI had nothing to say".
  it('treats a shape mismatch as a failure, with the raw response attached', async () => {
    stubChat({ content: JSON.stringify({ 单词: 'misleading', 释义: '误导性的' }) })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect((error as AIError).code).toBe('bad_response')
    expect((error as AIError).message).toContain('单词')
  })
})
