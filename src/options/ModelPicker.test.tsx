// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ModelPicker } from './ModelPicker.tsx'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it('shows the default, selects Pro and allows a custom model name', async () => {
  const host = document.createElement('div'), root = createRoot(host), change = vi.fn()
  await act(async () => root.render(<ModelPicker value="" defaultModel="deepseek-flash" suggestions={['deepseek-flash', 'deepseek-v4-pro']} onChange={change} />))
  const select = host.querySelector('select')!
  expect(select.value).toBe('deepseek-flash')
  await act(async () => { select.value = 'deepseek-v4-pro'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(change).toHaveBeenCalledWith('deepseek-v4-pro')
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.querySelector('input')).not.toBeNull()
  await act(async () => root.render(<ModelPicker value="my-custom-model" defaultModel="deepseek-flash" suggestions={['deepseek-flash', 'deepseek-v4-pro']} onChange={change} />))
  expect(host.querySelector('input')?.value).toBe('my-custom-model')
  act(() => root.unmount())
})
