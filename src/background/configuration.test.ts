import { afterEach, expect, it, vi } from 'vitest'
import { DOCUMENT_KEY } from '@/configuration/document.ts'
import { synchronizeConfiguration } from '@/configuration/service.ts'
import { registerConfigurationSync } from './configuration.ts'
vi.mock('@/configuration/service.ts', () => ({ SYNC_PREFIX: 'fanfan:config:v1:', synchronizeConfiguration: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
function setup(periodInMinutes?: number) {
  vi.useFakeTimers()
  const onChanged = vi.fn(), onAlarm = vi.fn(), onFocus = vi.fn(), onStartup = vi.fn()
  const create = vi.fn()
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: onChanged } },
    alarms: { onAlarm: { addListener: onAlarm }, get: vi.fn().mockResolvedValue(periodInMinutes ? { periodInMinutes } : undefined), create },
    windows: { onFocusChanged: { addListener: onFocus } },
    runtime: { onStartup: { addListener: onStartup }, onInstalled: { addListener: vi.fn() } },
  })
  registerConfigurationSync()
  return { onChanged, onAlarm, onFocus, onStartup, create }
}
it('syncs local edits after debounce and retries without opening settings', async () => {
  const { onChanged, onAlarm, create } = setup()
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(create).toHaveBeenCalledWith('fanfan:configuration-retry', { periodInMinutes: 1 })
  vi.mocked(synchronizeConfiguration).mockClear()
  const change = onChanged.mock.calls[0]![0]
  change({ [DOCUMENT_KEY]: { newValue: {} } }, 'local')
  await vi.advanceTimersByTimeAsync(1000)
  change({ [DOCUMENT_KEY]: { newValue: {} } }, 'local')
  await vi.advanceTimersByTimeAsync(1499)
  expect(synchronizeConfiguration).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(1)
  onAlarm.mock.calls[0]![0]({ name: 'fanfan:configuration-retry' })
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(2)
})
it('upgrades persistent old alarms and checks on browser return with throttling', async () => {
  const { create, onFocus } = setup(5)
  await vi.advanceTimersByTimeAsync(0)
  expect(create).toHaveBeenCalledWith('fanfan:configuration-retry', { periodInMinutes: 1 })
  vi.mocked(synchronizeConfiguration).mockClear()
  const focus = onFocus.mock.calls[0]![0]
  focus(1)
  expect(synchronizeConfiguration).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(15000)
  focus(-1)
  expect(synchronizeConfiguration).not.toHaveBeenCalled()
  focus(1)
  focus(2)
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(1)
})
it('does not reset a correct alarm and repairs it on startup if it was cleared', async () => {
  const { create, onStartup } = setup(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(create).not.toHaveBeenCalled()
  chrome.alarms.get = vi.fn().mockResolvedValue(undefined)
  onStartup.mock.calls[0]![0]()
  await vi.advanceTimersByTimeAsync(0)
  expect(create).toHaveBeenCalledTimes(1)
})
it('remembers a local edit trigger arriving during slow file IO', async () => {
  let release!: () => void
  vi.mocked(synchronizeConfiguration).mockReturnValueOnce(new Promise((resolve) => {
    release = () => resolve({ mode: 'directory', status: 'saved', lastSavedAt: null, lastRestoredAt: null, directoryName: 'test', setupComplete: true })
  }))
  const { onChanged } = setup()
  onChanged.mock.calls[0]![0]({ [DOCUMENT_KEY]: { newValue: {} } }, 'local')
  await vi.advanceTimersByTimeAsync(1500)
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(1)
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(synchronizeConfiguration).toHaveBeenCalledTimes(2)
})
