import type { ReactNode } from 'react'
import { FAMILIARITY_LABELS, type FamiliarityLevel } from '@/types/vocabulary.ts'

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
  return <span className="spinner" role="status" aria-label="加载中" />
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
  return (
    <span className="chip">
      <span className="level-dot" style={{ background: levelColor(level) }} />
      {FAMILIARITY_LABELS[level]}
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
