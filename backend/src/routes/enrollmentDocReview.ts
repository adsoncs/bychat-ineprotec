// src/routes/enrollmentDocReview.ts
// Análise de documentos agrupada por inscrição (admin).
//
// Modos:
//  - Por inscrição (este arquivo): 1 card por candidato com progresso documental.
//    Detalhe mostra todos os docs do candidato. Auto-avanço configurável por portal.
//  - Por documento (fila plana): existente em routes/candidatePortal.ts (lista flat de docs).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { computeDocsCompletionStatus } from '../services/enrollmentEvaluationGateway.js'

export { computeDocsCompletionStatus }  // re-export para preservar callers existentes

type DocStatus = 'pending' | 'approved' | 'rejected'

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

/**
 * Resolve os requirements efetivos para um ProcessRegistration:
 * usa override do SelectionProcess se `useCustomDocuments`, senão
 * herda do EntryMode. Igual ao que candidatePortal.ts já faz no /me.
 */
async function loadEffectiveRequirements(processRegistrationId: number | null) {
  if (!processRegistrationId) return [] as any[]
  const pr = await prisma.processRegistration.findUnique({
    where: { id: processRegistrationId },
    select: {
      selectionProcess: {
        select: {
          useCustomDocuments: true,
          documentRequirements: {
            orderBy: { ordem: 'asc' },
            select: {
              required: true, ordem: true, helpText: true,
              documentType: { select: { id: true, code: true, name: true, category: true } },
            },
          },
          entryMode: {
            select: {
              documentRequirements: {
                orderBy: { ordem: 'asc' },
                select: {
                  required: true, ordem: true, helpText: true,
                  documentType: { select: { id: true, code: true, name: true, category: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!pr?.selectionProcess) return []
  const sp: any = pr.selectionProcess
  return (sp.useCustomDocuments && Array.isArray(sp.documentRequirements) && sp.documentRequirements.length > 0)
    ? sp.documentRequirements
    : (sp.entryMode?.documentRequirements || [])
}

/**
 * Após aprovar/rejeitar um doc, checa se a inscrição inteira ficou completa
 * (todos os obrigatórios approved). Se sim e o portal tiver `docsCompleteStageKey`
 * configurado, move o lead para essa etapa do funil + emite evento.
 *
 * Idempotente: se o lead já está na stage destino, não faz nada.
 */
export async function tryAutoAdvanceOnDocsComplete(registrationId: number, actorUserId: number | null): Promise<boolean> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true,
      leadId: true,
      processRegistrationId: true,
      portal: {
        select: {
          id: true, nome: true, funnelId: true, docsCompleteStageKey: true,
        },
      },
      lead: { select: { id: true, status: true } },
      documents: {
        select: {
          status: true, typeCode: true,
          type: { select: { code: true } },
        },
        orderBy: { uploadedAt: 'desc' },
      },
    },
  })
  if (!reg) return false

  const requirements = await loadEffectiveRequirements(reg.processRegistrationId)
  const completion = computeDocsCompletionStatus(requirements, reg.documents)
  if (completion !== 'complete') return false

  // Auto-avanço só se portal configurar a stage destino.
  const stageKey = reg.portal?.docsCompleteStageKey
  if (!stageKey || !reg.lead) return false
  if (reg.lead.status === stageKey) return false  // já está lá

  await prisma.lead.update({
    where: { id: reg.lead.id },
    data: { status: stageKey, updatedAt: new Date() },
  })

  logEvent({
    leadId: reg.lead.id,
    type: EVENT_TYPES.STATUS_CHANGED,
    category: 'lifecycle',
    title: `Etapa alterada automaticamente para "${stageKey}"`,
    source: 'system',
    actorType: 'system',
    description: `Documentação completa aprovada (inscrição ${reg.candidateCode}). Auto-avanço configurado no portal "${reg.portal?.nome}".`,
    metadata: {
      registrationId: reg.id,
      candidateCode: reg.candidateCode,
      portalId: reg.portal?.id,
      newStageKey: stageKey,
      trigger: 'docs_complete',
      actorUserId: actorUserId || undefined,
    },
  })

  return true
}

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

/**
 * Aprovação/rejeição de matrícula: só ADMIN e SUPERADMIN.
 *
 * O guard acima aceita MANAGER porque é o mesmo usado para LER as filas de
 * avaliação, o que é legítimo. Mas aprovar documento, validar nota do ENEM e
 * corrigir redação decide a entrada de um aluno na instituição — a auditoria de
 * junho já havia separado esses dois níveis no resto do produto (adminStrict).
 */
async function requireAdminWrite(req: any, reply: any): Promise<any | null> {
  const user = await requireAdmin(req, reply)
  if (!user) return null
  if (user.role !== 'SUPERADMIN' && user.role !== 'ADMIN') {
    reply.code(403).send({ error: 'Acesso restrito a administradores' })
    return null
  }
  return user
}

// ───────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────

export async function enrollmentDocReviewRoutes(app: FastifyInstance) {

  // GET /api/admin/enrollment-document-reviews
  // Lista agrupada por inscrição. Filtra por status documental derivado, portal, busca.
  // Retorna { items, total, kpi: { pending, rejected, complete } }
  app.get('/api/admin/enrollment-document-reviews', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return

    const q = req.query as any
    const statusFilter = String(q.status || 'pending').toLowerCase()  // pending | rejected | complete | all
    const portalId = q.portalId ? parseInt(q.portalId) : null
    const search = String(q.q || '').trim()
    const sort = q.sort === 'newest' ? 'desc' : 'asc'  // default oldest first
    const limit = Math.min(Math.max(parseInt(q.limit) || 100, 1), 500)
    const offset = Math.max(parseInt(q.offset) || 0, 0)

    // Pega TODAS as inscrições que tenham pelo menos 1 documento OU pelo menos 1 requirement.
    // Para performance, filtramos primeiro por portalId/search se aplicável.
    const where: any = {}
    if (portalId) where.portalId = portalId
    if (search) {
      where.OR = [
        { candidateCode: { contains: search } },
        { lead: { is: { nome: { contains: search } } } },
        { lead: { is: { email: { contains: search } } } },
      ]
    }

    const regs = await prisma.enrollmentRegistration.findMany({
      where,
      orderBy: { createdAt: sort as any },
      select: {
        id: true, candidateCode: true, status: true, createdAt: true,
        lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
        portal: { select: { id: true, nome: true, slug: true } },
        processRegistrationId: true,
        processRegistration: {
          select: {
            selectionProcess: {
              select: {
                id: true, nome: true,
                useCustomDocuments: true,
                documentRequirements: {
                  orderBy: { ordem: 'asc' },
                  select: {
                    required: true, ordem: true,
                    documentType: { select: { id: true, code: true, name: true } },
                  },
                },
                entryMode: {
                  select: {
                    documentRequirements: {
                      orderBy: { ordem: 'asc' },
                      select: {
                        required: true, ordem: true,
                        documentType: { select: { id: true, code: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
            offering: { select: { nome: true, course: { select: { nome: true } } } },
          },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true, status: true, typeCode: true, uploadedAt: true,
            aiSuggestion: true, aiConfidence: true,
            type: { select: { code: true, name: true } },
          },
        },
      },
    })

    // Calcula status derivado e filtra por status pedido
    const itemsAll = regs.map(reg => {
      const sp: any = reg.processRegistration?.selectionProcess
      const requirements: any[] = sp
        ? (sp.useCustomDocuments && Array.isArray(sp.documentRequirements) && sp.documentRequirements.length > 0
            ? sp.documentRequirements
            : (sp.entryMode?.documentRequirements || []))
        : []
      const completion = computeDocsCompletionStatus(requirements, reg.documents as any[])

      // Estatísticas por requirement
      const required = requirements.filter(r => r.required)
      const latestByCode: Record<string, any> = {}
      for (const d of reg.documents) {
        const code = d.type?.code || d.typeCode
        if (code && !latestByCode[code]) latestByCode[code] = d
      }

      let approvedCount = 0, pendingCount = 0, rejectedCount = 0, missingCount = 0
      const aiSummary: string[] = []
      for (const r of required) {
        const code = r.documentType?.code
        const d = code ? latestByCode[code] : null
        if (!d) { missingCount++; aiSummary.push('?'); continue }
        if (d.status === 'approved') { approvedCount++; aiSummary.push('✓') }
        else if (d.status === 'rejected') { rejectedCount++; aiSummary.push('✗') }
        else {
          pendingCount++
          aiSummary.push(d.aiSuggestion === 'approve' ? 'i' : d.aiSuggestion === 'reject' ? 'x' : '⏳')
        }
      }

      const lastUpload = reg.documents.length > 0 ? reg.documents[0].uploadedAt : null
      const oldestPending = reg.documents
        .filter((d: any) => d.status === 'pending')
        .sort((a: any, b: any) => a.uploadedAt.getTime() - b.uploadedAt.getTime())[0]

      return {
        registrationId: reg.id,
        candidateCode: reg.candidateCode,
        candidate: { name: reg.lead?.nome || '-', email: reg.lead?.email || '', whatsapp: reg.lead?.whatsapp || '' },
        leadId: reg.lead?.id || null,
        portal: reg.portal,
        course: reg.processRegistration?.offering?.course?.nome || reg.processRegistration?.offering?.nome || '',
        selectionProcess: sp ? { id: sp.id, nome: sp.nome } : null,
        completion,
        requiredTotal: required.length,
        approvedCount, pendingCount, rejectedCount, missingCount,
        aiSummary,
        lastUploadAt: lastUpload,
        oldestPendingAt: oldestPending?.uploadedAt || null,
        registrationStatus: reg.status,
        createdAt: reg.createdAt,
      }
    })

    const items = itemsAll.filter(it =>
      statusFilter === 'all' ? true : it.completion === statusFilter
    )

    // Conta quantas outras inscrições cada lead tem (avisa o admin que pode haver
    // docs em outra inscrição do mesmo candidato — comum quando há 2 processos).
    const leadIds = Array.from(new Set(items.map(it => it.leadId).filter(Boolean) as number[]))
    const siblingCounts = new Map<number, number>()
    if (leadIds.length > 0) {
      const rows = await prisma.enrollmentRegistration.groupBy({
        by: ['leadId'],
        where: { leadId: { in: leadIds } },
        _count: { _all: true },
      })
      for (const r of rows) {
        if (r.leadId) siblingCounts.set(r.leadId, r._count._all)
      }
    }
    for (const it of items as any[]) {
      const total = it.leadId ? (siblingCounts.get(it.leadId) || 1) : 1
      it.siblingCount = Math.max(0, total - 1)
    }

    // KPIs sobre TODAS (não só da página) para que o usuário veja a contagem real.
    const kpi = { pending: 0, rejected: 0, complete: 0 }
    for (const it of itemsAll) {
      if (it.completion === 'pending') kpi.pending++
      else if (it.completion === 'rejected') kpi.rejected++
      else if (it.completion === 'complete') kpi.complete++
    }

    // Ordena pendentes/rejeitados por idade da pendência (mais antigos primeiro)
    items.sort((a, b) => {
      const ka = a.oldestPendingAt ? new Date(a.oldestPendingAt).getTime() : (a.lastUploadAt ? new Date(a.lastUploadAt).getTime() : 0)
      const kb = b.oldestPendingAt ? new Date(b.oldestPendingAt).getTime() : (b.lastUploadAt ? new Date(b.lastUploadAt).getTime() : 0)
      return sort === 'asc' ? ka - kb : kb - ka
    })

    const paged = items.slice(offset, offset + limit)
    return { items: paged, total: items.length, kpi }
  })

  // GET /api/admin/enrollment-registrations/:id/document-review
  // Detalhe completo: candidato, requirements esperados pareados com docs efetivos,
  // extras (docs sem requirement) e config do portal pra auto-avanço.
  app.get('/api/admin/enrollment-registrations/:id/document-review', async (req, reply) => {
    const user = await requireAdmin(req, reply); if (!user) return

    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, candidateCode: true, status: true, createdAt: true, formData: true,
        lead: { select: { id: true, nome: true, email: true, whatsapp: true, status: true } },
        portal: {
          select: {
            id: true, nome: true, slug: true, funnelId: true, docsCompleteStageKey: true,
            funnel: {
              select: {
                id: true, name: true,
                stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true, position: true } },
              },
            },
          },
        },
        processRegistration: {
          select: {
            id: true,
            selectionProcess: {
              select: {
                id: true, nome: true, codigo: true,
                useCustomDocuments: true,
                documentRequirements: {
                  orderBy: { ordem: 'asc' },
                  select: {
                    required: true, ordem: true, helpText: true,
                    documentType: { select: { id: true, code: true, name: true, category: true, aiAnalysisTemplate: true } },
                  },
                },
                entryMode: {
                  select: {
                    code: true, name: true, icon: true, evaluationType: true,
                    documentRequirements: {
                      orderBy: { ordem: 'asc' },
                      select: {
                        required: true, ordem: true, helpText: true,
                        documentType: { select: { id: true, code: true, name: true, category: true, aiAnalysisTemplate: true } },
                      },
                    },
                  },
                },
              },
            },
            offering: {
              select: {
                nome: true, turno: true,
                course: { select: { nome: true } },
                campuses: { select: { campus: { select: { nome: true, cidade: true } } } },
              },
            },
          },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true, typeCode: true, label: true,
            fileUrl: true, fileName: true, mimeType: true, sizeBytes: true,
            status: true, reviewNote: true, reviewedAt: true, reviewedBy: true,
            aiStatus: true, aiSuggestion: true, aiConfidence: true, aiAnalysis: true,
            uploadedAt: true,
            type: { select: { id: true, code: true, name: true, category: true, aiAnalysisTemplate: true } },
          },
        },
        // Última tentativa da redação (se o entry mode exigir) — usada pelo header.
        essaySubmissions: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
          select: { id: true, status: true, submittedAt: true, aiScore: true, humanScore: true, finalScore: true },
        },
        paymentStatus: true, paymentMethod: true, paymentAmount: true, paymentPaidAt: true,
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    // Resolve requirements efetivos
    const sp: any = reg.processRegistration?.selectionProcess
    const requirements: any[] = sp
      ? (sp.useCustomDocuments && Array.isArray(sp.documentRequirements) && sp.documentRequirements.length > 0
          ? sp.documentRequirements
          : (sp.entryMode?.documentRequirements || []))
      : []

    // Pareia cada requirement com o último doc daquele code
    const latestByCode: Record<string, any> = {}
    for (const d of reg.documents) {
      const code = d.type?.code || d.typeCode
      if (code && !latestByCode[code]) latestByCode[code] = d
    }

    const slots = requirements.map((r: any) => ({
      ordem: r.ordem,
      required: r.required,
      helpText: r.helpText,
      documentType: r.documentType,
      latestDoc: r.documentType?.code ? (latestByCode[r.documentType.code] || null) : null,
    }))

    // Extras = docs cujo code não bate com nenhum requirement
    const requiredCodes = new Set(requirements.map((r: any) => r.documentType?.code).filter(Boolean))
    const extras = reg.documents.filter(d => {
      const code = d.type?.code || d.typeCode
      return !code || !requiredCodes.has(code)
    })

    const completion = computeDocsCompletionStatus(requirements, reg.documents as any[])

    // Lookup nomes de quem revisou (resolução simples)
    const reviewerIds = Array.from(new Set(reg.documents.map(d => d.reviewedBy).filter(Boolean) as number[]))
    const reviewers = reviewerIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
      : []
    const reviewerMap = new Map(reviewers.map(u => [u.id, u.name]))

    const enrichDoc = (d: any) => ({
      ...d,
      reviewerName: d.reviewedBy ? (reviewerMap.get(d.reviewedBy) || `User #${d.reviewedBy}`) : null,
    })

    // Status agregado da redação — só relevante quando entryMode usa avaliação por redação
    const entryEval = (reg.processRegistration?.selectionProcess as any)?.entryMode?.evaluationType
    const last = (reg as any).essaySubmissions?.[0]
    let essayStatus: 'not-required' | 'pending' | 'submitted' | 'reviewing' | 'approved' | 'rejected' = 'not-required'
    let essayScore: number | null = null
    if (entryEval === 'essay') {
      if (!last) essayStatus = 'pending'
      else if (last.status === 'approved') essayStatus = 'approved'
      else if (last.status === 'rejected' || last.status === 'expired') essayStatus = 'rejected'
      else if (last.status === 'draft') essayStatus = 'pending'
      else if (last.status === 'submitted' || last.status === 'ai_reviewing' || last.status === 'needs_human') essayStatus = 'reviewing'
      else essayStatus = 'submitted'
      essayScore = last?.finalScore ?? last?.humanScore ?? last?.aiScore ?? null
    }

    return {
      registration: {
        id: reg.id, candidateCode: reg.candidateCode,
        status: reg.status, createdAt: reg.createdAt,
        formData: reg.formData,
        paymentStatus: reg.paymentStatus,
        paymentMethod: reg.paymentMethod,
        paymentAmount: reg.paymentAmount,
        paymentPaidAt: reg.paymentPaidAt,
      },
      lead: reg.lead,
      portal: reg.portal,
      processRegistration: reg.processRegistration,
      completion,  // 'pending' | 'rejected' | 'complete'
      essay: { status: essayStatus, score: essayScore, required: entryEval === 'essay' },
      slots: slots.map(s => ({ ...s, latestDoc: s.latestDoc ? enrichDoc(s.latestDoc) : null })),
      extras: extras.map(enrichDoc),
      // Config do portal pra mostrar info do auto-avanço
      autoAdvance: reg.portal?.docsCompleteStageKey
        ? {
            enabled: true,
            stageKey: reg.portal.docsCompleteStageKey,
            stageName: reg.portal.funnel?.stages.find((s: any) => s.key === reg.portal!.docsCompleteStageKey)?.name || reg.portal.docsCompleteStageKey,
            funnelName: reg.portal.funnel?.name || null,
          }
        : { enabled: false },
    }
  })

  // POST /api/admin/enrollment-registrations/:id/bulk-approve-ai
  // Aprova todos os documentos pendentes da inscrição onde a IA sugeriu 'approve'
  // com confiança >= threshold. Body: { minConfidence: 0.85, dryRun: false }
  app.post('/api/admin/enrollment-registrations/:id/bulk-approve-ai', async (req, reply) => {
    const user = await requireAdminWrite(req, reply); if (!user) return

    const { id } = req.params as any
    const body = (req.body as any) || {}
    const minConfidence = typeof body.minConfidence === 'number' ? Math.max(0, Math.min(1, body.minConfidence)) : 0.85
    const dryRun = !!body.dryRun

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        documents: {
          where: { status: 'pending' },
          select: {
            id: true, label: true, typeCode: true,
            aiSuggestion: true, aiConfidence: true,
            type: { select: { code: true, name: true } },
          },
        },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const eligible = reg.documents.filter(d =>
      d.aiSuggestion === 'approve' && (d.aiConfidence ?? 0) >= minConfidence
    )

    if (dryRun) {
      return {
        ok: true, dryRun: true,
        wouldApprove: eligible.length,
        items: eligible.map(d => ({ id: d.id, name: d.type?.name || d.label, confidence: d.aiConfidence })),
      }
    }

    if (eligible.length === 0) {
      return { ok: true, approved: 0, items: [] }
    }

    // Aprova em transação
    const ids = eligible.map(d => d.id)
    await prisma.enrollmentDocument.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'approved',
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        reviewNote: `Aprovação em lote por IA (confiança ≥ ${Math.round(minConfidence * 100)}%) — admin ${user.userId}`,
      },
    })

    // Notificações + auto-avanço (fire-and-forget para não bloquear resposta)
    Promise.all([
      ...ids.map(docId =>
        import('../services/enrollmentNotify.js')
          .then(m => m.sendDocumentApprovalNotice(docId))
          .catch(err => req.log.warn(`[bulk-approve] notify ${docId}: ${err.message}`))
      ),
      tryAutoAdvanceOnDocsComplete(reg.id, user.userId).catch(err =>
        req.log.warn(`[bulk-approve] auto-advance ${reg.id}: ${err.message}`)
      ),
    ]).catch(() => {})

    return {
      ok: true, approved: ids.length,
      items: eligible.map(d => ({ id: d.id, name: d.type?.name || d.label, confidence: d.aiConfidence })),
    }
  })
}
