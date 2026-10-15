import { AIError, type ProviderId } from '@/types/ai.ts'

/** Aggregate a completed SSE response; never accept a truncated JSON answer. */
export function parseOpenAIStream(raw: string, providerId: ProviderId) {
  let content = '', reasoning = '', finish: string | undefined, done = false
  for (const event of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) continue // comments / keepalives
    if (data === '[DONE]') { done = true; break }
    let frame
    try { frame = JSON.parse(data) } catch { throw new AIError('bad_response', 'Invalid model stream', providerId) }
    if (frame.error) {
      throw new AIError(frame.error.code === 'service_unavailable_error' ? 'service_unavailable' : 'bad_response', String(frame.error.message ?? 'Model stream error'), providerId)
    }
    const choice = frame.choices?.find((item: { index: number }) => item.index === 0)
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content
    if (typeof choice?.delta?.reasoning_content === 'string') reasoning += choice.delta.reasoning_content
    if (choice?.finish_reason) finish = choice.finish_reason
  }
  if (!done || !finish) throw new AIError('network', 'Model stream ended before completion', providerId)
  return { choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: finish }] }
}
