import { ArrowLeft, Check, Loader2, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import type { ClientConfig, EnvironmentConfig, EnvKind, ServiceConfig } from '../../../shared/status'
import {
  useClients,
  useDeleteClient,
  useDiscoveredBranches,
  useProbeUrl,
  useRepos,
  useSaveClient,
  useSuggestedServices,
} from '../api'
import { Shell } from '../components/Shell'
import { SERVICE_TAG } from '../components/StatusBits'
import { Button, Card, cn, Empty, ErrorBox, Spinner } from '../components/ui'
import { timeAgo } from '../lib/format'

/** Environments a client can own. Development is shared and never set up per client. */
const SETUP_KINDS: EnvKind[] = ['staging', 'production', 'mirror']
const LABEL: Record<EnvKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  mirror: 'Mirror',
}

interface EnvDraft {
  enabled: boolean
  domain: string
  services: ServiceConfig[]
  branches: Record<string, string[]>
}

interface Draft {
  id: string
  name: string
  region: string
  shared: boolean
  repoIds: string[]
  envs: Record<string, EnvDraft>
}

const emptyEnv = (): EnvDraft => ({ enabled: false, domain: '', services: [], branches: {} })

const blankDraft = (): Draft => ({
  id: '',
  name: '',
  region: '',
  shared: false,
  repoIds: [],
  envs: Object.fromEntries(SETUP_KINDS.map((kind) => [kind, emptyEnv()])),
})

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Each environment is promoted from the one before it that exists. */
function feedsFrom(kind: EnvKind, enabled: EnvKind[]): EnvKind | null {
  const chain: EnvKind[] = ['development', 'staging', 'production', 'mirror']
  for (let i = chain.indexOf(kind) - 1; i >= 0; i--) {
    if (chain[i] === 'development' || enabled.includes(chain[i])) return chain[i]
  }
  return null
}

function toClient(draft: Draft): ClientConfig {
  const enabled = SETUP_KINDS.filter((kind) => draft.envs[kind].enabled)
  return {
    id: draft.id,
    name: draft.name,
    region: draft.region,
    ...(draft.shared ? { shared: true } : {}),
    environments: enabled.map<EnvironmentConfig>((kind) => ({
      kind,
      label: LABEL[kind],
      feedsFrom: feedsFrom(kind, enabled),
      services: draft.envs[kind].services,
      repos: draft.repoIds
        .map((repoId) => ({ repoId, branches: draft.envs[kind].branches[repoId] ?? [] }))
        .filter((binding) => binding.branches.length > 0),
    })),
  }
}

function fromClient(client: ClientConfig): Draft {
  const repoIds = [...new Set(client.environments.flatMap((env) => env.repos.map((r) => r.repoId)))]
  const envs = Object.fromEntries(SETUP_KINDS.map((kind) => [kind, emptyEnv()]))
  for (const env of client.environments) {
    if (!SETUP_KINDS.includes(env.kind)) continue
    // The website has no subdomain, so its host is the site domain. Otherwise strip a
    // known service prefix rather than the first label, which would turn asdfbet.com into com.
    const front = env.services.find((service) => service.kind === 'front') ?? env.services[0]
    const host = front ? new URL(front.url).hostname.replace(/^(admin|api|ws|chat|pay)\./, '') : ''
    envs[env.kind] = {
      enabled: true,
      domain: host,
      services: env.services,
      branches: Object.fromEntries(env.repos.map((r) => [r.repoId, r.branches])),
    }
  }
  return {
    id: client.id,
    name: client.name,
    region: client.region,
    shared: client.shared === true,
    repoIds,
    envs,
  }
}

// ---------------------------------------------------------------- steps

const STEPS = ['Client', 'Repos', 'Environments', 'Branches', 'Addresses', 'Review'] as const

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-3">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface-2/50 px-3 text-sm placeholder:text-fg-3 focus:border-accent focus:outline-none'

const TRIGGER_NOTE: Record<string, { text: string; className: string }> = {
  push: { text: 'deploys on push', className: 'text-add' },
  manual: { text: 'deploys by hand', className: 'text-warn' },
  none: { text: 'no deploy found', className: 'text-fg-3' },
}

/** One address, with a live check so a typo shows up before saving. */
function ServiceLine({
  service,
  onChange,
}: {
  service: ServiceConfig
  onChange: (next: ServiceConfig) => void
}) {
  const check = useProbeUrl()
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={service.enabled}
          onChange={(e) => onChange({ ...service, enabled: e.target.checked })}
        />
        {SERVICE_TAG[service.kind]}
      </label>
      <input
        value={service.url}
        onChange={(e) => onChange({ ...service, url: e.target.value })}
        className={cn(inputClass, 'min-w-0 flex-1')}
        aria-label={`${service.kind} address`}
      />
      <Button onClick={() => check.mutate(service.url)} disabled={check.isPending} className="shrink-0">
        {check.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Check'}
      </Button>
      <span className="w-40 shrink-0 text-xs">
        {check.data ? (
          check.data.ok ? (
            <span className="text-add">answers in {check.data.latencyMs} ms</span>
          ) : (
            <span className="text-del">{check.data.error}</span>
          )
        ) : check.isError ? (
          <span className="text-del">{(check.error as Error).message}</span>
        ) : null}
      </span>
    </div>
  )
}

