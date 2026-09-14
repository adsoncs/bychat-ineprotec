// src/routes/surveys.ts
// Pesquisas / NPS — CRUD, publicação do Flow, disparo e apuração.
//
// A apuração fica aqui (e não no frontend) porque NPS não é média: é
// %promotores − %detratores sobre quem respondeu AQUELA pergunta. Calcular no
// cliente convida cada tela a inventar a sua própria conta.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import {
  publishSurveyFlow, dispatchSurvey, npsCategoryFor, computeSurveyResults,
  expireSurveySessions, type DispatchTarget,
} from '../services/surveys.js'

const QUESTION_TYPES = new Set(['scale', 'text', 'textarea', 'select', 'statement'])

/** Aceita só pergunta com tipo conhecido e chave utilizável — lixo no JSON vira
 *  Flow recusado pela Meta, e o erro só apareceria na hora de publicar. */
function sanitizeQuestions(input: any): any[] {
  if (!Array.isArray(input)) return []
  const keys = new Set<string>()
  const out: any[] = []
  for (const [i, q] of input.entries()) {
    if (!q || typeof q !== 'object') continue
    if (!QUESTION_TYPES.has(q.type)) continue
    let key = String(q.key || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60) || `q${i}`
    if (keys.has(key)) key = `${key}_${i}`
    keys.add(key)
    const base: any = {
      id: String(q.id || `q${i}`).slice(0, 40),
      key, type: q.type,
      label: String(q.label ?? '').slice(0, 500),
      required: q.type === 'statement' ? false : !!q.required,
    }
    if (q.helpText) base.helpText = String(q.helpText).slice(0, 500)
    if (q.type === 'select' && Array.isArray(q.options)) {
      base.options = q.options.slice(0, 20).map((o: any) => ({ value: String(o?.value ?? ''), label: String(o?.label ?? '') }))
    }
    if (q.type === 'scale') {
      const min = Number.isInteger(q.scaleMin) ? q.scaleMin : 1
      const max = Number.isInteger(q.scaleMax) && q.scaleMax > min ? q.scaleMax : min + 4
      base.scaleMin = min
      base.scaleMax = Math.min(max, min + 20) // teto do RadioButtonsGroup da Meta
      if (q.scaleMinLabel) base.scaleMinLabel = String(q.scaleMinLabel).slice(0, 40)
      if (q.scaleMaxLabel) base.scaleMaxLabel = String(q.scaleMaxLabel).slice(0, 40)
      if (q.scaleLabels && typeof q.scaleLabels === 'object') base.scaleLabels = q.scaleLabels
      if (q.isNps) base.isNps = true
    }
    out.push(base)
  }
  return out.slice(0, 60)
}

