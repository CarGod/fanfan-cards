import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import { createMemoryAdapter, setStorageAdapter, type StorageAdapter } from './area.ts'
import { getSettings, saveSettings } from './repositories/settingsRepo.ts'

let adapter: StorageAdapter
beforeEach(() => {
  adapter = createMemoryAdapter()
  setStorageAdapter(adapter)
})
afterEach(() => setStorageAdapter(null))

const configured = {
  ...DEFAULT_SETTINGS,
  provider: 'deepseek',
  providers: { ...DEFAULT_SETTINGS.providers, deepseek: { apiKey: 'sk-deepseek', model: 'deepseek-flash', baseUrl: '' } },
  sync: { ...DEFAULT_SETTINGS.sync, enabled: true, token: 'ghp-token', owner: 'reader', repo: 'words' },
}

describe('settings survive values this build cannot read', () => {
  it('an unreadable field costs only itself, not the API keys and GitHub connection', async () => {
    await adapter.set(STORAGE_KEYS.settings, {
      ...configured,
      exampleCount: 99,
      providers: { ...configured.providers, claude: { apiKey: 'sk-claude', model: 7, baseUrl: '' } },
    })

    const settings = await getSettings()
    expect(settings.provider).toBe('deepseek')
    expect(settings.providers.deepseek.apiKey).toBe('sk-deepseek')
    expect(settings.providers.claude).toEqual({ apiKey: 'sk-claude', model: '', baseUrl: '' })
    expect(settings.sync).toMatchObject({ enabled: true, token: 'ghp-token', owner: 'reader', repo: 'words' })
    expect(settings.exampleCount).toBe(DEFAULT_SETTINGS.exampleCount)

    await saveSettings({ theme: 'dark' })
    const saved = await getSettings()
    expect(saved.theme).toBe('dark')
    expect(saved.providers.deepseek.apiKey).toBe('sk-deepseek')
    expect(saved.sync.token).toBe('ghp-token')
  })

  it('a save keeps what it could not read, so values from a newer build come back intact', async () => {
    await adapter.set(STORAGE_KEYS.settings, {
      ...configured,
      provider: 'qwen',
      providers: { ...configured.providers, qwen: { apiKey: 'sk-qwen', model: '', baseUrl: '' } },
      futureOption: true,
    })

    expect((await getSettings()).provider).toBe(DEFAULT_SETTINGS.provider)
    await saveSettings({ autoSpeak: true })

    const stored = await adapter.get<Record<string, unknown>>(STORAGE_KEYS.settings)
    expect(stored).toMatchObject({
      provider: 'qwen',
      autoSpeak: true,
      futureOption: true,
      providers: { qwen: { apiKey: 'sk-qwen' }, deepseek: { apiKey: 'sk-deepseek' } },
      sync: { token: 'ghp-token' },
    })
  })

  it('a first save still stores every field, so later default changes do not move it', async () => {
    await saveSettings({ theme: 'dark' })
    expect(await adapter.get(STORAGE_KEYS.settings)).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('an explicit edit still replaces what was stored', async () => {
    await adapter.set(STORAGE_KEYS.settings, { ...configured, provider: 'qwen' })
    await saveSettings({ provider: 'openai' })
    expect((await adapter.get<Record<string, unknown>>(STORAGE_KEYS.settings))?.['provider']).toBe('openai')
    expect((await getSettings()).provider).toBe('openai')
  })
})
