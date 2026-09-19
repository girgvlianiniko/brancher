import type {
  BoardResponse,
  BoardRow,
  BranchTip,
  CellStatus,
  ClientDetail,
  Colour,
  DeployTrigger,
  EnvironmentConfig,
  EnvKind,
  LagEdge,
  ProbeSample,
  ServiceState,
  StatusChange,
} from '../../../shared/status'
import { ENV_KINDS } from '../../../shared/status'
import { notFound } from '../errors'
import { listRepos } from '../repos'
import { sourceFor } from '../sources'
import { getConfig, getRows, sourceOf, type Row } from './config'
import { lagBetween, loadTips, type RefTip } from './lag'
import { pooled, probe } from './probe'
import { edgeOverThreshold, verdict } from './rules'
import {
  changesFor,
  historyFor,
  loadServiceStates,
  pruneOldSamples,
  recentChanges,
  recordChange,
  recordProbe,
  saveServiceState,
  uptimeFor,
} from './store'
import { readTriggers } from './triggers'

/** Branch tips per repo id, refreshed after every fetch. */
const tipsByRepo = new Map<string, Map<string, RefTip & { ref: string }>>()
const lagByCell = new Map<string, LagEdge[]>()
const triggersByRepo = new Map<string, DeployTrigger[]>()

interface ServiceRuntime {
  status: ServiceState['status']
  since: string | null
  consecutiveFailures: number
  latencyMs: number | null
  httpStatus: number | null
  error: string | null
}

const runtime = new Map<string, ServiceRuntime>()
for (const [ref, stored] of loadServiceStates()) {
  runtime.set(ref, { ...stored, latencyMs: null, httpStatus: null, error: null })
}

const lastColour = new Map<string, Colour>()
/**
 * Colour changes are only worth recording once both halves of the picture exist. Before
 * that, a cell with no lag data yet would read green and then "change" to yellow, which
 * is noise in the history and would be a false alert once alerting is wired up.
 */
let lagPasses = 0
let probePasses = 0
const warmedUp = () => lagPasses > 0 && probePasses > 0
let probeHostReachable = true
let generatedAt = new Date().toISOString()

export const cellRef = (rowId: string, envKind: EnvKind) => `${rowId}:${envKind}`
export const serviceRef = (rowId: string, envKind: EnvKind, url: string) => `${rowId}:${envKind}:${url}`

const repoName = (repoId: string) => listRepos().find((repo) => repo.id === repoId)?.name ?? repoId
const localRepo = (repoId: string) => {
  const repo = listRepos().find((candidate) => candidate.id === repoId)
  return repo && repo.source === 'local' ? repo : null
}

// ------------------------------------------------------------- building

/** Tips for one environment's branches, with the most recently pushed marked primary. */
function tipsFor(env: EnvironmentConfig): BranchTip[] {
  const tips: BranchTip[] = []
  for (const binding of env.repos) {
    const known = tipsByRepo.get(binding.repoId)
    const rows = binding.branches.map<BranchTip>((branch) => {
      const tip = known?.get(branch)
      return {
        repoId: binding.repoId,
        repoName: repoName(binding.repoId),
        branch,
        isPrimary: false,
        sha: tip?.sha ?? null,
        subject: tip?.subject ?? null,
        author: tip?.author ?? null,
        date: tip?.date ?? null,
      }
    })
    const newest = rows.filter((row) => row.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).pop()
    if (newest) newest.isPrimary = true
    else if (rows[0]) rows[0].isPrimary = true
    tips.push(...rows)
  }
  return tips
}

const primaryBranch = (tips: BranchTip[], repoId: string) =>
  tips.find((tip) => tip.repoId === repoId && tip.isPrimary) ?? null

function triggersFor(env: EnvironmentConfig): DeployTrigger[] {
  const branches = new Set(env.repos.flatMap((binding) => binding.branches))
  return env.repos
    .flatMap((binding) => triggersByRepo.get(binding.repoId) ?? [])
    .filter((trigger) => branches.has(trigger.branch))
}

function buildCell(row: Row, env: EnvironmentConfig): CellStatus {
  const ref = cellRef(row.id, env.kind)
  const services = env.services
    .filter((service) => service.enabled)
    .map<ServiceState>((service) => {
      const key = serviceRef(row.id, env.kind, service.url)
      const state = runtime.get(key)
      return {
        ref: key,
        kind: service.kind,
        url: service.url,
        status: state?.status ?? 'unknown',
        since: state?.since ?? null,
        latencyMs: state?.latencyMs ?? null,
        httpStatus: state?.httpStatus ?? null,
        error: state?.error ?? null,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
      }
    })

  const tips = tipsFor(env)
  const lag = lagByCell.get(ref) ?? []
  const triggers = triggersFor(env)
  const source = sourceOf(row, env)
  const decision = verdict({
    services,
    lag,
    tips,
    triggers,
    thresholds: row.thresholds,
    sourceLabel: source?.label ?? null,
  })

  return {
    ref,
    envKind: env.kind,
    label: env.label,
    uptime: uptimeFor(services.map((service) => service.ref), 24),
    ...decision,
    services,
    lag,
    tips,
    triggers,
  }
}

