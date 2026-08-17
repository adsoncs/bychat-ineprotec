import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { env } from '@/lib/env'

export interface MessageBlock {
  variants: string[]
  mediaUrl?: string | null
  mediaType?: 'image' | 'video' | 'document' | 'audio' | null
  mediaName?: string | null
  delayAfterMs?: number | null
}

export interface PacingConfig {
  minDelayMs: number
  maxDelayMs: number
  sessionSize: number
  sessionBreakMs: number
  typingEnabled: boolean
  readReceipts: boolean
}

export interface WindowConfig {
  days: number[]
  from: string
  to: string
  timezone: string
}

/** O que acontece com o lead quando ele responde ao disparo. */
export interface ReplyActions {
  moveToFunnelId?: number
  moveToStageKey?: string
  assignToUserId?: number
  createActivity?: boolean
}

export interface SmartCampaign {
  id: number
  name: string
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'canceled' | 'failed'
  senderInstances: Array<{ id: number; instanceName: string }>
  messageBlocks: MessageBlock[]
  audienceType: 'leads' | 'import'
  pacingConfig: PacingConfig
  windowConfig: WindowConfig
  dailyCapPerNumber: number
  requireOptIn: boolean
  legalBasis: string | null
  optOutFooter: string | null
  linkUrl: string | null
  replyActions: ReplyActions | null
  usePreferredTime: boolean
  riskState: 'ok' | 'watch' | 'throttled' | 'halted'
  riskReason: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  totalRecipients: number
  sentCount: number
  failedCount: number
  skippedCount: number
  repliedCount: number
  createdAt: string
}

export interface SmartMetrics {
  counts: Record<string, number>
  skips: Record<string, number>
  total: number
  progress: number
  replyRate: number
  nextSendAt: string | null
}

export interface SmartRecipient {
  id: number
  phone: string
  name: string | null
  status: string
  skipReason: string | null
  assignedInstance: string | null
  plannedAt: string | null
  sentText: string | null
  error: string | null
}

export interface Sender {
  id: number
  name: string
  instanceName: string
  phone: string | null
  warmupDay: number
  dailyCap: number
  sentToday: number
  state: 'warming' | 'healthy' | 'throttled' | 'paused' | 'blocked'
  score: number
  pausedUntil: string | null
  pauseReason: string | null
}

export interface ContentDiversity {
  sampled: number
  distinct: number
  ratio: number
  topRepeated: number
}

export interface RiskFactor {
  key: string
  label: string
  penalty: number
  detail: string
  severity: 'info' | 'warning' | 'danger'
}

export interface RiskReport {
  score: number
  level: 'baixo' | 'medio' | 'alto'
  headline: string
  factors: RiskFactor[]
}

export interface Suppression {
  id: number
  phone: string
  phoneKey: string
  reason: string
  note: string | null
  createdAt: string
}

export interface PacingProfile {
  id: number
  name: string
  description: string | null
  isSystem: boolean
  minDelayMs: number
  maxDelayMs: number
  sessionSize: number
  sessionBreakMs: number
  typingEnabled: boolean
  readReceipts: boolean
  dailyCapStart: number
}

export interface PlanSummary {
  totalPlanned: number
  notOnWhatsApp: number
  byAffinity: number
  diversity: ContentDiversity
  firstAt: string | null
  lastAt: string | null
  perSender: Array<{ instanceName: string; count: number; warmupDay: number; dailyCap: number; state: string }>
  perDay: Array<{ day: string; count: number }>
  warnings: string[]
  risk: RiskReport
}

const BASE = '/admin/smart-broadcast'

export function useSenders() {
  return useQuery({
    queryKey: ['smart-senders'],
    queryFn: () => api.get<{ senders: Sender[]; warmupCurve: number[] }>(`${BASE}/senders`),
    staleTime: 30_000,
  })
}

