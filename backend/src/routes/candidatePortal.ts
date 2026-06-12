// src/routes/candidatePortal.ts
// Portal do Candidato — autenticação por CPF+candidateCode, dashboard, upload de documentos.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { prisma } from '../lib/prisma.js'
import { normalizeCpf } from '../lib/cpf.js'
import { renderBrandingHead, renderBrandFooter } from '../lib/portalBranding.js'
import { signCandidateToken, verifyCandidateToken } from '../lib/candidateAuth.js'
import { adminOnly } from '../lib/auth.js'
import { redis } from '../lib/redis.js'
import { logSecurityEvent } from '../services/security.js'
import { validateUploadContent, UploadValidationError } from '../lib/uploadSafety.js'

async function requireCandidate(req: any, reply: any): Promise<{ enrollmentId: number; candidateCode: string } | null> {
  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  const session = verifyCandidateToken(auth)
  if (!session) { reply.code(401).send({ error: 'Sessão inválida ou expirada' }); return null }
  return session
}

export async function candidatePortalRoutes(app: FastifyInstance) {

  // ── POST /api/candidate/login ──
  // body: { candidateCode, cpf }
  app.post('/api/candidate/login', async (req, reply) => {
    const body = (req.body as any) || {}
    const candidateCode = String(body.candidateCode || '').trim().toUpperCase()
    const cpf = normalizeCpf(String(body.cpf || ''))
    if (!candidateCode || !cpf) return reply.code(400).send({ error: 'Informe o código do candidato e CPF' })

    // ── Lockout anti-brute-force (por IP e por código) ────────────────────
    // Impede enumeração de código + força bruta de CPF. Janela de 15 min.
    const ipKey = `candlogin:ip:${req.ip}`
    const codeKey = `candlogin:code:${candidateCode}`
    try {
      const [ipFails, codeFails] = await Promise.all([redis.get(ipKey), redis.get(codeKey)])
      if (Number(ipFails) >= 20 || Number(codeFails) >= 8) {
        await logSecurityEvent({ ip: req.ip, type: 'candidate_login_lockout', severity: 'medium', path: req.url, details: `code=${candidateCode}` }).catch(() => {})
        return reply.code(429).send({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
      }
    } catch { /* redis indisponível — não bloqueia login legítimo */ }

    // Resposta 401 genérica para código inexistente E CPF divergente — sem
    // oráculo de enumeração (não revela se o código existe).
    const fail = async () => {
      try {
        await Promise.all([
          redis.incr(ipKey).then(() => redis.expire(ipKey, 900)),
          redis.incr(codeKey).then(() => redis.expire(codeKey, 900)),
        ])
      } catch { /* ignore */ }
      return reply.code(401).send({ error: 'Código do candidato ou CPF inválido' })
    }

    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { candidateCode },
      include: { lead: true, portal: { select: { id: true, nome: true } } },
    })
    if (!enrollment) return fail()

    // Valida CPF bate com o salvo em formData
    const storedCpf = normalizeCpf(String((enrollment.formData as any)?.cpf || ''))
    if (!storedCpf || storedCpf !== cpf) {
      return fail()
    }

    // Sucesso — zera contadores de falha
    try { await Promise.all([redis.del(ipKey), redis.del(codeKey)]) } catch { /* ignore */ }

    const token = signCandidateToken(enrollment.id, enrollment.candidateCode)
    return {
      ok: true,
      token,
      candidate: {
        name: enrollment.lead?.nome || (enrollment.formData as any)?.nome || '',
        candidateCode: enrollment.candidateCode,
        portalName: enrollment.portal.nome,
      },
    }
  })

  // ── GET /api/candidate/me — dashboard ──
  app.get('/api/candidate/me', async (req, reply) => {
    const s = await requireCandidate(req, reply); if (!s) return
    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { id: s.enrollmentId },
      include: {
        lead: { select: { id: true, nome: true, email: true, whatsapp: true, status: true } },
        portal: {
          select: {
            id: true, nome: true, slug: true, requirePayment: true, paymentMode: true,
            paymentConnection: { select: { provider: true, publicKey: true } },
            unit: { select: { nome: true } },
            funnel: { select: { id: true, name: true, stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true } } } },
            // Branding visual — frontend aplica em runtime após login
            brandLogoUrl: true, brandLogoLink: true, brandFaviconUrl: true,
            brandPrimaryColor: true, brandFooterText: true,
            brandFontFamily: true, brandRadiusScale: true,
          },
        },
        paymentMethods: { orderBy: { createdAt: 'desc' } },
        processRegistration: {
          include: {
            offering: { select: { nome: true, course: { select: { nome: true } }, campuses: { select: { campus: { select: { nome: true, cidade: true } } } } } },
            selectionProcess: {
              select: {
                nome: true, codigo: true, slug: true,
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
                    code: true, name: true, icon: true, evaluationType: true,
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
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          select: {
            id: true, typeCode: true, typeId: true, label: true,
            fileName: true, mimeType: true, sizeBytes: true,
            status: true, reviewNote: true, uploadedAt: true, reviewedAt: true,
            aiStatus: true, aiSuggestion: true, aiConfidence: true,
            type: { select: { code: true, name: true, category: true } },
          },
        },
        enemScoreImports: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, nome: true, inscricao: true, ano: true, treineiro: true,
            cienciasHumanas: true, cienciasNatureza: true, linguagens: true,
            matematica: true, redacao: true,
            mediaSimples: true, cutoffScore: true, passed: true,
            source: true, aiConfidence: true, createdAt: true,
          },
        },
      },
    })
    if (!enrollment) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    // Timeline: compila eventos principais
    const timeline: any[] = [
      { type: 'submitted', title: 'Inscrição recebida', at: enrollment.createdAt, icon: '📝' },
    ]
    if (enrollment.paymentUrl && !enrollment.paymentPaidAt) {
      timeline.push({ type: 'payment_pending', title: 'Pagamento pendente', at: enrollment.createdAt, icon: '💳',
        extra: { url: enrollment.paymentUrl, expiresAt: enrollment.paymentExpiresAt, amount: enrollment.paymentAmount } })
    }
    if (enrollment.paymentPaidAt) {
      timeline.push({ type: 'paid', title: 'Pagamento confirmado', at: enrollment.paymentPaidAt, icon: '✅' })
    }
    if (enrollment.documents.length > 0) {
      timeline.push({ type: 'docs', title: `${enrollment.documents.length} documento(s) enviado(s)`, at: enrollment.documents[0].uploadedAt, icon: '📎' })
    }
    if (enrollment.status === 'approved') timeline.push({ type: 'approved', title: 'Inscrição aprovada', at: enrollment.updatedAt, icon: '🎉' })
    if (enrollment.status === 'enrolled') timeline.push({ type: 'enrolled', title: 'Matrícula confirmada', at: enrollment.updatedAt, icon: '🎓' })
    timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

    // Etapa atual = posição do lead no funil escolhido pelo portal
    const stages = enrollment.portal?.funnel?.stages || []
    const leadStageKey = enrollment.lead?.status || null
    const stage = stages.find(s => s.key === leadStageKey) || null

    // Resolve documentRequirements efetivos: override do SP se ligado, senão herda do modo.
    // Frontend lê `processRegistration.effectiveDocumentRequirements` (formato uniforme).
    const sp = enrollment.processRegistration?.selectionProcess as any
    const effectiveDocumentRequirements = sp
      ? (sp.useCustomDocuments && Array.isArray(sp.documentRequirements) && sp.documentRequirements.length > 0
          ? sp.documentRequirements
          : (sp.entryMode?.documentRequirements || []))
      : []
    const processRegistration = enrollment.processRegistration
      ? { ...enrollment.processRegistration, effectiveDocumentRequirements }
      : null

    // Não vazar a publicKey criptografada — frontend só precisa saber se foi cadastrada
    // pra liberar a aba cartão. O texto plain só vem por /payment-public-key sob auth.
    const portalSanitized: any = enrollment.portal ? { ...enrollment.portal } : null
    if (portalSanitized?.paymentConnection) {
      portalSanitized.paymentConnection = {
        provider: portalSanitized.paymentConnection.provider,
        hasPublicKey: !!portalSanitized.paymentConnection.publicKey,
      }
    }

    return {
      enrollment: {
        id: enrollment.id,
        candidateCode: enrollment.candidateCode,
        status: enrollment.status,
        paymentStatus: enrollment.paymentStatus,
        paymentUrl: enrollment.paymentUrl,
        paymentAmount: enrollment.paymentAmount,
        paymentMethod: enrollment.paymentMethod,
        paymentPaidAt: enrollment.paymentPaidAt,
        paymentExpiresAt: enrollment.paymentExpiresAt,
        createdAt: enrollment.createdAt,
        formData: enrollment.formData,
      },
      lead: enrollment.lead,
      portal: portalSanitized,
      processRegistration,
      documents: enrollment.documents,
      enemScoreImports: enrollment.enemScoreImports,
      paymentMethods: (enrollment as any).paymentMethods || [],
      timeline,
      stage,  // { key, name, color } | null
    }
  })

  // ── POST /api/candidate/documents — upload de documento ──
  app.post('/api/candidate/documents', async (req, reply) => {
    const s = await requireCandidate(req, reply); if (!s) return

    // Override do limite default de 10MB do fastify-multipart só para esta rota
    // — fotos modernas de celular e PDFs escaneados frequentemente excedem 10MB.
    const file = await (req as any).file?.({ limits: { fileSize: 25 * 1024 * 1024 } })
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    // Validação de extensão / MIME — lista ampla.
    // Inclui formatos comuns (JPG/PNG/WebP/GIF/BMP/HEIC) e PDF.
    const ext = (file.filename.split('.').pop() || 'bin').toLowerCase()
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'pdf']
    if (!allowedExts.includes(ext)) return reply.code(400).send({ error: `Tipo de arquivo não permitido: .${ext}. Aceitos: ${allowedExts.join(', ')}` })

    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
      'image/heic', 'image/heif',
      'application/pdf',
      // Alguns navegadores enviam 'application/octet-stream' para HEIC; tolera.
      'application/octet-stream',
    ]
    if (file.mimetype && !allowedMimes.includes(file.mimetype)) {
      return reply.code(400).send({ error: `MIME não permitido: ${file.mimetype}` })
    }

    const uploadsDir = join(process.cwd(), '..', 'uploads', 'enrollment-docs')
    await fs.mkdir(uploadsDir, { recursive: true })

    const savedName = `${s.enrollmentId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(uploadsDir, savedName)

    // Consome stream do arquivo. Limite generoso (25MB) cobre fotos modernas
    // de celular e PDFs com várias páginas escaneadas.
    const chunks: Buffer[] = []
    const MAX = 25 * 1024 * 1024
    let total = 0
    for await (const c of file.file) {
      total += c.length
      if (total > MAX) return reply.code(413).send({ error: 'Arquivo muito grande (máx 25MB)' })
      chunks.push(c)
    }
    // Valida magic bytes: rejeita markup disfarçado de imagem/PDF (A8/M6).
    let docBuf: Buffer = Buffer.concat(chunks)
    try {
      docBuf = validateUploadContent(docBuf, ext, { allowSvg: false })
    } catch (err: any) {
      if (err instanceof UploadValidationError) return reply.code(400).send({ error: err.message })
      return reply.code(500).send({ error: 'Falha ao processar arquivo' })
    }
    await fs.writeFile(filePath, docBuf)

    // IMPORTANTE: lê os fields APÓS consumir o stream do arquivo. fastify-multipart
    // só popula `file.fields` com campos parseados até aquele momento — campos
    // que vêm depois do `file` no multipart só ficam disponíveis após drenar
    // o stream. Antes desta correção, `type` voltava `undefined` e o doc era
    // salvo como `typeCode='other'` (bug observado com RG).
    const typeCode = String(file.fields?.type?.value || file.fields?.typeCode?.value || 'other').substring(0, 30)
    const label = String(file.fields?.label?.value || file.filename || 'Documento').substring(0, 100)

    // Resolve FK opcional para DocumentType via code (pode ser null se tipo livre).
    const docType = await prisma.documentType.findUnique({ where: { code: typeCode } }).catch(() => null)
    const typeId = docType?.id || null
    // Define aiStatus inicial: se o tipo tem template de análise, enfileira; senão skipped.
    const aiStatus = docType?.aiAnalysisTemplate ? 'pending' : 'skipped'

    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    const doc = await prisma.enrollmentDocument.create({
      data: {
        registrationId: s.enrollmentId,
        typeCode, typeId, label,
        fileUrl: `${appUrl}/uploads/enrollment-docs/${savedName}`,
        fileName: file.filename,
        mimeType: file.mimetype || `application/octet-stream`,
        sizeBytes: total,
        aiStatus,
      },
    })

    // Enfileira análise IA se o tipo tem template configurado
    if (aiStatus === 'pending') {
      const { queues } = await import('../lib/queues.js')
      queues.documentReview.add('review', { docId: doc.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }).catch(err => console.error('[document-review enqueue]', err))
    }

    return { ok: true, document: doc }
  })

  // ── DELETE /api/candidate/documents/:id ──
  app.delete('/api/candidate/documents/:id', async (req, reply) => {
    const s = await requireCandidate(req, reply); if (!s) return
    const { id } = req.params as any
    const doc = await prisma.enrollmentDocument.findUnique({ where: { id: parseInt(id) } })
    if (!doc || doc.registrationId !== s.enrollmentId) return reply.code(404).send({ error: 'Documento não encontrado' })
    if (doc.status === 'approved') return reply.code(400).send({ error: 'Documento aprovado não pode ser removido' })

    await prisma.enrollmentDocument.delete({ where: { id: doc.id } })
    // Remove arquivo físico (fire-and-forget)
    const savedName = doc.fileUrl.split('/').pop()
    if (savedName) fs.unlink(join(process.cwd(), '..', 'uploads', 'enrollment-docs', savedName)).catch(() => {})
    return { ok: true }
  })

  // ── GET /candidato/:code — HTML do portal do candidato ──
  // Resolve portal a partir do candidateCode para aplicar branding já no SSR
  // (favicon/cor/fonte/footer) sem flash do tema padrão.
  app.get('/candidato/:code', async (req, reply) => {
    const { code } = req.params as any
    const codeStr = String(code || '').trim().toUpperCase()
    let portal: any = null
    if (codeStr && /^[A-Z0-9-]{4,40}$/.test(codeStr)) {
      const reg = await prisma.enrollmentRegistration.findUnique({
        where: { candidateCode: codeStr },
        select: {
          portal: {
            select: {
              brandLogoUrl: true, brandLogoLink: true, brandFaviconUrl: true,
              brandPrimaryColor: true, brandFooterText: true,
              brandFontFamily: true, brandRadiusScale: true,
            },
          },
        },
      }).catch(() => null)
      portal = reg?.portal || null
    }
    reply.type('text/html').send(renderCandidatePortalHtml(portal))
  })

  // ── GET /candidato e /candidato/ — tela genérica de login ──
  // Sem :code na URL, exibimos o formulário pedindo código + CPF. Branding
  // genérico (sem portal vinculado), aplicado depois pelo /candidate/me.
  const renderGenericLogin = async (_req: any, reply: any) => {
    reply.type('text/html').send(renderCandidatePortalHtml(null))
  }
  app.get('/candidato', renderGenericLogin)
  app.get('/candidato/', renderGenericLogin)

  // ── Admin: GET /api/admin/enrollment-documents — fila de revisão ──
  // Filtros: status (pending|approved|rejected|all), aiSuggestion (approve|review|reject),
  // portalId, q (busca por nome candidato/code), sort (oldest|newest), limit, offset.
  app.get('/api/admin/enrollment-documents', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as any
    const q = req.query as any
    const where: any = {}
    if (q.status && q.status !== 'all') where.status = String(q.status)
    if (q.aiSuggestion && q.aiSuggestion !== 'all') where.aiSuggestion = String(q.aiSuggestion)
    if (q.aiStatus && q.aiStatus !== 'all') where.aiStatus = String(q.aiStatus)
    if (q.portalId) where.registration = { portalId: parseInt(q.portalId) }
    if (q.q) {
      const term = String(q.q).trim()
      if (term) {
        where.registration = {
          ...(where.registration || {}),
          OR: [
            { candidateCode: { contains: term } },
            { lead: { is: { nome: { contains: term } } } },
            { lead: { is: { email: { contains: term } } } },
          ],
        }
      }
    }
    const limit  = Math.min(Math.max(parseInt(q.limit)  || 50, 1), 200)
    const offset = Math.max(parseInt(q.offset) || 0, 0)
    const sort   = q.sort === 'newest' ? 'desc' : 'asc' // default: oldest first (FIFO)

    const [total, items, kpiCounts] = await Promise.all([
      prisma.enrollmentDocument.count({ where }),
      prisma.enrollmentDocument.findMany({
        where,
        orderBy: { uploadedAt: sort },
        take: limit,
        skip: offset,
        select: {
          id: true, label: true, typeCode: true, fileUrl: true, fileName: true,
          mimeType: true, sizeBytes: true,
          status: true, reviewNote: true, reviewedAt: true, reviewedBy: true,
          aiStatus: true, aiSuggestion: true, aiConfidence: true, aiAnalysis: true,
          uploadedAt: true,
          type: { select: { code: true, name: true, category: true, aiAnalysisTemplate: true } },
          registration: {
            select: {
              id: true, candidateCode: true, status: true,
              portal: { select: { id: true, nome: true, slug: true } },
              lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
              processRegistration: {
                select: {
                  selectionProcess: { select: { id: true, nome: true, slug: true } },
                  offering: { select: { nome: true, course: { select: { nome: true } } } },
                },
              },
            },
          },
        },
      }),
      prisma.enrollmentDocument.groupBy({ by: ['status'], _count: { _all: true } }),
    ])
    const kpi = { pending: 0, approved: 0, rejected: 0 }
    for (const k of kpiCounts) {
      if (k.status === 'pending')  kpi.pending  = k._count._all
      if (k.status === 'approved') kpi.approved = k._count._all
      if (k.status === 'rejected') kpi.rejected = k._count._all
    }
    return { total, items, kpi }
  })

  // ── Admin: aprovar/rejeitar documento ──
  app.put('/api/admin/enrollment-documents/:id/review', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as any
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : null
    if (!status) return reply.code(400).send({ error: 'Status inválido' })
    if (status === 'rejected' && !body.reviewNote?.trim()) {
      return reply.code(400).send({ error: 'Motivo (reviewNote) é obrigatório ao rejeitar' })
    }

    const doc = await prisma.enrollmentDocument.update({
      where: { id: parseInt(id) },
      data: { status, reviewNote: body.reviewNote || null, reviewedBy: user.userId, reviewedAt: new Date() },
    })

    // Emite domain event (consumido pelo workflowEngine — workflows seedados
    // tratam o envio das notificações via templates editáveis).
    import('../services/enrollmentNotify.js')
      .then(m => status === 'rejected' ? m.sendDocumentRejectionNotice(doc.id) : m.sendDocumentApprovalNotice(doc.id))
      .catch(err => req.log.warn(`[doc-review] notification failed: ${err.message}`))

    // Se foi aprovação, checa se a inscrição ficou completa (todos os obrigatórios
    // approved) — e move o lead pra etapa configurada no portal, se houver.
    if (status === 'approved' && doc.registrationId) {
      import('./enrollmentDocReview.js')
        .then(m => m.tryAutoAdvanceOnDocsComplete(doc.registrationId, user.userId))
        .catch(err => req.log.warn(`[doc-review] auto-advance failed: ${err.message}`))
    }

    return { ok: true, document: doc }
  })

  // ── POST /api/admin/enrollment-documents/:id/renotify ──
  // Reemite o domain event de aprovação/rejeição. Útil quando o workflow não
  // disparou na vez original (engine estava com bug, lead bloqueado por execution
  // stuck, etc.). Idempotente — não altera status do doc, apenas reemite o evento.
  app.post('/api/admin/enrollment-documents/:id/renotify', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const doc = await prisma.enrollmentDocument.findUnique({ where: { id: parseInt(id) } })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })
    if (doc.status !== 'approved' && doc.status !== 'rejected') {
      return reply.code(400).send({ error: 'Documento ainda não foi revisado' })
    }
    const m = await import('../services/enrollmentNotify.js')
    if (doc.status === 'approved') await m.sendDocumentApprovalNotice(doc.id)
    else await m.sendDocumentRejectionNotice(doc.id)
    return { ok: true, reemitted: doc.status }
  })

  // ── POST /api/admin/enrollment-documents/:id/reanalyze — re-disparar IA ──
  // Útil para forçar nova análise após ajuste de template/chave Anthropic.
  app.post('/api/admin/enrollment-documents/:id/reanalyze', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const doc = await prisma.enrollmentDocument.findUnique({
      where: { id: parseInt(id) },
      include: { type: true },
    })
    if (!doc) return reply.code(404).send({ error: 'Documento não encontrado' })
    if (!doc.type?.aiAnalysisTemplate) {
      return reply.code(400).send({ error: 'Tipo de documento não tem template de IA configurado' })
    }

    await prisma.enrollmentDocument.update({
      where: { id: doc.id },
      data: { aiStatus: 'pending', aiSuggestion: null, aiConfidence: null, aiAnalysis: null, aiProcessedAt: null },
    })
    const { queues } = await import('../lib/queues.js')
    await queues.documentReview.add('review', { docId: doc.id }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    return { ok: true, queued: true }
  })
}

// HTML standalone do portal do candidato (similar ao enrollment portal mas pra dashboard pós-inscrição).
// `portal` vem do EnrollmentRegistration ligado ao candidateCode da URL e
// permite aplicar branding (cor, fonte, favicon, footer) já no SSR.
function renderCandidatePortalHtml(portal?: any): string {
  const brand = renderBrandingHead(portal || {})
  const footer = renderBrandFooter(portal || {}, '')
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Portal do Candidato</title>
${brand.faviconLink}
${brand.fontLink}
<style>
  ${brand.cssVars}
  :root{--bg:#f6f7fb;--card:#fff;--text:#1a2332;--muted:#6b7280;--border:#e5e7eb;--success:#059669;--warning:#b06000;--error:#dc2626}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
  .wrap{max-width:820px;margin:0 auto;padding:30px 16px}
  .card{background:var(--card);border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.04);padding:24px;margin-bottom:16px}
  .hdr{text-align:center;margin-bottom:24px}
  .hdr h1{font-size:22px;font-weight:700;margin-bottom:4px}
  .hdr .sub{color:var(--muted);font-size:13px}
  .field{margin-bottom:14px}
  .field label{display:block;font-size:12px;font-weight:500;margin-bottom:5px;color:var(--text)}
  .field input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit}
  .field input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(26,115,232,.1)}
  .btn{padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;border:none}
  .btn-primary{background:var(--primary);color:#fff;width:100%}
  .btn-primary:disabled{opacity:.5}
  .btn-sm{padding:6px 12px;font-size:12px}
  .alert{padding:10px 14px;border-radius:8px;font-size:13px;margin:10px 0}
  .alert-err{background:#fef2f2;color:var(--error);border:1px solid #fecaca}
  .alert-ok{background:#f0fdf4;color:var(--success);border:1px solid #bbf7d0}
  .alert-warn{background:#fef7e0;color:var(--warning);border:1px solid #fdd835}
  .kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}
  .kpi-card{background:#f9fafb;border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
  .kpi-card .v{font-size:22px;font-weight:700;color:var(--primary)}
  .kpi-card .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:4px}
  .timeline{margin:18px 0}
  .timeline-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f1f3f4}
  .timeline-item:last-child{border:0}
  .timeline-item .ico{font-size:20px;flex-shrink:0;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#f9fafb;border-radius:50%}
  .timeline-item .body{flex:1}
  .timeline-item .body .t{font-size:13px;font-weight:500}
  .timeline-item .body .at{font-size:11px;color:var(--muted)}
  .doc-upload{border:2px dashed var(--border);border-radius:10px;padding:20px;text-align:center;background:#fafafa;cursor:pointer}
  .doc-upload:hover{border-color:var(--primary);background:#f0f7ff}
  .doc-list{margin-top:16px;display:grid;gap:8px}
  .doc-item{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;background:#fff}
  .doc-item .icon{font-size:20px}
  .doc-item .info{flex:1;min-width:0}
  .doc-item .name{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .doc-item .meta{font-size:11px;color:var(--muted)}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase}
  .badge-pending{background:#fef7e0;color:var(--warning)}
  .badge-approved{background:#d1fae5;color:var(--success)}
  .badge-rejected{background:#fee2e2;color:var(--error)}
  .loading{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite;margin-right:6px;vertical-align:-2px}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap" id="app"><div class="card"><div style="text-align:center;padding:30px;color:var(--muted)"><div class="loading" style="border-color:var(--primary);border-top-color:transparent;width:24px;height:24px"></div><div style="margin-top:10px">Carregando...</div></div></div></div>
${footer}
<script>window.__PORTAL_BRAND__=${JSON.stringify({
  brandLogoUrl: portal?.brandLogoUrl || null,
  brandLogoLink: portal?.brandLogoLink || null,
})};</script>
<script src="/assets/candidate-portal.js?v=${Date.now()}"></script>
</body>
</html>`
}
