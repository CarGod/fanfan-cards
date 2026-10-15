// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { getConfigState, updateConfigState } from '@/configuration/state.ts'
import { emptyDocument } from '@/configuration/document.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import { loadDirectory, readDirectory, saveDirectory, writeDirectory, type ConfigDirectory } from '@/configuration/directory.ts'
import { Options } from './Options.tsx'

vi.mock('@/configuration/directory.ts', async (original) => ({
  ...await original<typeof import('@/configuration/directory.ts')>(),
  loadDirectory: vi.fn(), readDirectory: vi.fn(), saveDirectory: vi.fn(), writeDirectory: vi.fn(),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const handle = { name: 'My settings' } as ConfigDirectory
const picker = vi.fn()
const cloudGet = vi.fn(async () => ({}))
const cloudSet = vi.fn()
const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
const render = async () => { await act(async () => { root.render(<Options />) }) }
beforeEach(() => {
  vi.resetAllMocks()
  setStorageAdapter(createMemoryAdapter())
  setLanguage('zh-CN')
  vi.stubGlobal('indexedDB', {})
  vi.stubGlobal('showDirectoryPicker', picker)
  vi.stubGlobal('chrome', { commands: { getAll: async () => [] }, storage: { sync: { get: cloudGet, set: cloudSet } } })
  picker.mockResolvedValue(handle)
  vi.mocked(loadDirectory).mockResolvedValue(handle)
  vi.mocked(readDirectory).mockResolvedValue(null)
  vi.mocked(saveDirectory).mockResolvedValue()
  vi.mocked(writeDirectory).mockResolvedValue()
  history.replaceState(null, '', '/#model')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setStorageAdapter(null)
  vi.unstubAllGlobals()
})
it('starts with a folder choice, even after a cosmetic edit, without opening the picker or cloud', async () => {
  await saveSettings({ theme: 'dark' })
  await render()
  expect(container.textContent).toContain('先选择配置目录')
  expect(container.querySelector('.provider-grid')).toBeNull()
  expect(container.querySelector('.settings-nav')).toBeNull()
  expect(container.querySelector('details')?.open).toBe(false)
  expect(picker).not.toHaveBeenCalled()
  expect(cloudGet).not.toHaveBeenCalled()
  expect(cloudSet).not.toHaveBeenCalled()
})
it('opens the picker on the click and starts setup with automatic folder sync for an empty folder', async () => {
  await render()
  await act(async () => {
    button('选择配置目录').click()
    expect(picker).toHaveBeenCalledWith({ id: 'fanfan-config', mode: 'readwrite' })
  })
  expect(container.querySelector('.provider-grid')).not.toBeNull()
  expect(container.textContent).toContain('配置目录已连接，自动同步已开启')
  expect(await getConfigState()).toMatchObject({ mode: 'directory', setupComplete: true })
  expect(writeDirectory).toHaveBeenCalledWith(handle, emptyDocument())
})
it('waits for an existing file before showing settings and restores without rewriting', async () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(readDirectory).mockImplementation(async () => {
    await wait
    return { ...emptyDocument(), fields: { provider: { value: 'google', updatedAt: 10, revision: 'other-device' } } }
  })
  await render()
  await act(async () => { button('选择配置目录').click() })
  expect(container.querySelector('.provider-grid')).toBeNull()
  expect(writeDirectory).not.toHaveBeenCalled()
  await act(async () => { release() })
  expect(container.textContent).toContain('已恢复已有配置，可以直接使用')
  expect(container.querySelector('.settings-nav')).not.toBeNull()
  expect(location.hash).toBe('#configuration')
  expect((await getSettings()).provider).toBe('google')
  expect(writeDirectory).not.toHaveBeenCalled()
})
it('canceling the picker stays on the first step without changing settings or creating files', async () => {
  picker.mockRejectedValue(new DOMException('Canceled', 'AbortError'))
  await render()
  await act(async () => { button('选择配置目录').click() })
  expect(container.textContent).toContain('先选择配置目录')
  expect(container.textContent).not.toContain('未完成操作')
  expect(saveDirectory).not.toHaveBeenCalled()
  expect(writeDirectory).not.toHaveBeenCalled()
})
it('an authorized saved folder opens normal settings after reading, without asking again', async () => {
  await updateConfigState({ mode: 'directory', setupComplete: true, directoryName: handle.name })
  vi.mocked(readDirectory).mockResolvedValue({ ...emptyDocument(), fields: { provider: { value: 'google', updatedAt: 10, revision: 'file' } } })
  await render()
  expect(readDirectory).toHaveBeenCalled()
  expect(container.querySelector('.provider-grid')).not.toBeNull()
  expect(container.textContent).not.toContain('先选择配置目录')
  expect(picker).not.toHaveBeenCalled()
})
it('a missing folder permission keeps settings available with a visible recovery route', async () => {
  await updateConfigState({ mode: 'directory', setupComplete: true })
  vi.mocked(readDirectory).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
  await render()
  expect(container.textContent).toContain('目录授权已失效')
  expect(container.querySelector('.provider-grid')).not.toBeNull()
  await act(async () => { button('恢复目录授权').click() })
  expect(location.hash).toBe('#configuration')
  expect(writeDirectory).not.toHaveBeenCalled()
})
it('file import fallback exits onboarding', async () => {
  await render()
  const file = { size: 100, text: async () => JSON.stringify({ ...emptyDocument(), fields: { provider: { value: 'google', updatedAt: 1, revision: 'file' } } }) } as File
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input, 'files', { value: [file] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(container.querySelector('.settings-nav')).not.toBeNull()
  expect((await getConfigState()).mode).toBe('manual')
  expect(container.textContent).not.toContain('先选择配置目录')
})
it('explicit local fallback preserves existing changes and is remembered on reopening', async () => {
  await saveSettings({ theme: 'dark' })
  await render()
  await act(async () => { button('暂不选择，使用本机配置').click() })
  expect((await getSettings()).theme).toBe('dark')
  act(() => root.unmount())
  root = createRoot(container)
  await render()
  expect(container.textContent).not.toContain('先选择配置目录')
  expect(container.querySelector('.provider-grid')).not.toBeNull()
})

it('explicit browser account recovery exits onboarding', async () => {
  cloudGet.mockResolvedValue({ 'fanfan:config:v1:provider': { value: 'google', updatedAt: 10, revision: 'cloud' } })
  await render()
  await act(async () => { button('使用自动同步').click() })
  expect(container.querySelector('.settings-nav')).not.toBeNull()
  expect(await getConfigState()).toMatchObject({ mode: 'auto', setupComplete: true })
  expect(container.textContent).toContain('已恢复已有配置')
  expect(picker).not.toHaveBeenCalled()
})
it('a corrupt selected file keeps the first step recoverable and never writes to the folder', async () => {
  vi.mocked(readDirectory).mockRejectedValue(new Error('Invalid configuration'))
  await render()
  await act(async () => { button('选择配置目录').click() })
  expect(container.textContent).toContain('先选择配置目录')
  expect(container.textContent).toContain('未完成操作')
  expect(saveDirectory).not.toHaveBeenCalled()
  expect(writeDirectory).not.toHaveBeenCalled()
})
