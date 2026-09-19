import { Cloud, FolderGit2, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import type { RepoConfig } from '../../../shared/types'
import { useAddRepo, useHealth, useRemoveRepo, useRepos } from '../api'
import { Shell } from '../components/Shell'
import { Button, cn, Empty, ErrorBox, Segmented, Spinner } from '../components/ui'

function RepoCard({ repo, index }: { repo: RepoConfig; index: number }) {
  const remove = useRemoveRepo()
  const Icon = repo.source === 'github' ? Cloud : FolderGit2

  return (
    <article
      className="rise glass group relative flex items-start gap-3 rounded-lg border border-line bg-card p-4 transition-colors hover:border-line-strong"
      style={{ animationDelay: `${Math.min(index, 9) * 35}ms` }}
    >
      <Link to={`/r/${repo.id}`} className="absolute inset-0 rounded-lg" aria-label={`Open ${repo.name}`} />
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-3">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-bold tracking-tight">{repo.name}</h3>
        <p className="truncate font-mono text-xs text-fg-3">
          {repo.source === 'local' ? repo.path : `github.com/${repo.owner}/${repo.repo}`}
        </p>
      </div>
      <button
        onClick={() => {
          if (!confirm(`Remove ${repo.name} from Brancher? The repo itself is not touched.`)) return
          remove.mutate(repo.id)
        }}
        aria-label={`Remove ${repo.name}`}
        className="relative z-10 grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 opacity-0 transition hover:bg-surface-2 hover:text-del focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
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
            <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
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
