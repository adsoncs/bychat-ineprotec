import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

export interface MeetingType {
  id: number
  slug: string
  name: string
  description: string | null
  color: string | null
  active: boolean
  durationMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  slotIncrementMin: number
  minNoticeMin: number
  bookingWindowDays: number
  maxPerDay: number | null
  visibleSlotsPerDay: number | null
  timezone: string
  locationType: string
  locationDetail: string | null
  assignmentMode: string
  ownerUserId: number | null
  teamId: number | null
  funnelId: number | null
  stageKey: string | null
  defaultTeamId: number | null
  landingPageId: number | null
  intakeFields: unknown
  confirmationConfig: unknown
  pixelConfig: unknown
  totalBookings: number
  createdAt: string
  updatedAt: string
}

export type MeetingTypeInput = { id?: number } & Partial<MeetingType>

export function useMeetingTypes(enabled = true) {
  return useQuery({
    queryKey: ['meeting-types'],
    queryFn: () => api.get<{ items: MeetingType[] }>('/admin/scheduling/meeting-types'),
    enabled,
  })
}

// userIds de operadores com Google Calendar conectado (p/ avisar no editor quando
// o dono escolhido não tem agenda sincronizável).
export function useGoogleConnectedOperators(enabled = true) {
  return useQuery({
    queryKey: ['scheduling-google-operators'],
    queryFn: () => api.get<{ connectedUserIds: number[] }>('/admin/scheduling/google-operators'),
    staleTime: 30_000,
    enabled,
  })
}

export function useSaveMeetingType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MeetingTypeInput) =>
      input.id
        ? api.patch<{ item: MeetingType }>(`/admin/scheduling/meeting-types/${input.id}`, input)
        : api.post<{ item: MeetingType }>('/admin/scheduling/meeting-types', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-types'] }),
  })
}

export function useDeleteMeetingType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/scheduling/meeting-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-types'] }),
  })
}

// ── Disponibilidade & slots (Fase 2) ──
export interface WeeklyRule { weekday: number; start: string; end: string }
export interface AvailabilityException { id?: number; date: string; unavailable: boolean; startTime?: string | null; endTime?: string | null; note?: string | null }
export interface AvailabilityData { timezone: string; rules: WeeklyRule[]; exceptions: AvailabilityException[] }
export interface DaySlots { date: string; weekday: number; slots: { startAt: string; endAt: string; label: string }[] }

export function useAvailability(id: number | null) {
  return useQuery({
    queryKey: ['meeting-type-availability', id],
    queryFn: () => api.get<AvailabilityData>(`/admin/scheduling/meeting-types/${id}/availability`),
    enabled: !!id,
  })
}

export function useSaveAvailability(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { rules: WeeklyRule[]; exceptions: AvailabilityException[] }) =>
      api.put(`/admin/scheduling/meeting-types/${id}/availability`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting-type-availability', id] })
      qc.invalidateQueries({ queryKey: ['meeting-type-slots', id] })
    },
  })
}

export function useSlotsPreview(id: number | null, from?: string, to?: string) {
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const suffix = qs.toString() ? `?${qs}` : ''
  return useQuery({
    queryKey: ['meeting-type-slots', id, from, to],
    queryFn: () => api.get<{ timezone: string; durationMin: number; days: DaySlots[] }>(`/admin/scheduling/meeting-types/${id}/slots${suffix}`),
    enabled: !!id,
  })
}

// Agenda do próprio operador (reusada pelos tipos dele).
export function useMyAvailability(enabled = true) {
  return useQuery({
    queryKey: ['my-availability'],
    queryFn: () => api.get<AvailabilityData>('/admin/scheduling/my-availability'),
    enabled,
  })
}
export function useSaveMyAvailability() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { rules: WeeklyRule[]; exceptions: AvailabilityException[]; timezone?: string }) =>
      api.put('/admin/scheduling/my-availability', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-availability'] })
      qc.invalidateQueries({ queryKey: ['meeting-type-slots'] })
    },
  })
}

// ── Agenda / Calendário (Fase 7) ──
export interface CalendarEvent {
  id: string
  refId: number
  kind: 'booking' | 'block' | 'activity' | 'google'
  token?: string
  blockKind?: 'busy' | 'event'
  activityType?: string
  googleEventId?: string
  htmlLink?: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  status: string
  color: string
  confirmedAt?: string | null
  confirmRequestedAt?: string | null
  note?: string | null
  meetingTypeName?: string | null
  locationType?: string | null
  meetLink?: string | null
  operatorUserId?: number | null
  operatorName?: string | null
  leadId?: number | null
  leadName?: string | null
  inviteeName?: string | null
  inviteeEmail?: string | null
  inviteePhone?: string | null
}
export interface CalendarResponse {
  events: CalendarEvent[]
  scope: 'self' | 'operator' | 'all'
  operatorUserId: number | null
  canSeeAll: boolean
  googleConnected?: boolean
}
export interface BlockInput {
  id?: number
  title?: string
  kind?: 'busy' | 'event'
  startAt: string
  endAt: string
  allDay?: boolean
  color?: string | null
  note?: string | null
  operatorUserId?: number | null
}

export function useCalendar(from: string, to: string, operatorUserId?: number | null) {
  const qs = new URLSearchParams({ from, to })
  if (operatorUserId != null) qs.set('operatorUserId', String(operatorUserId))
  return useQuery({
    queryKey: ['scheduling-calendar', from, to, operatorUserId ?? null],
    queryFn: () => api.get<CalendarResponse>(`/admin/scheduling/calendar?${qs}`),
  })
}

export function useSaveBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BlockInput) =>
      input.id
        ? api.patch(`/admin/scheduling/calendar/blocks/${input.id}`, input)
        : api.post('/admin/scheduling/calendar/blocks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduling-calendar'] }),
  })
}

export function useDeleteBlock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/scheduling/calendar/blocks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduling-calendar'] }),
  })
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api.patch(`/admin/scheduling/calendar/bookings/${id}`, { status, ...(reason ? { reason } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduling-calendar'] }),
  })
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export const LOCATION_LABELS: Record<string, string> = {
  google_meet: 'Google Meet',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  in_person: 'Presencial',
  custom: 'Link personalizado',
}
