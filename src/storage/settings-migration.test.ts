import { afterEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import { createMemoryAdapter, setStorageAdapter } from './area.ts'
import { initStorage } from './migrations.ts'
import { getSettings, saveSettings } from './repositories/settingsRepo.ts'

afterEach(() => setStorageAdapter(null))

describe('settings migrations', () => {
  it('defaults legacy video settings to en → zh-CN without changing page preferences', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.settings, { sourceLanguage: 'auto', targetLanguage: 'ja' })
    const settings = await getSettings()
    expect(settings.videoSubtitleSourceLanguage).toBe('en')
    expect(settings.videoSubtitleTargetLanguage).toBe('zh-CN')
    expect(settings.targetLanguage).toBe('ja')
    await saveSettings({ videoSubtitleSourceLanguage: 'fr', videoSubtitleTargetLanguage: 'en' })
    const updated = await getSettings()
    expect(updated.videoSubtitleSourceLanguage).toBe('fr')
    expect(updated.videoSubtitleTargetLanguage).toBe('en')
    expect(updated.targetLanguage).toBe('ja')
  })

  it('defaults new and schema-filled settings to English', async () => {
    setStorageAdapter(createMemoryAdapter())
    expect(DEFAULT_SETTINGS.inputTranslationTargetLanguage).toBe('en')
    expect(DEFAULT_SETTINGS.fanfanPalette).toBe('warmField')
    expect((await getSettings()).inputTranslationTargetLanguage).toBe('en')
    expect((await getSettings()).fanfanPalette).toBe('warmField')
  })

  it('persists English when a v6 installation has no input target field', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.meta, {
      schemaVersion: 6,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await adapter.set(STORAGE_KEYS.settings, { targetLanguage: 'ja' })

    const meta = await initStorage()
    const stored = await adapter.get<Record<string, unknown>>(STORAGE_KEYS.settings)

    expect(meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect(stored?.['inputTranslationTargetLanguage']).toBe('en')
    expect((await getSettings()).inputTranslationTargetLanguage).toBe('en')
  })

  it('preserves an explicitly selected follow value during migration', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.meta, {
      schemaVersion: 6,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await adapter.set(STORAGE_KEYS.settings, {
      targetLanguage: 'ja',
      inputTranslationTargetLanguage: 'follow',
    })

    await initStorage()
    expect((await getSettings()).inputTranslationTargetLanguage).toBe('follow')
  })

  it('persists 暖日麦田 when a v7 installation has no FanFan theme', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.meta, {
      schemaVersion: 7,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await adapter.set(STORAGE_KEYS.settings, { fanfanMode: true })

    await initStorage()
    const stored = await adapter.get<Record<string, unknown>>(STORAGE_KEYS.settings)

    expect(stored?.['fanfanPalette']).toBe('warmField')
    expect((await getSettings()).fanfanPalette).toBe('warmField')
  })

  it('preserves a valid theme and repairs an unknown theme without losing other settings', async () => {
    const valid = createMemoryAdapter()
    setStorageAdapter(valid)
    await valid.set(STORAGE_KEYS.meta, {
      schemaVersion: 7,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await valid.set(STORAGE_KEYS.settings, { fanfanPalette: 'glacierBay' })
    await initStorage()
    expect((await getSettings()).fanfanPalette).toBe('glacierBay')

    const invalid = createMemoryAdapter()
    setStorageAdapter(invalid)
    await invalid.set(STORAGE_KEYS.meta, {
      schemaVersion: 7,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await invalid.set(STORAGE_KEYS.settings, {
      fanfanPalette: 'old-brand-palette',
      fanfanMode: true,
    })
    await initStorage()
    const repaired = await getSettings()
    expect(repaired.fanfanPalette).toBe('warmField')
    expect(repaired.fanfanMode).toBe(true)
  })

  it('persists a selected theme through the settings repository', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)

    await saveSettings({ fanfanPalette: 'cherryCloud' })

    expect((await getSettings()).fanfanPalette).toBe('cherryCloud')
    expect(
      (await adapter.get<Record<string, unknown>>(STORAGE_KEYS.settings))?.['fanfanPalette'],
    ).toBe('cherryCloud')
  })

  it('folds the unpublished warmBlue draft into warmField without a new schema version', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.meta, {
      schemaVersion: 7,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await adapter.set(STORAGE_KEYS.settings, {
      fanfanPalette: 'warmBlue',
      fanfanMode: true,
    })

    const meta = await initStorage()
    expect(meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect((await getSettings()).fanfanPalette).toBe('warmField')
    expect((await getSettings()).fanfanMode).toBe(true)

    const alreadyV8 = createMemoryAdapter()
    setStorageAdapter(alreadyV8)
    await alreadyV8.set(STORAGE_KEYS.meta, {
      schemaVersion: 8,
      installedAt: 1,
      lastOpenedAt: 1,
    })
    await alreadyV8.set(STORAGE_KEYS.settings, {
      fanfanPalette: 'warmBlue',
      fanfanShowMastered: false,
    })
    expect((await getSettings()).fanfanPalette).toBe('warmField')
    expect((await getSettings()).fanfanShowMastered).toBe(false)
  })

  it('v9: moves the retired offline dictionary default onto the free translator', async () => {
    const adapter = createMemoryAdapter()
    setStorageAdapter(adapter)
    await adapter.set(STORAGE_KEYS.meta, { schemaVersion: 8, installedAt: 1, lastOpenedAt: 1 })
    await adapter.set(STORAGE_KEYS.settings, { provider: 'mock', fanfanMode: true })

    const meta = await initStorage()
    expect(meta.schemaVersion).toBe(SCHEMA_VERSION)
    expect((await getSettings()).provider).toBe('google')
    expect((await getSettings()).fanfanMode).toBe(true)

    // 选了别的服务商的一律不动。
    const keyed = createMemoryAdapter()
    setStorageAdapter(keyed)
    await keyed.set(STORAGE_KEYS.meta, { schemaVersion: 8, installedAt: 1, lastOpenedAt: 1 })
    await keyed.set(STORAGE_KEYS.settings, { provider: 'deepseek' })
    await initStorage()
    expect((await getSettings()).provider).toBe('deepseek')
  })
})
