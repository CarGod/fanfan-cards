// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProviderNotice } from './ProviderNotice.tsx'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { setLanguage } from '@/i18n/index.ts'
const send = vi.hoisted(() => vi.fn())
const context = vi.hoisted(() => ({ alive: true }))
vi.mock('@/shared/extensionContext.ts', () => ({
  isExtensionAlive: () => context.alive, isOrphaned: () => false, onOrphaned: () => () => {},
  noteOrphanError: (error: unknown) => !context.alive || String(error).includes('Extension context invalidated'),
}))
vi.mock('@/services/messaging.ts', () => ({ sendMessage: send }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLElement
beforeEach(() => {
  context.alive = true
  setStorageAdapter(createMemoryAdapter())
  setLanguage('zh-CN')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  send.mockReset()
  send.mockImplementation(async (type) => type === 'provider/status' ? { health: { id: 'outage', original: 'deepseek', model: 'deepseek-flash', code: 'service_unavailable', fallback: 'google', recovered: true } } : { ok: true })
})
afterEach(() => { act(() => root.unmount()); host.remove(); setStorageAdapter(null) })
it('offers recovery but does not switch until explicitly clicked', async () => {
  await act(async () => root.render(<ProviderNotice inline />))
  expect(host.textContent).toContain('已通过恢复检查')
  expect(send.mock.calls.some(([type]) => type === 'provider/restore')).toBe(false)
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '切回原模型')!
  await act(async () => button.click())
  expect(send).toHaveBeenCalledWith('provider/restore', { id: 'outage' })
})
it('lets the user keep the temporary provider without restoring', async () => {
  await act(async () => root.render(<ProviderNotice inline />))
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === '保持当前')!
  await act(async () => button.click())
  expect(host.textContent).toBe('')
  expect(send.mock.calls.some(([type]) => type === 'provider/restore')).toBe(false)
})
it('offers temporary Google and settings for a provider outage', async () => {
  send.mockImplementation(async (type) => type === 'provider/status' ? { health: { id: 'outage', original: 'deepseek', model: 'deepseek-flash', code: 'service_unavailable', fallback: null, recovered: false } } : { ok: true })
  await act(async () => root.render(<ProviderNotice inline />))
  expect(host.textContent).toContain('模型服务繁忙')
  expect(host.textContent).toContain('翻翻词卡')
  expect(host.textContent).toContain('DeepSeek 配置')
  expect(host.textContent).toContain('deepseek-flash')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  expect(host.textContent).toContain('新增配置')
  const button = host.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!
  await act(async () => button.click())
  expect(send).toHaveBeenCalledWith('provider/use', { id: 'outage', provider: 'google' })
})


it('opens model settings from Add configuration', async () => {
  await act(async () => root.render(<ProviderNotice inline />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(send).toHaveBeenCalledWith('options/open', {})
})
it('turns a stale extension error into an actionable refresh notice', async () => {
  send.mockImplementation(async (type) => {
    if (type === 'provider/status') return { health: { id: 'outage', original: 'deepseek', model: 'deepseek-flash', code: 'service_unavailable', fallback: null, recovered: false } }
    throw new Error('Extension context invalidated')
  })
  await act(async () => root.render(<ProviderNotice inline />))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
  expect(host.textContent).toContain('插件已更新，此页面需要刷新')
  expect(host.textContent).not.toContain('Extension context invalidated')
  expect(host.querySelector('[aria-haspopup="menu"]')).toBeNull()
  expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('刷新'))).toBe(true)
})
it('supports Escape to close the provider menu and restore focus', async () => {
  await act(async () => root.render(<ProviderNotice inline />))
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  await act(async () => trigger.click())
  await act(async () => host.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('keeps a dismissed recovery hidden after remounting the page', async () => {
  await act(async () => root.render(<ProviderNotice inline />))
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '保持当前')!.click())
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<ProviderNotice inline />))
  expect(host.textContent).toBe('')
})
it('stays quiet while a temporary provider works, then shows recovery', async () => {
  let recovered = false
  send.mockImplementation(async () => ({ health: { id: 'quiet', original: 'deepseek', model: 'deepseek-flash', code: 'service_unavailable', fallback: 'google', recovered } }))
  await act(async () => root.render(<ProviderNotice inline />))
  expect(host.textContent).toBe('')
  recovered = true
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<ProviderNotice inline />))
  expect(host.textContent).toContain('已通过恢复检查')
})

it('keeps success feedback visible after restoring clears the outage', async () => {
  let restored = false
  send.mockImplementation(async type => {
    if (type === 'provider/restore') { restored = true; return { ok: true } }
    return { health: restored ? null : { id: 'restore-feedback', original: 'deepseek', model: 'deepseek-flash', code: 'service_unavailable', fallback: 'google', recovered: true } }
  })
  await act(async () => root.render(<ProviderNotice inline />))
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '切回原模型')!.click())
  expect(host.textContent).toContain('已切回 DeepSeek')
  expect(host.querySelector('aside')).toBeNull()
})
