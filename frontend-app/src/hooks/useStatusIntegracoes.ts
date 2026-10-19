// hooks/useStatusIntegracoes.ts
// Barra de status das integrações (topbar + faixa fixa) e a tela que a configura.
//
// O servidor já verifica de 2 em 2 minutos e guarda o resultado; o painel só
// lê. O intervalo de 60s aqui é o que faz a faixa aparecer sem ninguém
// recarregar a página — que é o ponto da barra existir.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useCan } from '@/hooks/usePermissions'
import { create } from 'zustand'

export type EstadoIntegracao = 'ok' | 'atencao' | 'fora'

export interface ItemDaBarra {
  id: string
  rotulo: string
  estado: EstadoIntegracao
  motivo: string
  desde: string
  avisoFixo: boolean
  /** Só para quem configura. */
  detalhe: string | null
  acao: { rotulo: string; href: string } | null
}

export interface StatusDaBarra {
  ativo: boolean
  verificadoEm: string
  intervaloMin: number
  podeConfigurar: boolean
  /** Esta pessoa vê a faixa vermelha fixa? */
  faixa: boolean
  itens: ItemDaBarra[]
}

export interface ItemDeConfig {
  id: string
  rotulo: string
  configurado: boolean
  mostrar: boolean
  avisoFixo: boolean
  acao: { rotulo: string; href: string }
  estado: EstadoIntegracao | null
  motivo: string | null
  detalhe: string | null
  desde: string | null
}

export interface ConfigDaBarra {
  ativo: boolean
  faixaPara: 'todos' | 'gestao'
  verificadoEm: string
  intervaloMin: number
  itens: ItemDeConfig[]
}

const CHAVE = ['status-integracoes']

export function useStatusIntegracoes() {
  const pode = useCan('status_integracoes', 'view')
  return useQuery({
    queryKey: CHAVE,
    queryFn: () => api.get<StatusDaBarra>('/status-integracoes'),
    enabled: pode,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  })
}

export function useConfigStatusIntegracoes() {
  return useQuery({
    queryKey: [...CHAVE, 'config'],
    queryFn: () => api.get<ConfigDaBarra>('/status-integracoes/config'),
  })
}

export function useSalvarConfigStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<{ ativo: boolean; faixaPara: 'todos' | 'gestao'; itens: Record<string, Partial<{ mostrar: boolean; avisoFixo: boolean }>> }>) =>
      api.put<{ ok: true }>('/status-integracoes/config', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}

export function useVerificarStatusAgora() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<StatusDaBarra>('/status-integracoes/verificar', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  })
}

/** Painel com todas as integrações — aberto pelo bloco do topbar ou pela faixa. */
export const usePainelDeStatus = create<{ aberto: boolean; abrir: (v: boolean) => void }>((set) => ({
  aberto: false,
  abrir: (v) => set({ aberto: v }),
}))

/** "hoje, 07:09" / "ontem, 22:10" / "29/09, 20:40". */
export function desdeQuando(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const hoje = new Date()
  const ontem = new Date(Date.now() - 86400_000)
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hora}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hora}`
}

/** "há 1 min" para o rodapé do painel. */
export function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return `há ${h} h`
}
