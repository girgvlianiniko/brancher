import { git, US } from '../git/exec'

/** How far one branch is in front of another, counting only commits that change files. */
export interface LagNumbers {
  realCommits: number
  mergeCommits: number
  filesChanged: number
  oldestWaitingAt: string | null
}

export interface RefTip {
  sha: string
  subject: string
  author: string
  date: string
}

/**
 * The ref to measure. Remote-tracking refs are what `fetch` keeps current, so
 * `origin/<branch>` wins over a local branch that may not have been pulled.
 */
export async function resolveRef(repoPath: string, branch: string): Promise<string | null> {
  for (const candidate of [`origin/${branch}`, branch]) {
    const found = await git(repoPath, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
      allowFail: true,
    })
    if (found.trim()) return candidate
  }
  return null
}

export async function tipOf(repoPath: string, ref: string): Promise<RefTip | null> {
  const output = await git(repoPath, ['log', '-1', `--format=%H${US}%s${US}%an${US}%aI`, ref], {
    allowFail: true,
  })
  const [sha, subject, author, date] = output.trim().split(US)
  return sha ? { sha, subject: subject ?? '', author: author ?? '', date: date ?? '' } : null
}

/**
 * What `from` has that `to` does not. Merge commits are counted separately because a
 * branch can be dozens of merge commits "ahead" while carrying no new code, which is the
 * single most misleading number on a promotion dashboard.
 */
export async function lagBetween(repoPath: string, fromRef: string, toRef: string): Promise<LagNumbers> {
  const [log, shortstat] = await Promise.all([
    // One line per waiting commit: author date, then the parent shas.
    git(repoPath, ['log', `--format=%aI${US}%P`, `${toRef}..${fromRef}`], { allowFail: true }),
    git(repoPath, ['diff', '--shortstat', `${toRef}...${fromRef}`], { allowFail: true }),
  ])

  let realCommits = 0
  let mergeCommits = 0
  let oldestWaitingAt: string | null = null
  for (const line of log.split('\n')) {
    if (!line) continue
    const [date, parents = ''] = line.split(US)
    if (parents.trim().split(' ').filter(Boolean).length > 1) {
      mergeCommits++
      continue
    }
    realCommits++
    // The log is newest first, so the last non-merge line seen is the oldest.
    if (date) oldestWaitingAt = date
  }

  return {
    realCommits,
    mergeCommits,
    filesChanged: Number(shortstat.match(/(\d+) files? changed/)?.[1] ?? 0),
    oldestWaitingAt,
  }
}

/**
 * Every branch tip in one call instead of one call per branch. Remote-tracking refs win
 * over local ones of the same name, since those are what `fetch` keeps current.
 */
export async function loadTips(repoPath: string): Promise<Map<string, RefTip & { ref: string }>> {
  const output = await git(
    repoPath,
    [
      'for-each-ref',
      `--format=%(refname)${US}%(objectname)${US}%(contents:subject)${US}%(authorname)${US}%(committerdate:iso-strict)`,
      'refs/heads',
      'refs/remotes/origin',
    ],
    { allowFail: true },
  )

  const tips = new Map<string, RefTip & { ref: string }>()
  for (const line of output.split('\n')) {
    if (!line) continue
    const [refname, sha, subject, author, date] = line.split(US)
    if (refname.endsWith('/HEAD')) continue
    const isRemote = refname.startsWith('refs/remotes/origin/')
    const branch = isRemote ? refname.slice('refs/remotes/origin/'.length) : refname.slice('refs/heads/'.length)
    // A local branch only fills a gap; the remote-tracking ref is the source of truth.
    if (!isRemote && tips.has(branch)) continue
    tips.set(branch, {
      ref: isRemote ? `origin/${branch}` : branch,
      sha,
      subject: subject ?? '',
      author: author ?? '',
      date: date ?? '',
    })
  }
  return tips
}
