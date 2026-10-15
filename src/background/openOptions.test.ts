import { afterEach, expect, it, vi } from 'vitest'
import { openModelSettings } from './openOptions.ts'
import { OPTIONS_NAVIGATION_KEY } from '@/shared/optionsNavigation.ts'
afterEach(() => vi.unstubAllGlobals())
it('requests the model section before native opening, without tab URL permissions', async () => {
  const set = vi.fn().mockResolvedValue(undefined)
  const openOptionsPage = vi.fn().mockImplementation(() => {
    expect(set).toHaveBeenCalledWith({ [OPTIONS_NAVIGATION_KEY]: { section: 'model', requestedAt: expect.any(Number) } })
  })
  vi.stubGlobal('chrome', { storage: { local: { set } }, runtime: { openOptionsPage } })
  await expect(openModelSettings()).resolves.toEqual({ opened: true })
  expect(openOptionsPage).toHaveBeenCalledOnce()
})
it('propagates opening failures so the notice can show an actionable error', async () => {
  vi.stubGlobal('chrome', { storage: { local: { set: vi.fn() } }, runtime: { openOptionsPage: vi.fn().mockRejectedValue(new Error('unavailable')) } })
  await expect(openModelSettings()).rejects.toThrow('unavailable')
})
