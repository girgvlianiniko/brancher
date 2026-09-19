import { Cloud, FolderGit2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import type { RepoConfig } from '../../../shared/types'
import { useAddRepo, useFetchRepo, useHealth, useRemoveRepo, useRepos } from '../api'
import { Shell } from '../components/Shell'
import { Button, cn, Empty, ErrorBox, Segmented, Spinner } from '../components/ui'

const ACTIONS = [
  { tab: 'overview', label: 'Overview' },
  { tab: 'branches', label: 'Branches' },
  { tab: 'graph', label: 'Graph' },
  { tab: 'compare', label: 'Compare' },
] as const

function RepoCard({ repo, index }: { repo: RepoConfig; index: number }) {
  const remove = useRemoveRepo()
  const fetchRepo = useFetchRepo(repo.id)
  const Icon = repo.source === 'github' ? Cloud : FolderGit2

  return (
    <article
      className="rise glass flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-card px-4 py-3.5 transition-colors hover:border-line-strong"
      style={{ animationDelay: `${Math.min(index, 9) * 35}ms` }}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-3">
        <Icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-48 flex-1">
        <Link to={`/r/${repo.id}`} className="block truncate text-[15px] font-bold hover:text-accent">
          {repo.name}
        </Link>
        <p className="truncate font-mono text-xs text-fg-3">
          {repo.source === 'local' ? repo.path : `github.com/${repo.owner}/${repo.repo}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ACTIONS.map((action) => (
          <Link
            key={action.tab}
            to={`/r/${repo.id}/${action.tab}`}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:border-line-strong hover:text-fg"
          >
            {action.label}
          </Link>
        ))}

        <button
          onClick={() => fetchRepo.mutate()}
          disabled={fetchRepo.isPending}
          title={repo.source === 'local' ? 'git fetch --all --prune' : 'Reload from GitHub'}
          aria-label={`Fetch ${repo.name}`}
          className="ml-1 grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', fetchRepo.isPending && 'animate-spin')} />
        </button>
        <button
          onClick={() => {
            if (!confirm(`Remove ${repo.name} from Brancher? The repo itself is not touched.`)) return
            remove.mutate(repo.id)
          }}
          aria-label={`Remove ${repo.name}`}
          className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-del"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {fetchRepo.isError && (
        <p className="w-full text-xs text-del">{(fetchRepo.error as Error).message}</p>
      )}
    </article>
  )
}

function AddRepo() {
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
    <form onSubmit={submit} className="glass rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Add a repository</h2>
        <Segmented
          label="Repo source"
          value={source}
          onChange={(next) => {
            setSource(next)
            add.reset()
          }}
          options={[
            { value: 'local', label: 'Local folder' },
            { value: 'github', label: 'GitHub' },
          ]}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={source === 'local' ? '/path/to/repo' : 'owner/repo'}
          aria-label={source === 'local' ? 'Folder path' : 'GitHub owner/repo'}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface-2/50 px-3 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" disabled={add.isPending}>
          <Plus className="size-4" aria-hidden /> Add
        </Button>
      </div>
      {add.isError && <p className="mt-2 text-xs text-del">{add.error.message}</p>}
      {source === 'github' && health.data && !health.data.githubToken && (
        <p className="mt-2 text-xs text-fg-3">
          No GitHub token set: public repos only, 60 requests an hour, and no last-commit details.
        </p>
      )}
    </form>
  )
}

export function ReposPage() {
  const repos = useRepos()

  return (
    <Shell
      title="Repositories"
      subtitle={repos.data ? `${repos.data.length} tracked` : 'Loading'}
    >
      {repos.isPending ? (
        <Spinner />
      ) : repos.isError ? (
        <ErrorBox error={repos.error} />
      ) : (
        <div className="space-y-4">
          <AddRepo />
          {repos.data.length === 0 ? (
            <Empty>No repositories yet. Add a local folder above.</Empty>
          ) : (
            <div className="space-y-2.5">
              {repos.data.map((repo, i) => (
                <RepoCard key={repo.id} repo={repo} index={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </Shell>
  )
}
