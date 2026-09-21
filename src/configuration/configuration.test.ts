import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter, storage } from '@/storage/area.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { DEFAULT_SETTINGS } from '@/types/settings.ts'
import {
  CONFIG_FORMAT, DOCUMENT_KEY, emptyDocument, getDocument, mergeDocuments, parseConfigText,
  settingsFromDocument, type ConfigDocument,
} from './document.ts'
import { getConfigState } from './state.ts'
import { importConfiguration, selectConfigMode, startFreshConfiguration, synchronizeConfiguration, SYNC_PREFIX } from './service.ts'

let remote: Record<string, unknown>
let set: ReturnType<typeof vi.fn>
beforeEach(() => {
  setStorageAdapter(createMemoryAdapter())
  remote = {}
  set = vi.fn(async (patch: Record<string, unknown>) => { Object.assign(remote, structuredClone(patch)) })
  vi.stubGlobal('chrome', { storage: { sync: {
    get: vi.fn(async () => structuredClone(remote)), set,
    setAccessLevel: vi.fn(async () => undefined),
  } } })
})
afterEach(() => { vi.unstubAllGlobals(); setStorageAdapter(null) })

function doc(fields: Record<string, unknown>, stamp = 100): ConfigDocument {
  return { ...emptyDocument(), fields: Object.fromEntries(Object.entries(fields).map(([key, value]) =>
    [key, { value, updatedAt: stamp, revision: `edit-${stamp}` }])) }
}
function installRemote(document: ConfigDocument) {
  for (const [key, value] of Object.entries(document.fields)) remote[SYNC_PREFIX + key] = value
}

