import { useEffect } from 'preact/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface WhatsAppInstance {
  id: number
  name: string
  instanceName: string
  active: boolean
  chatbotId: number | null
  defaultTeamId: number | null
  // Reforma F2: instância dedicada a um agente. Mutuamente exclusivo com defaultTeamId.
  ownerUserId: number | null
  funnelId: number | null
  stageKey: string | null
  // Receber grupos de WhatsApp nesta conexão (só Evolution; a Cloud API oficial
  // não expõe os grupos reais do número).
  receiveGroups: boolean
  createdAt: string
  updatedAt: string
  status: 'connected' | 'disconnected' | 'error' | 'unknown'
  ownerJid: string | null
}

export interface InstanceInput {
  name: string
  instanceName: string
  chatbotId?: number | null | undefined
  defaultTeamId?: number | null | undefined
  ownerUserId?: number | null | undefined
}

export function useInstances() {
  return useQuery({
    queryKey: ['instances'],
    queryFn: () => api.get<{ instances: WhatsAppInstance[] }>('/admin/instances'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useCreateInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InstanceInput) => api.post<WhatsAppInstance>('/admin/instances', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

export interface InstanceUpdateInput {
  name?: string | undefined
  chatbotId?: number | null | undefined
  defaultTeamId?: number | null | undefined
  ownerUserId?: number | null | undefined
  funnelId?: number | null | undefined
  stageKey?: string | null | undefined
  active?: boolean | undefined
  receiveGroups?: boolean | undefined
}

export function useUpdateInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & InstanceUpdateInput) =>
      api.put<WhatsAppInstance>(`/admin/instances/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

// ── Business profile (Evolution API) ───────────────────────────

export interface BusinessProfile {
  profilePicUrl: string | null
  name: string | null
  status: string | null
  phone: string | null
  isBusiness: boolean
}

export function useBusinessProfile(instanceName: string | null) {
  return useQuery({
    queryKey: ['business-profile', instanceName],
    queryFn: () => api.get<BusinessProfile>(`/whatsapp/business-profile/${instanceName}`),
    enabled: !!instanceName,
    staleTime: 30_000,
  })
}

export function useUpdateProfileName(instanceName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api.put<{ ok: true }>(`/whatsapp/business-profile/${instanceName}/name`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business-profile', instanceName] }),
  })
}

export function useUpdateProfileStatus(instanceName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (status: string) =>
      api.put<{ ok: true }>(`/whatsapp/business-profile/${instanceName}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business-profile', instanceName] }),
  })
}

export function useUpdateProfilePicture(instanceName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (url: string) =>
      api.put<{ ok: true }>(`/whatsapp/business-profile/${instanceName}/picture`, { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business-profile', instanceName] }),
  })
}

export function useRemoveProfilePicture(instanceName: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.delete<{ ok: true }>(`/whatsapp/business-profile/${instanceName}/picture`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business-profile', instanceName] }),
  })
}

export function useDeleteInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/instances/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

export function useConnectInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ qrcode?: string; pairingCode?: string }>(`/admin/instances/${id}/connect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

export function useDisconnectInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true }>(`/admin/instances/${id}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

export function useRestartInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true }>(`/admin/instances/${id}/restart`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  })
}

export interface InstanceLiveStatus {
  instance: string
  state?: string
  status?: number
  error?: string
}

/**
 * Polling pontual do status de uma instância.
 * Usado durante o fluxo de QR para detectar conexão antes do refetchInterval geral.
 * `enabled` controla quando o polling roda (ex.: só com QR ativo).
 */
export function useInstanceStatus(id: number | null, enabled = false, intervalMs = 3_000) {
  return useQuery({
    queryKey: ['instance-status', id],
    queryFn: () => api.get<InstanceLiveStatus>(`/admin/instances/${id}/status`),
    enabled: enabled && id != null,
    refetchInterval: enabled ? intervalMs : false,
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * Listener SSE do estado de conexão WhatsApp.
 * Quando o backend reporta mudança (connected/disconnected), invalida queries
 * de instâncias para forçar refetch — espelha o `wpp-status` do legado.
 */
export function useWhatsappConnectionStream(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const token = (() => {
      try { return localStorage.getItem(env.authTokenKey) } catch { return null }
    })()
    if (!token) return
    let es: EventSource | null = null
    let lastState: string | null = null
    let cancelled = false
    try {
      // EventSource não suporta header Authorization; o endpoint não exige auth.
      es = new EventSource(`${env.apiBase}/whatsapp/connection-stream`)
    } catch {
      return
    }
    es.onmessage = (ev: MessageEvent) => {
      if (cancelled) return
      try {
        const raw = typeof ev.data === 'string' ? ev.data : ''
        if (!raw) return
        const data = JSON.parse(raw) as { state?: string }
        if (!data?.state) return
        if (lastState !== null && lastState !== data.state) {
          void qc.invalidateQueries({ queryKey: ['instances'] })
        }
        lastState = data.state
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      // EventSource reconecta sozinho; não precisamos fazer nada.
    }
    return () => {
      cancelled = true
      try { es?.close() } catch { /* ignore */ }
    }
  }, [qc])
}

// ── Upload de imagem (genérico, usado pela foto de perfil) ─────────────

export async function uploadProfilePicture(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await api.post<{ url: string }>('/atendimento/upload', fd)
  return res.url
}
