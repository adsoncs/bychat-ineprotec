// src/routes/enrollmentEvaluations.ts
// Painel admin de avaliações de inscrição agrupadas por modo de ingresso:
//   • ENEM      (validação do boletim importado por IA)
//   • Presencial (lançamento de nota e veredito da prova física)
//   • Redação   (correção IA + revisão humana — 1 doc/inscrição)
//
// Cada módulo tem rotas próprias mas compartilha:
//   • computeEvaluationStatus(reg) → 'pending' | 'rejected' | 'approved' | 'na'
//   • tryAutoAdvanceOnEvaluationComplete(registrationId) — gateway final.
//
// Não toca nas rotas de docs/portal já existentes.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { validateEnemImport } from '../services/enemClassification.js'
import {
  computeEvaluationStatus,
  tryAutoAdvanceOnEvaluationComplete,
  type EvaluationStatus,
} from '../services/enrollmentEvaluationGateway.js'

// Re-exports preservam callers que importavam destas rotas (compat).
export { computeEvaluationStatus, tryAutoAdvanceOnEvaluationComplete }
export type { EvaluationStatus }

// ───────────────────────────────────────────────────────────
// Auth helper (admin/manager)
// ───────────────────────────────────────────────────────────

async function requireAdmin(req: any, reply: any): Promise<any | null> {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) { reply.code(401).send({ error: 'Token não fornecido' }); return null }
  const { verifyToken } = await import('../lib/auth.js')
  try {
    const user: any = verifyToken(token)
    if (!['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) {
      reply.code(403).send({ error: 'Sem permissão' })
      return null
    }
    return user
  } catch {
    reply.code(401).send({ error: 'Token inválido' })
    return null
  }
}

// ───────────────────────────────────────────────────────────
// Helper: monta o payload de variáveis usado pelos templates
// ───────────────────────────────────────────────────────────

async function buildBaseEventPayload(registrationId: number): Promise<any | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true,
      lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
      portal: { select: { id: true, nome: true, slug: true } },
      processRegistration: {
        select: {
          offering: { select: { nome: true, course: { select: { nome: true } } } },
        },
      },
    },
  })
  if (!reg?.lead) return null

  const appUrl = process.env.APP_URL || 'http://localhost:3005'
  const courseName = reg.processRegistration?.offering?.course?.nome
    || reg.processRegistration?.offering?.nome
    || ''

  return {
    leadId: reg.lead.id,
    payload: {
      nome: reg.lead.nome,
      email: reg.lead.email,
      whatsapp: reg.lead.whatsapp,
      candidateCode: reg.candidateCode,
      portalNome: reg.portal?.nome || '',
      courseName,
      candidateUrl: `${appUrl}/candidato/${reg.candidateCode}`,
    },
  }
}

// ───────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────

