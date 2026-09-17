import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface AuditLogEntry {
  id: number
  action: string
  actorName: string | null
  actorId: number | null
  userId: number | null
  targetType: string | null
  targetLabel: string | null
  changes: Record<string, unknown> | null
  ipAddress: string | null
  createdAt: string
}

export interface AuditLogResponse {
  data: AuditLogEntry[]
  total: number
  limit: number
  offset: number
  targetTypes: string[]
}

export interface AuditLogFilters {
  targetType?: string
  action?: string
  actorId?: number
  limit?: number
  offset?: number
}

// Log de auditoria GERAL (superadmin) — quem mexeu no quê, no sistema inteiro.
// Diferente de useUserAudit: aquele é o histórico de UM usuário; este não
// exige saber de antemão quem suspeitar.
export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ['admin-audit-log', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.targetType) params.set('targetType', filters.targetType)
      if (filters.action) params.set('action', filters.action)
      if (filters.actorId) params.set('actorId', String(filters.actorId))
      params.set('limit', String(filters.limit ?? 50))
      params.set('offset', String(filters.offset ?? 0))
      return api.get<AuditLogResponse>(`/admin/audit-log?${params.toString()}`)
    },
    staleTime: 15_000,
  })
}
