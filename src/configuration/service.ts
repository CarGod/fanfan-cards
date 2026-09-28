import { storage } from '@/storage/area.ts'
import { withLock } from '@/storage/mutex.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS, settingsSchema } from '@/types/settings.ts'
import {
  DOCUMENT_KEY, FIELD_PATHS, documentForEdit, emptyDocument, getDocument, mergeDocuments,
  parseDocument, same, settingsFromDocument, type ConfigDocument,
} from './document.ts'
import { getConfigState, updateConfigState, type ConfigMode, type ConfigState } from './state.ts'
import {
  DirectoryIssue, isDirectoryPermissionError, loadDirectory, readDirectory, saveDirectory, writeDirectory, type ConfigDirectory,
} from './directory.ts'

export const SYNC_PREFIX = 'fanfan:config:v1:'
const SYNC_LOCK = 'configuration-sync'
class SyncIssue extends Error {
  constructor(public readonly status: 'unavailable' | 'invalid' | 'quota') { super(status) }
}
function syncArea(): chrome.storage.SyncStorageArea {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync?.get || !chrome.storage.sync.set) {
    throw new SyncIssue('unavailable')
  }
  return chrome.storage.sync
}
async function readCloud(): Promise<{ area: chrome.storage.SyncStorageArea; doc: ConfigDocument }> {
  const area = syncArea()
  // Older compatible browsers may not implement access levels.
  if (typeof area.setAccessLevel === 'function') await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  const raw = await area.get(null)
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(SYNC_PREFIX)) continue
    const path = key.slice(SYNC_PREFIX.length)
    // Unknown v1 fields belong to a newer extension. Leave them untouched.
    if (FIELD_PATHS.includes(path)) fields[path] = value
  }
  try { return { area, doc: parseDocument({ ...emptyDocument(), fields }) } } catch { throw new SyncIssue('invalid') }
}
export function cloudPatch(doc: ConfigDocument, remote: ConfigDocument): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  let total = 0
  for (const [path, cell] of Object.entries(doc.fields)) {
    const key = SYNC_PREFIX + path
    const bytes = new TextEncoder().encode(key + JSON.stringify(cell)).length
    if (bytes > 8192) throw new SyncIssue('quota')
    total += bytes
    if (!same(cell, remote.fields[path])) changes[key] = cell
  }
  if (total > 102400) throw new SyncIssue('quota')
  return changes
}

/** IO never holds the settings lock: local edits remain available during sync. */
async function applyRemote(remote: ConfigDocument): Promise<{ doc: ConfigDocument; restored: boolean }> {
  return withLock(STORAGE_KEYS.settings, async () => {
    const local = await getDocument()
    const doc = mergeDocuments(local, remote)
    const restored = !same(local, doc)
    if (restored) {
      await storage().setMany({ [STORAGE_KEYS.settings]: settingsFromDocument(doc), [DOCUMENT_KEY]: doc })
    }
    return { doc, restored }
  })
}

/** All transport failures become local, non-secret status codes, never failed settings saves. */
export async function synchronizeConfiguration(): Promise<ConfigState> {
  return withLock(SYNC_LOCK, async () => {
    try {
      const state = await getConfigState()
      if (state.mode === 'manual') return state
      if (state.mode === 'directory') {
        const handle = await loadDirectory()
        if (!handle) throw new DirectoryIssue('permission')
        // A linked file going missing may mean iCloud is not downloaded yet. Never replace it.
        const remote = await readDirectory(handle, false)
        const { doc, restored } = await applyRemote(remote!)
        if (restored) await updateConfigState({ lastRestoredAt: Date.now(), setupComplete: true })
        const changed = !same(doc, remote)
        if (changed) await writeDirectory(handle, doc)
        return updateConfigState({
          status: restored ? 'restored' : 'saved',
          ...(changed ? { lastSavedAt: Date.now() } : {}),
          ...(restored ? { lastRestoredAt: Date.now() } : {}),
          setupComplete: state.setupComplete || Object.keys(doc.fields).length > 0,
        })
      }
      const { area, doc: remote } = await readCloud()
      const { doc, restored } = await applyRemote(remote)
      // Mark a completed restore even if the subsequent outbound write fails.
      if (restored) await updateConfigState({ lastRestoredAt: Date.now(), setupComplete: true })
      const patch = cloudPatch(doc, remote)
      const changed = Object.keys(patch).length > 0
      if (changed) await area.set(patch)
      return updateConfigState({
        status: Object.keys(doc.fields).length === 0 ? 'empty' : restored ? 'restored' : 'saved',
        ...(changed ? { lastSavedAt: Date.now() } : {}),
        setupComplete: state.setupComplete || Object.keys(doc.fields).length > 0,
      })
    } catch (error) {
      const status = isDirectoryPermissionError(error) ? 'permission'
        : error instanceof SyncIssue || error instanceof DirectoryIssue ? error.status : 'failed'
      return updateConfigState({ status })
    }
  }).catch(() => ({ mode: 'manual', status: 'failed', lastSavedAt: null,
    lastRestoredAt: null, directoryName: null, setupComplete: false }))
}

