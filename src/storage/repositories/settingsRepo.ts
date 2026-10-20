import { PROVIDER_HEALTH_KEY } from '@/shared/providerHealth.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { readSettings, settingsSchema, type Settings } from '@/types/settings.ts'
import { storage } from '../area.ts'
import { withLock } from '../mutex.ts'
import { DOCUMENT_KEY, documentForEdit, same, storedSettings } from '@/configuration/document.ts'

/**
 * Settings are always read through the zod schema, field by field, so a
 * partially-written or older-shaped object degrades to defaults where it is
 * unreadable instead of crashing a page — and only there.
 */
export async function getSettings(): Promise<Settings> {
  return readSettings(await storage().get<unknown>(STORAGE_KEYS.settings))
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return withLock(STORAGE_KEYS.settings, async () => {
    const raw = await storage().get<unknown>(STORAGE_KEYS.settings)
    const current = readSettings(raw)
    const next = settingsSchema.parse({ ...current, ...patch })
    // Explicit provider selection ends temporary fallback, including selecting the same tile.
    if (patch.provider !== undefined) await storage().remove(PROVIDER_HEALTH_KEY)
    if (same(current, next)) return next
    const document = await documentForEdit(current, next)
    await storage().setMany({ [STORAGE_KEYS.settings]: storedSettings(raw, current, next), [DOCUMENT_KEY]: document })
    return next
  })
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  return storage().watch(STORAGE_KEYS.settings, (value) => listener(readSettings(value)))
}

/** A site is active unless the user muted it or turned the extension off. */
export function isHostEnabled(settings: Settings, hostname: string): boolean {
  if (!settings.enabled) return false
  return !settings.blockedHosts.includes(hostname)
}
