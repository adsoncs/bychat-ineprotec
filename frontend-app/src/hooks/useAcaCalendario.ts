import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Evento { id: number; periodoLetivoId: number | null; turmaId: number | null; tipo: string; titulo: string; descricao: string | null; dataInicio: string; dataFim: string | null; diaInteiro: boolean; cor: string | null }

export const EV_TIPOS = [
  { key: 'EVENTO', label: 'Evento', emoji: '📌' }, { key: 'PROVA', label: 'Prova', emoji: '📝' },
  { key: 'FERIADO', label: 'Feriado', emoji: '🏖️' }, { key: 'RECESSO', label: 'Recesso', emoji: '☕' },
  { key: 'MATRICULA', label: 'Matrícula', emoji: '📋' }, { key: 'REUNIAO', label: 'Reunião', emoji: '👥' },
]
export const evEmoji = (t: string) => EV_TIPOS.find((x) => x.key === t)?.emoji ?? '📌'
export const evLabel = (t: string) => EV_TIPOS.find((x) => x.key === t)?.label ?? t

export function useEventos(periodoLetivoId: number | null) {
  return useQuery({
    queryKey: ['aca-eventos', periodoLetivoId],
    queryFn: () => api.get<{ eventos: Evento[] }>(`/admin/aca/eventos${periodoLetivoId ? `?periodoLetivoId=${periodoLetivoId}` : ''}`),
    staleTime: 5_000,
  })
}
export function useEventoMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-eventos'] })
  return {
    criar: useMutation({ mutationFn: (b: Partial<Evento>) => api.post('/admin/aca/eventos', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: { id: number } & Partial<Evento>) => api.put(`/admin/aca/eventos/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/eventos/${id}`), onSuccess: inval }),
  }
}
