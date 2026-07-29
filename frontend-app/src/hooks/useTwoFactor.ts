import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Segundo fator da própria conta. O cadastro tem três passos (gerar, confirmar,
// ativar) porque ativar junto com gerar tranca quem não conseguiu ler o QR.

export interface Status2fa {
  habilitado: boolean
  confirmadoEm: string | null
  aguardandoConfirmacao: boolean
  codigosRecuperacaoRestantes: number
}

export interface Inicio2fa {
  segredo: string
  uri: string
  qrDataUrl: string | null
}

export const useStatus2fa = () =>
  useQuery({ queryKey: ['2fa-status'], queryFn: () => api.get<Status2fa>('/admin/2fa/status'), staleTime: 5_000 })

export function use2faMut() {
  const qc = useQueryClient()
  const inval = () => void qc.invalidateQueries({ queryKey: ['2fa-status'] })
  return {
    iniciar: useMutation({ mutationFn: () => api.post<Inicio2fa>('/admin/2fa/iniciar', {}), onSuccess: inval }),
    confirmar: useMutation({
      mutationFn: (codigo: string) => api.post<{ ok: boolean; codigosRecuperacao: string[] }>('/admin/2fa/confirmar', { codigo }),
      onSuccess: inval,
    }),
    desativar: useMutation({ mutationFn: (senha: string) => api.post('/admin/2fa/desativar', { senha }), onSuccess: inval }),
    novosCodigos: useMutation({
      mutationFn: (senha: string) => api.post<{ codigosRecuperacao: string[] }>('/admin/2fa/codigos', { senha }),
      onSuccess: inval,
    }),
  }
}
