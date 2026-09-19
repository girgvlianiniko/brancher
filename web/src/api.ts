import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  BoardResponse,
  ClientConfig,
  ClientDetail,
  ProbeResult,
  ServiceConfig,
} from '../../shared/status'
import type {
  AddRepoInput,
  BranchesResponse,
  BranchOverview,
  BranchPosition,
  Comparison,
  Commit,
  GraphScope,
  HealthResponse,
  RepoConfig,
  RepoOverview,
} from '../../shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
  return body as T
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

const repoKey = (id: string) => ['repo', id] as const

export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: () => request<HealthResponse>('/health') })

export const useRepos = () => useQuery({ queryKey: ['repos'], queryFn: () => request<RepoConfig[]>('/repos') })

export const useOverview = (id: string) =>
  useQuery({ queryKey: [...repoKey(id), 'overview'], queryFn: () => request<RepoOverview>(`/repos/${id}/overview`) })

export const useBranches = (id: string) =>
  useQuery({ queryKey: [...repoKey(id), 'branches'], queryFn: () => request<BranchesResponse>(`/repos/${id}/branches`) })

export const useGraph = (id: string, limit: number, scope: GraphScope) =>
  useQuery({
    queryKey: [...repoKey(id), 'graph', limit, scope],
    queryFn: () => request<Commit[]>(`/repos/${id}/graph?limit=${limit}&scope=${scope}`),
    placeholderData: keepPreviousData,
  })

export const useCompare = (id: string, base: string | null, head: string | null) =>
  useQuery({
    queryKey: [...repoKey(id), 'compare', base, head],
    queryFn: () =>
      request<Comparison>(
        `/repos/${id}/compare?base=${encodeURIComponent(base!)}&head=${encodeURIComponent(head!)}`,
      ),
    enabled: Boolean(base && head && base !== head),
    placeholderData: keepPreviousData,
  })

export const usePosition = (id: string, base: string | null, head: string | null, enabled = true) =>
  useQuery({
    queryKey: [...repoKey(id), 'position', base, head],
    queryFn: () =>
      request<BranchPosition>(
        `/repos/${id}/position?base=${encodeURIComponent(base!)}&head=${encodeURIComponent(head!)}`,
      ),
    enabled: enabled && Boolean(base && head && base !== head),
    placeholderData: keepPreviousData,
  })

export function useAddRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddRepoInput) =>
      request<RepoConfig>('/repos', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repos'] }),
  })
}

export function useRemoveRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/repos/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: repoKey(id) })
      return queryClient.invalidateQueries({ queryKey: ['repos'] })
    },
  })
}

/** `git fetch` for local repos; a cache refresh for GitHub ones. Either way, reload the repo. */
export function useFetchRepo(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request<{ ok: true }>(`/repos/${id}/fetch`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: repoKey(id) }),
  })
}

// ---------------------------------------------------------------- status board

export const useBoard = (refreshMs = 30_000) =>
  useQuery({
    queryKey: ['board'],
    queryFn: () => request<BoardResponse>('/board'),
    refetchInterval: refreshMs,
    staleTime: 0,
  })

export function useRefreshBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request<BoardResponse>('/board/refresh', { method: 'POST' }),
    // A poll already in flight would otherwise land after this and overwrite the answer
    // with what the board looked like before.
    onMutate: () => queryClient.cancelQueries({ queryKey: ['board'] }),
    onSuccess: (board) => {
      queryClient.setQueryData(['board'], board)
      return queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

export const useClientDetail = (id: string, hours = 24) =>
  useQuery({
    queryKey: ['client', id, hours],
    queryFn: () => request<ClientDetail>(`/clients/${id}?hours=${hours}`),
    refetchInterval: 30_000,
  })

// ---------------------------------------------------------------- wizard

export interface DiscoveredBranch {
  name: string
  sha: string
  subject: string
  author: string
  date: string
  trigger: 'push' | 'manual' | 'none'
  workflowFile: string
}

/** Branches for several repos at once, so the wizard's branch step loads in one go. */
export const useDiscoveredBranches = (repoIds: string[]) =>
  useQuery({
    queryKey: ['discover', 'branches', [...repoIds].sort()],
    enabled: repoIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const lists = await Promise.all(
        repoIds.map((repoId) =>
          request<DiscoveredBranch[]>(`/discover/branches?repoId=${encodeURIComponent(repoId)}`),
        ),
      )
      return Object.fromEntries(repoIds.map((repoId, i) => [repoId, lists[i]]))
    },
  })

export const useSuggestedServices = (domain: string) =>
  useQuery({
    queryKey: ['discover', 'services', domain],
    enabled: domain.trim().length > 0,
    staleTime: Infinity,
    queryFn: () => request<ServiceConfig[]>(`/discover/services?domain=${encodeURIComponent(domain.trim())}`),
  })

export function useProbeUrl() {
  return useMutation({
    mutationFn: (url: string) =>
      request<ProbeResult>('/discover/probe', { method: 'POST', body: JSON.stringify({ url }) }),
  })
}

export function useSaveClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (client: ClientConfig) =>
      request<ClientConfig>(`/clients/${client.id}`, { method: 'PUT', body: JSON.stringify(client) }),
    onMutate: () => queryClient.cancelQueries({ queryKey: ['board'] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board'] })
      return queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<void>(`/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board'] }),
  })
}

export const useClients = () =>
  useQuery({ queryKey: ['clients'], queryFn: () => request<ClientConfig[]>('/clients') })

/** Pin and order are stored server-side, so the board looks the same for everyone. */
export function useSetLayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (layout: { order: string[]; pinned: string[] }) =>
      request<BoardResponse>('/board/layout', { method: 'PUT', body: JSON.stringify(layout) }),
    // Without this, a poll that started before the pin was saved can resolve after it and
    // put the old layout back on screen. The next drag would then write that back to disk.
    onMutate: () => queryClient.cancelQueries({ queryKey: ['board'] }),
    onSuccess: (board) => queryClient.setQueryData(['board'], board),
  })
}

export const useBranchOverview = (repoId: string, branch: string | null) =>
  useQuery({
    queryKey: [...repoKey(repoId), 'branch', branch],
    enabled: Boolean(branch),
    queryFn: () => request<BranchOverview>(`/repos/${repoId}/branch?name=${encodeURIComponent(branch!)}`),
    placeholderData: keepPreviousData,
  })
