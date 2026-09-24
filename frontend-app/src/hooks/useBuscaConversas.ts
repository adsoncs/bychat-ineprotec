/**
 * Dados da busca do Conversas (ver routes/buscaConversas.ts no backend).
 *
 * Seções da lista, na ordem de prioridade:
 *  • Contatos  — pessoa cujo NOME ou NÚMERO bate (com ou sem conversa ainda);
 *  • Conversas — grupo pelo nome, ou contato que bateu por empresa/e-mail;
 *  • Mensagens — mensagens com o termo, da mais nova para a mais antiga.
 * Cada conversa aparece numa seção só (a de maior prioridade); as mensagens
 * podem ser de qualquer uma delas, como no WhatsApp.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'
import { api } from '@/lib/apiClient'
import type { Ticket } from '@/hooks/useChat'

export interface MensagemAchada {
  id: number
  leadId: number
  body: string | null
  timestamp: string
  fromMe: boolean
  senderName: string | null
  mediaType: string | null
  mediaName: string | null
  isInternal: boolean
}

export interface ConversaDaMensagem {
  id: number
  nome: string | null
  whatsapp: string | null
  profilePicUrl: string | null
  isGroup: boolean
  channel: Ticket['channel']
}

/** Espera a digitação assentar antes de consultar (uma consulta por pausa, não por tecla). */
export function useValorAssentado<T>(valor: T, ms = 250): T {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = window.setTimeout(() => setV(valor), ms)
    return () => window.clearTimeout(t)
  }, [valor, ms])
  return v
}

function linhas(q: string, extra: Record<string, string>) {
  const p = new URLSearchParams({ bucket: 'qualquer', search: q, limit: '40', semContadores: '1', ...extra })
  return api.get<{ tickets: Ticket[]; total: number }>(`/atendimento/tickets?${p}`)
}

export function useBuscaConversas(termo: string) {
  const q = termo.trim()
  const ligado = q.length > 0
  const contatos = useQuery({
    queryKey: ['busca', 'contatos', q],
    queryFn: () => linhas(q, { searchFields: 'identidade', kind: 'contacts' }),
    enabled: ligado,
    staleTime: 15_000,
    placeholderData: (anterior) => anterior,
  })
  const conversas = useQuery({
    queryKey: ['busca', 'conversas', q],
    queryFn: async () => {
      const [grupos, porContexto] = await Promise.all([
        linhas(q, { searchFields: 'nome', kind: 'groups' }),
        linhas(q, { searchFields: 'contexto', kind: 'contacts' }),
      ])
      const todas = [...grupos.tickets, ...porContexto.tickets]
      const t = (x: Ticket) => (x.lastMessageAt ? new Date(x.lastMessageAt).getTime() : 0)
      return todas.sort((a, b) => t(b) - t(a))
    },
    enabled: ligado,
    staleTime: 15_000,
    placeholderData: (anterior) => anterior,
  })
  const mensagens = useInfiniteQuery({
    queryKey: ['busca', 'mensagens', q],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ q, limite: '30' })
      if (pageParam) p.set('antes', pageParam)
      return api.get<{ mensagens: MensagemAchada[]; conversas: Record<number, ConversaDaMensagem>; mais: boolean }>(
        `/atendimento/busca/mensagens?${p}`,
      )
    },
    getNextPageParam: (ultima) => (ultima.mais ? ultima.mensagens[ultima.mensagens.length - 1]?.timestamp : undefined),
    // Abaixo de 3 letras o servidor não procura em mensagens (varreria tudo).
    enabled: q.length >= 3,
    staleTime: 15_000,
  })
  return { contatos, conversas, mensagens, procuraMensagens: q.length >= 3 }
}

/** "Pesquisar mensagens" dentro de uma conversa: todas as do histórico, não só as carregadas. */
export function useBuscaNaConversa(leadId: number | null, termo: string, dia: string | null) {
  const q = termo.trim()
  return useInfiniteQuery({
    queryKey: ['busca', 'conversa', leadId, q, dia],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ offset: String(pageParam), limite: '50' })
      if (q) p.set('q', q)
      if (dia) p.set('dia', dia)
      return api.get<{ total: number; mensagens: MensagemAchada[] }>(`/atendimento/tickets/${leadId}/busca?${p}`)
    },
    getNextPageParam: (ultima, todas) => {
      const n = todas.reduce((s, pg) => s + pg.mensagens.length, 0)
      return n < ultima.total ? n : undefined
    },
    enabled: leadId !== null && (q.length > 0 || !!dia),
    staleTime: 10_000,
    placeholderData: (anterior) => anterior,
  })
}
