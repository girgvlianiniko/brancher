import type {
  ActivityWeek,
  Branch,
  BranchesResponse,
  BranchPosition,
  Comparison,
  Commit,
  CommitRef,
  FileChange,
  FileChangeStatus,
  GitHubRepoConfig,
  RepoOverview,
} from '../../../shared/types'
import { cached } from '../cache'
import { HttpError } from '../errors'
import type { GitSource } from './types'

const API = 'https://api.github.com'
const TTL_MS = 60_000
/** Branch lists stop after this many pages of 100. */
const MAX_BRANCH_PAGES = 3
/** The graph follows the default branch plus this many recently updated others. */
const GRAPH_BRANCHES = 10

interface GhUser {
  login: string
}
interface GhCommitItem {
  sha: string
  parents: { sha: string }[]
  commit: { message: string; author: { name: string; email: string; date: string } | null }
  author: GhUser | null
}
interface GhRepo {
  default_branch: string
  html_url: string
}
interface GhCompare {
  ahead_by: number
  behind_by: number
  merge_base_commit: { sha: string } | null
  commits: GhCommitItem[]
  files?: {
    filename: string
    previous_filename?: string
    status: string
    additions: number
    deletions: number
    patch?: string
  }[]
}

const token = () => process.env.GITHUB_TOKEN?.trim() || null

/** Branch names keep their slashes in URL paths; everything else is encoded. */
const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

const firstLine = (message: string) => message.split('\n', 1)[0]

const FILE_STATUS: Record<string, FileChangeStatus> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  changed: 'modified',
  renamed: 'renamed',
  copied: 'copied',
}

function toCommit(item: GhCommitItem, refs: CommitRef[] = []): Commit {
  return {
    sha: item.sha,
    parents: item.parents.map((p) => p.sha),
    author: item.commit.author?.name ?? item.author?.login ?? 'unknown',
    email: item.commit.author?.email ?? null,
    date: item.commit.author?.date ?? '',
    subject: firstLine(item.commit.message),
    refs,
  }
}

/**
 * Commits gathered from several branch listings arrive in no single order. Emit newest
 * first, but only once every child in the set has been emitted, so the graph layout can
 * rely on children preceding parents just as `git log --topo-order` guarantees locally.
 */
function childrenFirst(commits: Commit[]): Commit[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const waitingOn = new Map<string, number>()
  for (const commit of commits) {
    for (const parent of commit.parents) {
      if (bySha.has(parent)) waitingOn.set(parent, (waitingOn.get(parent) ?? 0) + 1)
    }
  }
  const ready = commits.filter((c) => !waitingOn.get(c.sha))
  const ordered: Commit[] = []
  while (ready.length) {
    ready.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    const next = ready.shift()!
    ordered.push(next)
    for (const parent of next.parents) {
      const remaining = (waitingOn.get(parent) ?? 0) - 1
      waitingOn.set(parent, remaining)
      if (remaining === 0 && bySha.has(parent)) ready.push(bySha.get(parent)!)
    }
  }
  return ordered
}

export class GitHubSource implements GitSource {
  constructor(private readonly repo: GitHubRepoConfig) {}

