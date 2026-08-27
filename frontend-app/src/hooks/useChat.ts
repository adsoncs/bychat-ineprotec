import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'
import { api } from '@/lib/apiClient'
import { playSentSound } from '@/lib/notificationSound'
import { readMirror as readAccountPrefsMirror } from '@/hooks/useAccountPrefs'
import { onServerEvent } from '@/lib/realtime'

/** 'all' ignora o estado da conversa e mostra as quatro caixas juntas — o
 *  escopo (mine/team/all) e as permissões continuam valendo. */
export type Bucket = 'inbox' | 'raw' | 'resolved' | 'snoozed' | 'all'
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
  /** Contato voltou a falar depois de resolvido: a conversa está na Caixa
   *  esperando alguém pegar, mesmo tendo dono. null = sem retorno pendente. */
  conversationReopenedAt: string | null
  assignedUserId: number | null
  assignedUser: { id: number; name: string | null; email: string } | null
  teamId: number | null
  team: { id: number; name: string; color: string | null; slug: string | null } | null
  qualifiedAt: string | null
  qualificationSource: string | null
  /** Conversa de GRUPO de WhatsApp (Evolution) — não é um contato individual. */
  isGroup?: boolean
  /** Fixada no topo por ESTE operador (a fixação é pessoal). */
  pinned?: boolean
  /** Canal/número de origem da conversa (última mensagem) */
  channel: { provider: 'evolution' | 'cloud_api' | 'instagram' | 'messenger'; label: string | null; number: string | null; name: string | null; color?: string | null } | null
}

export interface TicketsCounters {
  inbox: number
  /** Tudo que o operador enxerga, sem recorte por estado — a aba "Todos". */
  all: number
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

/** Quantas conversas cada página traz. */
export const TICKETS_POR_PAGINA = 50

/**
 * A lista de conversas, paginada por rolagem.
 *
 * A tela buscava UMA página e parava: a aba dizia "186" e só 50 conversas eram
 * alcançáveis — as outras 136 não existiam para o operador, sem nem um aviso de
 * que havia mais. Aqui a lista continua conforme ele rola.
 *
 * `pinned` fica de fora da conta do deslocamento: as conversas fixadas vêm
 * inteiras na primeira página, fora da paginação, e contá-las faria a segunda
 * página pular exatamente esse tanto de conversas.
 */
export function useTicketsInfinite(filters: TicketsFilters = {}) {
  const porPagina = filters.limit ?? TICKETS_POR_PAGINA
  return useInfiniteQuery({
    queryKey: ['tickets', 'infinite', { ...filters, limit: porPagina }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<TicketsListResponse>(
        `/atendimento/tickets${buildQuery({ ...filters, limit: porPagina, offset: pageParam as number })}`,
      ),
    getNextPageParam: (ultima, todas) => {
      // Página incompleta = chegou ao fim. Mais barato e mais confiável do que
      // comparar com o total, que muda enquanto o operador rola.
      if (ultima.tickets.length < porPagina) return undefined
      return todas.reduce((n, pag) => n + pag.tickets.filter((t) => !t.pinned).length, 0)
    },
    staleTime: 5_000,
    // A atualização automática refaz TODAS as páginas carregadas. Quem rolou
    // fundo está garimpando histórico e não precisa de recarga a cada 15s —
    // seriam dezenas de consultas por minuto.
    refetchInterval: (q) => ((q.state.data?.pages.length ?? 1) > 3 ? 60_000 : 15_000),
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
  /** Última edição. A bolha mostra "editada" quando existe. */
  editedAt?: string | null
  /** Apagada para todos: some no contato também, e a bolha vira o aviso. */
  deletedForAll?: boolean
  /** Chegou por encaminhamento. */
  isForwarded?: boolean
  /** Reações na mensagem — uma nossa e uma do contato, como no WhatsApp. */
  reactions?: MessageReaction[] | null
  /** Trecho citado, quando esta mensagem responde a outra. */
  quoted?: QuotedPreview | null
  /** Por que NÃO foi entregue (só quando ack = -1). A Meta aceita o envio e
   *  reprova depois, por webhook — sem isto a bolha ficava igual à de uma
   *  mensagem ainda saindo. */
  deliveryError?: DeliveryError | null
}

export interface DeliveryError {
  /** código da Meta (ex.: 131026); nulo quando o webhook não trouxe detalhe */
  code: number | null
  /** título original em inglês — só para suporte técnico */
  title: string | null
  /** frase pronta para quem atende */
  message: string
}

/** Resumo da mensagem CITADA, montado pelo servidor. Vem junto da resposta
 *  porque a citada pode ser antiga e estar fora das 50 mensagens carregadas —
 *  era esse o caso em que a resposta do cliente aparecia sem contexto. */
export interface QuotedPreview {
  id: number
  body: string | null
  fromMe: boolean
  senderName: string | null
  mediaType: string | null
  deleted: boolean
}

export interface MessageReaction {
  emoji: string
  fromMe: boolean
  senderName?: string | null
  at: string
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

/**
 * "Este número tem WhatsApp?" — consultado ao abrir a conversa.
 *
 * `existe: null` significa que não deu para saber (sem Evolution ativa, grupo,
 * telefone ausente): a tela não avisa nada, que é diferente de garantir que o
 * número existe. A resposta do servidor vem de um carimbo de 30 dias, então
 * reabrir a mesma conversa não gera consulta nova.
 */
export function useWhatsAppCheck(leadId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['ticket-whatsapp-check', leadId],
    queryFn: () => api.get<{ existe: boolean | null; checadoEm: string | null }>(
      `/atendimento/tickets/${leadId}/whatsapp-check`,
    ),
    enabled: leadId !== null && enabled,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
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

// ─── Ações sobre uma mensagem já enviada ──────────────────
//
// O que cada canal aceita quem decide é o servidor: a Evolution (QR Code) faz
// editar e apagar para todos; a API Oficial da Meta não tem essas duas — ela
// só avisa quando o CLIENTE apaga. Nesses casos a resposta traz o motivo, e a
// tela mostra o motivo em vez de esconder o botão.

/** Invalida a conversa e a lista: as duas mostram o texto da mensagem. */
function useInvalidarConversa(leadId: number | null) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['ticket-messages', leadId] })
    void qc.invalidateQueries({ queryKey: ['tickets'] })
  }
}

export function useEditMessage(leadId: number | null) {
  const invalidar = useInvalidarConversa(leadId)
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: number; body: string }) =>
      api.patch<{ ok: true }>(`/atendimento/tickets/${leadId}/messages/${messageId}`, { body }),
    onSuccess: invalidar,
  })
}

