// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { discoverModels, DiscoveryError, type DiscoveryErrorCode, type ModelDiscoveryResult } from '@/ai/modelDiscovery.ts'
import { requestOptionalApiAccess } from '@/ai/hostPermission.ts'
import { setLanguage, t } from '@/i18n/index.ts'
import { ModelPicker } from './ModelPicker.tsx'

vi.mock('@/ai/modelDiscovery.ts', async original => ({
  ...await original<typeof import('@/ai/modelDiscovery.ts')>(), discoverModels: vi.fn(),
}))
vi.mock('@/ai/hostPermission.ts', () => ({ requestOptionalApiAccess: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Props = ComponentProps<typeof ModelPicker>
let host: HTMLDivElement, root: Root, props: Props
const fetch = vi.mocked(discoverModels)
const permission = vi.mocked(requestOptionalApiAccess)
const result = (...ids: string[]): ModelDiscoveryResult => ({ models: ids.map(id => ({ id })), fetchedAt: 1234 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const render = async (patch: Partial<Props> = {}) => {
  props = { ...props, ...patch }
  await act(async () => { root.render(<ModelPicker {...props} />) })
}
const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!
const select = () => host.querySelector('select')!
const options = () => [...select().options].map(item => item.value)
const clickFetch = async () => { await act(async () => { host.querySelector('button')!.click() }) }
const choose = async (value: string) => { await act(async () => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })) }) }
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  setLanguage('en')
  permission.mockResolvedValue()
  fetch.mockResolvedValue(result('api-small', 'api-pro'))
  props = {
    provider: 'openai', config: { apiKey: 'test-only-key', baseUrl: '', model: '' },
    value: '', defaultModel: 'built-in-small', suggestions: ['built-in-small', 'built-in-pro'], onChange: vi.fn(),
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

it('never fetches or requests access on mount, provider changes or configuration edits', async () => {
  await render()
  expect(select().value).toBe('built-in-small')
  await render({ provider: 'deepseek' })
  await render({ config: { ...props.config!, apiKey: 'another-test-key' } })
  await render({ config: { ...props.config!, baseUrl: 'https://gateway.example/v1' } })
  expect(fetch).not.toHaveBeenCalled()
  expect(permission).not.toHaveBeenCalled()
  expect(props.onChange).not.toHaveBeenCalled()
})

it('groups built-ins and untested API candidates, deduplicates them, and never switches the selected model', async () => {
  fetch.mockResolvedValue({ models: [{ id: 'built-in-small' }, { id: 'api-pro', name: 'Reasoning Pro' }], fetchedAt: 1234 })
  await render({ value: 'my-existing-model' })
  await clickFetch()
  expect(fetch).toHaveBeenCalledWith('openai', props.config, { signal: expect.any(AbortSignal) })
  expect(permission).not.toHaveBeenCalled()
  expect(select().value).toBe('my-existing-model')
  expect(host.querySelector<HTMLInputElement>('[aria-label="Custom model name"]')?.value).toBe('my-existing-model')
  expect(options().filter(id => id === 'built-in-small')).toHaveLength(1)
  expect([...host.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['Current selection', 'Built-in suggestions', 'Candidates from provider'])
  expect(host.querySelector('option[value="api-pro"]')?.textContent).toBe('api-pro (Reasoning Pro) · Not tested')
  expect(host.textContent).toContain('may be incomplete')
  expect(host.textContent).toContain('do not guarantee compatibility')
  expect(props.onChange).not.toHaveBeenCalled()
  expect(button('Refresh models')).toBeDefined()
})

it('filters IDs and display names without losing the selected model, and keeps manual entry usable', async () => {
  fetch.mockResolvedValue({ models: [{ id: 'api-pro', name: 'Reasoning Pro' }, { id: 'api-small' }], fetchedAt: 1234 })
  await render()
  await clickFetch()
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
  await type(search, ' REASONING ')
  expect(options()).toEqual(['built-in-small', 'api-pro', ''])
  expect(select().value).toBe('built-in-small')
  expect(props.onChange).not.toHaveBeenCalled()
  await choose('api-pro')
  expect(props.onChange).toHaveBeenLastCalledWith('api-pro')
  await render({ value: 'api-pro', config: { ...props.config!, model: 'api-pro' } })
  await type(search, 'nothing-matches')
  expect(select().value).toBe('api-pro')
  expect(options()).toEqual(['api-pro', ''])
  expect(host.textContent).toContain('No matching models')
  await choose('')
  const manual = host.querySelector<HTMLInputElement>('[aria-label="Custom model name"]')!
  await type(manual, 'private-deployment')
  expect(props.onChange).toHaveBeenLastCalledWith('private-deployment')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('matches API display names for deduplicated built-in suggestions without changing their group', async () => {
  fetch.mockResolvedValue({ models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }], fetchedAt: 1234 })
  await render({ provider: 'deepseek', suggestions: ['deepseek-flash', 'deepseek-pro'], defaultModel: 'deepseek-pro' })
  await clickFetch()
  await type(host.querySelector<HTMLInputElement>('input[type="search"]')!, 'DEEPSEEK-V4.1-FLASH')
  expect(options()).toEqual(['deepseek-pro', 'deepseek-flash', ''])
  expect(host.querySelectorAll('option[value="deepseek-flash"]')).toHaveLength(1)
  expect(host.querySelector('option[value="deepseek-flash"]')?.parentElement?.getAttribute('label')).toBe('Built-in suggestions')
  expect(host.textContent).not.toContain('No matching models')
  expect(select().value).toBe('deepseek-pro')
  expect(props.onChange).not.toHaveBeenCalled()
})

it('keeps a successful list and the current model if refresh fails, then replaces it on a later success', async () => {
  await render({ value: 'api-pro' })
  await clickFetch()
  fetch.mockRejectedValueOnce(new DiscoveryError('rate_limit', 429))
  await clickFetch()
  expect(options()).toContain('api-small')
  expect(select().value).toBe('api-pro')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('previously fetched list is kept')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('rate limiting')
  fetch.mockResolvedValueOnce(result('api-new'))
  await clickFetch()
  expect(options()).not.toContain('api-small')
  expect(options()).toContain('api-new')
  expect(select().value).toBe('api-pro')
  expect(props.onChange).not.toHaveBeenCalled()
})

it('blocks repeat clicks while loading and cancellation ignores a late response without changing models', async () => {
  const first = deferred<ModelDiscoveryResult>()
  fetch.mockReturnValueOnce(first.promise)
  await render()
  await act(async () => { host.querySelector('button')!.click(); host.querySelector('button')!.click() })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(host.querySelector('button')?.disabled).toBe(true)
  const signal = fetch.mock.calls[0]![2]!.signal!
  await act(async () => { button('Cancel fetch').click() })
  expect(signal.aborted).toBe(true)
  expect(host.textContent).toContain('Fetch cancelled')
  await clickFetch()
  await act(async () => { first.resolve(result('stale-model')) })
  expect(options()).toContain('api-pro')
  expect(options()).not.toContain('stale-model')
  expect(props.onChange).not.toHaveBeenCalled()
})

it.each(['apiKey', 'baseUrl', 'provider'] as const)('isolates %s changes, cancels in-flight work and does not restore an old cache', async field => {
  await render()
  await clickFetch()
  const old = deferred<ModelDiscoveryResult>()
  fetch.mockReturnValueOnce(old.promise)
  await clickFetch()
  const signal = fetch.mock.calls[1]![2]!.signal!
  const originalConfig = props.config
  await type(host.querySelector<HTMLInputElement>('input[type="search"]')!, 'api')
  await render(field === 'provider' ? { provider: 'deepseek' }
    : { config: { ...props.config!, [field]: field === 'apiKey' ? 'changed-test-key' : 'https://gateway.example/v1' } })
  expect(signal.aborted).toBe(true)
  expect(options()).not.toContain('api-pro')
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('')
  expect(host.querySelector('[role="status"]')?.textContent).toBe('')
  expect(fetch).toHaveBeenCalledTimes(2)
  fetch.mockResolvedValueOnce(result('new-session-model'))
  await clickFetch()
  await act(async () => { old.resolve(result('old-session-model')) })
  expect(options()).toContain('new-session-model')
  expect(options()).not.toContain('old-session-model')
  await render({ provider: 'openai', config: originalConfig! })
  expect(options()).not.toContain('new-session-model')
  expect(options()).not.toContain('api-pro')
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('does not cancel or refetch when only the selected model changes', async () => {
  const pending = deferred<ModelDiscoveryResult>()
  fetch.mockReturnValueOnce(pending.promise)
  await render()
  await clickFetch()
  const signal = fetch.mock.calls[0]![2]!.signal!
  await render({ value: 'my-new-model', config: { ...props.config!, model: 'my-new-model' } })
  expect(signal.aborted).toBe(false)
  await act(async () => { pending.resolve(result('api-result')) })
  expect(select().value).toBe('my-new-model')
  expect(options()).toContain('api-result')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('aborts on unmount and ignores the final response', async () => {
  const pending = deferred<ModelDiscoveryResult>()
  fetch.mockReturnValueOnce(pending.promise)
  await render()
  await clickFetch()
  const signal = fetch.mock.calls[0]![2]!.signal!
  await act(async () => { root.render(null) })
  expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve(result('stale-after-unmount')) })
  expect(host.textContent).toBe('')
})

it.each([
  ['custom', 'https://gateway.example/v1', 'https://gateway.example/v1/models'],
  ['openai', 'https://proxy.example/v1', 'https://proxy.example/v1/models'],
  ['mimo', '', 'https://api.xiaomimimo.com/v1/models'],
] as const)('requests access synchronously on a %s click before sending credentials', async (provider, baseUrl, endpoint) => {
  const grant = deferred<void>()
  permission.mockReturnValueOnce(grant.promise)
  await render({ provider, config: { ...props.config!, baseUrl } })
  expect(permission).not.toHaveBeenCalled()
  await act(async () => {
    host.querySelector('button')!.click()
    expect(permission).toHaveBeenCalledWith(endpoint)
    expect(fetch).not.toHaveBeenCalled()
  })
  await act(async () => { grant.resolve() })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]![0]).toBe(provider)
})

it('never fetches after denied permission and never displays the unsafe permission error', async () => {
  permission.mockRejectedValueOnce(new Error('Denied https://secret.example/private?key=private-test-key'))
  await render({ provider: 'custom', config: { ...props.config!, baseUrl: 'https://gateway.example/v1' } })
  await clickFetch()
  expect(fetch).not.toHaveBeenCalled()
  expect(host.textContent).toContain('No model-list request was sent')
  expect(host.textContent).not.toContain('secret.example')
  expect(host.innerHTML).not.toContain('private-test-key')
  expect(options()).toContain('built-in-small')
  await choose('')
  expect(host.querySelector('[aria-label="Custom model name"]')).not.toBeNull()
})

it('keeps the last list if a refresh permission request is denied', async () => {
  await render({ provider: 'custom', config: { ...props.config!, baseUrl: 'https://gateway.example/v1' } })
  await clickFetch()
  permission.mockRejectedValueOnce(new Error('permission revoked'))
  await clickFetch()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(options()).toContain('api-pro')
  expect(host.textContent).toContain('previously fetched list is kept')
  expect(host.textContent).toContain('No model-list request was sent')
})

it.each(['cancel', 'config'] as const)('does not start a fetch if permission resolves after %s', async action => {
  const grant = deferred<void>()
  permission.mockReturnValueOnce(grant.promise)
  await render({ provider: 'custom', config: { ...props.config!, baseUrl: 'https://gateway.example/v1' } })
  await clickFetch()
  if (action === 'cancel') await act(async () => { button('Cancel fetch').click() })
  else await render({ config: { ...props.config!, apiKey: 'different-test-key' } })
  await act(async () => { grant.resolve() })
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['openai', 'claude', 'deepseek', 'gemini', 'mimo'] as const)('requires a %s key locally without requesting permission or fetching', async provider => {
  await render({ provider, config: { apiKey: '', baseUrl: '', model: '' } })
  await clickFetch()
  expect(host.textContent).toContain('Enter this provider’s API key')
  expect(permission).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects an invalid custom endpoint locally without requesting permission or fetching', async () => {
  await render({ provider: 'custom', config: { apiKey: '', baseUrl: 'file:///private/key', model: '' } })
  await clickFetch()
  expect(host.textContent).toContain('Check the API endpoint')
  expect(permission).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['', '   '])('allows keyless custom model discovery after access is granted (%j)', async apiKey => {
  await render({ provider: 'custom', config: { apiKey, baseUrl: 'http://localhost:1234/v1', model: '' } })
  expect(fetch).not.toHaveBeenCalled()
  await clickFetch()
  expect(permission).toHaveBeenCalledWith('http://localhost:1234/v1/models')
  expect(fetch).toHaveBeenCalledWith('custom', { apiKey, baseUrl: 'http://localhost:1234/v1', model: '' }, { signal: expect.any(AbortSignal) })
  expect(options()).toContain('api-pro')
  expect(host.textContent).not.toContain('Enter this provider’s API key')
})

it.each<DiscoveryErrorCode>(['auth', 'rate_limit', 'unsupported', 'empty', 'timeout', 'bad_response', 'limit', 'redirect', 'network', 'http', 'no_api_key', 'invalid_config', 'aborted'])('handles %s without exposing response text or changing the selected model', async code => {
  const error = new DiscoveryError(code)
  error.message = 'unsafe https://private.example/?key=private-test-key'
  fetch.mockRejectedValueOnce(error)
  await render({ value: 'existing-model' })
  await clickFetch()
  expect(host.querySelector('[role="status"]')?.textContent).not.toBe('')
  expect(host.textContent).not.toContain('private.example')
  expect(host.innerHTML).not.toContain('private-test-key')
  expect(select().value).toBe('existing-model')
  expect(props.onChange).not.toHaveBeenCalled()
})

it('uses a fixed safe message for unknown errors and can retry', async () => {
  fetch.mockRejectedValueOnce(new Error('unexpected upstream secret test-key https://private.example'))
  await render()
  await clickFetch()
  expect(host.querySelector('[role="status"]')?.textContent).toBe(t('options.model.discovery.error.network'))
  await clickFetch()
  expect(options()).toContain('api-pro')
})

it('translates discovery controls and live status between Chinese and English', async () => {
  setLanguage('zh-CN')
  await render()
  expect(button('获取厂商模型列表')).toBeDefined()
  await clickFetch()
  expect(host.textContent).toContain('待测试')
  expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('已获取 2 个候选模型')
  const description = document.getElementById(select().getAttribute('aria-describedby')!)
  expect(description?.textContent).toContain('不保证每个模型都兼容')
  await act(async () => { setLanguage('en') })
  expect(button('Refresh models')).toBeDefined()
  expect(host.textContent).toContain('Not tested')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Fetched 2 candidate models')
})
