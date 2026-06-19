import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/vestibular'

export interface Processo { id: number; nome: string; periodoLetivo: string | null; notaCorte: number | null; status: string; candidatos: number }
export interface Candidato { id: number; nome: string; status: string; statusLabel: string; notaFinal: number | null; posicao: number | null; notas: Record<number, number>; sala: { nome: string; ordem: number } | null }
export interface ComponenteVest { id: number; selectionProcessId: number; nome: string; peso: number; ordem: number }
export interface SalaVest { id: number; selectionProcessId: number; nome: string; local: string | null; capacidade: number }

export const useProcessos = () =>
  useQuery({ queryKey: ['aca-vest-proc'], queryFn: () => api.get<{ processos: Processo[] }>(`${base}/processos`), staleTime: 10_000 })
export const useCandidatos = (processoId: number | null) =>
  useQuery({ queryKey: ['aca-vest-cand', processoId], queryFn: () => api.get<{ candidatos: Candidato[]; counts: Record<string, number> }>(`${base}/processos/${processoId}/candidatos`), enabled: processoId !== null, staleTime: 3_000 })
export const useComponentesVest = (processoId: number | null) =>
  useQuery({ queryKey: ['aca-vest-comp', processoId], queryFn: () => api.get<{ componentes: ComponenteVest[] }>(`${base}/componentes?processoId=${processoId}`), enabled: processoId !== null, staleTime: 10_000 })
export const useSalasVest = (processoId: number | null) =>
  useQuery({ queryKey: ['aca-vest-salas', processoId], queryFn: () => api.get<{ salas: SalaVest[] }>(`${base}/salas?processoId=${processoId}`), enabled: processoId !== null, staleTime: 10_000 })

export function useVestibularMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    criarComponente: useMutation({ mutationFn: (b: any) => api.post(`${base}/componentes`, b), onSuccess: () => inval('aca-vest-comp', 'aca-vest-cand') }),
    delComponente: useMutation({ mutationFn: (id: number) => api.delete(`${base}/componentes/${id}`), onSuccess: () => inval('aca-vest-comp', 'aca-vest-cand') }),
    salvarNotas: useMutation({ mutationFn: (b: { notas: any[] }) => api.post<{ salvas: number }>(`${base}/notas`, b), onSuccess: () => inval('aca-vest-cand') }),
    classificar: useMutation({ mutationFn: (b: { selectionProcessId: number; criterio: string }) => api.post<{ total: number; classificados: number; reprovados: number }>(`${base}/classificar`, b), onSuccess: () => inval('aca-vest-cand') }),
    convocar: useMutation({ mutationFn: (b: { selectionProcessId: number; qtdVagas: number }) => api.post<{ convocados: number }>(`${base}/convocar`, b), onSuccess: () => inval('aca-vest-cand') }),
    criarSala: useMutation({ mutationFn: (b: any) => api.post(`${base}/salas`, b), onSuccess: () => inval('aca-vest-salas') }),
    delSala: useMutation({ mutationFn: (id: number) => api.delete(`${base}/salas/${id}`), onSuccess: () => inval('aca-vest-salas', 'aca-vest-cand') }),
    ensalar: useMutation({ mutationFn: (b: { selectionProcessId: number }) => api.post<{ alocados: number; semSala: number }>(`${base}/ensalar`, b), onSuccess: () => inval('aca-vest-cand') }),
    // F12 — inscrição avançada
    criarGrupo: useMutation({ mutationFn: (b: any) => api.post(`${base}/grupos`, b), onSuccess: () => inval('aca-vest-grupos') }),
    delGrupo: useMutation({ mutationFn: (id: number) => api.delete(`${base}/grupos/${id}`), onSuccess: () => inval('aca-vest-grupos', 'aca-vest-extras') }),
    criarMotivo: useMutation({ mutationFn: (b: any) => api.post(`${base}/motivos-cancelamento`, b), onSuccess: () => inval('aca-vest-motivos') }),
    criarEmpresa: useMutation({ mutationFn: (b: any) => api.post(`${base}/empresas`, b), onSuccess: () => inval('aca-vest-empresas') }),
    setExtra: useMutation({ mutationFn: ({ regId, ...b }: any) => api.put(`${base}/inscricoes/${regId}/extra`, b), onSuccess: () => inval('aca-vest-extras') }),
    cancelarInscricao: useMutation({ mutationFn: ({ regId, motivoId }: { regId: number; motivoId?: number }) => api.post(`${base}/inscricoes/${regId}/cancelar`, { motivoId }), onSuccess: () => inval('aca-vest-cand') }),
  }
}

export interface GrupoInsc { id: number; selectionProcessId: number; nome: string; ordem: number; ativo: boolean }
export interface MotivoCanc { id: number; nome: string; ativo: boolean }
export interface EmpresaInsc { id: number; nome: string; cnpj: string | null; contato: string | null; ativo: boolean }
export interface ExtraInsc { grupoId: number | null; grupoNome: string | null; empresaId: number | null; empresaNome: string | null; comoConheceu: string | null }

export const useGruposInsc = (processoId: number | null) =>
  useQuery({ queryKey: ['aca-vest-grupos', processoId], queryFn: () => api.get<{ grupos: GrupoInsc[] }>(`${base}/grupos?processoId=${processoId}`), enabled: processoId !== null, staleTime: 10_000 })
export const useMotivosCanc = () =>
  useQuery({ queryKey: ['aca-vest-motivos'], queryFn: () => api.get<{ motivos: MotivoCanc[] }>(`${base}/motivos-cancelamento`), staleTime: 30_000 })
export const useEmpresasInsc = () =>
  useQuery({ queryKey: ['aca-vest-empresas'], queryFn: () => api.get<{ empresas: EmpresaInsc[] }>(`${base}/empresas`), staleTime: 30_000 })
export const useExtrasInsc = (processoId: number | null) =>
  useQuery({ queryKey: ['aca-vest-extras', processoId], queryFn: () => api.get<{ extras: Record<number, ExtraInsc> }>(`${base}/processos/${processoId}/extras`), enabled: processoId !== null, staleTime: 5_000 })
