import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'
import { api } from '@/lib/apiClient'
import { playSentSound } from '@/lib/notificationSound'
import { readMirror as readAccountPrefsMirror } from '@/hooks/useAccountPrefs'
import { onServerEvent } from '@/lib/realtime'

export type Bucket = 'inbox' | 'raw' | 'resolved' | 'snoozed'
export type Scope = 'mine' | 'team' | 'all'

export interface TicketLastMessage {
  body: string | null
  fromMe: boolean
  timestamp: string
}

export interface Ticket {
  id: number
  nome: string | null
  empresa: string | null
  whatsapp: string | null
  email: string | null
  segmento: string | null
  status: string | null
  source: string | null
  profilePicUrl: string | null
  unreadMessages: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessage: TicketLastMessage | null
  conversationOpenedAt: string | null
  conversationClosedAt: string | null
  snoozedUntil: string | null
  assignedUserId: number | null
  assignedUser: { id: number; name: string | null; email: string } | null
  teamId: number | null
  team: { id: number; name: string; color: string | null; slug: string | null } | null
  qualifiedAt: string | null
  qualificationSource: string | null
  /** Conversa de GRUPO de WhatsApp (Evolution) — não é um contato individual. */
  isGroup?: boolean
  /** Canal/número de origem da conversa (última mensagem) */
  channel: { provider: 'evolution' | 'cloud_api' | 'instagram' | 'messenger'; label: string | null; number: string | null; name: string | null; color?: string | null } | null
}

export interface TicketsCounters {
  inbox: number
  raw: number
  resolved: number
  snoozed: number
  mine: number
  teamQueue: number
  waiting: number
  attending: number
  /** Conversas de grupo no escopo — 0 significa "este tenant não usa grupos". */
  groups?: number
}

export interface TicketsListResponse {
  tickets: Ticket[]
  total: number
  counters: TicketsCounters
  isAdmin: boolean
}

