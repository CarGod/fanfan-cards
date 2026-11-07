import type { ThinkingLevel } from '@/types/ai.ts'

/**
 * Official OpenAI Chat Completions capabilities, not gateway capabilities.
 * Keep this list explicit: a model name that merely starts with `gpt-6` does
 * not establish that its chat/codex/pro variant accepts the same parameters.
 * Dated snapshots inherit the documented base model's capabilities.
 *
 * Sources: https://developers.openai.com/api/docs/guides/latest-model
 * and the model pages for gpt-5, gpt-5.1 and gpt-5.2.
 */
const MINIMUM_REASONING = {
  'gpt-6-luna': 'none',
  'gpt-6-sol': 'none',
  'gpt-6.1-terra': 'none',
  'gpt-6-astra': 'low',
  'gpt-6.1-sol': 'low',
  'gpt-5': 'minimal',
  'gpt-5-mini': 'minimal',
  'gpt-5-nano': 'minimal',
  'gpt-5.1': 'none',
  'gpt-5.2': 'none',
  'gpt-5.6-sol': 'none',
  o3: 'low',
  'o4-mini': 'low',
} as const

export function applyOpenAIParameters(
  body: Record<string, unknown>,
  level: ThinkingLevel | undefined,
): void {
  const model = String(body['model'] ?? '').replace(/-\d{4}-\d{2}-\d{2}$/, '')

  // These non-reasoning families retain their existing sampling/token settings,
  // but must not receive reasoning_effort just because the provider is OpenAI.
  if (/^gpt-(?:3\.5|4o?)(?:[.-]|$)/.test(model)) return

  if ('max_tokens' in body) {
    body['max_completion_tokens'] = body['max_tokens']
    delete body['max_tokens']
  }

  // Reasoning models reject non-default sampling parameters unless the model
  // explicitly supports disabling reasoning AND this request does so. Omitted
  // effort is not the same as none (Luna defaults to medium).
  delete body['temperature']
  const minimum = Object.hasOwn(MINIMUM_REASONING, model)
    ? MINIMUM_REASONING[model as keyof typeof MINIMUM_REASONING]
    : undefined
  if (!minimum || !level) return

  const effort = level === 'off' ? minimum : level
  body['reasoning_effort'] = effort
  if (effort === 'none') body['temperature'] = 0.2
}
