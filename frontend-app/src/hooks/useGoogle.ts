import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'

// ─────────────────────────────────────────────────────────────────────────────
// Tipos compartilhados

export interface GoogleConfigStatus {
  configured: boolean
  /** clientId mascarado (primeiros 12 chars + "••••••") */
  clientId: string
  hasSecret: boolean
  redirectUri: string
}

export interface GoogleConnection {
  id: number
  email: string
  active: boolean
  scopes: string | null
  createdAt: string
  updatedAt: string
  /** "COMPANY" = conta da empresa (Drive/Sheets centralizado + fallback). "OPERATOR" = conta pessoal de um operador. */
  kind?: 'COMPANY' | 'OPERATOR'
  userId?: number | null
}

export interface Spreadsheet { id: string; name: string; modifiedTime?: string }
export interface SheetTab { sheetId: number; title: string }
export interface Calendar { id: string; summary: string; primary?: boolean; backgroundColor?: string }
export interface TaskList { id: string; title: string }

export interface SheetField { key: string; label: string; group: 'lead' | 'event' | 'custom' }
export interface SheetFieldMapping { header: string; source: string }

export interface GoogleSheetIntegration {
  id: number
  name: string
  connectionId: number
  spreadsheetId: string
  spreadsheetName: string
  sheetName: string
  events: string[]
  fieldMapping: SheetFieldMapping[]
  includeTimestamp: boolean
  active: boolean
  totalSynced: number
  totalFailed: number
  lastSyncAt: string | null
  createdAt: string
  connection?: { email: string }
}

export interface GoogleCalendarIntegration {
  id: number
  name: string
  connectionId: number
  calendarId: string
  activityTypes: string[]
  autoMeetLink: boolean
  notifyLead: boolean
  active: boolean
  createdAt: string
  connection?: { email: string }
}

export interface GoogleDriveConfig {
  id: number
  connectionId: number
  rootFolderId: string
  rootFolderLink: string
  autoUploadChat: boolean
  active: boolean
  createdAt: string
}

export interface GoogleTasksConfig {
  id: number
  connectionId: number
  taskListId: string
  taskListTitle: string
  activityTypes: string[]
  totalSynced: number
  totalFailed: number
  active: boolean
  createdAt: string
}

export interface GmailConfig {
  id: number
  connectionId: number
  senderName: string
  signature: string
  totalSent: number
  totalFailed: number
  active: boolean
  syncReplies?: boolean
  totalReceived?: number
  lastSyncAt?: string | null
  watchExpiration?: string | null
  createdAt: string
}

export interface GmailProfile { email: string; messagesTotal?: number; threadsTotal?: number }

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  size?: string
}

export interface DriveLeadFolder {
  folderId: string
  link: string | null
}

export interface DriveUploadResult {
  id: string
  name: string
  webViewLink?: string
  webContentLink?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys

const KEY_CONFIG = ['google-config'] as const
const KEY_CONNECTIONS = ['google-connections'] as const
const KEY_SHEET_INTEGRATIONS = ['google-sheet-integrations'] as const
const KEY_SHEET_EVENTS = ['google-sheet-events'] as const
const KEY_SHEET_FIELDS = ['google-sheet-fields'] as const
const KEY_CALENDAR_INTEGRATIONS = ['google-calendar-integrations'] as const
const KEY_DRIVE_CONFIG = ['google-drive-config'] as const
const KEY_TASKS_CONFIGS = ['google-tasks-configs'] as const
const KEY_GMAIL_CONFIGS = ['google-gmail-configs'] as const
const KEY_GMAIL_PROFILE = ['google-gmail-profile'] as const

function inv(qc: ReturnType<typeof useQueryClient>, ...keys: readonly (readonly unknown[])[]) {
  for (const k of keys) void qc.invalidateQueries({ queryKey: [...k] })
}

// ─────────────────────────────────────────────────────────────────────────────
// Config + OAuth

export function useGoogleConfig() {
  return useQuery({
    queryKey: KEY_CONFIG,
    queryFn: () => api.get<GoogleConfigStatus>('/admin/google/config'),
    staleTime: 60_000,
  })
}

export function useUpdateGoogleConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { clientId?: string; clientSecret?: string; redirectUri?: string }) =>
      api.put<{ ok: true }>('/admin/google/config', input),
    onSuccess: () => inv(qc, KEY_CONFIG),
  })
}

