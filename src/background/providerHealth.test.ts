import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AIError, type AIProvider } from '@/types/ai.ts'
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings.ts'
import { createMemoryAdapter, setStorageAdapter, storage } from '@/storage/area.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { PROVIDER_HEALTH_KEY as KEY, type ProviderHealth } from '@/shared/providerHealth.ts'
import { currentHealth, resolveForTranslation, restoreProvider, useTemporaryProvider } from './providerHealth.ts'
import { resolveProvider } from '@/ai/index.ts'

vi.mock('@/ai/index.ts', () => ({ resolveProvider: vi.fn() }))
let settings: Settings
let translate: ReturnType<typeof vi.fn>
const busy = () => new AIError('service_unavailable', 'busy', 'deepseek', 503)
beforeEach(async () => {
  setStorageAdapter(createMemoryAdapter())
  settings = { ...DEFAULT_SETTINGS, provider: 'deepseek', providers: { ...DEFAULT_SETTINGS.providers, deepseek: { apiKey: 'private-test-key', model: 'deepseek-flash', baseUrl: '' } } }
  await storage().set(STORAGE_KEYS.settings, settings)
  translate = vi.fn().mockRejectedValue(busy())
  vi.mocked(resolveProvider).mockImplementation(s => ({ provider: {
    id: s.provider, model: s.provider === 'deepseek' ? 'deepseek-flash' : 'Google',
    translate: s.provider === 'deepseek' ? translate : vi.fn().mockResolvedValue({ translation: '你好' }),
  } as unknown as AIProvider }))
})
async function failed() {
  const { provider } = await resolveForTranslation(settings)
  await expect(provider.translate({ text: 'test', targetLanguage: 'Chinese' })).rejects.toMatchObject({ code: 'service_unavailable' })
  return (await currentHealth())!
}
async function settledProbe() {
  await vi.waitFor(async () => expect((await currentHealth())?.checkingUntil).toBe(0))
}
describe('temporary provider and recovery', () => {
  it('records failure without keys or source text, preserving original settings', async () => {
    const state = await failed()
    expect(state.original).toBe('deepseek')
    expect(JSON.stringify(state)).not.toContain('private-test-key')
    expect(JSON.stringify(state)).not.toContain('"test"')
    expect(await storage().get(STORAGE_KEYS.settings)).toEqual(settings)
  })
  it('uses Google immediately and deduplicates concurrent recovery checks', async () => {
    const state = await failed()
    await useTemporaryProvider(state.id, 'google')
    let finish!: (value: { translation: string }) => void
    translate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const providers = await Promise.all([resolveForTranslation(settings), resolveForTranslation(settings), resolveForTranslation(settings)])
    expect(providers.every(item => item.provider.id === 'google')).toBe(true)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
    expect(await providers[0]!.provider.translate({ text: 'test', targetLanguage: 'Chinese' })).toEqual({ translation: '你好' })
    finish({ translation: '你好' })
    await vi.waitFor(async () => expect((await currentHealth())?.recovered).toBe(true))
    expect((await currentHealth())?.fallback).toBe('google')
    await restoreProvider(state.id)
    expect(await currentHealth()).toBeNull()
    expect((await resolveForTranslation(settings)).provider.id).toBe('deepseek')
  })
  it('keeps fallback on failed checks and checks again on the next translation', async () => {
    const state = await failed()
    await useTemporaryProvider(state.id, 'google')
    await resolveForTranslation(settings)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
    await settledProbe()
    expect((await currentHealth())?.recovered).toBe(false)
    await expect(restoreProvider(state.id)).rejects.toThrow()
    await resolveForTranslation(settings)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3))
    await settledProbe()
  })
  it('invalidates outage state when the preferred model or key changes', async () => {
    const state = await failed()
    await storage().set(STORAGE_KEYS.settings, { ...settings, providers: { ...settings.providers, deepseek: { ...settings.providers.deepseek, model: 'another-model' } } })
    await expect(useTemporaryProvider(state.id, 'google')).rejects.toThrow()
    expect(await currentHealth()).toBeNull()
  })
  it('does not mark user cancellation as an outage', async () => {
    translate.mockRejectedValue(new AIError('aborted', 'cancelled', 'deepseek'))
    await (await resolveForTranslation(settings)).provider.translate({ text: 'test', targetLanguage: 'Chinese' }).catch(() => undefined)
    expect(await currentHealth()).toBeNull()
  })
  it('does not trust authentication or model list success as recovery', async () => {
    const state = await failed()
    await useTemporaryProvider(state.id, 'google')
    translate.mockResolvedValue({ translation: 'Hello' })
    await resolveForTranslation(settings)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
    await settledProbe()
    expect((await currentHealth())?.recovered).toBe(false)
  })
  it('respects an unexpired persisted probe lease after worker restart', async () => {
    const state = await failed()
    await useTemporaryProvider(state.id, 'google')
    await storage().set(KEY, { ...(await currentHealth()), checkingUntil: Date.now() + 20_000 })
    expect((await resolveForTranslation(settings)).provider.id).toBe('google')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(translate).toHaveBeenCalledTimes(1)
  })
  it('ignores probe completion after a configuration change', async () => {
    const state = await failed()
    await useTemporaryProvider(state.id, 'google')
    let finish!: (value: { translation: string }) => void
    translate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await resolveForTranslation(settings)
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2))
    await storage().set(STORAGE_KEYS.settings, { ...settings, providers: { ...settings.providers, deepseek: { ...settings.providers.deepseek, model: 'another-model' } } })
    expect(await currentHealth()).toBeNull()
    finish({ translation: '你好' })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await storage().get<ProviderHealth>(KEY)).toBeUndefined()
  })
})


it('forgets the old outage after a permanent provider selection and stops probing', async () => {
  await failed()
  const alternative = { ...settings, provider: 'mimo' as const }
  await storage().set(STORAGE_KEYS.settings, alternative)
  expect(await currentHealth()).toBeNull()
  expect((await resolveForTranslation(alternative)).provider.id).toBe('mimo')
  expect(translate).toHaveBeenCalledTimes(1)
})

it('does not repeat recovery probes after recovery is confirmed', async () => {
  const state = await failed()
  await useTemporaryProvider(state.id, 'google')
  translate.mockResolvedValue({ translation: '你好' })
  await resolveForTranslation(settings)
  await vi.waitFor(async () => expect((await currentHealth())?.recovered).toBe(true))
  await resolveForTranslation(settings)
  expect(translate).toHaveBeenCalledTimes(2)
})
it('explicitly selecting even the preferred provider cancels temporary use', async () => {
  const { saveSettings } = await import('@/storage/repositories/settingsRepo.ts')
  const state = await failed()
  await useTemporaryProvider(state.id, 'google')
  await saveSettings({ provider: 'deepseek' })
  expect(await currentHealth()).toBeNull()
  expect((await resolveForTranslation(settings)).provider.id).toBe('deepseek')
})
