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

export interface ContratoTemplate { id: number; nome: string; tipoNegocio: string; descricao: string | null; corpoTexto: string; config: any; signatariosPadrao: any; ativo: boolean; ordem: number }
export interface ContratoGatilho { id: number; nome: string; evento: string; templateId: number | null; autoPorTipo: boolean; templateNome: string | null; filtroTipoNegocio: string | null; autoEnviar: boolean; ativo: boolean }
export interface Variavel { chave: string; desc: string }

export const TIPO_NEGOCIO: Array<{ key: string; label: string }> = [
  { key: 'GRADUACAO', label: 'Graduação' }, { key: 'POS_GRADUACAO', label: 'Pós-graduação' }, { key: 'ESPECIALIZACAO', label: 'Especialização' },
  { key: 'MBA', label: 'MBA' }, { key: 'TECNICO_TRADICIONAL', label: 'Técnico (tradicional)' }, { key: 'CERTIFICACAO_COMPETENCIA', label: 'Certificação por competência' },
  { key: 'EXTENSAO', label: 'Extensão' }, { key: 'CURSO_LIVRE', label: 'Curso livre' }, { key: 'IDIOMAS', label: 'Idiomas' }, { key: 'OUTRO', label: 'Outro' },
]
export const EVENTO_LABEL: Record<string, string> = { MANUAL: 'Manual', MATRICULA_CRIADA: 'Matrícula efetivada', INSCRICAO_APROVADA: 'Inscrição aprovada', CONTRATO_FINANCEIRO_CRIADO: 'Contrato financeiro criado' }
export const ACAO_LABEL: Record<string, string> = { SIGN: 'Assinar', APPROVE: 'Aprovar', RECOGNIZE: 'Reconhecer', WITNESS: 'Testemunhar' }
export const tipoNegocioLabel = (k: string) => TIPO_NEGOCIO.find((t) => t.key === k)?.label ?? k

export const useTemplates = () => useQuery({ queryKey: ['aca-ct-templates'], queryFn: () => api.get<{ templates: ContratoTemplate[] }>('/admin/aca/assinatura/templates'), staleTime: 10_000 })
export const useGatilhos = () => useQuery({ queryKey: ['aca-ct-gatilhos'], queryFn: () => api.get<{ gatilhos: ContratoGatilho[] }>('/admin/aca/assinatura/gatilhos'), staleTime: 10_000 })
export const useVariaveis = () => useQuery({ queryKey: ['aca-ct-vars'], queryFn: () => api.get<{ variaveis: Variavel[] }>('/admin/aca/assinatura/variaveis'), staleTime: 120_000 })

export function useTemplateMut() {
  const qc = useQueryClient(); const inval = () => void qc.invalidateQueries({ queryKey: ['aca-ct-templates'] })
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/assinatura/templates', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`/admin/aca/assinatura/templates/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/assinatura/templates/${id}`), onSuccess: inval }),
  }
}
export function useGatilhoMut() {
  const qc = useQueryClient(); const inval = () => void qc.invalidateQueries({ queryKey: ['aca-ct-gatilhos'] })
  return {
    criar: useMutation({ mutationFn: (b: any) => api.post('/admin/aca/assinatura/gatilhos', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`/admin/aca/assinatura/gatilhos/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/assinatura/gatilhos/${id}`), onSuccess: inval }),
  }
}

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
    criarDeTemplate: useMutation({ mutationFn: (b: any) => api.post<{ envelope: EnvelopeDetail }>('/admin/aca/assinatura/de-template', b), onSuccess: () => inval() }),
    enviar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/enviar`), onSuccess: (_d, id) => inval(id) }),
    reenviar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/reenviar`), onSuccess: (_d, id) => inval(id) }),
    sincronizar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/sincronizar`), onSuccess: (_d, id) => inval(id) }),
    cancelar: useMutation({ mutationFn: (id: number) => api.post(`/admin/aca/assinatura/${id}/cancelar`), onSuccess: (_d, id) => inval(id) }),
    simular: useMutation({ mutationFn: ({ id, sid }: { id: number; sid: number }) => api.post(`/admin/aca/assinatura/${id}/simular/${sid}`), onSuccess: (_d, v) => inval(v.id) }),
    setConfig: useMutation({ mutationFn: (b: any) => api.put('/admin/aca/assinatura/config', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-assinatura-config'] }) }),
  }
}
