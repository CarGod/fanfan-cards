// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Select } from './index.tsx'

/**
 * 自己画的下拉，要自己把原生控件白给的东西补回来。
 *
 * 换掉 `<select>` 的理由是外观，但代价是行为：键盘操作、焦点回到触发器、
 * 点外面关掉、屏幕阅读器读得懂——原生控件一样不缺，自己写的每一样都可能缺。
 * 缺哪一样都会让这个组件不如它替换掉的那个，而外观上完全看不出来。
 */

/*
 * 告诉 React 这里是测试环境。
 *
 * 不设的话每个用例都会往 stderr 刷一条 "not configured to support act(...)"——
 * 测试照样过，但输出里从此常驻一片警告，而常驻的警告等于没有警告。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS = [
  { value: 'bilingual', label: '原文 + 译文' },
  { value: 'translationOnly', label: '仅译文' },
] as const

let container: HTMLDivElement
let root: Root
const onChange = vi.fn()

function render(value: string = 'bilingual'): void {
  act(() => {
    root.render(
      <Select
        value={value}
        options={OPTIONS as unknown as ReadonlyArray<{ value: string; label: string }>}
        onChange={onChange}
        label="整页翻译显示方式"
      />,
    )
  })
}

const trigger = () => container.querySelector<HTMLButtonElement>('.select-trigger')!
const list = () => container.querySelector<HTMLElement>('.select-list')
const optionButtons = () => [...container.querySelectorAll<HTMLElement>('.select-option')]

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

const press = (key: string) =>
  act(() => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })

beforeEach(() => {
  onChange.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('下拉：看得见的部分', () => {
  it('收起时显示当前选中项', () => {
    render('translationOnly')
    expect(trigger().textContent).toContain('仅译文')
    expect(list()).toBeNull()
  })

  it('点一下展开，再点一下收起', () => {
    render()
    click(trigger())
    expect(list()).not.toBeNull()
    click(trigger())
    expect(list()).toBeNull()
  })

  it('选中项在列表里标出来，供样式和读屏软件识别', () => {
    render('translationOnly')
    click(trigger())
    const selected = optionButtons().filter((item) => item.dataset['selected'] === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.textContent).toBe('仅译文')
  })
})

describe('下拉：选中', () => {
  it('点一项就回调并收起', () => {
    render()
    click(trigger())
    act(() => {
      optionButtons()[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('translationOnly')
    expect(list()).toBeNull()
  })

  /**
   * 用 mousedown 而不是 click 是有原因的：click 之前会先发生 blur，
   * 那一瞬间列表已经关了，点击就落空——表现成「点了没反应」。
   */
  it('mousedown 就生效，不等 click', () => {
    render()
    click(trigger())
    act(() => {
      optionButtons()[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('下拉：键盘', () => {
  it('收起时按下方向键或回车都能展开', () => {
    render()
    press('ArrowDown')
    expect(list()).not.toBeNull()
  })

  it('方向键移动高亮，回车选中', () => {
    render()
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(onChange).toHaveBeenCalledWith('translationOnly')
  })

  it('高亮到底会绕回第一项', () => {
    render()
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowDown')
    expect(optionButtons()[0]!.dataset['active']).toBe('true')
  })

  it('Escape 收起，并把焦点还给触发器', () => {
    render()
    press('ArrowDown')
    press('Escape')
    expect(list()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })
})

describe('下拉：点外面', () => {
  it('点页面上别处会收起', () => {
    render()
    click(trigger())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(list()).toBeNull()
  })

  it('点列表内部不会收起', () => {
    render()
    click(trigger())
    act(() => {
      list()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(list()).not.toBeNull()
  })
})

describe('下拉：往哪边弹', () => {
  /** jsdom 里所有元素都是零高零位置，所以得把「这个列表有多高」告诉它。 */
  const withLayout = (triggerBottom: number, listHeight: number) => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(listHeight)
    const element = container.querySelector<HTMLElement>('.select')!
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      bottom: triggerBottom,
    } as DOMRect)
  }

  afterEach(() => vi.restoreAllMocks())

  it('下面地方够就往下弹', () => {
    render()
    withLayout(100, 120)
    click(trigger())
    expect(list()!.dataset['drop']).toBe('down')
  })

  /** 弹窗只有六百多高，控件又在中间——往下不够是常态，不是边角情况。 */
  it('下面地方不够就往上弹', () => {
    render()
    withLayout(window.innerHeight - 40, 120)
    click(trigger())
    expect(list()!.dataset['drop']).toBe('up')
  })
})

describe('下拉：读屏软件读得懂', () => {
  it('触发器和列表都带着名字与状态', () => {
    render()
    expect(trigger().getAttribute('aria-label')).toBe('整页翻译显示方式')
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    click(trigger())
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(list()!.getAttribute('role')).toBe('listbox')
    expect(optionButtons()[0]!.getAttribute('role')).toBe('option')
    expect(optionButtons()[0]!.getAttribute('aria-selected')).toBe('true')
  })
})
