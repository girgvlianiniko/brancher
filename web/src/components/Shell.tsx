import { GitBranch, LayoutGrid, Moon, RefreshCw, Sun } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router'

import type { Colour } from '../../../shared/status'
import { useBoard, useRefreshBoard } from '../api'
import { cn } from './ui'
import { timeAgo } from '../lib/format'

type Theme = 'light' | 'dark'
const THEME_KEY = 'brancher.theme'

const readTheme = (): Theme => {
  try {
    // ?theme= wins over the stored choice, so a wall screen can be pinned from its URL.
    const forced = new URLSearchParams(window.location.search).get('theme')
    if (forced === 'light' || forced === 'dark') return forced
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage unavailable — the choice just will not survive a reload.
    }
  }, [theme])

  const dark = theme === 'dark'
  return (
    <button
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      className="grid size-9 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  )
}

const MARK: Record<Colour, string> = {
  green: 'bg-add',
  yellow: 'bg-warn',
  alert: 'bg-alert',
  red: 'bg-del',
  grey: 'bg-line-strong',
}

const worst = (colours: Colour[]): Colour =>
  colours.includes('red')
    ? 'red'
    : colours.includes('alert')
      ? 'alert'
      : colours.includes('yellow')
        ? 'yellow'
        : colours.includes('green')
          ? 'green'
          : 'grey'

const NAV = [
  { to: '/', label: 'Status', icon: LayoutGrid, match: (p: string) => p === '/' || p.startsWith('/c/') },
  { to: '/r', label: 'Repositories', icon: GitBranch, match: (p: string) => p.startsWith('/r') },
]

/**
 * One frame for every screen. The board, a client, the wizard and the repo tools all sit
 * inside it, so following a link never feels like leaving for a different program.
 */
export function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const board = useBoard()
  const refresh = useRefreshBoard()

  const mark = worst(
    (board.data?.rows ?? []).flatMap((row) => row.cells.filter((c) => c !== null).map((c) => c.colour)),
  )

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-sidebar lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-bold text-on-accent">
            B
          </span>
          <span className="text-[15px] font-bold tracking-tight">Brancher</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {NAV.map((item) => {
            const active = item.match(pathname)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-3 hover:bg-surface-2 hover:text-fg',
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2 px-2 pb-2 text-xs text-fg-3">
            <span className={cn('size-2 shrink-0 rounded-full', MARK[mark])} aria-hidden />
            <span className="truncate">
              {board.data ? `Checked ${timeAgo(board.data.generatedAt)}` : 'Starting up'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              title="Fetch and check everything now"
              aria-label="Check now"
              className="grid size-9 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              <RefreshCw className={cn('size-4', refresh.isPending && 'animate-spin')} />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex min-h-16 max-w-[84rem] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 lg:px-8">
            <div className="min-w-0 flex-1">
              {title && <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>}
              {subtitle && <p className="mt-0.5 truncate text-[13px] text-fg-3">{subtitle}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </div>

          <nav className="flex gap-1 border-t border-line px-4 pb-2 lg:hidden">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium',
                  item.match(pathname) ? 'bg-accent-soft text-accent' : 'text-fg-3',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[84rem] flex-1 px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
