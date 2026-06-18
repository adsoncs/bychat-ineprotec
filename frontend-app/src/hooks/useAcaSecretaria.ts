import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface HistDisciplina { nome: string; cargaHoraria: number; media: number | null; freqPct: number | null; situacao: string }
export interface HistPeriodo { periodo: string; turma: string; disciplinas: HistDisciplina[] }
export interface Historico { aluno: { nome: string; ra: string | null; cpf: string | null }; curso: string; periodos: HistPeriodo[]; chTotal: number }
export interface Documento { id: number; numero: string; tipo: string; alunoId: number | null; turmaId: number | null; titulo: string; emitidoEm: string }

export const TIPO_DOC_LABEL: Record<string, string> = {
  HISTORICO: 'Histórico Escolar', DECLARACAO_MATRICULA: 'Declaração de Matrícula',
  DECLARACAO_FREQUENCIA: 'Declaração de Frequência', ATA_RESULTADOS: 'Ata de Resultados',
}

export function useHistorico(alunoId: number | null) {
  return useQuery({
    queryKey: ['aca-historico', alunoId],
    queryFn: () => api.get<Historico>(`/admin/aca/alunos/${alunoId}/historico`),
    enabled: alunoId !== null, staleTime: 5_000,
  })
}

export function useDocumentos(filtro: { alunoId?: number; turmaId?: number }) {
  const qs = new URLSearchParams()
  if (filtro.alunoId) qs.set('alunoId', String(filtro.alunoId))
  if (filtro.turmaId) qs.set('turmaId', String(filtro.turmaId))
  return useQuery({
    queryKey: ['aca-documentos', filtro.alunoId ?? null, filtro.turmaId ?? null],
    queryFn: () => api.get<{ documentos: Documento[] }>(`/admin/aca/documentos?${qs.toString()}`),
    enabled: !!(filtro.alunoId || filtro.turmaId), staleTime: 3_000,
  })
}

export function useDocumentoMut(filtro: { alunoId?: number; turmaId?: number }) {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-documentos', filtro.alunoId ?? null, filtro.turmaId ?? null] })
  return {
    emitir: useMutation({ mutationFn: (b: { tipo: string; alunoId?: number; turmaId?: number }) => api.post<{ documento: Documento }>('/admin/aca/documentos', b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/documentos/${id}`), onSuccess: inval }),
  }
}

/** Gera um magic link de portal (aluno ou professor). Retorna a URL. */
export async function gerarLinkPortal(tipo: 'aluno' | 'professor', id: number, dias = 30): Promise<string> {
  const r = await api.post<{ url: string }>('/admin/aca/portal/link', { tipo, id, dias })
  return r.url
}

/** Baixa o PDF com Authorization e abre em nova aba (blob URL). */
export async function abrirDocumentoPdf(id: number) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}/admin/aca/documentos/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('Falha ao gerar PDF')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