export async function selectConfigMode(mode: ConfigMode): Promise<void> {
  await withLock(SYNC_LOCK, async () => {
    const before = await getConfigState()
    await updateConfigState({ mode, status: mode === 'manual' ? 'local' : 'idle',
      ...(before.mode !== mode ? { lastSavedAt: null, lastRestoredAt: null } : {}),
    })
  })
  if (mode !== 'manual') await synchronizeConfiguration()
}

export async function importConfiguration(raw: unknown): Promise<void> {
  const doc = parseDocument(raw)
  await withLock(SYNC_LOCK, async () => {
    // Explicit file selection is a device-local choice; it never replaces account data.
    await updateConfigState({ mode: 'manual', status: 'local', lastSavedAt: null, lastRestoredAt: null })
    await withLock(STORAGE_KEYS.settings, async () => {
      const current = settingsSchema.parse(await storage().get(STORAGE_KEYS.settings) ?? {})
      const next = settingsFromDocument(doc)
      const edited = await documentForEdit(current, next)
      await storage().setMany({ [STORAGE_KEYS.settings]: next, [DOCUMENT_KEY]: edited })
    })
    await updateConfigState({ status: 'restored', lastRestoredAt: Date.now(), setupComplete: true })
  })
}

export async function startFreshConfiguration(): Promise<void> {
  await withLock(SYNC_LOCK, async () => {
    await updateConfigState({ mode: 'manual', status: 'local', setupComplete: true,
      lastSavedAt: null, lastRestoredAt: null })
    await withLock(STORAGE_KEYS.settings, async () => {
      // Defaults must not become deletion events against the existing account.
      await storage().setMany({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS, [DOCUMENT_KEY]: emptyDocument() })
    })
  })
}

/** Selection itself is the authorization. Existing config is always read before creating anything. */
export async function connectDirectory(handle: ConfigDirectory): Promise<void> {
  await withLock(SYNC_LOCK, async () => {
    const remote = await readDirectory(handle, true)
    // Remember the selected destination before applying its settings. A disk failure
    // must not accidentally send the imported file to the previously selected cloud.
    await saveDirectory(handle)
    await updateConfigState({ mode: 'directory', status: 'checking', directoryName: handle.name,
      lastSavedAt: null, lastRestoredAt: null })
    try {
      const { doc, restored } = remote ? await applyRemote(remote) : { doc: await getDocument(), restored: false }
      if (restored) await updateConfigState({ lastRestoredAt: Date.now(), setupComplete: true })
      const changed = !remote || !same(doc, remote)
      if (changed) await writeDirectory(handle, doc)
      await updateConfigState({
        status: restored ? 'restored' : 'saved',
        lastSavedAt: changed ? Date.now() : null,
        setupComplete: Object.keys(doc.fields).length > 0,
      })
    } catch (error) {
      await updateConfigState({ status: isDirectoryPermissionError(error) ? 'permission' : error instanceof DirectoryIssue ? error.status : 'failed' })
      throw error
    }
  })
}
