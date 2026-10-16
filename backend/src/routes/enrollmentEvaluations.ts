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
import { aplicarNotaDeAvaliacao } from '../services/portalClassificacao.js'
import { eventBus } from '../lib/eventBus.js'
import { validateEnemImport } from '../services/enemClassification.js'
import { lerPolitica, somarTelemetria } from '../lib/integridadeRedacao.js'
import { verifyCandidateToken, signCandidateToken, ondeDoToken } from '../lib/candidateAuth.js'
import {
  computeEvaluationStatus,
  tryAutoAdvanceOnEvaluationComplete,
  type EvaluationStatus,
} from '../services/enrollmentEvaluationGateway.js'

// Re-exports preservam callers que importavam destas rotas (compat).
export { computeEvaluationStatus, tryAutoAdvanceOnEvaluationComplete }

/** O que o candidato pode ver da própria tentativa: integridade e telemetria
 *  são laudo interno da coordenação (lib/integridadeRedacao.ts). */
function paraCandidato<T extends Record<string, any>>(sub: T): Omit<T, 'integrity' | 'integrityStatus' | 'aiAuthorshipPct' | 'typingTelemetry' | 'integrityDecision' | 'integrityNote' | 'integrityReviewedBy' | 'integrityReviewedAt' | 'retakeReleasedBy' | 'retakeReleasedNote'> {
  const { integrity: _a, integrityStatus: _b, aiAuthorshipPct: _c, typingTelemetry: _d, integrityDecision: _e, integrityNote: _f, integrityReviewedBy: _g, integrityReviewedAt: _h, retakeReleasedBy: _i, retakeReleasedNote: _j, ...resto } = sub as any
  return resto
}

/** Sessão do candidato vencida há até isto ainda salva e envia a redação: o
 *  token dura 1h e quem escrevia por mais tempo perdia o texto em 401. */
const TOLERANCIA_SESSAO_REDACAO_MS = 12 * 3600_000
/** Folga depois do fim do cronômetro para o envio chegar (rede lenta, aba suspensa). */
const FOLGA_ENVIO_MS = 5 * 60_000
/** Tentativas que contam no limite: rascunho em andamento não conta. */
const contaComoTentativa = (status: string) => status !== 'draft'

export type { EvaluationStatus }

// ───────────────────────────────────────────────────────────
// Auth helper (admin/manager)
// ───────────────────────────────────────────────────────────

async function autenticar(req: any, reply: any): Promise<any | null> {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) { reply.code(401).send({ error: 'Token não fornecido' }); return null }
  const { verifyToken } = await import('../lib/auth.js')
  try {
    return verifyToken(token)
  } catch {
    reply.code(401).send({ error: 'Token inválido' })
    return null
  }
}

/**
 * Leitura das filas. Com o Educacional ligado, quem decide é a permissão da
 * TELA (Revisão de documentos / Avaliações — lib/eduTelas.ts); desligado,
 * vale o papel de antes: admin e gerente.
 */
async function requireAdmin(req: any, reply: any): Promise<any | null> {
  const user = await autenticar(req, reply)
  if (!user) return null
  const { verificarTela } = await import('../lib/eduTelas.js')
  const r = await verificarTela(user, req.method, req.url, 'gestao')
  if (r) { reply.code(r.status).send(r.body); return null }
  return user
}

/**
 * Aprovar documento, validar nota do ENEM, corrigir redação: decide a entrada
 * de um aluno. É "Editar" na tela — liberado por pessoa ou papel na tela de
 * Permissões. Sem o módulo, só ADMIN e SUPERADMIN, como antes.
 */
