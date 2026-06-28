import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface MatriculaRow {
  id: number; status: string; listaEspera: boolean; dataMatricula: string; origem: string | null
  aluno: { id: number; ra: string | null; lead: { nome: string } }
  turma: { id: number; nome: string; periodoLetivo: { codigo: string } }
  contrato: { id: number; status: string } | null
}
export interface MatriculaEvento { id: number; de: string | null; para: string; obs: string | null; createdAt: string }
export interface MatriculaDetail {
  id: number; status: string; listaEspera: boolean; dataMatricula: string; dataConclusao: string | null; motivoSaida: string | null; origem: string | null
  aluno: { id: number; ra: string | null; cpf: string | null; lead: { nome: string; email: string; whatsapp: string } }
  turma: { id: number; nome: string; turno: string | null; periodoLetivo: { codigo: string } }
  eventos: MatriculaEvento[]
  contrato: { id: number; status: string; valorTotalCentavos: number; parcelas: Array<{ id: number; situacao: string; valorBrutoCentavos: number; dataVencimento: string }> } | null
}

export function useMatriculas(status: string, turmaId?: number) {
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (turmaId) qs.set('turmaId', String(turmaId))
  const s = qs.toString()
  return useQuery({
    queryKey: ['aca-matriculas', status, turmaId],
    queryFn: () => api.get<{ matriculas: MatriculaRow[]; counters: Record<string, number> }>(`/admin/aca/matriculas${s ? `?${s}` : ''}`),
    staleTime: 3_000,
  })
}

export function useMatricula(id: number | null) {
  return useQuery({
    queryKey: ['aca-matricula', id],
    queryFn: () => api.get<{ matricula: MatriculaDetail; transicoes: string[] }>(`/admin/aca/matriculas/${id}`),
    enabled: id !== null,
  })
}

export function useMatriculaMut(id: number) {
  const qc = useQueryClient()
  const inval = () => {
    void qc.invalidateQueries({ queryKey: ['aca-matricula', id] })
    void qc.invalidateQueries({ queryKey: ['aca-matriculas'] })
    void qc.invalidateQueries({ queryKey: ['aca-inscricoes'] })
  }
  return {
    setStatus: useMutation({ mutationFn: (b: { para: string; obs?: string }) => api.post(`/admin/aca/matriculas/${id}/status`, b), onSuccess: inval }),
    efetivar: useMutation({ mutationFn: () => api.post(`/admin/aca/matriculas/${id}/efetivar`, {}), onSuccess: inval }),
  }
}
