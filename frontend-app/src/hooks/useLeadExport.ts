import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { downloadFile } from '@/lib/download'

export type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'html'

export interface ExportSection {
  id: string
  label: string
  module: string | null
}

/** Catálogo de seções de dados que podem ser exportadas (alimenta o seletor). */
export function useLeadExportSections() {
  return useQuery({
    queryKey: ['lead-export-sections'],
    queryFn: () => api.get<{ sections: ExportSection[] }>('/admin/leads/export/sections'),
    staleTime: 5 * 60_000,
  })
}

const EXT: Record<ExportFormat, string> = { xlsx: 'xlsx', csv: 'csv', pdf: 'pdf', html: 'html' }

/**
 * Dispara a exportação (download autenticado via POST). `sections` vazio = todas.
 * O nome do arquivo é definido aqui; o backend também manda Content-Disposition.
 */
export async function exportLeads(params: {
  leadIds: number[]
  sections: string[]
  format: ExportFormat
}): Promise<void> {
  const { leadIds, sections, format } = params
  const stamp = new Date().toISOString().slice(0, 10)
  const base = leadIds.length === 1 ? `lead-${leadIds[0]}` : `leads-${leadIds.length}`
  await downloadFile('/admin/leads/export', `${base}-${stamp}.${EXT[format]}`, {
    method: 'POST',
    body: { leadIds, sections, format },
  })
}
