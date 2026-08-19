/**
 * Thin, testable wrapper over `chrome.storage.local`.
 *
 * Everything above this file is storage-agnostic, which is what makes the
 * "move the word list to IndexedDB" and "sync to GitHub" milestones cheap: they
 * replace this adapter, not the repositories.
 */

import { isExtensionAlive } from '@/shared/extensionContext.ts'

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  getAll(): Promise<Record<string, unknown>>
  /** Bytes currently used, or `null` when the platform cannot report it. */
  usage(): Promise<number | null>
  watch(key: string, listener: (value: unknown) => void): () => void
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local
}

/** In-memory adapter: unit tests and any non-extension context. */
export function createMemoryAdapter(): StorageAdapter {
  const store = new Map<string, unknown>()
  const listeners = new Map<string, Set<(value: unknown) => void>>()

  return {
    async get<T>(key: string) {
      return store.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      store.set(key, value)
      listeners.get(key)?.forEach((fn) => fn(value))
    },
    async remove(key: string) {
      store.delete(key)
      listeners.get(key)?.forEach((fn) => fn(undefined))
    },
    async getAll() {
      return Object.fromEntries(store.entries())
    },
    async usage() {
      return null
    },
    watch(key, listener) {
      const set = listeners.get(key) ?? new Set()
      set.add(listener)
      listeners.set(key, set)
      return () => set.delete(listener)
    },
  }
}

function createChromeAdapter(): StorageAdapter {
  const area = chrome.storage.local

  return {
    async get<T>(key: string) {
      const result = await area.get(key)
      return result[key] as T | undefined
    },
    async set<T>(key: string, value: T) {
      await area.set({ [key]: value })
    },
    async remove(key: string) {
      await area.remove(key)
    },
    async getAll() {
      return (await area.get(null)) as Record<string, unknown>
    },
    async usage() {
      try {
        return await area.getBytesInUse(null)
      } catch {
        return null
      }
    },
    watch(key, listener) {
      const handler = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => {
        if (areaName !== 'local') return
        const change = changes[key]
        if (change) listener(change.newValue)
      }
      // An orphaned content script still runs this code, but `chrome.storage`
      // is gone by then. Nothing will ever change for it again, so a no-op
      // unsubscribe is the honest result.
      if (!isExtensionAlive() || !chrome.storage?.onChanged) return () => {}

      chrome.storage.onChanged.addListener(handler)
      return () => {
        if (chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(handler)
      }
    },
  }
}

let adapter: StorageAdapter | null = null

export function storage(): StorageAdapter {
  if (!adapter) adapter = hasChromeStorage() ? createChromeAdapter() : createMemoryAdapter()
  return adapter
}

/** Test seam. */
export function setStorageAdapter(next: StorageAdapter | null): void {
  adapter = next
}