function buildRow(row: Row): BoardRow {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    kind: row.kind,
    pinned: row.pinned,
    cells: ENV_KINDS.map((kind) => {
      const env = row.environments.find((candidate) => candidate.kind === kind)
      return env ? buildCell(row, env) : null
    }),
  }
}

/** Recomputes every cell and records any colour that changed since the last pass. */
function rebuild(): BoardResponse {
  const rows = getRows().map(buildRow)
  const at = new Date().toISOString()

  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell) continue
      const previous = lastColour.get(cell.ref)
      if (previous === cell.colour) continue
      lastColour.set(cell.ref, cell.colour)
      // The first pass after a restart is a baseline, not a transition worth alerting on.
      if (previous === undefined || !warmedUp()) continue
      const change: StatusChange = {
        cellRef: cell.ref,
        rowId: row.id,
        rowName: row.name,
        envKind: cell.envKind,
        from: previous,
        to: cell.colour,
        word: cell.word,
        sentence: cell.sentence,
        at,
      }
      recordChange(change)
    }
  }

  generatedAt = at
  return {
    generatedAt: at,
    columns: ENV_KINDS,
    rows,
    needsAttention: rows.filter((row) =>
      row.cells.some((cell) => cell?.colour === 'red' || cell?.colour === 'yellow'),
    ).length,
    uptime: uptimeFor(
      rows.flatMap((row) => row.cells.flatMap((cell) => cell?.services.map((s) => s.ref) ?? [])),
      24,
    ),
    probeHostReachable,
    configured: getConfig() !== null,
  }
}

export function getBoard(): BoardResponse {
  return rebuild()
}

export function getClientDetail(id: string, hours = 24): ClientDetail {
  const row = getRows().find((candidate) => candidate.id === id)
  if (!row) throw notFound(`No client with id "${id}"`)
  const built = buildRow(row)
  const history: Record<string, ProbeSample[]> = {}
  for (const cell of built.cells) {
    for (const service of cell?.services ?? []) history[service.ref] = historyFor(service.ref, hours)
  }
  return { row: built, changes: changesFor(id), history }
}

export const getRecentChanges = (limit = 50) => recentChanges(limit)

// ------------------------------------------------------------- work

/** Every repo id referenced by any environment, in config order. */
function usedRepoIds(): string[] {
  const ids = new Set<string>()
  for (const row of getRows()) {
    for (const env of row.environments) for (const binding of env.repos) ids.add(binding.repoId)
  }
  return [...ids]
}

async function refreshTips() {
  await pooled(
    usedRepoIds().map((repoId) => async () => {
      const repo = localRepo(repoId)
      if (!repo) return
      tipsByRepo.set(repoId, await loadTips(repo.path))
    }),
    4,
  )
}

async function refreshLag() {
  const jobs: (() => Promise<void>)[] = []
  const next = new Map<string, LagEdge[]>()

  for (const row of getRows()) {
    for (const env of row.environments) {
      const source = sourceOf(row, env)
      const ref = cellRef(row.id, env.kind)
      if (!source) {
        next.set(ref, [])
        continue
      }
      const edges: LagEdge[] = []
      next.set(ref, edges)
      const targetTips = tipsFor(env)
      const sourceTips = tipsFor(source)

      for (const binding of env.repos) {
        // Nothing to measure when the source environment does not use this repo at all,
        // as with agentpay, which is not part of the shared development row.
        if (!source.repos.some((candidate) => candidate.repoId === binding.repoId)) continue
        const to = primaryBranch(targetTips, binding.repoId)
        const from = primaryBranch(sourceTips, binding.repoId)
        const repo = localRepo(binding.repoId)
        const base: LagEdge = {
          repoId: binding.repoId,
          repoName: repoName(binding.repoId),
          role: binding.role ?? null,
          fromEnv: source.kind,
          toEnv: env.kind,
          fromBranch: from?.branch ?? '',
          toBranch: to?.branch ?? '',
          fromRef: '',
          toRef: '',
          realCommits: 0,
          mergeCommits: 0,
          filesChanged: 0,
          oldestWaitingAt: null,
          overThreshold: false,
          error: null,
        }
        const index = edges.push(base) - 1

        if (!repo) {
          edges[index].error = `Repo "${binding.repoId}" is not in Brancher's list`
          continue
        }
        if (!from || !to || !from.sha || !to.sha) {
          const missing = !from?.sha ? from?.branch : to?.branch
          edges[index].error = missing ? `Branch "${missing}" not found` : 'Branch not found'
          continue
        }
        const known = tipsByRepo.get(binding.repoId)
        const fromRef = known?.get(from.branch)?.ref ?? from.branch
        const toRef = known?.get(to.branch)?.ref ?? to.branch
        edges[index].fromRef = fromRef
        edges[index].toRef = toRef
        jobs.push(async () => {
          try {
            const numbers = await lagBetween(repo.path, fromRef, toRef)
            Object.assign(edges[index], numbers)
            edges[index].overThreshold = edgeOverThreshold(edges[index], row.thresholds)
          } catch (error) {
            edges[index].error = error instanceof Error ? error.message : 'Comparison failed'
          }
        })
      }
    }
  }

  await pooled(jobs, 6)
  lagByCell.clear()
  for (const [ref, edges] of next) lagByCell.set(ref, edges)
  lagPasses++
}