export function WizardPage() {
  const { clientId } = useParams()
  const editing = Boolean(clientId)
  const navigate = useNavigate()
  const clients = useClients()
  const repos = useRepos()
  const save = useSaveClient()
  const remove = useDeleteClient()

  // The step lives in the URL so a half-finished setup can be reopened where it was left.
  const [params, setParams] = useSearchParams()
  const step = Math.min(Math.max(Number(params.get('step')) || 0, 0), STEPS.length - 1)
  const setStep = (next: number) => setParams({ step: String(next) }, { replace: true })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [domainFor, setDomainFor] = useState<EnvKind | null>(null)

  const existing = clients.data?.find((candidate) => candidate.id === clientId)
  const current = draft ?? (existing ? fromClient(existing) : editing ? null : blankDraft())

  const branches = useDiscoveredBranches(current?.repoIds ?? [])
  const suggestions = useSuggestedServices(domainFor ? (current?.envs[domainFor].domain ?? '') : '')

  const enabledKinds = useMemo(
    () => SETUP_KINDS.filter((kind) => current?.envs[kind].enabled),
    [current],
  )

  if (clients.isPending || repos.isPending)
    return (
      <Shell title="Client setup">
        <Spinner label="Loading…" />
      </Shell>
    )
  if (!current)
    return (
      <Shell title="Client setup">
        <Empty>That client is not in the list.</Empty>
      </Shell>
    )

  const update = (patch: Partial<Draft>) => setDraft({ ...current, ...patch })
  const updateEnv = (kind: EnvKind, patch: Partial<EnvDraft>) =>
    setDraft({ ...current, envs: { ...current.envs, [kind]: { ...current.envs[kind], ...patch } } })

  const localRepos = (repos.data ?? []).filter((repo) => repo.source === 'local')
  const ready = current.id.trim() && current.name.trim() && enabledKinds.length > 0

  const applySuggestions = (kind: EnvKind) => {
    if (suggestions.data) updateEnv(kind, { services: suggestions.data })
  }

  return (
    <Shell
      title={editing ? `Edit ${current.name}` : 'Add a client'}
      subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
    >
      <div className="max-w-4xl space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back to status
      </Link>

      <nav className="flex flex-wrap gap-1 text-[13px]">
        {STEPS.map((name, i) => (
          <button
            key={name}
            onClick={() => setStep(i)}
            className={cn(
              'rounded-lg px-3 py-1.5 transition-colors',
              i === step ? 'bg-accent-soft font-medium text-accent' : 'text-fg-3 hover:bg-surface-2 hover:text-fg',
            )}
          >
            {i + 1}. {name}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <Card title="Who is this?">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <input
                value={current.name}
                onChange={(e) =>
                  update({ name: e.target.value, id: editing ? current.id : slugify(e.target.value) })
                }
                placeholder="Asdfbet"
                className={inputClass}
              />
            </Field>
            <Field label="Short id">
              <input
                value={current.id}
                onChange={(e) => update({ id: slugify(e.target.value) })}
                disabled={editing}
                placeholder="asdfbet"
                className={cn(inputClass, 'font-mono disabled:opacity-60')}
              />
            </Field>
            <Field label="Region">
              <input
                value={current.region}
                onChange={(e) => update({ region: e.target.value })}
                placeholder="Korea"
                className={inputClass}
              />
            </Field>
          </div>
          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={current.shared}
              onChange={(e) => update({ shared: e.target.checked })}
            />
            <span>
              This is a shared service, not a client
              <span className="mt-0.5 block text-xs text-fg-3">
                Payments, chat and anything else every client uses. Shown in its own section above the
                clients, and never pinned.
              </span>
            </span>
          </label>
        </Card>
      )}

      {step === 1 && (
        <Card title="Which repos make up this client?" subtitle="Only local clones can be measured">
          {localRepos.length === 0 ? (
            <Empty>No local repos yet. Add them from the repo tools first.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {localRepos.map((repo) => (
                <li key={repo.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={current.repoIds.includes(repo.id)}
                      onChange={(e) =>
                        update({
                          repoIds: e.target.checked
                            ? [...current.repoIds, repo.id]
                            : current.repoIds.filter((id) => id !== repo.id),
                        })
                      }
                    />
                    <span className="font-medium">{repo.name}</span>
                    <span className="truncate text-xs text-fg-3">{repo.path}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card
          title="Which environments does it have?"
          subtitle="Development is shared by everyone and is always measured"
        >
          <ul className="space-y-2">
            {SETUP_KINDS.map((kind) => (
              <li key={kind} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={current.envs[kind].enabled}
                  onChange={(e) => updateEnv(kind, { enabled: e.target.checked })}
                />
                <span className="w-24 font-medium">{LABEL[kind]}</span>
                {current.envs[kind].enabled && (
                  <span className="text-xs text-fg-3">
                    promoted from {LABEL[feedsFrom(kind, enabledKinds) ?? 'development'].toLowerCase()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {enabledKinds.length === 0 && <Empty>Pick at least one environment first.</Empty>}
          {branches.isPending && current.repoIds.length > 0 && <Spinner label="Reading branches…" />}
          {enabledKinds.map((kind) => (
            <Card key={kind} title={LABEL[kind]} subtitle="Pick the branch that lands here, per repo">
              <div className="space-y-3">
                {current.repoIds.map((repoId) => {
                  const list = branches.data?.[repoId] ?? []
                  const picked = current.envs[kind].branches[repoId] ?? []
                  return (
                    <div key={repoId}>
                      <div className="mb-1 text-xs font-medium text-fg-3">{repoId}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {picked.map((name) => (
                          <button
                            key={name}
                            onClick={() =>
                              updateEnv(kind, {
                                branches: {
                                  ...current.envs[kind].branches,
                                  [repoId]: picked.filter((b) => b !== name),
                                },
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent-soft px-2 py-1 font-mono text-xs text-accent"
                          >
                            {name} <X className="size-3" />
                          </button>
                        ))}
                      </div>
                      <select
                        value=""
                        onChange={(e) => {
                          if (!e.target.value) return
                          updateEnv(kind, {
                            branches: {
                              ...current.envs[kind].branches,
                              [repoId]: [...picked, e.target.value],
                            },
                          })
                        }}
                        className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-2/50 px-2.5 text-sm"
                      >
                        <option value="">Add a branch…</option>
                        {list
                          .filter((branch) => !picked.includes(branch.name))
                          .map((branch) => (
                            <option key={branch.name} value={branch.name}>
                              {branch.name} — {TRIGGER_NOTE[branch.trigger].text}, {timeAgo(branch.date)}
                            </option>
                          ))}
                      </select>
                      {picked.map((name) => {
                        const found = list.find((branch) => branch.name === name)
                        if (!found || found.trigger === 'push') return null
                        return (
                          <p key={name} className={cn('mt-1 text-xs', TRIGGER_NOTE[found.trigger].className)}>
                            {name}: {TRIGGER_NOTE[found.trigger].text}
                            {found.workflowFile && ` (${found.workflowFile})`}
                          </p>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          {enabledKinds.map((kind) => (
            <Card key={kind} title={LABEL[kind]}>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Field label="Site domain">
                    <input
                      value={current.envs[kind].domain}
                      onChange={(e) => updateEnv(kind, { domain: e.target.value })}
                      onFocus={() => setDomainFor(kind)}
                      placeholder="asdfbet.com"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDomainFor(kind)
                    applySuggestions(kind)
                  }}
                  disabled={!current.envs[kind].domain.trim() || domainFor !== kind || !suggestions.data}
                >
                  <Plus className="size-4" /> Propose addresses
                </Button>
              </div>
              <div className="mt-2 divide-y divide-line">
                {current.envs[kind].services.map((service, i) => (
                  <ServiceLine
                    key={`${service.kind}-${i}`}
                    service={service}
                    onChange={(next) =>
                      updateEnv(kind, {
                        services: current.envs[kind].services.map((s, j) => (j === i ? next : s)),
                      })
                    }
                  />
                ))}
              </div>
              {current.envs[kind].services.length === 0 && (
                <p className="mt-2 text-xs text-fg-3">
                  Type the domain, then press Propose addresses. Every field stays editable.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {step === 5 && (
        <Card title="Ready to save" subtitle="This writes server/data/clients.json">
          <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2/60 p-3 font-mono text-xs">
            {JSON.stringify(toClient(current), null, 2)}
          </pre>
          {save.isError && (
            <div className="mt-3">
              <ErrorBox error={save.error} />
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() =>
              save.mutate(toClient(current), { onSuccess: () => navigate(`/c/${current.id}`) })
            }
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save client
          </Button>
        )}
        {editing && (
          <Button
            className="ml-auto text-del"
            onClick={() => {
              if (!confirm(`Remove ${current.name} from the board? The repos are not touched.`)) return
              remove.mutate(current.id, { onSuccess: () => navigate('/') })
            }}
          >
            Remove client
          </Button>
        )}
      </div>
      </div>
    </Shell>
  )
}
