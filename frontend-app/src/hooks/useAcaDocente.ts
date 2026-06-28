import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/docente'

export interface UsuarioDoc { id: number; name: string; email: string; jaDocente: boolean }
export interface Docente { id: number; userId: number; nome: string; email: string | null; titulacao: string | null; regime: string; valorHoraCentavos: number; ativo: boolean; aceites: number }
export interface TipoAtividade { id: number; nome: string; fatorHora: number; ativo: boolean }
export interface AtividadeDoc { id: number; docenteId: number; tipoId: number; tipoNome: string; competencia: string; descricao: string | null; horas: number; valorHoraCentavos: number; fatorHora: number; valorCentavos: number; status: string }
export interface AceiteDoc { id: number; docenteId: number; diarioId: number; status: string; observacao: string | null; diario: { turma: string; disciplina: string } | null }
export interface ResumoDoc { competencia: string; totalHoras: number; totalValorCentavos: number; docentes: Array<{ docenteId: number; nome: string; horas: number; valor: number; qtd: number }> }

export const REGIME_LABEL: Record<string, string> = { HORISTA: 'Horista', PARCIAL: 'Parcial', INTEGRAL: 'Integral' }

export const useUsuariosDoc = (q: string) =>
  useQuery({ queryKey: ['aca-doc-users', q], queryFn: () => api.get<{ usuarios: UsuarioDoc[] }>(`${base}/usuarios${q ? `?q=${encodeURIComponent(q)}` : ''}`), staleTime: 10_000 })
export const useDocentes = () =>
  useQuery({ queryKey: ['aca-doc-docentes'], queryFn: () => api.get<{ docentes: Docente[] }>(`${base}/docentes`), staleTime: 5_000 })
export const useTiposAtividade = () =>
  useQuery({ queryKey: ['aca-doc-tipos'], queryFn: () => api.get<{ tipos: TipoAtividade[] }>(`${base}/tipos`), staleTime: 10_000 })
export const useAtividadesDoc = (docenteId?: number, competencia?: string) => {
  const qs = new URLSearchParams()
  if (docenteId) qs.set('docenteId', String(docenteId)); if (competencia) qs.set('competencia', competencia)
  const s = qs.toString()
  return useQuery({ queryKey: ['aca-doc-ativ', docenteId, competencia], queryFn: () => api.get<{ atividades: AtividadeDoc[] }>(`${base}/atividades${s ? `?${s}` : ''}`), staleTime: 3_000 })
}
export const useAceitesDoc = (docenteId: number | null) =>
  useQuery({ queryKey: ['aca-doc-aceites', docenteId], queryFn: () => api.get<{ aceites: AceiteDoc[] }>(`${base}/aceites?docenteId=${docenteId}`), enabled: docenteId !== null, staleTime: 3_000 })

export function useDocenteMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    criarDocente: useMutation({ mutationFn: (b: any) => api.post(`${base}/docentes`, b), onSuccess: () => inval('aca-doc-docentes', 'aca-doc-users') }),
    atualizarDocente: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/docentes/${id}`, b), onSuccess: () => inval('aca-doc-docentes') }),
    criarTipo: useMutation({ mutationFn: (b: any) => api.post(`${base}/tipos`, b), onSuccess: () => inval('aca-doc-tipos') }),
    criarAtividade: useMutation({ mutationFn: (b: any) => api.post(`${base}/atividades`, b), onSuccess: () => inval('aca-doc-ativ') }),
    delAtividade: useMutation({ mutationFn: (id: number) => api.delete(`${base}/atividades/${id}`), onSuccess: () => inval('aca-doc-ativ') }),
    statusAtividade: useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.put(`${base}/atividades/${id}`, { status }), onSuccess: () => inval('aca-doc-ativ') }),
    calcular: useMutation({ mutationFn: (competencia: string) => api.post<ResumoDoc>(`${base}/atividades/calcular`, { competencia }) }),
    gerarAceites: useMutation({ mutationFn: (docenteId: number) => api.post<{ criados: number }>(`${base}/aceites/gerar`, { docenteId }), onSuccess: () => inval('aca-doc-aceites') }),
    decidirAceite: useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.put(`${base}/aceites/${id}`, { status }), onSuccess: () => inval('aca-doc-aceites') }),
  }
}
