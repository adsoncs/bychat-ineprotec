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
  /** Dados que a equipe vê e edita na ficha do painel (aba Cadastro), pedidos ou não no portal. */
  painel?: string[]
}

// ─── Endereço completo: os 7 campos marcados juntos ───────────────────────
export const CHAVES_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf'] as const
const OPCIONAL = new Set(['complemento'])

export interface EnderecoNaConfig {
  /** '' = não pedido no portal; 'misto' = ajustado campo a campo. */
  etapa: EtapaDados | '' | 'misto'
  obrigatorio: boolean
  exigido: boolean
  painel: boolean
}

export function enderecoDaConfig(cfg: DadosConfig): EnderecoNaConfig {
  const etapas = new Set(CHAVES_ENDERECO.map((k) => cfg.campos[k]?.etapa ?? ''))
  const principais = CHAVES_ENDERECO.filter((k) => !OPCIONAL.has(k))
  return {
    etapa: etapas.size === 1 ? ([...etapas][0] as EtapaDados | '') : 'misto',
    obrigatorio: principais.every((k) => cfg.campos[k]?.obrigatorio),
    exigido: principais.every((k) => cfg.exigidosMatricula.includes(k)),
    painel: CHAVES_ENDERECO.every((k) => (cfg.painel ?? []).includes(k)),
  }
}

export function aplicarEndereco(cfg: DadosConfig, e: EnderecoNaConfig): DadosConfig {
  const campos = { ...cfg.campos }
  const exig = new Set(cfg.exigidosMatricula)
  const painel = new Set(cfg.painel ?? [])
  for (const k of CHAVES_ENDERECO) {
    const opcional = OPCIONAL.has(k)
    if (e.etapa !== 'misto') {
      if (!e.etapa) delete campos[k]
      else campos[k] = { etapa: e.etapa, obrigatorio: e.obrigatorio && !opcional }
    } else if (campos[k]) campos[k] = { ...campos[k]!, obrigatorio: e.obrigatorio && !opcional }
    if (e.exigido && !opcional) exig.add(k); else exig.delete(k)
    if (e.painel) painel.add(k); else painel.delete(k)
  }
  return { ...cfg, campos, exigidosMatricula: [...exig], painel: [...painel] }
}

export interface EnderecoDoPortal {
  id: number
  nome: string
  slug: string
  ativo: boolean
  /** Sem "Dados por etapa" próprio o portal usa o formulário antigo e não entra aqui. */
  configurado: boolean
  endereco: EnderecoNaConfig
  /** Modelos de contrato do portal que usam o endereço: pede = pede antes de assinar; mostra = só imprime o endereço completo. */
  contratos: Array<{ modelo: string; pede: boolean; mostra: boolean }>
}

export function useEnderecoPortais() {
  return useQuery({
    queryKey: ['edu', 'endereco-portais'],
    queryFn: () => api.get<{ portais: EnderecoDoPortal[] }>('/admin/educacional/endereco-portais'),
    staleTime: 10_000,
  })
}

export function useSalvarEnderecoPortais() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (portais: Array<{ id: number; endereco: EnderecoNaConfig }>) =>
      api.put<{ ok: true; salvos: number[]; pulados: Array<{ id: number; motivo: string }> }>('/admin/educacional/endereco-portais', { portais }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edu', 'endereco-portais'] })
      qc.invalidateQueries({ queryKey: ['enrollment-portals'] })
      qc.invalidateQueries({ queryKey: ['enrollment-portal'] })
    },
  })
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
