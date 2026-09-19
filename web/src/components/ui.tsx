import { AlertTriangle, GitBranch, Globe, Loader2, Tag as TagIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import type { CommitRef } from '../../../shared/types'

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ')

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost'; size?: 'default' | 'icon' }) {
  return (
    <button
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors',
        size === 'icon' ? 'w-9' : 'px-3.5',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45',
        variant === 'default' && 'border border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
        variant === 'primary' && 'bg-fg text-bg hover:opacity-88',
        variant === 'ghost' && 'text-fg-3 hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...props}
    />
  )
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-surface', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] text-fg-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn('px-5 pb-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** A row of joined buttons picking one value. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
            option.value === value ? 'bg-surface-2 text-fg' : 'text-fg-3 hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-10 text-sm text-fg-3">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-del/35 bg-del-soft px-4 py-3 text-sm text-fg">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-del" aria-hidden />
      <span>{error instanceof Error ? error.message : 'Something went wrong'}</span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-8 text-center text-[13px] text-fg-3">{children}</p>
}

export function Sha({ sha, className }: { sha: string; className?: string }) {
  return (
    <code title={sha} className={cn('font-mono text-xs text-fg-2', className)}>
      {sha.slice(0, 7)}
    </code>
  )
}

const REF_STYLES: Record<CommitRef['kind'], string> = {
  head: 'border-accent bg-accent text-on-accent',
  local: 'border-accent/50 bg-accent-soft text-accent',
  remote: 'border-line-strong bg-surface-2 text-fg-2',
  tag: 'border-warn/50 bg-warn-soft text-warn',
}

export function RefBadge({ refName }: { refName: CommitRef }) {
  const Icon = refName.kind === 'tag' ? TagIcon : refName.kind === 'remote' ? Globe : GitBranch
  return (
    <span
      title={`${refName.kind === 'head' ? 'Checked out' : refName.kind} · ${refName.name}`}
      className={cn(
        'inline-flex max-w-44 shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[11px] leading-4 font-medium',
        REF_STYLES[refName.kind],
      )}
    >
      {refName.kind !== 'head' && <Icon className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{refName.name}</span>
    </span>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="label text-fg-3">{label}</div>
      <div className="figure mt-2 truncate text-[28px]">{value}</div>
      {hint && <div className="mt-1.5 truncate text-xs text-fg-3">{hint}</div>}
    </div>
  )
}
