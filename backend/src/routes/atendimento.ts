// src/routes/atendimento.ts
// Atendimento (chat) routes — human agents chatting with leads via WhatsApp

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { type JwtPayload } from '../lib/auth.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { snapshotLead, moveToTrash } from '../services/trash.js'
import { canUserAccessLead, getUserTeamIds, isAdminRole, getLeadScope } from '../lib/teamAccess.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { reassignPendingCadenceActivities } from '../services/routing/helpers.js'

// Formata "{operador} / {setor}" para auditoria; retorna "fila" / "sem setor" quando vazio.
function describeAssignment(
  user: { name?: string | null; email?: string | null } | null,
  team: { name?: string | null } | null,
): string {
  const userPart = user ? (user.name || user.email || `#${(user as any).id}`) : 'fila'
  const teamPart = team?.name || 'sem setor'
  return `${userPart} / ${teamPart}`
}

// Guarda de acesso para endpoints que mutam ou expõem dados de um ticket específico.
// Retorna true quando OK; quando false, já enviou a resposta de erro apropriada.
async function assertTicketAccess(
  req: any, reply: any, leadId: number,
): Promise<boolean> {
  const user = req.user as JwtPayload
  const ok = await canUserAccessLead(user.userId, user.role, leadId)
  if (!ok) {
    reply.code(403).send({ error: 'Sem permissão sobre este lead' })
    return false
  }
  return true
}

