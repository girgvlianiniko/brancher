import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { badRequest } from './errors'
import { git } from './git/exec'
import { REPOS_DIR } from './paths'
import { addRepo, listRepos } from './repos'
import { githubToken } from './settings'
import type { RepoConfig } from '../../shared/types'

/**
 * Teaches git the token once, through the credential store, so clone and fetch both
 * authenticate without the token ending up inside any repository's remote URL.
 */
export function useGitCredentials() {
  const token = githubToken()
  if (!token) return
  const file = path.join(homedir(), '.git-credentials')
  writeFileSync(file, `https://x-access-token:${token}@github.com\n`)
  chmodSync(file, 0o600)
  void git(homedir(), ['config', '--global', 'credential.helper', 'store'], { allowFail: true })
  // Volumes are often owned by another uid than the one the container runs as.
  void git(homedir(), ['config', '--global', '--add', 'safe.directory', '*'], { allowFail: true })
}

const SLUG = /^([\w.-]+)\/([\w.-]+)$/

/**
 * Clones a GitHub repository into the repos directory and registers it. Already cloned
 * or already registered repositories are returned as they are, so this is safe to run
 * on every boot.
 */
export async function cloneRepo(slug: string): Promise<RepoConfig> {
  const match = SLUG.exec(slug.trim().replace(/\.git$/, ''))
  if (!match) throw badRequest(`Use owner/repo, not "${slug}"`)
  const [, owner, name] = match

  const target = path.join(REPOS_DIR, name)
  const already = listRepos().find((repo) => repo.source === 'local' && repo.path === target)
  if (already) return already

  if (!existsSync(path.join(target, '.git'))) {
    mkdirSync(REPOS_DIR, { recursive: true })
    useGitCredentials()
    // Blobless: the history and every ref, without every version of every file. Enough
    // for counting commits and comparing, and a fraction of the disk and the wait.
    await git(REPOS_DIR, ['clone', '--filter=blob:none', `https://github.com/${owner}/${name}.git`, target], {
      timeoutMs: 15 * 60_000,
    })
  }

  return addRepo({ source: 'local', path: target })
}

/** Clones everything named in `BRANCHER_CLONE`, so a fresh deployment comes up ready. */
export async function cloneFromEnvironment() {
  const wanted = (process.env.BRANCHER_CLONE ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean)
  for (const slug of wanted) {
    try {
      const repo = await cloneRepo(slug)
      console.log(`repo ready: ${repo.name}`)
    } catch (error) {
      console.error(`could not clone ${slug}: ${error instanceof Error ? error.message : error}`)
    }
  }
}
