import { Check, Download, Loader2, Lock, Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useCloneRepo, useGitHubRepos, useRepos, useSaveGitHubToken, useSettings } from '../api'
import { Shell } from '../components/Shell'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { timeAgo } from '../lib/format'

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface-2/50 px-3 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none'

const SOURCE_NOTE = {
  environment: 'Set by the deployment. It cannot be changed from here.',
  saved: 'Saved on this server.',
  none: 'Not connected yet.',
} as const

function Connection() {
  const settings = useSettings()
  const save = useSaveGitHubToken()
  const [token, setToken] = useState('')

  const source = settings.data?.github.source ?? 'none'
  const fromEnvironment = source === 'environment'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (token.trim()) save.mutate(token.trim(), { onSuccess: () => setToken('') })
  }

  return (
    <Card
      title={
"GitHub"
      }
      subtitle="Needed to clone private repositories and to read them without a rate limit"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium',
            source === 'none' ? 'border-warn/40 text-warn' : 'border-add/40 text-add',
          )}
        >
          {source === 'none' ? <Lock className="size-3.5" /> : <Check className="size-3.5" />}
          {source === 'none' ? 'Not connected' : `Connected ${settings.data?.github.hint ?? ''}`}
        </span>
        <span className="text-[13px] text-fg-3">{SOURCE_NOTE[source]}</span>
      </div>

      {!fromEnvironment && (
        <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_… or github_pat_…"
            aria-label="GitHub token"
            autoComplete="off"
            className={cn(inputClass, 'min-w-64 flex-1')}
          />
          <Button type="submit" variant="primary" disabled={save.isPending || !token.trim()}>
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Connect
          </Button>
        </form>
      )}

      {save.isError && (
        <div className="mt-3">
          <ErrorBox error={save.error} />
        </div>
      )}
      {save.isSuccess && (
        <p className="mt-3 text-[13px] text-add">Connected as {save.data.account.login}.</p>
      )}

      <p className="mt-4 text-xs text-fg-3">
        A read-only token is enough. Fine-grained tokens need contents read access on the
        repositories you watch; a classic token needs the repo scope.
      </p>
    </Card>
  )
}

function Clone() {
  const settings = useSettings()
  const [query, setQuery] = useState('')
  const connected = (settings.data?.github.source ?? 'none') !== 'none'
  const repos = useGitHubRepos(query, connected)
  const clone = useCloneRepo()
  const [busy, setBusy] = useState<string | null>(null)

  if (!connected) {
    return (
      <Card title="Add repositories from GitHub">
        <Empty>Connect a token above and the repositories you can reach will appear here.</Empty>
      </Card>
    )
  }

  return (
    <Card
      title="Add repositories from GitHub"
      subtitle="Cloned onto this server, then watched like any other repository"
      action={
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            aria-label="Filter GitHub repositories"
            className="h-9 w-56 rounded-lg border border-line bg-surface-2/50 pr-3 pl-9 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
        </label>
      }
      bodyClassName="px-0 pb-0"
    >
      {repos.isPending ? (
        <Spinner label="Asking GitHub…" />
      ) : repos.isError ? (
        <div className="px-5 pb-5">
          <ErrorBox error={repos.error} />
        </div>
      ) : repos.data.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
          {repos.data.map((repo) => (
            <li key={repo.slug} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <div className="min-w-48 flex-1">
                <p className="truncate text-sm font-medium">
                  {repo.slug}
                  {repo.private && <span className="ml-2 text-[11px] text-fg-3">private</span>}
                </p>
                <p className="truncate text-xs text-fg-3">
                  {repo.description ?? 'No description'}
                  {repo.pushedAt && ` · pushed ${timeAgo(repo.pushedAt)}`}
                </p>
              </div>
              {repo.present ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-add">
                  <Check className="size-3.5" /> on this server
                </span>
              ) : (
                <Button
                  onClick={() => {
                    setBusy(repo.slug)
                    clone.mutate(repo.slug, { onSettled: () => setBusy(null) })
                  }}
                  disabled={busy !== null}
                >
                  {busy === repo.slug ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Clone
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {clone.isError && (
        <div className="px-5 py-4">
          <ErrorBox error={clone.error} />
        </div>
      )}
    </Card>
  )
}

export function SettingsPage() {
  const repos = useRepos()

  return (
    <Shell
      title="Settings"
      subtitle={repos.data ? `${repos.data.length} repositories on this server` : undefined}
    >
      <div className="max-w-3xl space-y-4">
        <Connection />
        <Clone />
      </div>
    </Shell>
  )
}
