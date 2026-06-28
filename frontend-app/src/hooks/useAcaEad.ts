import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/ead'

export interface EadConfig { id: number; lmsNome: string | null; lmsBaseUrl: string | null; modo: string; ativo: boolean }
export interface EadTurma { id: number; turmaId: number; turmaNome: string; chEad: number; lmsRef: string | null; ativo: boolean; sincronizadas: number }
export interface EadMatricula { id: number; matriculaId: number; alunoNome: string; ra: string | null; status: string; lmsEnrollRef: string | null; syncedAt: string | null }
export interface EadNota { id: number; matriculaId: number; disciplina: string; nota: number; origem: string; recebidaEm: string }

export const useEadConfig = () => useQuery({ queryKey: ['aca-ead-cfg'], queryFn: () => api.get<{ config: EadConfig | null }>(`${base}/config`), staleTime: 30_000 })
export const useEadTurmas = () => useQuery({ queryKey: ['aca-ead-turmas'], queryFn: () => api.get<{ turmas: EadTurma[] }>(`${base}/turmas`), staleTime: 5_000 })
export const useTurmasDisponiveisEad = () => useQuery({ queryKey: ['aca-ead-disp'], queryFn: () => api.get<{ turmas: Array<{ id: number; nome: string }> }>(`${base}/turmas-disponiveis`), staleTime: 10_000 })
export const useEadMatriculas = (eadTurmaId: number | null) => useQuery({ queryKey: ['aca-ead-mats', eadTurmaId], queryFn: () => api.get<{ matriculas: EadMatricula[] }>(`${base}/matriculas?eadTurmaId=${eadTurmaId}`), enabled: eadTurmaId !== null, staleTime: 3_000 })
export const useEadNotas = (matriculaId?: number) => useQuery({ queryKey: ['aca-ead-notas', matriculaId], queryFn: () => api.get<{ notas: EadNota[] }>(`${base}/notas${matriculaId ? `?matriculaId=${matriculaId}` : ''}`), staleTime: 3_000 })

export function useEadMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    salvarConfig: useMutation({ mutationFn: (b: any) => api.put(`${base}/config`, b), onSuccess: () => inval('aca-ead-cfg') }),
    marcarTurma: useMutation({ mutationFn: (b: { turmaId: number; chEad?: number }) => api.post(`${base}/turmas`, b), onSuccess: () => inval('aca-ead-turmas', 'aca-ead-disp') }),
    atualizarTurma: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/turmas/${id}`, b), onSuccess: () => inval('aca-ead-turmas') }),
    sincronizar: useMutation({ mutationFn: (id: number) => api.post<{ total: number; sincronizadas: number; modo: string }>(`${base}/turmas/${id}/sincronizar`, {}), onSuccess: () => inval('aca-ead-turmas', 'aca-ead-mats') }),
    receberNotas: useMutation({ mutationFn: (b: { notas: any[]; origem?: string }) => api.post<{ salvas: number }>(`${base}/notas/receber`, b), onSuccess: () => inval('aca-ead-notas') }),
  }
}