export function useSmartCampaigns() {
  return useQuery({
    queryKey: ['smart-campaigns'],
    queryFn: () => api.get<{ campaigns: SmartCampaign[] }>(`${BASE}/campaigns`),
    staleTime: 15_000,
  })
}

export function useSmartCampaign(id: number | null, pollMs = 0) {
  return useQuery({
    queryKey: ['smart-campaign', id],
    queryFn: () => api.get<{ campaign: SmartCampaign; metrics: SmartMetrics; recipients: SmartRecipient[] }>(`${BASE}/campaigns/${id}`),
    enabled: id !== null,
    refetchInterval: pollMs || false,
  })
}

export function useCreateSmartCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<SmartCampaign>) => api.post<{ campaign: SmartCampaign }>(`${BASE}/campaigns`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart-campaigns'] }),
  })
}

export function useUpdateSmartCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<SmartCampaign> & { id: number }) =>
      api.put<{ campaign: SmartCampaign }>(`${BASE}/campaigns/${id}`, input),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['smart-campaigns'] })
      qc.invalidateQueries({ queryKey: ['smart-campaign', v.id] })
    },
  })
}

export function useDeleteSmartCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`${BASE}/campaigns/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart-campaigns'] }),
  })
}

/** Prévia: 8 renderizações reais da mensagem, com spintax e variáveis resolvidas. */
export function usePreviewMessage() {
  return useMutation({
    mutationFn: (input: { messageBlocks: MessageBlock[]; sampleVars?: Record<string, string>; optOutFooter?: string | null; linkUrl?: string | null; name?: string }) =>
      api.post<{ samples: string[][]; variables: string[]; diversity: ContentDiversity }>(`${BASE}/preview`, input),
  })
}

export function useSetSmartAudienceLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, leadIds }: { id: number; leadIds: number[] }) =>
      api.post<{ ok: true; created: number; skipped: number; ignoredByOptIn: number }>(`${BASE}/campaigns/${id}/audience/leads`, { leadIds }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['smart-campaign', v.id] })
      qc.invalidateQueries({ queryKey: ['smart-campaigns'] })
    },
  })
}

export function useParseSmartSheet() {
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const fd = new FormData(); fd.append('file', file)
      return api.post<{ headers: string[]; sampleRows: Record<string, string>[]; totalRows: number }>(`${BASE}/campaigns/${id}/audience/parse`, fd)
    },
  })
}

export function useSmartImportCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, phoneColumn, nameColumn }: { id: number; phoneColumn: string; nameColumn?: string | undefined }) =>
      api.post<{ ok: true; created: number; skipped: number }>(`${BASE}/campaigns/${id}/audience/import-commit`, { phoneColumn, nameColumn }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['smart-campaign', v.id] })
      qc.invalidateQueries({ queryKey: ['smart-campaigns'] })
    },
  })
}

/** Dry-run: calcula a agenda inteira e devolve o resumo sem enviar nada. */
export function useSimulateCampaign() {
  return useMutation({
    mutationFn: ({ id, skipNumberCheck }: { id: number; skipNumberCheck?: boolean }) =>
      // `problems` bloqueia o disparo; `advisories` são recomendações que o
      // operador pode ignorar (ver checkForStart no backend).
      api.post<{ plan: PlanSummary; problems: string[]; advisories: string[] }>(`${BASE}/campaigns/${id}/simulate`, { skipNumberCheck }),
  })
}

export function useStartSmartCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt?: string | null }) =>
      api.post<{ ok: true; status: string; plan: PlanSummary }>(`${BASE}/campaigns/${id}/start`, { scheduledAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart-campaigns'] }),
  })
}

export function useSmartCampaignAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'pause' | 'resume' | 'cancel' }) =>
      api.post<{ ok: true }>(`${BASE}/campaigns/${id}/${action}`),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['smart-campaigns'] })
      qc.invalidateQueries({ queryKey: ['smart-campaign', v.id] })
    },
  })
}

/** Desempenho por variação de texto (A/B) — só faz sentido depois que sai envio. */
export function useVariantPerformance(id: number | null, pollMs = 0) {
  return useQuery({
    queryKey: ['smart-variants', id],
    queryFn: () => api.get<{ variants: Array<{ index: number; text: string; sent: number; replied: number; failed: number; replyRate: number }> }>(`${BASE}/campaigns/${id}/variants`),
    enabled: id !== null,
    refetchInterval: pollMs || false,
  })
}

/** Sobe a mídia da mensagem. Reusa o upload do Conversas — mesmo destino, mesmas validações. */
export function useUploadMedia() {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData(); fd.append('file', file)
      return api.post<{ url: string; filename: string; mimetype: string }>('/atendimento/upload', fd)
    },
  })
}

/** Perfis de ritmo vindos do servidor (os três de sistema são semeados lá). */
export function usePacingProfiles() {
  return useQuery({
    queryKey: ['smart-pacing-profiles'],
    queryFn: () => api.get<{ profiles: PacingProfile[] }>(`${BASE}/pacing-profiles`),
    staleTime: 300_000,
  })
}

export function useSuppressions(search = '') {
  return useQuery({
    queryKey: ['smart-suppressions', search],
    queryFn: () => api.get<{ items: Suppression[]; total: number }>(`${BASE}/suppressions?search=${encodeURIComponent(search)}`),
  })
}

export function useAddSuppression() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { phones: string; reason?: string; note?: string }) =>
      api.post<{ ok: true; added: number; invalid: number }>(`${BASE}/suppressions`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart-suppressions'] }),
  })
}

export function useRemoveSuppression() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`${BASE}/suppressions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['smart-suppressions'] }),
  })
}

