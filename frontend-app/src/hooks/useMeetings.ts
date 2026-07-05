import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface PlaybookAssessment {
  aderencia: number
  pontosFortes: string[]
  pontosMelhoria: string[]
  direcionamento: string[]
}

export interface MeetingAnalysis {
  resumo: string
  topicos: string[]
  acaoItems: string[]
  objecoes: string[]
  proximosPassos: string[]
  sentimento: 'positivo' | 'neutro' | 'negativo'
  playbook?: PlaybookAssessment | null
}

export interface MeetingRecording {
  id: number
  leadId: number | null
  activityId: number | null
  bookingId: number | null
  userName: string | null
  platform: string
  nativeMeetingId: string
  meetingUrl: string
  language: string
  status: string
  errorReason: string | null
  recordingUrl: string | null
  audioUrl: string | null
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

/** Encerra o bot de uma reunião em andamento. */
export function useStopMeetingBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post<{ recording: MeetingRecording }>(`/admin/meetings/recordings/${id}/stop`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-recordings'] }),
  })
}
