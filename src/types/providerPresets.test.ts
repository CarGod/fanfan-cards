import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS, providerMeta, providerSelectionPatch, settingsSchema } from './settings.ts'

it('adds MiMo to older settings without losing existing keys or preferences', () => {
  const { mimo: _mimo, ...old } = DEFAULT_SETTINGS.providers
  const settings = settingsSchema.parse({ provider: 'deepseek', uiLanguage: 'en', providers: { ...old, deepseek: { apiKey: 'keep-me' } } })
  expect(settings.providers.deepseek.apiKey).toBe('keep-me')
  expect(settings.uiLanguage).toBe('en')
  expect(settings.provider).toBe('deepseek')
  expect(settings.providers.mimo).toEqual({ apiKey: '', model: '', baseUrl: '' })
})
it('provides official Flash/Pro presets and ready-to-use MiMo defaults', () => {
  expect(providerMeta('deepseek').modelSuggestions).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
  expect(providerMeta('deepseek').defaultModel).toBe('deepseek-flash')
  expect(providerMeta('mimo')).toMatchObject({ defaultModel: 'mimo-v2.6-flash', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', modelSuggestions: ['mimo-v2.6-flash', 'mimo-v2.6-pro'] })
})
it('reuses official MiMo settings on explicit selection without erasing OpenAI', () => {
  const openai = { apiKey: 'existing-key', model: 'mimo-v2.6-pro', baseUrl: 'https://api.xiaomimimo.com/v1' }
  const settings = { ...DEFAULT_SETTINGS, providers: { ...DEFAULT_SETTINGS.providers, openai } }
  const patch = providerSelectionPatch(settings, 'mimo')
  expect(patch.providers?.mimo).toEqual(openai)
  expect(patch.providers?.openai).toEqual(openai)
  expect(providerSelectionPatch({ ...settings, providers: { ...settings.providers, mimo: { ...openai, apiKey: 'own-key' } } }, 'mimo')).toEqual({ provider: 'mimo' })
  expect(providerSelectionPatch({ ...settings, providers: { ...settings.providers, openai: { ...openai, baseUrl: 'https://api.xiaomimimo.com.evil.test/v1' } } }, 'mimo')).toEqual({ provider: 'mimo' })
})
