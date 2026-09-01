import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/**
 * Os nomes e a ordem das abas do Conversas, definidos pela empresa.
 *
 * "Caixa", "Atendimento", "Setor" são o vocabulário de um jeito de trabalhar.
 * Escola fala em "Secretaria", clínica em "Recepção" — e a equipe passa o dia
 * relendo um rótulo que não é o dela. O admin troca a palavra; as regras de cada
 * aba continuam idênticas.
 *
 * A ordem é a mesma ideia em outro eixo: quem trabalha por fila quer a Caixa na
 * frente, quem trabalha por carteira quer Atendimento. A posição é desenho — o
 * que cada aba mostra não muda. A combinação é que a PRIMEIRA aba de cada barra
 * é a que abre quando o operador entra na tela.
 *
 * A leitura é liberada a qualquer operador porque a tela precisa dos nomes para
 * desenhar; só a escrita é de administrador.
 */

export const ESCOPOS = ['mine', 'team', 'all'] as const
export const CAIXAS = ['inbox', 'raw', 'snoozed', 'resolved', 'all'] as const

export type EscopoId = (typeof ESCOPOS)[number]
export type CaixaId = (typeof CAIXAS)[number]

export interface TabOrder {
  scope: EscopoId[]
  bucket: CaixaId[]
}

export interface TabLabels {
  scope: Record<EscopoId, string>
  bucket: Record<CaixaId, string>
  order: TabOrder
}

export const LABELS_PADRAO: TabLabels = {
  scope: { mine: 'Meus', team: 'Setor', all: 'Todos' },
  bucket: { inbox: 'Atendimento', raw: 'Caixa', snoozed: 'Aguardando', resolved: 'Resolvidos', all: 'Todos' },
  order: { scope: [...ESCOPOS], bucket: [...CAIXAS] },
}

/**
 * Aplica a ordem escolhida a uma lista de abas, sem perder nenhuma.
 *
 * O servidor já devolve a ordem saneada, mas a barra também é desenhada com o
 * padrão enquanto a requisição não voltou, e uma instalação antiga pode ter
 * gravado uma lista incompleta. Aba que a ordem não menciona vai para o fim em
 * vez de sumir da tela.
 */
export function ordenarAbas<T extends { id: string }>(itens: T[], ordem: readonly string[]): T[] {
  const pos = new Map(ordem.map((id, i) => [id, i]))
  return [...itens].sort(
    (a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

/** Troca um item de lugar com o vizinho; devolve a mesma lista se não há para onde ir. */
export function moverNaOrdem<T>(lista: T[], indice: number, direcao: -1 | 1): T[] {
  const destino = indice + direcao
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return lista
  const copia = [...lista]
  const guardado = copia[indice] as T
  copia[indice] = copia[destino] as T
  copia[destino] = guardado
  return copia
}

export function useTabLabels() {
  const q = useQuery({
    queryKey: ['conversation-tab-labels'],
    queryFn: () => api.get<{ labels: TabLabels; padrao: TabLabels }>('/atendimento/tab-labels'),
    // Nome de aba muda uma vez por ano: cachear evita uma requisição a cada
    // abertura da tela sem atrasar nada que importe.
    staleTime: 10 * 60_000,
  })
  // Enquanto carrega, valem os padrões — a barra nunca aparece sem rótulo.
  const labels = q.data?.labels ?? LABELS_PADRAO
  return {
    labels,
    // Instalação que nunca salvou (ou que salvou antes desta versão) não tem
    // `order` no JSON: cair no padrão mantém a barra como sempre foi.
    order: labels.order ?? LABELS_PADRAO.order,
    carregando: q.isLoading,
  }
}

export function useUpdateTabLabels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labels: TabLabels) =>
      api.put<{ ok: true; labels: TabLabels }>('/atendimento/tab-labels', labels),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation-tab-labels'] }),
  })
}

// ── Tema do módulo ─────────────────────────────────────────────────────────

export const TEMAS = [
  {
    id: 'default' as const,
    nome: 'Padrão do sistema',
    resumo: 'O mesmo visual do restante do painel.',
    amostra: { fundo: 'var(--color-surface)', saida: 'var(--color-accent)', entrada: 'var(--color-surface-2)' },
  },
  {
    id: 'wa-dark' as const,
    nome: 'WhatsApp escuro',
    resumo: 'As cores do WhatsApp Web no modo escuro.',
    amostra: { fundo: '#0b141a', saida: '#005c4b', entrada: '#202c33' },
  },
  {
    id: 'wa-light' as const,
    nome: 'WhatsApp claro',
    resumo: 'A versão clara, com texto mais escuro para leitura o dia inteiro.',
    amostra: { fundo: '#efeae2', saida: '#d9fdd3', entrada: '#ffffff' },
  },
]

export type TemaConversas = (typeof TEMAS)[number]['id']

export function useConversationTheme() {
  const q = useQuery({
    queryKey: ['conversation-theme'],
    queryFn: () => api.get<{ theme: TemaConversas }>('/atendimento/theme'),
    staleTime: 10 * 60_000,
  })
  // Enquanto carrega vale o padrão: a tela nunca pisca uma cor que não é a da
  // empresa e depois volta.
  return { theme: q.data?.theme ?? 'default', carregando: q.isLoading }
}

export function useUpdateConversationTheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (theme: TemaConversas) =>
      api.put<{ ok: true; theme: TemaConversas }>('/atendimento/theme', { theme }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversation-theme'] }),
  })
}