async function refreshTriggers() {
  for (const repoId of usedRepoIds()) {
    const repo = localRepo(repoId)
    if (!repo) continue
    const known = tipsByRepo.get(repoId)
    triggersByRepo.set(repoId, await readTriggers(repoId, repo.path, new Set(known?.keys() ?? [])))
  }
}

async function fetchRepos() {
  await pooled(
    usedRepoIds().map((repoId) => async () => {
      const repo = localRepo(repoId)
      if (!repo) return
      const source = sourceFor(repo)
      try {
        await source.fetch?.()
      } catch (error) {
        console.error(`fetch ${repoId}: ${error instanceof Error ? error.message : error}`)
      }
    }),
    3,
  )
}

async function runProbes() {
  const config = getConfig()
  if (!config) return

  const control = await probe(config.probe.controlUrl, config.probe.timeoutMs)
  probeHostReachable = control.ok
  if (!control.ok) {
    // This machine cannot reach the internet. Hold every colour rather than paint the
    // wall screen red over a local network problem.
    return
  }

  const targets: { ref: string; url: string }[] = []
  for (const row of getRows()) {
    for (const env of row.environments) {
      for (const service of env.services) {
        if (!service.enabled) continue
        targets.push({ ref: serviceRef(row.id, env.kind, service.url), url: service.url })
      }
    }
  }

  const at = new Date().toISOString()
  await pooled(
    targets.map((target) => async () => {
      const result = await probe(target.url, config.probe.timeoutMs)
      recordProbe(target.ref, {
        at,
        ok: result.ok,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        error: result.error,
      })

      const previous = runtime.get(target.ref)
      const failures = result.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1
      let status: ServiceState['status'] = previous?.status ?? 'unknown'
      if (result.ok) status = 'up'
      else if (failures >= config.probe.failuresToRed) status = 'down'

      const changed = status !== previous?.status
      const state: ServiceRuntime = {
        status,
        since: changed || !previous?.since ? at : previous.since,
        consecutiveFailures: failures,
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
        error: result.error,
      }
      runtime.set(target.ref, state)
      saveServiceState(target.ref, {
        status,
        since: state.since ?? at,
        consecutiveFailures: failures,
      })
    }),
    8,
  )
  probePasses++
}

// ------------------------------------------------------------- loops

let timers: NodeJS.Timeout[] = []
let running = false

/** Runs `job` on `everyMs`, never letting two runs overlap. */
function loop(everyMs: number, job: () => Promise<void>, label: string) {
  let busy = false
  const tick = async () => {
    if (busy || !running) return
    busy = true
    try {
      await job()
    } catch (error) {
      console.error(`${label}: ${error instanceof Error ? error.message : error}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(tick, everyMs)
  timer.unref()
  timers.push(timer)
  void tick()
}

/** Reads git and probes once, without waiting for the next tick. */
export async function refreshNow() {
  await refreshTips()
  await Promise.all([refreshLag(), refreshTriggers()])
  await runProbes()
}

export function startEngine() {
  const config = getConfig()
  if (!config) {
    console.log('status board: no server/data/clients.json yet, board is empty')
    return
  }
  running = true

  loop(
    config.fetchIntervalSec * 1000,
    async () => {
      await fetchRepos()
      await refreshTips()
      await Promise.all([refreshLag(), refreshTriggers()])
    },
    'fetch',
  )
  loop(config.probe.intervalSec * 1000, runProbes, 'probe')
  loop(24 * 3600_000, async () => pruneOldSamples(), 'prune')

  console.log(
    `status board: ${config.clients.length} clients, probing every ${config.probe.intervalSec}s, fetching every ${config.fetchIntervalSec}s`,
  )
}

export function stopEngine() {
  running = false
  for (const timer of timers) clearInterval(timer)
  timers = []
}

export const lastGeneratedAt = () => generatedAt
