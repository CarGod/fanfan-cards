// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { Options } from './Options.tsx'
import { downloadText } from '@/services/exportService.ts'
import { saveSettings } from '@/storage/repositories/settingsRepo.ts'
import { storage } from '@/storage/area.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
vi.mock('@/services/exportService.ts', async (original) => ({
  ...await original<typeof import('@/services/exportService.ts')>(),
  downloadText: vi.fn(),
}))

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
    expect(labels).toContain('配置同步')
    expect(labels).not.toContain('配置恢复')
    expect(labels).not.toContain('GitHub 同步')
    expect(labels).not.toContain('GitHub 仓库')

    act(() => tabs.find((tab) => tab.textContent === '划词与翻译')!.click())
    expect(container.querySelector('.fanfan-settings')).toBeNull()

    act(() => tabs.find((tab) => tab.textContent === '翻翻模式')!.click())
    expect(location.hash).toBe('#fanfan')
    expect(container.querySelector('.fanfan-settings')).not.toBeNull()
  })
})


it('我的数据导出仅包含配置和密钥，不包含词卡、复习记录或缓存', async () => {
  await act(async () => {
    await saveSettings({ sync: { enabled: true, token: 'demo-github-token', owner: 'demo', repo: 'words', branch: 'main', autoSync: true, intervalMinutes: 30 } })
    await storage().set(STORAGE_KEYS.words, { marker: 'word-card-must-not-export' })
    await storage().set(STORAGE_KEYS.reviewLog, ['review-must-not-export'])
    await storage().set(STORAGE_KEYS.explainCache, { marker: 'cache-must-not-export' })
  })
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.settings-tab')].find((tab) => tab.textContent === '配置同步')!.click())
  const configTabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  expect(configTabs.map((tab) => tab.textContent)).toEqual(['GitHub 配置', '插件配置'])
  const githubPanel = container.querySelector<HTMLElement>('[role="tabpanel"][aria-label="GitHub 配置"]')!
  const pluginPanel = container.querySelector<HTMLElement>('[role="tabpanel"][aria-label="插件配置"]')!
  expect(githubPanel.hidden).toBe(false)
  expect(pluginPanel.hidden).toBe(true)
  await act(async () => configTabs[1]!.click())
  expect(githubPanel.hidden).toBe(true)
  expect(pluginPanel.hidden).toBe(false)
  expect(container.textContent).not.toContain('导出全部数据')
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '下载配置到本地')!.click()
  })
  const [filename, text] = vi.mocked(downloadText).mock.calls.at(-1)!
  expect(filename).toBe('fanfan-config.json')
  const doc = JSON.parse(text)
  expect(doc.format).toBe('fanfan-cards/configuration')
  expect(doc.fields['sync.token'].value).toBe('demo-github-token')
  expect(text).not.toContain('must-not-export')
  expect(doc).not.toHaveProperty('entries')
  expect(text.length).toBeLessThan(10000)
  expect(container.textContent).not.toContain('导入配置 JSON')
  expect(container.textContent).not.toContain('清空词卡')
  expect(container.querySelector('a[href="https://github.com/demo/words"]')).not.toBeNull()
  expect(container.textContent).not.toContain('删除仓库')
  expect(container.querySelector('a[href*="danger-zone"]')).toBeNull()
})
