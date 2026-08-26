import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  familiarityLabel,
  partOfSpeechLabel,
  type FamiliarityLevel,
  type WordSense,
} from '@/types/vocabulary.ts'
import { useI18n } from '@/i18n/react.ts'

/** Small presentational primitives shared by the popup, options and app pages. */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      className="toggle"
      data-on={checked}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 下拉选择。
 *
 * 为什么不用原生 `<select>`：它的下拉列表是**操作系统画的**，CSS 一个属性都碰不到。
 * 在 macOS 上那是一个带对勾的系统菜单，字体、圆角、配色全都和产品无关；
 * 深色模式下它甚至不跟着页面走。收起来的那个框可以美化，弹开的那一刻就露馅——
 * 而弹开正是读者盯着它看的那一刻。
 *
 * 换成自己画的，就得自己把原生控件白给的那些东西补回来：键盘操作、
 * 焦点管理、点外面关掉、屏幕阅读器能读懂。少补一样，这个组件就不如它替换掉的那个。
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T) => void
  /** 屏幕阅读器读到的名字。原生 select 有 aria-label，换掉之后得自己带上。 */
  label: string
  className?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** 往上弹还是往下弹。弹窗只有 328px 宽、六百多高，往下不够是常态而不是边角。 */
  const [drop, setDrop] = useState<'down' | 'up'>('down')
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.findIndex((option) => option.value === value)
  const current = options[selected] ?? options[0]

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false)
    // 用键盘关掉时把焦点还给触发器，否则 Tab 顺序会从头开始。
    if (focusTrigger) rootRef.current?.querySelector('button')?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // 捕获阶段：页面上任何一个先于我们处理点击的监听器，都不该把这个列表留在屏幕上。
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    setActive(selected < 0 ? 0 : selected)

    /*
     * 量一下下面还剩多少地方。
     *
     * 在渲染之后、浏览器绘制之前量（useLayoutEffect），所以读者不会看见列表
     * 先往下弹、再跳到上面去。
     */
    const trigger = rootRef.current?.getBoundingClientRect()
    const height = listRef.current?.offsetHeight ?? 0
    if (trigger && trigger.bottom + height + 8 > window.innerHeight) setDrop('up')
    else setDrop('down')
  }, [open, selected])

  const commit = (next: T): void => {
    onChange(next)
    close(true)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close(true)
        break
      case 'ArrowDown':
        event.preventDefault()
        setActive((index) => (index + 1) % options.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((index) => (index - 1 + options.length) % options.length)
        break
      case 'Home':
        event.preventDefault()
        setActive(0)
        break
      case 'End':
        event.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const option = options[active]
        if (option) commit(option.value)
        break
      }
    }
  }

  return (
    <div
      className={className ? `select ${className}` : 'select'}
      ref={rootRef}
      onKeyDown={onKeyDown}
      /*
       * 别让点击冒泡到外面的 <label>。
       *
       * `Field` 渲染的是 label，而 button 按规范属于「可被 label 关联的元素」——
       * 点在触发器上，label 有可能再把这次点击转发给它一次，开了又立刻关上，
       * 表现成「点了没反应」。这类问题只在某些浏览器上出现，最难查。
       */
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-open={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="select-value">{current?.label ?? ''}</span>
        <svg className="select-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          className="select-list"
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          data-drop={drop}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className="select-option"
              data-active={index === active}
              data-selected={option.value === value}
              // 用 mousedown 而不是 click：click 之前会先发生 blur，
              // 那一瞬间列表已经关了，点击就落空了。
              onMouseDown={(event) => {
                event.preventDefault()
                commit(option.value)
              }}
              onMouseEnter={() => setActive(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 按词性分行的释义。
 *
 * 拼成一行「形容词：独有的；名词：独家新闻」也读得懂，但分行之后眼睛不用自己
 * 找分号——而这正是把它存成结构化换来的东西：既然有结构，就该用上，
 * 而不是拼回一个字符串再让读者拆一遍。
 *
 * `senses` 为空时退回那一行 `meaning`：老词卡、离线词典、以及没按格式回话的模型
 * 都走这条路，它必须一直好用。
 */
export function SenseList({ senses, meaning }: { senses: readonly WordSense[]; meaning: string }) {
  // 订阅界面语言：词性译名是取用时才解析的，语言变了这里要跟着重画。
  useI18n()
  if (senses.length === 0) return <div className="body-text">{meaning}</div>

  return (
    <dl className="sense-list">
      {senses.map((sense) => (
        <div className="sense-row" key={`${sense.partOfSpeech}-${sense.meaning}`}>
          {sense.partOfSpeech ? (
            <dt className="sense-pos">{partOfSpeechLabel(sense.partOfSpeech)}</dt>
          ) : null}
          <dd className="sense-meaning">{sense.meaning}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Empty({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string
  title: string
  hint?: string | undefined
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      <div className="empty-title">{title}</div>
      {hint ? <div>{hint}</div> : null}
      {action}
    </div>
  )
}

export function Spinner() {
  const { t } = useI18n()
  return <span className="spinner" role="status" aria-label={t('common.loading')} />
}

const LEVEL_VARS: Record<FamiliarityLevel, string> = {
  0: 'var(--level-0)',
  1: 'var(--level-1)',
  2: 'var(--level-2)',
  3: 'var(--level-3)',
}

export function levelColor(level: FamiliarityLevel): string {
  return LEVEL_VARS[level]
}

export function LevelChip({ level }: { level: FamiliarityLevel }) {
  // useI18n 的返回值没用上，但订阅是必须的：语言变了这个组件才会重渲染，
  // 而 `familiarityLabel` 是个普通函数，它自己不会通知 React。
  useI18n()
  return (
    <span className="chip">
      <span className="level-dot" style={{ background: levelColor(level) }} />
      {familiarityLabel(level)}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function StatCard({
  label,
  value,
  foot,
}: {
  label: string
  value: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  )
}
