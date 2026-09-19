import type {
  Branch,
  BranchesResponse,
  BranchPosition,
  Comparison,
  Commit,
  CommitRef,
  Contributor,
  FileChange,
  FileChangeStatus,
  GraphScope,
  LocalRepoConfig,
  RepoOverview,
  Tag,
  WorkingTreeStatus,
} from '../../../shared/types'
import type { BranchOverview } from '../../../shared/types'
import { activitySince, bucketByWeek } from '../activity'
import { badRequest } from '../errors'
import { git, RS, US } from '../git/exec'
import type { GitSource } from './types'

/** Max commits listed per side of a comparison, and max files. */
const COMPARE_COMMIT_LIMIT = 300
const COMPARE_FILE_LIMIT = 2000
/** Shas listed per side of a branch position; counts are always exact. */
const POSITION_SHA_LIMIT = 5000

const COMMIT_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%s', '%D'].join('%x1f') + '%x1e'

/**
 * `%D` decorations, e.g. `HEAD -> main, origin/main, tag: v1.2`. A name is a remote
 * branch when it starts with one of the repo's remote names; `origin/HEAD` is noise.
 */
function parseDecorations(value: string, remotes: string[]): CommitRef[] {
  const refs: CommitRef[] = []
  for (const raw of value.split(', ')) {
    const part = raw.trim()
    if (!part) continue
    if (part.startsWith('tag: ')) {
      refs.push({ name: part.slice(5), kind: 'tag' })
    } else if (part.startsWith('HEAD -> ')) {
      refs.push({ name: 'HEAD', kind: 'head' }, { name: part.slice(8), kind: 'local' })
    } else if (part === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' })
    } else if (remotes.some((r) => part.startsWith(`${r}/`))) {
      if (!part.endsWith('/HEAD')) refs.push({ name: part, kind: 'remote' })
    } else {
      refs.push({ name: part, kind: 'local' })
    }
  }
  return refs
}

function parseCommits(output: string, remotes: string[]): Commit[] {
  return output
    .split(RS)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, author, email, date, subject, decorations = ''] = record.split(US)
      return {
        sha,
        parents: parents ? parents.split(' ') : [],
        author,
        email: email || null,
        date,
        subject,
        refs: parseDecorations(decorations, remotes),
      }
    })
}

/** `ahead 2, behind 3`, `ahead 2`, `gone`, or empty when in sync. */
function parseTrack(track: string) {
  if (track === 'gone') return { gone: true, ahead: null, behind: null }
  return {
    gone: false,
    ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
  }
}

function parseStatus(output: string): WorkingTreeStatus {
  const status: WorkingTreeStatus = { staged: 0, modified: 0, untracked: 0, conflicted: 0 }
  for (const line of output.split('\n')) {
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') status.staged++
      if (line[3] !== '.') status.modified++
    } else if (line.startsWith('u ')) {
      status.conflicted++
    } else if (line.startsWith('? ')) {
      status.untracked++
    }
  }
  return status
}

const STATUS_BY_LETTER: Record<string, FileChangeStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
}

/** `git diff --name-status -z` and `--numstat -z`, joined by path. */
function parseDiff(nameStatus: string, numstat: string): FileChange[] {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  const numTokens = numstat.split('\0')
  for (let i = 0; i < numTokens.length; i++) {
    const token = numTokens[i]
    if (!token) continue
    const [add, del, ...rest] = token.split('\t')
    let filePath = rest.join('\t')
    // Renames and copies put the two paths in their own NUL-separated fields.
    if (filePath === '') {
      filePath = numTokens[i + 2] ?? ''
      i += 2
    }
    stats.set(filePath, {
      additions: add === '-' ? null : Number(add),
      deletions: del === '-' ? null : Number(del),
    })
  }

  const files: FileChange[] = []
  const tokens = nameStatus.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (!code) continue
    const letter = code[0]
    let oldPath: string | null = null
    let filePath: string
    if (letter === 'R' || letter === 'C') {
      oldPath = tokens[i + 1]
      filePath = tokens[i + 2]
      i += 2
    } else {
      filePath = tokens[i + 1]
      i += 1
    }
    const stat = stats.get(filePath) ?? { additions: null, deletions: null }
    files.push({ path: filePath, oldPath, status: STATUS_BY_LETTER[letter] ?? 'other', ...stat })
  }
  return files
}

