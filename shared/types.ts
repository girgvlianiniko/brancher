/**
 * Shapes shared by the server (which produces them) and the web app (which draws them).
 * Every git source — a local clone or the GitHub API — answers in these shapes, so the
 * UI never needs to know where the data came from beyond `RepoConfig.source`.
 */

export type RepoSource = 'local' | 'github'

export interface LocalRepoConfig {
  id: string
  name: string
  source: 'local'
  /** Absolute path to the working tree. */
  path: string
}

export interface GitHubRepoConfig {
  id: string
  name: string
  source: 'github'
  owner: string
  repo: string
}

export type RepoConfig = LocalRepoConfig | GitHubRepoConfig

export type AddRepoInput =
  | { source: 'local'; path: string }
  /** `owner/repo` or a github.com URL. */
  | { source: 'github'; slug: string }

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

/** A name pointing at a commit, as shown next to it in the graph. */
export interface CommitRef {
  name: string
  kind: RefKind
}

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string | null
  /** ISO 8601 author date. */
  date: string
  subject: string
  refs: CommitRef[]
}

export interface Branch {
  name: string
  kind: 'local' | 'remote'
  sha: string
  /** `null` when the source can't tell cheaply (GitHub without a token). */
  subject: string | null
  author: string | null
  date: string | null
  isCurrent: boolean
  isDefault: boolean
  upstream: string | null
  upstreamAhead: number | null
  upstreamBehind: number | null
  /** The upstream is configured but no longer exists on the remote. */
  upstreamGone: boolean
  /** Commits this branch has that the default branch doesn't, and the other way round. */
  vsDefault: { ahead: number; behind: number } | null
}

export interface BranchesResponse {
  defaultBranch: string | null
  branches: Branch[]
}

export interface WorkingTreeStatus {
  staged: number
  modified: number
  untracked: number
  conflicted: number
}

export interface Tag {
  name: string
  sha: string
  date: string | null
  subject: string | null
}

export interface Contributor {
  name: string
  email: string | null
  commits: number
}

export interface ActivityWeek {
  /** `YYYY-MM-DD`, the first day of the week. */
  weekStart: string
  commits: number
}

export interface RepoOverview {
  currentBranch: string | null
  defaultBranch: string | null
  head: { sha: string; subject: string; date: string } | null
  remotes: { name: string; url: string }[]
  counts: {
    localBranches: number
    remoteBranches: number
    tags: number
    /** Commits reachable from HEAD; `null` when the source can't count them. */
    commits: number | null
    contributors: number
  }
  /** Counts that hit the source's page cap, so the real number may be higher. */
  capped: Partial<Record<'tags' | 'contributors' | 'branches', boolean>>
  /** `null` for sources without a working tree. */
  status: WorkingTreeStatus | null
  tags: Tag[]
  contributors: Contributor[]
  /** Oldest first. Empty while GitHub is still computing its statistics. */
  activity: ActivityWeek[]
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'other'

export interface FileChange {
  path: string
  oldPath: string | null
  status: FileChangeStatus
  /** `null` for binary files. */
  additions: number | null
  deletions: number | null
}

export interface Comparison {
  base: string
  head: string
  mergeBase: string | null
  /** Commits on head that base doesn't have. */
  ahead: number
  /** Commits on base that head doesn't have. */
  behind: number
  /** Newest first. */
  headOnly: Commit[]
  baseOnly: Commit[]
  /** Changes on head since the merge base. */
  files: FileChange[]
  commitsTruncated: boolean
  filesTruncated: boolean
}

/**
 * Which commits put `head` in front of `base` and which leave it behind. Only shas, so it
 * is cheap enough to overlay on a graph of any size.
 */
export interface BranchPosition {
  base: string
  head: string
  mergeBase: string | null
  /** Total commits on head that base doesn't have. */
  ahead: number
  /** Total commits on base that head doesn't have. */
  behind: number
  /** Newest first; may stop short of `ahead` on very long-lived branches. */
  aheadShas: string[]
  behindShas: string[]
}

export type GraphScope = 'all' | 'local'

export interface HealthResponse {
  ok: true
  githubToken: boolean
}
