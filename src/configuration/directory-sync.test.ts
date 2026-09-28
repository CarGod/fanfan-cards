import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import { emptyDocument } from './document.ts'
import { getConfigState } from './state.ts'
import { connectDirectory, synchronizeConfiguration } from './service.ts'
import { DirectoryIssue, loadDirectory, readDirectory, saveDirectory, writeDirectory, type ConfigDirectory } from './directory.ts'
vi.mock('./directory.ts', async (original) => ({
  ...await original<typeof import('./directory.ts')>(),
  loadDirectory: vi.fn(), readDirectory: vi.fn(), saveDirectory: vi.fn(), writeDirectory: vi.fn(),
}))
const handle = { name: 'iCloud Drive' } as ConfigDirectory
beforeEach(() => {
  setStorageAdapter(createMemoryAdapter())
  vi.resetAllMocks()
  vi.mocked(loadDirectory).mockResolvedValue(handle)
  vi.mocked(saveDirectory).mockResolvedValue()
  vi.mocked(writeDirectory).mockResolvedValue()
})
afterEach(() => setStorageAdapter(null))

it('connects by restoring the file first, then automatically saves later local edits', async () => {
  const remote = { ...emptyDocument(), fields: { 'sync.token': { value: 'file-token', updatedAt: 100, revision: 'file' } } }
  vi.mocked(readDirectory).mockResolvedValue(remote)
  await connectDirectory(handle)
  expect((await getSettings()).sync.token).toBe('file-token')
  expect(writeDirectory).not.toHaveBeenCalled()
  await saveSettings({ theme: 'dark' })
  await synchronizeConfiguration()
  expect(writeDirectory).toHaveBeenCalledWith(handle, expect.objectContaining({ fields: expect.objectContaining({
    theme: expect.objectContaining({ value: 'dark' }), 'sync.token': expect.objectContaining({ value: 'file-token' }),
  }) }))
  expect((await getConfigState()).lastSavedAt).toBeTypeOf('number')
})
it('revoked directory permission preserves the config and offers re-selection, with no write', async () => {
  vi.mocked(readDirectory).mockResolvedValue(emptyDocument())
  await connectDirectory(handle)
  await saveSettings({ theme: 'dark' })
  vi.mocked(readDirectory).mockRejectedValue(new DirectoryIssue('permission'))
  expect((await synchronizeConfiguration()).status).toBe('permission')
  expect((await getSettings()).theme).toBe('dark')
  expect(writeDirectory).not.toHaveBeenCalled()
})
it('failed file write does not fall back to sending the file to the previous browser account', async () => {
  vi.mocked(readDirectory).mockResolvedValue(emptyDocument())
  await saveSettings({ theme: 'dark' })
  vi.mocked(writeDirectory).mockRejectedValue(new Error('disk full'))
  await expect(connectDirectory(handle)).rejects.toThrow('disk full')
  expect(await getConfigState()).toMatchObject({ mode: 'directory', status: 'failed', lastSavedAt: null })
  expect((await getSettings()).theme).toBe('dark')
})
it('corrupt initial file leaves both mode and settings unchanged', async () => {
  await saveSettings({ theme: 'dark' })
  vi.mocked(readDirectory).mockRejectedValue(new DirectoryIssue('invalid'))
  await expect(connectDirectory(handle)).rejects.toMatchObject({ status: 'invalid' })
  expect((await getConfigState()).mode).toBe('auto')
  expect(saveDirectory).not.toHaveBeenCalled()
  expect(writeDirectory).not.toHaveBeenCalled()
  expect((await getSettings()).theme).toBe('dark')
})
it('recovers permission and writes pending OpenAI edits without replacing them with the older file', async () => {
  const remote = { ...emptyDocument(), fields: {
    'providers.openai.apiKey': { value: 'old-test-key', updatedAt: 100, revision: 'file' },
  } }
  vi.mocked(readDirectory).mockResolvedValue(remote)
  await connectDirectory(handle)
  const settings = await getSettings()
  await saveSettings({ providers: { ...settings.providers, openai: {
    apiKey: 'new-test-key', model: 'test-model', baseUrl: 'https://example.test/v1',
  } } })
  vi.mocked(readDirectory).mockRejectedValueOnce(new DOMException('Access revoked', 'NotAllowedError'))
  expect((await synchronizeConfiguration()).status).toBe('permission')
  expect(writeDirectory).not.toHaveBeenCalled()
  expect((await getSettings()).providers.openai.apiKey).toBe('new-test-key')
  expect((await synchronizeConfiguration()).status).toBe('saved')
  expect(writeDirectory).toHaveBeenCalledWith(handle, expect.objectContaining({ fields: expect.objectContaining({
    'providers.openai.apiKey': expect.objectContaining({ value: 'new-test-key' }),
    'providers.openai.model': expect.objectContaining({ value: 'test-model' }),
    'providers.openai.baseUrl': expect.objectContaining({ value: 'https://example.test/v1' }),
  }) }))
  expect((await getConfigState()).mode).toBe('directory')
})
