import { Cloud, FolderGit2, RefreshCw } from 'lucide-react'
import { NavLink, useParams } from 'react-router'

import { useFetchRepo, useRepos } from '../api'
import { Button, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { BranchesTab } from './BranchesTab'
import { CompareTab } from './CompareTab'
import { GraphTab } from './GraphTab'
import { OverviewTab } from './OverviewTab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'branches', label: 'Branches' },
  { id: 'graph', label: 'Graph' },
  { id: 'compare', label: 'Compare' },
] as const

export function RepoPage() {
  const { repoId = '', tab = 'overview' } = useParams()
  const repos = useRepos()
  const fetchRepo = useFetchRepo(repoId)

  if (repos.isPending) return <Spinner />
  if (repos.isError) return <div className="p-6"><ErrorBox error={repos.error} /></div>
  const repo = repos.data.find((r) => r.id === repoId)
  if (!repo) return <Empty>That repo isn't in the list anymore.</Empty>

  const Icon = repo.source === 'github' ? Cloud : FolderGit2
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon className="size-5 shrink-0 text-fg-3" aria-hidden />
            <span className="truncate">{repo.name}</span>
          </h1>
          <p className="mt-0.5 truncate text-xs text-fg-3">
            {repo.source === 'local' ? repo.path : `github.com/${repo.owner}/${repo.repo}`}
          </p>
        </div>
        <Button
          onClick={() => fetchRepo.mutate()}
          disabled={fetchRepo.isPending}
          title={repo.source === 'local' ? 'git fetch --all --prune' : 'Reload from GitHub'}
        >
          <RefreshCw className={cn('size-4', fetchRepo.isPending && 'animate-spin')} aria-hidden />
          {repo.source === 'local' ? (fetchRepo.isPending ? 'Fetching…' : 'Fetch') : 'Refresh'}
        </Button>
      </header>
      {fetchRepo.isError && <div className="mt-3"><ErrorBox error={fetchRepo.error} /></div>}

      <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Repo sections">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/r/${repo.id}/${t.id}`}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-2 hover:text-fg',
            )}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'branches' ? (
          <BranchesTab repo={repo} />
        ) : tab === 'graph' ? (
          <GraphTab repo={repo} />
        ) : tab === 'compare' ? (
          <CompareTab repo={repo} />
        ) : (
          <OverviewTab repo={repo} />
        )}
      </div>
    </div>
  )
}
