import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Equivalências N:1 e 1:N. O par simples 1:1 continua em Currículo; aqui ficam
// os casos compostos, onde a dispensa só vale com TODOS os pré-requisitos
// cumpridos.

export interface EquivalenciaItem {
  id: number
  componenteId: number
  lado: 'ORIGEM' | 'DESTINO'
  nome: string
}

export interface EquivalenciaGrupo {
  id: number
  nome: string
  observacao?: string | null
  bidirecional: boolean
  ativo: boolean
  origem: EquivalenciaItem[]
  destino: EquivalenciaItem[]
}

export interface EquivalenciaAplicavel {
  grupoId: number
  nome: string
  sentido: string
  cumpriu: string[]
  dispensa: Array<{ componenteId: number; nome: string }>
}

export function useEquivalenciaGrupos() {
  return useQuery({
    queryKey: ['aca', 'equivalencia-grupos'],
    queryFn: () => api.get<{ grupos: EquivalenciaGrupo[] }>('/admin/aca/equivalencia-grupos'),
  })
}

export function useCriarEquivalenciaGrupo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { nome: string; origem: number[]; destino: number[]; bidirecional?: boolean; observacao?: string }) =>
      api.post<{ grupo: EquivalenciaGrupo }>('/admin/aca/equivalencia-grupos', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca', 'equivalencia-grupos'] }) },
  })
}

export function useRemoverEquivalenciaGrupo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/aca/equivalencia-grupos/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aca', 'equivalencia-grupos'] }) },
  })
}

export function useEquivalenciasAplicaveis(vinculoId: number | null) {
  return useQuery({
    queryKey: ['aca', 'equivalencias-aplicaveis', vinculoId],
    queryFn: () => api.get<{ aplicaveis: EquivalenciaAplicavel[]; total: number }>(`/admin/aca/vinculos/${vinculoId}/equivalencias-aplicaveis`),
    enabled: !!vinculoId,
  })
}