  private get base() {
    return `/repos/${this.repo.owner}/${this.repo.repo}`
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'brancher',
    }
    const auth = token()
    if (auth) headers.Authorization = `Bearer ${auth}`
    const response = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    })
    if (response.ok) return response

    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new HttpError(429, auth ? 'GitHub rate limit reached, try again later' : 'GitHub rate limit reached. Add a GITHUB_TOKEN to brancher/.env for 5,000 requests an hour')
    }
    if (response.status === 404) {
      throw new HttpError(404, auth ? `Not found on GitHub: ${url}` : 'Not found on GitHub. If the repo is private, add a GITHUB_TOKEN to brancher/.env')
    }
    throw new HttpError(502, `GitHub: ${body?.message ?? response.statusText}`)
  }

  private get<T>(url: string): Promise<T> {
    return cached(`gh:${this.repo.id}:${url}`, TTL_MS, async () => (await this.request(url)).json() as Promise<T>)
  }

  private info() {
    return this.get<GhRepo>(this.base)
  }

  async overview(): Promise<RepoOverview> {
    const info = await this.info()
    const [{ branches }, tags, contributors, activity, head] = await Promise.all([
      this.branches(),
      this.get<{ name: string; commit: { sha: string } }[]>(`${this.base}/tags?per_page=100`),
      this.get<{ login?: string; name?: string; contributions: number }[] | ''>(`${this.base}/contributors?per_page=100`).catch(() => []),
      this.activity(),
      this.get<GhCommitItem>(`${this.base}/commits/${encodeRef(info.default_branch)}`).catch(() => null),
    ])
    const contributorList = Array.isArray(contributors) ? contributors : []

    return {
      currentBranch: info.default_branch,
      defaultBranch: info.default_branch,
      head: head ? { sha: head.sha, subject: firstLine(head.commit.message), date: head.commit.author?.date ?? '' } : null,
      remotes: [{ name: 'github', url: info.html_url }],
      counts: {
        localBranches: branches.length,
        remoteBranches: 0,
        tags: tags.length,
        commits: null,
        contributors: contributorList.length,
      },
      capped: {
        tags: tags.length === 100,
        contributors: contributorList.length === 100,
        branches: branches.length === MAX_BRANCH_PAGES * 100,
      },
      status: null,
      tags: tags.slice(0, 15).map((t) => ({ name: t.name, sha: t.commit.sha, date: null, subject: null })),
      contributors: contributorList.slice(0, 15).map((c) => ({
        name: c.login ?? c.name ?? 'anonymous',
        email: null,
        commits: c.contributions,
      })),
      activity,
    }
  }

  /** GitHub answers 202 with no body while it computes the stats for the first time. */
  private async activity(): Promise<ActivityWeek[]> {
    return cached(`gh:${this.repo.id}:activity`, TTL_MS, async () => {
      const response = await this.request(`${this.base}/stats/commit_activity`)
      if (response.status !== 200) return []
      const weeks = (await response.json()) as { week: number; total: number }[]
      return weeks.map((w) => ({ weekStart: new Date(w.week * 1000).toISOString().slice(0, 10), commits: w.total }))
    }).catch(() => [])
  }

  async branches(): Promise<BranchesResponse> {
    const info = await this.info()
    const defaultBranch = info.default_branch
    const branches = token() ? await this.branchesGraphQL(defaultBranch) : await this.branchesRest(defaultBranch)
    branches.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return { defaultBranch, branches }
  }

  /** Without a token only names and tip shas are cheap to get. */
  private async branchesRest(defaultBranch: string): Promise<Branch[]> {
    const branches: Branch[] = []
    for (let page = 1; page <= MAX_BRANCH_PAGES; page++) {
      const items = await this.get<{ name: string; commit: { sha: string } }[]>(`${this.base}/branches?per_page=100&page=${page}`)
      for (const item of items) branches.push(this.branch(item.name, item.commit.sha, defaultBranch))
      if (items.length < 100) break
    }
    return branches
  }

  private branch(name: string, sha: string, defaultBranch: string): Branch {
    return {
      name,
      kind: 'local',
      sha,
      subject: null,
      author: null,
      date: null,
      isCurrent: false,
      isDefault: name === defaultBranch,
      upstream: null,
      upstreamAhead: null,
      upstreamBehind: null,
      upstreamGone: false,
      vsDefault: null,
    }
  }

  /** One query per 100 branches, with each tip's commit and its distance from the default branch. */
  private async branchesGraphQL(defaultBranch: string): Promise<Branch[]> {
    return cached(`gh:${this.repo.id}:branches-graphql`, TTL_MS, async () => {
      const branches: Branch[] = []
      let cursor: string | null = null
      let withCompare = true

      for (let page = 0; page < MAX_BRANCH_PAGES; page++) {
        const query = `query($owner: String!, $name: String!, $cursor: String, $default: String!) {
          repository(owner: $owner, name: $name) {
            refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                name
                target { ... on Commit { oid messageHeadline committedDate author { name } } }
                ${withCompare ? 'compare(headRef: $default) { aheadBy behindBy }' : ''}
              }
            }
          }
        }`
        const response = await this.request(`${API}/graphql`, {
          method: 'POST',
          body: JSON.stringify({ query, variables: { owner: this.repo.owner, name: this.repo.repo, cursor, default: defaultBranch } }),
        })
        const body = (await response.json()) as {
          data?: {
            repository: {
              refs: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null }
                nodes: {
                  name: string
                  target: { oid: string; messageHeadline: string; committedDate: string; author: { name: string } | null }
                  compare?: { aheadBy: number; behindBy: number } | null
                }[]
              }
            } | null
          }
          errors?: { message: string }[]
        }

        if (body.errors?.length && withCompare) {
          // Comparisons can time out on very large repos; retry the page without them.
          withCompare = false
          page--
          continue
        }
        if (!body.data?.repository) throw new HttpError(502, `GitHub: ${body.errors?.[0]?.message ?? 'unexpected response'}`)

        const { nodes, pageInfo } = body.data.repository.refs
        for (const node of nodes) {
          const branch = this.branch(node.name, node.target.oid, defaultBranch)
          branch.subject = node.target.messageHeadline ?? null
          branch.author = node.target.author?.name ?? null
          branch.date = node.target.committedDate ?? null
          // compare(headRef: default) treats this branch as the base, so the default
          // branch's "ahead" is this branch's "behind".
          if (node.compare) branch.vsDefault = { ahead: node.compare.behindBy, behind: node.compare.aheadBy }
          branches.push(branch)
        }
        if (!pageInfo.hasNextPage) break
        cursor = pageInfo.endCursor
      }
      return branches
    })
  }

  async graph(limit: number): Promise<Commit[]> {
    const { defaultBranch, branches } = await this.branches()
    const picked = [
      ...branches.filter((b) => b.name === defaultBranch),
      ...branches.filter((b) => b.name !== defaultBranch),
    ].slice(0, GRAPH_BRANCHES)

    const refsBySha = new Map<string, CommitRef[]>()
    for (const branch of branches) {
      refsBySha.set(branch.sha, [...(refsBySha.get(branch.sha) ?? []), { name: branch.name, kind: 'local' }])
    }

    const perBranch = Math.min(100, limit)
    const lists = await Promise.all(
      picked.map((b) =>
        this.get<GhCommitItem[]>(`${this.base}/commits?sha=${encodeURIComponent(b.name)}&per_page=${perBranch}`).catch(() => []),
      ),
    )
    const unique = new Map<string, Commit>()
    for (const item of lists.flat()) {
      if (!unique.has(item.sha)) unique.set(item.sha, toCommit(item, refsBySha.get(item.sha)))
    }
    return childrenFirst([...unique.values()]).slice(0, limit)
  }

  /** Built on the compare API, so each side lists at most 250 commits. */
  async position(base: string, head: string): Promise<BranchPosition> {
    const { mergeBase, ahead, behind, headOnly, baseOnly } = await this.compare(base, head)
    return {
      base,
      head,
      mergeBase,
      ahead,
      behind,
      aheadShas: headOnly.map((c) => c.sha),
      behindShas: baseOnly.map((c) => c.sha),
    }
  }

  async compare(base: string, head: string): Promise<Comparison> {
    const url = (from: string, to: string) => `${this.base}/compare/${encodeRef(from)}...${encodeRef(to)}`
    const [forward, backward] = await Promise.all([this.get<GhCompare>(url(base, head)), this.get<GhCompare>(url(head, base))])

    const files: FileChange[] = (forward.files ?? []).map((f) => ({
      path: f.filename,
      oldPath: f.previous_filename ?? null,
      status: FILE_STATUS[f.status] ?? 'other',
      additions: f.additions,
      deletions: f.deletions,
    }))
    return {
      base,
      head,
      mergeBase: forward.merge_base_commit?.sha ?? null,
      ahead: forward.ahead_by,
      behind: forward.behind_by,
      headOnly: forward.commits.map((c) => toCommit(c)).reverse(),
      baseOnly: backward.commits.map((c) => toCommit(c)).reverse(),
      files,
      // The compare API returns at most 250 commits and 300 files.
      commitsTruncated: forward.commits.length < forward.ahead_by || backward.commits.length < forward.behind_by,
      filesTruncated: files.length >= 300,
    }
  }
}
