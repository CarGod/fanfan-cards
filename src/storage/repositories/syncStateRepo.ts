import { STORAGE_KEYS } from '@/shared/constants.ts'
import { EMPTY_SYNC_STATE, type SyncState } from '@/types/sync.ts'
import { storage } from '../area.ts'

/**
 * Sync bookkeeping lives apart from settings: settings are user intent, this is
 * observed outcome. Mixing them means a failed sync rewrites the user's config.
 */
export async function readSyncState(): Promise<SyncState> {
  const raw = await storage().get<Partial<SyncState>>(STORAGE_KEYS.syncState)
  return { ...EMPTY_SYNC_STATE, ...(raw ?? {}) }
}

export async function writeSyncState(state: SyncState): Promise<void> {
  await storage().set(STORAGE_KEYS.syncState, state)
}

export function watchSyncState(listener: (state: SyncState) => void): () => void {
  return storage().watch(STORAGE_KEYS.syncState, (value) =>
    listener({ ...EMPTY_SYNC_STATE, ...((value as Partial<SyncState> | undefined) ?? {}) }),
  )
}
