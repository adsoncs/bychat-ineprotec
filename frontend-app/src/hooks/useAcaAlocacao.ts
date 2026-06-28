import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

const base = '/admin/aca/alocacao'

export interface TipoRef { id: number; nome: string; ativo: boolean }
export interface Ambiente { id: number; nome: string; tipoId: number | null; tipoNome: string | null; capacidade: number; localizacao: string | null; ativo: boolean; equipamentos: number }
export interface Equipamento { id: number; nome: string; tipoId: number | null; tipoNome: string | null; ambienteId: number | null; ambienteNome: string | null; patrimonio: string | null; ativo: boolean }
export interface Reserva { id: number; ambienteId: number; ambienteNome: string; data: string; horaInicio: string; horaFim: string; finalidade: string | null; responsavel: string | null; status: string }

export const useTiposAmbiente = () => useQuery({ queryKey: ['aca-aloc-tipoamb'], queryFn: () => api.get<{ tipos: TipoRef[] }>(`${base}/tipos-ambiente`), staleTime: 30_000 })
export const useAmbientes = () => useQuery({ queryKey: ['aca-aloc-amb'], queryFn: () => api.get<{ ambientes: Ambiente[] }>(`${base}/ambientes`), staleTime: 5_000 })
export const useTiposEquip = () => useQuery({ queryKey: ['aca-aloc-tipoeq'], queryFn: () => api.get<{ tipos: TipoRef[] }>(`${base}/tipos-equipamento`), staleTime: 30_000 })
export const useEquipamentos = (ambienteId?: number) => useQuery({ queryKey: ['aca-aloc-eq', ambienteId], queryFn: () => api.get<{ equipamentos: Equipamento[] }>(`${base}/equipamentos${ambienteId ? `?ambienteId=${ambienteId}` : ''}`), staleTime: 5_000 })
export const useReservas = (ambienteId: number | null, data: string) => useQuery({
  queryKey: ['aca-aloc-res', ambienteId, data],
  queryFn: () => { const qs = new URLSearchParams(); if (ambienteId) qs.set('ambienteId', String(ambienteId)); if (data) qs.set('data', data); return api.get<{ reservas: Reserva[] }>(`${base}/reservas${qs.toString() ? `?${qs}` : ''}`) },
  enabled: ambienteId !== null && !!data, staleTime: 3_000,
})

export function useAlocacaoMut() {
  const qc = useQueryClient()
  const inval = (...k: string[]) => k.forEach((key) => void qc.invalidateQueries({ queryKey: [key] }))
  return {
    criarTipoAmb: useMutation({ mutationFn: (b: any) => api.post(`${base}/tipos-ambiente`, b), onSuccess: () => inval('aca-aloc-tipoamb') }),
    criarAmbiente: useMutation({ mutationFn: (b: any) => api.post(`${base}/ambientes`, b), onSuccess: () => inval('aca-aloc-amb') }),
    atualizarAmbiente: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`${base}/ambientes/${id}`, b), onSuccess: () => inval('aca-aloc-amb') }),
    criarTipoEquip: useMutation({ mutationFn: (b: any) => api.post(`${base}/tipos-equipamento`, b), onSuccess: () => inval('aca-aloc-tipoeq') }),
    criarEquipamento: useMutation({ mutationFn: (b: any) => api.post(`${base}/equipamentos`, b), onSuccess: () => inval('aca-aloc-eq', 'aca-aloc-amb') }),
    criarReserva: useMutation({ mutationFn: (b: any) => api.post<{ reserva?: any; error?: string; conflitos?: any[] }>(`${base}/reservas`, b), onSuccess: () => inval('aca-aloc-res') }),
    cancelarReserva: useMutation({ mutationFn: (id: number) => api.delete(`${base}/reservas/${id}`), onSuccess: () => inval('aca-aloc-res') }),
  }
}
