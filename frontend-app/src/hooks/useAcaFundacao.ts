import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Fundação acadêmica (Fase 1): hierarquia institucional, ciclo de vida da
// matriz e vínculo do aluno com máquina de estados.

export interface Mantenedora {
  id: number
  razaoSocial: string
  nomeFantasia?: string | null
  cnpj?: string | null
  repNome?: string | null
  repCpf?: string | null
  repCargo?: string | null
  telefone?: string | null
  email?: string | null
  ativo: boolean
  _count?: { ies: number }
}

export interface Ies {
  id: number
  mantenedoraId: number
  nome: string
  sigla?: string | null
  codigoEmec?: string | null
  categoriaAdmin?: string | null
  organizacaoAcad?: string | null
  dirigenteNome?: string | null
  dirigenteCpf?: string | null
  dirigenteEmail?: string | null
  piNome?: string | null
  piCpf?: string | null
  piEmail?: string | null
  ativo: boolean
  mantenedora?: { razaoSocial: string }
}

export interface Ato {
  id: number
  escopo: 'IES' | 'CURSO'
  entidadeId: number
  tipo: string
  numero?: string | null
  dataPublicacao?: string | null
  dataDou?: string | null
  validadeAte?: string | null
  observacao?: string | null
  ativo: boolean
  diasParaVencer: number | null
  alerta: 'vencido' | 'critico' | 'atencao' | 'proximo' | null
}

export type VinculoSituacao =
  | 'PRE_MATRICULADO' | 'ATIVO' | 'TRANCADO' | 'EVADIDO'
  | 'TRANSFERIDO' | 'CANCELADO' | 'FORMADO' | 'DIPLOMADO' | 'FALECIDO'

export interface VinculoMovimentacao {
  id: number
  de: VinculoSituacao | null
  para: VinculoSituacao
  motivo?: string | null
  observacao?: string | null
  dataEfeito: string
  userName?: string | null
  estornoDeId?: number | null
}

export interface Vinculo {
  id: number
  alunoId: number
  courseId: number
  matrizId?: number | null
  unidadeId?: number | null
  ra?: string | null
  situacao: VinculoSituacao
  formaIngresso?: string | null
  turno?: string | null
  periodoAtual?: number | null
  dataIngresso?: string | null
  dataConclusao?: string | null
  sensivel: boolean
  aluno?: { id: number; ra?: string | null; cpf?: string | null; lead?: { nome?: string | null; whatsapp?: string | null; email?: string | null } }
  movimentacoes?: VinculoMovimentacao[]
  matriculas?: Array<{ id: number; turmaId: number; status: string; dataMatricula: string }>
  _count?: { matriculas: number; movimentacoes: number }
}

export interface ProblemaValidacao {
  tipo: 'ciclo_prerequisito' | 'ch_divergente' | 'componente_invalido' | 'sem_componentes'
  mensagem: string
}

const K = {
  mantenedoras: ['aca', 'mantenedoras'] as const,
  ies: ['aca', 'ies'] as const,
  atos: ['aca', 'atos'] as const,
  vinculos: ['aca', 'vinculos'] as const,
}

// ── Hierarquia institucional ──

export function useMantenedoras() {
  return useQuery({
    queryKey: K.mantenedoras,
    queryFn: () => api.get<{ mantenedoras: Mantenedora[] }>('/admin/aca/mantenedoras'),
  })
}

export function useSaveMantenedora() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Mantenedora> & { endereco?: unknown }) =>
      id
        ? api.put<{ mantenedora: Mantenedora }>(`/admin/aca/mantenedoras/${id}`, body)
        : api.post<{ mantenedora: Mantenedora }>('/admin/aca/mantenedoras', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.mantenedoras }) },
  })
}

export function useIesList(mantenedoraId?: number) {
  return useQuery({
    queryKey: [...K.ies, mantenedoraId ?? null],
    queryFn: () => api.get<{ ies: Ies[] }>(`/admin/aca/ies${mantenedoraId ? `?mantenedoraId=${mantenedoraId}` : ''}`),
  })
}

export function useSaveIes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Ies>) =>
      id ? api.put<{ ies: Ies }>(`/admin/aca/ies/${id}`, body) : api.post<{ ies: Ies }>('/admin/aca/ies', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.ies }) },
  })
}

