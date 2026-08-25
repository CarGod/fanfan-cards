import { AIError, type ProviderId } from '@/types/ai.ts'

/**
 * Even with structured-output modes enabled, models occasionally wrap JSON in a
 * code fence, prepend "Here is the JSON:", or emit a trailing comma. A failed
 * lookup is a worse outcome than a lenient parser, so we repair aggressively
 * before giving up.
 */
export function extractJson(raw: string, providerId: ProviderId): unknown {
  const text = raw.trim()
  if (!text) throw new AIError('bad_response', 'Model returned an empty response', providerId)

  const candidates = [text, stripFence(text), sliceBalanced(text)].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )

  for (const candidate of candidates) {
    const parsed = tryParse(candidate) ?? tryParse(repairTrailingCommas(candidate))
    if (parsed !== undefined) return parsed
  }

  throw new AIError(
    'bad_response',
    `Could not parse JSON from model output: ${text.slice(0, 200)}`,
    providerId,
  )
}

function tryParse(value: string): unknown | undefined {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function stripFence(text: string): string | null {
  const match = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text)
  return match?.[1]?.trim() ?? null
}

/** Grab the first balanced `{...}` block, ignoring braces inside strings. */
function sliceBalanced(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function repairTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1')
}