export function useResetGoogleCredentials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/admin/google/reset-credentials', {}),
    onSuccess: () => inv(qc, KEY_CONFIG, KEY_CONNECTIONS, KEY_SHEET_INTEGRATIONS, KEY_CALENDAR_INTEGRATIONS, KEY_DRIVE_CONFIG, KEY_TASKS_CONFIGS, KEY_GMAIL_CONFIGS),
  })
}

export function useGoogleAuthUrl() {
  return useMutation({
    mutationFn: () => api.get<{ url: string }>('/admin/google/auth-url'),
  })
}

// ── Conexão Google do operador (Híbrido B) ──────────────
export interface MyGoogleStatus {
  configured: boolean
  connection: {
    id: number
    email: string
    active: boolean
    scopes: string | null
    updatedAt: string
  } | null
  companyFallback: { email: string } | null
}

const KEY_MY_GOOGLE = ['my-google'] as const

export function useMyGoogleStatus() {
  return useQuery({
    queryKey: KEY_MY_GOOGLE,
    queryFn: () => api.get<MyGoogleStatus>('/integrations/google/me'),
    staleTime: 30_000,
  })
}

export function useMyGoogleAuthUrl() {
  return useMutation({
    mutationFn: () => api.get<{ url: string }>('/integrations/google/auth-url'),
  })
}

export function useDisconnectMyGoogle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/integrations/google/disconnect', {}),
    onSuccess: () => inv(qc, KEY_MY_GOOGLE, KEY_CONNECTIONS, KEY_CALENDAR_INTEGRATIONS, KEY_TASKS_CONFIGS, KEY_GMAIL_CONFIGS),
  })
}

export function useGoogleConnections() {
  return useQuery({
    queryKey: KEY_CONNECTIONS,
    queryFn: () => api.get<{ data: GoogleConnection[] }>('/admin/google/connections'),
    staleTime: 30_000,
  })
}