async function requireAdminWrite(req: any, reply: any): Promise<any | null> {
  const user = await autenticar(req, reply)
  if (!user) return null
  const { verificarTela } = await import('../lib/eduTelas.js')
  const r = await verificarTela(user, req.method, req.url, 'admin')
  if (r) { reply.code(r.status).send(r.body); return null }
  return user
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
    const user = await requireAdminWrite(req, reply); if (!user) return
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
    const user = await requireAdminWrite(req, reply); if (!user) return
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
    const user = await requireAdminWrite(req, reply); if (!user) return
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

    // A nota da prova sobe para a inscrição do processo seletivo — é ela que a
    // classificação ordena. Antes da Fase 4 parava aqui, e o candidato ficava
    // com prova corrigida e sem nota na classificação.
    if (exam.score != null || data.verdict === 'approved' || data.verdict === 'rejected') {
      await aplicarNotaDeAvaliacao({
        enrollmentRegistrationId: regId,
        nota: exam.score ?? null,
        aprovado: exam.verdict === 'approved' ? true : exam.verdict === 'rejected' ? false : null,
        origem: 'Prova presencial',
        ator: user.name || 'Operador',
        atorId: user.userId,
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
    // Em andamento ou encerradas sem envio — onde aparece quem travou.
    else if (statusFilter === 'andamento') where.status = { in: ['draft', 'expired'] }
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
    // Integridade: suspeita | atencao | alertas (as duas) | ok
    const integ = String(q.integridade || '')
    if (integ === 'alertas') where.integrityStatus = { in: ['suspeita', 'atencao'] }
    else if (['suspeita', 'atencao', 'ok', 'indisponivel'].includes(integ)) where.integrityStatus = integ

    const items = await prisma.essaySubmission.findMany({
      where,
      orderBy: statusFilter === 'andamento' ? { startedAt: 'desc' } : { submittedAt: 'asc' },
      take: 200,
      select: {
        id: true, status: true, attemptNumber: true, wordCount: true, updatedAt: true, retakeReleasedAt: true,
        startedAt: true, expiresAt: true, submittedAt: true,
        aiScore: true, aiConfidence: true, aiProcessedAt: true,
        humanScore: true, reviewedBy: true, reviewedAt: true,
        finalScore: true, passed: true, cutoffApplied: true,
        pasteAttempts: true, visibilityChanges: true,
        aiAuthorshipPct: true, integrityStatus: true, integrityDecision: true,
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

    const kpiRows = await prisma.essaySubmission.findMany({ select: { status: true, integrityStatus: true, integrityDecision: true } })
    const kpi = { pending: 0, approved: 0, rejected: 0, suspeitas: 0, andamento: 0 }
    for (const k of kpiRows) {
      // Suspeita que ninguém avaliou ainda — é a fila de integridade.
      if (k.integrityStatus === 'suspeita' && !k.integrityDecision) kpi.suspeitas++
      if (['submitted', 'ai_reviewing', 'needs_human'].includes(k.status)) kpi.pending++
      else if (k.status === 'approved') kpi.approved++
      else if (k.status === 'rejected') kpi.rejected++
      else if (k.status === 'draft' || k.status === 'expired') kpi.andamento++
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
                selectionProcess: { select: { id: true, nome: true, essayPrompt: true, essayCutoff: true, essayAiCriteria: true, essayIntegrity: true } },
                offering: { select: { nome: true, essayCutoff: true, course: { select: { nome: true } } } },
              },
            },
          },
        },
      },
    })
    if (!item) return reply.code(404).send({ error: 'Redação não encontrada' })
    const ultima = await prisma.essaySubmission.findFirst({
      where: { registrationId: item.registrationId }, orderBy: { createdAt: 'desc' }, select: { id: true },
    })
    const liberadoPor = item.retakeReleasedBy
      ? (await prisma.user.findUnique({ where: { id: item.retakeReleasedBy }, select: { name: true } }))?.name ?? null
      : null
    return { item: { ...item, ultimaDaInscricao: ultima?.id === item.id, retakeReleasedByName: liberadoPor } }
  })

  // POST /api/admin/essay-submissions/:id/integridade/decisao
  // O avaliador confirma ou descarta a suspeita de integridade. Fica gravado
  // quem decidiu e por quê — ferramenta de detecção dá indício, a decisão é
  // humana e precisa ser auditável. Body: { decisao: 'confirmada'|'descartada', nota }
  app.post('/api/admin/essay-submissions/:id/integridade/decisao', async (req, reply) => {
    const user = await requireAdminWrite(req, reply); if (!user) return
    const id = parseInt((req.params as any).id)
    const body = (req.body as any) || {}
    const decisao = body.decisao === 'confirmada' || body.decisao === 'descartada' ? body.decisao : body.decisao === null ? null : undefined
    if (decisao === undefined) return reply.code(400).send({ error: 'decisao deve ser "confirmada", "descartada" ou null' })
    const nota = String(body.nota ?? '').trim()
    if (decisao && nota.length < 10) return reply.code(400).send({ error: 'Explique a decisão (mínimo de 10 caracteres) — ela fica no histórico da redação.' })
    const sub = await prisma.essaySubmission.findUnique({ where: { id }, select: { id: true } })
    if (!sub) return reply.code(404).send({ error: 'Redação não encontrada' })
    const item = await prisma.essaySubmission.update({
      where: { id },
      data: { integrityDecision: decisao, integrityNote: decisao ? nota : null, integrityReviewedBy: decisao ? user.userId : null, integrityReviewedAt: decisao ? new Date() : null },
      select: { id: true, integrityDecision: true, integrityNote: true, integrityReviewedBy: true, integrityReviewedAt: true },
    })
    return { ok: true, item }
  })

  // POST /api/admin/essay-submissions/:id/integridade/reanalisar
  // Roda de novo a análise de integridade (ex.: depois de mudar o limite ou
  // quando o detector estava indisponível). Não mexe na nota nem no status.
  app.post('/api/admin/essay-submissions/:id/integridade/reanalisar', async (req, reply) => {
    const user = await requireAdminWrite(req, reply); if (!user) return
    const id = parseInt((req.params as any).id)
    const sub = await prisma.essaySubmission.findUnique({ where: { id }, select: { id: true, essayText: true, status: true } })
    if (!sub) return reply.code(404).send({ error: 'Redação não encontrada' })
    if (sub.status === 'draft' || !sub.essayText) return reply.code(400).send({ error: 'Redação ainda não enviada.' })
    const { analisarIntegridade } = await import('../services/aiEssayReview.js')
    const integridade = await analisarIntegridade(id)
    return { ok: true, integridade }
  })

  // POST /api/admin/essay-submissions/:id/review
  // Body: { status: 'approved'|'rejected', humanScore?, humanNote? }
  app.post('/api/admin/essay-submissions/:id/review', async (req, reply) => {
    const user = await requireAdminWrite(req, reply); if (!user) return
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

    // Mesma razão da prova presencial: sem isto, a nota da redação nunca chegava
    // à classificação e o candidato aparecia como "ainda sem nota".
    await aplicarNotaDeAvaliacao({
      enrollmentRegistrationId: sub.registrationId,
      nota: finalScore ?? null,
      aprovado: newStatus === 'approved' ? true : newStatus === 'rejected' ? false : null,
      origem: 'Redação online',
      ator: user.name || 'Operador',
      atorId: user.userId,
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

  // POST /api/admin/essay-submissions/:id/nova-tentativa
  // Libera uma nova tentativa para o candidato, quantas vezes for preciso —
  // reprovou, ou a tentativa travou (sessão caiu, tempo acabou, não enviou).
  // Body: { motivo } (obrigatório, fica na tentativa e no histórico da inscrição).
  //   - em correção (needs_human/ai_reviewing): é reprovada nesta mesma ação;
  //   - rascunho (draft): é encerrada como 'expired', com o texto guardado;
  //   - reprovada/expirada: só libera.
  // Não aprova nada, não envia mensagem: emite enrollment.essay_retake_released
  // para quem quiser montar o aviso em Fluxos.
  app.post('/api/admin/essay-submissions/:id/nova-tentativa', async (req, reply) => {
    const user = await requireAdminWrite(req, reply); if (!user) return
    const id = parseInt((req.params as any).id)
    const body = (req.body as any) || {}
    const motivo = String(body.motivo ?? '').trim()
    if (motivo.length < 10) return reply.code(400).send({ error: 'Explique o motivo (mínimo de 10 caracteres) — fica no histórico da inscrição.' })

    const sub = await prisma.essaySubmission.findUnique({
      where: { id },
      select: {
        id: true, registrationId: true, status: true, attemptNumber: true, aiScore: true, humanScore: true, finalScore: true, submittedAt: true,
        registration: {
          select: {
            essayAttemptsGranted: true,
            processRegistrationId: true,
            processRegistration: {
              select: {
                status: true,
                selectionProcess: { select: { essayMaxAttempts: true, essayCutoff: true } },
                offering: { select: { essayCutoff: true } },
              },
            },
          },
        },
      },
    })
    if (!sub) return reply.code(404).send({ error: 'Redação não encontrada' })
    const ultima = await prisma.essaySubmission.findFirst({ where: { registrationId: sub.registrationId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (ultima?.id !== sub.id) return reply.code(400).send({ error: 'Já existe uma tentativa mais recente desta inscrição — abra a última.' })
    if (sub.status === 'approved') return reply.code(400).send({ error: 'Esta redação já está aprovada.' })
    // A correção por IA grava o status quando termina; liberar no meio dela
    // seria sobrescrito. Passados 10 min, a correção travou e pode liberar.
    if (sub.status === 'ai_reviewing' && sub.submittedAt && Date.now() - new Date(sub.submittedAt).getTime() < 10 * 60_000) {
      return reply.code(409).send({ error: 'A IA ainda está corrigindo esta redação. Aguarde um minuto e tente de novo.' })
    }

    const agora = new Date()
    const pr = sub.registration.processRegistration
    const cutoff = pr?.offering?.essayCutoff ?? pr?.selectionProcess?.essayCutoff ?? null
    const operador = user.name || 'Operador'

    // Encerra a tentativa atual conforme o estado em que está.
    const encerrar: Record<string, unknown> = { retakeReleasedBy: user.userId, retakeReleasedAt: agora, retakeReleasedNote: motivo }
    if (['needs_human', 'ai_reviewing', 'submitted'].includes(sub.status)) {
      const finalScore = sub.humanScore ?? sub.aiScore
      Object.assign(encerrar, {
        status: 'rejected', passed: false, finalScore, cutoffApplied: cutoff,
        humanNote: motivo, reviewedBy: user.userId, reviewedAt: agora,
      })
    } else if (sub.status === 'draft') {
      Object.assign(encerrar, { status: 'expired' })
    }

    // Garante exatamente 1 tentativa disponível (clicar duas vezes não dá duas).
    const usadas = await prisma.essaySubmission.count({ where: { registrationId: sub.registrationId, status: { not: 'draft' } } })
    const usadasDepois = usadas + (sub.status === 'draft' ? 1 : 0)
    const base = sub.registration.processRegistration?.selectionProcess?.essayMaxAttempts || 1
    const concedidas = Math.max(sub.registration.essayAttemptsGranted || 0, usadasDepois + 1 - base)

    await prisma.$transaction([
      prisma.essaySubmission.update({ where: { id: sub.id }, data: encerrar }),
      prisma.enrollmentRegistration.update({ where: { id: sub.registrationId }, data: { essayAttemptsGranted: concedidas } }),
    ])

    // A reprovação desta tentativa não é a palavra final: se a inscrição no
    // processo ficou 'reprovado' por causa dela, volta ao status anterior.
    if (sub.registration.processRegistrationId && pr?.status === 'reprovado') {
      const ult = await prisma.processRegistrationStatusLog.findFirst({
        where: { registrationId: sub.registration.processRegistrationId, toStatus: 'reprovado', NOT: { fromStatus: 'reprovado' } },
        orderBy: { createdAt: 'desc' }, select: { fromStatus: true },
      })
      const volta = ult?.fromStatus && ult.fromStatus !== 'reprovado' ? ult.fromStatus : 'inscrito'
      const r = await prisma.processRegistration.updateMany({
        where: { id: sub.registration.processRegistrationId, status: 'reprovado' },
        data: { status: volta },
      })
      if (r.count > 0) {
        await prisma.processRegistrationStatusLog.create({
          data: {
            registrationId: sub.registration.processRegistrationId, fromStatus: 'reprovado', toStatus: volta,
            actorId: user.userId, actorName: operador,
            observacao: `Redação: nova tentativa liberada (tentativa ${sub.attemptNumber + 1}). ${motivo}`,
          },
        }).catch(() => {})
      }
    } else if (sub.registration.processRegistrationId && pr) {
      await prisma.processRegistrationStatusLog.create({
        data: {
          registrationId: sub.registration.processRegistrationId, fromStatus: pr.status, toStatus: pr.status,
          actorId: user.userId, actorName: operador,
          observacao: `Redação: nova tentativa liberada (tentativa ${sub.attemptNumber + 1}). ${motivo}`,
        },
      }).catch(() => {})
    }

    const ev = await buildBaseEventPayload(sub.registrationId)
    if (ev) {
      eventBus.emitDomain({
        type: 'enrollment.essay_retake_released',
        leadId: ev.leadId,
        payload: { ...ev.payload, submissionId: sub.id, proximaTentativa: sub.attemptNumber + 1, motivo },
        timestamp: agora,
      })
    }

    return { ok: true, proximaTentativa: sub.attemptNumber + 1, tentativasConcedidas: concedidas }
  })

  // ═════════════════════════════════════════════
  // REDAÇÃO — endpoints do CANDIDATO
  // (autenticação via JWT do candidato; reuso do helper existente)
  // ═════════════════════════════════════════════

  // Sessão deslizante: toda chamada da redação devolve um token novo em
  // X-Candidate-Token (o portal troca sozinho), então quem está escrevendo não
  // perde a sessão no meio. `toleranciaMs` só no salvar/enviar.
  async function requireCandidateLocal(req: any, reply: any, opts: { toleranciaMs?: number } = {}): Promise<{ enrollmentId: number; candidateCode: string; onde: 'inscricao' | 'painel' } | null> {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
    const payload = verifyCandidateToken(auth, opts)
    if (!payload) {
      reply.code(401).send({ error: 'Sua sessão expirou. Entre de novo no portal para continuar.', sessaoExpirada: true })
      return null
    }
    const onde = ondeDoToken(payload)
    reply.header('X-Candidate-Token', signCandidateToken(payload.enrollmentId, payload.candidateCode, undefined, onde))
    return { enrollmentId: payload.enrollmentId, candidateCode: payload.candidateCode, onde }
  }

  function countWords(s: string | null | undefined): number {
    if (!s) return 0
    return s.trim().split(/\s+/).filter(Boolean).length
  }

  /**
   * Entrega a tentativa: grava o texto final, manda para a correção (IA ou
   * humano) e emite o evento. Usada pelo botão Enviar e quando o cronômetro
   * acaba com texto escrito — o que foi escrito até o fim do tempo é entregue.
   */
  async function entregarTentativa(
    sub: { id: number; registrationId: number; pasteAttempts: number; visibilityChanges: number; typingTelemetry: unknown },
    texto: string,
    aiEnabled: boolean,
    body: any,
    quando: Date,
    log: { warn: (m: string) => void },
  ) {
    const wc = countWords(texto)
    // updateMany com status: 'draft' — dois envios simultâneos (duplo clique,
    // envio automático do cronômetro + botão) não entregam duas vezes.
    const r = await prisma.essaySubmission.updateMany({
      where: { id: sub.id, status: 'draft' },
      data: {
        essayText: texto,
        wordCount: wc,
        status: aiEnabled ? 'ai_reviewing' : 'needs_human',
        submittedAt: quando,
        // Nunca diminui: recarregar a página zera o contador do navegador, e
        // gravar o valor recebido apagava o histórico de colagens.
        pasteAttempts: typeof body?.pasteAttempts === 'number' ? Math.max(sub.pasteAttempts, body.pasteAttempts) : sub.pasteAttempts,
        visibilityChanges: typeof body?.visibilityChanges === 'number' ? Math.max(sub.visibilityChanges, body.visibilityChanges) : sub.visibilityChanges,
        ...(body?.telemetria ? { typingTelemetry: somarTelemetria(sub.typingTelemetry, body.telemetria) as any } : {}),
      },
    })
    if (r.count === 0) return null

    // Evento + enfileira correção IA
    const base = await buildBaseEventPayload(sub.registrationId)
    if (base) {
      eventBus.emitDomain({
        type: 'enrollment.essay_submitted',
        leadId: base.leadId,
        payload: { ...base.payload, submissionId: sub.id, wordCount: wc },
        timestamp: new Date(),
      })
    }
    if (aiEnabled) {
      const { queues } = await import('../lib/queues.js')
      queues.essayCorrection.add('correct', { submissionId: sub.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
      }).catch((err: any) => log.warn(`[essay-submit] enqueue: ${err.message}`))
    }
    return prisma.essaySubmission.findUnique({ where: { id: sub.id } })
  }

  /**
   * Rascunho cujo cronômetro acabou (com a folga) e que ninguém enviou — aba
   * fechada, bateria, internet. Com texto, é entregue como estava no último
   * salvamento; vazio, vira 'expired'. Antes ficava 'draft' para sempre e o
   * candidato via "Não há tentativas disponíveis".
   */
  async function fecharRascunhoVencido(registrationId: number, log: { warn: (m: string) => void }) {
    const limite = new Date(Date.now() - FOLGA_ENVIO_MS)
    const vencidos = await prisma.essaySubmission.findMany({
      where: { registrationId, status: 'draft', expiresAt: { lt: limite } },
      include: { registration: { select: { processRegistration: { select: { selectionProcess: { select: { essayAiEnabled: true } } } } } } },
    })
    for (const v of vencidos) {
      const texto = String(v.essayText ?? '').trim()
      if (countWords(texto) === 0) {
        await prisma.essaySubmission.updateMany({ where: { id: v.id, status: 'draft' }, data: { status: 'expired' } })
        continue
      }
      const aiEnabled = v.registration?.processRegistration?.selectionProcess?.essayAiEnabled !== false
      await entregarTentativa(v, texto, aiEnabled, null, v.expiresAt ?? new Date(), log)
    }
  }

  // GET /api/candidate/essay — estado atual da redação do candidato.
  // Retorna config (tema, prazo, tentativas), última submissão, e se pode iniciar
  // nova tentativa. Usado pelo portal do candidato para renderizar a tela.
  app.get('/api/candidate/essay', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply); if (!s) return

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: s.enrollmentId },
      select: {
        id: true, candidateCode: true, essayAttemptsGranted: true,
        processRegistration: {
          select: {
            selectionProcess: {
              select: {
                id: true, nome: true,
                essayPrompt: true, essayDurationMinutes: true, essayMaxAttempts: true,
                essayMinWords: true, essayMaxWords: true, essayPasteBlocked: true, essayIntegrity: true,
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
    // Sem processo seletivo não há redação a exigir — e é este mesmo teste que
    // garante ao compilador que `sp` existe daqui para baixo.
    if (!sp || sp.entryMode?.evaluationType !== 'exam_online') {
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

    await fecharRascunhoVencido(reg.id, req.log)

    const submissions = await prisma.essaySubmission.findMany({
      where: { registrationId: reg.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, attemptNumber: true, status: true, wordCount: true,
        prompt: true,
        startedAt: true, expiresAt: true, submittedAt: true,
        finalScore: true, passed: true, humanNote: true, aiAnalysis: true,
        retakeReleasedAt: true,
      },
    })

    const last = submissions[0]
    const maxAttempts = (sp.essayMaxAttempts || 1) + (reg.essayAttemptsGranted || 0)
    const attemptsUsed = submissions.filter(x => contaComoTentativa(x.status)).length
    const attemptsLeft = Math.max(0, maxAttempts - attemptsUsed)
    const draftActive = last && last.status === 'draft' && (!last.expiresAt || new Date(last.expiresAt).getTime() + FOLGA_ENVIO_MS > Date.now())

    // Última submissão não-draft em revisão (IA processando ou aguardando humano).
    // Nesse estado o candidato NÃO pode iniciar nova tentativa — precisa aguardar
    // veredito antes de tentar de novo. Reativa só após rejected/expired.
    const pendingReview = submissions.find(s => s.status === 'ai_reviewing' || s.status === 'needs_human') || null
    const approved = submissions.find(s => s.status === 'approved') || null

    return {
      eligible: true,
      config: {
        // Sem prompt fixo aqui — o tema é sorteado no /start e snapshot fica em
        // EssaySubmission.prompt. O frontend deve ler o prompt da última submissão
        // (draft ativo ou submitted) ao invés deste campo.
        hasMultipleTopics: topicCount > 1,
        topicCount,
        durationMinutes: sp.essayDurationMinutes,
        maxAttempts,
        minWords: sp.essayMinWords,
        maxWords: sp.essayMaxWords,
        pasteBlocked: sp.essayPasteBlocked,
        // Proteções do editor vindas da política de integridade.
        dragBlocked: lerPolitica(sp.essayIntegrity).bloquearArrastar,
        spellcheckOff: lerPolitica(sp.essayIntegrity).bloquearCorretorNavegador,
        cutoff: reg.processRegistration?.offering?.essayCutoff ?? sp.essayCutoff,
        aiAutoApprove: sp.essayAiAutoApprove === true,
      },
      submissions,
      attemptsUsed,
      attemptsLeft,
      canStart: !draftActive && !pendingReview && !approved && attemptsLeft > 0,
      activeDraft: draftActive ? last : null,
      pendingReview,
      // A última tentativa decidida — é ela que o candidato vê (a reprovada
      // anterior não aparece mais depois de aprovar na seguinte).
      finalResult: approved || submissions.find(s => s.status === 'rejected' || s.status === 'expired') || null,
      // A coordenação liberou nova tentativa depois da última decisão.
      retakeReleased: !!last?.retakeReleasedAt && attemptsLeft > 0 && !draftActive && !pendingReview && !approved,
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
        id: true, essayAttemptsGranted: true,
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
    {
      const trava = await (await import('../services/portalJornada.js')).bloqueioDaEtapa(s.enrollmentId, 'prova', s.onde)
      if (trava) return reply.code(409).send({ error: trava, travada: true })
    }

    await fecharRascunhoVencido(reg.id, req.log)
    const subs = await prisma.essaySubmission.findMany({
      where: { registrationId: reg.id }, orderBy: { createdAt: 'desc' },
    })
    const draft = subs[0]?.status === 'draft' && (!subs[0].expiresAt || new Date(subs[0].expiresAt).getTime() + FOLGA_ENVIO_MS > Date.now()) ? subs[0] : null
    if (draft) return { ok: true, submission: paraCandidato(draft), resumed: true }

    // Se há submissão ainda em revisão (IA processando ou aguardando humano),
    // não deixa iniciar nova tentativa — só após veredito (rejected/approved/expired).
    const inReview = subs.find(s => s.status === 'ai_reviewing' || s.status === 'needs_human')
    if (inReview) {
      return reply.code(400).send({ error: 'Sua redação anterior ainda está sendo avaliada. Aguarde o resultado para iniciar uma nova tentativa.' })
    }
    if (subs.some(s => s.status === 'approved')) {
      return reply.code(400).send({ error: 'Sua redação já foi aprovada.' })
    }

    const used = subs.filter(x => contaComoTentativa(x.status)).length
    if (used >= (sp.essayMaxAttempts || 1) + (reg.essayAttemptsGranted || 0)) {
      return reply.code(400).send({ error: 'Tentativas esgotadas' })
    }

    // Sorteio de tema: prioriza EssayTopic; cai para essayPrompt legado se não houver nenhum.
    // Em nova tentativa, evita repetir um tema que a pessoa já recebeu.
    const activeTopics = await prisma.essayTopic.findMany({
      where: { selectionProcessId: sp.id, active: true },
      select: { id: true, prompt: true, supportTexts: true, title: true },
    })
    const montar = (t: { prompt: string; supportTexts: string | null; title: string | null }) => {
      const intro = t.title ? `${t.title}\n\n` : ''
      const support = t.supportTexts ? `\n\n---\n${t.supportTexts}` : ''
      return `${intro}${t.prompt}${support}`
    }
    let promptText: string | null = null
    if (activeTopics.length > 0) {
      const jaRecebidos = new Set(subs.map(x => x.prompt).filter(Boolean))
      const ineditos = activeTopics.filter(t => !jaRecebidos.has(montar(t)))
      const pool = ineditos.length > 0 ? ineditos : activeTopics
      promptText = montar(pool[Math.floor(Math.random() * pool.length)])
    } else if (sp.essayPrompt) {
      promptText = sp.essayPrompt
    }
    if (!promptText) {
      return reply.code(400).send({ error: 'Redação não disponível — nenhum tema configurado' })
    }

    const startedAt = new Date()
    const expiresAt = sp.essayDurationMinutes ? new Date(startedAt.getTime() + sp.essayDurationMinutes * 60_000) : null

    const created = await prisma.essaySubmission.create({
      data: {
        registrationId: reg.id,
        prompt: promptText,
        attemptNumber: (subs[0]?.attemptNumber || 0) + 1,
        status: 'draft',
        startedAt,
        expiresAt,
        essayText: '',
        wordCount: 0,
      },
    })
    return { ok: true, submission: paraCandidato(created), resumed: false }
  })

  // PUT /api/candidate/essay/:id/draft — auto-save do texto (não submete).
  // Body: { essayText, pasteAttempts?, visibilityChanges? }
  app.put('/api/candidate/essay/:id/draft', async (req, reply) => {
    const s = await requireCandidateLocal(req, reply, { toleranciaMs: TOLERANCIA_SESSAO_REDACAO_MS }); if (!s) return
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const sub = await prisma.essaySubmission.findUnique({ where: { id: parseInt(id) } })
    if (!sub || sub.registrationId !== s.enrollmentId) return reply.code(404).send({ error: 'Redação não encontrada' })
    if (sub.status !== 'draft') return reply.code(400).send({ error: 'Redação já foi submetida', jaEnviada: true })
    // Tempo acabou: não aceita mais edição, mas também não mata a tentativa —
    // o portal envia o texto (e, se não enviar, o GET entrega o último salvo).
    if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
      return reply.code(409).send({ error: 'O tempo da redação acabou.', tempoEsgotado: true })
    }

    const text = String(body.essayText || '').slice(0, 200_000)  // limite duro
    const wc = countWords(text)
    const updated = await prisma.essaySubmission.update({
      where: { id: sub.id },
      data: {
        essayText: text,
        wordCount: wc,
        // Nunca diminui: recarregar a página zera o contador do navegador, e
        // gravar o valor recebido apagava o histórico de colagens.
        pasteAttempts: typeof body.pasteAttempts === 'number' ? Math.max(sub.pasteAttempts, body.pasteAttempts) : sub.pasteAttempts,
        visibilityChanges: typeof body.visibilityChanges === 'number' ? Math.max(sub.visibilityChanges, body.visibilityChanges) : sub.visibilityChanges,
        ...(body.telemetria ? { typingTelemetry: somarTelemetria(sub.typingTelemetry, body.telemetria) as any } : {}),
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
    const s = await requireCandidateLocal(req, reply, { toleranciaMs: TOLERANCIA_SESSAO_REDACAO_MS }); if (!s) return
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
    // Já entregue (duplo clique, ou o envio automático chegou antes): não é erro.
    if (sub.status !== 'draft') {
      if (['ai_reviewing', 'needs_human', 'submitted', 'approved', 'rejected'].includes(sub.status)) {
        return { ok: true, submission: paraCandidato(sub as any), jaEnviada: true }
      }
      return reply.code(400).send({ error: 'Esta tentativa foi encerrada.' })
    }
    {
      const trava = await (await import('../services/portalJornada.js')).bloqueioDaEtapa(s.enrollmentId, 'prova', s.onde)
      if (trava) return reply.code(409).send({ error: trava, travada: true })
    }

    const sp = sub.registration?.processRegistration?.selectionProcess
    const now = new Date()
    // Fim do cronômetro: aceita até a folga, sem exigir o mínimo de palavras —
    // vale o que foi escrito. Depois da folga, entrega o último texto salvo.
    const tempoEsgotado = !!sub.expiresAt && now > new Date(sub.expiresAt)
    const foraDaFolga = !!sub.expiresAt && now.getTime() > new Date(sub.expiresAt).getTime() + FOLGA_ENVIO_MS
    const finalText = String((foraDaFolga ? sub.essayText : (body.essayText ?? sub.essayText)) ?? '').trim().slice(0, 200_000)
    const wc = countWords(finalText)

    if (wc === 0) return reply.code(400).send({ error: 'A redação está vazia.' })
    if (!tempoEsgotado && sp?.essayMinWords && wc < sp.essayMinWords) {
      return reply.code(400).send({ error: `Mínimo de ${sp.essayMinWords} palavras (atual: ${wc})` })
    }
    if (!tempoEsgotado && sp?.essayMaxWords && wc > sp.essayMaxWords) {
      return reply.code(400).send({ error: `Máximo de ${sp.essayMaxWords} palavras (atual: ${wc})` })
    }

    const updated = await entregarTentativa(sub, finalText, sp?.essayAiEnabled !== false, foraDaFolga ? null : body, tempoEsgotado ? new Date(sub.expiresAt!) : now, req.log)
    if (!updated) {
      const atual = await prisma.essaySubmission.findUnique({ where: { id: sub.id } })
      return { ok: true, submission: atual ? paraCandidato(atual) : null, jaEnviada: true }
    }
    return { ok: true, submission: paraCandidato(updated) }
  })
}
