import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  AddRepoInput,
  BranchesResponse,
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
