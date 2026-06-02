import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TrashItem {
  id: number
  entityType: string
  entityId: number
  entityLabel: string
  deletedBy: number | null
  deletedByName: string | null
  reason: string | null
  expiresAt: string
  createdAt: string
}

export interface TrashItemDetail extends TrashItem {
  snapshot: Record<string, unknown> | null
  restoredAt: string | null
  restoredBy: number | null
}

export interface TrashStats {
  total: number
  restored: number
  byType: { type: string; count: number }[]
}

export interface TrashFilters {
  entityType?: string | undefined
  search?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

const LIST_KEY = 'trash-items'
const STATS_KEY = ['trash-stats'] as const
const itemKey = (id: number) => ['trash-item', id] as const

function buildQuery(filters: TrashFilters): string {
  const p = new URLSearchParams()
  if (filters.entityType) p.set('entityType', filters.entityType)
  if (filters.search) p.set('search', filters.search)
  if (filters.limit !== undefined) p.set('limit', String(filters.limit))
  if (filters.offset !== undefined) p.set('offset', String(filters.offset))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function useTrashItems(filters: TrashFilters = {}) {
  return useQuery({
    queryKey: [LIST_KEY, filters],
    queryFn: () =>
      api.get<{ ok: true; items: TrashItem[]; total: number }>(`/admin/trash${buildQuery(filters)}`),
    staleTime: 15_000,
  })
}

export function useTrashStats() {
  return useQuery({
    queryKey: STATS_KEY,
    queryFn: () => api.get<{ ok: true } & TrashStats>('/admin/trash/stats'),
    staleTime: 30_000,
  })
}

export function useTrashItem(id: number | null) {
  return useQuery({
    queryKey: id ? itemKey(id) : ['trash-item', 'none'],
    queryFn: () => api.get<{ ok: true; item: TrashItemDetail }>(`/admin/trash/${id}`),
    enabled: id !== null,
    staleTime: 60_000,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: [LIST_KEY] })
  void qc.invalidateQueries({ queryKey: STATS_KEY })
}

export function useRestoreTrashItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: true; entityType: string; entityLabel: string; restoredId: number }>(
        `/admin/trash/${id}/restore`,
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useBulkRestoreTrashItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (trashIds: number[]) =>
      api.post<{ ok: true; restored: number; failed: number }>(
        '/admin/trash/restore-bulk',
        { trashIds },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteTrashItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/trash/${id}`),
    onSuccess: () => invalidateAll(qc),
  })
}

export function usePurgeExpiredTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.delete<{ ok: true; purged: number }>('/admin/trash/purge'),
    onSuccess: () => invalidateAll(qc),
  })
}

export const TRASH_TYPE_LABELS: Record<string, string> = {
  lead: 'Lead',
  funnel: 'Funil',
  chatbot: 'Chatbot',
  tag: 'Tag',
  template: 'Template',
  form: 'Formulário',
  page: 'Landing Page',
  workflow: 'Workflow',
  user: 'Usuário',
  edu_level: 'Nível de ensino',
  edu_modality: 'Modalidade',
  edu_unit: 'Unidade',
  edu_campus: 'Local de oferta',
  edu_course: 'Curso',
  edu_offering: 'Oferta',
  edu_selection_process: 'Processo seletivo',
  edu_entry_mode: 'Modo de ingresso',
}

// Tom de Badge por tipo — paridade com `TRASH_TYPE_COLORS` do legado
// (admin.js:489-496). Como Badge tem só 6 tons (neutral/accent/success/
// warning/danger/info) vs 17 tipos, agrupamos logicamente para preservar
// a distinção visual rápida que o legado oferecia.
type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export const TRASH_TYPE_TONES: Record<string, BadgeTone> = {
  lead: 'info',
  funnel: 'accent',
  chatbot: 'success',
  tag: 'warning',
  template: 'neutral',
  form: 'info',
  page: 'success',
  workflow: 'warning',
  user: 'accent',
  edu_level: 'info',
  edu_modality: 'neutral',
  edu_unit: 'accent',
  edu_campus: 'warning',
  edu_course: 'success',
  edu_offering: 'success',
  edu_selection_process: 'accent',
  edu_entry_mode: 'danger',
}
