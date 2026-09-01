import { describe, expect, it } from 'vitest'
import { applyReasoning } from './providers/openaiCompatible.ts'

/**
 * 把「思考多深」翻译成各家认得的参数。
 *
 * 这一层错了**不会报错**：字段名写错、发给不认识它的端点、或者干脆没发——
 * 请求照常成功，只是慢照旧。没有异常、没有日志，唯一的症状是读者觉得
 * 「好像没变快」，而那是查不出来的。所以每一条都钉死。
 *
 * 事实来源是 DeepSeek 官方文档：`reasoning_effort` 取 low/high/max，
 * **默认 high**；`thinking: {type: enabled|disabled}` 是开关。
 */

const body = () => ({}) as Record<string, unknown>

describe('DeepSeek', () => {
  it('低档发 low，并明确打开思考', () => {
    const b = body()
    applyReasoning(b, 'deepseek', 'low')
    expect(b['reasoning_effort']).toBe('low')
    expect(b['thinking']).toEqual({ type: 'enabled' })
  })

  it('高档发 high', () => {
    const b = body()
    applyReasoning(b, 'deepseek', 'high')
    expect(b['reasoning_effort']).toBe('high')
  })

  /** DeepSeek 是少数真能关掉思考的，关了就别再发 effort。 */
  it('关闭时真的关掉，不再发 effort', () => {
    const b = body()
    applyReasoning(b, 'deepseek', 'off')
    expect(b['thinking']).toEqual({ type: 'disabled' })
    expect(b['reasoning_effort']).toBeUndefined()
  })
})

describe('OpenAI', () => {
  it('只发 reasoning_effort，没有独立开关', () => {
    const b = body()
    applyReasoning(b, 'openai', 'high')
    expect(b['reasoning_effort']).toBe('high')
    expect(b['thinking']).toBeUndefined()
  })

  /** OpenAI 没有「关」这一档，最低就是 low——退到最低，而不是假装关掉了。 */
  it('关闭退到最低档，而不是发一个不存在的值', () => {
    const b = body()
    applyReasoning(b, 'openai', 'off')
    expect(b['reasoning_effort']).toBe('low')
  })
})

describe('自建端点', () => {
  /**
   * 「OpenAI 兼容」是个很宽的说法：Ollama、LM Studio、各种网关都自称兼容，
   * 而它们对不认识的字段常常直接 400。为了一点加速把一个本来能用的配置弄坏，
   * 不划算。
   */
  it('什么都不发', () => {
    for (const level of ['off', 'low', 'high'] as const) {
      const b = body()
      applyReasoning(b, 'none', level)
      expect(Object.keys(b)).toEqual([])
    }
  })
})

describe('没有设置时', () => {
  it('不发任何推理参数，交给服务商自己的默认值', () => {
    const b = body()
    applyReasoning(b, 'deepseek', undefined)
    expect(Object.keys(b)).toEqual([])
  })
})

describe('不动请求体里已有的东西', () => {
  it('只加自己的字段', () => {
    const b = { model: 'deepseek-v4-flash', max_tokens: 4000 } as Record<string, unknown>
    applyReasoning(b, 'deepseek', 'low')
    expect(b['model']).toBe('deepseek-v4-flash')
    expect(b['max_tokens']).toBe(4000)
  })
})
