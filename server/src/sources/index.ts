import type { RepoConfig } from '../../../shared/types'
import { GitHubSource } from './github'
import { LocalSource } from './local'
import type { GitSource } from './types'

export function sourceFor(repo: RepoConfig): GitSource {
  return repo.source === 'local' ? new LocalSource(repo) : new GitHubSource(repo)
}
