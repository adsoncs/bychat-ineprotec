import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type DbType = 'mysql' | 'postgres'
export type DeltaStrategy = 'id' | 'timestamp' | 'none'
export type RunStatus = 'running' | 'ok' | 'error' | 'partial'

export interface DbConnector {
  id: number
  name: string
  description: string | null
  dbType: DbType
  host: string
  port: number
  dbName: string
  dbUser: string
  useTLS: boolean
  query: string
  mapping: Record<string, string>
  deltaStrategy: DeltaStrategy
  deltaColumn: string | null
  lastSyncCursor: string | null
  intervalMinutes: number
  active: boolean
  lastRunAt: string | null
  lastRunStatus: 'ok' | 'error' | 'running' | null
  lastError: string | null
  totalImported: number
  defaultTeamId: number | null
  defaultFunnelId: number | null
  defaultStageKey: string | null
  createdAt: string
  updatedAt: string
}

export interface DbConnectorInput {
  name: string
  description?: string | null
  dbType: DbType
  host: string
  port: number
  dbName: string
  dbUser: string
  password?: string
  useTLS?: boolean
  caCert?: string | null
  query: string
  mapping: Record<string, string>
  deltaStrategy?: DeltaStrategy
  deltaColumn?: string | null
  lastSyncCursor?: string | null
  intervalMinutes?: number
  active?: boolean
  defaultTeamId?: number | null
  defaultFunnelId?: number | null
  defaultStageKey?: string | null
}

export interface DbConnectorRun {
  id: number
  connectorId: number
  startedAt: string
  finishedAt: string | null
  status: RunStatus
  rowsRead: number
  leadsCreated: number
  leadsSkipped: number
  errorCount: number
  cursorBefore: string | null
  cursorAfter: string | null
  error: string | null
  triggeredBy: 'cron' | 'manual' | 'test'
  triggeredByUserId: number | null
}

export function useDbConnectors() {
  return useQuery<{ items: DbConnector[] }>({
    queryKey: ['db-connectors'],
    queryFn: () => api.get('/admin/db-connectors'),
  })
}

export function useDbConnector(id: number | null) {
  return useQuery<{ item: DbConnector }>({
    queryKey: ['db-connectors', id],
    queryFn: () => api.get(`/admin/db-connectors/${id}`),
    enabled: !!id,
  })
}

export function useCreateDbConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: DbConnectorInput) => api.post<{ item: DbConnector }>('/admin/db-connectors', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-connectors'] }),
  })
}

export function useUpdateDbConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DbConnectorInput> }) =>
      api.patch<{ item: DbConnector }>(`/admin/db-connectors/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-connectors'] }),
  })
}

export function useDeleteDbConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/db-connectors/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-connectors'] }),
  })
}

export function useTestDbConnection() {
  return useMutation({
    mutationFn: (data: Partial<DbConnectorInput> & { connectorId?: number }) =>
      api.post<{ ok: boolean; error?: string }>('/admin/db-connectors/test-connection', data),
  })
}

export function usePreviewDbConnector() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; rowsRead: number; preview: Record<string, unknown>[]; error?: string }>(`/admin/db-connectors/${id}/preview`, {}),
  })
}

export function useRunDbConnectorNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ ok: boolean; rowsRead: number; leadsCreated: number; leadsSkipped: number; errors: number; cursorAfter: string | null }>(`/admin/db-connectors/${id}/run-now`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db-connectors'] })
      qc.invalidateQueries({ queryKey: ['db-connector-runs'] })
    },
  })
}

export function useDbConnectorRuns(id: number | null, limit = 50) {
  return useQuery<{ items: DbConnectorRun[] }>({
    queryKey: ['db-connector-runs', id, limit],
    queryFn: () => api.get(`/admin/db-connectors/${id}/runs?limit=${limit}`),
    enabled: !!id,
  })
}
