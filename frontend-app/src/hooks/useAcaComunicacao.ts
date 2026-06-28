import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface NotifConfig { vencimentoEnabled: boolean; vencimentoDiasAntes: number; canal: string; msgVencimento: string; msgNotas: string; reguaEnabled: boolean; diasPos: string; msgCobranca: string }
export interface ComunicacaoItem { id: number; alunoId: number; tipo: string; canal: string; destino: string; assunto: string | null; status: string; erro: string | null; createdAt: string }

export const TIPO_COM_LABEL: Record<string, string> = { VENCIMENTO: 'Vencimento', FALTAS: 'Faltas', NOTAS: 'Notas', MANUAL: 'Manual' }

export function useComunicacaoConfig() {
  return useQuery({ queryKey: ['aca-com-config'], queryFn: () => api.get<{ config: NotifConfig }>('/admin/aca/comunicacao/config'), staleTime: 30_000 })
}
export function useComunicacaoConfigMut() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (b: Partial<NotifConfig>) => api.put('/admin/aca/comunicacao/config', b), onSuccess: () => void qc.invalidateQueries({ queryKey: ['aca-com-config'] }) })
}
export function useComunicacaoLog() {
  return useQuery({ queryKey: ['aca-com-log'], queryFn: () => api.get<{ itens: ComunicacaoItem[] }>('/admin/aca/comunicacao/log'), staleTime: 3_000 })
}
export function useComunicacaoAcoes() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-com-log'] })
  return {
    varrerVencimentos: useMutation({ mutationFn: () => api.post<{ verificadas: number; enviados: number }>('/admin/aca/comunicacao/vencimentos/run', {}), onSuccess: inval }),
    varrerInadimplencia: useMutation({ mutationFn: () => api.post<{ verificadas: number; enviados: number }>('/admin/aca/comunicacao/inadimplencia/run', {}), onSuccess: inval }),
    notificarNotas: useMutation({ mutationFn: (turmaId: number) => api.post<{ alunos: number; enviados: number }>(`/admin/aca/comunicacao/notas/${turmaId}`, {}), onSuccess: inval }),
  }
}
