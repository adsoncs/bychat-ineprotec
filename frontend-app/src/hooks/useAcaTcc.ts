import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface Tcc { id: number; matriculaId: number; alunoId: number; alunoNome: string; ra: string | null; titulo: string; orientador: string | null; resumo: string | null; status: string; nota: number | null; dataDefesa: string | null }

export const TCC_STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'accent' | 'success' | 'danger' }> = {
  REGISTRADO: { label: 'Registrado', tone: 'neutral' }, EM_ANDAMENTO: { label: 'Em andamento', tone: 'warning' },
  ENTREGUE: { label: 'Entregue', tone: 'accent' }, APROVADO: { label: 'Aprovado', tone: 'success' }, REPROVADO: { label: 'Reprovado', tone: 'danger' },
}

export const useTccs = (status = '') =>
  useQuery({ queryKey: ['aca-tcc', status], queryFn: () => api.get<{ tccs: Tcc[]; counts: Record<string, number> }>(`/admin/aca/tcc${status ? `?status=${status}` : ''}`), staleTime: 3_000 })

export function useTccMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-tcc'] })
  return {
    criar: useMutation({ mutationFn: (b: { matriculaId: number; titulo: string; orientador?: string; resumo?: string }) => api.post('/admin/aca/tcc', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`/admin/aca/tcc/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/tcc/${id}`), onSuccess: inval }),
  }
}