export async function enrollmentEvaluationsRoutes(app: FastifyInstance) {

  // ═════════════════════════════════════════════
  // ENEM — listagem + ações de validação
  // ═════════════════════════════════════════════

  // GET /api/admin/enem-imports — lista de boletins ENEM importados.
  // Filtros: status (pending/approved/rejected/all), portalId, q, sort.
  app.get('/api/admin/enem-imports', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return

    const q = req.query as any
    const statusFilter = String(q.status || 'pending').toLowerCase()
    const portalId = q.portalId ? parseInt(q.portalId) : null
    const search = String(q.q || '').trim()
    const sort = q.sort === 'newest' ? 'desc' : 'asc'
    const limit = Math.min(Math.max(parseInt(q.limit) || 100, 1), 500)
    const offset = Math.max(parseInt(q.offset) || 0, 0)

    // Aliasamos o status pra mapear no campo `passed` + validatedAt
    const where: any = {}
    if (statusFilter === 'pending') where.AND = [{ validatedAt: null }, { passed: null }]
    else if (statusFilter === 'approved') where.passed = true
    else if (statusFilter === 'rejected') where.passed = false
    // statusFilter === 'all' → sem filtro adicional

    if (portalId) where.registration = { portalId }
    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { inscricao: { contains: search } },
        { registration: { is: { candidateCode: { contains: search } } } },
        { registration: { is: { lead: { is: { nome: { contains: search } } } } } },
      ]
    }

    const [items, kpiRows] = await Promise.all([
      prisma.enemScoreImport.findMany({
        where,
        orderBy: { createdAt: sort as any },
        take: limit, skip: offset,
        select: {
          id: true, nome: true, inscricao: true, ano: true, treineiro: true,
          cienciasHumanas: true, cienciasNatureza: true, linguagens: true,
          matematica: true, redacao: true, mediaSimples: true, cutoffScore: true,
          passed: true, source: true, aiConfidence: true,
          nomeBateComForm: true, inscricaoBateComForm: true, anoBateComForm: true,
          validatedAt: true, validatedBy: true, validationNote: true,
          createdAt: true,
          registration: {
            select: {
              id: true, candidateCode: true,
              portal: { select: { id: true, nome: true, slug: true } },
              lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
              processRegistration: {
                select: { offering: { select: { nome: true, course: { select: { nome: true } }, notaCorte: true } } },
              },
            },
          },
        },
      }),
      prisma.enemScoreImport.findMany({
        select: { passed: true, validatedAt: true },
      }),
    ])

    const kpi = { pending: 0, approved: 0, rejected: 0 }
    for (const k of kpiRows) {
      if (!k.validatedAt && k.passed == null) kpi.pending++
      else if (k.passed === true) kpi.approved++
      else if (k.passed === false) kpi.rejected++
    }

    return { items, total: items.length, kpi }
  })

  // GET /api/admin/enem-imports/:id — detalhe (já há dados completos no list,
  // mas isolar permite incluir mais campos sem inflar a listagem).
  app.get('/api/admin/enem-imports/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const item = await prisma.enemScoreImport.findUnique({
      where: { id: parseInt(id) },
      include: {
        document: { select: { id: true, fileUrl: true, fileName: true, mimeType: true, sizeBytes: true } },
        registration: {
          include: {
            lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
            portal: { select: { id: true, nome: true, slug: true } },
            processRegistration: {
              include: {
                selectionProcess: { select: { id: true, nome: true, notaCorte: true, entryMode: { select: { code: true, name: true } } } },
                offering: { select: { nome: true, notaCorte: true, course: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    })
    if (!item) return reply.code(404).send({ error: 'Importação não encontrada' })
    return { item }
  })

  // POST /api/admin/enem-imports/:id/validate
  // Body: { acceptAi?: bool, scores?: {ch,cn,lg,mt,rd}, passed?: bool, validationNote? }
  // - acceptAi=true: aceita os valores extraídos pela IA, marca como validado
  // - scores presentes: override manual das notas
  // - passed presente: força veredito (ignora cutoff automático)
  app.post('/api/admin/enem-imports/:id/validate', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const toNum = (v: any) => v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)
    const scores = body.scores || {}

    try {
      const updated = await validateEnemImport(parseInt(id), { userId: user.userId, name: user.name || '' }, {
        cienciasHumanas: scores.cienciasHumanas !== undefined ? toNum(scores.cienciasHumanas) : undefined,
        cienciasNatureza: scores.cienciasNatureza !== undefined ? toNum(scores.cienciasNatureza) : undefined,
        linguagens: scores.linguagens !== undefined ? toNum(scores.linguagens) : undefined,
        matematica: scores.matematica !== undefined ? toNum(scores.matematica) : undefined,
        redacao: scores.redacao !== undefined ? toNum(scores.redacao) : undefined,
        passed: body.passed === true ? true : body.passed === false ? false : undefined,
        validationNote: body.validationNote || (body.acceptAi ? 'Aceitação direta da extração IA' : undefined),
      })

      // Eventos de domínio + auto-advance
      const base = await buildBaseEventPayload(updated.registrationId)
      if (base) {
        const eventType = updated.passed === true ? 'enrollment.enem_approved'
          : updated.passed === false ? 'enrollment.enem_rejected'
          : 'enrollment.enem_validated'
        eventBus.emitDomain({
          type: eventType,
          leadId: base.leadId,
          payload: {
            ...base.payload,
            mediaSimples: updated.mediaSimples,
            cutoffScore: updated.cutoffScore,
            passed: updated.passed,
            validationNote: updated.validationNote,
          },
          timestamp: new Date(),
        })
        // Auto-advance só se aprovado
        if (updated.passed === true) {
          tryAutoAdvanceOnEvaluationComplete(updated.registrationId, user.userId).catch(err =>
            req.log.warn(`[enem-validate] auto-advance: ${err.message}`)
          )
        }
      }

      return { ok: true, import: updated }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Erro ao validar' })
    }
  })

  // POST /api/admin/enem-imports/:id/reject — atalho com motivo obrigatório
  app.post('/api/admin/enem-imports/:id/reject', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const body = (req.body as any) || {}
    if (!body.reason || !String(body.reason).trim()) {
      return reply.code(400).send({ error: 'Motivo (reason) é obrigatório' })
    }

    try {
      const updated = await validateEnemImport(parseInt(id), { userId: user.userId, name: user.name || '' }, {
        passed: false,
        validationNote: String(body.reason),
      })

      const base = await buildBaseEventPayload(updated.registrationId)
      if (base) {
        eventBus.emitDomain({
          type: 'enrollment.enem_rejected',
          leadId: base.leadId,
          payload: { ...base.payload, validationNote: updated.validationNote, mediaSimples: updated.mediaSimples },
          timestamp: new Date(),
        })
      }

      return { ok: true, import: updated }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Erro ao rejeitar' })
    }
  })

  // ═════════════════════════════════════════════
  // PRESENCIAL — listagem + agendamento + nota + veredito
  // ═════════════════════════════════════════════

  app.get('/api/admin/presencial-exams', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const q = req.query as any
    const statusFilter = String(q.status || 'pending').toLowerCase()  // pending | approved | rejected | scheduled | absent | all
    const portalId = q.portalId ? parseInt(q.portalId) : null
    const search = String(q.q || '').trim()
    const sort = q.sort === 'newest' ? 'desc' : 'asc'

    const where: any = {}
    if (statusFilter === 'pending') where.verdict = 'pending'
    else if (statusFilter === 'approved') where.verdict = 'approved'
    else if (statusFilter === 'rejected') where.verdict = 'rejected'
    else if (statusFilter === 'absent') where.attendanceStatus = 'absent'
    else if (statusFilter === 'scheduled') where.attendanceStatus = 'scheduled'

    if (portalId) where.registration = { portalId }
    if (search) {
      where.registration = {
        ...(where.registration || {}),
        OR: [
          { candidateCode: { contains: search } },
          { lead: { is: { nome: { contains: search } } } },
          { lead: { is: { email: { contains: search } } } },
        ],
      }
    }

    const items = await prisma.presencialExam.findMany({
      where,
      orderBy: [{ scheduledAt: sort as any }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true, scheduledAt: true, location: true, room: true, seatNumber: true,
        attendanceStatus: true, score: true, maxScore: true, examNote: true,
        verdict: true, verdictBy: true, verdictAt: true, verdictReason: true,
        passed: true, cutoffApplied: true, createdAt: true,
        registration: {
          select: {
            id: true, candidateCode: true,
            portal: { select: { id: true, nome: true } },
            lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
            processRegistration: {
              select: {
                selectionProcess: { select: { id: true, nome: true, presencialCutoff: true } },
                offering: { select: { nome: true, presencialCutoff: true, course: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    })

    const kpiRows = await prisma.presencialExam.findMany({
      select: { verdict: true, attendanceStatus: true },
    })
    const kpi = { pending: 0, approved: 0, rejected: 0, scheduled: 0, absent: 0 }
    for (const k of kpiRows) {
      if (k.verdict === 'pending') kpi.pending++
      else if (k.verdict === 'approved') kpi.approved++
      else if (k.verdict === 'rejected') kpi.rejected++
      if (k.attendanceStatus === 'scheduled') kpi.scheduled++
      else if (k.attendanceStatus === 'absent') kpi.absent++
    }

    return { items, total: items.length, kpi }
  })

  // POST /api/admin/registrations/:id/presencial-exam — cria/atualiza prova presencial.
  // Body: { scheduledAt?, location?, room?, seatNumber?, score?, maxScore?, examNote?,
  //         attendanceStatus?, verdict? ('approved'|'rejected'|'pending'), verdictReason? }
  app.post('/api/admin/registrations/:id/presencial-exam', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const regId = parseInt(id)
    const body = (req.body as any) || {}

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: regId },
      select: {
        id: true,
        processRegistration: {
          select: {
            selectionProcess: { select: { presencialCutoff: true } },
            offering: { select: { presencialCutoff: true } },
          },
        },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const offCutoff = reg.processRegistration?.offering?.presencialCutoff ?? null
    const spCutoff = reg.processRegistration?.selectionProcess?.presencialCutoff ?? null
    const cutoff = offCutoff != null ? offCutoff : spCutoff

    const toNum = (v: any) => v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)
    const score = body.score !== undefined ? toNum(body.score) : undefined
    const maxScore = body.maxScore !== undefined ? toNum(body.maxScore) : undefined

    const data: any = {}
    if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null
    if (body.location !== undefined) data.location = body.location || null
    if (body.room !== undefined) data.room = body.room || null
    if (body.seatNumber !== undefined) data.seatNumber = body.seatNumber || null
    if (body.attendanceStatus !== undefined && ['scheduled', 'present', 'absent'].includes(body.attendanceStatus)) {
      data.attendanceStatus = body.attendanceStatus
    }
    if (score !== undefined) data.score = score
    if (maxScore !== undefined) data.maxScore = maxScore
    if (body.examNote !== undefined) data.examNote = body.examNote || null

    // Veredito
    if (body.verdict !== undefined && ['pending', 'approved', 'rejected'].includes(body.verdict)) {
      data.verdict = body.verdict
      if (body.verdict !== 'pending') {
        data.verdictBy = user.userId
        data.verdictAt = new Date()
        data.verdictReason = body.verdictReason || null
      }
    }

    // Auto-classifica passed se score e cutoff disponíveis
    if (score != null && cutoff != null) {
      data.cutoffApplied = cutoff
      data.passed = score >= cutoff
    }

    // Ausente → veredito automático rejected
    if (data.attendanceStatus === 'absent' && !data.verdict) {
      data.verdict = 'rejected'
      data.verdictBy = user.userId
      data.verdictAt = new Date()
      data.verdictReason = data.verdictReason || 'Candidato ausente na prova'
    }

    const existing = await prisma.presencialExam.findFirst({
      where: { registrationId: regId },
      orderBy: { createdAt: 'desc' },
    })

    let exam: any
    if (existing) {
      exam = await prisma.presencialExam.update({ where: { id: existing.id }, data })
    } else {
      exam = await prisma.presencialExam.create({
        data: { ...data, registrationId: regId, verdict: data.verdict || 'pending' },
      })
    }

    // Eventos
    const base = await buildBaseEventPayload(regId)
    if (base) {
      // scheduled, attended, approved, rejected
      let eventType: string | null = null
      if (body.scheduledAt && !existing) eventType = 'enrollment.presencial_scheduled'
      else if (data.verdict === 'approved') eventType = 'enrollment.presencial_approved'
      else if (data.verdict === 'rejected') eventType = 'enrollment.presencial_rejected'
      if (eventType) {
        eventBus.emitDomain({
          type: eventType,
          leadId: base.leadId,
          payload: {
            ...base.payload,
            score: exam.score, cutoff: exam.cutoffApplied,
            location: exam.location, scheduledAt: exam.scheduledAt,
            verdictReason: exam.verdictReason,
          },
          timestamp: new Date(),
        })
      }
      if (data.verdict === 'approved') {
        tryAutoAdvanceOnEvaluationComplete(regId, user.userId).catch(err =>
          req.log.warn(`[presencial-verdict] auto-advance: ${err.message}`)
        )
      }
    }

    return { ok: true, exam }
  })

  // ═════════════════════════════════════════════
  // REDAÇÃO — listagem + revisão humana
  // ═════════════════════════════════════════════

  app.get('/api/admin/essay-submissions', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const q = req.query as any
    const statusFilter = String(q.status || 'pending').toLowerCase()  // pending | approved | rejected | all
    const portalId = q.portalId ? parseInt(q.portalId) : null
    const search = String(q.q || '').trim()

    const where: any = {}
    if (statusFilter === 'pending') where.status = { in: ['submitted', 'ai_reviewing', 'needs_human'] }
    else if (statusFilter === 'approved') where.status = 'approved'
    else if (statusFilter === 'rejected') where.status = 'rejected'
    // 'all' → sem filtro

    if (portalId) where.registration = { portalId }
    if (search) {
      where.registration = {
        ...(where.registration || {}),
        OR: [
          { candidateCode: { contains: search } },
          { lead: { is: { nome: { contains: search } } } },
        ],
      }
    }

    const items = await prisma.essaySubmission.findMany({
      where,
      orderBy: { submittedAt: 'asc' },
      take: 200,
      select: {
        id: true, status: true, attemptNumber: true, wordCount: true,
        startedAt: true, expiresAt: true, submittedAt: true,
        aiScore: true, aiConfidence: true, aiProcessedAt: true,
        humanScore: true, reviewedBy: true, reviewedAt: true,
        finalScore: true, passed: true, cutoffApplied: true,
        pasteAttempts: true, visibilityChanges: true,
        registration: {
          select: {
            id: true, candidateCode: true,
            portal: { select: { id: true, nome: true } },
            lead: { select: { id: true, nome: true, email: true } },
            processRegistration: {
              select: {
                selectionProcess: { select: { id: true, nome: true, essayCutoff: true, essayMaxWords: true } },
                offering: { select: { nome: true, essayCutoff: true, course: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    })

    const kpiRows = await prisma.essaySubmission.findMany({ select: { status: true } })
    const kpi = { pending: 0, approved: 0, rejected: 0 }
    for (const k of kpiRows) {
      if (['submitted', 'ai_reviewing', 'needs_human'].includes(k.status)) kpi.pending++
      else if (k.status === 'approved') kpi.approved++
      else if (k.status === 'rejected') kpi.rejected++
    }

    return { items, total: items.length, kpi }
  })

  // GET /api/admin/essay-submissions/:id — detalhe completo (com texto da redação)
  app.get('/api/admin/essay-submissions/:id', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const item = await prisma.essaySubmission.findUnique({
      where: { id: parseInt(id) },
      include: {
        registration: {
          include: {
            lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
            portal: { select: { id: true, nome: true } },
            processRegistration: {
              include: {
                selectionProcess: { select: { id: true, nome: true, essayPrompt: true, essayCutoff: true, essayAiCriteria: true } },
                offering: { select: { nome: true, essayCutoff: true, course: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    })
    if (!item) return reply.code(404).send({ error: 'Redação não encontrada' })
    return { item }
  })

  // POST /api/admin/essay-submissions/:id/review
  // Body: { status: 'approved'|'rejected', humanScore?, humanNote? }
  app.post('/api/admin/essay-submissions/:id/review', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const newStatus = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : null
    if (!newStatus) return reply.code(400).send({ error: 'status deve ser approved ou rejected' })

    const sub = await prisma.essaySubmission.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, registrationId: true, aiScore: true,
        registration: {
          select: {
            processRegistration: {
              select: {
                selectionProcess: { select: { essayCutoff: true } },
                offering: { select: { essayCutoff: true } },
              },
            },
          },
        },
      },
    })
    if (!sub) return reply.code(404).send({ error: 'Redação não encontrada' })

    const toNum = (v: any) => v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)
    const humanScore = body.humanScore !== undefined ? toNum(body.humanScore) : null
    const finalScore = humanScore != null ? humanScore : sub.aiScore

    const offCutoff = sub.registration?.processRegistration?.offering?.essayCutoff ?? null
    const spCutoff = sub.registration?.processRegistration?.selectionProcess?.essayCutoff ?? null
    const cutoff = offCutoff != null ? offCutoff : spCutoff
    const passed = finalScore != null && cutoff != null ? finalScore >= cutoff : (newStatus === 'approved')

    if (newStatus === 'rejected' && !body.humanNote?.trim()) {
      return reply.code(400).send({ error: 'humanNote (motivo) é obrigatório ao rejeitar' })
    }

    // Consistência status ↔ passed: aprovação abaixo do corte (ou rejeição acima)
    // exige `forceOverride: true` + humanNote justificando — auditoria de exceção.
    const hasConflict =
      finalScore != null && cutoff != null && (
        (newStatus === 'approved' && finalScore < cutoff) ||
        (newStatus === 'rejected' && finalScore >= cutoff)
      )
    if (hasConflict && !body.forceOverride) {
      return reply.code(400).send({
        error: newStatus === 'approved'
          ? `Nota ${finalScore} está abaixo do corte ${cutoff}. Para aprovar mesmo assim envie forceOverride=true + humanNote justificando.`
          : `Nota ${finalScore} está acima do corte ${cutoff}. Para rejeitar mesmo assim envie forceOverride=true + humanNote justificando.`,
        code: 'cutoff_conflict',
        finalScore, cutoff,
      })
    }
    if (hasConflict && !body.humanNote?.trim()) {
      return reply.code(400).send({
        error: 'humanNote (motivo da exceção) é obrigatório quando forceOverride=true',
        code: 'override_requires_note',
      })
    }

    const updated = await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        status: newStatus,
        humanScore,
        humanNote: body.humanNote || null,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        finalScore,
        passed,
        cutoffApplied: cutoff,
      },
    })

    const base = await buildBaseEventPayload(sub.registrationId)
    if (base) {
      eventBus.emitDomain({
        type: newStatus === 'approved' ? 'enrollment.essay_approved' : 'enrollment.essay_rejected',
        leadId: base.leadId,
        payload: { ...base.payload, finalScore, passed, humanNote: updated.humanNote },
        timestamp: new Date(),
      })
      if (newStatus === 'approved') {
        tryAutoAdvanceOnEvaluationComplete(sub.registrationId, user.userId).catch(err =>
          req.log.warn(`[essay-review] auto-advance: ${err.message}`)
        )
      }
    }

    return { ok: true, submission: updated }
  })

  // ═════════════════════════════════════════════
  // REDAÇÃO — endpoints do CANDIDATO
  // (autenticação via JWT do candidato; reuso do helper existente)
  // ═════════════════════════════════════════════

  // Replica a lógica de candidatePortal.ts (token JWT-like custom). Mantemos
  // local pra evitar export cruzado entre rotas; se um dia o SECRET mudar,
  // basta atualizar nos dois lugares.
  async function requireCandidateLocal(req: any, reply: any): Promise<{ enrollmentId: number; candidateCode: string } | null> {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
    const crypto = await import('crypto')
    const { CANDIDATE_SECRET: SECRET } = await import('../lib/secrets.js')
    if (!auth || !auth.includes('.')) { reply.code(401).send({ error: 'Sessão inválida' }); return null }
    const [body, sig] = auth.split('.')
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
    if (sig !== expected) { reply.code(401).send({ error: 'Sessão inválida' }); return null }
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
      if (!payload || payload.exp < Date.now()) { reply.code(401).send({ error: 'Sessão expirada' }); return null }
      return { enrollmentId: payload.enrollmentId, candidateCode: payload.candidateCode }
    } catch { reply.code(401).send({ error: 'Sessão inválida' }); return null }
  }

  function countWords(s: string | null | undefined): number {
    if (!s) return 0
    return s.trim().split(/\s+/).filter(Boolean).length
  }

  // GET /api/candidate/essay — estado atual da redação do candidato.
  // Retorna config (tema, prazo, tentativas), última submissão, e se pode iniciar
  // nova tentativa. Usado pelo portal do candidato para renderizar a tela.
  app.get('/api/candidate/essay', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: s.enrollmentId },
      select: {
        id: true, candidateCode: true,
        processRegistration: {
          select: {
            selectionProcess: {
              select: {
                id: true, nome: true,
                essayPrompt: true, essayDurationMinutes: true, essayMaxAttempts: true,
                essayMinWords: true, essayMaxWords: true, essayPasteBlocked: true,
                essayCutoff: true, essayAiAutoApprove: true,
                entryMode: { select: { code: true, evaluationType: true } },
              },
            },
            offering: { select: { essayCutoff: true, course: { select: { nome: true } } } },
          },
        },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const sp = reg.processRegistration?.selectionProcess
    const evType = sp?.entryMode?.evaluationType
    if (evType !== 'exam_online') {
      return { eligible: false, reason: 'Esta inscrição não exige redação online.' }
    }

    // Tema sorteado é snapshotado em EssaySubmission.prompt no /start.
    // Aqui só precisamos saber se há ALGUM tema disponível (ativos ou legado).
    const topicCount = await prisma.essayTopic.count({
      where: { selectionProcessId: sp.id, active: true },
    })
    if (topicCount === 0 && !sp.essayPrompt) {
      return { eligible: false, reason: 'A redação ainda não foi configurada pela coordenação.' }
    }

    const submissions = await prisma.essaySubmission.findMany({
      where: { registrationId: reg.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, attemptNumber: true, status: true, wordCount: true,
        prompt: true,
        startedAt: true, expiresAt: true, submittedAt: true,
        finalScore: true, passed: true, humanNote: true, aiAnalysis: true,
      },
    })

    const last = submissions[0]
    const nextAttemptNumber = (submissions[0]?.attemptNumber || 0) + 1
    const attemptsUsed = submissions.filter(x => x.status !== 'draft').length
    const attemptsLeft = Math.max(0, (sp.essayMaxAttempts || 1) - attemptsUsed)
    const draftActive = last && last.status === 'draft' && (!last.expiresAt || new Date(last.expiresAt) > new Date())

    // Última submissão não-draft em revisão (IA processando ou aguardando humano).
    // Nesse estado o candidato NÃO pode iniciar nova tentativa — precisa aguardar
    // veredito antes de tentar de novo. Reativa só após rejected/expired.
    const pendingReview = submissions.find(s => s.status === 'ai_reviewing' || s.status === 'needs_human') || null

    return {
      eligible: true,
      config: {
        // Sem prompt fixo aqui — o tema é sorteado no /start e snapshot fica em
        // EssaySubmission.prompt. O frontend deve ler o prompt da última submissão
        // (draft ativo ou submitted) ao invés deste campo.
        hasMultipleTopics: topicCount > 1,
        topicCount,
        durationMinutes: sp.essayDurationMinutes,
        maxAttempts: sp.essayMaxAttempts,
        minWords: sp.essayMinWords,
        maxWords: sp.essayMaxWords,
        pasteBlocked: sp.essayPasteBlocked,
        cutoff: reg.processRegistration?.offering?.essayCutoff ?? sp.essayCutoff,
        aiAutoApprove: sp.essayAiAutoApprove === true,
      },
      submissions,
      attemptsUsed,
      attemptsLeft,
      canStart: !draftActive && !pendingReview && attemptsLeft > 0,
      activeDraft: draftActive ? last : null,
      pendingReview,
      finalResult: submissions.find(s => s.status === 'approved' || s.status === 'rejected') || null,
    }
  })

  // POST /api/candidate/essay/start — inicia nova tentativa (cria draft com timer).
  // Sorteia um EssayTopic ativo da SP. Se a SP não tiver nenhum tema cadastrado,
  // usa o legado SelectionProcess.essayPrompt como fallback.
  app.post('/api/candidate/essay/start', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: s.enrollmentId },
      select: {
        id: true,
        processRegistration: {
          select: {
            selectionProcess: {
              select: {
                id: true,
                essayPrompt: true, essayDurationMinutes: true, essayMaxAttempts: true,
                entryMode: { select: { evaluationType: true } },
              },
            },
          },
        },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const sp = reg.processRegistration?.selectionProcess
    if (sp?.entryMode?.evaluationType !== 'exam_online') {
      return reply.code(400).send({ error: 'Redação não disponível para esta inscrição' })
    }

    // Sorteio de tema: prioriza EssayTopic; cai para essayPrompt legado se não houver nenhum.
    const activeTopics = await prisma.essayTopic.findMany({
      where: { selectionProcessId: sp.id, active: true },
      select: { id: true, prompt: true, supportTexts: true, title: true },
    })
    let promptText: string | null = null
    if (activeTopics.length > 0) {
      const picked = activeTopics[Math.floor(Math.random() * activeTopics.length)]
      const intro = picked.title ? `${picked.title}\n\n` : ''
      const support = picked.supportTexts ? `\n\n---\n${picked.supportTexts}` : ''
      promptText = `${intro}${picked.prompt}${support}`
    } else if (sp.essayPrompt) {
      promptText = sp.essayPrompt
    }
    if (!promptText) {
      return reply.code(400).send({ error: 'Redação não disponível — nenhum tema configurado' })
    }

    const subs = await prisma.essaySubmission.findMany({
      where: { registrationId: reg.id }, orderBy: { createdAt: 'desc' },
    })
    const draft = subs[0]?.status === 'draft' && (!subs[0].expiresAt || new Date(subs[0].expiresAt) > new Date()) ? subs[0] : null
    if (draft) return { ok: true, submission: draft, resumed: true }

    // Se há submissão ainda em revisão (IA processando ou aguardando humano),
    // não deixa iniciar nova tentativa — só após veredito (rejected/approved/expired).
    const inReview = subs.find(s => s.status === 'ai_reviewing' || s.status === 'needs_human')
    if (inReview) {
      return reply.code(400).send({ error: 'Sua redação anterior ainda está sendo avaliada. Aguarde o resultado para iniciar uma nova tentativa.' })
    }

    const used = subs.filter(x => x.status !== 'draft').length
    if (used >= (sp.essayMaxAttempts || 1)) {
      return reply.code(400).send({ error: 'Tentativas esgotadas' })
    }

    const startedAt = new Date()
    const expiresAt = sp.essayDurationMinutes ? new Date(startedAt.getTime() + sp.essayDurationMinutes * 60_000) : null

    const created = await prisma.essaySubmission.create({
      data: {
        registrationId: reg.id,
        prompt: promptText,
        attemptNumber: used + 1,
        status: 'draft',
        startedAt,
        expiresAt,
        essayText: '',
        wordCount: 0,
      },
    })
    return { ok: true, submission: created, resumed: false }
  })

  // PUT /api/candidate/essay/:id/draft — auto-save do texto (não submete).
  // Body: { essayText, pasteAttempts?, visibilityChanges? }
  app.put('/api/candidate/essay/:id/draft', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const sub = await prisma.essaySubmission.findUnique({ where: { id: parseInt(id) } })
    if (!sub || sub.registrationId !== s.enrollmentId) return reply.code(404).send({ error: 'Redação não encontrada' })
    if (sub.status !== 'draft') return reply.code(400).send({ error: 'Redação já foi submetida' })
    if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
      // Auto-marca como expirada
      await prisma.essaySubmission.update({
        where: { id: sub.id },
        data: { status: 'expired' },
      })
      return reply.code(400).send({ error: 'Tempo expirado' })
    }

    const text = String(body.essayText || '').slice(0, 200_000)  // limite duro
    const wc = countWords(text)
    const updated = await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        essayText: text,
        wordCount: wc,
        pasteAttempts: typeof body.pasteAttempts === 'number' ? body.pasteAttempts : sub.pasteAttempts,
        visibilityChanges: typeof body.visibilityChanges === 'number' ? body.visibilityChanges : sub.visibilityChanges,
      },
    })
    return { ok: true, wordCount: wc, expiresAt: updated.expiresAt }
  })

  // GET /api/candidate/presencial-exam — agenda e resultado da prova presencial.
  app.get('/api/candidate/presencial-exam', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return
    const exam = await prisma.presencialExam.findFirst({
      where: { registrationId: s.enrollmentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, scheduledAt: true, location: true, room: true, seatNumber: true,
        attendanceStatus: true, score: true, maxScore: true, examNote: true,
        verdict: true, verdictAt: true, verdictReason: true, passed: true, cutoffApplied: true,
      },
    })
    return { exam }
  })

  // POST /api/candidate/essay/:id/submit — finaliza, valida, dispara IA opcional.
  app.post('/api/candidate/essay/:id/submit', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return
    const { id } = req.params as any
    const body = (req.body as any) || {}

    const sub = await prisma.essaySubmission.findUnique({
      where: { id: parseInt(id) },
      include: {
        registration: {
          select: {
            processRegistration: {
              select: {
                selectionProcess: {
                  select: {
                    essayMinWords: true, essayMaxWords: true,
                    essayAiEnabled: true, essayCutoff: true, essayAiCriteria: true,
                  },
                },
                offering: { select: { essayCutoff: true } },
              },
            },
          },
        },
      },
    })
    if (!sub || sub.registrationId !== s.enrollmentId) return reply.code(404).send({ error: 'Redação não encontrada' })
    if (sub.status !== 'draft') return reply.code(400).send({ error: 'Redação já foi submetida' })

    const sp = sub.registration?.processRegistration?.selectionProcess
    const finalText = String(body.essayText ?? sub.essayText ?? '').trim().slice(0, 200_000)
    const wc = countWords(finalText)

    if (sp?.essayMinWords && wc < sp.essayMinWords) {
      return reply.code(400).send({ error: `Mínimo de ${sp.essayMinWords} palavras (atual: ${wc})` })
    }
    if (sp?.essayMaxWords && wc > sp.essayMaxWords) {
      return reply.code(400).send({ error: `Máximo de ${sp.essayMaxWords} palavras (atual: ${wc})` })
    }

    const now = new Date()
    const aiEnabled = sp?.essayAiEnabled !== false

    const updated = await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        essayText: finalText,
        wordCount: wc,
        status: aiEnabled ? 'ai_reviewing' : 'needs_human',
        submittedAt: now,
        pasteAttempts: typeof body.pasteAttempts === 'number' ? body.pasteAttempts : sub.pasteAttempts,
        visibilityChanges: typeof body.visibilityChanges === 'number' ? body.visibilityChanges : sub.visibilityChanges,
      },
    })

    // Evento + enfileira correção IA
    const base = await buildBaseEventPayload(sub.registrationId)
    if (base) {
      eventBus.emitDomain({
        type: 'enrollment.essay_submitted',
        leadId: base.leadId,
        payload: { ...base.payload, submissionId: updated.id, wordCount: wc },
        timestamp: new Date(),
      })
    }

    if (aiEnabled) {
      const { queues } = await import('../lib/queues.js')
      queues.essayCorrection.add('correct', { submissionId: updated.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
      }).catch((err: any) => req.log.warn(`[essay-submit] enqueue: ${err.message}`))
    }

    return { ok: true, submission: updated }
  })
}