export async function surveysRoutes(app: FastifyInstance) {
  // ── CRUD ────────────────────────────────────────────────────────────
  app.get('/api/surveys', { preHandler: authMiddleware }, async () => {
    const items = await prisma.survey.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { responses: true, sessions: true } } },
    })
    return { items: items.map((s) => ({ ...s, responses: s._count.responses, invites: s._count.sessions, _count: undefined })) }
  })

  app.get('/api/surveys/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const survey = await prisma.survey.findUnique({ where: { id } })
    if (!survey) return reply.code(404).send({ error: 'Pesquisa não encontrada' })
    return { survey }
  })

  app.post('/api/surveys', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = req.body as any
    const name = String(b?.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'Informe o nome da pesquisa' })
    const questions = sanitizeQuestions(b?.questions)
    const survey = await prisma.survey.create({ data: {
      name: name.slice(0, 191),
      description: b?.description ? String(b.description).slice(0, 255) : null,
      questions,
      npsQuestionKey: b?.npsQuestionKey ? String(b.npsQuestionKey).slice(0, 100) : null,
      messages: b?.messages && typeof b.messages === 'object' ? b.messages : undefined,
      expiresAfterHours: Number.isInteger(b?.expiresAfterHours) ? b.expiresAfterHours : 168,
      createdBy: ((req as any).user as JwtPayload).userId,
    } })
    await logUserAudit({ ...auditActor(req), action: 'survey.created', targetType: 'survey', targetLabel: name, changes: { id: survey.id } }).catch(() => {})
    return { survey }
  })

  app.put('/api/surveys/:id', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = req.body as any
    const current = await prisma.survey.findUnique({ where: { id }, select: { id: true, flowId: true } })
    if (!current) return reply.code(404).send({ error: 'Pesquisa não encontrada' })

    const data: any = {}
    if (b?.name != null) data.name = String(b.name).trim().slice(0, 191)
    if (b?.description !== undefined) data.description = b.description ? String(b.description).slice(0, 255) : null
    if (b?.questions !== undefined) data.questions = sanitizeQuestions(b.questions)
    if (b?.npsQuestionKey !== undefined) data.npsQuestionKey = b.npsQuestionKey ? String(b.npsQuestionKey).slice(0, 100) : null
    if (b?.messages !== undefined) data.messages = b.messages && typeof b.messages === 'object' ? b.messages : null
    if (b?.expiresAfterHours !== undefined && Number.isInteger(b.expiresAfterHours)) data.expiresAfterHours = b.expiresAfterHours
    if (b?.active !== undefined) data.active = !!b.active

    const survey = await prisma.survey.update({ where: { id }, data })
    // Mudou pergunta com Flow já publicado? O Flow na Meta continua o antigo até
    // republicar — avisamos em vez de deixar o disparo sair com o formulário velho.
    const needsRepublish = b?.questions !== undefined && !!current.flowId
    return { survey, needsRepublish }
  })

  app.delete('/api/surveys/:id', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const survey = await prisma.survey.findUnique({ where: { id }, include: { _count: { select: { responses: true } } } })
    if (!survey) return reply.code(404).send({ error: 'Pesquisa não encontrada' })
    if (survey._count.responses > 0 && !(req.query as any)?.force) {
      return reply.code(409).send({ error: `Esta pesquisa tem ${survey._count.responses} resposta(s). Apagar destrói o histórico — desative-a em vez disso.` })
    }
    await prisma.survey.delete({ where: { id } })
    await logUserAudit({ ...auditActor(req), action: 'survey.deleted', targetType: 'survey', targetLabel: survey.name, changes: { id } }).catch(() => {})
    return { ok: true }
  })

  // ── Publicação do Flow na Meta ──────────────────────────────────────
  app.post('/api/surveys/:id/publish', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const connectionId = Number((req.body as any)?.connectionId)
    if (!connectionId) return reply.code(400).send({ error: 'Informe a conexão Cloud API' })
    try {
      const r = await publishSurveyFlow(id, connectionId)
      await logUserAudit({ ...auditActor(req), action: 'survey.flow_published', targetType: 'survey', targetLabel: String(id), changes: r as any }).catch(() => {})
      return { ok: true, ...r }
    } catch (e: any) {
      app.log.warn(`[surveys] publish falhou: ${e?.message || e}`)
      return reply.code(400).send({ error: String(e?.message || e) })
    }
  })

  // ── Disparo ─────────────────────────────────────────────────────────
  app.post('/api/surveys/:id/dispatch', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = req.body as any
    const raw = Array.isArray(b?.targets) ? b.targets : []
    if (!raw.length) return reply.code(400).send({ error: 'Nenhum destinatário informado' })
    if (raw.length > 5000) return reply.code(400).send({ error: 'Máximo de 5.000 destinatários por disparo' })
    const targets: DispatchTarget[] = raw
      .map((t: any) => (typeof t === 'string' ? { phone: t } : { phone: String(t?.phone || ''), nome: t?.nome ?? null }))
      .filter((t: DispatchTarget) => t.phone)
    try {
      const r = await dispatchSurvey(id, targets, {
        templateName: b?.templateName || null,
        templateLanguage: b?.templateLanguage || 'pt_BR',
        buttonIndex: Number.isInteger(b?.buttonIndex) ? b.buttonIndex : 0,
        app,
      })
      await logUserAudit({ ...auditActor(req), action: 'survey.dispatched', targetType: 'survey', targetLabel: String(id), changes: r as any }).catch(() => {})
      return { ok: true, ...r }
    } catch (e: any) {
      return reply.code(400).send({ error: String(e?.message || e) })
    }
  })

  // ── Apuração ────────────────────────────────────────────────────────
  // A conta vive em services/surveys.ts (computeSurveyResults) para ser testável
  // sem subir o Fastify — a rota só entrega.
  app.get('/api/surveys/:id/results', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const results = await computeSurveyResults(id)
    if (!results) return reply.code(404).send({ error: 'Pesquisa não encontrada' })
    return results
  })

  // Expira convites vencidos sob demanda (o worker também roda periodicamente).
  app.post('/api/surveys/expire-sessions', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const count = await expireSurveySessions()
    return { ok: true, expired: count }
  })
}

export { npsCategoryFor }
