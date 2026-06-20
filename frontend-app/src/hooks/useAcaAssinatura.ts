import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export async function abrirPdfContrato(id: number) {
  const token = (() => { try { return localStorage.getItem(env.authTokenKey) } catch { return null } })()
  const res = await fetch(`${env.apiBase}/admin/aca/assinatura/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error('PDF indisponível')
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export interface EnvelopeRow { id: number; titulo: string; status: string; provider: string; enviadoEm: string | null; finalizadoEm: string | null; alunoNome: string | null; ra: string | null; totalSignatarios: number; assinados: number }
export interface Signatario { id: number; nome: string; email: string | null; papel: string; status: string; linkAssinatura: string | null; publicId: string | null; assinadoEm: string | null; viewedEm: string | null; rejeitadoEm: string | null; ordem: number }
export interface EnvelopeDetail { id: number; titulo: string; status: string; provider: string; alunoId: number | null; contratoId: number | null; documentoExternoId: string | null; enviadoEm: string | null; finalizadoEm: string | null; termoTexto: string | null; arquivoAssinadoUrl: string | null; signatarios: Signatario[] }
export interface AssinaturaConfig { modo: 'SIMULADO' | 'AUTENTIQUE'; sandbox: boolean; tokenConfigurado: boolean }

export const ENV_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }> = {
  RASCUNHO: { label: 'Rascunho', tone: 'neutral' }, ENVIADO: { label: 'Enviado', tone: 'info' },
  PARCIAL: { label: 'Parcial', tone: 'warning' }, ASSINADO: { label: 'Assinado', tone: 'success' },
  REJEITADO: { label: 'Rejeitado', tone: 'danger' }, CANCELADO: { label: 'Cancelado', tone: 'neutral' },
}
export const SIG_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  PENDENTE: { label: 'Pendente', tone: 'neutral' }, VISUALIZADO: { label: 'Visualizado', tone: 'info' },
  ASSINADO: { label: 'Assinado', tone: 'success' }, REJEITADO: { label: 'Rejeitado', tone: 'danger' },
}
export const PAPEL_LABEL: Record<string, string> = { ALUNO: 'Aluno', RESPONSAVEL: 'Responsável', FIADOR: 'Fiador', INSTITUICAO: 'Instituição', TESTEMUNHA: 'Testemunha' }

export const useEnvelopes = (status: string) =>
  useQuery({ queryKey: ['aca-assinaturas', status], queryFn: () => api.get<{ envelopes: EnvelopeRow[] }>(`/admin/aca/assinatura${status ? `?status=${status}` : ''}`), staleTime: 3_000 })

export const useEnvelope = (id: number | null) =>
  useQuery({ queryKey: ['aca-assinatura', id], queryFn: () => api.get<{ envelope: EnvelopeDetail }>(`/admin/aca/assinatura/${id}`), enabled: id !== null })

export const useAssinaturaConfig = () =>
  useQuery({ queryKey: ['aca-assinatura-config'], queryFn: () => api.get<AssinaturaConfig>('/admin/aca/assinatura/config'), staleTime: 30_000 })

export function useAssinaturaMut() {
  const qc = useQueryClient()
  const inval = (id?: number) => { void qc.invalidateQueries({ queryKey: ['aca-assinaturas'] }); if (id) void qc.invalidateQueries({ queryKey: ['aca-assinatura', id] }) }
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post<{ envelope: EnvelopeDetail }>('/admin/aca/assinatura', b), onSuccess: () => inval() }),
    enviar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/enviar`), onSuccess: (_d, id) => inval(id) }),
    sincronizar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/sincronizar`), onSuccess: (_d, id) => inval(id) }),
    cancelar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/cancelar`), onSuccess: (_d, id) => inval(id) }),
    simular: useMutation({ mutationFn: ({ id, sid }: { id: number; sid: number }) => api.post(`/admin/aca/assinatura/${id}/simular/${sid}`), onSuccess: (_d, v) => inval(v.id) }),
    setConfig: useMutation({ mutationFn: (b: any) => api.put('/admin/aca/assinatura/config', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-assinatura-config'] }) }),
  }
}