export async function atendimentoRoutes(app: FastifyInstance) {

  // ── GET /api/atendimento/tickets — List conversations ──
  // Filtros:
  //   status: waiting | attending | open | resolved | all
  //   scope:  mine    → apenas leads do operador logado
  //           team    → fila do(s) setor(es) do operador (sem dono atribuído)
  //           all     → todos (admin/superadmin); para outros roles cai para mine+team
  //   search, tagIds: como antes
  app.get('/api/atendimento/tickets', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const query = req.query as any
      const status = query.status || 'all'
      const search = query.search || ''
      const requestedScope = (query.scope || '').toString()
      const limit = Math.min(parseInt(query.limit) || 50, 200)
      const offset = parseInt(query.offset) || 0
      const user = (req as any).user as JwtPayload

      const myTeamIds = await getUserTeamIds(user.userId)

      // Reforma F1: scope efetivo do user no módulo 'leads' (own/team/all)
      // é o teto. Query param ?scope= pode RESTRINGIR mas não EXPANDIR.
      const effectiveScope = await getLeadScope(user.userId, user.role)

      // Cláusula de acesso por escopo
      let scopeWhere: any = {}
      if (requestedScope === 'mine' || effectiveScope === 'own') {
        // 'mine' explícito OU user com scope='own' → só os próprios.
        scopeWhere = { assignedUserId: user.userId }
      } else if (requestedScope === 'team') {
        // 'team' explícito: fila do setor (sem dono).
        // user com scope='own' não chega aqui (filtrado acima).
        scopeWhere = myTeamIds.length > 0
          ? { teamId: { in: myTeamIds }, assignedUserId: null }
          : { id: -1 }
      } else {
        // sem scope ou ?scope=all → derivado de effectiveScope.
        if (effectiveScope === 'all') {
          scopeWhere = {}
        } else {
          // 'team': próprios + setores do user.
          scopeWhere = {
            OR: [
              { assignedUserId: user.userId },
              ...(myTeamIds.length > 0 ? [{ teamId: { in: myTeamIds } }] : []),
            ],
          }
        }
      }

      const where: any = { ...scopeWhere }

      // Bucket: classificação no novo modelo de Conversas (filtra por estado de conversa).
      // Lifecycle do ticket:
      //   1) Lead manda mensagem → cai em 'raw' (Caixa: ninguém pegou ainda)
      //   2) Operador clica "Assumir" → claim atribui + abre conversa → vai para 'inbox' (Atendimento)
      //   3) Operador adormece OU tem lead atribuído sem conversa aberta → 'snoozed' (Aguardando)
      //   4) Operador encerra → 'resolved' (Resolvidos)
      //   Mensagem inbound em conversa fechada reabre automaticamente (volta para 'inbox').
      const bucket = (query.bucket || 'inbox').toString()
      const now = new Date()
      // Filtro de snooze: inbox/raw escondem leads adormecidos. Snoozed
      // expirado (snoozedUntil <= now) é tratado como ativo (lazy unsnooze).
      const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }
      if (bucket === 'inbox') {
        // Atendimento: conversa aberta, não fechada, não adormecida
        where.conversationOpenedAt = { not: null }
        where.conversationClosedAt = null
        where.AND = [...(where.AND ?? []), notSnoozed]
      } else if (bucket === 'raw') {
        // Caixa: leads com mensagens recebidas que ainda não foram assumidos
        // por nenhum operador (assignedUserId null) e nunca tiveram conversa
        // aberta. Atribuir ou assumir o lead já o tira daqui.
        where.conversationOpenedAt = null
        where.lastMessageAt = { not: null }
        where.assignedUserId = null
        where.AND = [...(where.AND ?? []), notSnoozed]
      } else if (bucket === 'resolved') {
        where.conversationClosedAt = { not: null }
      } else if (bucket === 'snoozed') {
        // Aguardando: snooze ativo OU lead atribuído sem conversa aberta
        // (ex: atribuição manual via /assign sem claim — operador responsável
        // identificado mas atendimento ainda não iniciado).
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { snoozedUntil: { gt: now } },
              {
                assignedUserId: { not: null },
                conversationOpenedAt: null,
                conversationClosedAt: null,
                lastMessageAt: { not: null },
              },
            ],
          },
        ]
      } // 'all' => sem filtro de bucket

      // Filtros legados de status (waiting/attending) são SUBfiltros do bucket inbox.
      if (status === 'waiting') {
        where.unreadMessages = { gt: 0 }
      } else if (status === 'attending') {
        where.unreadMessages = 0
      }

      // search e tagIds: combinar via AND para preservar scope
      const andClauses: any[] = []
      if (search) {
        andClauses.push({
          OR: [
            { nome: { contains: search } },
            { empresa: { contains: search } },
            { whatsapp: { contains: search } },
            { email: { contains: search } },
          ],
        })
      }
      if (query.tagIds) {
        const tagIdArr = String(query.tagIds).split(',').map(Number).filter(Boolean)
        if (tagIdArr.length > 0) {
          andClauses.push({ tags: { some: { tagId: { in: tagIdArr } } } })
        }
      }
      // Filtro por TIPO de conversa: contato individual x grupo de WhatsApp.
      // Vazio = os dois juntos (grupos ficam misturados na caixa, com badge).
      const kind = (query.kind ?? '').toString()
      if (kind === 'groups') where.isGroup = true
      else if (kind === 'contacts') where.isGroup = false

      // Filtro por FUNIL: id específico OU "none" (contatos sem funil).
      const fq = (query.funnelId ?? '').toString()
      if (fq === 'none' || fq === 'null') {
        where.funnelId = null
      } else if (fq) {
        const fid = parseInt(fq)
        if (Number.isFinite(fid)) where.funnelId = fid
      }
      // Filtro por NÚMERO DE ENVIO: conversas que têm ao menos uma mensagem ENVIADA
      // (fromMe) por este canal. Id no formato "evolution:<instância>" | "cloud:<id>".
      const sc = (query.senderChannel ?? '').toString()
      if (sc.startsWith('evolution:')) {
        andClauses.push({ messages: { some: { fromMe: true, evolutionInstance: sc.slice('evolution:'.length) } } })
      } else if (sc.startsWith('cloud:')) {
        const cid = parseInt(sc.slice('cloud:'.length))
        if (Number.isFinite(cid)) andClauses.push({ messages: { some: { fromMe: true, cloudApiConnectionId: cid } } })
      }
      // Merge (append) preservando as cláusulas de bucket já em where.AND (antes o
      // where.AND era SOBRESCRITO por search/tags, perdendo o filtro de snooze).
      if (andClauses.length > 0) {
        where.AND = [...(where.AND ?? []), ...andClauses]
      }

      const [tickets, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          orderBy: { lastMessageAt: 'desc' },
          take: limit,
          skip: offset,
          select: {
            id: true,
            nome: true,
            empresa: true,
            whatsapp: true,
            email: true,
            segmento: true,
            status: true,
            completed: true,
            source: true,
            profilePicUrl: true,
            unreadMessages: true,
            lastMessageAt: true,
            createdAt: true,
            assignedUserId: true,
            assignedUser: { select: { id: true, name: true, email: true } },
            teamId: true,
            team: { select: { id: true, name: true, color: true, slug: true } },
            funnelId: true,
            isGroup: true,
            tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
            qualifiedAt: true,
            qualificationSource: true,
            snoozedUntil: true,
            messages: {
              orderBy: { timestamp: 'desc' },
              take: 1,
              select: {
                body: true,
                fromMe: true,
                timestamp: true,
                provider: true,
                evolutionInstance: true,
                cloudApiConnection: { select: { displayPhone: true, displayName: true } },
              },
            },
          },
        }),
        prisma.lead.count({ where }),
      ])

      // Resolve o canal/número de origem de cada conversa (última mensagem).
      // Pré-carrega instâncias/conexões pra resolver em memória + fallback p/
      // histórico (mensagens antigas sem evolutionInstance/cloudApiConnectionId).
      const [allInstances, allCloud] = await Promise.all([
        prisma.whatsAppInstance.findMany({ select: { instanceName: true, name: true, phone: true } }),
        prisma.cloudApiConnection.findMany({ where: { active: true }, select: { displayPhone: true, displayName: true } }),
      ])
      const instByName = new Map(allInstances.map(i => [i.instanceName, i]))
      const soleInstance = allInstances.length === 1 ? allInstances[0] : null
      const soleCloud = allCloud.length === 1 ? allCloud[0] : null
      const buildChannel = (m: any) => {
        if (!m) return null
        if (m.provider === 'cloud_api') {
          const c = m.cloudApiConnection || soleCloud
          return { provider: 'cloud_api', label: 'Cloud API', number: c?.displayPhone ?? null, name: c?.displayName ?? null }
        }
        if (m.provider === 'instagram') return { provider: 'instagram', label: 'Instagram', number: null, name: null }
        if (m.provider === 'messenger') return { provider: 'messenger', label: 'Messenger', number: null, name: null }
        const inst = (m.evolutionInstance ? instByName.get(m.evolutionInstance) : null) || soleInstance
        return { provider: 'evolution', label: 'Evolution', number: inst?.phone ?? null, name: inst?.name ?? m.evolutionInstance ?? null }
      }

      const result = tickets.map(t => {
        const last = t.messages[0] || null
        return {
          ...t,
          lastMessage: last ? { body: last.body, fromMe: last.fromMe, timestamp: last.timestamp } : null,
          channel: buildChannel(last),
          messages: undefined,
        }
      })

      // Contadores: respeitam o scope efetivo do user.
      // - 'all'  → sem restrição (admin/superadmin vê totais globais)
      // - 'team' → meus leads + setores
      // - 'own'  → só meus leads (agent)
      let counterScope: any
      if (effectiveScope === 'all') {
        counterScope = {}
      } else if (effectiveScope === 'own') {
        counterScope = { assignedUserId: user.userId }
      } else {
        counterScope = {
          OR: [
            { assignedUserId: user.userId },
            ...(myTeamIds.length > 0 ? [{ teamId: { in: myTeamIds } }] : []),
          ],
        }
      }

      // Counters: contagem do que está visível em cada bucket. inbox/raw já
      // descontam snoozed (lead adormecido sai de "Atendimento" enquanto dorme).
      const notSnoozedFilter = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }
      const waitingBucketFilter = {
        OR: [
          { snoozedUntil: { gt: now } },
          {
            assignedUserId: { not: null },
            conversationOpenedAt: null,
            conversationClosedAt: null,
            lastMessageAt: { not: null },
          },
        ],
      }
      const [waitingCount, attendingCount, resolvedCount, mineCount, teamQueueCount, inboxCount, rawCount, snoozedCount] = await Promise.all([
        prisma.lead.count({ where: { ...counterScope, completed: false, unreadMessages: { gt: 0 }, AND: [notSnoozedFilter] } }),
        prisma.lead.count({ where: { ...counterScope, completed: false, unreadMessages: 0, lastMessageAt: { not: null }, AND: [notSnoozedFilter] } }),
        prisma.lead.count({ where: { ...counterScope, conversationClosedAt: { not: null } } }),
        prisma.lead.count({ where: { assignedUserId: user.userId, completed: false } }),
        myTeamIds.length > 0
          ? prisma.lead.count({ where: { teamId: { in: myTeamIds }, assignedUserId: null, completed: false } })
          : Promise.resolve(0),
        // inbox: tickets ativos no novo modelo (sem os adormecidos)
        prisma.lead.count({ where: { ...counterScope, conversationOpenedAt: { not: null }, conversationClosedAt: null, AND: [notSnoozedFilter] } }),
        // raw: Caixa = mensagens recebidas em leads SEM ticket aberto E SEM operador atribuído (sem adormecidos)
        prisma.lead.count({ where: { ...counterScope, conversationOpenedAt: null, lastMessageAt: { not: null }, assignedUserId: null, AND: [notSnoozedFilter] } }),
        // snoozed (Aguardando): adormecido OU atribuído mas ainda sem conversa aberta
        prisma.lead.count({ where: { ...counterScope, AND: [waitingBucketFilter] } }),
      ])

      // Existe alguma conversa de grupo no escopo? A UI usa isso para só mostrar
      // o filtro "Contatos / Grupos" em quem realmente recebe grupos — sem isso,
      // todo mundo veria um filtro inútil (o toggle é OFF por padrão).
      const groupsCount = await prisma.lead.count({ where: { ...counterScope, isGroup: true } })

      return {
        tickets: result,
        total,
        counters: {
          waiting: waitingCount,
          attending: attendingCount,
          resolved: resolvedCount,
          mine: mineCount,
          teamQueue: teamQueueCount,
          inbox: inboxCount,
          raw: rawCount,
          snoozed: snoozedCount,
          groups: groupsCount,
        },
        myTeamIds,
        isAdmin: effectiveScope === 'all',
        scope: effectiveScope,
      }
    } catch (err: any) {
      app.log.error(`Atendimento tickets error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/atendimento/tickets/:leadId/messages — Get messages ──
  app.get('/api/atendimento/tickets/:leadId/messages', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const query = req.query as any
      const limit = Math.min(parseInt(query.limit) || 50, 200)
      const before = query.before ? parseInt(query.before) : null

      const where: any = { leadId: lid }
      if (before) {
        where.id = { lt: before }
      }

      const messages = await prisma.message.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        select: {
          id: true,
          fromMe: true,
          body: true,
          mediaType: true,
          mediaUrl: true,
          mediaName: true,
          ack: true,
          isDeleted: true,
          isInternal: true,
          senderName: true,
          externalId: true,
          quotedMsgId: true,
          timestamp: true
        }
      })

      // Return in chronological order
      messages.reverse()

      return { messages, hasMore: messages.length === limit }
    } catch (err: any) {
      app.log.error(`Atendimento messages error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/whatsapp/sender-channels — Canais que o operador pode usar ──
  // Usado pelo modal de envio: lista os números (instâncias Evolution + conexões
  // Cloud API) disponíveis para o operador logado, marca o sugerido pela origem
  // do lead e, para canais Cloud, calcula o estado da janela de 24h.
  app.get('/api/whatsapp/sender-channels', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const user = (req as any).user
    const leadId = q.leadId ? parseInt(q.leadId) : null

    const { resolveSenderChannels, suggestChannelForLead, getCloudWindowState, canOverrideConversationChannel } = await import('../services/whatsappProvider.js')
    const channels = await resolveSenderChannels({ userId: user.userId, role: user.role })

    // Janela de 24h só é relevante p/ Cloud; calcula uma vez por lead.
    const window = leadId && channels.some(c => c.provider === 'cloud_api')
      ? await getCloudWindowState(leadId)
      : null

    // Com conversa em andamento o canal vem TRAVADO no número de entrada (o que
    // o contato conhece); sem conversa vem null e o operador escolhe o número da
    // primeira interação. Para o SUPERADMIN o número da conversa continua sendo
    // o padrão (suggestedChannelId), mas sem trava — ele pode trocar.
    const suggestion = leadId
      ? await suggestChannelForLead(leadId, { userId: user.userId, role: user.role })
      : { channelId: null, locked: false }
    const canOverride = canOverrideConversationChannel(user.role)

    return {
      channels: channels.map(c => ({
        ...c,
        window: c.provider === 'cloud_api' ? window : null,
      })),
      suggestedChannelId: suggestion.channelId,
      lockedChannelId: suggestion.locked && !canOverride ? suggestion.channelId : null,
      canOverrideChannel: canOverride,
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/messages — Send message ──
  app.post('/api/atendimento/tickets/:leadId/messages', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const { body: msgBody, mediaType, mediaUrl, mediaName, isInternal, quotedMsgId, channelId, template } = req.body as any
      const jwtUser = (req as any).user

      // O envio em si vive em services/ticketMessageSender.ts — o MESMO ponto que
      // o disparo agendado usa, para que as regras de número travado, janela de
      // 24h e governança não existam em duas versões.
      const { sendTicketMessage } = await import('../services/ticketMessageSender.js')
      const r = await sendTicketMessage({
        leadId: lid,
        body: msgBody,
        mediaType,
        mediaUrl,
        mediaName,
        isInternal,
        quotedMsgId,
        channelId,
        template,
        actor: { userId: jwtUser.userId, role: jwtUser.role, name: jwtUser.name, email: jwtUser.email },
        origin: 'panel',
        operatorMeta: getOperator(req),
        ipAddress: getIp(req),
        log: { info: (m: string) => app.log.info(m), error: (m: string) => app.log.error(m) },
      })

      if (!r.ok) {
        const payload: Record<string, unknown> = { error: r.error }
        if (r.code) payload.code = r.code
        if (r.detail) payload.detail = r.detail
        if (r.lockedChannelId) payload.lockedChannelId = r.lockedChannelId
        return reply.code(r.status).send(payload)
      }
      return { message: r.message }
    } catch (err: any) {
      app.log.error(`Atendimento send error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/upload — Upload file and return URL ──
  app.post('/api/atendimento/upload', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const data = await req.file()
      if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

      const { mkdirSync, writeFileSync } = await import('fs')
      const { join } = await import('path')
      const { randomUUID } = await import('crypto')

      const uploadsDir = join(process.cwd(), '..', 'uploads')
      mkdirSync(uploadsDir, { recursive: true })

      // Validar extensão (primeira camada)
      const ext = (data.filename.split('.').pop() || 'bin').toLowerCase()
      const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'mp4', 'mp3', 'ogg', 'opus', 'wav', 'webm']
      if (!allowedExts.includes(ext)) {
        return reply.code(400).send({ error: `Tipo de arquivo não permitido: .${ext}` })
      }

      // Validar MIME type (segunda camada)
      const allowedMimes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv', 'text/plain',
        'video/mp4', 'video/webm',
        'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/webm',
      ]
      if (data.mimetype && !allowedMimes.includes(data.mimetype)) {
        return reply.code(400).send({ error: `MIME type não permitido: ${data.mimetype}` })
      }

      // Bloquear extensões duplas suspeitas (ex: file.php.jpg)
      const nameParts = data.filename.split('.')
      const dangerousExts = ['php', 'phtml', 'exe', 'sh', 'bat', 'cmd', 'ps1', 'py', 'rb', 'pl', 'cgi', 'jsp', 'asp', 'aspx']
      if (nameParts.length > 2 && dangerousExts.some(d => nameParts.slice(0, -1).some(p => p.toLowerCase() === d))) {
        return reply.code(400).send({ error: 'Nome de arquivo suspeito' })
      }

      const savedName = `${randomUUID()}.${ext}`
      const filePath = join(uploadsDir, savedName)

      const chunks: Buffer[] = []
      const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
      let totalSize = 0
      for await (const chunk of data.file) {
        totalSize += chunk.length
        if (totalSize > MAX_FILE_SIZE) {
          return reply.code(413).send({ error: 'Arquivo muito grande (máximo 25MB)' })
        }
        chunks.push(chunk)
      }
      writeFileSync(filePath, Buffer.concat(chunks))

      const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`
      const publicUrl = `${appUrl}/uploads/${savedName}`

      return {
        url: publicUrl,
        filename: data.filename,
        mimetype: data.mimetype,
        size: chunks.reduce((a, c) => a + c.length, 0)
      }
    } catch (err: any) {
      app.log.error(`Upload error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── PUT /api/atendimento/tickets/:leadId/read — Mark as read ──
  app.put('/api/atendimento/tickets/:leadId/read', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      await prisma.lead.update({
        where: { id: lid },
        data: { unreadMessages: 0 }
      })

      logEvent({
        leadId: parseInt(leadId),
        type: EVENT_TYPES.OPERATOR_MARKED_READ,
        category: 'operator',
        title: 'Mensagens marcadas como lidas',
        source: 'panel',
        ...getOperator(req),
        ipAddress: getIp(req),
      })

      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/close — Close conversation ──
  // Alias compat para /api/bychat/leads/:id/close-conversation. Atualiza o
  // campo novo conversationClosedAt (que alimenta a aba "Resolvidos") em vez
  // do legado `completed`.
  app.post('/api/atendimento/tickets/:leadId/close', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const user = (req as any).user as { userId: number; name?: string; email?: string }
      const { closeConversation } = await import('../services/leadConversation.js')
      await closeConversation(lid, { byUserId: user.userId, byUserName: user.name || user.email })
      // Marca também o campo legado para sistemas externos que ainda leem `completed`.
      await prisma.lead.update({ where: { id: lid }, data: { completed: true } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/reopen — Reopen conversation ──
  // Alias compat para /api/bychat/leads/:id/open-conversation.
  app.post('/api/atendimento/tickets/:leadId/reopen', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const user = (req as any).user as { userId: number; name?: string; email?: string }
      const { openConversation } = await import('../services/leadConversation.js')
      await openConversation(lid, { byUserId: user.userId, byUserName: user.name || user.email, reason: 'manual' })
      await prisma.lead.update({ where: { id: lid }, data: { completed: false } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/resume-bot — Devolver ao chatbot ──
  // O bot é pausado automaticamente quando um operador responde ao lead
  // (services/botTakeover.ts). Esta rota é o caminho de volta.
  app.post('/api/atendimento/tickets/:leadId/resume-bot', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const user = (req as any).user as { userId: number; name?: string; email?: string }
      const { resumeBot } = await import('../services/botTakeover.js')
      const resumed = await resumeBot(lid, { userId: user.userId, userName: user.name || user.email })
      return { ok: true, resumed }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── DELETE /api/atendimento/tickets/:leadId — Excluir conversa (move lead para lixeira) ──
  app.delete('/api/atendimento/tickets/:leadId', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const user = (req as any).user as JwtPayload

      const snapshot = await snapshotLead(lid)
      if (!snapshot) return reply.code(404).send({ error: 'Lead nao encontrado' })

      await moveToTrash({
        entityType: 'lead',
        entityId: parseInt(leadId),
        entityLabel: `${snapshot.empresa || ''} — ${snapshot.nome || snapshot.whatsapp || ''}`.trim(),
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
        reason: 'Excluído via Conversas',
      })

      await prisma.lead.delete({ where: { id: parseInt(leadId) } })

      logEvent({
        leadId: parseInt(leadId),
        type: 'lead_deleted',
        category: 'lifecycle',
        title: 'Lead excluído via painel de Conversas',
        source: 'panel',
        ...getOperator(req),
        ipAddress: getIp(req),
      })

      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/assign — Atribuir lead a operador e/ou equipe ──
  // body: { userId?: number|null, teamId?: number|null, reason?: string }
  // - userId=null  → libera (volta para fila)
  // - teamId=null  → remove vínculo de setor
  // SUPERADMIN/ADMIN podem transferir qualquer lead. Demais só transferem leads
  // que tenham acesso (atribuído a si ou em setor que pertence).
  app.post('/api/atendimento/tickets/:leadId/assign', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const body = req.body as any
      const user = (req as any).user as JwtPayload
      const lid = parseInt(leadId)

      const lead = await prisma.lead.findUnique({
        where: { id: lid },
        select: {
          id: true, assignedUserId: true, teamId: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

      // Permissão: precisa ter acesso atual ao lead OU ser admin.
      const canAccess = await canUserAccessLead(user.userId, user.role, lid)
      if (!canAccess) return reply.code(403).send({ error: 'Sem permissão sobre este lead' })

      // Validar destino
      const newUserId = body.userId === null ? null : (body.userId !== undefined ? parseInt(body.userId) : lead.assignedUserId)
      const newTeamId = body.teamId === null ? null : (body.teamId !== undefined ? parseInt(body.teamId) : lead.teamId)

      let newUser: { id: number; name: string; email: string } | null = null
      let newTeam: { id: number; name: string } | null = null

      if (newUserId) {
        const u = await prisma.user.findUnique({ where: { id: newUserId }, select: { id: true, name: true, email: true, active: true } })
        if (!u || !u.active) return reply.code(400).send({ error: 'Usuário destino inválido ou inativo' })
        newUser = { id: u.id, name: u.name, email: u.email }
      }
      if (newTeamId) {
        const t = await prisma.team.findUnique({ where: { id: newTeamId }, select: { id: true, name: true, active: true } })
        if (!t || !t.active) return reply.code(400).send({ error: 'Equipe destino inválida ou inativa' })
        newTeam = { id: t.id, name: t.name }
      }

      // Coerência: se atribuir a um operador, ele deve ser membro da equipe (a menos que sem equipe).
      // ADMIN/SUPERADMIN têm poder de override: podem atribuir qualquer operador,
      // mesmo que ele não pertença à equipe atual do lead. Isso destrava o caso comum
      // de leads manuais (que herdam a equipe default, ex: "Recepção", com poucos
      // membros) — sem esse bypass, o admin só conseguiria atribuir aos membros dessa
      // equipe e recebia "Operador destino não pertence à equipe selecionada".
      if (newUserId && newTeamId && !isAdminRole(user.role)) {
        const isMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: newTeamId, userId: newUserId } },
          select: { id: true },
        })
        if (!isMember) {
          return reply.code(400).send({ error: 'Operador destino não pertence à equipe selecionada' })
        }
      }

      const oldLabel = describeAssignment(lead.assignedUser, lead.team)
      const newLabel = describeAssignment(newUser, newTeam)

      const updated = await prisma.lead.update({
        where: { id: lid },
        data: {
          assignedUserId: newUserId,
          teamId: newTeamId,
          assignedAt: (newUserId || newTeamId) ? new Date() : null,
        },
        select: {
          id: true, assignedUserId: true, teamId: true, assignedAt: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true, color: true } },
        },
      })

      // F7: propaga novo responsável nas Activities pendentes de cadência.
      const reassignedCount = (lead.assignedUserId ?? null) !== (newUserId ?? null)
        ? await reassignPendingCadenceActivities(lid, newUserId)
        : 0

      // Determinar título do evento
      const teamChanged = (lead.teamId ?? null) !== (newTeamId ?? null)
      const userChanged = (lead.assignedUserId ?? null) !== (newUserId ?? null)
      let title = 'Atribuição alterada'
      if (teamChanged && newTeam) title = `Lead transferido para setor ${newTeam.name}`
      else if (teamChanged && !newTeam) title = 'Lead removido do setor'
      else if (userChanged && newUser) title = `Lead atribuído a ${newUser.name || newUser.email}`
      else if (userChanged && !newUser) title = 'Lead devolvido à fila'

      logEvent({
        leadId: lid,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title,
        source: 'panel',
        ...getOperator(req),
        oldValue: oldLabel,
        newValue: newLabel,
        description: body.reason || null,
        metadata: {
          previousAssignedUserId: lead.assignedUserId,
          previousTeamId: lead.teamId,
          newAssignedUserId: newUserId,
          newTeamId: newTeamId,
          reassignedCadenceActivities: reassignedCount,
        },
        ipAddress: getIp(req),
      })

      return { ok: true, lead: updated, reassignedCadenceActivities: reassignedCount }
    } catch (err: any) {
      app.log.error(`Atendimento assign error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/claim — Operador puxa lead da fila ──
  // Atribui o lead ao próprio operador. Útil para a UI "Assumir conversa".
  // Precisa estar na equipe do lead, ou ser admin.
  app.post('/api/atendimento/tickets/:leadId/claim', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const user = (req as any).user as JwtPayload
      const lid = parseInt(leadId)

      const lead = await prisma.lead.findUnique({
        where: { id: lid },
        select: {
          id: true, assignedUserId: true, teamId: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

      // Já atribuído a outro operador?
      // Reforma F3: força (force=true) só permitida para ADMIN/SUPERADMIN.
      // Outros precisam usar transfer-request (consensual).
      const force = (req.query as any)?.force === '1' || (req.body as any)?.force === true
      if (lead.assignedUserId && lead.assignedUserId !== user.userId) {
        if (!force) {
          return reply.code(409).send({
            error: 'Lead já atribuído a outro operador',
            assignedUser: lead.assignedUser,
            suggestion: 'Use transferência consensual: solicite ao operador atual.',
          })
        }
        if (!isAdminRole(user.role)) {
          return reply.code(403).send({
            error: 'Apenas admin pode assumir lead de outro agente. Use transferência consensual.',
            assignedUser: lead.assignedUser,
          })
        }
      }

      // Permissão: admin OU membro da equipe (ou lead sem equipe — fila geral).
      if (!isAdminRole(user.role)) {
        if (lead.teamId) {
          const teamIds = await getUserTeamIds(user.userId)
          if (!teamIds.includes(lead.teamId)) {
            return reply.code(403).send({ error: 'Lead pertence a setor que você não integra' })
          }
        }
      }

      const oldLabel = describeAssignment(lead.assignedUser, lead.team)

      const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { id: true, name: true, email: true } })

      const updated = await prisma.lead.update({
        where: { id: lid },
        data: {
          assignedUserId: user.userId,
          assignedAt: new Date(),
        },
        select: {
          id: true, assignedUserId: true, teamId: true, assignedAt: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true, color: true } },
        },
      })

      // F7: propaga novo responsável nas Activities pendentes de cadência.
      const reassignedCount = lead.assignedUserId !== user.userId
        ? await reassignPendingCadenceActivities(lid, user.userId)
        : 0

      const newLabel = describeAssignment(dbUser, lead.team)

      logEvent({
        leadId: lid,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: `Lead assumido por ${dbUser?.name || dbUser?.email || 'operador'}`,
        source: 'panel',
        ...getOperator(req),
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: { claim: true, force, reassignedCadenceActivities: reassignedCount },
        ipAddress: getIp(req),
      })

      // Assumir o lead inicia o atendimento: abre a conversa para que o ticket
      // saia da Caixa e apareça em Atendimento. Idempotente — se já estava aberta,
      // não muda nada.
      const { ensureConversationOpen } = await import('../services/leadConversation.js')
      await ensureConversationOpen(lid, {
        byUserId: user.userId,
        byUserName: dbUser?.name || dbUser?.email,
        reason: 'claim',
      })

      return { ok: true, lead: updated }
    } catch (err: any) {
      app.log.error(`Atendimento claim error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/release — Devolver lead para fila ──
  // Remove a atribuição ao operador (mantém o teamId).
  app.post('/api/atendimento/tickets/:leadId/release', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const user = (req as any).user as JwtPayload
      const lid = parseInt(leadId)

      const lead = await prisma.lead.findUnique({
        where: { id: lid },
        select: {
          id: true, assignedUserId: true, teamId: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true } },
        },
      })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
      if (!lead.assignedUserId) return reply.code(400).send({ error: 'Lead já está na fila' })

      // Permissão: o próprio dono ou admin.
      if (lead.assignedUserId !== user.userId && !isAdminRole(user.role)) {
        return reply.code(403).send({ error: 'Apenas o operador atribuído ou admin pode liberar' })
      }

      const oldLabel = describeAssignment(lead.assignedUser, lead.team)

      const updated = await prisma.lead.update({
        where: { id: lid },
        data: { assignedUserId: null, assignedAt: lead.teamId ? new Date() : null },
        select: {
          id: true, assignedUserId: true, teamId: true, assignedAt: true,
          team: { select: { id: true, name: true, color: true } },
        },
      })

      // F7: Activities pendentes de cadência voltam pra fila (userId=null).
      const reassignedCount = await reassignPendingCadenceActivities(lid, null)

      const newLabel = describeAssignment(null, lead.team)

      logEvent({
        leadId: lid,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: 'Lead devolvido à fila',
        source: 'panel',
        ...getOperator(req),
        oldValue: oldLabel,
        newValue: newLabel,
        metadata: { release: true, reassignedCadenceActivities: reassignedCount },
        ipAddress: getIp(req),
      })

      return { ok: true, lead: updated, reassignedCadenceActivities: reassignedCount }
    } catch (err: any) {
      app.log.error(`Atendimento release error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/snooze — Adormecer atendimento ──
  // Body: { until: ISO8601 }. Lead some da inbox/raw até essa hora; volta sozinho
  // (lazy: filtro nas queries) ou imediatamente se cliente enviar nova mensagem
  // (handler de webhook chama unsnooze idempotente).
  app.post('/api/atendimento/tickets/:leadId/snooze', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const { until } = req.body as { until?: string }
      if (!until) return reply.code(400).send({ error: 'Campo "until" obrigatório (ISO8601).' })
      const date = new Date(until)
      if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: 'Data inválida.' })
      if (date.getTime() <= Date.now()) return reply.code(400).send({ error: 'Data deve ser no futuro.' })

      const updated = await prisma.lead.update({
        where: { id: lid },
        data: { snoozedUntil: date },
        select: { id: true, snoozedUntil: true },
      })

      logEvent({
        leadId: lid,
        type: EVENT_TYPES.OPERATOR_ASSIGNED, // reutiliza categoria operator (sem novo tipo)
        category: 'operator',
        title: `Lead adormecido até ${date.toISOString()}`,
        source: 'panel',
        ...getOperator(req),
        metadata: { snoozedUntil: date.toISOString() },
        ipAddress: getIp(req),
      })

      return { ok: true, lead: updated }
    } catch (err: any) {
      app.log.error(`Atendimento snooze error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── POST /api/atendimento/tickets/:leadId/unsnooze — Acordar lead adormecido ──
  app.post('/api/atendimento/tickets/:leadId/unsnooze', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return

      const updated = await prisma.lead.update({
        where: { id: lid },
        data: { snoozedUntil: null },
        select: { id: true, snoozedUntil: true },
      })

      logEvent({
        leadId: lid,
        type: EVENT_TYPES.OPERATOR_ASSIGNED,
        category: 'operator',
        title: 'Lead acordado (snooze cancelado)',
        source: 'panel',
        ...getOperator(req),
        ipAddress: getIp(req),
      })

      return { ok: true, lead: updated }
    } catch (err: any) {
      app.log.error(`Atendimento unsnooze error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── GET /api/atendimento/tickets/:leadId/info — Lead details ──
  app.get('/api/atendimento/tickets/:leadId/info', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { leadId } = req.params as any
      const lid = parseInt(leadId)
      if (!await assertTicketAccess(req, reply, lid)) return
      const lead = await prisma.lead.findUnique({
        where: { id: lid },
        select: {
          id: true,
          nome: true,
          empresa: true,
          whatsapp: true,
          isGroup: true,
          email: true,
          segmento: true,
          cidade: true,
          status: true,
          completed: true,
          maturidade: true,
          solucaoNome: true,
          scores: true,
          lastStep: true,
          profilePicUrl: true,
          createdAt: true,
          lastActivityAt: true,
          lastMessageAt: true,
          unreadMessages: true,
          assignedUserId: true,
          assignedUser: { select: { id: true, name: true, email: true, lastSeenAt: true } },
          teamId: true,
          team: { select: { id: true, name: true, color: true, slug: true } },
          assignedAt: true,
          annotation: true,
          source: true,
          qualifiedAt: true,
          qualificationSource: true,
          conversationOpenedAt: true,
          conversationClosedAt: true,
          snoozedUntil: true,
          formData: true,
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } }
        }
      })
      if (!lead) {
        return reply.code(404).send({ error: 'Lead nao encontrado' })
      }
      // Estado do takeover humano para a UI (badge + botão "devolver ao bot").
      // `formData` sai do payload: serve só para derivar o marcador.
      const { readBotPause } = await import('../services/botTakeover.js')
      const { formData, ...rest } = lead as any
      return { lead: { ...rest, botPaused: readBotPause(formData) } }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
