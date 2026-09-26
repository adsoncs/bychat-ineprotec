import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// Dados pedidos em cada etapa da inscrição/matrícula (backend: services/dadosCadastro.ts).

export type EtapaDados = 'inscricao' | 'cadastro' | 'documentos' | 'contrato' | 'pagamento'

export interface DadoCatalogo {
  chave: string
  rotulo: string
  tipo: string
  grupo: string
  opcoes?: string[]
  essencial?: boolean
}

export interface DadosConfig {
  modo: 'completo' | 'simplificado'
  campos: Record<string, { etapa: EtapaDados; obrigatorio: boolean }>
  exigidosMatricula: string[]
}

export interface DadosEtapasResposta {
  catalogo: DadoCatalogo[]
  etapas: { chave: EtapaDados; rotulo: string }[]
  padrao: DadosConfig | null
  sugestao: DadosConfig
}

export function useDadosEtapas() {
  return useQuery({
    queryKey: ['edu', 'dados-etapas'],
    queryFn: () => api.get<DadosEtapasResposta>('/admin/educacional/dados-etapas'),
    staleTime: 30_000,
  })
}

export function useSalvarPadraoDados() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (padrao: DadosConfig) => api.put<{ ok: true; padrao: DadosConfig }>('/admin/educacional/dados-etapas', { padrao }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edu', 'dados-etapas'] }),
  })
}
