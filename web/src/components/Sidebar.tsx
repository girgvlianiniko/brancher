import { Cloud, FolderGit2, Monitor, Moon, Plus, Sun, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'

import type { RepoConfig } from '../../../shared/types'
import { useAddRepo, useHealth, useRemoveRepo, useRepos } from '../api'
import { Button, cn, Segmented } from './ui'

type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'brancher.theme'

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Storage unavailable — the choice just won't survive a reload.
    }
  }, [theme])

  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next[theme])}
      title={`Theme: ${theme} (click to switch)`}
      aria-label={`Theme: ${theme}`}
    >
      <Icon className="size-4" />
    </Button>
  )
}

function RepoLink({ repo }: { repo: RepoConfig }) {
  const remove = useRemoveRepo()
  const navigate = useNavigate()
  const Icon = repo.source === 'github' ? Cloud : FolderGit2

  return (
    <div className="group relative">
      <NavLink
        to={`/r/${repo.id}`}
        title={repo.source === 'local' ? repo.path : `github.com/${repo.name}`}
        className={({ isActive }) =>
          cn(
            'flex h-8 items-center gap-2 rounded-md pr-8 pl-2 text-sm',
            isActive ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
          )
        }
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{repo.name}</span>
      </NavLink>
      <button
        onClick={() => {
          if (!confirm(`Remove ${repo.name} from Brancher? The repo itself is not touched.`)) return
          remove.mutate(repo.id, { onSuccess: () => navigate('/') })
        }}
        className="absolute top-1 right-1 hidden size-6 items-center justify-center rounded text-fg-3 group-hover:flex hover:bg-surface hover:text-del focus-visible:flex"
        aria-label={`Remove ${repo.name}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function AddRepoForm() {
  const [source, setSource] = useState<'local' | 'github'>('local')
  const [value, setValue] = useState('')
  const add = useAddRepo()
  const health = useHealth()
  const navigate = useNavigate()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    add.mutate(source === 'local' ? { source, path: value } : { source, slug: value }, {
      onSuccess: (repo) => {
        setValue('')
        navigate(`/r/${repo.id}`)
      },
    })
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-3">Add repo</span>
        <Segmented
          label="Repo source"
          value={source}
          onChange={(s) => {
            setSource(s)
            add.reset()
          }}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'github', label: 'GitHub' },
          ]}
        />
      </div>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={source === 'local' ? 'C:\\path\\to\\repo' : 'owner/repo'}
          aria-label={source === 'local' ? 'Folder path' : 'GitHub owner/repo'}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" size="icon" disabled={add.isPending} aria-label="Add">
          <Plus className="size-4" />
        </Button>
      </div>
      {add.isError && <p className="text-xs text-del">{add.error.message}</p>}
      {source === 'github' && health.data && !health.data.githubToken && (
        <p className="text-xs text-fg-3">
          No GITHUB_TOKEN set: public repos only, 60 requests/hour, and no last-commit details on branches.
        </p>
      )}
    </form>
  )
}

export function Sidebar() {
  const repos = useRepos()
  const local = repos.data?.filter((r) => r.source === 'local') ?? []
  const github = repos.data?.filter((r) => r.source === 'github') ?? []

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:w-64 md:border-r md:border-b-0">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="flex items-center gap-2 font-semibold">
          <span aria-hidden>🌿</span> Brancher
        </span>
        <ThemeToggle />
      </div>
      <nav className="max-h-48 space-y-3 overflow-y-auto px-2 pb-3 md:max-h-none md:flex-1" aria-label="Repos">
        {repos.isError && <p className="px-2 text-xs text-del">API not reachable. Is the server running?</p>}
        {[
          { label: 'Local', items: local },
          { label: 'GitHub', items: github },
        ].map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.label}>
                <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">
                  {group.label}
                </div>
                {group.items.map((repo) => (
                  <RepoLink key={repo.id} repo={repo} />
                ))}
              </div>
            ),
        )}
      </nav>
      <AddRepoForm />
    </aside>
  )
}
