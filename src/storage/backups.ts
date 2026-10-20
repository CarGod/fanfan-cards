import { STORAGE_KEYS } from '@/shared/constants.ts'
import { readSettings, type Settings } from '@/types/settings.ts'
import { storage } from './area.ts'
import { withLock } from './mutex.ts'

/*
 * 升级前留一份设置。
 *
 * 新版本第一次碰设置之前，先把旧版本留下的原样存一份。哪次升级弄丢了 AI Key 或
 * GitHub 连接，设置页就能把它找回来，而不是让读者去翻自己当初有没有导出过配置。
 *
 * 只在本机：不进配置文档，不进浏览器同步，不进导出。
 */

export interface SettingsBackup {
  /** The version that left these settings behind; null when it predates backups. */
  version: string | null
  savedAt: number
  /** Stored as found, so values only a newer build can read come back too. */
  settings: unknown
  dismissed?: boolean
}

interface BackupRecord {
  /** The version that ran last, so a worker restart is not mistaken for an upgrade. */
  version: string
  backups: SettingsBackup[]
}

/** A bad upgrade followed by another one must not push the good copy out. */
const KEEP = 3

export async function backupSettingsBeforeUpgrade(version: string): Promise<void> {
  await withLock(STORAGE_KEYS.settingsBackups, async () => {
    const record = await storage().get<BackupRecord>(STORAGE_KEYS.settingsBackups)
    if (record?.version === version) return
    const settings = await storage().get<unknown>(STORAGE_KEYS.settings)
    const backups = record?.backups ?? []
    const unchanged = settings === undefined || JSON.stringify(backups[0]?.settings) === JSON.stringify(settings)
    await storage().set<BackupRecord>(STORAGE_KEYS.settingsBackups, {
      version,
      backups: unchanged ? backups
        : [{ version: record?.version ?? null, savedAt: Date.now(), settings }, ...backups].slice(0, KEEP),
    })
  })
}

/** The newest backup holding an AI key or GitHub token that the current settings no longer have. */
export async function recoverableBackup(): Promise<SettingsBackup | null> {
  const [record, raw] = await Promise.all([
    storage().get<BackupRecord>(STORAGE_KEYS.settingsBackups),
    storage().get<unknown>(STORAGE_KEYS.settings),
  ])
  const now = credentials(readSettings(raw))
  return record?.backups.find((backup) => !backup.dismissed &&
    Object.entries(credentials(readSettings(backup.settings))).some(([key, value]) => value && !now[key])) ?? null
}

export async function dismissBackups(): Promise<void> {
  await withLock(STORAGE_KEYS.settingsBackups, async () => {
    const record = await storage().get<BackupRecord>(STORAGE_KEYS.settingsBackups)
    if (!record) return
    await storage().set<BackupRecord>(STORAGE_KEYS.settingsBackups, {
      ...record, backups: record.backups.map((backup) => ({ ...backup, dismissed: true })),
    })
  })
}

function credentials(settings: Settings): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(settings.providers).map(([id, item]) => [`providers.${id}.apiKey`, item.apiKey.trim()])),
    'sync.token': settings.sync.token.trim(),
  }
}
