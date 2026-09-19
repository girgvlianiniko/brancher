import { ArrowLeft, Cloud, FolderGit2, RefreshCw } from 'lucide-react'
import { Link, NavLink, useParams } from 'react-router'

import { useFetchRepo, useRepos } from '../api'
import { Shell } from '../components/Shell'
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

  if (repos.isPending)
    return (
      <Shell title="Repository">
        <Spinner />
      </Shell>
    )
  if (repos.isError)
    return (
      <Shell title="Repository">
        <ErrorBox error={repos.error} />
      </Shell>
    )
  const repo = repos.data.find((r) => r.id === repoId)
  if (!repo)
    return (
      <Shell title="Repository">
        <Empty>That repo is not in the list anymore.</Empty>
      </Shell>
    )

  const Icon = repo.source === 'github' ? Cloud : FolderGit2

  return (
    <Shell
      title={
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-3">
            <Icon className="size-4" aria-hidden />
          </span>
          {repo.name}
        </span>
      }
      subtitle={repo.source === 'local' ? repo.path : `github.com/${repo.owner}/${repo.repo}`}
      actions={
        <Button
          onClick={() => fetchRepo.mutate()}
          disabled={fetchRepo.isPending}
          title={repo.source === 'local' ? 'git fetch --all --prune' : 'Reload from GitHub'}
        >
          <RefreshCw className={cn('size-4', fetchRepo.isPending && 'animate-spin')} aria-hidden />
          {repo.source === 'local' ? (fetchRepo.isPending ? 'Fetching…' : 'Fetch') : 'Refresh'}
        </Button>
      }
    >
      <Link to="/r" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> All repositories
      </Link>

      {fetchRepo.isError && (
        <div className="mb-4">
          <ErrorBox error={fetchRepo.error} />
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Repo sections">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/r/${repo.id}/${t.id}`}
            className={cn(
              '-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              tab === t.id ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg',
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
    </Shell>
  )
}
