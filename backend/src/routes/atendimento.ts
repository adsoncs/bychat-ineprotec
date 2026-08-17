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

/** Campos de um item da lista de conversas. Extraído porque duas consultas
 *  precisam dele: a das conversas fixadas (que sobem ao topo) e a da lista
 *  paginada — e um `select` divergente entre elas faria a mesma conversa
 *  aparecer com dados diferentes conforme estivesse fixada ou não. */
const SELECAO_TICKET = {
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
          cloudApiConnection: { select: { displayPhone: true, displayName: true, color: true } },
        },
      },
  } as const

export async function atendimentoRoutes(app: FastifyInstance) {

  // ── GET /api/atendimento/unread-count — quantas conversas esperam por você ──
  // Existe para o contador do menu, que fica visível em TODA tela: buscar a
  // lista inteira de tickets a cada 30s só para exibir um número seria caro, e
  // o menu não precisa de nenhum dado do lead — só da contagem.
  // O escopo é o MESMO da listagem (own/team/all), senão o número mostraria
  // conversas que o operador não pode abrir.
  app.get('/api/atendimento/unread-count', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const user = (req as any).user as JwtPayload
      const myTeamIds = await getUserTeamIds(user.userId)
      const effectiveScope = await getLeadScope(user.userId, user.role)

      let scopeWhere: any = {}
      if (effectiveScope === 'own') {
        scopeWhere = { assignedUserId: user.userId }
      } else if (effectiveScope !== 'all') {
        scopeWhere = {
          OR: [
            { assignedUserId: user.userId },
            ...(myTeamIds.length > 0 ? [{ teamId: { in: myTeamIds } }] : []),
          ],
        }
      }

      const unread = await prisma.lead.count({
        where: { ...scopeWhere, unreadMessages: { gt: 0 } },
      })
      return { unread }
    } catch (err: any) {
      req.log.error(`[atendimento] unread-count: ${err?.message || err}`)
      return reply.code(500).send({ error: 'Falha ao contar conversas não lidas' })
    }
  })

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
        const alvos: any[] = [
          { nome: { contains: search } },
          { empresa: { contains: search } },
          { whatsapp: { contains: search } },
          { email: { contains: search } },
        ]
        // Procurar DENTRO das mensagens é o que o operador espera de uma busca
        // de conversas ("aquele cliente que falou em boleto"). Exige 3
        // caracteres: com uma ou duas letras o LIKE '%x%' varre a tabela
        // inteira e devolve quase tudo, o que não ajuda ninguém.
        if (search.trim().length >= 3) {
          alvos.push({ messages: { some: { body: { contains: search }, isDeleted: false } } })
        }
        andClauses.push({ OR: alvos })
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
      // Filtro por NÚMERO: conversas que PERTENCEM a este canal.
      //
      // Antes a regra era "tem ao menos uma mensagem enviada por este número,
      // em qualquer época" — e uma conversa atendida ontem pelo número A e hoje
      // pelo B aparecia nos DOIS filtros, carimbada com o rótulo do B. Era o
      // "filtrei uma instância e veio conversa de outra".
      //
      // Agora vale a mesma regra que decide por qual número respondemos: o
      // canal da última mensagem recebida (e, para conversa que só nós
      // iniciamos, o da última mensagem). Uma conversa pertence a um canal só.
      const sc = (query.senderChannel ?? '').toString()
      if (sc.startsWith('evolution:') || sc.startsWith('cloud:')) {
        const { leadsDoCanal } = await import('../services/whatsappProvider.js')
        const idsDoCanal = await leadsDoCanal(sc)
        // Nenhuma conversa nesse número: lista vazia, e não a lista inteira.
        andClauses.push({ id: { in: idsDoCanal.length ? idsDoCanal : [-1] } })
      }
      // Merge (append) preservando as cláusulas de bucket já em where.AND (antes o
      // where.AND era SOBRESCRITO por search/tags, perdendo o filtro de snooze).
      if (andClauses.length > 0) {
        where.AND = [...(where.AND ?? []), ...andClauses]
      }

      // Conversas que ESTE operador fixou (a fixação é pessoal). Elas saem da
      // paginação normal e entram inteiras no topo da primeira página: ordenar
      // depois de paginar não funcionaria — uma conversa fixada de duas semanas
      // atrás simplesmente não estaria entre os `limit` mais recentes.
      const pins = await prisma.conversationPin.findMany({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        select: { leadId: true },
      })
      const idsFixados = pins.map(p => p.leadId)
      const fixados = new Set(idsFixados)

      // As fixadas ainda respeitam os filtros da tela: fixar não faz uma
      // conversa resolvida aparecer na caixa de entrada.
      const whereFixados = idsFixados.length
        ? { AND: [where, { id: { in: idsFixados } }] }
        : null
      const ticketsFixados = (offset === 0 && whereFixados)
        ? await prisma.lead.findMany({
            where: whereFixados,
            orderBy: { lastMessageAt: 'desc' },
            take: limit,
            select: SELECAO_TICKET,
          })
        : []

      // A lista normal nunca repete o que já subiu (nem em páginas seguintes).
      const whereLista = idsFixados.length
        ? { AND: [where, { id: { notIn: idsFixados } }] }
        : where

      const [tickets, total] = await Promise.all([
        prisma.lead.findMany({
          where: whereLista,
          orderBy: { lastMessageAt: 'desc' },
          take: Math.max(0, limit - ticketsFixados.length),
          skip: offset,
          select: SELECAO_TICKET,
        }),
        prisma.lead.count({ where }),
      ])

      // Resolve o canal/número de origem de cada conversa (última mensagem).
      // Pré-carrega instâncias/conexões pra resolver em memória + fallback p/
      // histórico (mensagens antigas sem evolutionInstance/cloudApiConnectionId).
      const [allInstances, allCloud] = await Promise.all([
        prisma.whatsAppInstance.findMany({ select: { instanceName: true, name: true, phone: true, color: true } }),
        prisma.cloudApiConnection.findMany({ where: { active: true }, select: { id: true, displayPhone: true, displayName: true, color: true } }),
      ])
      const instByName = new Map(allInstances.map(i => [i.instanceName, i]))
      const cloudById = new Map(allCloud.map(c => [c.id, c]))
      const soleInstance = allInstances.length === 1 ? allInstances[0] : null
      const soleCloud = allCloud.length === 1 ? allCloud[0] : null
      const buildChannel = (m: any) => {
        if (!m) return null
        // O rótulo é o nome que a empresa deu ao canal — não o do provedor. Quem
        // atende precisa saber QUAL número falou com o contato; "Evolution" e
        // "Cloud API" são detalhe de integração e não dizem nada na conversa.
        if (m.provider === 'cloud_api') {
          // Resolve pelo id quando o objeto não veio junto — é o caso do canal
          // efetivo, que sai de uma consulta enxuta (só ids).
          const c = m.cloudApiConnection || (m.cloudApiConnectionId ? cloudById.get(m.cloudApiConnectionId) : null) || soleCloud
          return { provider: 'cloud_api', label: c?.displayName ?? null, number: c?.displayPhone ?? null, name: c?.displayName ?? null, color: (c as any)?.color ?? null }
        }
        if (m.provider === 'instagram') return { provider: 'instagram', label: 'Instagram', number: null, name: null, color: null }
        if (m.provider === 'messenger') return { provider: 'messenger', label: 'Messenger', number: null, name: null, color: null }
        const inst = (m.evolutionInstance ? instByName.get(m.evolutionInstance) : null) || soleInstance
        // Nome só serve como rótulo se não for o identificador técnico da
        // instância — nesse caso o cadastro nunca recebeu um nome de verdade.
        const nomeInst = inst?.name && inst.name !== inst.instanceName ? inst.name : null
        return { provider: 'evolution', label: nomeInst, number: inst?.phone ?? null, name: nomeInst ?? m.evolutionInstance ?? null, color: inst?.color ?? null }
      }

      // O rótulo do número segue o MESMO critério do filtro e do envio: senão a
      // conversa aparece na lista de um número mostrando o nome de outro.
      const { canalEfetivoDeLeads } = await import('../services/whatsappProvider.js')
      const canalPorLead = await canalEfetivoDeLeads([...ticketsFixados, ...tickets].map(t => t.id))

      const result = [...ticketsFixados, ...tickets].map(t => {
        const last = t.messages[0] || null
        const efetivo = canalPorLead.get(t.id)
        // `last` ainda alimenta a prévia da conversa; o canal vem do efetivo,
        // com a última mensagem como retaguarda (conversa sem histórico útil).
        const paraCanal = efetivo
          ? {
              provider: efetivo.provider,
              evolutionInstance: efetivo.evolutionInstance,
              cloudApiConnection: null,
              cloudApiConnectionId: efetivo.cloudApiConnectionId,
            }
          : last
        return {
          ...t,
          lastMessage: last ? { body: last.body, fromMe: last.fromMe, timestamp: last.timestamp } : null,
          channel: buildChannel(paraCanal),
          pinned: fixados.has(t.id),
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
          timestamp: true,
          // Estado da mensagem depois de enviada: a bolha precisa saber se foi
          // editada, se foi apagada para todos (vira "mensagem apagada" em vez
          // de sumir), se veio encaminhada e quais reações tem.
          editedAt: true,
          deletedForAll: true,
          isForwarded: true,
          reactions: true,
        }
      })

      // Return in chronological order
      messages.reverse()

      // Trecho da mensagem CITADA em cada resposta.
      //
      // A tela só conseguia mostrar a citação quando a mensagem original estava
      // entre as 50 carregadas. Quando o cliente responde a algo de ontem — o
      // caso mais comum em grupo —, a bolha aparecia sem contexto nenhum. Aqui
      // o servidor manda junto o resumo do que foi citado, uma consulta só para
      // a página inteira.
      const citadasIds = [...new Set(messages.map(m => m.quotedMsgId).filter((v): v is number => !!v))]
      if (citadasIds.length) {
        const citadas = await prisma.message.findMany({
          where: { id: { in: citadasIds } },
          select: { id: true, body: true, fromMe: true, senderName: true, mediaType: true, deletedForAll: true },
        })
        const porId = new Map(citadas.map(c => [c.id, c]))
        for (const m of messages as any[]) {
          const c = m.quotedMsgId ? porId.get(m.quotedMsgId) : null
          m.quoted = c
            ? {
                id: c.id,
                body: c.deletedForAll ? null : c.body,
                fromMe: c.fromMe,
                senderName: c.senderName,
                mediaType: c.mediaType,
                deleted: c.deletedForAll,
              }
            : null
        }
      }

      // Menções de grupo chegam como "@<identificador>" — número que não é
      // telefone e não diz nada a quem lê. Resolvido na LEITURA para o texto
      // gravado continuar sendo o que o contato recebeu, e para as mensagens
      // antigas aparecerem certas sem migração.
      const { resolverMencoesEmLote } = await import('../services/mentionResolver.js')
      const comMencoes = await resolverMencoesEmLote(messages).catch(() => messages)

      return { messages: comMencoes, hasMore: messages.length === limit }
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
      const { body: msgBody, mediaType, mediaUrl, mediaName, isInternal, quotedMsgId, channelId, template, continuacao } = req.body as any
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
        continuacao: !!continuacao,
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
  // ── POST /api/atendimento/conversations — abrir conversa com um número novo ──
  // O contato chegou por fora (indicação, evento, ligação) e o time precisa
  // falar agora, sem esperar ele mandar a primeira mensagem.
  app.post('/api/atendimento/conversations', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const { nome, telefone, channelId, ignorarChecagem } = (req.body ?? {}) as any

    const { startConversation } = await import('../services/conversationStarter.js')
    const r = await startConversation({
      nome: String(nome || ''),
      telefone: String(telefone || ''),
      channelId: channelId ?? null,
      ignorarChecagem: !!ignorarChecagem,
      actor: { userId: user.userId, role: user.role, name: user.name },
    })

    if (!r.ok) {
      const payload: Record<string, unknown> = { error: r.error }
      if (r.code) payload.code = r.code
      return reply.code(r.status).send(payload)
    }

    logEvent({
      leadId: r.leadId,
      type: EVENT_TYPES.OPERATOR_ASSIGNED,
      category: 'operator',
      title: r.criado ? 'Conversa iniciada pelo operador (contato novo)' : 'Conversa reaberta pelo operador',
      channel: 'whatsapp',
      source: 'panel',
      ...getOperator(req),
      ipAddress: getIp(req),
    } as any)

    return { ok: true, leadId: r.leadId, criado: r.criado, jaTinhaConversa: r.jaTinhaConversa }
  })

  // ── GET /api/atendimento/whatsapp-chats — conversas que existem no aparelho ──
  // Lista o que a instância tem, cruzado com a base: o operador precisa ver o
  // que já está no painel antes de escolher o que importar.
  app.get('/api/atendimento/whatsapp-chats', { preHandler: authMiddleware }, async (req, reply) => {
    const { instance } = req.query as { instance?: string }
    let instanceName = instance
    if (!instanceName) {
      const inst = await prisma.whatsAppInstance.findFirst({
        where: { active: true }, select: { instanceName: true }, orderBy: { id: 'asc' },
      })
      instanceName = inst?.instanceName
    }
    if (!instanceName) return reply.code(400).send({ error: 'Nenhuma instância WhatsApp ativa.' })

    try {
      const { listarChatsDoAparelho, resumirChats } = await import('../services/whatsappChatImport.js')
      const chats = await listarChatsDoAparelho(instanceName)
      return { instance: instanceName, chats, resumo: resumirChats(chats) }
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || 'Não foi possível ler as conversas do aparelho.' })
    }
  })

  // ── GET /api/atendimento/whatsapp-instances — números conectados por QR ─────
  app.get('/api/atendimento/whatsapp-instances', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.whatsAppInstance.findMany({
      where: { active: true },
      select: { id: true, name: true, instanceName: true, phone: true },
      orderBy: { id: 'asc' },
    })
    return { instances: rows }
  })

  // ── POST /api/atendimento/whatsapp-chats/import — sincronizar selecionadas ──
  app.post('/api/atendimento/whatsapp-chats/import', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const { instance, chats } = (req.body ?? {}) as { instance?: string; chats?: any[] }
    if (!instance) return reply.code(400).send({ error: 'Informe a instância.' })
    if (!Array.isArray(chats) || !chats.length) return reply.code(400).send({ error: 'Nenhuma conversa selecionada.' })
    // Teto de sanidade, não de usabilidade: a fila processa 2 por vez e a tela
    // mostra o andamento, então não há razão para obrigar o operador a fatiar a
    // seleção em blocos de 100 como antes.
    if (chats.length > 5000) return reply.code(400).send({ error: 'Seleção grande demais (máximo 5.000 conversas por disparo).' })

    const { enfileirarImportacao } = await import('../services/chatImportRunner.js')
    const jobs = await enfileirarImportacao(
      instance,
      chats.map((c) => ({ remoteJid: String(c.remoteJid), telefone: String(c.telefone || ''), nome: c.nome ?? null, leadId: c.leadId ?? null })),
      user.userId,
    )
    return {
      ok: true,
      jobs,
      enfileiradas: jobs.filter((j) => !j.jaEstava).length,
      jaEstavamNaFila: jobs.filter((j) => j.jaEstava).length,
    }
  })

  // ── GET /api/atendimento/whatsapp-chats/import — progresso ─────────────────
  app.get('/api/atendimento/whatsapp-chats/import', { preHandler: authMiddleware }, async (req) => {
    const { ativos, limite } = req.query as { ativos?: string; limite?: string }
    const take = Math.min(Math.max(parseInt(limite || '') || 60, 10), 200)
    const [jobs, agregado] = await Promise.all([
      prisma.chatImportJob.findMany({
        where: ativos === '1' ? { status: { in: ['pending', 'running'] } } : {},
        orderBy: { createdAt: 'desc' },
        take,
        include: { lead: { select: { id: true, nome: true } } },
      }),
      prisma.chatImportJob.groupBy({ by: ['status'], _count: { _all: true }, _sum: { importadas: true } }),
    ])
    const porStatus = Object.fromEntries(agregado.map((a) => [a.status, a._count._all]))
    return {
      jobs,
      fila: {
        naFila: porStatus['pending'] ?? 0,
        rodando: porStatus['running'] ?? 0,
        concluidos: porStatus['done'] ?? 0,
        falharam: porStatus['failed'] ?? 0,
        cancelados: porStatus['canceled'] ?? 0,
        mensagensImportadas: agregado.reduce((s, a) => s + (a._sum.importadas ?? 0), 0),
      },
    }
  })

  // ── POST /api/atendimento/whatsapp-chats/import/cancelar-tudo ──────────────
  // Freio de emergência: um "sincronizar todas" de mil conversas precisa de um
  // jeito de parar sem clicar em cada job.
  app.post('/api/atendimento/whatsapp-chats/import/cancelar-tudo', { preHandler: authMiddleware }, async () => {
    const r = await prisma.chatImportJob.updateMany({
      where: { status: { in: ['pending', 'running'] } },
      data: { status: 'canceled', finishedAt: new Date() },
    })
    return { ok: true, cancelados: r.count }
  })

  // ── DELETE /api/atendimento/whatsapp-chats/import/historico — limpar ───────
  app.delete('/api/atendimento/whatsapp-chats/import/historico', { preHandler: authMiddleware }, async () => {
    const r = await prisma.chatImportJob.deleteMany({ where: { status: { in: ['done', 'failed', 'canceled'] } } })
    return { ok: true, removidos: r.count }
  })

  // ── DELETE /api/atendimento/whatsapp-chats/import/:id — cancelar ───────────
  app.delete('/api/atendimento/whatsapp-chats/import/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const job = await prisma.chatImportJob.findUnique({ where: { id } })
    if (!job) return reply.code(404).send({ error: 'Importação não encontrada' })
    if (job.status === 'done') return reply.code(409).send({ error: 'Esta importação já terminou.' })
    // O runner checa o status a cada página e para sozinho.
    const upd = await prisma.chatImportJob.update({ where: { id }, data: { status: 'canceled', finishedAt: new Date() } })
    return { ok: true, job: upd }
  })

  // ── POST /api/atendimento/tickets/:leadId/fetch-media — baixar mídias ──────
  // Chamado ao abrir uma conversa importada: as mensagens vieram com o tipo
  // certo mas sem arquivo, e o download acontece só do que o operador vai ver.
  app.post('/api/atendimento/tickets/:leadId/fetch-media', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const { limite } = (req.body ?? {}) as { limite?: number }
    const { baixarMidiasPendentes } = await import('../services/chatMediaFetcher.js')
    const r = await baixarMidiasPendentes(lid, Math.min(Math.max(Number(limite) || 15, 1), 50))
    return r
  })

  // ── GET /api/atendimento/tickets/:leadId/pending-media — quantas faltam ────
  app.get('/api/atendimento/tickets/:leadId/pending-media', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const { contarMidiasPendentes } = await import('../services/chatMediaFetcher.js')
    return { pendentes: await contarMidiasPendentes(lid) }
  })

  // ── POST /api/atendimento/whatsapp-chats/import-all — sincronizar todas ────
  // Com recorte de período: trazer conversa parada há dois anos enche a base de
  // gente que não é mais lead. O padrão é 90 dias.
  app.post('/api/atendimento/whatsapp-chats/import-all', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const {
      instance, dias, somenteNovas, somenteComLead, incluirSincronizadas, busca, limite,
    } = (req.body ?? {}) as {
      instance?: string
      dias?: number
      /** Só conversas que ainda não têm lead no painel. */
      somenteNovas?: boolean
      /** Só conversas que JÁ têm lead — o inverso, para o recorte "já têm lead". */
      somenteComLead?: boolean
      /** Refazer também as que já foram sincronizadas antes. */
      incluirSincronizadas?: boolean
      busca?: string
      /** Teto opcional escolhido pelo operador; sem ele, vai tudo. */
      limite?: number
    }
    let instanceName = instance
    if (!instanceName) {
      const inst = await prisma.whatsAppInstance.findFirst({ where: { active: true }, select: { instanceName: true }, orderBy: { id: 'asc' } })
      instanceName = inst?.instanceName
    }
    if (!instanceName) return reply.code(400).send({ error: 'Nenhuma instância WhatsApp ativa.' })

    const janelaDias = Math.min(Math.max(Number(dias) || 90, 1), 3650)
    const corte = new Date(Date.now() - janelaDias * 24 * 3600 * 1000)
    const termo = String(busca || '').trim().toLowerCase()

    try {
      const { listarChatsDoAparelho } = await import('../services/whatsappChatImport.js')
      const todos = await listarChatsDoAparelho(instanceName)
      const importaveis = todos.filter((c) => c.importavel)
      const noPeriodo = importaveis.filter((c) => c.ultimaMensagemEm && new Date(c.ultimaMensagemEm) >= corte)

      let alvo = noPeriodo
      if (somenteNovas) alvo = alvo.filter((c) => !c.leadId)
      if (somenteComLead) alvo = alvo.filter((c) => !!c.leadId)
      const jaSincronizadas = alvo.filter((c) => !!c.sincronizadoEm).length
      if (!incluirSincronizadas) alvo = alvo.filter((c) => !c.sincronizadoEm)
      if (termo) {
        alvo = alvo.filter((c) => (c.nome || '').toLowerCase().includes(termo)
          || (c.telefone || '').includes(termo)
          || (c.leadNome || '').toLowerCase().includes(termo))
      }

      // Sem teto obrigatório: quem tem 1.200 conversas não deve precisar de 4
      // disparos. O `limite` existe só para quem QUER fatiar.
      const teto = Number(limite) > 0 ? Math.min(Number(limite), 5000) : 5000
      const lote = alvo.slice(0, teto)

      const { enfileirarImportacao } = await import('../services/chatImportRunner.js')
      const jobs = await enfileirarImportacao(
        instanceName,
        lote.map((c) => ({ remoteJid: c.remoteJid, telefone: c.telefone!, nome: c.nome, leadId: c.leadId })),
        user.userId,
      )

      return {
        ok: true,
        enfileiradas: jobs.filter((j) => !j.jaEstava).length,
        jaEstavamNaFila: jobs.filter((j) => j.jaEstava).length,
        // Números explícitos: o operador precisa saber o que NÃO foi, e por quê.
        totalNoAparelho: todos.length,
        naoImportaveis: todos.length - importaveis.length,
        foraDoPeriodo: importaveis.length - noPeriodo.length,
        jaSincronizadas: incluirSincronizadas ? 0 : jaSincronizadas,
        acimaDoTeto: Math.max(0, alvo.length - lote.length),
        janelaDias,
      }
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || 'Falha ao ler as conversas do aparelho.' })
    }
  })

  // ── GET /api/atendimento/whatsapp-contacts — agenda do aparelho ────────────
  app.get('/api/atendimento/whatsapp-contacts', { preHandler: authMiddleware }, async (req, reply) => {
    const { instance } = req.query as { instance?: string }
    let instanceName = instance
    if (!instanceName) {
      const inst = await prisma.whatsAppInstance.findFirst({ where: { active: true }, select: { instanceName: true }, orderBy: { id: 'asc' } })
      instanceName = inst?.instanceName
    }
    if (!instanceName) return reply.code(400).send({ error: 'Nenhuma instância WhatsApp ativa.' })
    try {
      const { listarContatosDaAgenda } = await import('../services/whatsappChatImport.js')
      const contatos = await listarContatosDaAgenda(instanceName)
      return {
        instance: instanceName,
        contatos,
        resumo: {
          total: contatos.length,
          importaveis: contatos.filter((c) => c.importavel).length,
          jaNoPainel: contatos.filter((c) => c.leadId).length,
          semTelefone: contatos.filter((c) => !c.importavel && !c.isGroup).length,
        },
      }
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || 'Falha ao ler a agenda.' })
    }
  })

  // ── POST /api/atendimento/whatsapp-contacts/import — criar leads da agenda ──
  // Aceita a lista escolhida na tela OU `todos: true`, que resolve a seleção no
  // servidor. Com `todos`, a agenda inteira entra de uma vez — antes o teto de
  // 500 obrigava a marcar contato por contato em bases grandes.
  app.post('/api/atendimento/whatsapp-contacts/import', { preHandler: authMiddleware }, async (req, reply) => {
    const { contatos, todos, instance, busca } = (req.body ?? {}) as {
      contatos?: Array<{ telefone: string; nome?: string | null }>
      todos?: boolean
      instance?: string
      busca?: string
    }

    let alvo: Array<{ telefone: string; nome?: string | null }> = []

    if (todos) {
      let instanceName = instance
      if (!instanceName) {
        const inst = await prisma.whatsAppInstance.findFirst({ where: { active: true }, select: { instanceName: true }, orderBy: { id: 'asc' } })
        instanceName = inst?.instanceName
      }
      if (!instanceName) return reply.code(400).send({ error: 'Nenhuma instância WhatsApp ativa.' })
      const { listarContatosDaAgenda } = await import('../services/whatsappChatImport.js')
      const termo = String(busca || '').trim().toLowerCase()
      alvo = (await listarContatosDaAgenda(instanceName))
        .filter((c) => c.importavel && !c.leadId)
        .filter((c) => !termo || (c.nome || '').toLowerCase().includes(termo) || (c.telefone || '').includes(termo))
        .map((c) => ({ telefone: c.telefone!, nome: c.nome }))
    } else {
      if (!Array.isArray(contatos) || !contatos.length) return reply.code(400).send({ error: 'Nenhum contato selecionado.' })
      alvo = contatos
    }

    if (!alvo.length) return { ok: true, criados: 0, jaExistiam: 0, ignorados: 0 }

    const { importarContatosComoLeads } = await import('../services/whatsappChatImport.js')
    const r = await importarContatosComoLeads(alvo)
    return { ok: true, ...r }
  })

  // ── Sincronizar UMA conversa, de dentro dela ───────────────────────────────
  // O operador está com o histórico do celular na frente e o painel vazio; ir
  // até a tela de importação, achar o contato no meio de mil e voltar é um
  // caminho que ninguém faz. Aqui ele sincroniza o contato que está lendo.

  // GET: situação da última sincronização deste lead (para a tela acompanhar).
  app.get('/api/atendimento/tickets/:leadId/sync-whatsapp', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const job = await prisma.chatImportJob.findFirst({
      where: { leadId: lid },
      orderBy: { createdAt: 'desc' },
    })
    return { job }
  })

  // POST: procura a conversa no aparelho e enfileira a importação com prioridade.
  app.post('/api/atendimento/tickets/:leadId/sync-whatsapp', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return

    const lead = await prisma.lead.findUnique({
      where: { id: lid },
      select: { id: true, nome: true, whatsapp: true, phoneKey: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Conversa não encontrada.' })

    const { phoneKey } = await import('../lib/phone.js')
    const chave = lead.phoneKey || phoneKey(lead.whatsapp || '')
    if (!chave) {
      return reply.code(422).send({
        motivo: 'sem_telefone',
        error: 'Esta conversa não tem um telefone válido — não há como localizá-la no celular.',
      })
    }

    // Já há sincronização em curso: devolve a existente em vez de duplicar.
    const emAndamento = await prisma.chatImportJob.findFirst({
      where: { leadId: lid, status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (emAndamento) return { ok: true, jaEstava: true, job: emAndamento }

    // Onde procurar: a instância que já conversou com este lead vem primeiro;
    // depois as demais ativas (número novo pode ter herdado a conversa).
    const ultima = await prisma.message.findFirst({
      where: { leadId: lid, provider: 'evolution', evolutionInstance: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: { evolutionInstance: true },
    })
    const ativas = await prisma.whatsAppInstance.findMany({
      where: { active: true },
      select: { instanceName: true },
      orderBy: { id: 'asc' },
    })
    const candidatas = [
      ...(ultima?.evolutionInstance ? [ultima.evolutionInstance] : []),
      ...ativas.map((i) => i.instanceName),
    ].filter((v, i, a) => a.indexOf(v) === i)

    if (!candidatas.length) {
      return reply.code(422).send({
        motivo: 'sem_instancia',
        error: 'Nenhum número conectado por QR Code. Só esses têm histórico para trazer.',
      })
    }

    const { encontrarChatDoLead } = await import('../services/whatsappChatImport.js')
    let achado: { remoteJid: string; nome: string | null; telefone: string } | null = null
    let instanceName = ''
    const falhas: string[] = []
    for (const inst of candidatas) {
      try {
        const r = await encontrarChatDoLead(inst, chave)
        if (r) { achado = r; instanceName = inst; break }
      } catch (e: any) {
        falhas.push(String(e?.message || e))
      }
    }

    if (!achado) {
      // Nada a sincronizar é resultado legítimo, não erro: a tela precisa
      // distinguir "não existe conversa no celular" de "deu problema".
      if (falhas.length === candidatas.length) {
        return reply.code(502).send({ motivo: 'falha_provedor', error: falhas[0] || 'Não foi possível falar com o WhatsApp.' })
      }
      return { ok: true, encontrado: false, motivo: 'sem_conversa_no_aparelho' }
    }

    const { enfileirarImportacao } = await import('../services/chatImportRunner.js')
    const [criado] = await enfileirarImportacao(
      instanceName,
      [{ remoteJid: achado.remoteJid, telefone: achado.telefone, nome: achado.nome || lead.nome, leadId: lid }],
      user.userId,
      1, // fura a fila do "sincronizar todas"
    )
    if (!criado) return reply.code(500).send({ error: 'Não foi possível iniciar a sincronização.' })

    const job = await prisma.chatImportJob.findUnique({ where: { id: criado.id } })
    return { ok: true, encontrado: true, instancia: instanceName, job }
  })

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

  // ══════════════════════════════════════════════════════
  //  AÇÕES SOBRE A MENSAGEM — editar, apagar, encaminhar, reagir
  //
  //  O que cada canal aceita é decidido no provider, não aqui: a Evolution faz
  //  tudo; a API Oficial da Meta não tem editar nem apagar (confirmado na
  //  documentação — ela só NOTIFICA quando o cliente apaga). Nesses casos o
  //  operador recebe o motivo, e o "apagar para mim" continua valendo, porque
  //  esse é local dos dois lados.
  // ══════════════════════════════════════════════════════

  /** Traduz o erro do serviço em resposta HTTP preservando status e código. */
  function respondeErroAcao(reply: any, err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500
    return reply.code(status).send({ error: err?.message || 'Falha na ação', code: err?.code })
  }

  function atorDaRequisicao(req: any) {
    const u = (req as any).user as JwtPayload & { name?: string; email?: string }
    return { userId: u.userId, role: u.role, name: u.name ?? null, email: u.email ?? null }
  }

  // PATCH /api/atendimento/tickets/:leadId/messages/:messageId — editar texto
  app.patch('/api/atendimento/tickets/:leadId/messages/:messageId', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadId, messageId } = req.params as any
    const lid = parseInt(leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    try {
      const { editarMensagem } = await import('../services/messageActions.js')
      return await editarMensagem(lid, parseInt(messageId), (req.body as any)?.body ?? '', atorDaRequisicao(req))
    } catch (err: any) {
      return respondeErroAcao(reply, err)
    }
  })

  // DELETE /api/atendimento/tickets/:leadId/messages/:messageId?scope=me|all
  app.delete('/api/atendimento/tickets/:leadId/messages/:messageId', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadId, messageId } = req.params as any
    const lid = parseInt(leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const scope = (req.query as any)?.scope === 'all' ? 'all' : 'me'
    try {
      const { apagarMensagem } = await import('../services/messageActions.js')
      return await apagarMensagem(lid, parseInt(messageId), scope, atorDaRequisicao(req))
    } catch (err: any) {
      return respondeErroAcao(reply, err)
    }
  })

  // POST /api/atendimento/tickets/:leadId/messages/:messageId/forward
  app.post('/api/atendimento/tickets/:leadId/messages/:messageId/forward', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadId, messageId } = req.params as any
    const lid = parseInt(leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const alvos = Array.isArray((req.body as any)?.leadIds) ? (req.body as any).leadIds : []
    const destinos = alvos.map((id: unknown) => ({ leadId: Number(id) })).filter((d: any) => Number.isFinite(d.leadId))
    // Encaminhar é ENVIAR para outra conversa: quem não pode falar com o
    // destino não pode encaminhar para ele.
    for (const d of destinos) {
      const quem = (req as any).user as JwtPayload
      if (!await canUserAccessLead(quem.userId, quem.role, d.leadId)) {
        return reply.code(403).send({ error: 'Você não tem acesso a uma das conversas de destino.' })
      }
    }
    try {
      const { encaminharMensagem } = await import('../services/messageActions.js')
      return await encaminharMensagem(lid, parseInt(messageId), destinos, atorDaRequisicao(req))
    } catch (err: any) {
      return respondeErroAcao(reply, err)
    }
  })

  // POST /api/atendimento/tickets/:leadId/messages/:messageId/react
  app.post('/api/atendimento/tickets/:leadId/messages/:messageId/react', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadId, messageId } = req.params as any
    const lid = parseInt(leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    try {
      const { reagirMensagem } = await import('../services/messageActions.js')
      // String vazia é como o WhatsApp remove a reação — não é erro.
      return await reagirMensagem(lid, parseInt(messageId), String((req.body as any)?.emoji ?? ''), atorDaRequisicao(req))
    } catch (err: any) {
      return respondeErroAcao(reply, err)
    }
  })

  /** Teto de conversas fixadas por operador. O WhatsApp para em 3; aqui a fila
   *  de atendimento é maior, mas sem limite a fixação deixa de destacar nada. */
  const PINS_MAX = 10

  // POST /api/atendimento/tickets/:leadId/pin — fixa no topo (só para você)
  app.post('/api/atendimento/tickets/:leadId/pin', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const { userId } = (req as any).user as JwtPayload
    const jaFixadas = await prisma.conversationPin.count({ where: { userId } })
    const jaTem = await prisma.conversationPin.findUnique({ where: { userId_leadId: { userId, leadId: lid } } })
    if (!jaTem && jaFixadas >= PINS_MAX) {
      return reply.code(400).send({
        error: `Você já tem ${PINS_MAX} conversas fixadas. Desafixe uma antes de fixar outra.`,
        code: 'PIN_LIMIT',
      })
    }
    // Idempotente: fixar de novo não é erro, é o estado que o operador quer.
    await prisma.conversationPin.upsert({
      where: { userId_leadId: { userId, leadId: lid } },
      create: { userId, leadId: lid },
      update: {},
    })
    return { ok: true, pinned: true }
  })

  // DELETE /api/atendimento/tickets/:leadId/pin — desafixa
  app.delete('/api/atendimento/tickets/:leadId/pin', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    const { userId } = (req as any).user as JwtPayload
    await prisma.conversationPin.deleteMany({ where: { userId, leadId: lid } })
    return { ok: true, pinned: false }
  })

  // PUT /api/atendimento/tickets/:leadId/unread — desfaz a leitura acidental
  app.put('/api/atendimento/tickets/:leadId/unread', { preHandler: authMiddleware }, async (req, reply) => {
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return
    try {
      const { marcarConversaNaoLida } = await import('../services/messageActions.js')
      return await marcarConversaNaoLida(lid, atorDaRequisicao(req))
    } catch (err: any) {
      return respondeErroAcao(reply, err)
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

      // Avisa o CONTATO que outra pessoa assumiu (Configurações › Conversas).
      // Só quando o responsável muda de fato — trocar só o setor não é algo que
      // o contato precise saber. As demais guardas (conversa aberta, horário de
      // atendimento, anti-repetição) estão no próprio serviço.
      if (userChanged && newUserId) {
        const { notifyAssignmentChange } = await import('../services/operatorIdentity.js')
        notifyAssignmentChange({
          leadId: lid,
          novoUserId: newUserId,
          novoTeamId: newTeamId,
          actorUserId: user.userId,
          actorRole: user.role,
        }).catch(() => {})
      }

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

      // Alguém NOVO assumiu uma conversa que já estava em andamento com outra
      // pessoa: para o contato, isso é uma transferência. Se o lead estava sem
      // responsável (fila), o serviço barra pelas guardas dele.
      if ((lead.assignedUserId ?? null) !== user.userId) {
        const { notifyAssignmentChange } = await import('../services/operatorIdentity.js')
        notifyAssignmentChange({
          leadId: lid,
          novoUserId: user.userId,
          novoTeamId: lead.teamId ?? null,
          actorUserId: user.userId,
          actorRole: user.role,
        }).catch(() => {})
      }

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

  // ── GET /api/atendimento/tickets/:leadId/funnel — funil e etapas do lead ──
  //
  // O operador está na conversa e precisa mover o lead sem sair dela: ir até o
  // Kanban, achar o card no meio de centenas e voltar é o caminho que ninguém
  // faz — e por isso a etapa ficava desatualizada.
  //
  // Devolve o funil ATUAL com a trilha inteira, os funis para onde dá para
  // mudar, por onde o lead já passou e o que ESTE usuário pode fazer: a tela
  // precisa saber se pode avançar/retroceder antes de oferecer o clique.
  app.get('/api/atendimento/tickets/:leadId/funnel', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const lid = parseInt((req.params as any).leadId)
    if (!await assertTicketAccess(req, reply, lid)) return

    const lead = await prisma.lead.findUnique({
      where: { id: lid },
      select: { id: true, funnelId: true, status: true, qualifiedAt: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Conversa não encontrada.' })

    const funis = await prisma.funnel.findMany({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: {
        id: true, name: true, isDefault: true,
        stages: {
          where: { active: true },
          orderBy: { position: 'asc' },
          select: { key: true, name: true, color: true, position: true, terminalKind: true },
        },
      },
    })

    // Por onde já passou: só o que NÃO é o funil atual, com a última etapa em
    // cada um. É a resposta para "esse contato já esteve em outro funil?".
    const movimentos = await prisma.leadStageMovement.findMany({
      where: { leadId: lid, toFunnelId: { not: null } },
      orderBy: { movedAt: 'desc' },
      select: { toFunnelId: true, toStageKey: true, movedAt: true },
      take: 200,
    })
    const passagens: Array<{ funnelId: number; nome: string; etapaKey: string | null; etapaNome: string | null; em: string }> = []
    const vistos = new Set<number>()
    for (const m of movimentos) {
      const fid = m.toFunnelId!
      if (fid === lead.funnelId || vistos.has(fid)) continue
      vistos.add(fid)
      const f = funis.find((x) => x.id === fid)
      if (!f) continue
      passagens.push({
        funnelId: fid,
        nome: f.name,
        etapaKey: m.toStageKey,
        etapaNome: f.stages.find((e) => e.key === m.toStageKey)?.name ?? m.toStageKey,
        em: m.movedAt.toISOString(),
      })
    }

    // Mesmos padrões da rota que move (leads.ts): sem linha na tabela, ADMIN,
    // MANAGER e AGENT avançam; só ADMIN retrocede. SUPERADMIN passa por cima.
    const perm = user.role === 'SUPERADMIN'
      ? null
      : await prisma.kanbanPermission.findUnique({ where: { role: user.role as any } })
    const podeAvancar = user.role === 'SUPERADMIN' || (perm?.canAdvance ?? ['ADMIN', 'MANAGER', 'AGENT'].includes(user.role))
    const podeRetroceder = user.role === 'SUPERADMIN' || (perm?.canRetreat ?? user.role === 'ADMIN')

    return {
      funilAtual: lead.funnelId ? funis.find((f) => f.id === lead.funnelId) ?? null : null,
      etapaAtual: lead.status ?? null,
      qualificado: !!lead.qualifiedAt,
      funis,
      passagens,
      permissoes: { podeAvancar, podeRetroceder },
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
          // Identidade: de onde veio o nome exibido, o nome da agenda da
          // empresa e o apelido que o contato usa no WhatsApp dele. O painel
          // mostra os dois últimos como referência, sem virar identidade.
          nomeOrigem: true,
          nomeWhatsappAgenda: true,
          pushName: true,
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
