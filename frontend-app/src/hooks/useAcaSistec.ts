import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface SistecPreview { total: number; porSituacao: Record<string, number>; semCpf: number; amostra: Array<{ nome: string; cpf: string; curso: string; turma: string; situacao: string }> }

export const SISTEC_LABEL: Record<string, string> = {
  EM_CURSO: 'Em curso', CONCLUIDA: 'Concluída', ABANDONO: 'Abandono', TRANCADA: 'Trancada',
  TRANSFERIDO_EXTERNO: 'Transf. externa', DESLIGADO: 'Desligado',
}

function qs(f: { periodoLetivoId?: number | null; turmaId?: number | null }) {
  const p = new URLSearchParams()
  if (f.periodoLetivoId) p.set('periodoLetivoId', String(f.periodoLetivoId))
  if (f.turmaId) p.set('turmaId', String(f.turmaId))
  return p.toString()
}

export function useSistecPreview(f: { periodoLetivoId?: number | null; turmaId?: number | null }) {
  return useQuery({ queryKey: ['aca-sistec', f.periodoLetivoId ?? null, f.turmaId ?? null], queryFn: () => api.get<SistecPreview>(`/admin/aca/sistec/preview?${qs(f)}`), staleTime: 5_000 })
}

export async function exportSistecCsv(f: { periodoLetivoId?: number | null; turmaId?: number | null }) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}/admin/aca/sistec/export.csv?${qs(f)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao exportar')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'sistec-censo.csv'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
