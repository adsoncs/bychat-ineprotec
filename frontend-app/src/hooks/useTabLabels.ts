import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

/**
 * Os nomes das abas do Conversas, definidos pela empresa.
 *
 * "Caixa", "Atendimento", "Setor" são o vocabulário de um jeito de trabalhar.
 * Escola fala em "Secretaria", clínica em "Recepção" — e a equipe passa o dia
 * relendo um rótulo que não é o dela. O admin troca a palavra; as regras de cada
 * aba continuam idênticas.
 *
 * A leitura é liberada a qualquer operador porque a tela precisa dos nomes para
 * desenhar; só a escrita é de administrador.
 */

export const ESCOPOS = ['mine', 'team', 'all'] as const
export const CAIXAS = ['inbox', 'raw', 'snoozed', 'resolved', 'all'] as const

export type EscopoId = (typeof ESCOPOS)[number]
export type CaixaId = (typeof CAIXAS)[number]

export interface TabLabels {
  scope: Record<EscopoId, string>
  bucket: Record<CaixaId, string>
}

export const LABELS_PADRAO: TabLabels = {
  scope: { mine: 'Meus', team: 'Setor', all: 'Todos' },
  bucket: { inbox: 'Atendimento', raw: 'Caixa', snoozed: 'Aguardando', resolved: 'Resolvidos', all: 'Todos' },
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
  return { labels: q.data?.labels ?? LABELS_PADRAO, carregando: q.isLoading }
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
