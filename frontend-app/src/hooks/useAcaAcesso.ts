import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/acesso'

export interface PontoAcesso { id: number; nome: string; local: string | null; ativo: boolean }
export interface Credencial { id: number; alunoId: number; token: string; ativo: boolean; alunoNome: string; ra: string | null }
export interface AcessoLog { id: number; alunoId: number | null; alunoNome: string; pontoId: number | null; pontoNome: string | null; tipo: string; autorizado: boolean; motivo: string | null; createdAt: string }

export const usePontosAcesso = () => useQuery({ queryKey: ['aca-acesso-pontos'], queryFn: () => api.get<{ pontos: PontoAcesso[] }>(`${base}/pontos`), staleTime: 10_000 })
export const useCredenciais = () => useQuery({ queryKey: ['aca-acesso-cred'], queryFn: () => api.get<{ credenciais: Credencial[] }>(`${base}/credenciais`), staleTime: 5_000 })
export const useAcessoLogs = (alunoId?: number) => useQuery({ queryKey: ['aca-acesso-logs', alunoId], queryFn: () => api.get<{ logs: AcessoLog[] }>(`${base}/logs${alunoId ? `?alunoId=${alunoId}` : ''}`), staleTime: 3_000 })

export function useAcessoMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    criarPonto: useMutation({ mutationFn: (b: any) => api.post(`${base}/pontos`, b), onSuccess: () => inval('aca-acesso-pontos') }),
    atualizarPonto: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/pontos/${id}`, b), onSuccess: () => inval('aca-acesso-pontos') }),
    gerarCredencial: useMutation({ mutationFn: (alunoId: number) => api.post(`${base}/credenciais`, { alunoId }), onSuccess: () => inval('aca-acesso-cred') }),
    toggleCredencial: useMutation({ mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) => api.put(`${base}/credenciais/${id}`, { ativo }), onSuccess: () => inval('aca-acesso-cred') }),
    registrar: useMutation({ mutationFn: (b: { token: string; pontoId?: number; tipo?: string }) => api.post<{ autorizado: boolean; motivo: string | null; alunoNome: string | null }>(`${base}/registrar`, b), onSuccess: () => inval('aca-acesso-logs') }),
  }
}
