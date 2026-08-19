import { STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@/types/settings.ts'
import { storage } from '../area.ts'
import { withLock } from '../mutex.ts'

/**
 * Settings are always read through the zod schema, so a partially-written or
 * older-shaped object degrades to defaults instead of crashing a page.
 */
export async function getSettings(): Promise<Settings> {
  const raw = await storage().get<unknown>(STORAGE_KEYS.settings)
  const parsed = settingsSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return withLock(STORAGE_KEYS.settings, async () => {
    const current = await getSettings()
    const next = settingsSchema.parse({ ...current, ...patch })
    await storage().set(STORAGE_KEYS.settings, next)
    return next
  })
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  return storage().watch(STORAGE_KEYS.settings, (value) => {
    const parsed = settingsSchema.safeParse(value ?? {})
    listener(parsed.success ? parsed.data : DEFAULT_SETTINGS)
  })
}

/** A site is active unless the user muted it or turned the extension off. */
export function isHostEnabled(settings: Settings, hostname: string): boolean {
  if (!settings.enabled) return false
  return !settings.blockedHosts.includes(hostname)
}