export function useCampaignRisk(id: number | null) {
  return useQuery({
    queryKey: ['smart-risk', id],
    queryFn: () => api.get<RiskReport>(`${BASE}/campaigns/${id}/risk`),
    enabled: id !== null,
  })
}

export const LEGAL_BASIS = [
  { value: 'consent', label: 'Consentimento do titular', hint: 'A pessoa autorizou receber suas mensagens.' },
  { value: 'contract', label: 'Execução de contrato', hint: 'Há relação contratual ou negociação em andamento.' },
  { value: 'legitimate_interest', label: 'Legítimo interesse', hint: 'Contato esperado no contexto do relacionamento — exige avaliação e registro.' },
]

export async function downloadSmartAudienceTemplate(): Promise<void> {
  const token = localStorage.getItem(env.authTokenKey)
  const res = await fetch(`${env.apiBase}${BASE}/audience-template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Falha ao baixar modelo')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'modelo_disparo_inteligente.xlsx'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(a.href)
}

// ─── Perfis de ritmo (espelham o backend) ───────────────
export const PACING_PRESETS: Record<'conservador' | 'padrao' | 'agressivo', PacingConfig & { label: string; hint: string }> = {
  conservador: {
    label: 'Conservador',
    hint: '40s a 3min entre mensagens, pausa a cada ~20 envios. Recomendado — e obrigatório para número novo.',
    minDelayMs: 40_000, maxDelayMs: 180_000, sessionSize: 20, sessionBreakMs: 600_000,
    typingEnabled: true, readReceipts: true,
  },
  padrao: {
    label: 'Padrão',
    hint: '25s a 1min30 entre mensagens. Para números já aquecidos e lista com relacionamento.',
    minDelayMs: 25_000, maxDelayMs: 90_000, sessionSize: 30, sessionBreakMs: 480_000,
    typingEnabled: true, readReceipts: true,
  },
  agressivo: {
    label: 'Agressivo',
    hint: '12s a 45s. Risco real de bloqueio — só com número antigo e lista que pediu contato.',
    minDelayMs: 12_000, maxDelayMs: 45_000, sessionSize: 45, sessionBreakMs: 300_000,
    typingEnabled: true, readReceipts: true,
  },
}
