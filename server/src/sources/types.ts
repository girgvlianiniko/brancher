import type {
  BranchesResponse,
  BranchOverview,
  BranchPosition,
  Comparison,
  Commit,
  GraphScope,
  RepoOverview,
} from '../../../shared/types'

/** What every repo source (local clone, GitHub, …) has to answer. */
export interface GitSource {
  overview(): Promise<RepoOverview>
  branches(): Promise<BranchesResponse>
  /** Newest first, children always before their parents. */
  graph(limit: number, scope: GraphScope): Promise<Commit[]>
  compare(base: string, head: string): Promise<Comparison>
  /** The shas that make head ahead of / behind base. */
  position(base: string, head: string): Promise<BranchPosition>
  /** The overview, narrowed to one branch. */
  branchOverview(name: string): Promise<BranchOverview>
  /** Update remote-tracking refs. Only sources with a local clone can. */
  fetch?(): Promise<void>
}
