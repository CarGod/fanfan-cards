// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { getConfigState, updateConfigState } from '@/configuration/state.ts'
import { ConfigurationSection } from './ConfigurationSection.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const configure = vi.fn()
beforeEach(async () => {
  configure.mockReset()
  setLanguage('zh-CN')
  setStorageAdapter(createMemoryAdapter())
  vi.stubGlobal('chrome', { storage: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<ConfigurationSection onConfigure={configure} />) })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setStorageAdapter(null)
  vi.unstubAllGlobals()
})
describe('configuration restore UI', () => {
  it('offers file fallback and fresh setup when neither cloud sync nor directory access exists', () => {
    expect(container.textContent).toContain('当前浏览器无法自动同步')
    expect(container.textContent).toContain('此浏览器不支持目录自动读写')
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent)
    expect(buttons).toContain('选择配置文件')
    expect(buttons).toContain('下载配置到本地')
    expect(buttons).toContain('全新安装，从头配置')
    expect(container.querySelector('input[type=password]')).toBeNull()
  })
  it('fresh setup navigates to AI configuration in local mode', async () => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === '全新安装，从头配置')!
    await act(async () => { button.click() })
    expect((await getConfigState()).mode).toBe('manual')
    expect(configure).toHaveBeenCalledTimes(1)
  })
  it('shows saved and restored times separately without claiming cloud delivery', async () => {
    await act(async () => {
      await updateConfigState({ status: 'saved', mode: 'auto', lastSavedAt: new Date(2026, 8, 9, 13, 46, 20).getTime(), lastRestoredAt: new Date(2026, 8, 9, 9, 2, 3).getTime() })
    })
    expect(container.textContent).toContain('最后写入时间：2026-09-09 13:46:20')
    expect(container.querySelector('.config-status strong')?.textContent).toBe('已开启')
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '已开启')).toBe(true)
    expect(container.textContent).toContain('最后读取时间：2026-09-09 09:02:03')
    expect(container.textContent).toContain('浏览器不提供云端上传确认')
    expect(container.textContent).not.toContain('已自动同步到 Chrome个人云端')
  })
})