describe('configuration replication', () => {
  it('new installation reads keys without uploading defaults, including delayed cloud delivery', async () => {
    expect((await synchronizeConfiguration()).status).toBe('empty')
    expect(set).not.toHaveBeenCalled()
    installRemote(doc({ 'providers.deepseek.apiKey': 'test-secret', provider: 'deepseek', 'sync.token': 'test-github' }))
    const state = await synchronizeConfiguration()
    expect(state.status).toBe('restored')
    expect(state.lastRestoredAt).toBeTypeOf('number')
    expect(state.lastSavedAt).toBeNull()
    expect((await getSettings()).providers.deepseek.apiKey).toBe('test-secret')
    expect((await getSettings()).sync.token).toBe('test-github')
    expect(set).not.toHaveBeenCalled()
  })

  it('migrates existing non-default settings and leaves words and caches out of sync', async () => {
    await storage().set(STORAGE_KEYS.settings, { ...DEFAULT_SETTINGS, autoSpeak: true })
    await storage().set(STORAGE_KEYS.words, { private: 'not-config' })
    await synchronizeConfiguration()
    expect(Object.keys(remote)).toEqual([SYNC_PREFIX + 'autoSpeak'])
    expect((await getConfigState()).lastSavedAt).toBeTypeOf('number')
  })

  it('does not reset remote credentials when a new device changes an unrelated setting', async () => {
    await saveSettings({ theme: 'dark' })
    installRemote(doc({ 'providers.openai.apiKey': 'remote-key', provider: 'openai' }))
    await synchronizeConfiguration()
    const settings = await getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.providers.openai.apiKey).toBe('remote-key')
    expect(remote[SYNC_PREFIX + 'theme']).toMatchObject({ value: 'dark' })
  })

  it('replicates intentional deletion of a key and explicit default values', async () => {
    installRemote(doc({ 'providers.openai.apiKey': 'remote-key', autoSpeak: true }))
    await synchronizeConfiguration()
    await saveSettings({ providers: DEFAULT_SETTINGS.providers, autoSpeak: false })
    await synchronizeConfiguration()
    expect(remote[SYNC_PREFIX + 'providers.openai.apiKey']).toMatchObject({ value: '' })
    expect(remote[SYNC_PREFIX + 'autoSpeak']).toMatchObject({ value: false })
  })

  it('merges independent edits and deterministically resolves same-field ties', () => {
    const left = doc({ theme: 'dark', autoSpeak: true })
    const right = doc({ theme: 'light', exampleCount: 1 })
    expect(settingsFromDocument(mergeDocuments(left, right))).toMatchObject({ autoSpeak: true, exampleCount: 1 })
    expect(settingsFromDocument(mergeDocuments(left, right))).toEqual(settingsFromDocument(mergeDocuments(right, left)))
  })

  it('unavailable and rejecting sync APIs never block local settings or invent success times', async () => {
    vi.stubGlobal('chrome', { storage: {} })
    await saveSettings({ theme: 'dark' })
    expect((await synchronizeConfiguration()).status).toBe('unavailable')
    vi.stubGlobal('chrome', { storage: { sync: { get: async () => { throw new Error('offline') }, set } } })
    expect((await synchronizeConfiguration()).status).toBe('failed')
    expect((await getSettings()).theme).toBe('dark')
    expect((await getConfigState()).lastSavedAt).toBeNull()
  })

  it('failed write leaves settings intact and retries later', async () => {
    await saveSettings({ theme: 'dark' })
    set.mockRejectedValueOnce(new Error('quota throttled'))
    expect((await synchronizeConfiguration()).status).toBe('failed')
    expect((await getConfigState()).lastSavedAt).toBeNull()
    expect((await getSettings()).theme).toBe('dark')
    expect((await synchronizeConfiguration()).status).toBe('saved')
    expect((await getConfigState()).lastSavedAt).toBeTypeOf('number')
  })

  it('oversized field degrades to local without partial outbound writes', async () => {
    await saveSettings({ blockedHosts: ['x'.repeat(9000)], theme: 'dark' })
    expect((await synchronizeConfiguration()).status).toBe('quota')
    expect(set).not.toHaveBeenCalled()
    expect((await getSettings()).blockedHosts[0]).toHaveLength(9000)
  })

  it('malformed remote data cannot reset local settings', async () => {
    await saveSettings({ theme: 'dark' })
    remote[SYNC_PREFIX + 'theme'] = { value: 99, updatedAt: 100, revision: 'bad' }
    expect((await synchronizeConfiguration()).status).toBe('invalid')
    expect((await getSettings()).theme).toBe('dark')
    expect(set).not.toHaveBeenCalled()
  })

  it('no-op sync and feedback events do not write repeatedly or advance the saved time', async () => {
    await saveSettings({ autoSpeak: true })
    await synchronizeConfiguration()
    const time = (await getConfigState()).lastSavedAt
    await synchronizeConfiguration()
    await synchronizeConfiguration()
    expect(set).toHaveBeenCalledTimes(1)
    expect((await getConfigState()).lastSavedAt).toBe(time)
  })

  it('manual mode ignores subsequently arriving account configuration', async () => {
    await startFreshConfiguration()
    await saveSettings({ theme: 'dark' })
    installRemote(doc({ theme: 'light' }, Date.now() + 5000))
    await synchronizeConfiguration()
    expect((await getSettings()).theme).toBe('dark')
    expect(set).not.toHaveBeenCalled()
    expect((await getConfigState()).mode).toBe('manual')
  })

  it('valid file imports keys in local mode without touching cloud data or vocabulary', async () => {
    await storage().set(STORAGE_KEYS.words, { existing: 'preserved' })
    await importConfiguration(doc({ 'sync.token': 'from-file', provider: 'deepseek', 'providers.deepseek.apiKey': 'file-key' }))
    expect((await getSettings()).sync.token).toBe('from-file')
    expect((await getConfigState()).mode).toBe('manual')
    expect(await storage().get(STORAGE_KEYS.words)).toEqual({ existing: 'preserved' })
    await synchronizeConfiguration()
    expect(set).not.toHaveBeenCalled()
    expect(parseConfigText(JSON.stringify(await getDocument()))).toEqual(await getDocument())
  })

  it('rejects wrong formats, versions, dangerous paths, bad values and oversized files before mutation', async () => {
    await saveSettings({ theme: 'dark' })
    for (const value of [null, {}, { format: CONFIG_FORMAT, version: 2, fields: {} },
      doc({ '__proto__.polluted': true }), doc({ theme: 17 }), doc({ 'sync.intervalMinutes': 0 })]) {
      await expect(importConfiguration(value)).rejects.toThrow()
    }
    expect(() => parseConfigText(' '.repeat(512 * 1024 + 1))).toThrow()
    expect((await getSettings()).theme).toBe('dark')
    expect((await getConfigState()).mode).toBe('auto')
  })

  it('re-reads local edits made during cloud reads, instead of replacing them with an old snapshot', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    chrome.storage.sync.get = vi.fn(async () => { await blocked; return remote }) as typeof chrome.storage.sync.get
    installRemote(doc({ autoSpeak: true }))
    const pending = synchronizeConfiguration()
    await saveSettings({ theme: 'dark' })
    release()
    await pending
    expect(await getSettings()).toMatchObject({ theme: 'dark', autoSpeak: true })
    expect(remote[SYNC_PREFIX + 'theme']).toMatchObject({ value: 'dark' })
  })

  it('fresh setup clears device credentials without changing the account or vocabulary', async () => {
    installRemote(doc({ 'sync.token': 'account-key' }))
    await synchronizeConfiguration()
    await storage().set(STORAGE_KEYS.words, { kept: true })
    await startFreshConfiguration()
    expect((await getSettings()).sync.token).toBe('')
    expect(remote[SYNC_PREFIX + 'sync.token']).toMatchObject({ value: 'account-key' })
    expect(await storage().get(STORAGE_KEYS.words)).toEqual({ kept: true })
    await selectConfigMode('auto')
    expect((await getSettings()).sync.token).toBe('account-key')
  })

  it('corrupted local replication metadata never prevents normal local saves', async () => {
    await storage().set(DOCUMENT_KEY, { broken: true })
    await saveSettings({ autoSpeak: true })
    expect((await getSettings()).autoSpeak).toBe(true)
    await synchronizeConfiguration()
    expect(remote[SYNC_PREFIX + 'autoSpeak']).toMatchObject({ value: true })
  })

  it('keeps device mode separate from the replicated settings document', async () => {
    await saveSettings({ theme: 'dark' })
    await selectConfigMode('manual')
    expect(JSON.stringify(await storage().get(DOCUMENT_KEY))).not.toContain('setupComplete')
  })
})
