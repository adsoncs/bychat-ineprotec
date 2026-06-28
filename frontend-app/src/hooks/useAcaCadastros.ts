import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface CadAux { id: number; tipo: string; nome: string; descricao: string | null; ativo: boolean }
export const CAD_TIPOS: Array<{ key: string; label: string }> = [
  { key: 'AREA_CONHECIMENTO', label: 'Áreas de conhecimento' },
  { key: 'FORMACAO', label: 'Formações acadêmicas' },
  { key: 'ATENDIMENTO_ESPECIAL', label: 'Atendimentos especiais' },
  { key: 'TIPO_DOCUMENTO', label: 'Tipos de documento' },
]

export const useCadastrosAux = (tipo: string) =>
  useQuery({ queryKey: ['aca-cad', tipo], queryFn: () => api.get<{ itens: CadAux[] }>(`/admin/aca/cadastros?tipo=${tipo}`), staleTime: 10_000 })

export function useCadastrosMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['aca-cad'] })
  return {
    criar: useMutation({ mutationFn: (b: { tipo: string; nome: string; descricao?: string }) => api.post('/admin/aca/cadastros', b), onSuccess: inval }),
    atualizar: useMutation({ mutationFn: ({ id, ...b }: any) => api.put(`/admin/aca/cadastros/${id}`, b), onSuccess: inval }),
    excluir: useMutation({ mutationFn: (id: number) => api.delete(`/admin/aca/cadastros/${id}`), onSuccess: inval }),
  }
}
