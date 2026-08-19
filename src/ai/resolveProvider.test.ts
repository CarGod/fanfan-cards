import { describe, expect, it } from 'vitest'
import { resolveProvider } from './index.ts'
import { DEFAULT_SETTINGS, providerMeta, type Settings } from '@/types/settings.ts'

function settingsFor(provider: Settings['provider'], patch: Partial<{ apiKey: string; model: string; baseUrl: string }> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    provider,
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...(provider === 'mock'
        ? {}
        : { [provider]: { apiKey: 'k', model: '', baseUrl: '', ...patch } }),
    } as Settings['providers'],
  }
}

describe('resolveProvider', () => {
  // "I left the model and API address blank, is that broken?" — no, and this
  // test is what guarantees it stays that way.
  it('falls back to the catalogue defaults when model and base URL are blank', () => {
    for (const id of ['deepseek', 'openai', 'gemini'] as const) {
      const { provider, downgradeReason } = resolveProvider(settingsFor(id))
      expect(downgradeReason, `${id} should not downgrade`).toBeUndefined()
      expect(provider.id).toBe(id)
      expect(provider.model).toBe(providerMeta(id).defaultModel)
    }
  })

  it('uses an explicit model when one is given', () => {
    const { provider } = resolveProvider(settingsFor('deepseek', { model: 'deepseek-v4-pro' }))
    expect(provider.model).toBe('deepseek-v4-pro')
  })

  // A missing key must never surface as a crash mid-reading.
  it('downgrades to the offline dictionary instead of throwing when the key is missing', () => {
    const { provider, downgradeReason } = resolveProvider(settingsFor('deepseek', { apiKey: '' }))
    expect(provider.id).toBe('mock')
    expect(downgradeReason).toContain('API Key')
  })

  it('never throws for a provider that needs a base URL it does not have', () => {
    const { provider, downgradeReason } = resolveProvider(settingsFor('custom'))
    expect(provider.id).toBe('mock')
    expect(downgradeReason).toBeTruthy()
  })
})