export class LocalSource implements GitSource {
  constructor(private readonly repo: LocalRepoConfig) {}

  private run(args: string[], options?: Parameters<typeof git>[2]) {
    return git(this.repo.path, args, options)
  }

  private async remotes(): Promise<{ name: string; url: string }[]> {
    const output = await this.run(['remote', '-v'], { allowFail: true })
    const seen = new Map<string, string>()
    for (const line of output.split('\n')) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
      if (match) seen.set(match[1], match[2])
    }
    return [...seen].map(([name, url]) => ({ name, url }))
  }

  private async refExists(ref: string): Promise<boolean> {
    const output = await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      allowFail: true,
    })
    return output.trim().length > 0
  }

  private async currentBranch(): Promise<string | null> {
    return (await this.run(['branch', '--show-current'], { allowFail: true })).trim() || null
  }

  /** The remote's default branch when known, else the usual names, else the current branch. */
  private async defaultBranch(): Promise<string | null> {
    const remoteHead = (
      await this.run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
        allowFail: true,
      })
    ).trim()
    if (remoteHead) return remoteHead
    for (const candidate of ['main', 'master', 'develop', 'origin/main', 'origin/master', 'origin/develop']) {
      if (await this.refExists(candidate)) return candidate
    }
    return this.currentBranch()
  }

  async overview(): Promise<RepoOverview> {
    const [
      currentBranch,
      defaultBranch,
      headOutput,
      remotes,
      refsOutput,
      tagsOutput,
      commitCount,
      statusOutput,
      shortlog,
      activityOutput,
    ] = await Promise.all([
      this.currentBranch(),
      this.defaultBranch(),
      this.run(['log', '-1', '--format=%H%x1f%s%x1f%aI', 'HEAD'], { allowFail: true }),
      this.remotes(),
      this.run(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']),
      this.run([
        'for-each-ref',
        '--sort=-creatordate',
        '--count=15',
        '--format=%(refname:short)%1f%(*objectname)%1f%(objectname)%1f%(creatordate:iso-strict)%1f%(contents:subject)',
        'refs/tags',
      ]),
      this.run(['rev-list', '--count', 'HEAD'], { allowFail: true }),
      this.run(['status', '--porcelain=v2'], { allowFail: true }),
      this.run(['shortlog', '-sne', 'HEAD'], { allowFail: true }),
      this.run(['log', '--branches', '--remotes', `--since=${activitySince()}`, '--format=%aI'], {
        allowFail: true,
      }),
    ])

    const [headSha, headSubject, headDate] = headOutput.trim().split(US)
    const refNames = refsOutput.split('\n').filter(Boolean)

    const tags: Tag[] = tagsOutput
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, peeled, object, date, subject] = line.split(US)
        return { name, sha: peeled || object, date: date || null, subject: subject || null }
      })

    const contributors: Contributor[] = shortlog
      .split('\n')
      .map((line) => line.match(/^\s*(\d+)\t(.*?)(?: <(.*)>)?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ commits: Number(m[1]), name: m[2], email: m[3] || null }))

    return {
      currentBranch,
      defaultBranch,
      head: headSha ? { sha: headSha, subject: headSubject, date: headDate } : null,
      remotes,
      counts: {
        localBranches: refNames.filter((r) => r.startsWith('refs/heads/')).length,
        remoteBranches: refNames.filter((r) => r.startsWith('refs/remotes/') && !r.endsWith('/HEAD'))
          .length,
        tags: refNames.filter((r) => r.startsWith('refs/tags/')).length,
        commits: commitCount.trim() ? Number(commitCount.trim()) : null,
        contributors: contributors.length,
      },
      capped: {},
      status: parseStatus(statusOutput),
      tags,
      contributors: contributors.slice(0, 15),
      activity: bucketByWeek(activityOutput.split('\n').filter(Boolean)),
    }
  }

  async branches(): Promise<BranchesResponse> {
    const defaultBranch = await this.defaultBranch()
    const fields = [
      '%(refname)',
      '%(refname:short)',
      '%(objectname)',
      '%(contents:subject)',
      '%(authorname)',
      '%(committerdate:iso-strict)',
      '%(upstream:short)',
      '%(upstream:track,nobracket)',
      '%(HEAD)',
    ]
    if (defaultBranch) fields.push(`%(ahead-behind:${defaultBranch})`)

    const output = await this.run([
      'for-each-ref',
      `--format=${fields.join('%1f')}`,
      'refs/heads',
      'refs/remotes',
    ])

    const branches: Branch[] = []
    for (const line of output.split('\n')) {
      if (!line) continue
      const [refname, name, sha, subject, author, date, upstream, track, head, aheadBehind] =
        line.split(US)
      if (refname.endsWith('/HEAD')) continue
      const tracking = parseTrack(track ?? '')
      const [ahead, behind] = (aheadBehind ?? '').trim().split(' ').map(Number)
      branches.push({
        name,
        kind: refname.startsWith('refs/heads/') ? 'local' : 'remote',
        sha,
        subject: subject || null,
        author: author || null,
        date: date || null,
        isCurrent: head === '*',
        isDefault: name === defaultBranch,
        upstream: upstream || null,
        upstreamAhead: upstream ? tracking.ahead : null,
        upstreamBehind: upstream ? tracking.behind : null,
        upstreamGone: tracking.gone,
        vsDefault: aheadBehind && Number.isFinite(ahead) ? { ahead, behind } : null,
      })
    }
    branches.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return { defaultBranch, branches }
  }

  async graph(limit: number, scope: GraphScope): Promise<Commit[]> {
    const args = ['log', '--topo-order', `--max-count=${limit}`, `--format=${COMMIT_FORMAT}`, '--branches', '--tags']
    if (scope === 'all') args.push('--remotes')
    args.push('HEAD')
    const [output, remotes] = await Promise.all([this.run(args, { allowFail: true }), this.remotes()])
    return parseCommits(
      output,
      remotes.map((r) => r.name),
    )
  }

  async compare(base: string, head: string): Promise<Comparison> {
    const [baseExists, headExists] = await Promise.all([this.refExists(base), this.refExists(head)])
    if (!baseExists) throw badRequest(`Unknown ref: ${base}`)
    if (!headExists) throw badRequest(`Unknown ref: ${head}`)

    const mergeBase = (await this.run(['merge-base', base, head], { allowFail: true })).trim() || null
    // Without a common ancestor a three-dot diff is impossible, so diff the tips directly.
    const range = mergeBase ? [`${base}...${head}`] : [base, head]
    const logArgs = (revisions: string) => ['log', `--max-count=${COMPARE_COMMIT_LIMIT}`, `--format=${COMMIT_FORMAT}`, revisions]

    const [counts, headOnly, baseOnly, nameStatus, numstat, remotes] = await Promise.all([
      this.run(['rev-list', '--left-right', '--count', `${base}...${head}`]),
      this.run(logArgs(`${base}..${head}`)),
      this.run(logArgs(`${head}..${base}`)),
      this.run(['diff', '--name-status', '-z', '-M', ...range, '--']),
      this.run(['diff', '--numstat', '-z', '-M', ...range, '--']),
      this.remotes(),
    ])

    const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
    const remoteNames = remotes.map((r) => r.name)
    const files = parseDiff(nameStatus, numstat)
    return {
      base,
      head,
      mergeBase,
      ahead,
      behind,
      headOnly: parseCommits(headOnly, remoteNames),
      baseOnly: parseCommits(baseOnly, remoteNames),
      files: files.slice(0, COMPARE_FILE_LIMIT),
      commitsTruncated: ahead > COMPARE_COMMIT_LIMIT || behind > COMPARE_COMMIT_LIMIT,
      filesTruncated: files.length > COMPARE_FILE_LIMIT,
    }
  }

  async position(base: string, head: string): Promise<BranchPosition> {
    const [baseExists, headExists] = await Promise.all([this.refExists(base), this.refExists(head)])
    if (!baseExists) throw badRequest(`Unknown ref: ${base}`)
    if (!headExists) throw badRequest(`Unknown ref: ${head}`)

    const [counts, aheadShas, behindShas, mergeBase] = await Promise.all([
      this.run(['rev-list', '--left-right', '--count', `${base}...${head}`]),
      this.run(['rev-list', `--max-count=${POSITION_SHA_LIMIT}`, `${base}..${head}`]),
      this.run(['rev-list', `--max-count=${POSITION_SHA_LIMIT}`, `${head}..${base}`]),
      this.run(['merge-base', base, head], { allowFail: true }),
    ])
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
    const lines = (output: string) => output.split('\n').filter(Boolean)
    return {
      base,
      head,
      mergeBase: mergeBase.trim() || null,
      ahead,
      behind,
      aheadShas: lines(aheadShas),
      behindShas: lines(behindShas),
    }
  }

  async branchOverview(name: string): Promise<BranchOverview> {
    const remotes = (await this.remotes()).map((remote) => remote.name)
    // Most branches in a working clone exist only as remote-tracking refs, and the
    // remote one is the current copy anyway, so it wins over a local branch of the same
    // name. Callers pass the plain name they saw on screen.
    const ref = await this.resolveBranchRef(name, remotes)
    if (!ref) throw badRequest(`Unknown branch: ${name}`)
    const defaultBranch = await this.defaultBranch()
    // The upstream only exists for a local branch, so look it up under its short name.
    const localName = remotes.reduce(
      (value, remote) => (value.startsWith(`${remote}/`) ? value.slice(remote.length + 1) : value),
      name,
    )

    const [tipOutput, commitCount, shortlog, activityOutput, recentOutput, refInfo, counts, shortstat] =
      await Promise.all([
        this.run(['log', '-1', `--format=${COMMIT_FORMAT}`, ref], { allowFail: true }),
        this.run(['rev-list', '--count', ref], { allowFail: true }),
        this.run(['shortlog', '-sne', ref], { allowFail: true }),
        this.run(['log', `--since=${activitySince()}`, '--format=%aI', ref], { allowFail: true }),
        this.run(['log', '--max-count=25', `--format=${COMMIT_FORMAT}`, ref], { allowFail: true }),
        this.run(
          [
            'for-each-ref',
            `--format=%(upstream:short)%1f%(upstream:track,nobracket)`,
            `refs/heads/${localName}`,
          ],
          { allowFail: true },
        ),
        defaultBranch
          ? this.run(['rev-list', '--left-right', '--count', `${defaultBranch}...${ref}`], { allowFail: true })
          : Promise.resolve(''),
        defaultBranch
          ? this.run(['diff', '--shortstat', `${defaultBranch}...${ref}`], { allowFail: true })
          : Promise.resolve(''),
      ])

    const [upstream, track] = refInfo.trim().split(US)
    const tracking = parseTrack(track ?? '')
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number)

    return {
      name,
      defaultBranch,
      tip: parseCommits(tipOutput, remotes)[0] ?? null,
      commits: commitCount.trim() ? Number(commitCount.trim()) : null,
      vsDefault: Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead, behind } : null,
      // Empty output means nothing differs, not that we could not tell.
      filesChanged: defaultBranch ? Number(shortstat.match(/(\d+) files? changed/)?.[1] ?? 0) : null,
      upstream: upstream || null,
      upstreamAhead: upstream ? tracking.ahead : null,
      upstreamBehind: upstream ? tracking.behind : null,
      contributors: shortlog
        .split('\n')
        .map((line) => line.match(/^\s*(\d+)\t(.*?)(?: <(.*)>)?$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => ({ commits: Number(match[1]), name: match[2], email: match[3] || null }))
        .slice(0, 12),
      activity: bucketByWeek(activityOutput.split('\n').filter(Boolean)),
      recent: parseCommits(recentOutput, remotes),
    }
  }

  /** `origin/<name>` when it exists, else the plain name. */
  private async resolveBranchRef(name: string, remotes: string[]): Promise<string | null> {
    const candidates = [...remotes.map((remote) => `${remote}/${name}`), name]
    for (const candidate of candidates) {
      if (await this.refExists(candidate)) return candidate
    }
    return null
  }

  async fetch(): Promise<void> {
    await this.run(['fetch', '--all', '--prune'], { timeoutMs: 180_000 })
  }
}