export function useDeleteGoogleConnection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/connections/${id}`),
    onSuccess: () => inv(qc, KEY_CONNECTIONS, KEY_SHEET_INTEGRATIONS, KEY_CALENDAR_INTEGRATIONS, KEY_DRIVE_CONFIG, KEY_TASKS_CONFIGS, KEY_GMAIL_CONFIGS),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados (spreadsheets / calendars / tasklists)

export function useGoogleSpreadsheets(connectionId: number | null) {
  return useQuery({
    queryKey: ['google-spreadsheets', connectionId],
    queryFn: () => api.get<{ data: Spreadsheet[] }>(`/admin/google/spreadsheets?connectionId=${connectionId}`),
    enabled: connectionId !== null,
    staleTime: 60_000,
  })
}

export function useSheetTabs(connectionId: number | null, spreadsheetId: string | null) {
  return useQuery({
    queryKey: ['google-sheet-tabs', connectionId, spreadsheetId],
    queryFn: () => api.get<{ data: SheetTab[] }>(`/admin/google/spreadsheets/${spreadsheetId}/tabs?connectionId=${connectionId}`),
    enabled: connectionId !== null && spreadsheetId !== null,
    staleTime: 60_000,
  })
}

export function useCreateSpreadsheet() {
  return useMutation({
    mutationFn: (input: { connectionId: number; title: string }) =>
      api.post<{ data: Spreadsheet }>('/admin/google/spreadsheets', input),
  })
}

export function useGoogleCalendars(connectionId: number | null) {
  return useQuery({
    queryKey: ['google-calendars', connectionId],
    queryFn: () => api.get<{ data: Calendar[] }>(`/admin/google/calendars?connectionId=${connectionId}`),
    enabled: connectionId !== null,
    staleTime: 60_000,
  })
}

export function useGoogleTaskLists(connectionId: number | null) {
  return useQuery({
    queryKey: ['google-tasklists', connectionId],
    queryFn: () => api.get<{ data: TaskList[] }>(`/admin/google/tasks/lists?connectionId=${connectionId}`),
    enabled: connectionId !== null,
    staleTime: 60_000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheets — events, fields, integrations CRUD

export function useSheetEvents() {
  return useQuery({
    queryKey: KEY_SHEET_EVENTS,
    queryFn: () => api.get<{ data: string[]; labels: Record<string, string> }>('/admin/google/sheets/events'),
    staleTime: Infinity,
  })
}

export function useSheetFields() {
  return useQuery({
    queryKey: KEY_SHEET_FIELDS,
    queryFn: () => api.get<{ fields: SheetField[] }>('/admin/google/sheets/fields'),
    staleTime: 5 * 60_000,
  })
}

export function useSheetIntegrations() {
  return useQuery({
    queryKey: KEY_SHEET_INTEGRATIONS,
    queryFn: () => api.get<{ data: GoogleSheetIntegration[] }>('/admin/google/sheets'),
    staleTime: 30_000,
  })
}

export interface SheetIntegrationInput {
  name: string
  connectionId: number
  spreadsheetId: string
  spreadsheetName: string
  sheetName?: string | undefined
  events?: string[] | undefined
  fieldMapping?: SheetFieldMapping[] | undefined
  includeTimestamp?: boolean | undefined
}

export function useCreateSheetIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SheetIntegrationInput) =>
      api.post<{ data: GoogleSheetIntegration }>('/admin/google/sheets', input),
    onSuccess: () => inv(qc, KEY_SHEET_INTEGRATIONS),
  })
}

export function useUpdateSheetIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<SheetIntegrationInput> & { active?: boolean }) =>
      api.put<{ data: GoogleSheetIntegration }>(`/admin/google/sheets/${id}`, input),
    onSuccess: () => inv(qc, KEY_SHEET_INTEGRATIONS),
  })
}

export function useDeleteSheetIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/sheets/${id}`),
    onSuccess: () => inv(qc, KEY_SHEET_INTEGRATIONS),
  })
}

export function useTestSheetIntegration() {
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: boolean; message?: string }>(`/admin/google/sheets/${id}/test`, {}),
  })
}

export function useSetupSheetHeaders() {
  return useMutation({
    mutationFn: (id: number) => api.post<{ ok: true }>(`/admin/google/sheets/${id}/setup-headers`, {}),
  })
}

export interface SheetLog {
  id: number
  integrationId: number
  event: string
  rowData: unknown
  success: boolean
  error: string | null
  duration: number | null
  createdAt: string
}

export function useSheetLogs(integrationId: number | null, limit = 100) {
  return useQuery({
    queryKey: ['google-sheet-logs', integrationId, limit],
    queryFn: () => api.get<{ data: SheetLog[]; total: number; limit: number; offset: number }>(
      `/admin/google/sheets/${integrationId}/logs?limit=${limit}`,
    ),
    enabled: integrationId !== null,
    staleTime: 0,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar integrations

export function useCalendarIntegrations() {
  return useQuery({
    queryKey: KEY_CALENDAR_INTEGRATIONS,
    queryFn: () => api.get<{ data: GoogleCalendarIntegration[] }>('/admin/google/calendar/integrations'),
    staleTime: 30_000,
  })
}

export interface CalendarIntegrationInput {
  name: string
  connectionId: number
  calendarId?: string | undefined
  activityTypes?: string[] | undefined
  autoMeetLink?: boolean | undefined
  notifyLead?: boolean | undefined
}

export function useCreateCalendarIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CalendarIntegrationInput) =>
      api.post<{ data: GoogleCalendarIntegration }>('/admin/google/calendar/integrations', input),
    onSuccess: () => inv(qc, KEY_CALENDAR_INTEGRATIONS),
  })
}

export function useUpdateCalendarIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<CalendarIntegrationInput> & { active?: boolean }) =>
      api.put<{ data: GoogleCalendarIntegration }>(`/admin/google/calendar/integrations/${id}`, input),
    onSuccess: () => inv(qc, KEY_CALENDAR_INTEGRATIONS),
  })
}

