/**
 * Status board shapes. The board answers one question per cell: is this client's
 * environment working, and is anything waiting to ship into it.
 *
 * Config types are what lives in `server/data/clients.json` and what the wizard writes.
 * Derived types are recomputed by the engine and never stored in config.
 */

export type EnvKind = 'development' | 'staging' | 'production' | 'mirror'
export type ServiceKind = 'front' | 'admin' | 'api' | 'ws' | 'chat' | 'pay'
export type Colour = 'green' | 'yellow' | 'red' | 'grey'
export type ServiceStatus = 'up' | 'down' | 'unknown'
/** Whether a push to the environment's branch actually triggers a deploy. */
export type AutoDeploy = 'on' | 'off' | 'mixed' | 'unknown'

export const ENV_KINDS: EnvKind[] = ['development', 'staging', 'production', 'mirror']
export const SERVICE_KINDS: ServiceKind[] = ['front', 'admin', 'api', 'ws', 'chat', 'pay']

// ---------------------------------------------------------------- config

export interface Thresholds {
  /** Commits that change files, waiting to be promoted, before a cell turns yellow. */
  commits: number
  /** Age in days of the oldest waiting commit before a cell turns yellow. */
  days: number
}

export interface ProbeSettings {
  intervalSec: number
  timeoutMs: number
  /** Consecutive failures before a service is called down. Stops a blip flipping the wall screen. */
  failuresToRed: number
  /** Probed alongside the services; when it fails the whole pass is skipped. */
  controlUrl: string
}

export interface ServiceConfig {
  kind: ServiceKind
  url: string
  enabled: boolean
}

/** Branches in one repo that feed one environment. The most recently pushed one is primary. */
export interface RepoBinding {
  repoId: string
  branches: string[]
  /**
   * Which part of the product this repo builds. Lets the board say "the website is 60
   * changes behind" instead of only "this environment is behind". Guessed from the repo
   * name when it is not set.
   */
  role?: ServiceKind
}

export interface EnvironmentConfig {
  kind: EnvKind
  label: string
  /**
   * Environment this one is promoted from. Resolved against the same client first,
   * then against the shared development row.
   */
  feedsFrom: EnvKind | null
  services: ServiceConfig[]
  repos: RepoBinding[]
}

export interface ClientConfig {
  id: string
  name: string
  region: string
  thresholds?: Partial<Thresholds>
  /** Pinned clients are shown first, in their own section. */
  pinned?: boolean
  /**
   * A platform service rather than a client, like the payments gateway. Shown in its own
   * section above the clients, because nobody owns it and it serves all of them.
   */
  shared?: boolean
  environments: EnvironmentConfig[]
}

export interface BoardConfig {
  thresholds: Thresholds
  probe: ProbeSettings
  fetchIntervalSec: number
  /** The shared development environment every client's staging is measured against. */
  development: EnvironmentConfig
  clients: ClientConfig[]
}

// ---------------------------------------------------------------- derived

export interface ServiceState {
  /** Stable key: `<rowId>:<envKind>:<url>`. */
  ref: string
  kind: ServiceKind
  url: string
  status: ServiceStatus
  /** When the current status started. */
  since: string | null
  latencyMs: number | null
  httpStatus: number | null
  error: string | null
  consecutiveFailures: number
}

export interface LagEdge {
  repoId: string
  repoName: string
  /** The part of the product this repo builds, so lag can be attributed to it. */
  role: ServiceKind | null
  fromEnv: EnvKind
  toEnv: EnvKind
  fromBranch: string
  toBranch: string
  /** The ref that was actually measured, e.g. `origin/prod_korean`. Use it for links. */
  fromRef: string
  toRef: string
  /** Commits waiting that actually change files. Merge commits are noise. */
  realCommits: number
  mergeCommits: number
  filesChanged: number
  /** Author date of the oldest waiting commit. */
  oldestWaitingAt: string | null
  /** True when this edge alone is enough to turn the cell yellow. */
  overThreshold: boolean
  error: string | null
}

export interface DeployTrigger {
  repoId: string
  branch: string
  /** `push` fires on push, `manual` only by dispatch, `none` means the workflow watches a branch that does not exist. */
  mode: 'push' | 'manual' | 'none'
  workflowFile: string
}

export interface BranchTip {
  repoId: string
  repoName: string
  branch: string
  isPrimary: boolean
  sha: string | null
  subject: string | null
  author: string | null
  date: string | null
}

export interface CellStatus {
  ref: string
  envKind: EnvKind
  label: string
  /** Share of probes in the last day that answered, or `null` when nothing was probed. */
  uptime: number | null
  colour: Colour
  /** One word for the wall screen: Working, Behind, Down, Checking. */
  word: string
  /** One sentence under the word. Plain language, no shas or branch names. */
  sentence: string
  /** Last commit date of the primary branches, used as a stand-in for "deployed". */
  lastDeployedAt: string | null
  autoDeploy: AutoDeploy
  services: ServiceState[]
  lag: LagEdge[]
  tips: BranchTip[]
  triggers: DeployTrigger[]
}

export interface BoardRow {
  id: string
  name: string
  region: string
  kind: 'client' | 'shared'
  pinned: boolean
  /** Where the board serves this client's favicon from, or `null` when it has no site. */
  iconUrl: string | null
  /** Aligned with `BoardResponse.columns`; `null` where the client has no such environment. */
  cells: (CellStatus | null)[]
}

export interface BoardResponse {
  generatedAt: string
  columns: EnvKind[]
  rows: BoardRow[]
  /** Rows with at least one red or yellow cell. */
  needsAttention: number
  /** Uptime across every probe in the last day, 0 to 1, or null before any probe. */
  uptime: number | null
  /** False when this machine could not reach the control URL, so colours are being held. */
  probeHostReachable: boolean
  /** Set when no config file exists yet. */
  configured: boolean
}

export interface StatusChange {
  cellRef: string
  rowId: string
  rowName: string
  envKind: EnvKind
  from: Colour | null
  to: Colour
  word: string
  sentence: string
  at: string
}

export interface ProbeSample {
  at: string
  ok: boolean
  httpStatus: number | null
  latencyMs: number | null
  error: string | null
}

export interface ClientDetail {
  row: BoardRow
  changes: StatusChange[]
  history: Record<string, ProbeSample[]>
}

export interface ProbeResult {
  ok: boolean
  httpStatus: number | null
  latencyMs: number
  error: string | null
}
