import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import { createMemoryAdapter, setStorageAdapter, type StorageAdapter } from './area.ts'
import { backupSettingsBeforeUpgrade, dismissBackups, recoverableBackup } from './backups.ts'
import { saveSettings } from './repositories/settingsRepo.ts'

let adapter: StorageAdapter
beforeEach(() => {
  adapter = createMemoryAdapter()
  setStorageAdapter(adapter)
})
afterEach(() => setStorageAdapter(null))

const withKey = (apiKey: string, token = '') => ({
  ...DEFAULT_SETTINGS,
  providers: { ...DEFAULT_SETTINGS.providers, deepseek: { apiKey, model: '', baseUrl: '' } },
  sync: { ...DEFAULT_SETTINGS.sync, token },
})
const backups = async () =>
  (await adapter.get<{ version: string; backups: Array<{ version: string | null; settings: unknown }> }>(STORAGE_KEYS.settingsBackups))

describe('settings backups across upgrades', () => {
  it('a new installation records its version and backs up nothing', async () => {
    await backupSettingsBeforeUpgrade('2.5.0')
    expect(await backups()).toEqual({ version: '2.5.0', backups: [] })
  })

  it('copies the stored settings as found once per version, not on every worker start', async () => {
    const stored = { ...withKey('sk-old', 'ghp-old'), provider: 'qwen' }
    await adapter.set(STORAGE_KEYS.settings, stored)
    await backupSettingsBeforeUpgrade('2.5.0')
    expect((await backups())?.backups).toEqual([expect.objectContaining({ version: null, settings: stored })])

    await saveSettings({ theme: 'dark' })
    await backupSettingsBeforeUpgrade('2.5.0')
    expect((await backups())?.backups).toHaveLength(1)

    await backupSettingsBeforeUpgrade('2.6.0')
    expect((await backups())?.backups.map((item) => item.version)).toEqual(['2.5.0', null])
  })

  it('keeps the good copy through later upgrades and skips identical ones', async () => {
    await adapter.set(STORAGE_KEYS.settings, withKey('sk-good'))
    await backupSettingsBeforeUpgrade('2.5.0')
    await adapter.set(STORAGE_KEYS.settings, DEFAULT_SETTINGS)
    await backupSettingsBeforeUpgrade('2.6.0')
    await backupSettingsBeforeUpgrade('2.7.0')
    expect((await backups())?.backups).toHaveLength(2)
    expect((await recoverableBackup())?.settings).toEqual(withKey('sk-good'))
  })

  it('offers a backup only for a lost key or token, until dismissed', async () => {
    await adapter.set(STORAGE_KEYS.settings, withKey('sk-old', 'ghp-old'))
    await backupSettingsBeforeUpgrade('2.5.0')
    expect(await recoverableBackup()).toBeNull()

    await adapter.set(STORAGE_KEYS.settings, withKey('sk-old'))
    expect((await recoverableBackup())?.version).toBeNull()
    await adapter.set(STORAGE_KEYS.settings, withKey('sk-replaced', 'ghp-old'))
    expect(await recoverableBackup()).toBeNull()

    await adapter.set(STORAGE_KEYS.settings, DEFAULT_SETTINGS)
    expect(await recoverableBackup()).not.toBeNull()
    await dismissBackups()
    expect(await recoverableBackup()).toBeNull()
  })
})
