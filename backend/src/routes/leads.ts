import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { notifyNewLead, sendReportToLead } from '../services/notify.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { buildLeadAccessWhere, canUserAccessLead, type AccessRole } from '../lib/teamAccess.js'
import { logEvent, EVENT_TYPES, getIp, getOperator } from '../services/leadHistory.js'
import { generateLeadAnalysis } from '../services/scoring.js'
import { generateUid, findDuplicate } from '../services/dedup.js'
import { onLeadStageChanged } from '../services/metaCapi.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { markLeadWon, markLeadLost, reopenLead } from '../services/leadOutcome.js'
import { moveToTrash, snapshotLead, snapshotLeads } from '../services/trash.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { queues } from '../lib/queues.js'
import { resolveDefaultTeamId } from '../services/teamRouting.js'
import { validateLeadAcquiresSlot } from '../services/educationalSlots.js'
import { scoreLead, getAiScoreCalibration } from '../services/aiLeadScoreService.js'

export async function leadsRoutes(app: FastifyInstance) {

  // Helper de gate por lead — bloqueia AGENT/VIEWER de ver/operar lead alheio.
  // SUPERADMIN/ADMIN (scope=all) sempre passam; MANAGER (scope=team) passa
  // se o lead estiver num setor dele; AGENT (scope=own) só passa se for
  // assignedUserId. Use antes de toda operação que acessa lead individual.
  async function assertLeadAccess(
    req: any, reply: any, leadId: number,
  ): Promise<boolean> {
    const user = (req as any).user as JwtPayload | undefined
    if (!user) { reply.code(401).send({ error: 'Não autenticado' }); return false }
    const ok = await canUserAccessLead(user.userId, user.role as AccessRole, leadId)
    if (!ok) { reply.code(403).send({ error: 'Sem permissão sobre este lead' }); return false }
    return true
  }

  // Filtra uma lista de IDs ao escopo de acesso do usuário (own/team/all).
  // Operações em massa só agem sobre leads que o usuário realmente pode acessar.
  async function filterAccessibleLeadIds(user: JwtPayload, ids: number[]): Promise<number[]> {
    if (ids.length === 0) return []
    const scope = await buildLeadAccessWhere(user.userId, user.role as AccessRole)
    const rows = await prisma.lead.findMany({
      where: { AND: [{ id: { in: ids } }, scope] },
      select: { id: true },
    })
    return rows.map(r => r.id)
  }

  // Auto-seed Settings Fase 24 (dedup.mode.* por canal de captura)
  const dedupSettings: { key: string; label: string }[] = [
    { key: 'dedup.mode.forms', label: 'Forms / Landing Pages — modo de duplicação' },
    { key: 'dedup.mode.metaLeadAds', label: 'Meta Lead Ads — modo de duplicação' },
    { key: 'dedup.mode.enrollmentPortal', label: 'Portal de Matrículas — modo de duplicação' },
    { key: 'dedup.mode.publicApi', label: 'API Pública — modo de duplicação' },
    { key: 'dedup.mode.make', label: 'Make.com — modo de duplicação' },
  ]
  for (const s of dedupSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: {
        key: s.key,
        value: 'always_new',
        label: s.label,
        grp: 'dedup',
        fieldType: 'select_dedup_mode',
      },
    }).catch(() => {})
  }

  // ── POST /api/bychat/leads ─── Criar lead (etapa 0) ou salvar completo ──
  app.post('/api/bychat/leads', async (req, reply) => {
    const body = req.body as any
    const fd = body?.formData

    if (!fd?.empresa || !fd?.whatsapp) {
      return reply.code(400).send({ error: 'Dados incompletos' })
    }

    // Dedup: buscar lead existente por WhatsApp ou email
    const { lead: existingLead } = await findDuplicate(fd.whatsapp, fd.email)
    let lead: any

    if (existingLead) {
      // Atualizar lead existente com novos dados
      const upd: any = {
        formData: fd,
        scores: body.scores || existingLead.scores || {},
        analysis: body.analysis || existingLead.analysis,
        lastStep: body.lastStep ?? existingLead.lastStep,
        completed: body.completed ?? existingLead.completed,
      }
      if (body.solucao?.nome) upd.solucaoNome = body.solucao.nome
      if (body.maturidade?.label) upd.maturidade = body.maturidade.label
      if (fd.nome && !existingLead.nome) upd.nome = fd.nome
      if (fd.empresa && !existingLead.empresa) upd.empresa = fd.empresa
      if (fd.segmento && !existingLead.segmento) upd.segmento = fd.segmento
      if (fd.cidade && !existingLead.cidade) upd.cidade = fd.cidade
      if (fd.email && !existingLead.email) upd.email = fd.email
      lead = await prisma.lead.update({ where: { id: existingLead.id }, data: upd })
      // Promove se o lead concluiu o fluxo agora ou deu consentimento.
      if ((upd.completed === true || fd.lgpdConsent || body.lgpdConsent) && !existingLead.qualifiedAt) {
        const { qualifyLead } = await import('../services/leadQualification.js')
        qualifyLead(existingLead.id, { source: upd.completed ? 'web_chat_completed' : 'chatbot_completed' }).catch(() => {})
      }
    } else {
      const lgpdConsent = !!(fd.lgpdConsent || body.lgpdConsent)
      const isCompleted = !!body.completed
      // Qualifica se o usuário completou o fluxo ou deu consentimento LGPD —
      // ambos são sinal claro de intenção real (não é só uma sessão de chat vazia).
      const qualifiesNow = isCompleted || lgpdConsent
      const routedTeamId = await resolveDefaultTeamId()
      lead = await prisma.lead.create({
        data: {
          uid:         await generateUid(),
          empresa:     fd.empresa,
          nome:        fd.nome || '',
          whatsapp:    fd.whatsapp,
          email:       fd.email || '',
          segmento:    fd.segmento,
          cidade:      fd.cidade,
          formData:    fd,
          scores:      body.scores || {},
          analysis:    body.analysis || {},
          solucaoNome: body.solucao?.nome,
          maturidade:  body.maturidade?.label,
          lastStep:    body.lastStep ?? 0,
          completed:   isCompleted,
          status:      'NOVO',
          teamId:      routedTeamId,
          lgpdConsent,
          lgpdConsentAt: lgpdConsent ? new Date() : null,
          enrichmentStatus: lgpdConsent ? 'pending' : null,
          qualifiedAt: qualifiesNow ? new Date() : null,
          qualificationSource: qualifiesNow ? (isCompleted ? 'web_chat_completed' : 'chatbot_completed') : null,
          source: 'web_chat',
          originType: 'web_chat',
        }
      })

      // Se o lead autorizou LGPD, dispara enriquecimento em background
      if (lgpdConsent) {
        queues.enrichment.add('enrich', { leadId: lead.id }, {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          delay: 3000,  // pequeno delay para o lead terminar de ser salvo
        }).catch(err => console.error('[enrichment enqueue]', err))
      }
    }

    // Log: lead criado
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.LEAD_CREATED,
      category: 'lifecycle',
      title: 'Lead criado via formulário',
      channel: 'web_form',
      source: 'form',
      actorType: 'lead',
      description: `Lead "${fd.empresa}" criado${body.completed ? ' com diagnóstico completo' : ''}`,
      metadata: { empresa: fd.empresa, whatsapp: fd.whatsapp, email: fd.email, segmento: fd.segmento, completed: body.completed ?? false },
      ipAddress: getIp(req),
    })

    broadcastRealtimeEvent({
      type: 'lead:created',
      payload: { id: lead.id, nome: lead.nome, empresa: lead.empresa, status: lead.status },
    })

    if (body.completed) {
      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.DIAGNOSIS_COMPLETED,
        category: 'lifecycle',
        title: 'Diagnóstico completo via formulário',
        channel: 'web_form',
        source: 'form',
        actorType: 'lead',
        metadata: { scores: body.scores, maturidade: body.maturidade?.label, solucao: body.solucao?.nome },
      })
    }

    // Vincular com tracking visitor (se existir)
    try {
      let tVisitor = null
      if (fd.email) {
        tVisitor = await prisma.trackingVisitor.findFirst({ where: { identifiedEmail: fd.email } })
      }
      if (!tVisitor && fd.whatsapp) {
        const phone = String(fd.whatsapp).replace(/\D/g, '')
        if (phone.length >= 8) {
          tVisitor = await prisma.trackingVisitor.findFirst({ where: { identifiedPhone: { contains: phone.slice(-8) } } })
        }
      }
      // Tentar por cookie bt_vid enviado no body
      if (!tVisitor && body.bt_vid) {
        tVisitor = await prisma.trackingVisitor.findUnique({ where: { visitorId: String(body.bt_vid) } })
      }
      if (tVisitor) {
        await prisma.trackingVisitor.update({ where: { id: tVisitor.id }, data: { leadId: lead.id } })
        await prisma.lead.update({ where: { id: lead.id }, data: { trackingVisitorId: tVisitor.visitorId } })
      }
    } catch (e) { /* silently ignore tracking errors */ }

    // Notificação assíncrona apenas para leads completos
    if (body.completed) {
      notifyNewLead(lead).catch((err: Error) =>
        console.error('Notify error:', err.message)
      )
      // Enviar diagnóstico por email ao lead
      sendReportToLead(lead).catch((err: Error) =>
        console.error('Send report error:', err.message)
      )
    }

    return reply.code(201).send({ ok: true, id: lead.id })
  })

  // ── PUT /api/bychat/leads/:id/progress ─── Atualizar a cada etapa ──
  app.put('/api/bychat/leads/:id/progress', async (req, reply) => {
    const { id } = req.params as any
    const leadId = parseInt(id)
    if (!leadId || isNaN(leadId)) return reply.code(400).send({ error: 'ID inválido' })

    const body = req.body as any
    const fd = body?.formData

    if (!fd) return reply.code(400).send({ error: 'formData obrigatório' })

    // Verificar se lead existe e não foi completado (impede reescrita de dados)
    const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, completed: true, whatsapp: true } })
    if (!existing) return reply.code(404).send({ error: 'Lead não encontrado' })
    if (existing.completed) return reply.code(409).send({ error: 'Diagnóstico já finalizado' })

    // Binding anti-IDOR: este endpoint é público e o :id é sequencial. Sem prova de
    // posse, qualquer um sobrescreveria o lead de outra pessoa por enumeração.
    // O fluxo legítimo continua com o MESMO whatsapp informado na criação — exigimos
    // que o whatsapp do corpo bata com o do lead (comparação só por dígitos).
    const onlyDigits = (s: any) => String(s || '').replace(/\D/g, '')
    const existingWa = onlyDigits(existing.whatsapp)
    const incomingWa = onlyDigits(fd.whatsapp)
    if (existingWa && incomingWa !== existingWa) {
      return reply.code(403).send({ error: 'Não autorizado a alterar este registro' })
    }

    const data: any = {
      formData:  fd,
      lastStep:  body.lastStep ?? 0,
      empresa:   fd.empresa || undefined,
      nome:      fd.nome || undefined,
      whatsapp:  fd.whatsapp || undefined,
      email:     fd.email || undefined,
      segmento:  fd.segmento || undefined,
      cidade:    fd.cidade || undefined,
    }

    // Se completou o diagnóstico, salva scores/analysis/solucao
    if (body.completed) {
      data.completed   = true
      data.scores      = body.scores || {}
      data.analysis    = body.analysis || {}
      data.solucaoNome = body.solucao?.nome
      data.maturidade  = body.maturidade?.label
    }

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data
    })

    // Log: progresso do diagnóstico
    logEvent({
      leadId: lead.id,
      type: body.completed ? EVENT_TYPES.DIAGNOSIS_COMPLETED : EVENT_TYPES.DIAGNOSIS_PROGRESS,
      category: 'lifecycle',
      title: body.completed ? 'Diagnóstico completo via formulário' : `Diagnóstico avançou para etapa ${body.lastStep ?? 0}`,
      channel: 'web_form',
      source: 'form',
      actorType: 'lead',
      oldValue: String(lead.lastStep - (body.lastStep ?? 0)),
      newValue: String(body.lastStep ?? 0),
      metadata: body.completed ? { scores: body.scores, maturidade: body.maturidade?.label } : { step: body.lastStep },
      ipAddress: getIp(req),
    })

    // Notificação apenas quando o diagnóstico é finalizado
    if (body.completed) {
      notifyNewLead(lead).catch((err: Error) =>
        console.error('Notify error:', err.message)
      )
      sendReportToLead(lead).catch((err: Error) =>
        console.error('Send report error:', err.message)
      )
    }

    return { ok: true, id: lead.id, lastStep: lead.lastStep }
  })

  // ── GET /api/bychat/leads ─── Listar com filtros avançados ──
  app.get('/api/bychat/leads', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const limit  = Math.min(parseInt(q.limit  || '50'), 500)
    const offset = parseInt(q.offset || '0')
    const user = (req as any).user as JwtPayload

    // Reforma F1: scope efetivo do user no módulo 'leads' (own/team/all).
    // Empacotado em AND para coexistir com OR da busca textual (q.search) sem
    // sobrescrever um ao outro.
    const scopeWhere = await buildLeadAccessWhere(user.userId, user.role)
    const where: any = {}
    const whereAnd: any[] = []
    if (Object.keys(scopeWhere).length > 0) whereAnd.push(scopeWhere)
    if (q.status) where.status = q.status
    if (q.segmento) where.segmento = q.segmento
    // Filtro por funil (pipeline). Sem isto o filtro da tela de Leads era ignorado
    // e apareciam leads de outros funis.
    if (q.funnelId) {
      const fid = parseInt(String(q.funnelId))
      if (Number.isInteger(fid)) where.funnelId = fid
    }
    // Origem (source): aceita ?source=meta_lead_ads (legacy single) OU ?sources=meta_lead_ads,whatsapp (multi)
    if (q.sources) {
      const arr = String(q.sources).split(',').map((s) => s.trim()).filter(Boolean)
      if (arr.length > 0) where.source = { in: arr }
    } else if (q.source) {
      where.source = String(q.source)
    }
    if (q.completed === 'true') where.completed = true
    if (q.completed === 'false') where.completed = false

    // Filtro por Lead Score por IA (faixa qualitativa do aiScoreLabel já calculado).
    // Aceita 'hot' (70+), 'warm' (40-69) ou 'cold' (0-39).
    if (q.aiScoreLabel && ['hot', 'warm', 'cold'].includes(q.aiScoreLabel)) {
      where.aiScoreLabel = q.aiScoreLabel
    }

    // Qualificação (default: só leads qualificados aparecem aqui).
    // Use ?includeUnqualified=1 para incluir conversas sem qualificação.
    // Use ?onlyUnqualified=1 para ver SOMENTE conversas (modo Conversas).
    if (q.onlyUnqualified === '1') where.qualifiedAt = null
    else if (q.includeUnqualified !== '1') where.qualifiedAt = { not: null }

    // Filtro por outcome (Fase 23): 'open' = em andamento; 'won'/'lost' = classificados
    if (q.outcome === 'open') where.outcome = null
    else if (q.outcome === 'won') where.outcome = 'won'
    else if (q.outcome === 'lost') where.outcome = 'lost'
    else if (q.outcome === 'classified') where.outcome = { in: ['won', 'lost'] }

    // Lead Routing F6: filtros por responsável.
    // ?onlyUnassigned=1                → leads sem responsável (fila do setor)
    // ?assignedUserIds=1,2,3           → multi-select (UI nova)
    // ?assignedUserId=123              → legacy single
    // ?assignedUserId=me               → atalho UI "Meus leads"
    if (q.onlyUnassigned === '1') {
      where.assignedUserId = null
    } else if (q.assignedUserIds) {
      const ids = String(q.assignedUserIds).split(',').map((s) => parseInt(s.trim())).filter(Number.isInteger)
      if (ids.length > 0) where.assignedUserId = { in: ids }
    } else if (q.assignedUserId === 'me') {
      const me = (req as any).user?.userId as number | undefined
      if (me) where.assignedUserId = me
    } else if (q.assignedUserId) {
      const id = parseInt(String(q.assignedUserId))
      if (Number.isInteger(id)) where.assignedUserId = id
    }

    // Filtro por objeção (Fase 23.1): aceita ?lostReasonId=2 OU ?lostReasonIds=1,3,5
    if (q.lostReasonIds) {
      const ids = String(q.lostReasonIds).split(',').map(Number).filter(Number.isInteger)
      if (ids.length > 0) where.lostReasonId = { in: ids }
    } else if (q.lostReasonId) {
      const id = parseInt(String(q.lostReasonId))
      if (Number.isInteger(id)) where.lostReasonId = id
    }

    // Busca textual (empresa, nome, whatsapp, email)
    if (q.search) {
      whereAnd.push({
        OR: [
          { empresa: { contains: q.search } },
          { nome: { contains: q.search } },
          { whatsapp: { contains: q.search } },
          { email: { contains: q.search } },
          { cidade: { contains: q.search } },
          { uid: { contains: q.search } },
        ],
      })
    }

    // Filtro por tags
    if (q.tagIds) {
      const tagIdArr = String(q.tagIds).split(',').map(Number).filter(Boolean)
      if (tagIdArr.length > 0) {
        where.tags = { some: { tagId: { in: tagIdArr } } }
      }
    }

    // Filtro por data de criação
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {}
      if (q.dateFrom) where.createdAt.gte = new Date(q.dateFrom)
      if (q.dateTo) where.createdAt.lte = new Date(q.dateTo + 'T23:59:59')
    }

    // Filtro por data de entrada na etapa
    if (q.stageKey) {
      const stageEventWhere: any = { type: 'status_changed', newValue: q.stageKey }
      if (q.stageEnteredFrom || q.stageEnteredTo) {
        stageEventWhere.createdAt = {}
        if (q.stageEnteredFrom) stageEventWhere.createdAt.gte = new Date(q.stageEnteredFrom)
        if (q.stageEnteredTo) stageEventWhere.createdAt.lte = new Date(q.stageEnteredTo + 'T23:59:59')
      }
      const stageLeadIds = await prisma.leadEvent.findMany({
        where: stageEventWhere,
        select: { leadId: true },
        distinct: ['leadId'],
      })
      where.id = { in: stageLeadIds.map(e => e.leadId) }
    }

    // Filtro por score mínimo/máximo (filtrado após consulta por ser JSON)
    const scoreMin = q.scoreMin ? parseInt(q.scoreMin) : null
    const scoreMax = q.scoreMax ? parseInt(q.scoreMax) : null

    // Ordenação
    const sortField = q.sortBy || 'createdAt'
    const sortDir = q.sortDir === 'asc' ? 'asc' : 'desc'
    const validSorts: Record<string, any> = {
      createdAt: { createdAt: sortDir },
      empresa: { empresa: sortDir },
      nome: { nome: sortDir },
      status: { status: sortDir },
      aiScore: { aiScore: sortDir },
    }
    const orderBy = validSorts[sortField] || { createdAt: 'desc' }

    // Aplica AND combinado (scope + search) antes da query.
    if (whereAnd.length > 0) where.AND = whereAnd

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy,
        take:  limit,
        skip:  offset,
        select: {
          id: true, uid: true, empresa: true, nome: true, whatsapp: true, email: true,
          segmento: true, cidade: true, scores: true, solucaoNome: true,
          aiScore: true, aiScoreLabel: true, aiScoreReason: true,
          maturidade: true, status: true, lastStep: true, completed: true,
          source: true, funnelId: true, createdAt: true, annotation: true,
          qualifiedAt: true, qualificationSource: true,
          outcome: true, outcomeAt: true, lostReasonId: true,
          // F6: responsável pelo lead (round-robin/regras/claim).
          assignedUserId: true, assignedAt: true, teamId: true,
          assignedUser: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true, color: true } },
          funnel: { select: { id: true, name: true } },
          lostReason: { select: { id: true, name: true, color: true } },
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } }
        }
      }),
      prisma.lead.count({ where })
    ])

    // Filtro por score: usa o Lead Score preditivo da IA (aiScore) e,
    // quando ainda não houver, cai no score do diagnóstico (scores.geral).
    let filtered = leads
    if (scoreMin !== null || scoreMax !== null) {
      filtered = leads.filter(l => {
        const score = (l.aiScore ?? (l.scores as any)?.geral ?? 0)
        if (scoreMin !== null && score < scoreMin) return false
        if (scoreMax !== null && score > scoreMax) return false
        return true
      })
    }

    // Resolve o nome real da etapa (Stage.name) a partir do par (funnelId, status).
    // O Lead.status guarda a CHAVE técnica (ex.: "kommo_143" em leads importados da
    // Kommo); a UI precisa do rótulo humano. A resolução é por funil porque a mesma
    // chave (142/143 = ganho/perdido padrão da Kommo) tem nomes diferentes por funil.
    const stagePairs = filtered.filter(l => l.funnelId && l.status)
    let stageLabelMap = new Map<string, string>()
    if (stagePairs.length > 0) {
      const funnelIds = [...new Set(stagePairs.map(l => l.funnelId!))]
      const statusKeys = [...new Set(stagePairs.map(l => l.status!))]
      const stages = await prisma.stage.findMany({
        where: { funnelId: { in: funnelIds }, key: { in: statusKeys } },
        select: { funnelId: true, key: true, name: true },
      })
      stageLabelMap = new Map(stages.map(s => [`${s.funnelId}::${s.key}`, s.name]))
    }
    const enriched = filtered.map(l => ({
      ...l,
      statusLabel: (l.funnelId && l.status ? stageLabelMap.get(`${l.funnelId}::${l.status}`) : null) ?? l.status,
    }))

    return { leads: enriched, total, limit, offset }
  })

  // ── GET /api/bychat/leads/:id ─── Detalhe ──
  app.get('/api/bychat/leads/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const lead = await prisma.lead.findUnique({
      where: { id: parseInt(id) },
      include: {
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        lostReason: { select: { id: true, name: true, color: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true, color: true } },
      }
    })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    // Agendamento vigente do lead (módulo de Agendamento). Remarcar marca o booking
    // antigo como 'rescheduled' e cria um novo → excluímos cancelados/no_show/rescheduled
    // p/ sempre pegar o horário atual (sincroniza automaticamente).
    const agendamento = await prisma.booking.findFirst({
      where: { leadId: lead.id, status: { notIn: ['cancelled', 'no_show', 'rescheduled'] } },
      orderBy: { startAt: 'desc' },
      select: { startAt: true, endAt: true, status: true, timezone: true },
    }).catch(() => null)
    // Rótulo humano da etapa (Stage.name) resolvido por (funnelId, status) — ver
    // comentário no GET /leads. Leads da Kommo guardam a chave "kommo_<id>" em status.
    let statusLabel: string | null = lead.status
    if (lead.funnelId && lead.status) {
      const stage = await prisma.stage.findFirst({
        where: { funnelId: lead.funnelId, key: lead.status },
        select: { name: true },
      }).catch(() => null)
      if (stage) statusLabel = stage.name
    }
    return { ...lead, agendamento, statusLabel }
  })

  // ── PUT /api/bychat/leads/:id/status ─── Atualizar etapa ──
  app.put('/api/bychat/leads/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const { status } = req.body as any
    const user = (req as any).user as JwtPayload

    if (!await assertLeadAccess(req, reply, parseInt(id))) return

    // Get current lead
    const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    // Validate target stage within lead's funnel
    const funnelId = lead.funnelId
    const targetStage = funnelId
      ? await prisma.stage.findFirst({ where: { funnelId, key: status } })
      : await prisma.stage.findFirst({ where: { key: status } })
    if (!targetStage) {
      return reply.code(400).send({ error: 'Etapa inválida para este funil' })
    }

    const currentStage = funnelId
      ? await prisma.stage.findFirst({ where: { funnelId, key: lead.status } })
      : await prisma.stage.findFirst({ where: { key: lead.status } })
    const currentPos = currentStage?.position ?? 0
    const targetPos = targetStage.position

    // Check kanban permissions (SUPERADMIN bypassa tudo).
    // Defaults sensatos quando a row da role NÃO existe na tabela:
    //   - canAdvance: ADMIN, MANAGER e AGENT (operadores que trabalham leads)
    //   - canRetreat: apenas ADMIN (mais sensível — voltar etapa)
    //   - VIEWER: nunca move
    if (currentPos !== targetPos && user.role !== 'SUPERADMIN') {
      const perm = await prisma.kanbanPermission.findUnique({ where: { role: user.role as any } })
      const canAdvance = perm?.canAdvance ?? ['ADMIN', 'MANAGER', 'AGENT'].includes(user.role)
      const canRetreat = perm?.canRetreat ?? user.role === 'ADMIN'

      if (targetPos > currentPos && !canAdvance) {
        return reply.code(403).send({ error: 'Sem permissão para avançar leads de etapa' })
      }
      if (targetPos < currentPos && !canRetreat) {
        return reply.code(403).send({ error: 'Sem permissão para retroceder leads de etapa' })
      }
    }

    // Vagas (Educacional): se target consome vaga e current não consumia,
    // valida disponibilidade nas ofertas em que o lead está inscrito.
    const wasConsuming = !!currentStage?.consumesSlot
    const willConsume = !!targetStage.consumesSlot
    if (willConsume && !wasConsuming) {
      const slotErr = await validateLeadAcquiresSlot(parseInt(id))
      if (slotErr) return reply.code(409).send({ error: slotErr })
    }

    // Atualiza status E funnelId (garante que lead aparece no kanban)
    const updateData: any = { status }
    if (!lead.funnelId && targetStage.funnelId) {
      updateData.funnelId = targetStage.funnelId
    }

    const updated = await prisma.lead.update({
      where: { id: parseInt(id) },
      data: updateData
    })

    const assignedToFunnel = !funnelId && targetStage.funnelId;
    logEvent({
      leadId: parseInt(id),
      type: EVENT_TYPES.STATUS_CHANGED,
      category: 'lifecycle',
      title: `Status alterado: ${lead.status} → ${status}${assignedToFunnel ? ' (adicionado ao funil)' : ''}`,
      source: 'panel',
      ...getOperator(req),
      oldValue: lead.status,
      newValue: status,
      description: `Operador moveu lead de "${lead.status}" para "${status}"${assignedToFunnel ? ' e adicionou ao funil' : ''}`,
      metadata: { fromPosition: currentPos, toPosition: targetPos, funnelId: updateData.funnelId || funnelId, assignedToFunnel },
      ipAddress: getIp(req),
    })

    // Trigger CAPI se etapa mapeada (fire-and-forget)
    onLeadStageChanged(parseInt(id), status).catch(() => {})

    // Broadcast realtime para os clientes /app conectados (scopado pelo lead).
    broadcastRealtimeEvent({
      type: 'lead:stage_changed',
      payload: { id: parseInt(id), oldStatus: lead.status, newStatus: status },
      scope: { leadId: parseInt(id) },
    })

    return { ok: true, lead: updated }
  })

  // ── POST /api/bychat/leads/:id/won ─── Classificar como Ganho ──
  app.post('/api/bychat/leads/:id/won', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const body = (req.body || {}) as { value?: number | null; note?: string | null }
    const user = (req as any).user as JwtPayload
    try {
      const result = await markLeadWon({
        leadId: parseInt(id),
        value: body.value != null ? Number(body.value) : null,
        note: body.note ?? null,
        userId: user?.userId,
        userName: user?.name || user?.email,
        ipAddress: getIp(req),
      })
      broadcastRealtimeEvent({ type: 'lead:outcome_changed', payload: { id: parseInt(id), outcome: 'won' } })
      return { ok: true, ...result }
    } catch (err: any) {
      return reply.code(err.message?.includes('não encontrado') ? 404 : 500).send({ error: err.message })
    }
  })

  // ── POST /api/bychat/leads/:id/lost ─── Classificar como Perdido ──
  app.post('/api/bychat/leads/:id/lost', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const body = (req.body || {}) as { reasonId?: number | null; note?: string | null }
    const user = (req as any).user as JwtPayload
    try {
      const result = await markLeadLost({
        leadId: parseInt(id),
        reasonId: body.reasonId != null ? Number(body.reasonId) : null,
        note: body.note ?? null,
        userId: user?.userId,
        userName: user?.name || user?.email,
        ipAddress: getIp(req),
      })
      broadcastRealtimeEvent({ type: 'lead:outcome_changed', payload: { id: parseInt(id), outcome: 'lost' } })
      return { ok: true, ...result }
    } catch (err: any) {
      return reply.code(err.message?.includes('não encontrado') ? 404 : 500).send({ error: err.message })
    }
  })

  // ── POST /api/bychat/leads/:id/reopen ─── Limpar outcome ──
  app.post('/api/bychat/leads/:id/reopen', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const user = (req as any).user as JwtPayload
    try {
      const result = await reopenLead({
        leadId: parseInt(id),
        userId: user?.userId,
        userName: user?.name || user?.email,
        ipAddress: getIp(req),
      })
      broadcastRealtimeEvent({ type: 'lead:outcome_changed', payload: { id: parseInt(id), outcome: null } })
      return { ok: true, ...result }
    } catch (err: any) {
      return reply.code(err.message?.includes('não encontrado') ? 404 : 500).send({ error: err.message })
    }
  })

  // ── POST /api/bychat/leads/bulk/won ─── Classificar em massa como Ganho ──
  app.post('/api/bychat/leads/bulk/won', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body || {}) as { ids?: number[]; value?: number | null; note?: string | null }
    const reqIds = (body.ids || []).filter((n) => Number.isInteger(n))
    if (reqIds.length === 0) return reply.code(400).send({ error: 'ids obrigatórios' })
    if (reqIds.length > 500) return reply.code(400).send({ error: 'Máximo 500 leads por chamada' })
    const user = (req as any).user as JwtPayload
    const ids = await filterAccessibleLeadIds(user, reqIds)
    let processed = 0, failed = 0
    for (const id of ids) {
      try {
        await markLeadWon({
          leadId: id,
          value: body.value != null ? Number(body.value) : null,
          note: body.note ?? null,
          userId: user?.userId,
          userName: user?.name || user?.email,
          ipAddress: getIp(req),
        })
        broadcastRealtimeEvent({ type: 'lead:outcome_changed', payload: { id, outcome: 'won' } })
        processed++
      } catch { failed++ }
    }
    return { ok: true, processed, failed }
  })

  // ── POST /api/bychat/leads/bulk/lost ─── Classificar em massa como Perdido ──
  app.post('/api/bychat/leads/bulk/lost', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body || {}) as { ids?: number[]; reasonId?: number | null; note?: string | null }
    const reqIds = (body.ids || []).filter((n) => Number.isInteger(n))
    if (reqIds.length === 0) return reply.code(400).send({ error: 'ids obrigatórios' })
    if (reqIds.length > 500) return reply.code(400).send({ error: 'Máximo 500 leads por chamada' })
    const user = (req as any).user as JwtPayload
    const ids = await filterAccessibleLeadIds(user, reqIds)
    let processed = 0, failed = 0
    for (const id of ids) {
      try {
        await markLeadLost({
          leadId: id,
          reasonId: body.reasonId != null ? Number(body.reasonId) : null,
          note: body.note ?? null,
          userId: user?.userId,
          userName: user?.name || user?.email,
          ipAddress: getIp(req),
        })
        broadcastRealtimeEvent({ type: 'lead:outcome_changed', payload: { id, outcome: 'lost' } })
        processed++
      } catch { failed++ }
    }
    return { ok: true, processed, failed }
  })

  // ── PUT /api/bychat/leads/:id ─── Editar dados do lead ──
  app.put('/api/bychat/leads/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const body = req.body as any

    const data: any = {}
    // Básicos
    if (body.empresa !== undefined)  data.empresa  = body.empresa
    if (body.nome !== undefined)     data.nome     = body.nome
    if (body.whatsapp !== undefined) data.whatsapp = body.whatsapp
    if (body.email !== undefined)    data.email    = body.email
    if (body.segmento !== undefined) data.segmento = body.segmento
    if (body.cidade !== undefined)   data.cidade   = body.cidade
    // Qualificação
    if (body.solucaoNome !== undefined) data.solucaoNome = body.solucaoNome || null
    if (body.maturidade !== undefined)  data.maturidade  = body.maturidade || null
    if (body.annotation !== undefined)  data.annotation  = body.annotation || null
    if (body.profilePicUrl !== undefined) data.profilePicUrl = body.profilePicUrl || null
    // Origem/Campanha, UTM e Tracking IDs são IMUTÁVEIS — populados pela integração
    // (webhook Meta, landing page, CTWA). Ignoramos silenciosamente qualquer tentativa
    // de atualizar esses campos pelo PUT para preservar integridade da atribuição.
    // Venda
    if (body.saleDetected !== undefined) data.saleDetected = !!body.saleDetected
    if (body.saleValue !== undefined)    data.saleValue    = body.saleValue === '' || body.saleValue == null ? null : body.saleValue
    // LGPD
    if (body.lgpdConsent !== undefined) {
      data.lgpdConsent = !!body.lgpdConsent
      data.lgpdConsentAt = body.lgpdConsent ? new Date() : null
    }
    // Status / funil
    if (body.status !== undefined)    data.status = body.status
    if (body.funnelId !== undefined)  data.funnelId = body.funnelId ? parseInt(body.funnelId) : null

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar' })
    }

    // Atualiza também dentro do formData JSON
    const existing = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!existing) return reply.code(404).send({ error: 'Lead não encontrado' })

    const fd = (existing.formData as any) || {}
    Object.assign(fd, data)
    data.formData = fd

    const lead = await prisma.lead.update({
      where: { id: parseInt(id) },
      data
    })

    // Log campos alterados
    const changedFields = Object.keys(data).filter(k => k !== 'formData')
    logEvent({
      leadId: parseInt(id),
      type: EVENT_TYPES.LEAD_EDITED,
      category: 'lifecycle',
      title: `Dados do lead editados: ${changedFields.join(', ')}`,
      source: 'panel',
      actorType: 'operator',
      description: `Campos alterados: ${changedFields.join(', ')}`,
      oldValue: JSON.stringify(changedFields.reduce((acc: any, k: string) => { acc[k] = (existing as any)[k]; return acc }, {})),
      newValue: JSON.stringify(changedFields.reduce((acc: any, k: string) => { acc[k] = data[k]; return acc }, {})),
      ipAddress: getIp(req),
    })

    return { ok: true, lead }
  })

  // ── PUT /api/bychat/leads/:id/annotation ─── Salvar anotação (DEPRECATED) ──
  // Mantido para compatibilidade com clientes que ainda chamam o endpoint antigo;
  // novas integrações devem usar POST /:id/notes (histórico append-only).
  app.put('/api/bychat/leads/:id/annotation', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const { annotation } = req.body as any
    const user = (req as any).user as JwtPayload

    const existing = await prisma.lead.findUnique({ where: { id: parseInt(id) }, select: { id: true, annotation: true } })
    if (!existing) return reply.code(404).send({ error: 'Lead não encontrado' })

    const isNew = !existing.annotation && annotation
    const isRemoved = existing.annotation && !annotation

    await prisma.lead.update({ where: { id: parseInt(id) }, data: { annotation: annotation || null } })

    logEvent({
      leadId: parseInt(id),
      type: EVENT_TYPES.ANNOTATION_SAVED,
      category: 'operator',
      title: isRemoved ? 'Anotação removida' : isNew ? 'Anotação adicionada' : 'Anotação atualizada',
      source: 'panel',
      userId: user.userId,
      userName: user.name,
      actorType: 'operator',
      description: annotation || undefined,
      oldValue: existing.annotation || undefined,
      newValue: annotation || undefined,
    })

    return { ok: true }
  })

  // ── GET /api/bychat/leads/:id/notes ─── Lista anotações (histórico) ──
  app.get('/api/bychat/leads/:id/notes', { preHandler: authMiddleware }, async (req, reply) => {
    const leadId = parseInt((req.params as any).id)
    if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'id inválido' })
    if (!await assertLeadAccess(req, reply, leadId)) return

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const notes = await prisma.leadNote.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, createdAt: true, userId: true, userName: true },
    })
    return { notes }
  })

  // ── POST /api/bychat/leads/:id/notes ─── Cria nova anotação no histórico ──
  app.post('/api/bychat/leads/:id/notes', { preHandler: authMiddleware }, async (req, reply) => {
    const leadId = parseInt((req.params as any).id)
    if (!Number.isFinite(leadId)) return reply.code(400).send({ error: 'id inválido' })
    if (!await assertLeadAccess(req, reply, leadId)) return

    const content = String((req.body as any)?.content ?? '').trim()
    if (!content) return reply.code(400).send({ error: 'Conteúdo da anotação é obrigatório' })
    if (content.length > 5000) return reply.code(400).send({ error: 'Anotação muito longa (máx. 5000 caracteres)' })

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const user = (req as any).user as JwtPayload
    const note = await prisma.leadNote.create({
      data: {
        leadId,
        userId: user.userId,
        userName: user.name ?? null,
        content,
      },
      select: { id: true, content: true, createdAt: true, userId: true, userName: true },
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.ANNOTATION_SAVED,
      category: 'operator',
      title: 'Anotação adicionada',
      source: 'panel',
      userId: user.userId,
      userName: user.name,
      actorType: 'operator',
      description: content,
    })

    return reply.code(201).send({ note })
  })

  // ── GET /api/bychat/leads/qualification-stats ─── Preview de impacto do backfill ──
  // Conta quantos leads atualmente têm qualifiedAt=null e quantos serão qualificados
  // pelo backfill baseado na origem. NÃO altera dados.
  // ── GET /api/bychat/leads/sources ─── Origens distintas presentes nos leads ──
  // Devolve só as origens que efetivamente existem no banco; usado pelo filtro
  // "Origem" da listagem pra não mostrar opções vazias / inventadas.
  app.get('/api/bychat/leads/sources', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.lead.groupBy({
      by: ['source'],
      _count: { _all: true },
      orderBy: { _count: { source: 'desc' } },
    })
    return {
      sources: rows
        .map((r) => ({ value: r.source ?? null, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    }
  })

  app.get('/api/bychat/leads/qualification-stats', { preHandler: authMiddleware }, async (_req) => {
    const QUALIFYING_SOURCES = ['form', 'landing_page', 'enrollment_portal', 'meta_lead_ads', 'make', 'api', 'manual']
    const [total, alreadyQualified, candidatesForBackfill, willStayUnqualified] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { qualifiedAt: { not: null } } }),
      prisma.lead.count({ where: { qualifiedAt: null, source: { in: QUALIFYING_SOURCES } } }),
      prisma.lead.count({ where: { qualifiedAt: null, OR: [{ source: null }, { source: { notIn: QUALIFYING_SOURCES } }] } }),
    ])
    // Breakdown por source dos que ficarão como conversa
    const breakdown = await prisma.lead.groupBy({
      by: ['source'],
      where: { qualifiedAt: null },
      _count: { _all: true },
    })
    return {
      total,
      alreadyQualified,
      willBeQualifiedByBackfill: candidatesForBackfill,
      willStayUnqualified,
      breakdown: breakdown.map(b => ({ source: b.source || '(null)', count: b._count._all })),
      qualifyingSources: QUALIFYING_SOURCES,
    }
  })

  // ── POST /api/bychat/leads/qualification-backfill ─── Aplica backfill ──
  // Marca qualifiedAt=now para leads cuja origem está na allow-list. Idempotente.
  app.post('/api/bychat/leads/qualification-backfill', { preHandler: adminOnly }, async (_req) => {
    const QUALIFYING_SOURCES = ['form', 'landing_page', 'enrollment_portal', 'meta_lead_ads', 'make', 'api', 'manual']
    const result = await prisma.lead.updateMany({
      where: { qualifiedAt: null, source: { in: QUALIFYING_SOURCES } },
      data: { qualifiedAt: new Date(), qualificationSource: 'backfill' },
    })
    return { ok: true, qualified: result.count }
  })

  // ── POST /api/bychat/leads/:id/open-conversation ─── Iniciar atendimento ──
  // Move o lead para o módulo Conversas. Se já estava aberto, é idempotente;
  // se estava fechado (resolvido), reabre.
  app.post('/api/bychat/leads/:id/open-conversation', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    if (!await assertLeadAccess(req, reply, id)) return
    const user = (req as any).user as JwtPayload
    const { openConversation } = await import('../services/leadConversation.js')
    const r = await openConversation(id, { byUserId: user.userId, byUserName: user.name || user.email, reason: 'manual' })
    return { ok: true, ...r }
  })

  // ── POST /api/bychat/leads/:id/close-conversation ─── Encerrar atendimento ──
  app.post('/api/bychat/leads/:id/close-conversation', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    if (!await assertLeadAccess(req, reply, id)) return
    const user = (req as any).user as JwtPayload
    const { closeConversation } = await import('../services/leadConversation.js')
    const r = await closeConversation(id, { byUserId: user.userId, byUserName: user.name || user.email })
    return { ok: true, ...r }
  })

  // ── POST /api/bychat/leads/:id/qualify ─── Promover "conversa" para Lead ──
  // Usado pelo operador no painel de Conversas quando uma mensagem WhatsApp
  // ad-hoc realmente vira um lead (ex: pessoa interessada que mandou DM).
  // Body opcional: { funnelId, stageKey } — se ambos vierem, joga o lead no
  // funil/etapa em um único request (evita lead "qualificado mas órfão").
  app.post('/api/bychat/leads/:id/qualify', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    if (!await assertLeadAccess(req, reply, id)) return
    const user = (req as any).user as JwtPayload
    const { funnelId, stageKey } = (req.body as any) || {}
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, qualifiedAt: true, status: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    if (lead.qualifiedAt) return reply.code(400).send({ error: 'Lead já está qualificado' })

    let assignedToFunnel = false
    if (funnelId && stageKey) {
      const fId = Number(funnelId)
      const targetStage = await prisma.stage.findFirst({ where: { funnelId: fId, key: String(stageKey), active: true } })
      if (!targetStage) return reply.code(400).send({ error: 'Etapa inválida para o funil informado' })
      await prisma.lead.update({
        where: { id },
        data: { funnelId: fId, status: targetStage.key },
      })
      assignedToFunnel = true
      logEvent({
        leadId: id,
        type: EVENT_TYPES.STATUS_CHANGED,
        category: 'lifecycle',
        title: `Adicionado ao funil ao promover: ${lead.status} → ${targetStage.key}`,
        source: 'panel',
        ...getOperator(req),
        oldValue: lead.status,
        newValue: targetStage.key,
        metadata: { funnelId: fId, viaPromote: true },
        ipAddress: getIp(req),
      })
    }

    const { qualifyLead } = await import('../services/leadQualification.js')
    const r = await qualifyLead(id, { source: 'manual', byUserId: user.userId, byUserName: user.name || user.email })
    return { ok: true, qualified: r.qualified, assignedToFunnel }
  })

  // ── POST /api/bychat/leads/qualify-bulk ─── Promover múltiplos em massa ──
  // Body: { leadIds: number[], funnelId?: number, stageKey?: string }
  app.post('/api/bychat/leads/qualify-bulk', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const { leadIds, funnelId, stageKey } = (req.body as any) || {}
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds (array) é obrigatório' })
    }
    if (leadIds.length > 100) {
      return reply.code(400).send({ error: 'Máximo de 100 leads por operação' })
    }

    let targetStage: { key: string; funnelId: number | null } | null = null
    if (funnelId && stageKey) {
      const fId = Number(funnelId)
      const s = await prisma.stage.findFirst({ where: { funnelId: fId, key: String(stageKey), active: true } })
      if (!s) return reply.code(400).send({ error: 'Etapa inválida para o funil informado' })
      targetStage = { key: s.key, funnelId: s.funnelId }
    }

    const ids = leadIds.map((id: any) => parseInt(id)).filter((n) => Number.isFinite(n))
    // Escopo: só qualifica leads acessíveis ao usuário.
    const qbScope = await buildLeadAccessWhere(user.userId, user.role as AccessRole)
    const leads = await prisma.lead.findMany({
      where: { AND: [{ id: { in: ids } }, qbScope] },
      select: { id: true, qualifiedAt: true, status: true },
    })

    const { qualifyLead } = await import('../services/leadQualification.js')
    let qualified = 0
    let alreadyQualified = 0
    let failed = 0
    for (const l of leads) {
      try {
        if (l.qualifiedAt) { alreadyQualified++; continue }
        if (targetStage) {
          await prisma.lead.update({
            where: { id: l.id },
            data: { funnelId: targetStage.funnelId, status: targetStage.key },
          })
          logEvent({
            leadId: l.id,
            type: EVENT_TYPES.STATUS_CHANGED,
            category: 'lifecycle',
            title: `Adicionado ao funil em lote: ${l.status} → ${targetStage.key}`,
            source: 'panel',
            ...getOperator(req),
            oldValue: l.status,
            newValue: targetStage.key,
            metadata: { funnelId: targetStage.funnelId, viaPromote: true, bulk: true, totalInBatch: leads.length },
            ipAddress: getIp(req),
          })
        }
        const r = await qualifyLead(l.id, { source: 'manual', byUserId: user.userId, byUserName: user.name || user.email })
        if (r.qualified) qualified++
      } catch {
        failed++
      }
    }
    return { ok: true, qualified, alreadyQualified, failed, total: leads.length }
  })

  // ── POST /api/bychat/leads/:id/unqualify ─── Reverter qualificação ──
  // Usado quando o operador percebe que classificou errado (ex: era spam).
  app.post('/api/bychat/leads/:id/unqualify', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    if (!await assertLeadAccess(req, reply, id)) return
    const user = (req as any).user as JwtPayload
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, qualifiedAt: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    await prisma.lead.update({ where: { id }, data: { qualifiedAt: null, qualificationSource: null } })
    logEvent({
      leadId: id,
      type: 'lead_unqualified' as any,
      category: 'lifecycle',
      title: 'Lead revertido para "apenas conversa"',
      source: 'panel',
      actorType: 'operator',
      userId: user.userId,
      userName: user.name || user.email,
    })
    return { ok: true }
  })

  // ── POST /api/bychat/leads/:id/duplicate ─── Duplicar lead (para outro funil/etapa) ──
  app.post('/api/bychat/leads/:id/duplicate', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const body = (req.body || {}) as {
      funnelId?: number | string | null
      stageKey?: string | null
      assignedUserId?: number | string | null
      teamId?: number | string | null
      copy?: {
        tags?: boolean
        annotation?: boolean
        formData?: boolean
        scores?: boolean
        analysis?: boolean
        customFields?: boolean
        activities?: boolean
        cadences?: boolean
      }
    }
    const user = (req as any).user as JwtPayload

    const original = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
    if (!original) return reply.code(404).send({ error: 'Lead não encontrado' })

    // copy options — todos default true (mantém comportamento de "duplicar = clonar tudo")
    const copy = {
      tags:         body.copy?.tags         ?? true,
      annotation:   body.copy?.annotation   ?? true,
      formData:     body.copy?.formData     ?? true,
      scores:       body.copy?.scores       ?? true,
      analysis:     body.copy?.analysis     ?? true,
      customFields: body.copy?.customFields ?? true,
      activities:   body.copy?.activities   ?? true,
      cadences:     body.copy?.cadences     ?? true,
    }

    // Resolve funnel e stage
    let targetFunnelId = body.funnelId ? parseInt(String(body.funnelId)) : original.funnelId
    let targetStatus = body.stageKey || original.status

    if (body.funnelId && body.stageKey) {
      const stage = await prisma.stage.findFirst({ where: { funnelId: parseInt(String(body.funnelId)), key: body.stageKey, active: true } })
      if (!stage) return reply.code(400).send({ error: 'Etapa inválida para este funil' })
      targetFunnelId = parseInt(String(body.funnelId))
      targetStatus = body.stageKey
    } else if (body.funnelId && !body.stageKey) {
      // Usar primeira etapa do funil de destino
      const firstStage = await prisma.stage.findFirst({ where: { funnelId: parseInt(String(body.funnelId)), active: true }, orderBy: { position: 'asc' } })
      if (firstStage) {
        targetFunnelId = parseInt(String(body.funnelId))
        targetStatus = firstStage.key
      }
    }

    // Atribuição: se body fornece, usa; senão herda do original
    const targetAssignedUserId =
      body.assignedUserId === null ? null
      : body.assignedUserId !== undefined ? parseInt(String(body.assignedUserId))
      : original.assignedUserId
    const targetTeamId =
      body.teamId === null ? null
      : body.teamId !== undefined ? parseInt(String(body.teamId))
      : original.teamId

    const duplicate = await prisma.lead.create({
      data: {
        empresa:     original.empresa,
        nome:        original.nome,
        whatsapp:    original.whatsapp,
        email:       original.email,
        uid:         await generateUid(),
        segmento:    original.segmento,
        cidade:      original.cidade,
        formData:    copy.formData     ? (original.formData    || {}) : {},
        scores:      copy.scores       ? (original.scores      || {}) : {},
        analysis:    copy.analysis     ? (original.analysis    || {}) : {},
        aiSentiment: copy.analysis     ? (original.aiSentiment || undefined) : undefined,
        customFields: copy.customFields ? (original.customFields || undefined) : undefined,
        annotation:  copy.annotation   ? original.annotation : null,
        solucaoNome: original.solucaoNome,
        maturidade:  original.maturidade,
        lastStep:    original.lastStep,
        completed:   original.completed,
        status:      targetStatus,
        funnelId:    targetFunnelId,
        assignedUserId: targetAssignedUserId,
        teamId:      targetTeamId,
        assignedAt:  targetAssignedUserId || targetTeamId ? new Date() : null,
        source:      'manual',
        // Herda originType do original quando existe; senão 'manual' (operador
        // criou a duplicata explicitamente).
        originType:  original.originType || 'manual',
        // Herda qualificação do original; se original não era qualificado,
        // marca como manual já que o operador ativamente decidiu duplicar.
        qualifiedAt: original.qualifiedAt || new Date(),
        qualificationSource: original.qualificationSource || 'manual',
      }
    })

    // Copiar tags
    if (copy.tags) {
      const originalTags = await prisma.leadTag.findMany({ where: { leadId: parseInt(id) }, select: { tagId: true } })
      for (const t of originalTags) {
        await prisma.leadTag.create({ data: { leadId: duplicate.id, tagId: t.tagId } })
      }
    }

    // Copiar atividades
    if (copy.activities) {
      const acts = await prisma.activity.findMany({ where: { leadId: parseInt(id) } })
      for (const a of acts) {
        await prisma.activity.create({
          data: {
            leadId: duplicate.id,
            userId: a.userId,
            userName: a.userName,
            type: a.type,
            title: a.title,
            description: a.description,
            status: a.status,
            scheduledAt: a.scheduledAt,
            completedAt: a.completedAt,
            reminderAt: a.reminderAt,
            recipientPhone: a.recipientPhone,
            recipientEmail: a.recipientEmail,
            messageBody: a.messageBody,
            messageSubject: a.messageSubject,
            templateId: a.templateId,
            attachmentUrl: a.attachmentUrl,
            attachmentName: a.attachmentName,
            attachmentType: a.attachmentType,
            metadata: a.metadata ?? undefined,
            result: a.result,
          },
        })
      }
    }

    // Copiar cadências (apenas enrollments ativos/pausados — concluídos/exited não fazem sentido)
    if (copy.cadences) {
      const enrollments = await prisma.cadenceEnrollment.findMany({
        where: { leadId: parseInt(id), status: { in: ['active', 'paused'] } },
      })
      for (const e of enrollments) {
        await prisma.cadenceEnrollment.create({
          data: {
            cadenceId: e.cadenceId,
            leadId: duplicate.id,
            currentStep: e.currentStep,
            nextActionAt: e.nextActionAt,
            status: e.status,
          },
        }).catch(() => { /* unique (cadenceId, leadId) — ignora se já enrolled */ })
      }
    }

    logEvent({
      leadId: duplicate.id,
      type: EVENT_TYPES.LEAD_CREATED,
      category: 'lifecycle',
      title: `Lead duplicado a partir de #${original.id}`,
      channel: 'manual',
      source: 'panel',
      ...getOperator(req),
      description: `${user.name || user.email} duplicou lead "${original.empresa}" (original #${original.id})`,
      metadata: { originalLeadId: original.id, funnelId: targetFunnelId, stageKey: targetStatus, copy },
      ipAddress: getIp(req),
    })

    return reply.code(201).send({ ok: true, id: duplicate.id, lead: duplicate })
  })

  // ── DELETE /api/bychat/leads/:id ─── Deletar lead (move para lixeira) ──
  app.delete('/api/bychat/leads/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const user = (req as any).user as JwtPayload

    // Guard: apagar um lead com inscrições no portal de matrículas as deixa órfãs
    // (onDelete:SetNull). Bloqueia salvo confirmação explícita (?force=true).
    const force = (req.query as any)?.force === 'true' || (req.query as any)?.force === '1' || (req.body as any)?.force === true
    if (!force) {
      const regCount = await prisma.enrollmentRegistration.count({ where: { leadId: parseInt(id) } })
      if (regCount > 0) {
        return reply.code(409).send({
          error: 'lead_has_registrations',
          message: `Este lead tem ${regCount} inscrição(ões) no portal de matrículas. Apagá-lo vai desvinculá-las (ficam órfãs no módulo de Matrículas). Confirme para prosseguir mesmo assim.`,
          registrationCount: regCount,
        })
      }
    }

    try {
      const snapshot = await snapshotLead(parseInt(id))
      if (!snapshot) return reply.code(404).send({ error: 'Lead não encontrado' })

      await moveToTrash({
        entityType: 'lead',
        entityId: parseInt(id),
        entityLabel: `${snapshot.empresa} — ${snapshot.nome || snapshot.whatsapp}`,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })

      await prisma.lead.delete({ where: { id: parseInt(id) } })
      console.log(`[Trash] Lead #${id} moved to trash by ${user.email} (${snapshot.empresa})`)
      void logUserAudit({
        action: 'lead.deleted',
        targetType: 'lead',
        targetLabel: `${snapshot.empresa || ''} — ${snapshot.nome || snapshot.whatsapp || `#${id}`}`.trim(),
        changes: { leadId: parseInt(id), forced: force },
        ...auditActor(req),
      })
      return { ok: true }
    } catch {
      return reply.code(404).send({ error: 'Lead não encontrado' })
    }
  })

  // ── POST /api/bychat/leads/:id/send-report ─── Enviar diagnóstico por email ao lead ──
  app.post('/api/bychat/leads/:id/send-report', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    try {
      const lead = await prisma.lead.findUnique({ where: { id: parseInt(id) } })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
      if (!lead.email) return reply.code(400).send({ error: 'Lead sem e-mail cadastrado' })
      await sendReportToLead(lead)

      logEvent({
        leadId: parseInt(id),
        type: EVENT_TYPES.REPORT_SENT,
        category: 'communication',
        title: 'Relatório de diagnóstico enviado por email',
        channel: 'email',
        source: 'panel',
        actorType: 'operator',
        description: `Relatório enviado para ${lead.email}`,
        metadata: { email: lead.email },
        ipAddress: getIp(req),
      })

      return { ok: true, message: 'Relatório enviado' }
    } catch (err: any) {
      app.log.error(`Send report error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao enviar relatório' })
    }
  })

  // ── POST /api/bychat/leads/:id/ai-sentiment ─── Análise IA de sentimento e fechamento ──
  app.post('/api/bychat/leads/:id/ai-sentiment', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    try {
      const { force } = (req.query || {}) as any
      const analysis = await generateLeadAnalysis(parseInt(id), !!force)
      if (!analysis) return reply.code(404).send({ error: 'Lead não encontrado' })
      return { ok: true, analysis }
    } catch (err: any) {
      app.log.error(`AI sentiment error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao gerar análise de sentimento' })
    }
  })

  // ── POST /api/bychat/leads/:id/ai-score ── Recalcula o Lead Score por IA (manual) ──
  app.post('/api/bychat/leads/:id/ai-score', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    try {
      const score = await scoreLead(parseInt(id), 'manual', { force: true })
      if (score === null) {
        return reply.code(422).send({ error: 'Não foi possível pontuar (IA desativada/sem chave ou lead inválido). Verifique Configurações > APIs.' })
      }
      const lead = await prisma.lead.findUnique({
        where: { id: parseInt(id) },
        select: { aiScore: true, aiScoreLabel: true, aiScoreReason: true, aiScoredAt: true },
      })
      return { ok: true, ...lead }
    } catch (err: any) {
      app.log.error(`AI lead score error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao calcular Lead Score por IA' })
    }
  })

  // ── GET /api/bychat/leads/ai-score/calibration ── Previsto × real (Fase 4) ──
  app.get('/api/bychat/leads/ai-score/calibration', { preHandler: authMiddleware }, async (_req, reply) => {
    try {
      return await getAiScoreCalibration()
    } catch (err: any) {
      app.log.error(`AI score calibration error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao gerar calibração' })
    }
  })

  // ── PUT /api/bychat/leads/send-to-kanban ─── Enviar 1 ou mais leads ao kanban ──
  app.put('/api/bychat/leads/send-to-kanban', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadIds, funnelId, stageKey } = req.body as any
    const user = (req as any).user as JwtPayload

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds (array) é obrigatório' })
    }

    // Resolve funnel: usa o informado ou o padrão
    let targetFunnelId = funnelId ? parseInt(funnelId) : null
    if (!targetFunnelId) {
      const defFunnel = await prisma.funnel.findFirst({ where: { isDefault: true, active: true } })
      if (!defFunnel) {
        return reply.code(400).send({ error: 'Nenhum funil padrão encontrado. Crie um funil primeiro.' })
      }
      targetFunnelId = defFunnel.id
    }

    // Resolve stage: usa a informada ou a primeira do funil
    let targetStage: any = null
    if (stageKey) {
      targetStage = await prisma.stage.findFirst({ where: { funnelId: targetFunnelId, key: stageKey, active: true } })
    }
    if (!targetStage) {
      targetStage = await prisma.stage.findFirst({ where: { funnelId: targetFunnelId, active: true }, orderBy: { position: 'asc' } })
    }
    if (!targetStage) {
      return reply.code(400).send({ error: 'Nenhuma etapa encontrada neste funil.' })
    }

    const ids = leadIds.map((id: any) => parseInt(id))
    // Escopo: só envia ao kanban leads acessíveis ao usuário.
    const skScope = await buildLeadAccessWhere(user.userId, user.role as AccessRole)
    const leads = await prisma.lead.findMany({
      where: { AND: [{ id: { in: ids } }, skScope] },
      select: { id: true, empresa: true, status: true, funnelId: true }
    })

    let sent = 0
    for (const lead of leads) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { funnelId: targetFunnelId, status: targetStage.key }
      })
      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.STATUS_CHANGED,
        category: 'lifecycle',
        title: `Lead enviado para o kanban → ${targetStage.name}`,
        source: 'panel',
        ...getOperator(req),
        oldValue: lead.status,
        newValue: targetStage.key,
        description: `${user.name || user.email} enviou lead para o funil (etapa "${targetStage.name}")`,
        metadata: { funnelId: targetFunnelId, stageKey: targetStage.key, bulkOperation: leadIds.length > 1 },
        ipAddress: getIp(req),
      })
      sent++
    }

    return { ok: true, sent, funnelId: targetFunnelId, stageKey: targetStage.key, stageName: targetStage.name }
  })

  // ── POST /api/bychat/leads/manual ─── Criar lead manualmente (admin) ──
  app.post('/api/bychat/leads/manual', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    const user = (req as any).user as JwtPayload

    if (!body.nome || !body.whatsapp || !body.email) {
      return reply.code(400).send({ error: 'Nome, WhatsApp e e-mail são obrigatórios' })
    }

    // Dedup: verificar se já existe
    const { lead: existingLead, matchType } = await findDuplicate(body.whatsapp, body.email)

    if (existingLead) {
      return reply.code(409).send({
        error: 'Já existe um lead com este ' + (matchType === 'whatsapp' ? 'WhatsApp' : 'e-mail'),
        existingLead: { id: existingLead.id, uid: existingLead.uid, nome: existingLead.nome, empresa: existingLead.empresa, whatsapp: existingLead.whatsapp, email: existingLead.email },
        matchType,
      })
    }

    // Body tem prioridade; se vazio, cai no fallback global
    const teamId = body.teamId ? parseInt(body.teamId) : await resolveDefaultTeamId()
    const lead = await prisma.lead.create({
      data: {
        uid:       await generateUid(),
        empresa:   body.empresa || '',
        nome:      body.nome || '',
        whatsapp:  body.whatsapp,
        email:     body.email || '',
        segmento:  body.segmento || null,
        cidade:    body.cidade || null,
        formData:  body.formData || {},
        scores:    body.scores || {},
        status:    body.status || 'NOVO',
        funnelId:  body.funnelId ? parseInt(body.funnelId) : null,
        teamId,
        assignedUserId: body.assignedUserId ? parseInt(body.assignedUserId) : null,
        assignedAt: body.assignedUserId || teamId ? new Date() : null,
        completed: false,
        source:    'manual',
        originType: 'manual',
        qualifiedAt: new Date(),
        qualificationSource: 'manual',
      }
    })

    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.LEAD_CREATED,
      category: 'lifecycle',
      title: 'Lead criado manualmente',
      channel: 'manual',
      source: 'panel',
      ...getOperator(req),
      description: `Lead "${body.empresa}" criado manualmente por ${user.name || user.email}`,
      metadata: { empresa: body.empresa, whatsapp: body.whatsapp, createdBy: user.email },
      ipAddress: getIp(req),
    })

    return reply.code(201).send({ ok: true, id: lead.id, lead })
  })

  // ── PUT /api/bychat/leads/bulk/status ─── Mover múltiplos leads para etapa ──
  app.put('/api/bychat/leads/bulk/status', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadIds, status } = req.body as any
    const user = (req as any).user as JwtPayload

    if (!Array.isArray(leadIds) || leadIds.length === 0 || !status) {
      return reply.code(400).send({ error: 'leadIds (array) e status são obrigatórios' })
    }

    if (leadIds.length > 100) {
      return reply.code(400).send({ error: 'Máximo de 100 leads por operação' })
    }

    // Validar a etapa destino
    const targetStage = await prisma.stage.findFirst({ where: { key: status, active: true } })
    if (!targetStage) {
      return reply.code(400).send({ error: 'Etapa inválida' })
    }

    // Checar permissões kanban (SUPERADMIN bypassa tudo)
    if (user.role !== 'SUPERADMIN') {
      const perm = await prisma.kanbanPermission.findUnique({ where: { role: user.role as any } })
      const canAdvance = perm?.canAdvance ?? (user.role === 'ADMIN')
      const canRetreat = perm?.canRetreat ?? (user.role === 'ADMIN')
      if (!canAdvance && !canRetreat) {
        return reply.code(403).send({ error: 'Sem permissão para mover leads' })
      }
    }

    const ids = leadIds.map((id: any) => parseInt(id))
    // Escopo: só altera status de leads acessíveis ao usuário.
    const bsScope = await buildLeadAccessWhere(user.userId, user.role as AccessRole)
    const leads = await prisma.lead.findMany({
      where: { AND: [{ id: { in: ids } }, bsScope] },
      select: { id: true, empresa: true, status: true }
    })

    let moved = 0
    for (const lead of leads) {
      if (lead.status === status) continue
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status, funnelId: targetStage.funnelId }
      })
      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.STATUS_CHANGED,
        category: 'lifecycle',
        title: `Status alterado em lote: ${lead.status} → ${status}`,
        source: 'panel',
        ...getOperator(req),
        oldValue: lead.status,
        newValue: status,
        description: `Operação em lote: ${user.name || user.email} moveu lead para "${status}"`,
        metadata: { bulkOperation: true, totalInBatch: leadIds.length },
        ipAddress: getIp(req),
      })
      moved++
    }

    return { ok: true, moved, total: leadIds.length }
  })

  // ── DELETE /api/bychat/leads/bulk ─── Deletar múltiplos leads (move para lixeira) ──
  app.delete('/api/bychat/leads/bulk', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadIds } = req.body as any
    const user = (req as any).user as JwtPayload

    if (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas administradores podem excluir em lote' })
    }

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds (array) é obrigatório' })
    }

    if (leadIds.length > 100) {
      return reply.code(400).send({ error: 'Máximo de 100 leads por operação' })
    }

    const ids = leadIds.map((id: any) => parseInt(id))

    // Guard: leads com inscrições no portal de matrículas ficariam órfãos (onDelete:SetNull).
    const force = (req.query as any)?.force === 'true' || (req.body as any)?.force === true
    if (!force) {
      const withRegs = await prisma.enrollmentRegistration.groupBy({
        by: ['leadId'],
        where: { leadId: { in: ids } },
        _count: { _all: true },
      })
      if (withRegs.length > 0) {
        const regCount = withRegs.reduce((a, g) => a + g._count._all, 0)
        return reply.code(409).send({
          error: 'leads_have_registrations',
          message: `${withRegs.length} lead(s) selecionado(s) têm inscrições no portal de matrículas (${regCount} no total). Apagá-los vai desvinculá-las. Confirme para prosseguir mesmo assim.`,
          leadIds: withRegs.map((g) => g.leadId),
          registrationCount: regCount,
        })
      }
    }

    const snapshots = await snapshotLeads(ids)

    // Mover cada lead para lixeira antes de deletar
    for (const snap of snapshots) {
      await moveToTrash({
        entityType: 'lead',
        entityId: snap.id,
        entityLabel: `${snap.empresa} — ${snap.nome || snap.whatsapp}`,
        snapshot: snap,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }

    await prisma.lead.deleteMany({ where: { id: { in: ids } } })

    console.log(`[Trash] Bulk delete: ${snapshots.length} leads moved to trash by ${user.email} — IDs: ${ids.join(',')}`)

    void logUserAudit({
      action: 'lead.bulk_deleted',
      targetType: 'lead',
      targetLabel: `${snapshots.length} leads`,
      changes: { leadIds: ids, forced: force },
      ...auditActor(req),
    })

    return { ok: true, deleted: snapshots.length }
  })

  // ── PUT /api/bychat/leads/bulk/export ─── Exportar leads selecionados como CSV ──
  app.post('/api/bychat/leads/bulk/export', { preHandler: authMiddleware }, async (req, reply) => {
    const { leadIds } = req.body as any

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return reply.code(400).send({ error: 'leadIds (array) é obrigatório' })
    }

    const ids = leadIds.map((id: any) => parseInt(id))
    // Escopo: AGENT/operador só exporta leads que pode acessar (não IDs arbitrários).
    const exportUser = (req as any).user as JwtPayload
    const exportScope = await buildLeadAccessWhere(exportUser.userId, exportUser.role as AccessRole)
    const leads = await prisma.lead.findMany({
      where: { AND: [{ id: { in: ids } }, exportScope] },
      orderBy: { createdAt: 'desc' }
    })

    // Buscar tags apenas dos leads efetivamente acessíveis
    const accessibleIds = leads.map(l => l.id)
    const leadTags = await prisma.leadTag.findMany({
      where: { leadId: { in: accessibleIds } },
      include: { tag: { select: { name: true } } }
    })
    const tagsByLead: Record<number, string[]> = {}
    leadTags.forEach(lt => {
      if (!tagsByLead[lt.leadId]) tagsByLead[lt.leadId] = []
      tagsByLead[lt.leadId].push(lt.tag.name)
    })

    const header = 'Nome,Empresa,WhatsApp,Email,Segmento,Cidade,Score Geral,Score Mkt,Score Vendas,Score Oferta,Score Dados,Solucao,Maturidade,Status,Tags,Data\n'
    const rows = leads.map(l => {
      const sc = l.scores as any
      return [
        l.nome, l.empresa, l.whatsapp, l.email, l.segmento||'', l.cidade||'',
        sc?.geral||0, sc?.mkt||0, sc?.vnd||0, sc?.oferta||0, sc?.dados||0,
        l.solucaoNome||'', l.maturidade||'', l.status,
        (tagsByLead[l.id] || []).join('; '),
        new Date(l.createdAt).toLocaleDateString('pt-BR')
      ].map(v => `"${v}"`).join(',')
    }).join('\n')

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="leads_selecionados_${new Date().toISOString().slice(0,10)}.csv"`)
    return header + rows
  })

  // ── GET /api/bychat/leads/export/csv ─── Export ──
  app.get('/api/bychat/leads/export/csv', { preHandler: authMiddleware }, async (req, reply) => {
    // Escopo: AGENT/operador exporta apenas leads acessíveis (não a base inteira).
    const csvUser = (req as any).user as JwtPayload
    const csvScope = await buildLeadAccessWhere(csvUser.userId, csvUser.role as AccessRole)
    const leads = await prisma.lead.findMany({
      where: csvScope,
      orderBy: { createdAt: 'desc' },
      take: 5000
    })

    // Buscar tags de todos os leads exportados
    const allIds = leads.map(l => l.id)
    const leadTags = allIds.length > 0 ? await prisma.leadTag.findMany({
      where: { leadId: { in: allIds } },
      include: { tag: { select: { name: true } } }
    }) : []
    const tagsByLead: Record<number, string[]> = {}
    leadTags.forEach(lt => {
      if (!tagsByLead[lt.leadId]) tagsByLead[lt.leadId] = []
      tagsByLead[lt.leadId].push(lt.tag.name)
    })

    const header = 'Nome,Empresa,WhatsApp,Email,Segmento,Cidade,Score Geral,Score Mkt,Score Vendas,Score Oferta,Score Dados,Solucao,Maturidade,Status,Tags,Data\n'
    const rows = leads.map(l => {
      const sc = l.scores as any
      return [
        l.nome, l.empresa, l.whatsapp, l.email, l.segmento||'', l.cidade||'',
        sc?.geral||0, sc?.mkt||0, sc?.vnd||0, sc?.oferta||0, sc?.dados||0,
        l.solucaoNome||'', l.maturidade||'', l.status,
        (tagsByLead[l.id] || []).join('; '),
        new Date(l.createdAt).toLocaleDateString('pt-BR')
      ].map(v => `"${v}"`).join(',')
    }).join('\n')

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="leads_beyond_${new Date().toISOString().slice(0,10)}.csv"`)
    return header + rows
  })

  // ── GET /api/bychat/leads/:id/duplicates ─── Buscar possíveis duplicatas ──
  app.get('/api/bychat/leads/:id/duplicates', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    if (!await assertLeadAccess(req, reply, parseInt(id))) return
    const { findAllDuplicates } = await import('../services/dedup.js')
    const duplicates = await findAllDuplicates(parseInt(id))
    return {
      duplicates: duplicates.map(d => ({
        id: d.id,
        uid: d.uid,
        nome: d.nome,
        empresa: d.empresa,
        whatsapp: d.whatsapp,
        email: d.email,
        status: d.status,
        source: d.source,
        createdAt: d.createdAt,
        // matchedBy: array de motivos do casamento (whatsapp, email, …) — formato esperado pelo frontend
        matchedBy: d.matchType ? [d.matchType] : [],
      })),
    }
  })

  // ── POST /api/bychat/leads/merge ─── Mesclar leads ──
  // Aceita formato batch (`{ masterId, mergeIds: number[] }`) usado pelo MergeLeadsModal
  // e retrocompat (`{ keepId, mergeId }`).
  app.post('/api/bychat/leads/merge', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body || {}) as {
      masterId?: number | string
      mergeIds?: (number | string)[]
      keepId?: number | string
      mergeId?: number | string
    }
    const user = (req as any).user as JwtPayload

    const masterId = body.masterId ? parseInt(String(body.masterId)) : (body.keepId ? parseInt(String(body.keepId)) : null)
    const targetIds = body.mergeIds && body.mergeIds.length > 0
      ? body.mergeIds.map(x => parseInt(String(x))).filter(n => Number.isFinite(n))
      : body.mergeId ? [parseInt(String(body.mergeId))] : []

    if (!masterId || targetIds.length === 0) {
      return reply.code(400).send({ error: 'masterId e mergeIds (ou keepId+mergeId) são obrigatórios' })
    }
    if (targetIds.includes(masterId)) {
      return reply.code(400).send({ error: 'Não é possível mesclar um lead consigo mesmo' })
    }

    // Escopo: só mescla leads que o usuário pode acessar (master + todos os alvos).
    if (!await assertLeadAccess(req, reply, masterId)) return
    for (const tid of targetIds) {
      if (!await assertLeadAccess(req, reply, tid)) return
    }

    try {
      const { mergeLeads } = await import('../services/dedup.js')
      let merged = 0
      for (const tid of targetIds) {
        await mergeLeads({
          keepId: masterId,
          mergeId: tid,
          operatorName: user.name || user.email,
          operatorId: user.userId,
        })
        merged++
      }
      return { ok: true, merged, masterId }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Erro ao mesclar leads' })
    }
  })

  // ── GET /api/bychat/leads/duplicates/groups ─── Tela "Duplicados pendentes" (Fase 24) ──
  // Retorna grupos de leads sinalizados como possible_duplicate (duplicateStatus='pending_review'),
  // agrupados por possibleDuplicateOfId. Cada grupo = master + leads novos que casaram com ele.
  app.get('/api/bychat/leads/duplicates/groups', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const channel: string | null = q.channel || null
    const matchedBy: string | null = q.matchedBy || null
    const funnelId: number | null = q.funnelId ? parseInt(q.funnelId) : null

    const where: any = { duplicateStatus: 'pending_review' }
    if (matchedBy) where.duplicateMatchedBy = matchedBy
    if (funnelId) where.funnelId = funnelId
    if (channel) where.source = { contains: channel }

    const dups = await prisma.lead.findMany({
      where,
      orderBy: { duplicateFlaggedAt: 'desc' },
      select: {
        id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
        status: true, funnelId: true, source: true, originType: true,
        campaignId: true, campaignName: true, utmSource: true, utmCampaign: true,
        createdAt: true, duplicateFlaggedAt: true, duplicateMatchedBy: true,
        possibleDuplicateOfId: true,
        assignedUserId: true, teamId: true,
      },
      take: 500,
    })

    // Agrupa por master id
    const byMaster: Record<number, typeof dups> = {}
    for (const d of dups) {
      const mid = d.possibleDuplicateOfId
      if (!mid) continue
      if (!byMaster[mid]) byMaster[mid] = []
      byMaster[mid].push(d)
    }
    const masterIds = Object.keys(byMaster).map(Number)
    const masters = masterIds.length > 0
      ? await prisma.lead.findMany({
          where: { id: { in: masterIds } },
          select: {
            id: true, uid: true, nome: true, empresa: true, whatsapp: true, email: true,
            status: true, funnelId: true, source: true, originType: true,
            campaignId: true, campaignName: true, utmSource: true, utmCampaign: true,
            createdAt: true, assignedUserId: true, teamId: true,
            duplicateStatus: true,
          },
        })
      : []
    const masterById: Record<number, typeof masters[number]> = {}
    for (const m of masters) masterById[m.id] = m

    const groups = masterIds
      .map(mid => {
        const master = masterById[mid]
        if (!master) return null
        const dups = byMaster[mid].sort((a, b) =>
          (b.duplicateFlaggedAt?.getTime() ?? 0) - (a.duplicateFlaggedAt?.getTime() ?? 0)
        )
        return {
          masterId: mid,
          master,
          duplicates: dups,
          totalLeads: dups.length + 1,
          latestFlaggedAt: dups[0]?.duplicateFlaggedAt ?? null,
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (b.latestFlaggedAt?.getTime() ?? 0) - (a.latestFlaggedAt?.getTime() ?? 0))

    return { groups, total: groups.length }
  })

  // ── GET /api/bychat/leads/duplicates/count ─── Badge no topbar ──
  app.get('/api/bychat/leads/duplicates/count', { preHandler: authMiddleware }, async () => {
    const count = await prisma.lead.count({ where: { duplicateStatus: 'pending_review' } })
    return { count }
  })

  // ── POST /api/bychat/leads/duplicates/:masterId/keep-separate ─── Manter separados ──
  // Marca todos os leads pending_review apontando pra esse master como kept_separate.
  app.post('/api/bychat/leads/duplicates/:masterId/keep-separate', { preHandler: authMiddleware }, async (req, reply) => {
    const { masterId } = req.params as any
    const mid = parseInt(masterId)
    if (!Number.isFinite(mid)) return reply.code(400).send({ error: 'masterId inválido' })
    const user = (req as any).user as JwtPayload

    const dups = await prisma.lead.findMany({
      where: { possibleDuplicateOfId: mid, duplicateStatus: 'pending_review' },
      select: { id: true, uid: true },
    })
    if (dups.length === 0) return { ok: true, resolved: 0 }

    const now = new Date()
    await prisma.lead.updateMany({
      where: { id: { in: dups.map(d => d.id) } },
      data: { duplicateStatus: 'kept_separate', duplicateResolvedAt: now },
    })

    // Audit em ambos os lados
    const { logEvent: log, EVENT_TYPES: ET } = await import('../services/leadHistory.js')
    for (const d of dups) {
      log({
        leadId: d.id,
        type: ET.DUPLICATE_KEPT_SEPARATE,
        category: 'lifecycle',
        title: 'Mantido separado do possível duplicado',
        source: 'panel',
        actorType: 'operator',
        userId: user?.userId,
        userName: user?.name || user?.email,
        metadata: { masterLeadId: mid },
      })
      log({
        leadId: mid,
        type: ET.DUPLICATE_KEPT_SEPARATE,
        category: 'lifecycle',
        title: `Lead duplicado mantido separado: ${d.uid ? '#' + d.id + ' (' + d.uid + ')' : '#' + d.id}`,
        source: 'panel',
        actorType: 'operator',
        userId: user?.userId,
        userName: user?.name || user?.email,
        metadata: { duplicateLeadId: d.id },
      })
    }

    return { ok: true, resolved: dups.length }
  })
}
