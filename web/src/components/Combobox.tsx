import { Check, ChevronDown, Search } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from './ui'

export interface ComboOption {
  value: string
  label: string
  /** Shown on the right of the row: deploy state, age, whatever distinguishes it. */
  meta?: ReactNode
  /** Searched alongside the label. */
  keywords?: string
  selected?: boolean
}

/**
 * A picker with a search box. The monorepo has a hundred branches, and a native select
 * gives you no way to find one among them.
 */
export function Combobox({
  options,
  onSelect,
  placeholder = 'Search…',
  empty = 'Nothing matches',
  className,
}: {
  options: ComboOption[]
  onSelect: (value: string) => void
  placeholder?: string
  empty?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    field.current?.focus()
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(term),
    )
  }, [options, query])

  const choose = (value: string) => {
    onSelect(value)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/50 px-3 text-left text-sm text-fg-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
      >
        {placeholder}
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div className="glass absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-card">
          <label className="relative block border-b border-line">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <input
              ref={field}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((index) => Math.min(index + 1, matches.length - 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((index) => Math.max(index - 1, 0))
                }
                if (event.key === 'Enter' && matches[active]) {
                  event.preventDefault()
                  choose(matches[active].value)
                }
              }}
              placeholder="Type to filter…"
              aria-label="Filter options"
              className="h-9 w-full bg-transparent pr-3 pl-9 text-sm placeholder:text-fg-3 focus:outline-none"
            />
          </label>

          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {matches.length === 0 && <li className="px-3 py-3 text-center text-[13px] text-fg-3">{empty}</li>}
            {matches.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
                    index === active ? 'bg-surface-2' : '',
                  )}
                >
                  <Check
                    className={cn('size-3.5 shrink-0', option.selected ? 'text-accent' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{option.label}</span>
                  {option.meta && <span className="shrink-0 text-[11px] text-fg-3">{option.meta}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
