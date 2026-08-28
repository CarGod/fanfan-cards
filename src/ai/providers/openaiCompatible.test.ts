import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError } from '@/types/ai.ts'
import { t } from '@/i18n/index.ts'
import { EXPLAIN_MAX_TOKENS, OpenAICompatibleProvider } from './openaiCompatible.ts'

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
  senses: [],
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
  //
  // 断言比的是 `t()` 的返回值，不是写死的中文片段——这些消息现在有中英两版，
  // 断死其中一版会在另一种界面语言下变成假失败。比 `t(键, 参数)` 同时锁住了
  // 「用的哪个键」和「填进去的诊断信息」，正是这条测试真正关心的东西。
  it('explains a length cutoff instead of reporting silence', async () => {
    stubChat({ content: '' }, { finish_reason: 'length' })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AIError)
    expect((error as AIError).code).toBe('bad_response')
    expect((error as AIError).message).toBe(
      t('error.provider.token_budget_spent', { limit: EXPLAIN_MAX_TOKENS, used: '?' }),
    )
  })

  it('recovers the answer when a gateway puts it in the reasoning channel', async () => {
    stubChat({ content: '', reasoning_content: `Let me think...\n${GOOD_JSON}` })
    const result = await provider('json_object').explainWord(INPUT)
    expect(result.meaning).toBe('误导性的')
  })

  it('reports the finish reason when there is nothing usable anywhere', async () => {
    stubChat({ content: '' }, { finish_reason: 'stop' })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect((error as AIError).message).toBe(
      t('error.provider.no_content', { reason: 'stop', note: '' }),
    )
  })

  // Valid JSON with the wrong keys used to render as a card with a word and an
  // empty body — indistinguishable from "the AI had nothing to say".
  it('treats a shape mismatch as a failure, with the raw response attached', async () => {
    const wrongShape = { 单词: 'misleading', 释义: '误导性的' }
    stubChat({ content: JSON.stringify(wrongShape) })
    const error = await provider('json_object').explainWord(INPUT).catch((e: unknown) => e)
    expect((error as AIError).code).toBe('bad_response')
    // 「原样附上模型返回了什么」是这条测试的重点，所以要连 body 占位符一起比。
    expect((error as AIError).message).toBe(
      t('error.schema.field_mismatch', { body: JSON.stringify(wrongShape) }),
    )
  })
})

describe('思考深度走到请求体里', () => {
  /**
   * 翻译函数写对了不等于它被调用了。这条走完整路径：设置 → provider → HTTP 请求体。
   * 中间任何一环没接上，表现都是「设置调了但没变快」，而那是查不出来的。
   */
  const sent = async (thinkingLevel?: 'off' | 'low' | 'high') => {
    const captured = stubChat({ content: GOOD_JSON })
    const deepseek = new OpenAICompatibleProvider({
      id: 'deepseek',
      label: 'test',
      apiKey: 'k',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.example.com/v1',
      structuredOutput: 'json_object',
      reasoning: 'deepseek',
    })
    await deepseek.explainWord({
      text: 'misleading',
      context: 'The chart is misleading.',
      ...(thinkingLevel ? { thinkingLevel } : {}),
    })
    return captured[0]!
  }

  it('低档时请求体里带着 reasoning_effort: low', async () => {
    expect((await sent('low'))['reasoning_effort']).toBe('low')
  })

  it('关闭时请求体里带着 thinking: disabled', async () => {
    expect((await sent('off'))['thinking']).toEqual({ type: 'disabled' })
  })

  /** 没设置时不发——让服务商用它自己的默认值，而不是我们替它决定。 */
  it('没设置时一个推理参数都不发', async () => {
    const body = await sent()
    expect(body['reasoning_effort']).toBeUndefined()
    expect(body['thinking']).toBeUndefined()
  })

  /** 自建端点对不认识的字段常常直接 400，一个字段都不能多发。 */
  it('自建端点上一个推理参数都不发', async () => {
    const captured = stubChat({ content: GOOD_JSON })
    const custom = new OpenAICompatibleProvider({
      id: 'custom',
      label: 'test',
      apiKey: 'k',
      model: 'local',
      baseUrl: 'http://localhost:1234/v1',
      structuredOutput: 'json_object',
      reasoning: 'none',
    })
    await custom.explainWord({
      text: 'misleading',
      context: 'The chart is misleading.',
      thinkingLevel: 'low',
    })
    expect(captured[0]!['reasoning_effort']).toBeUndefined()
    expect(captured[0]!['thinking']).toBeUndefined()
  })
})
