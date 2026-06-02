import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface TelegramConnectionStatus {
  connected: boolean
  botUsername?: string
  botName?: string
  webhookUrl?: string
  active?: boolean
  connectedAt?: string
}

export function useTelegramConnection() {
  return useQuery({
    queryKey: ['telegram-connection'],
    queryFn: () => api.get<TelegramConnectionStatus>('/telegram/connection'),
    staleTime: 60_000,
  })
}

export function useConnectTelegram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (botToken: string) =>
      api.post<{ ok: true; botUsername: string; botName: string; webhookUrl: string }>(
        '/telegram/connect',
        { botToken },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-connection'] }),
  })
}

export function useDisconnectTelegram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/telegram/disconnect'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-connection'] }),
  })
}

export function useTelegramSendTest() {
  return useMutation({
    mutationFn: (input: { chatId: string; text?: string }) =>
      api.post<{ ok: true; messageId: number }>('/telegram/send-test', input),
  })
}
