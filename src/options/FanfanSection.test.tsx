// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n/index.ts'
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings.ts'
import { FanfanSection } from './FanfanSection.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Harness() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const update = async (patch: Partial<Settings>): Promise<void> => {
    setSettings((current) => ({ ...current, ...patch }))
  }
  return <FanfanSection settings={settings} update={update} />
}

beforeEach(() => {
  setLanguage('zh-CN')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  setLanguage('zh-CN')
})

const buttonContaining = (text: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

const press = async (button: HTMLButtonElement, key: string): Promise<void> => {
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))
  })
}

const paletteChoices = (): HTMLButtonElement[] => [
  ...container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
]

const expectSingleTabStop = (selectedName: string): void => {
  const choices = paletteChoices()
  expect(choices.filter((choice) => choice.tabIndex === 0)).toEqual([
    buttonContaining(selectedName),
  ])
  expect(buttonContaining(selectedName).getAttribute('aria-checked')).toBe('true')
}

describe('翻翻模式独立设置区', () => {
  it('展示六套审美主题、亮暗预览与四档标签', () => {
    const choices = paletteChoices()
    const group = container.querySelector('[role="radiogroup"]')
    expect(choices).toHaveLength(6)
    expect(group?.getAttribute('aria-label')).toBe('选择翻翻模式高亮主题')
    expect(choices.map((item) => item.querySelector('strong')?.textContent)).toEqual([
      '暖日麦田',
      '冰川蓝湾',
      '紫藤夜曲',
      '薄荷森林',
      '樱粉云霞',
      '雾灰书房',
    ])
    expect(container.querySelectorAll('.fanfan-preview-row[data-backdrop="light"]')).toHaveLength(6)
    expect(container.querySelectorAll('.fanfan-preview-row[data-backdrop="dark"]')).toHaveLength(6)
    expect(container.querySelector('.fanfan-level-legend')?.textContent).toContain('陌生')
    expect(container.querySelector('.fanfan-level-legend')?.textContent).toContain('已掌握')
    expectSingleTabStop('暖日麦田')
    expect(choices.slice(1).every((choice) => choice.tabIndex === -1)).toBe(true)
  })

  it('双列布局按视觉顺序响应方向键，循环切换并让焦点跟随', async () => {
    const warm = buttonContaining('暖日麦田')
    warm.focus()

    await press(warm, 'ArrowRight')
    expectSingleTabStop('冰川蓝湾')
    expect(document.activeElement).toBe(buttonContaining('冰川蓝湾'))

    await press(buttonContaining('冰川蓝湾'), 'ArrowDown')
    expectSingleTabStop('薄荷森林')
    expect(document.activeElement).toBe(buttonContaining('薄荷森林'))

    await press(buttonContaining('薄荷森林'), 'ArrowLeft')
    expectSingleTabStop('紫藤夜曲')
    expect(document.activeElement).toBe(buttonContaining('紫藤夜曲'))

    await press(buttonContaining('紫藤夜曲'), 'ArrowUp')
    expectSingleTabStop('暖日麦田')
    expect(document.activeElement).toBe(buttonContaining('暖日麦田'))

    await press(buttonContaining('暖日麦田'), 'ArrowLeft')
    expectSingleTabStop('雾灰书房')
    expect(document.activeElement).toBe(buttonContaining('雾灰书房'))
  })

  it('Home、End、空格和回车都保持 radio 选择语义', async () => {
    const warm = buttonContaining('暖日麦田')
    warm.focus()

    await press(warm, 'End')
    expectSingleTabStop('雾灰书房')
    expect(document.activeElement).toBe(buttonContaining('雾灰书房'))

    await press(buttonContaining('雾灰书房'), 'Home')
    expectSingleTabStop('暖日麦田')
    expect(document.activeElement).toBe(buttonContaining('暖日麦田'))

    const cherry = buttonContaining('樱粉云霞')
    cherry.focus()
    await press(cherry, ' ')
    expectSingleTabStop('樱粉云霞')

    const mist = buttonContaining('雾灰书房')
    mist.focus()
    await press(mist, 'Enter')
    expectSingleTabStop('雾灰书房')
  })

  it('窄屏单列布局中上下键移动到相邻主题并循环', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(max-width: 620px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    const warm = buttonContaining('暖日麦田')
    warm.focus()
    await press(warm, 'ArrowDown')
    expectSingleTabStop('冰川蓝湾')
    expect(document.activeElement).toBe(buttonContaining('冰川蓝湾'))

    await press(buttonContaining('冰川蓝湾'), 'ArrowUp')
    expectSingleTabStop('暖日麦田')

    await press(buttonContaining('暖日麦田'), 'ArrowUp')
    expectSingleTabStop('雾灰书房')
    expect(document.activeElement).toBe(buttonContaining('雾灰书房'))
  })

  it('选择主题、总开关和已掌握开关会立即更新设置状态', async () => {
    await act(async () => buttonContaining('薄荷森林').click())
    expect(buttonContaining('薄荷森林').getAttribute('aria-checked')).toBe('true')
    expect(buttonContaining('暖日麦田').getAttribute('aria-checked')).toBe('false')

    const mode = container.querySelector<HTMLButtonElement>('[aria-label="翻翻模式开关"]')!
    await act(async () => mode.click())
    expect(mode.getAttribute('aria-checked')).toBe('true')

    const mastered = container.querySelector<HTMLButtonElement>('[aria-label="标出已掌握的词"]')!
    await act(async () => mastered.click())
    expect(mastered.getAttribute('aria-checked')).toBe('false')
  })

  it('英文界面使用审美名称，不出现技术型命名', () => {
    act(() => setLanguage('en'))
    expect(container.textContent).toContain('Sunlit Wheatfield')
    expect(container.textContent).toContain('Glacier Bay')
    expect(container.textContent).toContain('Wisteria Nocturne')
    expect(container.textContent).toContain('Mint Forest')
    expect(container.textContent).toContain('Cherry Blush')
    expect(container.textContent).toContain('Misty Study')
    expect(container.textContent?.toLowerCase()).not.toContain('color-blind')
  })
})
