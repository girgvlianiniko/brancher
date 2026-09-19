import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parse } from 'yaml'

import type { DeployTrigger } from '../../../shared/status'

/** `feature/*` and `releases/**` are the only wildcards GitHub Actions allows here. */
function matches(pattern: string, branch: string): boolean {
  if (!pattern.includes('*')) return pattern === branch
  const source = pattern
    .split('**')
    .map((part) => part.split('*').map(escapeRegex).join('[^/]*'))
    .join('.*')
  return new RegExp(`^${source}$`).test(branch)
}

const escapeRegex = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** Branch names differ only by separator often enough to be worth catching. */
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

function resembles(phantom: string, real: string): boolean {
  const a = normalise(phantom)
  const b = normalise(real)
  // A phantom is never a real branch, so an exact match after normalising means the
  // workflow meant this branch and got the separators wrong.
  return a.includes(b) || b.includes(a)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function pushBranches(doc: unknown): { branches: string[]; dispatch: boolean } {
  if (!isRecord(doc)) return { branches: [], dispatch: false }
  // YAML 1.1 readers turn the `on:` key into the boolean true; accept both spellings.
  const on = doc.on ?? doc.true
  if (!isRecord(on)) return { branches: [], dispatch: false }
  const dispatch = 'workflow_dispatch' in on || 'workflow_call' in on
  const push = on.push
  if (!isRecord(push)) return { branches: [], dispatch }
  const branches = Array.isArray(push.branches) ? push.branches : []
  return { branches: branches.filter((value): value is string => typeof value === 'string'), dispatch }
}

/**
 * What actually happens when someone pushes to a branch. Several workflows in these repos
 * watch branches that do not exist, so a branch can look up to date while the site runs
 * old code; that case is reported as `manual` with the file that meant to watch it.
 */
export async function readTriggers(
  repoId: string,
  repoPath: string,
  realBranches: Set<string>,
): Promise<DeployTrigger[]> {
  const dir = path.join(repoPath, '.github', 'workflows')
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  } catch {
    return []
  }

  const live = new Map<string, string>()
  const phantoms: { branch: string; file: string; dispatch: boolean }[] = []

  for (const file of files) {
    let doc: unknown
    try {
      doc = parse(readFileSync(path.join(dir, file), 'utf8'))
    } catch {
      continue
    }
    const { branches, dispatch } = pushBranches(doc)
    for (const pattern of branches) {
      const hits = [...realBranches].filter((branch) => matches(pattern, branch))
      if (hits.length === 0) phantoms.push({ branch: pattern, file, dispatch })
      for (const branch of hits) if (!live.has(branch)) live.set(branch, file)
    }
  }

  return [...realBranches].map<DeployTrigger>((branch) => {
    const file = live.get(branch)
    if (file) return { repoId, branch, mode: 'push', workflowFile: file }
    const near = phantoms.find((phantom) => resembles(phantom.branch, branch))
    return near
      ? { repoId, branch, mode: 'manual', workflowFile: near.file }
      : { repoId, branch, mode: 'none', workflowFile: '' }
  })
}
