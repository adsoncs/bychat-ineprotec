import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type HomeBlockType = 'notice' | 'kpis' | 'shortcuts' | 'my_day' | 'leaderboard'

export interface HomeLink {
  label: string
  path: string
  /** módulo que protege o destino — o backend some com o link sem canView */
  moduleId?: string
}

export interface HomeBlock {
  id: string
  type: HomeBlockType
  config: {
    title?: string
    // notice
    text?: string
    variant?: 'info' | 'warning' | 'success'
    links?: HomeLink[]
    // shortcuts
    items?: HomeLink[]
    // kpis
    metrics?: string[]
    period?: number
    funnelId?: number
    // my_day
    staleHours?: number
    // leaderboard
    days?: number
    limit?: number
    metric?: 'revenue' | 'won'
  }
}

export interface HomeScreen {
  id: number
  name: string
  description?: string | null
  blocks: HomeBlock[]
  active?: boolean
  isSystem?: boolean
}

export interface HomeAssignment {
  id: number
  screenId: number
  role: string | null
  userId: number | null
}

/** Tela do usuário logado. `screen: null` = cai na Visão Geral de fábrica. */
export function useMyHomeScreen() {
  return useQuery({
    queryKey: ['home-screen', 'me'],
    queryFn: () => api.get<{ screen: HomeScreen | null; source?: 'user' | 'role'; pruned?: number }>('/home-screen/me'),
    staleTime: 60_000,
  })
}

export interface MyDayData {
  activities: { id: number; type: string; title: string; scheduledAt: string; leadId: number; leadName: string | null }[]
  counts: { today: number; meetings: number; overdue: number; staleLeads: number }
  staleHours: number
}

export function useMyDay(staleHours?: number) {
  return useQuery({
    queryKey: ['home-screen', 'my-day', staleHours ?? 24],
    queryFn: () => api.get<MyDayData>(`/home-screen/my-day?staleHours=${staleHours ?? 24}`),
    staleTime: 60_000,
  })
}

export interface LeaderboardData {
  days: number
  total: number
  entries: { userId: number; name: string; won: number; revenue: number; isMe: boolean }[]
}

export function useLeaderboard(days?: number, limit?: number) {
  return useQuery({
    queryKey: ['home-screen', 'leaderboard', days ?? 30, limit ?? 5],
    queryFn: () => api.get<LeaderboardData>(`/home-screen/leaderboard?days=${days ?? 30}&limit=${limit ?? 5}`),
    staleTime: 60_000,
  })
}

// ── Administração ────────────────────────────────────────────────────────

export interface AdminHomeData {
  screens: HomeScreen[]
  assignments: HomeAssignment[]
  users: { id: number; name: string; email: string; role: string }[]
  roles: string[]
}

export function useHomeScreensAdmin() {
  return useQuery({
    queryKey: ['home-screens', 'admin'],
    queryFn: () => api.get<AdminHomeData>('/admin/home-screens'),
  })
}

export function useSaveHomeScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: { id?: number; name: string; description?: string | null; blocks: HomeBlock[]; active?: boolean }) =>
      s.id
        ? api.put<{ screen: HomeScreen }>(`/admin/home-screens/${s.id}`, s)
        : api.post<{ screen: HomeScreen }>('/admin/home-screens', s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['home-screens', 'admin'] })
      void qc.invalidateQueries({ queryKey: ['home-screen', 'me'] })
    },
  })
}

export function useDeleteHomeScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: boolean }>(`/admin/home-screens/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['home-screens', 'admin'] })
      void qc.invalidateQueries({ queryKey: ['home-screen', 'me'] })
    },
  })
}

export function useSaveAssignments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { roles?: Record<string, number | null>; users?: { userId: number; screenId: number | null }[] }) =>
      api.put<{ assignments: HomeAssignment[] }>('/admin/home-screens/assignments', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['home-screens', 'admin'] })
      void qc.invalidateQueries({ queryKey: ['home-screen', 'me'] })
    },
  })
}
