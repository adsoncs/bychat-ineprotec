import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface PlaybookAssessment {
  aderencia: number
  pontosFortes: string[]
  pontosMelhoria: string[]
  direcionamento: string[]
}

export interface ScorecardItem { criterio: string; nota: number; comentario: string }
export interface MeetingClip { start: number; end: number; titulo: string }

export interface MeetingAnalysis {
  resumo: string
  topicos: string[]
  acaoItems: string[]
  objecoes: string[]
  proximosPassos: string[]
  sentimento: 'positivo' | 'neutro' | 'negativo'
  playbook?: PlaybookAssessment | null
  scorecard?: ScorecardItem[] | null
  clips?: MeetingClip[] | null
}

export interface MeetingRecording {
  id: number
  title?: string | null
  leadId: number | null
  activityId: number | null
  bookingId: number | null
  userName: string | null
  source?: string // online | presencial
  platform: string
  nativeMeetingId: string
  meetingUrl: string
  language: string
  status: string
  errorReason: string | null
  recordingUrl: string | null
  audioUrl: string | null
  videoUrl: string | null
  transcriptText: string | null
  transcriptPolished: string | null
  segmentCount: number
  analysis: MeetingAnalysis | null
  analyzedAt: string | null
  startedAt: string | null
  endedAt: string | null
  transcribedAt: string | null
  createdAt: string
}

/** Lista de gravações de reunião — opcionalmente filtrada por lead. */
export function useMeetingRecordings(leadId?: number) {
  return useQuery({
    queryKey: ['meeting-recordings', leadId ?? 'all'],
    queryFn: () =>
      api.get<{ recordings: MeetingRecording[] }>(
        `/admin/meetings/recordings${leadId ? `?leadId=${leadId}` : ''}`,
      ),
    staleTime: 15_000,
  })
}

// ── Seats (licença do bot por usuário — cobrança) ──────────────
export interface MeetingSeat {
  userId: number
  name: string | null
  email: string | null
  role: string
  enabled: boolean
  autoJoin: boolean
  language: string
  botName: string | null
  activatedAt: string | null
}

export function useMeetingSeats() {
  return useQuery({
    queryKey: ['meeting-seats'],
    queryFn: () => api.get<{ seats: MeetingSeat[]; activeCount: number }>('/admin/meetings/seats'),
    staleTime: 15_000,
  })
}

export function useUpdateMeetingSeat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: number; enabled?: boolean; autoJoin?: boolean; language?: string; botName?: string | null }) =>
      api.put<{ seat: unknown }>(`/admin/meetings/seats/${userId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-seats'] }),
  })
}

// ── Configurações gerais do módulo ─────────────────────────────
export interface MeetingsSettings {
  botName: string
  language: string
  transcriptMode: 'fiel' | 'corrigida'
  analysisEnabled: boolean
  analysisExtra: string
  joinAnnouncement: string
  joinAheadMinutes: number
  saveAudio: boolean
  saveVideo: boolean
  scorecardCriteria: string
  redactPii: boolean
  attachToLead: boolean
  webhookUrl: string
  alertLowAdherence: boolean
  alertThreshold: number
  alertEmail: string
  notifyEmailEnabled: boolean
  notifyEmailTo: string
  notifyToOwner: boolean
  notifyWhatsappEnabled: boolean
  notifyWhatsappTo: string
  presencialEnabled: boolean
}

export function useMeetingsSettings() {
  return useQuery({
    queryKey: ['meeting-settings'],
    queryFn: () => api.get<MeetingsSettings>('/admin/meetings/settings'),
    staleTime: 30_000,
  })
}

export function useUpdateMeetingsSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<MeetingsSettings>) => api.put<{ ok: true }>('/admin/meetings/settings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-settings'] }),
  })
}

// ── (#1) Relatório multi-reunião ───────────────────────────────
export interface MeetingsReport {
  meetingCount: number
  periodo: { from: string | null; to: string | null }
  aderenciaMedia: number | null
  resumo: string
  objecoesComuns: string[]
  temas: string[]
  recomendacoes: string[]
}

export function useGenerateMeetingsReport() {
  return useMutation({
    mutationFn: (body: { from?: string; to?: string; leadId?: number; userId?: number }) =>
      api.post<{ report: MeetingsReport }>('/admin/meetings/report', body),
  })
}

// ── (#4) Busca global ──────────────────────────────────────────
export interface MeetingSearchResult {
  id: number
  leadId: number | null
  platform: string
  nativeMeetingId: string
  createdAt: string
  snippet: string
}

export function useMeetingSearch(q: string) {
  return useQuery({
    queryKey: ['meeting-search', q],
    queryFn: () => api.get<{ results: MeetingSearchResult[] }>(`/admin/meetings/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  })
}

// ── Playbook comercial (contexto da análise IA) ────────────────
export interface SalesPlaybook {
  enabled: boolean
  text: string
}

export function usePlaybook() {
  return useQuery({
    queryKey: ['meeting-playbook'],
    queryFn: () => api.get<SalesPlaybook>('/admin/meetings/playbook'),
    staleTime: 30_000,
  })
}

export function useUpdatePlaybook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { enabled: boolean; text: string }) =>
      api.put<{ ok: true }>('/admin/meetings/playbook', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-playbook'] }),
  })
}

// ── Busca de lead p/ vincular à reunião presencial (nome/e-mail/WhatsApp) ──
export interface MeetingLeadResult {
  id: number
  nome: string | null
  email: string | null
  whatsapp: string | null
  empresa: string | null
}

export function useMeetingLeadSearch(q: string) {
  return useQuery({
    queryKey: ['meeting-lead-search', q],
    queryFn: () => api.get<{ leads: MeetingLeadResult[] }>(`/admin/meetings/lead-search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  })
}

/** MODO PRESENCIAL: envia o áudio da reunião física (gravado no navegador ou
 *  arquivo) para transcrição soberana, sem bot. `consent` é sempre "true" aqui —
 *  a UI só chama isto após o usuário confirmar o consentimento dos presentes. */
export function useUploadPresencialMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, title, leadId, activityId, language }: { file: File; title?: string; leadId?: number | null; activityId?: number | null; language?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('consent', 'true')
      if (title && title.trim()) fd.append('title', title.trim())
      if (leadId) fd.append('leadId', String(leadId))
      if (activityId) fd.append('activityId', String(activityId))
      if (language) fd.append('language', language)
      return api.post<{ recorded: boolean; reason?: string; recording?: MeetingRecording }>('/admin/meetings/upload', fd)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-recordings'] }),
  })
}

/** Encerra o bot de uma reunião em andamento. */
export function useStopMeetingBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ recording: MeetingRecording }>(`/admin/meetings/recordings/${id}/stop`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-recordings'] }),
  })
}
