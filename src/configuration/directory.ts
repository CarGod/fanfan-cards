import { CONFIG_FILENAME, CONFIG_FOLDER, MAX_FILE_BYTES, parseConfigText, type ConfigDocument } from './document.ts'

// The permissions methods are not in TypeScript's standard DOM library yet.
export interface ConfigDirectory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
interface PickerWindow {
  showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<ConfigDirectory>
}
export function supportsDirectory(): boolean {
  return typeof (globalThis as PickerWindow).showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined'
}

/** Must be invoked directly in the click handler, before any asynchronous work. */
export async function pickDirectory(): Promise<ConfigDirectory> {
  const picker = (globalThis as PickerWindow).showDirectoryPicker
  if (!picker) throw new Error('Directory picker unavailable')
  return picker.call(globalThis, { id: 'fanfan-config', mode: 'readwrite' })
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fanfan-configuration-handles', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('handles')
    request.onerror = () => reject(new Error('Directory storage unavailable'))
    request.onsuccess = () => resolve(request.result)
  })
}
export async function saveDirectory(handle: ConfigDirectory): Promise<void> {
  const db = await openDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('handles', 'readwrite')
      transaction.objectStore('handles').put(handle, 'directory')
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(new Error('Directory storage unavailable'))
    })
  } finally { db.close() }
}
export async function loadDirectory(): Promise<ConfigDirectory | undefined> {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await openDB()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get('directory')
      request.onsuccess = () => resolve(request.result as ConfigDirectory | undefined)
      request.onerror = () => reject(new Error('Directory storage unavailable'))
    })
  } finally { db.close() }
}

export class DirectoryIssue extends Error {
  constructor(public readonly status: 'permission' | 'invalid' | 'failed') { super(status) }
}
// Permission can be revoked between the preflight check and the actual file IO.
export function isDirectoryPermissionError(error: unknown): boolean {
  return error instanceof DirectoryIssue && error.status === 'permission' ||
    error instanceof DOMException && error.name === 'NotAllowedError'
}

/** Call directly from a click using an already-loaded handle, before any await. */
export function requestDirectoryPermission(handle: ConfigDirectory): Promise<PermissionState> {
  return handle.requestPermission({ mode: 'readwrite' })
}

export async function configFolder(parent: ConfigDirectory, create: boolean): Promise<FileSystemDirectoryHandle> {
  if (await parent.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new DirectoryIssue('permission')
  return parent.name === CONFIG_FOLDER ? parent : parent.getDirectoryHandle(CONFIG_FOLDER, { create })
}
export async function readDirectory(parent: ConfigDirectory, allowMissing: boolean): Promise<ConfigDocument | null> {
  try {
    const folder = await configFolder(parent, false)
    const file = await (await folder.getFileHandle(CONFIG_FILENAME)).getFile()
    if (file.size > MAX_FILE_BYTES) throw new DirectoryIssue('invalid')
    const text = await file.text()
    try { return parseConfigText(text) } catch { throw new DirectoryIssue('invalid') }
  } catch (error) {
    if (allowMissing && error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}
export async function writeDirectory(parent: ConfigDirectory, doc: ConfigDocument): Promise<void> {
  const folder = await configFolder(parent, true)
  const file = await folder.getFileHandle(CONFIG_FILENAME, { create: true })
  const stream = await file.createWritable()
  try {
    await stream.write(JSON.stringify(doc, null, 2))
    await stream.close()
  } catch (error) {
    await stream.abort().catch(() => undefined)
    throw error
  }
}
