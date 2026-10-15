import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from './providers/openaiCompatible.ts'
import { transcriptSchema } from './transcript.ts'
import { postJson } from './http.ts'
vi.mock('./http.ts', () => ({ postJson: vi.fn() }))
describe('transcript correction', () => {
  it('returns corrected original and translation together using the configured endpoint', async () => {
    vi.mocked(postJson).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ original: 'The Earth orbits the Sun.', translation: '地球绕太阳运行。' }) } }] })
    const provider = new OpenAICompatibleProvider({ id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'test', model: 'configured-model', structuredOutput: 'json_object', reasoning: 'deepseek', thinkingLevel: 'off' })
    const abort = new AbortController()
    expect(await provider.refineTranscript({ text: 'The earth or bits the son.', context: 'The solar system.', title: 'Space', targetLanguage: '简体中文' }, abort.signal)).toEqual({ original: 'The Earth orbits the Sun.', translation: '地球绕太阳运行。' })
    expect(postJson).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.deepseek.com/chat/completions', signal: abort.signal, body: expect.objectContaining({ model: 'configured-model', thinking: { type: 'disabled' } }) }))
    const call = vi.mocked(postJson).mock.calls[0]![0]
    expect(JSON.stringify(call.body)).toContain('The solar system.')
    expect(call.body).not.toHaveProperty('audio')
    expect(JSON.stringify(call.body)).not.toContain('input_audio')
  })
  it('rejects missing and empty bilingual output', () => {
    expect(transcriptSchema.safeParse({ original: '', translation: '猜测' }).success).toBe(false)
    expect(transcriptSchema.safeParse({ translation: '只有译文' }).success).toBe(false)
  })
})