export function useAtos(escopo?: 'IES' | 'CURSO', entidadeId?: number) {
  const qs = new URLSearchParams()
  if (escopo) qs.set('escopo', escopo)
  if (entidadeId) qs.set('entidadeId', String(entidadeId))
  return useQuery({
    queryKey: [...K.atos, escopo ?? null, entidadeId ?? null],
    queryFn: () => api.get<{ atos: Ato[] }>(`/admin/aca/atos${qs.toString() ? `?${qs}` : ''}`),
  })
}

export function useCreateAto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Ato>) => api.post<{ ato: Ato }>('/admin/aca/atos', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.atos }) },
  })
}

export function useRemoveAto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/aca/atos/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.atos }) },
  })
}

// ── Matriz curricular ──

export function useMatrizValidacao(id: number | null) {
  return useQuery({
    queryKey: ['aca', 'matriz-validacao', id],
    queryFn: () => api.get<{ ok: boolean; problemas: ProblemaValidacao[] }>(`/admin/aca/matrizes/${id}/validacao`),
    enabled: !!id,
  })
}

export function useAtivarMatriz() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ matriz: unknown }>(`/admin/aca/matrizes/${id}/ativar`, {}),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca'] }) },
  })
}

export function useMudarStatusMatriz() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'ATIVA' | 'SUSPENSA' | 'EXTINTA' }) =>
      api.post<{ matriz: unknown }>(`/admin/aca/matrizes/${id}/status`, { status }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca'] }) },
  })
}

export function useClonarMatriz() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, versao }: { id: number; versao: string }) =>
      api.post<{ matriz: { id: number; versao: string } }>(`/admin/aca/matrizes/${id}/clonar`, { versao }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca'] }) },
  })
}

// ── Vínculo acadêmico ──

export function useVinculos(filtros: { situacao?: string; courseId?: number; limit?: number } = {}) {
  const qs = new URLSearchParams()
  if (filtros.situacao) qs.set('situacao', filtros.situacao)
  if (filtros.courseId) qs.set('courseId', String(filtros.courseId))
  qs.set('limit', String(filtros.limit ?? 50))
  return useQuery({
    queryKey: [...K.vinculos, filtros.situacao ?? null, filtros.courseId ?? null],
    queryFn: () => api.get<{ vinculos: Vinculo[]; total: number }>(`/admin/aca/vinculos?${qs}`),
  })
}

export function useVinculo(id: number | null) {
  return useQuery({
    queryKey: [...K.vinculos, id],
    queryFn: () => api.get<{ vinculo: Vinculo; proximasSituacoes: VinculoSituacao[] }>(`/admin/aca/vinculos/${id}`),
    enabled: !!id,
  })
}

export function useMoverVinculo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; para: VinculoSituacao; motivo?: string; observacao?: string; dataEfeito?: string }) =>
      api.post<{ vinculo: Vinculo }>(`/admin/aca/vinculos/${id}/mover`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.vinculos }) },
  })
}

export function useEstornarMovimentacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ movId, motivo }: { movId: number; motivo?: string }) =>
      api.post<{ vinculo: Vinculo }>(`/admin/aca/vinculos/movimentacoes/${movId}/estornar`, { motivo }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: K.vinculos }) },
  })
}

/** Rótulos e tom das situações — usados na listagem e no prontuário. */
export const SITUACAO_LABEL: Record<VinculoSituacao, string> = {
  PRE_MATRICULADO: 'Pré-matriculado',
  ATIVO: 'Ativo',
  TRANCADO: 'Trancado',
  EVADIDO: 'Evadido',
  TRANSFERIDO: 'Transferido',
  CANCELADO: 'Cancelado',
  FORMADO: 'Formado',
  DIPLOMADO: 'Diplomado',
  FALECIDO: 'Falecido',
}

export const SITUACAO_TONE: Record<VinculoSituacao, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  PRE_MATRICULADO: 'info',
  ATIVO: 'success',
  TRANCADO: 'warning',
  EVADIDO: 'danger',
  TRANSFERIDO: 'neutral',
  CANCELADO: 'danger',
  FORMADO: 'success',
  DIPLOMADO: 'success',
  FALECIDO: 'neutral',
}
