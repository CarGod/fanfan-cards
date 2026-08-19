import { describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider } from './openaiCompatible.ts'
import { GeminiProvider } from './gemini.ts'
import { ClaudeProvider } from './claude.ts'
import type { AIProvider } from '@/types/ai.ts'

/**
 * Opt-in probe against a real endpoint.
 *
 * Skipped unless `ARA_PROBE_KEY` is set, so it never runs in `npm run verify`.
 * It drives the *real* provider classes with the *real* prompts and schema —
 * the same code path the extension uses — which is what makes it useful when a
 * lookup fails only against one provider and only in the browser.
 *
 *   ARA_PROBE_KEY=sk-xxx \
 *   ARA_PROBE_PROVIDER=deepseek \
 *   ARA_PROBE_MODEL=deepseek-v4-flash \
 *   npx vitest run live.probe
 *
 * ARA_PROBE_PROVIDER: deepseek (default) | openai | gemini | claude | custom
 * ARA_PROBE_BASE_URL: required for `custom`, optional override otherwise.
 */

const key = process.env['ARA_PROBE_KEY'] ?? ''
const providerId = process.env['ARA_PROBE_PROVIDER'] ?? 'deepseek'
const model = process.env['ARA_PROBE_MODEL'] ?? ''
const baseUrl = process.env['ARA_PROBE_BASE_URL'] ?? ''

const DEFAULTS: Record<string, { model: string; baseUrl: string }> = {
  deepseek: { model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1' },
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  gemini: { model: 'gemini-2.0-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  claude: { model: 'claude-opus-5', baseUrl: '' },
  custom: { model: '', baseUrl: '' },
}

function build(): AIProvider {
  const defaults = DEFAULTS[providerId] ?? DEFAULTS['deepseek']!
  const resolvedModel = model || defaults.model
  const resolvedBase = baseUrl || defaults.baseUrl

  if (providerId === 'claude') {
    return new ClaudeProvider({ apiKey: key, model: resolvedModel })
  }
  if (providerId === 'gemini') {
    return new GeminiProvider({ apiKey: key, model: resolvedModel, baseUrl: resolvedBase })
  }
  return new OpenAICompatibleProvider({
    id: providerId === 'openai' ? 'openai' : providerId === 'custom' ? 'custom' : 'deepseek',
    label: providerId,
    apiKey: key,
    model: resolvedModel,
    baseUrl: resolvedBase,
    structuredOutput: providerId === 'openai' ? 'json_schema' : 'json_object',
  })
}

describe.skipIf(!key)('live provider probe', () => {
  it(
    'explains a word in context',
    async () => {
      const provider = build()
      console.log(`\nprobing ${provider.id} / ${provider.model}\n`)

      const result = await provider.explainWord({
        text: 'misleading',
        context: 'IVF staff accused of misleading UK parents about sperm and egg donors.',
        pageTitle: 'BBC News',
        pageUrl: 'https://bbc.com/news',
        languages: { source: 'auto', target: 'zh-CN' },
      })

      console.log(JSON.stringify(result, null, 2))

      // The exact failure the browser hit: a card with a word and an empty body.
      expect(result.meaning, 'meaning must not be empty').not.toBe('')
      expect(result.contextMeaning, 'contextMeaning must not be empty').not.toBe('')
      expect(result.examples.length, 'examples must not be empty').toBeGreaterThan(0)
    },
    60_000,
  )
})
