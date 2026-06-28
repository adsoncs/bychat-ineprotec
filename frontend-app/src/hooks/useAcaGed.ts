import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface GedArquivo { id: number; alunoId: number; tipo: string; nome: string; url: string; status: string; observacao: string | null; createdAt: string }

export const GED_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  RECEBIDO: { label: 'Recebido', tone: 'neutral' }, CONFERIDO: { label: 'Conferido', tone: 'success' }, PENDENTE: { label: 'Pendente', tone: 'warning' },
}

export const useGed = (alunoId: number | null) =>
  useQuery({ queryKey: ['aca-ged', alunoId], queryFn: () => api.get<{ arquivos: GedArquivo[]; counts: Record<string, number> }>(`/admin/aca/ged?alunoId=${alunoId}`), enabled: alunoId !== null, staleTime: 3_000 })

export function useGedMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-ged'] })
  return {
    criar: useMutation({ mutationFn: (b: { alunoId: number; tipo: string; nome: string; url: string; observacao?: string }) => api.post('/admin/aca/ged', b), onSuccess: inval }),
    status: useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.put(`/admin/aca/ged/${id}`, { status }), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/ged/${id}`), onSuccess: inval }),
  }
}
