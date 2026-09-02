// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { Options } from './Options.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  setLanguage('zh-CN')
  setStorageAdapter(createMemoryAdapter())
  vi.stubGlobal('chrome', {
    commands: { getAll: async () => [] },
    i18n: { getUILanguage: () => 'zh-CN' },
  })
  history.replaceState(null, '', '#model')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Options />)
    await Promise.resolve()
    await Promise.resolve()
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setStorageAdapter(null)
  vi.unstubAllGlobals()
  setLanguage('zh-CN')
})

describe('设置导航', () => {
  it('翻翻模式是独立一级入口，不再混在划词与翻译页', () => {
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.settings-tab')]
    const labels = tabs.map((tab) => tab.textContent)
    expect(labels).toContain('划词与翻译')
    expect(labels).toContain('翻翻模式')

    act(() => tabs.find((tab) => tab.textContent === '划词与翻译')!.click())
    expect(container.querySelector('.fanfan-settings')).toBeNull()

    act(() => tabs.find((tab) => tab.textContent === '翻翻模式')!.click())
    expect(location.hash).toBe('#fanfan')
    expect(container.querySelector('.fanfan-settings')).not.toBeNull()
  })
})
