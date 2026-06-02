import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TeamMember {
  id: number
  userId: number
  teamId: number
  role: string
  user?: { id: number; name: string | null; email: string }
}

export interface Team {
  id: number
  name: string
  slug?: string
  description: string | null
  color: string | null
  active: boolean
  position: number
  routingMode?: 'manual' | 'round_robin' | 'least_loaded' | 'random'
  createdAt: string
  updatedAt: string
  memberCount?: number
  leadCount?: number
  chatbotCount?: number
  _count?: { members: number }
}

export interface TeamInput {
  name: string
  slug?: string | undefined
  description?: string | null | undefined
  color?: string | null | undefined
  active?: boolean | undefined
  routingMode?: 'manual' | 'round_robin' | 'least_loaded' | 'random' | undefined
}

export interface EligibleUser {
  id: number
  name: string | null
  email: string
  role: string
}

export function useEligibleTeamMembers(teamId: number | null | undefined) {
  return useQuery({
    queryKey: ['team-eligible', teamId],
    queryFn: () => api.get<{ candidates: EligibleUser[] }>(`/admin/teams/${teamId}/eligible-members`),
    enabled: !!teamId,
    staleTime: 30_000,
  })
}

export function useDefaultTeam() {
  return useQuery({
    queryKey: ['default-team'],
    queryFn: () => api.get<{
      teamId: number | null
      team: { id: number; name: string; color: string | null } | null
    }>('/admin/default-team'),
    staleTime: 60_000,
  })
}

export function useSetDefaultTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (teamId: number | null) =>
      api.put<{ ok: true }>('/admin/default-team', { teamId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['default-team'] }) },
  })
}

export function useTeamsOrphans() {
  return useQuery({
    queryKey: ['teams-orphans'],
    queryFn: () => api.get<{ count: number }>('/admin/teams/orphans'),
    staleTime: 30_000,
  })
}

export function useApplyFallbackToOrphans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; affected: number; teamName: string }>('/admin/teams/apply-fallback'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams-orphans'] })
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get<{ teams: Team[] }>('/admin/teams'),
    staleTime: 60_000,
  })
}

export interface TeamMemberDetail {
  id: number
  isLeader: boolean
  createdAt: string
  user: {
    id: number
    name: string | null
    email: string
    role: string
    active: boolean
    lastSeenAt: string | null
  }
}

export function useTeamMembers(teamId: number | null | undefined) {
  return useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => api.get<{ members: TeamMemberDetail[] }>(`/admin/teams/${teamId}/members`),
    enabled: !!teamId,
    staleTime: 30_000,
  })
}

export function useCreateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TeamInput) => api.post<{ team: Team }>('/admin/teams', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useUpdateTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<TeamInput>) =>
      api.put<{ team: Team }>(`/admin/teams/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useDeleteTeam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/teams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useReorderTeams() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { id: number; position: number }[]) =>
      api.put<{ ok: true }>('/admin/teams/reorder', { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })
}

export function useAddTeamMember(teamId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, isLeader }: { userId: number; isLeader?: boolean }) =>
      api.post<{ ok: true }>(`/admin/teams/${teamId}/members`, { userId, isLeader }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] })
      void qc.invalidateQueries({ queryKey: ['team-members'] })
    },
  })
}

export function useUpdateTeamMember(teamId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, isLeader }: { userId: number; isLeader: boolean }) =>
      api.put<{ ok: true }>(`/admin/teams/${teamId}/members/${userId}`, { isLeader }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['team-members'] }) },
  })
}

export function useRemoveTeamMember(teamId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) =>
      api.delete<{ ok: true }>(`/admin/teams/${teamId}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['teams'] })
      void qc.invalidateQueries({ queryKey: ['team-members'] })
    },
  })
}