export function useDeleteMessage(leadId: number | null) {
  const invalidar = useInvalidarConversa(leadId)
  return useMutation({
    mutationFn: ({ messageId, scope }: { messageId: number; scope: 'me' | 'all' }) =>
      api.delete<{ ok: true }>(`/atendimento/tickets/${leadId}/messages/${messageId}?scope=${scope}`),
    onSuccess: invalidar,
  })
}

export interface ForwardResult {
  ok: true
  enviados: number
  resultados: Array<{ leadId: number; ok: boolean; erro?: string }>
}

export function useForwardMessage(leadId: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ messageId, leadIds }: { messageId: number; leadIds: number[] }) =>
      api.post<ForwardResult>(`/atendimento/tickets/${leadId}/messages/${messageId}/forward`, { leadIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

export function useReactMessage(leadId: number | null) {
  const invalidar = useInvalidarConversa(leadId)
  return useMutation({
    // Emoji vazio remove a reação — é assim que o WhatsApp faz.
    mutationFn: ({ messageId, emoji }: { messageId: number; emoji: string }) =>
      api.post<{ ok: true }>(`/atendimento/tickets/${leadId}/messages/${messageId}/react`, { emoji }),
    onSuccess: invalidar,
  })
}

interface PinResult { ok: true; pinned: boolean }

/** Fixa/desafixa a conversa no topo da lista. Vale só para quem fixou. */
export function useTogglePin() {
  const qc = useQueryClient()
  return useMutation({
    // `pinned` é o estado ATUAL: fixada vira desafixar, e vice-versa.
    mutationFn: ({ leadId, pinned }: { leadId: number; pinned: boolean }): Promise<PinResult> =>
      pinned
        ? api.delete<PinResult>(`/atendimento/tickets/${leadId}/pin`)
        : api.post<PinResult>(`/atendimento/tickets/${leadId}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  })
}

/** Devolve a conversa para a fila de não lidas (abriu por engano). */
export function useMarkTicketUnread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadId: number) =>
      api.put<{ ok: true; unreadMessages: number; espelhadoNoWhatsapp: boolean }>(
        `/atendimento/tickets/${leadId}/unread`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['tickets', 'unread-count'] })
    },
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
    // `ticket-info` é a fonte do contador do painel aberto; sem invalidá-lo o
    // valor ficava velho no cache e a conversa era marcada de novo a cada vez
    // que voltava à tela — uma linha repetida na timeline por visita.
    onSuccess: (_r, leadId) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['ticket-info', leadId] })
    },
  })
}

export interface MarkReadBulkResult {
  ok: true
  /** Quantas realmente tinham não lidas e foram zeradas. */
  marcadas: number
  /** Selecionadas que já estavam lidas — não viram evento na timeline. */
  jaLidas: number
  /** Selecionadas fora do alcance de quem pediu; puladas sem derrubar o lote. */
  semAcesso: number
}

/** Marca várias conversas como lidas de uma vez, direto da lista. */
export function useMarkReadBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (leadIds: number[]) =>
      api.put<MarkReadBulkResult>('/atendimento/tickets/read-bulk', { leadIds }),
    onSuccess: (_r, leadIds) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      // Uma delas pode estar aberta no painel: sem isto o contador dela ficaria
      // velho e a conversa seria remarcada no próximo tick.
      for (const id of leadIds) void qc.invalidateQueries({ queryKey: ['ticket-info', id] })
    },
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