export function useDeleteCalendarIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/calendar/integrations/${id}`),
    onSuccess: () => inv(qc, KEY_CALENDAR_INTEGRATIONS),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive

export function useDriveConfig() {
  return useQuery({
    queryKey: KEY_DRIVE_CONFIG,
    queryFn: () => api.get<{ data: GoogleDriveConfig | null }>('/admin/google/drive/config'),
    staleTime: 30_000,
  })
}

export function useCreateDriveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { connectionId: number; autoUploadChat?: boolean | undefined }) =>
      api.post<{ data: GoogleDriveConfig }>('/admin/google/drive/config', input),
    onSuccess: () => inv(qc, KEY_DRIVE_CONFIG),
  })
}

export function useUpdateDriveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; autoUploadChat?: boolean; active?: boolean }) =>
      api.put<{ data: GoogleDriveConfig }>(`/admin/google/drive/config/${id}`, input),
    onSuccess: () => inv(qc, KEY_DRIVE_CONFIG),
  })
}

export function useDeleteDriveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/drive/config/${id}`),
    onSuccess: () => inv(qc, KEY_DRIVE_CONFIG),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks

export function useTasksConfigs() {
  return useQuery({
    queryKey: KEY_TASKS_CONFIGS,
    queryFn: () => api.get<{ data: GoogleTasksConfig[] }>('/admin/google/tasks/config'),
    staleTime: 30_000,
  })
}

export interface TasksConfigInput {
  connectionId: number
  taskListId: string
  taskListTitle: string
  activityTypes?: string[] | undefined
}

export function useCreateTasksConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TasksConfigInput) =>
      api.post<{ data: GoogleTasksConfig }>('/admin/google/tasks/config', input),
    onSuccess: () => inv(qc, KEY_TASKS_CONFIGS),
  })
}

export function useUpdateTasksConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<TasksConfigInput> & { active?: boolean }) =>
      api.put<{ data: GoogleTasksConfig }>(`/admin/google/tasks/config/${id}`, input),
    onSuccess: () => inv(qc, KEY_TASKS_CONFIGS),
  })
}

export function useDeleteTasksConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/tasks/config/${id}`),
    onSuccess: () => inv(qc, KEY_TASKS_CONFIGS),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail

export function useGmailConfigs() {
  return useQuery({
    queryKey: KEY_GMAIL_CONFIGS,
    queryFn: () => api.get<{ data: GmailConfig[] }>('/admin/google/gmail/config'),
    staleTime: 30_000,
  })
}

export function useCreateGmailConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { connectionId: number; senderName?: string; signature?: string }) =>
      api.post<{ data: GmailConfig & { email?: string } }>('/admin/google/gmail/config', input),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS, KEY_GMAIL_PROFILE),
  })
}

export function useUpdateGmailConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number; senderName?: string; signature?: string; active?: boolean }) =>
      api.put<{ data: GmailConfig }>(`/admin/google/gmail/config/${id}`, input),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS),
  })
}

export function useDeleteGmailConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/gmail/config/${id}`),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS, KEY_GMAIL_PROFILE),
  })
}

export function useGmailProfile(enabled: boolean) {
  return useQuery({
    queryKey: KEY_GMAIL_PROFILE,
    queryFn: () => api.get<{ data: GmailProfile }>('/admin/google/gmail/profile'),
    enabled,
    staleTime: 60_000,
  })
}

export function useSendGmail() {
  return useMutation({
    mutationFn: (input: { to: string; subject: string; body: string; bodyHtml?: string; replyTo?: string }) =>
      api.post<{ success: true; messageId: string }>('/admin/google/gmail/send', input),
  })
}

