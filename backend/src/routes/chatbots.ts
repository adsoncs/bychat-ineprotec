import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotChatbot } from '../services/trash.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { startPreview, messagePreview } from '../services/chatbotPreview.js'

export async function chatbotsRoutes(app: FastifyInstance) {

  // GET /api/admin/chatbots — List all
  app.get('/api/admin/chatbots', { preHandler: adminOnly }, async () => {
    const chatbots = await prisma.chatbot.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { questions: true } } }
    })
    return { chatbots }
  })

  // GET /api/admin/chatbots/:id — Get with questions
  app.get('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const chatbot = await prisma.chatbot.findUnique({
      where: { id: Number(id) },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } }
    })
    if (!chatbot) return reply.code(404).send({ error: 'Chatbot não encontrado' })
    return chatbot
  })

  // POST /api/admin/chatbots — Create
  app.post('/api/admin/chatbots', { preHandler: adminOnly }, async (req) => {
    const { name, channel, mode, formId, systemPrompt, extractionPrompt, analysisPrompt, greetingMessage, completionMessage } = req.body as any
    const chatbot = await prisma.chatbot.create({
      data: {
        name: name || 'Novo Chatbot',
        channel: channel || 'chat',
        mode: (mode === 'scripted' || mode === 'ai_journey') ? mode : 'ai',
        ...(formId ? { formId: Number(formId) } : {}),
        systemPrompt: systemPrompt || '',
        extractionPrompt: extractionPrompt || '',
        analysisPrompt: analysisPrompt || '',
        greetingMessage: greetingMessage || '',
        completionMessage: completionMessage || ''
      }
    })
    return chatbot
  })

  // PUT /api/admin/chatbots/:id — Update
  //
  // Auditoria: esta rota mexe no campo mais sensível do chatbot (`active`) sem
  // deixar rastro nenhum — achado no severiano, 2026-09-16: o chatbot ficou
  // desligado por dias e ninguém sabia dizer quem, nem quando. Agora toda
  // edição que muda algo de fato é gravada em UserAudit (quem, quando, de→para),
  // visível em GET /api/admin/audit-log (superadmin). Campos de texto longo
  // (prompts, mensagens) entram truncados: o que importa é flagrar A MUDANÇA e
  // o autor, não arquivar o prompt inteiro a cada edição.
  const CHATBOT_UPDATE_FIELDS = ['name', 'channel', 'mode', 'formId', 'useFlow', 'postChatAi', 'postChatPrompt', 'aiInterpret', 'interpretPrompt', 'aiJourneyPrompt', 'triggerMode', 'triggerKeywords', 'schedulingIntro', 'scriptedMessages', 'funnelId', 'defaultTeamId', 'systemPrompt', 'extractionPrompt', 'analysisPrompt', 'greetingMessage', 'completionMessage', 'active', 'inactivityEnabled', 'inactivityAction', 'inactivityTimeoutMin', 'inactivityMessage', 'inactivityCheckIntervalMin', 'inactivityMaxRetries', 'inactivityCloseAfterMin'] as const

  app.put('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of CHATBOT_UPDATE_FIELDS) {
      if (body[k] !== undefined) data[k] = body[k]
    }

    const before = await prisma.chatbot.findUnique({
      where: { id: Number(id) },
      select: Object.fromEntries(CHATBOT_UPDATE_FIELDS.map((f) => [f, true])) as Record<string, true>,
    })
    const chatbot = await prisma.chatbot.update({ where: { id: Number(id) }, data })

    if (before) {
      const TRUNCATE_AT = 200
      const shorten = (v: unknown) => (typeof v === 'string' && v.length > TRUNCATE_AT ? v.slice(0, TRUNCATE_AT) + '…' : v)
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const k of CHATBOT_UPDATE_FIELDS) {
        if (data[k] === undefined) continue
        const from = (before as any)[k]
        const to = data[k]
        const igual = typeof from === 'object' || typeof to === 'object'
          ? JSON.stringify(from) === JSON.stringify(to)
          : from === to
        if (igual) continue
        changes[k] = { from: shorten(from), to: shorten(to) }
      }
      if (Object.keys(changes).length > 0) {
        const action = 'active' in changes ? (changes.active.to ? 'chatbot.activated' : 'chatbot.deactivated') : 'chatbot.updated'
        void logUserAudit({
          action,
          targetType: 'chatbot',
          targetLabel: chatbot.name || `Chatbot #${id}`,
          changes,
          ...auditActor(req),
        })
      }
    }

    return chatbot
  })

  // ── EXPORT ──
  // GET /api/admin/chatbots/:id/export — devolve JSON com a configuração completa
  // do chatbot (campos diretos + questions + nomes de referências externas).
  // Content-Disposition: attachment força o download direto pelo browser.
  // O JSON é portável: pode ser importado de volta neste sistema (mesma instância
  // ou outra) via POST /api/admin/chatbots/import.
  app.get('/api/admin/chatbots/:id/export', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const chatbot = await prisma.chatbot.findUnique({
      where: { id },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } },
    })
    if (!chatbot) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    // Inclui o NOME de cada referência (funnel/team/portal) — no import, tentamos
    // resolver o ID equivalente por nome. Se não bater, a ref fica null e o
    // operador escolhe manualmente depois.
    const [funnel, team] = await Promise.all([
      chatbot.funnelId      ? prisma.funnel.findUnique({ where: { id: chatbot.funnelId      }, select: { name: true } }) : Promise.resolve(null),
      chatbot.defaultTeamId ? prisma.team.findUnique({   where: { id: chatbot.defaultTeamId }, select: { name: true, slug: true } }) : Promise.resolve(null),
    ])

    const payload = {
      kind:       'bychat-chatbot-export',
      version:    1,
      exportedAt: new Date().toISOString(),
      sourceId:   chatbot.id,
      chatbot: {
        name:                       chatbot.name,
        channel:                    chatbot.channel,
        active:                     chatbot.active,
        systemPrompt:               chatbot.systemPrompt,
        extractionPrompt:           chatbot.extractionPrompt,
        analysisPrompt:             chatbot.analysisPrompt,
        greetingMessage:            chatbot.greetingMessage,
        completionMessage:          chatbot.completionMessage,
        scoringConfig:              chatbot.scoringConfig,
        sentimentPrompt:            chatbot.sentimentPrompt,
        autoAnalysis:               chatbot.autoAnalysis,
        inactivityEnabled:          chatbot.inactivityEnabled,
        inactivityAction:           chatbot.inactivityAction,
        inactivityTimeoutMin:       chatbot.inactivityTimeoutMin,
        inactivityMessage:          chatbot.inactivityMessage,
        inactivityCheckIntervalMin: chatbot.inactivityCheckIntervalMin,
        inactivityMaxRetries:       chatbot.inactivityMaxRetries,
        inactivityCloseAfterMin:    chatbot.inactivityCloseAfterMin,
      },
      // Referências externas — guardamos `name`/`slug` pra tentar match no import.
      references: {
        funnel: funnel ? { name: funnel.name } : null,
        team:   team   ? { name: team.name, slug: team.slug } : null,
      },
      questions: chatbot.questions.map((q) => ({
        stage:    q.stage,
        position: q.position,
        fieldKey: q.fieldKey,
        text:     q.text,
        type:     q.type,
        options:  q.options,
        required: q.required,
        active:   q.active,
      })),
    }

    const slug = String(chatbot.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `chatbot-${id}`
    const date = new Date().toISOString().slice(0, 10)
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="chatbot-${slug}-${date}.json"`)
    return payload
  })

  // ── IMPORT ──
  // POST /api/admin/chatbots/import — body { payload, name?, importQuestions? }
  // Cria um chatbot novo a partir do JSON exportado. Aceita override do nome
  // (campo `name`); se omitido, usa `${original} (importado)`.
  // `importQuestions` (default true) controla se traz as perguntas junto.
  app.post('/api/admin/chatbots/import', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const payload = body?.payload
    const overrideName = typeof body?.name === 'string' ? body.name.trim() : ''
    const importQuestions = body?.importQuestions !== false

    if (!payload || payload.kind !== 'bychat-chatbot-export' || !payload.chatbot) {
      return reply.code(400).send({ error: 'Arquivo inválido — não é um export de chatbot.' })
    }
    if (typeof payload.version !== 'number' || payload.version > 1) {
      return reply.code(400).send({ error: `Versão de export não suportada (${payload.version}).` })
    }

    const c = payload.chatbot ?? {}
    const refs = payload.references ?? {}

    // Tenta resolver referências por nome/slug. Se não encontrar, mantém null.
    const [resolvedFunnel, resolvedTeam] = await Promise.all([
      refs.funnel?.name ? prisma.funnel.findFirst({ where: { name: String(refs.funnel.name) }, select: { id: true } }) : Promise.resolve(null),
      refs.team?.slug   ? prisma.team.findUnique({ where: { slug: String(refs.team.slug) }, select: { id: true } })
        : refs.team?.name ? prisma.team.findFirst({ where: { name: String(refs.team.name) }, select: { id: true } })
        : Promise.resolve(null),
    ])

    const name = overrideName || `${String(c.name ?? 'Chatbot importado')} (importado)`

    const created = await prisma.$transaction(async (tx) => {
      const chatbot = await tx.chatbot.create({
        data: {
          name:                       name.slice(0, 191),
          channel:                    String(c.channel ?? 'chat'),
          active:                     c.active === true, // por segurança, importa desativado se não vier explícito
          systemPrompt:               String(c.systemPrompt ?? ''),
          extractionPrompt:           String(c.extractionPrompt ?? ''),
          analysisPrompt:             String(c.analysisPrompt ?? ''),
          greetingMessage:            String(c.greetingMessage ?? ''),
          completionMessage:          String(c.completionMessage ?? ''),
          scoringConfig:              c.scoringConfig ?? undefined,
          sentimentPrompt:            c.sentimentPrompt ?? null,
          autoAnalysis:               c.autoAnalysis !== false,
          inactivityEnabled:          c.inactivityEnabled === true,
          inactivityAction:           c.inactivityAction ?? null,
          inactivityTimeoutMin:       Number.isFinite(c.inactivityTimeoutMin)       ? Number(c.inactivityTimeoutMin)       : undefined,
          inactivityMessage:          c.inactivityMessage ?? null,
          inactivityCheckIntervalMin: Number.isFinite(c.inactivityCheckIntervalMin) ? Number(c.inactivityCheckIntervalMin) : undefined,
          inactivityMaxRetries:       Number.isFinite(c.inactivityMaxRetries)       ? Number(c.inactivityMaxRetries)       : undefined,
          inactivityCloseAfterMin:    Number.isFinite(c.inactivityCloseAfterMin)    ? Number(c.inactivityCloseAfterMin)    : undefined,
          funnelId:      resolvedFunnel?.id ?? null,
          defaultTeamId: resolvedTeam?.id   ?? null,
        },
      })

      const questionsRaw: any[] = Array.isArray(payload.questions) ? payload.questions : []
      let importedQuestions = 0
      if (importQuestions && questionsRaw.length > 0) {
        await tx.chatQuestion.createMany({
          data: questionsRaw.map((q: any, idx: number) => ({
            chatbotId: chatbot.id,
            stage:     Number.isFinite(q.stage)    ? Number(q.stage)    : 0,
            position:  Number.isFinite(q.position) ? Number(q.position) : idx,
            fieldKey:  String(q.fieldKey ?? `field_${idx}`),
            text:      String(q.text ?? ''),
            type:      String(q.type ?? 'text'),
            options:   q.options ?? undefined,
            required:  q.required !== false,
            active:    q.active   !== false,
          })),
        })
        importedQuestions = questionsRaw.length
      }

      return { chatbot, importedQuestions }
    })

    return {
      ok: true,
      chatbot: created.chatbot,
      importedQuestions: created.importedQuestions,
      resolvedReferences: {
        funnelId:      resolvedFunnel?.id ?? null,
        defaultTeamId: resolvedTeam?.id   ?? null,
      },
      // Avisa o operador se alguma referência veio do export mas não foi encontrada nesta instância.
      unresolvedReferences: {
        ...(refs.funnel?.name && !resolvedFunnel ? { funnel: refs.funnel.name } : {}),
        ...(refs.team?.name   && !resolvedTeam   ? { team:   refs.team.name   } : {}),
      },
    }
  })

  // POST /api/admin/chatbots/:id/duplicate — Duplicar chatbot
  // Espelha o padrão de POST /api/forms/:id/duplicate e /api/pages/:id/duplicate.
  // Cria nova entrada com sufixo "(Cópia)" e clona TODAS as ChatQuestion via
  // transação. Mantém configurações genéricas (prompts, scoring, inactivity).
  // Não duplica execuções de leads — chatbot fica zerado pra começar limpo.
  app.post('/api/admin/chatbots/:id/duplicate', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const original = await prisma.chatbot.findUnique({
      where: { id: Number(id) },
      include: { questions: { orderBy: [{ stage: 'asc' }, { position: 'asc' }] } },
    })
    if (!original) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    const copy = await prisma.$transaction(async (tx) => {
      const clone = await tx.chatbot.create({
        data: {
          name: `${original.name} (Cópia)`.slice(0, 191),
          channel: original.channel,
          funnelId: original.funnelId,
          systemPrompt: original.systemPrompt,
          extractionPrompt: original.extractionPrompt,
          analysisPrompt: original.analysisPrompt,
          greetingMessage: original.greetingMessage,
          completionMessage: original.completionMessage,
          // Inicia inativo por segurança — operador revisa e ativa.
          active: false,
          scoringConfig: (original.scoringConfig as any) ?? undefined,
          sentimentPrompt: original.sentimentPrompt,
          autoAnalysis: original.autoAnalysis,
          inactivityEnabled: original.inactivityEnabled,
          inactivityAction: original.inactivityAction,
          inactivityTimeoutMin: original.inactivityTimeoutMin,
          inactivityMessage: original.inactivityMessage,
          inactivityCheckIntervalMin: original.inactivityCheckIntervalMin,
          inactivityMaxRetries: original.inactivityMaxRetries,
          inactivityCloseAfterMin: original.inactivityCloseAfterMin,
          defaultTeamId: original.defaultTeamId,
        },
      })

      // Clona todas as perguntas mantendo ordem e configuração.
      if (original.questions.length > 0) {
        await tx.chatQuestion.createMany({
          data: original.questions.map((q) => ({
            chatbotId: clone.id,
            stage: q.stage,
            position: q.position,
            fieldKey: q.fieldKey,
            text: q.text,
            type: q.type,
            options: (q.options as any) ?? undefined,
            required: q.required,
            active: q.active,
          })),
        })
      }

      return clone
    })

    return reply.code(201).send({ ok: true, chatbot: copy })
  })

  // DELETE /api/admin/chatbots/:id (move para lixeira)
  app.delete('/api/admin/chatbots/:id', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotChatbot(Number(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'chatbot',
        entityId: Number(id),
        entityLabel: snapshot.name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.chatbot.delete({ where: { id: Number(id) } })
    void logUserAudit({
      action: 'chatbot.deleted',
      targetType: 'chatbot',
      targetLabel: (snapshot as any)?.name || `Chatbot #${id}`,
      ...auditActor(req),
    })
    return { ok: true }
  })

  // ── Questions CRUD ──

  // GET /api/admin/chatbots/:id/questions
  app.get('/api/admin/chatbots/:id/questions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const questions = await prisma.chatQuestion.findMany({
      where: { chatbotId: Number(id) },
      orderBy: [{ stage: 'asc' }, { position: 'asc' }]
    })
    return { questions }
  })

  // POST /api/admin/chatbots/:id/questions
  app.post('/api/admin/chatbots/:id/questions', { preHandler: adminOnly }, async (req) => {
    const { id } = req.params as any
    const { stage, position, fieldKey, text, type, options, required } = req.body as any
    const maxPos = await prisma.chatQuestion.aggregate({
      where: { chatbotId: Number(id), stage: stage ?? 0 },
      _max: { position: true }
    })
    const q = await prisma.chatQuestion.create({
      data: {
        chatbotId: Number(id),
        stage: stage ?? 0,
        position: position ?? ((maxPos._max.position ?? -1) + 1),
        fieldKey: fieldKey || 'campo',
        text: text || 'Pergunta',
        type: type || 'text',
        options: options || null,
        required: required ?? true
      }
    })
    return q
  })

  // PUT /api/admin/chatbots/:id/questions/:qid
  app.put('/api/admin/chatbots/:id/questions/:qid', { preHandler: adminOnly }, async (req) => {
    const { qid } = req.params as any
    const body = req.body as any
    const data: any = {}
    for (const k of ['stage', 'position', 'fieldKey', 'text', 'type', 'options', 'required', 'active']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    const q = await prisma.chatQuestion.update({ where: { id: Number(qid) }, data })
    return q
  })

  // DELETE /api/admin/chatbots/:id/questions/:qid
  app.delete('/api/admin/chatbots/:id/questions/:qid', { preHandler: adminOnly }, async (req) => {
    const { qid } = req.params as any
    await prisma.chatQuestion.delete({ where: { id: Number(qid) } })
    return { ok: true }
  })

  // PUT /api/admin/chatbots/:id/questions/reorder
  app.put('/api/admin/chatbots/:id/questions/reorder', { preHandler: adminOnly }, async (req) => {
    const { order } = req.body as any
    if (!Array.isArray(order)) return { error: 'Formato inválido' }
    for (const item of order) {
      await prisma.chatQuestion.update({ where: { id: item.id }, data: { position: item.position, stage: item.stage } })
    }
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // PUBLIC — Chatbot embed / widget
  // ══════════════════════════════════════════════

  // GET /api/chatbots/public/:id/config — Config pública do chatbot (para widget)
  app.get('/api/chatbots/public/:id/config', async (req, reply) => {
    const { id } = req.params as any
    const chatbot = await prisma.chatbot.findUnique({ where: { id: Number(id) } })
    if (!chatbot || !chatbot.active) return reply.code(404).send({ error: 'Chatbot não encontrado' })

    reply.header('Cache-Control', 'public, max-age=300')
    return {
      id: chatbot.id,
      name: chatbot.name,
      greetingMessage: chatbot.greetingMessage,
      channel: chatbot.channel,
      active: chatbot.active,
    }
  })

  // ── Preview interativo: roda o motor REAL do chatbot em memória (sem lead/booking) ──
  app.post('/api/chatbots/:id/preview/start', async (req, reply) => {
    const chatbotId = Number((req.params as any).id)
    if (isNaN(chatbotId)) return reply.code(400).send({ error: 'id inválido' })
    // Teste com o CONTEXTO de um lead real (consultor educacional): só para quem
    // está logado no painel — a rota é pública (embed), e o contexto traz
    // anotações, negociações e dados pessoais do contato.
    const pedido = Number((req.body as any)?.contextLeadId) || null
    let contextLeadId: number | null = null
    if (pedido) {
      const { verifyToken } = await import('../lib/auth.js')
      try { verifyToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) }
      catch { return reply.code(401).send({ error: 'Entre no painel para testar com o contexto de um lead.' }) }
      contextLeadId = pedido
    }
    const r = await startPreview(chatbotId, { app, contextLeadId })
    if ('error' in r) return reply.code(404).send(r)
    return reply.header('Access-Control-Allow-Origin', '*').send(r)
  })

  app.post('/api/chatbots/:id/preview/message', async (req, reply) => {
    const { sessionId, message } = (req.body || {}) as { sessionId?: string; message?: string }
    if (!sessionId || !message) return reply.code(400).send({ error: 'sessionId e message são obrigatórios' })
    const r = await messagePreview(sessionId, message)
    if ('error' in r) return reply.code(404).send(r)
    return reply.header('Access-Control-Allow-Origin', '*').send(r)
  })

}
