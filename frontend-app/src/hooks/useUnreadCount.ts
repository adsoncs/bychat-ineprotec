import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useUserStore } from '@/stores/user'

/**
 * Conversas esperando resposta — alimenta o contador do menu.
 *
 * Endpoint próprio (e não a lista de tickets) porque isto roda em toda tela do
 * painel: o menu precisa de um número, não de 50 leads com mensagens.
 *
 * O `queryKey` começa com 'tickets' de propósito: o realtime já invalida essa
 * chave a cada mensagem, então o contador atualiza junto, sem fio extra.
 */
export function useUnreadCount() {
  const userId = useUserStore((s) => s.user?.id ?? null)
  return useQuery({
    queryKey: ['tickets', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/atendimento/unread-count'),
    enabled: userId !== null,
    staleTime: 10_000,
    // Rede de segurança para o caso de o WebSocket cair: o número não pode
    // ficar velho na tela por muito tempo.
    refetchInterval: 60_000,
  })
}
