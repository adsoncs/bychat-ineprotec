// hooks/useLeadsImport.ts
// Hooks do módulo de importação de leads via planilha.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export type TargetField =
  | 'empresa' | 'nome' | 'whatsapp' | 'email' | 'cidade' | 'segmento'
  | 'funnelName' | 'stageName' | 'status' | 'lossReasonName' | 'ownerEmail'
  | 'tags'
  | 'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmContent' | 'utmTerm' | 'sourceId'
  | { kind: 'customField'; key: string; label: string; type: 'text' | 'number' | 'select' }
  | { kind: 'ignore' }

export interface MappingEntry {
  source: string
  target: TargetField
}

export interface ImportOptions {
  matchBy: 'whatsapp_first' | 'email_first' | 'whatsapp_only'
  overrideFilled: boolean
  createMissingFields: boolean
  migrationMode: boolean
}

export interface PreviewResponse {
  importId: number
  fileName: string
  headers: string[]
  sampleRows: Record<string, string>[]
  totalRows: number
  suggestedMapping: MappingEntry[]
  previewExpiresAt: string
}

export interface PlanRow {
  lineIndex: number
  action: 'create' | 'update' | 'skip' | 'invalid'
  existingLeadId: number | null
  matchReason: string | null
  rawValues: Record<string, string>
  parsedFields: Record<string, unknown>
  diff: Array<{ field: string; oldValue: unknown; newValue: unknown; action: 'fill' | 'skip-already-set' | 'override' }>
  errors: string[]
}

export interface ImportPlan {
  summary: { total: number; new: number; update: number; skip: number; invalid: number }
  rows: PlanRow[]
  newCustomFields: Array<{ key: string; label: string; type: string }>
}

export interface CommitResult {
  ok: boolean
  result: {
    created: number
    updated: number
    skipped: number
    failed: Array<{ lineIndex: number; error: string }>
  }
}

export interface ImportHistoryEntry {
  id: number
  fileName: string
  fileSize: number | null
  status: 'preview' | 'running' | 'done' | 'failed' | 'expired'
  totals: { created: number; updated: number; skipped: number; failed: any[] } | null
  errors: any | null
  createdAt: string
  finishedAt: string | null
  importedBy: { id: number; name: string; email: string } | null
}

export function useUploadImport() {
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file, file.name)
      return api.post<PreviewResponse>('/admin/leads/import/preview', fd)
    },
  })
}

export function useComputePlan() {
  return useMutation({
    mutationFn: (input: { importId: number; mapping: MappingEntry[]; options: ImportOptions }) =>
      api.post<ImportPlan>('/admin/leads/import/preview/plan', input),
  })
}

export function useCommitImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      importId: number
      mapping: MappingEntry[]
      options: ImportOptions
      acceptedLineIndices: number[]
    }) => api.post<CommitResult>('/admin/leads/import/commit', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['kanban'] })
    },
  })
}

export function useImportHistory(limit = 20) {
  return useQuery({
    queryKey: ['leads-import', 'history', limit],
    queryFn: () => api.get<{ imports: ImportHistoryEntry[] }>(`/admin/leads/import/history?limit=${limit}`),
    staleTime: 30_000,
  })
}
