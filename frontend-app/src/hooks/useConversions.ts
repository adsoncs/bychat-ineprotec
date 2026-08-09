// Hooks para o módulo Conversões — Meta CAPI + Google Ads.
// Backend em /api/admin/conversions/* (services/metaCapi.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { periodQuery, type PeriodRange } from '@/components/ui/PeriodPicker'

export type ConversionEventStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type ConversionPlatform = 'meta_capi' | 'google_ads'

export interface CapiFunnel {
  id: number
  name: string
  stages: { key: string; name: string }[]
}

export interface CapiConfigResponse {
  configured: boolean
  pixelId: string
  hasToken: boolean
  testEventCode: string
  stageMappings: Record<string, string>
  funnels: CapiFunnel[]
}

export interface CapiConfigInput {
  pixelId?: string | undefined
  /** Só envie quando trocar; vazio = não sobrescreve. */
  accessToken?: string | undefined
  testEventCode?: string | undefined
  stageMappings?: Record<string, string> | undefined
}

export interface ConversionEvent {
  id: number
  leadId: number
  platform: ConversionPlatform
  eventName: string
  eventTime: string
  value: number | string | null
  currency: string
  funnelStage: string | null
  pixelId: string | null
  eventId: string
  fbclid: string | null
  fbc: string | null
  fbp: string | null
  gclid: string | null
  userEmail: string | null
  userPhone: string | null
  userFirstName: string | null
  userLastName: string | null
  status: ConversionEventStatus
  response: any
  errorMessage: string | null
  sentAt: string | null
  retries: number
  createdAt: string
}

export interface ConversionStats {
  overview: { total: number; sent: number; failed: number; pending: number }
  byEvent: { eventName: string; platform: string; count: number; sent: number; failed: number }[]
  byDay: { date: string; total: number; sent: number }[]
}

export interface ConversionEventsFilters {
  page?: number
  limit?: number
  platform?: ConversionPlatform
  status?: ConversionEventStatus
  /** YYYY-MM-DD — mesmo período dos KPIs da tela */
  from?: string
  to?: string
}

function buildQs(f: Record<string, any>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

const CONFIG_KEY = ['capi-config'] as const
const EVENTS_KEY = 'conversion-events'
const STATS_KEY = 'conversion-stats'

export function useCapiConfig() {
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => api.get<CapiConfigResponse>('/admin/conversions/capi/config'),
    staleTime: 30_000,
  })
}

export function useUpdateCapiConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CapiConfigInput) =>
      api.put<{ ok: true }>('/admin/conversions/capi/config', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONFIG_KEY }),
  })
}

export function useTestCapiEvent() {
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; response?: any; error?: string }>(
        '/admin/conversions/capi/test',
        {},
      ),
  })
}

// ── Lead Ads Quality Feedback ──────────────────────────

export type LeadQuality = 'INVALID' | 'NOT_INTERESTED' | 'INTERESTED' | 'CONVERTED'

export interface LeadQualityRecent {
  id: number
  leadId: number | null
  metaLeadId: string
  status: 'quality_feedback_sent' | 'quality_feedback_failed'
  errorMessage: string | null
  createdAt: string
}

export interface LeadQualityConfigResponse {
  enabled: boolean
  stats: { sent: number; failed: number }
  recent: LeadQualityRecent[]
}

const LEAD_QUALITY_KEY = ['lead-quality-config'] as const

export function useLeadQualityConfig() {
  return useQuery({
    queryKey: LEAD_QUALITY_KEY,
    queryFn: () => api.get<LeadQualityConfigResponse>('/admin/conversions/lead-quality/config'),
    staleTime: 30_000,
  })
}

export function useUpdateLeadQualityConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { enabled: boolean }) =>
      api.put<{ ok: boolean; enabled: boolean }>('/admin/conversions/lead-quality/config', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LEAD_QUALITY_KEY }),
  })
}

export function useSendLeadQualityFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadId: number; quality: LeadQuality }) =>
      api.post<{ ok: boolean; skipped?: string; error?: string; metaLeadId?: string }>(
        '/admin/conversions/lead-quality/send',
        input,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LEAD_QUALITY_KEY }),
  })
}

export function useSendCapiEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { leadId: number; eventName: string; value?: number; funnelStage?: string }) =>
      api.post<{ ok: boolean; eventId: string; error?: string }>('/admin/conversions/capi/send', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [EVENTS_KEY] })
      void qc.invalidateQueries({ queryKey: [STATS_KEY] })
    },
  })
}

export function useRetryFailedConversions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: true; retried: number }>('/admin/conversions/capi/retry', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [EVENTS_KEY] })
      void qc.invalidateQueries({ queryKey: [STATS_KEY] })
    },
  })
}

export function useConversionEvents(filters: ConversionEventsFilters = {}) {
  return useQuery({
    queryKey: [EVENTS_KEY, filters],
    queryFn: () =>
      api.get<{ events: ConversionEvent[]; total: number; page: number; limit: number }>(
        `/admin/conversions/events${buildQs(filters)}`,
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useConversionStats(period: PeriodRange) {
  const q = periodQuery(period)
  return useQuery({
    queryKey: [STATS_KEY, q],
    queryFn: () => api.get<ConversionStats>(`/admin/conversions/stats?${q}`),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// Eventos CAPI suportados (catálogo do Meta).
//
// IMPORTANTE: o `value` é o nome técnico exigido pelo Meta — Lookalike Audiences,
// lances automáticos e otimização de campanha dependem desse nome estar exato.
// Por isso o `value` continua em inglês. Só o `label` e `description` foram
// traduzidos pra ficar amigável e aderente a funis de educação/serviço.
//
// Como ler:
//   "Lead qualificado (Lead)" → label PT + nome técnico Meta entre parênteses
export const CAPI_EVENTS: { value: string; label: string; description: string }[] = [
  { value: 'Lead',                 label: 'Lead qualificado · Lead',              description: 'Lead virou qualificado (formulário enviado, primeiro contato útil). Use no SDR/qualificação.' },
  { value: 'Contact',              label: 'Contato iniciado · Contact',           description: 'Conversa começou (chat, ligação, WhatsApp). Use quando o lead respondeu / abriu canal.' },
  { value: 'Schedule',             label: 'Agendamento marcado · Schedule',       description: 'Reunião / visita / call agendada. Use no estágio "Reunião" ou "Convocado".' },
  { value: 'CompleteRegistration', label: 'Cadastro completo · CompleteRegistration', description: 'Lead completou o cadastro (perfil cheio, dados validados).' },
  { value: 'SubmitApplication',    label: 'Inscrição enviada · SubmitApplication',description: 'Inscrição/candidatura submetida (formulário longo, processo seletivo).' },
  { value: 'StartTrial',           label: 'Início de teste · StartTrial',         description: 'Lead começou trial / aula experimental / período demo.' },
  { value: 'InitiateCheckout',     label: 'Início de checkout · InitiateCheckout',description: 'Iniciou pagamento / boleto gerado / matrícula em andamento.' },
  { value: 'AddToCart',            label: 'Carrinho · AddToCart',                 description: 'Curso/produto colocado no carrinho. Pouco usado em educação.' },
  { value: 'Subscribe',            label: 'Matrícula / Assinatura · Subscribe',   description: 'Aluno matriculado / assinou plano recorrente.' },
  { value: 'Purchase',             label: 'Venda confirmada · Purchase',          description: 'Pagamento confirmado / venda fechada. Usa value (R$). Use no estágio terminal "Ganho/Fechado".' },
]