export interface TicketsFilters {
  bucket?: Bucket | undefined
  scope?: Scope | undefined
  status?: 'waiting' | 'attending' | undefined
  search?: string | undefined
  // Filtro por número de envio (id do canal: "evolution:<inst>" | "cloud:<id>").
  senderChannel?: string | undefined
  // Filtro por funil: id do funil OU "none" (contatos sem funil).
  funnelId?: string | undefined
  // Tipo de conversa: 'contacts' | 'groups' (vazio = os dois, misturados).
  kind?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

function buildQuery(f: TicketsFilters): string {
  const p = new URLSearchParams()
  if (f.bucket) p.set('bucket', f.bucket)
  if (f.scope) p.set('scope', f.scope)
  if (f.status) p.set('status', f.status)
  if (f.search) p.set('search', f.search)
  if (f.senderChannel) p.set('senderChannel', f.senderChannel)
  if (f.funnelId) p.set('funnelId', f.funnelId)
  if (f.kind) p.set('kind', f.kind)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  if (f.offset !== undefined) p.set('offset', String(f.offset))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

// Lista dos números de envio (Evolution + Cloud) para o filtro de Conversas —
// diferente de useSenderChannels, que é por-lead e desabilita sem leadId.
export function useSenderNumbers(enabled = true) {
  return useQuery({
    queryKey: ['sender-channels', 'all'],
    queryFn: () => api.get<SenderChannelsResponse>('/whatsapp/sender-channels'),
    enabled,
    staleTime: 60_000,
  })
}

export function useTickets(filters: TicketsFilters = {}) {
  return useQuery({
    queryKey: ['tickets', filters],
    queryFn: () => api.get<TicketsListResponse>(`/atendimento/tickets${buildQuery(filters)}`),
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
}

export interface ChatMessage {
  id: number
  fromMe: boolean
  body: string | null
  mediaType: string | null
  mediaUrl: string | null
  mediaName: string | null
  ack: number | null
  isDeleted: boolean
  isInternal: boolean
  senderName: string | null
  externalId: string | null
  quotedMsgId: number | null
  timestamp: string
}

export function useTicketMessages(leadId: number | null) {
  return useQuery({
    queryKey: ['ticket-messages', leadId],
    queryFn: () => api.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/atendimento/tickets/${leadId}/messages?limit=50`),
    enabled: leadId !== null,
    staleTime: 2_000,
    refetchInterval: leadId !== null ? 5_000 : false,
    // Continua refazendo polling com a aba em background — fallback caso o
    // webhook de ACK do Evolution falhe/atrase. Sem isso, voltar à aba após
    // tempo longo mostra recibos de leitura "congelados" no estado antigo.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })
}

export interface SendMessageInput {
  body?: string | undefined
  mediaType?: string | undefined
  mediaUrl?: string | undefined
  mediaName?: string | undefined
  isInternal?: boolean | undefined
  quotedMsgId?: number | undefined
  /** Número de origem escolhido no seletor multi-canal ("evolution:x" | "cloud:1") */
  channelId?: string | undefined
  /** Template HSM (Cloud API) — usado quando mediaType === 'template' */
  template?: { name: string; language: string; components?: unknown[] } | undefined
  /** 2ª mensagem em diante de um envio quebrado: não leva nome do operador. */
  continuacao?: boolean | undefined
}

// ─── Canais de envio (multi-canal: Evolution + Cloud API) ──
export interface SenderWindowState {
  open: boolean
  lastInboundAt: string | null
  expiresAt: string | null
  minutesRemaining: number | null
}
export interface SenderChannel {
  id: string
  provider: 'evolution' | 'cloud_api'
  label: string
  /** Cor escolhida pelo cliente; null usa a do provedor. */
  color?: string | null
  number: string | null
  dedicated: boolean
  window: SenderWindowState | null
}
export interface SenderChannelsResponse {
  channels: SenderChannel[]
  /** Número da conversa: o canal por onde o contato falou. Null em lead sem conversa. */
  suggestedChannelId: string | null
  /**
   * Conversa em andamento → número TRAVADO no canal de entrada (aquele pelo qual
   * o contato falou, o único que ele conhece). Null em lead sem conversa (o
   * operador escolhe o da primeira interação) e null para SUPERADMIN, que pode
   * trocar de número — para ele o canal da conversa é só o padrão.
   */
  lockedChannelId: string | null
  /** true só para SUPERADMIN: pode responder por número diferente do da conversa. */
  canOverrideChannel: boolean
}

export function useSenderChannels(leadId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['sender-channels', leadId],
    queryFn: () => api.get<SenderChannelsResponse>(`/whatsapp/sender-channels${leadId ? `?leadId=${leadId}` : ''}`),
    enabled: enabled && leadId !== null,
    staleTime: 30_000,
  })
}

export function useSendMessage(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/messages`, input),
    onSuccess: () => {
      // Confirmação sonora do envio, quando a pessoa pediu por ela. Lê o espelho
      // local em vez de usar o hook de preferências: isto é um callback de
      // mutação, fora da árvore de componentes.
      const prefs = readAccountPrefsMirror()
      if (prefs.notifySound && prefs.notifyEvents === 'both') {
        playSentSound(prefs.notifySoundId, prefs.notifyVolume)
      }
      void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      // Responder ao lead pausa o chatbot nesta conversa (takeover humano) —
      // recarrega o info para o aviso aparecer sem precisar de refresh.
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

/** Devolve a conversa ao chatbot depois de um takeover humano. */
export function useResumeBot(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ ok: true; resumed: boolean }>(`/atendimento/tickets/${leadId}/resume-bot`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

export function useMarkAsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.put<{ ok: true }>(`/atendimento/tickets/${leadId}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export interface UploadResponse {
  url: string
  filename: string
  mimetype: string
  size: number
}

export function useUploadChatMedia() {
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file, file.name)
      return api.post<UploadResponse>('/atendimento/upload', fd)
    },
  })
}

export function inferMediaType(mime: string, fileName?: string): string {
  // .webp é figurinha e .gif é GIF: os dois são "imagem" pelo MIME, mas o
  // WhatsApp trata cada um de um jeito (rota própria de sticker, gifPlayback no
  // vídeo). Classificar como imagem fazia a figurinha chegar como arquivo.
  const ext = (fileName?.split('.').pop() || '').toLowerCase()
  if (mime === 'image/webp' || ext === 'webp') return 'sticker'
  if (mime === 'image/gif' || ext === 'gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

export function useClaimTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/claim`),
    onSuccess: (_d, leadId) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

export function useReleaseTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/release`),
    onSuccess: (_d, leadId) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

export function useDeleteTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.delete<{ ok: true }>(`/atendimento/tickets/${leadId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useSnoozeTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, until }: { leadId: number; until: string }) =>
      api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/snooze`, { until }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', vars.leadId] })
    },
  })
}

export function useUnsnoozeTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) => api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/unsnooze`),
    onSuccess: (_d, leadId) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

export interface AssignTicketInput {
  leadId: number
  userId?: number | null | undefined
  teamId?: number | null | undefined
  reason?: string | undefined
}

export function useAssignTicket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, ...payload }: AssignTicketInput) =>
      api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/assign`, payload),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', vars.leadId] })
    },
  })
}

export interface TicketLeadInfo {
  id: number
  nome: string | null
  /** manual | formulario | import | agenda | pushname | telefone | grupo */
  nomeOrigem?: string | null
  /** Nome que a EMPRESA salvou na agenda do WhatsApp conectado. */
  nomeWhatsappAgenda?: string | null
  /** Nome que o CONTATO escolheu no WhatsApp dele — referência, não identidade. */
  pushName?: string | null
  empresa: string | null
  whatsapp: string | null
  /** Conversa de GRUPO de WhatsApp — sem telefone, sem chatbot, sem score. */
  isGroup?: boolean
  email: string | null
  segmento: string | null
  cidade: string | null
  status: string | null
  completed: boolean | null
  maturidade: string | null
  solucaoNome: string | null
  scores: unknown
  lastStep: string | null
  profilePicUrl: string | null
  createdAt: string
  lastActivityAt: string | null
  lastMessageAt: string | null
  unreadMessages: number
  assignedUserId: number | null
  assignedUser: { id: number; name: string | null; email: string; lastSeenAt: string | null } | null
  teamId: number | null
  team: { id: number; name: string; color: string | null; slug: string | null } | null
  assignedAt: string | null
  annotation: string | null
  source: string | null
  qualifiedAt: string | null
  qualificationSource: string | null
  conversationOpenedAt: string | null
  conversationClosedAt: string | null
  snoozedUntil: string | null
  /** Takeover humano: setado quando um operador respondeu → o chatbot está pausado
   *  nesta conversa até alguém devolvê-la ao bot. null = bot ativo. */
  botPaused: { at: string; byUserId?: number | null; byName?: string | null } | null
  tags: { tag: { id: number; name: string; color: string | null } }[]
}

export function useTicketInfo(leadId: number | null) {
  return useQuery({
    queryKey: ['ticket-info', leadId],
    queryFn: () => api.get<{ lead: TicketLeadInfo }>(`/atendimento/tickets/${leadId}/info`),
    enabled: leadId !== null,
    staleTime: 30_000,
  })
}

export interface TypingState {
  kind: 'text' | 'audio'
  expiresAt: number
}

interface TypingPayload {
  leadId: number
  kind: 'text' | 'audio'
  isTyping: boolean
  expiresAt: number
}

/**
 * Escuta eventos `chat:typing` do realtime e mantém estado por leadId.
 * Auto-expira quando passa expiresAt (Evolution reemite a cada ~5s; expiramos em 8s).
 */
export function useTypingState(leadId: number | null): TypingState | null {
  const [typing, setTyping] = useState<TypingState | null>(null)

  useEffect(() => {
    setTyping(null)
    if (leadId == null) return undefined
    const off = onServerEvent((ev) => {
      if (ev.type !== 'chat:typing' || !ev.payload) return
      const p = ev.payload as unknown as TypingPayload
      if (p.leadId !== leadId) return
      if (!p.isTyping) { setTyping(null); return }
      setTyping({ kind: p.kind, expiresAt: p.expiresAt })
    })
    return off
  }, [leadId])

  useEffect(() => {
    if (!typing) return undefined
    const ms = typing.expiresAt - Date.now()
    if (ms <= 0) { setTyping(null); return undefined }
    const t = window.setTimeout(() => setTyping(null), ms)
    return () => window.clearTimeout(t)
  }, [typing])

  return typing
}
