import { describe, expect, it } from 'vitest'
import { parseOpenAIStream } from './stream.ts'
const frame = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\r\n\r\n`
describe('DeepSeek SSE transport', () => {
  it('joins content, skips keepalives and requires terminal completion', () => {
    const response = parseOpenAIStream(': keepalive\r\n\r\n' + frame('{"translation":') + frame('"你好"}', 'stop') + 'data: [DONE]\r\n\r\n', 'deepseek')
    expect(response.choices[0]?.message.content).toBe('{"translation":"你好"}')
  })
  it('rejects truncated streams even when the partial JSON is valid', () => {
    expect(() => parseOpenAIStream(frame('{}', 'stop'), 'deepseek')).toThrow('before completion')
  })
  it('preserves token-budget finish reasons', () => {
    expect(parseOpenAIStream(frame('', 'length') + 'data: [DONE]\n\n', 'deepseek').choices[0]?.finish_reason).toBe('length')
  })
  it('classifies an in-stream overload as service unavailable', () => {
    expect(() => parseOpenAIStream('data: {"error":{"code":"service_unavailable_error","message":"busy"}}\n\n', 'deepseek')).toThrow(expect.objectContaining({ code: 'service_unavailable' }))
  })
})
