import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { AddRepoInput, RepoConfig } from '../../shared/types'
import { badRequest, HttpError, notFound } from './errors'
import { dataFile, PROJECT_ROOT, REPOS_DIR } from './paths'
import { git } from './git/exec'

/**
 * Repo list, kept in a JSON file for now. This is the first thing that moves to
 * SpacetimeDB once there is a database.
 */
const DATA_FILE = dataFile('repos.json')

const isGitRepo = (dir: string) => existsSync(path.join(dir, '.git'))

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'repo'

function uniqueId(base: string, repos: RepoConfig[]): string {
  const taken = new Set(repos.map((r) => r.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/** Git repos sitting directly inside `dir`, skipping brancher itself. */
function scanForRepos(dir: string): RepoConfig[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  const found: RepoConfig[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (!entry.isDirectory() || full === PROJECT_ROOT || !isGitRepo(full)) continue
    found.push({ id: uniqueId(slugify(entry.name), found), name: entry.name, source: 'local', path: full })
  }
  return found
}

function save() {
  mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(repos, null, 2))
}

function load(): RepoConfig[] {
  if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as RepoConfig[]
  const scanDir = process.env.BRANCHER_SCAN_DIR || REPOS_DIR
  return scanForRepos(scanDir)
}

let repos: RepoConfig[] = load()
if (!existsSync(DATA_FILE)) save()

export const listRepos = () => repos

export function getRepo(id: string): RepoConfig {
  const repo = repos.find((r) => r.id === id)
  if (!repo) throw notFound(`No repo with id "${id}"`)
  return repo
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** `owner/repo`, `github.com/owner/repo`, or a clone URL. */
function parseGitHubSlug(slug: string): { owner: string; repo: string } {
  const trimmed = slug.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const match =
    trimmed.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)$/) ?? trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (!match) throw badRequest('Use owner/repo or a github.com URL')
  return { owner: match[1], repo: match[2] }
}

export async function addRepo(input: AddRepoInput | null): Promise<RepoConfig> {
  if (input?.source === 'local') {
    if (!input.path?.trim()) throw badRequest('Path is required')
    const requested = path.resolve(input.path.trim())
    if (!existsSync(requested)) throw badRequest(`Folder not found: ${requested}`)
    // Accept any folder inside a repo and store the repo root.
    const top = (await git(requested, ['rev-parse', '--show-toplevel'], { allowFail: true })).trim()
    if (!top) throw badRequest(`Not a git repository: ${requested}`)
    const root = path.resolve(top)

    const existing = repos.find((r) => r.source === 'local' && samePath(r.path, root))
    if (existing) return existing
    const name = path.basename(root)
    const repo: RepoConfig = { id: uniqueId(slugify(name), repos), name, source: 'local', path: root }
    repos = [...repos, repo]
    save()
    return repo
  }

  if (input?.source === 'github') {
    const { owner, repo: repoName } = parseGitHubSlug(input.slug ?? '')
    const existing = repos.find(
      (r) =>
        r.source === 'github' &&
        r.owner.toLowerCase() === owner.toLowerCase() &&
        r.repo.toLowerCase() === repoName.toLowerCase(),
    )
    if (existing) return existing
    const repo: RepoConfig = {
      id: uniqueId(`gh-${slugify(`${owner}-${repoName}`)}`, repos),
      name: `${owner}/${repoName}`,
      source: 'github',
      owner,
      repo: repoName,
    }
    repos = [...repos, repo]
    save()
    return repo
  }

  throw new HttpError(400, 'source must be "local" or "github"')
}

export function removeRepo(id: string) {
  getRepo(id)
  repos = repos.filter((r) => r.id !== id)
  save()
}