/** Envia e-mail ao cliente a partir do lead (grava Activity + thread). Aceita anexos. */
export function useSendLeadEmail(leadId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { to: string; subject: string; body: string; bodyHtml?: string; replyToActivityId?: number; files?: File[] }) => {
      if (input.files && input.files.length > 0) {
        const fd = new FormData()
        fd.append('to', input.to)
        fd.append('subject', input.subject)
        fd.append('body', input.body)
        if (input.bodyHtml) fd.append('bodyHtml', input.bodyHtml)
        if (input.replyToActivityId != null) fd.append('replyToActivityId', String(input.replyToActivityId))
        for (const f of input.files) fd.append('files', f, f.name)
        return api.post<{ ok: true; activityId: number; gmailThreadId: string; attachments: number }>(`/leads/${leadId}/email`, fd)
      }
      const { files, ...json } = input
      return api.post<{ ok: true; activityId: number; gmailThreadId: string }>(`/leads/${leadId}/email`, json)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-activities', leadId] })
      qc.invalidateQueries({ queryKey: ['activities'] })
      qc.invalidateQueries({ queryKey: ['lead-attachments', leadId] })
    },
  })
}

/** Ativa/desativa o recebimento de respostas (Gmail watch) e sync manual. */
export function useGmailWatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (configId: number) => api.post(`/admin/google/gmail/config/${configId}/watch`, {}),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS),
  })
}
export function useGmailUnwatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (configId: number) => api.post(`/admin/google/gmail/config/${configId}/unwatch`, {}),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS),
  })
}
export function useGmailSyncNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (configId: number) => api.post<{ ok: true; ingested: number }>(`/admin/google/gmail/config/${configId}/sync`, {}),
    onSuccess: () => inv(qc, KEY_GMAIL_CONFIGS),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Drive — pasta por lead + upload

export function useDriveLeadFolder() {
  return useMutation({
    mutationFn: (leadId: number) =>
      api.post<{ data: DriveLeadFolder }>('/admin/google/drive/lead-folder', { leadId }),
  })
}

export function useDriveFiles(folderId: string | null) {
  return useQuery({
    queryKey: ['google-drive-files', folderId],
    queryFn: () => api.get<{ data: DriveFile[] }>(`/admin/google/drive/files/${folderId}`),
    enabled: folderId !== null,
    staleTime: 30_000,
  })
}

export function useUploadToDrive() {
  return useMutation({
    mutationFn: async ({ folderId, file }: { folderId: string; file: File }) => {
      const fd = new FormData()
      fd.append('folderId', folderId)
      fd.append('file', file, file.name)
      return api.post<{ data: DriveUploadResult }>('/admin/google/drive/upload', fd)
    },
  })
}

/** Activity types comuns usados em Calendar e Tasks. */
export const GOOGLE_ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Reunião' },
  { value: 'call', label: 'Ligação' },
  { value: 'task', label: 'Tarefa' },
  { value: 'followup', label: 'Follow-up' },
  { value: 'email', label: 'Email' },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// GA4 (Measurement Protocol)
// Não usa OAuth — apenas Measurement ID + API Secret obtidos no GA4 admin.

export interface Ga4Config {
  id: number
  measurementId: string
  apiSecret: string
  active: boolean
  totalSent: number
  totalFailed: number
  lastSentAt: string | null
  createdAt: string
}

export function useGa4Configs() {
  return useQuery({
    queryKey: ['ga4-configs'],
    queryFn: () => api.get<{ data: Ga4Config[] }>('/admin/google/ga4/config'),
    staleTime: 30_000,
  })
}

export function useCreateGa4Config() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { measurementId: string; apiSecret: string }) =>
      api.post<{ ok: true; data: Ga4Config }>('/admin/google/ga4/config', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ga4-configs'] }),
  })
}

export function useUpdateGa4Config() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number; active?: boolean; measurementId?: string; apiSecret?: string }) =>
      api.put<{ ok: true; data: Ga4Config }>(`/admin/google/ga4/config/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ga4-configs'] }),
  })
}

export function useDeleteGa4Config() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/admin/google/ga4/config/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ga4-configs'] }),
  })
}

export interface Ga4TestResult {
  success: boolean
  validationMessages?: unknown[]
  [k: string]: unknown
}

export function useTestGa4Config() {
  return useMutation({
    mutationFn: (configId: number) => api.post<Ga4TestResult>('/admin/google/ga4/test', { configId }),
  })
}
