// src/routes/enrollmentPortals.ts
// Portal de Matrículas — CRUD admin + endpoint público de registro.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { unlink } from 'fs/promises'
import { bufferMultipart, validateUploadContent, UploadValidationError, UploadTooLargeError } from '../lib/uploadSafety.js'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { generateCandidateCode } from '../services/enrollmentCode.js'
import { isValidCpf, normalizeCpf } from '../lib/cpf.js'
import { resolveDefaultTeamId } from '../services/teamRouting.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { ensureLeadForRegistration } from '../services/enrollmentLeadBackfill.js'
import { logTitularConsent } from './consent.js'
import { flagDuplicate } from '../services/dedup.js'
import { createAsaasPayment, createOrFindAsaasCustomer, parseAsaasConfig, isAsaasPaymentEvent, ASAAS_STATUS_MAP, createAsaasOrder, type AsaasOrderMethod } from '../services/paymentAsaas.js'
import { createPagarmePayment, createOrFindPagarmeCustomer, isPagarmePaymentEvent, parsePagarmeWebhookPayload, detectPagarmeEnvironment, createPagarmeOrder, type PagarmeConfig, type PagarmeOrderMethod } from '../services/paymentPagarme.js'
import { decryptToken } from '../services/cloudApi.js'
import { getConnectionPublicKey } from './paymentProviders.js'
import { syncChargeFromProvider, recordWebhookHit, updateWebhookHit } from '../services/paymentSync.js'
import { logSecurityEvent } from '../services/security.js'
import { CANDIDATE_SECRET } from '../lib/secrets.js'
import { redis } from '../lib/redis.js'
import { signCandidateToken, verifyCandidateToken, signMagicLink, verifyMagicLink } from '../lib/candidateAuth.js'
import { promises as fsp } from 'fs'
import { eventBus } from '../lib/eventBus.js'
import QRCode from 'qrcode'

// ─── Helpers ─────────────────────────────────────────────

// Resolve a stage de entrada do lead num funil. Se `preferredKey` existe e está
// ativa no funil, usa ela. Senão cai pra primeira stage ativa (menor `position`).
// Retorna null só se o funil não existe ou não tem stages — nesse caso o caller
// fica com 'NOVO' como último fallback (compatível com leads pré-funil).
async function resolveEntryStageKey(
  funnelId: number | null,
  preferredKey: string | null,
): Promise<string | null> {
  if (!funnelId) return preferredKey  // sem funil destino → mantém o preferido (ou null)
  if (preferredKey) {
    const exists = await prisma.stage.findFirst({
      where: { funnelId, key: preferredKey, active: true },
      select: { key: true },
    })
    if (exists) return exists.key
  }
  const first = await prisma.stage.findFirst({
    where: { funnelId, active: true },
    orderBy: { position: 'asc' },
    select: { key: true },
  })
  return first?.key || preferredKey || null
}

function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

// Schema mínimo default do formConfig quando o admin não envia nada.
function defaultFormConfig() {
  return {
    steps: [
      {
        id: 'step-personal',
        name: 'Dados pessoais',
        fields: [
          { type: 'text',  name: 'nome',     label: 'Nome completo', required: true },
          { type: 'email', name: 'email',    label: 'E-mail',        required: true },
          { type: 'phone', name: 'whatsapp', label: 'WhatsApp',      required: true },
          { type: 'cpf',   name: 'cpf',      label: 'CPF',           required: true },
        ],
      },
      {
        id: 'step-offering',
        name: 'Curso e oferta',
        fields: [
          { type: 'offering-picker', name: 'offeringId', label: 'Curso', required: true },
        ],
      },
    ],
  }
}

// Ao salvar portal com Asaas, garante que paymentConfig tenha um webhookToken
// único (usado como parte da URL do webhook: /api/public/payment-webhook/asaas/:token).
function ensurePaymentConfigToken(provider: string | null | undefined, raw: any): any {
  if (!provider || provider === 'manual') return raw || null
  const cfg = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!cfg.webhookToken) {
    cfg.webhookToken = crypto.randomBytes(24).toString('hex')
  }
  return cfg
}

// Diretório base de uploads (compartilhado com appearance/enrollment-docs).
const _portalUploadsBase = (() => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return join(__dirname, '../../../uploads', 'portals')
})()

// Aplica os campos `brand*` recebidos no body em `data` (mutação).
// Usado por POST (create) e PUT (update parcial). `mode='create'` força default.
//
// IMPORTANTE: NÃO inclui `brandLogoUrl`, `brandFaviconUrl` e `brandHeroUrl`.
// Esses 3 campos são gerenciados EXCLUSIVAMENTE pelos endpoints /upload
// (POST adiciona, DELETE remove). Permitir que o PUT geral mexa nessas URLs
// causa race condition: o frontend pode enviar `null` no save logo após um
// upload e zerar a URL recém-gravada pelo endpoint dedicado.
function applyBrandFields(body: any, data: any, mode: 'create' | 'update'): void {
  const FONTS = new Set(['inter', 'roboto', 'poppins', 'system'])
  const RADIUS = new Set(['sharp', 'medium', 'rounded'])
  const setStr = (k: string, max: number) => {
    if (body[k] === undefined) return
    const v = body[k]
    data[k] = v == null || v === '' ? null : String(v).slice(0, max)
  }
  setStr('brandLogoLink', 500)
  if (body.brandPrimaryColor !== undefined) {
    const v = String(body.brandPrimaryColor || '').trim()
    data.brandPrimaryColor = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null
  }
  if (body.brandHeroEnabled !== undefined) data.brandHeroEnabled = !!body.brandHeroEnabled
  else if (mode === 'create') data.brandHeroEnabled = true
  setStr('brandHeroTitle', 191)
  setStr('brandHeroSubtitle', 500)
  if (body.brandHeroOverlayOpacity !== undefined) {
    const n = parseInt(body.brandHeroOverlayOpacity)
    data.brandHeroOverlayOpacity = Number.isFinite(n) ? Math.max(0, Math.min(80, n)) : null
  }
  if (body.brandFooterText !== undefined) data.brandFooterText = body.brandFooterText || null
  if (body.brandFontFamily !== undefined) {
    const v = String(body.brandFontFamily || '').toLowerCase()
    data.brandFontFamily = FONTS.has(v) ? v : null
  }
  if (body.brandRadiusScale !== undefined) {
    const v = String(body.brandRadiusScale || '').toLowerCase()
    data.brandRadiusScale = RADIUS.has(v) ? v : null
  }
}

async function resolveUniquePortalSlug(requested: string | null | undefined, fallbackSeed: string, excludeId: number | null): Promise<string | null> {
  const base = requested ? slugify(requested) : slugify(fallbackSeed)
  if (!base || base.length < 3) return null
  let candidate = base
  let n = 1
  while (true) {
    const exists = await prisma.enrollmentPortal.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!exists) return candidate
    n++
    candidate = `${base}-${n}`
    if (n > 50) return null
  }
}

// Persiste 1 EnrollmentPaymentMethod com os dados do método ativo.
// Usado pelo /payment-init (checkout transparente) — não inflar EnrollmentRegistration.
async function persistPaymentMethod(input: {
  registrationId: number
  provider: string
  method: string
  externalId: string | null
  status: string
  amount: number
  dueDate: Date
  expiresAt?: Date | undefined
  pixQrCode?: string | undefined
  pixQrCodeUrl?: string | undefined
  boletoLine?: string | undefined
  boletoBarcode?: string | undefined
  boletoPdfUrl?: string | undefined
  boletoDueAt?: Date | undefined
  cardLastDigits?: string | undefined
  cardBrand?: string | undefined
}) {
  return prisma.enrollmentPaymentMethod.create({
    data: {
      registrationId: input.registrationId,
      provider: input.provider,
      method: input.method,
      externalId: input.externalId,
      status: input.status,
      amount: input.amount,
      expiresAt: input.expiresAt ?? input.dueDate,
      qrCode: input.pixQrCode ?? null,
      qrCodeUrl: input.pixQrCodeUrl ?? null,
      boletoLine: input.boletoLine ?? null,
      boletoBarcode: input.boletoBarcode ?? null,
      boletoPdfUrl: input.boletoPdfUrl ?? null,
      boletoDueAt: input.boletoDueAt ?? null,
      cardLastDigits: input.cardLastDigits ?? null,
      cardBrand: input.cardBrand ?? null,
    },
  })
}

function serializePaymentMethod(m: any) {
  return {
    id: m.id,
    method: m.method,
    provider: m.provider,
    status: m.status,
    amount: m.amount ? Number(m.amount) : null,
    expiresAt: m.expiresAt,
    qrCode: m.qrCode,
    qrCodeUrl: m.qrCodeUrl,
    boletoLine: m.boletoLine,
    boletoBarcode: m.boletoBarcode,
    boletoPdfUrl: m.boletoPdfUrl,
    boletoDueAt: m.boletoDueAt,
    cardLastDigits: m.cardLastDigits,
    cardBrand: m.cardBrand,
    lastErrorMessage: m.lastErrorMessage,
    paidAt: m.paidAt,
    createdAt: m.createdAt,
  }
}

// ─── Rotas ───────────────────────────────────────────────

export async function enrollmentPortalsRoutes(app: FastifyInstance) {

  // GET /api/admin/enrollment-portals — listar
  app.get('/api/admin/enrollment-portals', { preHandler: authMiddleware }, async () => {
    const portals = await prisma.enrollmentPortal.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, nome: true } },
        team: { select: { id: true, name: true, color: true } },
        _count: { select: { registrations: true } },
      },
    })
    return { portals }
  })

  // GET /api/admin/enrollment-portals/:id — detalhe
  app.get('/api/admin/enrollment-portals/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const portal = await prisma.enrollmentPortal.findUnique({
      where: { id: parseInt(id) },
      include: {
        unit: { select: { id: true, nome: true } },
        team: { select: { id: true, name: true, color: true } },
        landingPage: { select: { id: true, slug: true, title: true, status: true } },
      },
    })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })
    return { portal }
  })

  // GET /api/admin/enrollment-portals/:id/qrcode.(png|svg)?size=N
  // Gera QR Code da URL pública do portal (usa customDomain se houver).
  app.get('/api/admin/enrollment-portals/:id/qrcode.:ext', { preHandler: authMiddleware }, async (req, reply) => {
    const { id, ext } = req.params as { id: string; ext: string }
    const q = req.query as any
    const fmt = ext === 'svg' ? 'svg' : 'png'
    const size = Math.max(128, Math.min(parseInt(q.size) || 512, 2048))

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, slug: true, customDomain: true },
    })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })

    const base = process.env.APP_URL || `${req.protocol}://${req.headers.host}`
    const url = portal.customDomain
      ? `https://${portal.customDomain}/${portal.slug}`
      : `${base}/portal/${portal.slug}`

    if (fmt === 'svg') {
      const svg = await QRCode.toString(url, { type: 'svg', width: size, margin: 2, errorCorrectionLevel: 'M' })
      reply.header('Content-Type', 'image/svg+xml')
      reply.header('Content-Disposition', `inline; filename="qr-${portal.slug}.svg"`)
      return reply.send(svg)
    }
    const buf = await QRCode.toBuffer(url, { type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M' })
    reply.header('Content-Type', 'image/png')
    reply.header('Content-Disposition', `inline; filename="qr-${portal.slug}.png"`)
    return reply.send(buf)
  })

  // POST /api/admin/enrollment-portals — criar
  app.post('/api/admin/enrollment-portals', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const user = (req as any).user as JwtPayload

    if (!body?.nome || !body?.unitId) {
      return reply.code(400).send({ error: 'Nome e unidade são obrigatórios' })
    }

    const slug = await resolveUniquePortalSlug(body.slug, body.nome, null)
    if (!slug) return reply.code(400).send({ error: 'Slug inválido ou em uso' })

    // Validação mínima de selectionProcessIds
    const processIds = Array.isArray(body.selectionProcessIds) ? body.selectionProcessIds.map((x: any) => parseInt(x)).filter(Boolean) : []

    // formMode + continuação: portais 'interest' precisam apontar para um portal
    // 'full' destino (continuationPortalId). Validamos antes de criar.
    const formMode = body.formMode === 'interest' ? 'interest' : 'full'
    let continuationPortalId: number | null = null
    if (formMode === 'interest') {
      const cId = body.continuationPortalId ? parseInt(body.continuationPortalId) : null
      if (!cId) return reply.code(400).send({ error: 'Portal de interesse precisa de um portal de continuação selecionado' })
      const cont = await prisma.enrollmentPortal.findUnique({ where: { id: cId }, select: { id: true, formMode: true } })
      if (!cont || cont.formMode !== 'full') return reply.code(400).send({ error: 'Portal de continuação inválido (deve ser um portal completo)' })
      continuationPortalId = cId
    }
    const magicLinkTtlDays = body.magicLinkTtlDays ? Math.max(1, Math.min(180, parseInt(body.magicLinkTtlDays))) : 30

    const createData: any = {
      slug,
      nome: body.nome,
      unitId: parseInt(body.unitId),
      selectionProcessIds: processIds as any,
      landingPageId: body.landingPageId ? parseInt(body.landingPageId) : null,
      formConfig: body.formConfig || defaultFormConfig(),
      formMode,
      continuationPortalId,
      magicLinkTtlDays,
    }
    applyBrandFields(body, createData, 'create')
    const portal = await prisma.enrollmentPortal.create({
      data: {
        ...createData,
        alwaysCreateNew: !!body.alwaysCreateNew,
        ctaBehavior: body.ctaBehavior === 'redirect' ? 'redirect' : 'message',
        ctaTarget: body.ctaTarget || null,
        ctaMessage: body.ctaMessage || 'Inscrição recebida com sucesso! Em breve enviaremos as próximas instruções.',
        captchaType: body.captchaType || null,
        captchaSiteKey: body.captchaSiteKey || null,
        captchaSecret: body.captchaSecret || null,
        allowedLevelIds: body.allowedLevelIds || null,
        allowedCourseIds: body.allowedCourseIds || null,
        allowedCampusIds: body.allowedCampusIds || null,
        allowedModalityIds: body.allowedModalityIds || null,
        paymentProvider: body.paymentProvider || null,
        paymentConfig: ensurePaymentConfigToken(body.paymentProvider, body.paymentConfig),
        requirePayment: !!body.requirePayment,
        paymentDeadlineHours: body.paymentDeadlineHours ? parseInt(body.paymentDeadlineHours) : 48,
        paymentMode: body.paymentMode === 'transparent' ? 'transparent' : 'link',
        customDomain: body.customDomain || null,
        metaTitle: body.metaTitle || null,
        metaDescription: body.metaDescription || null,
        ogImageUrl: body.ogImageUrl || null,
        customCss: body.customCss || null,
        customHeadJs: body.customHeadJs || null,
        customBodyJs: body.customBodyJs || null,
        pixelConfig: body.pixelConfig || null,
        teamId: body.teamId ? parseInt(body.teamId) : null,
        funnelId: body.funnelId ? parseInt(body.funnelId) : null,
        stageKey: body.stageKey || null,
        docsCompleteStageKey: body.docsCompleteStageKey || null,
        finalApprovalStageKey: body.finalApprovalStageKey || null,
        paymentConnectionId: body.paymentConnectionId ? parseInt(body.paymentConnectionId) : null,
        codePrefix: body.codePrefix || 'MAT',
        active: body.active !== false,
        createdBy: user.userId,
      },
    })
    return reply.code(201).send({ ok: true, portal })
  })

  // PUT /api/admin/enrollment-portals/:id — atualizar
  app.put('/api/admin/enrollment-portals/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}

    if (body.nome !== undefined) data.nome = body.nome
    if (body.slug !== undefined) {
      const slug = await resolveUniquePortalSlug(body.slug, body.nome || '', parseInt(id))
      if (!slug) return reply.code(400).send({ error: 'Slug inválido ou em uso' })
      data.slug = slug
    }
    if (body.unitId !== undefined) data.unitId = parseInt(body.unitId)
    if (body.selectionProcessIds !== undefined) {
      data.selectionProcessIds = Array.isArray(body.selectionProcessIds)
        ? body.selectionProcessIds.map((x: any) => parseInt(x)).filter(Boolean)
        : []
    }
    if (body.landingPageId !== undefined) data.landingPageId = body.landingPageId ? parseInt(body.landingPageId) : null
    if (body.formConfig !== undefined) data.formConfig = body.formConfig
    if (body.alwaysCreateNew !== undefined) data.alwaysCreateNew = !!body.alwaysCreateNew
    if (body.ctaBehavior !== undefined) data.ctaBehavior = body.ctaBehavior === 'redirect' ? 'redirect' : 'message'
    if (body.ctaTarget !== undefined) data.ctaTarget = body.ctaTarget || null
    if (body.ctaMessage !== undefined) data.ctaMessage = body.ctaMessage || null
    if (body.captchaType !== undefined) data.captchaType = body.captchaType || null
    if (body.captchaSiteKey !== undefined) data.captchaSiteKey = body.captchaSiteKey || null
    if (body.captchaSecret !== undefined) data.captchaSecret = body.captchaSecret || null
    if (body.allowedLevelIds !== undefined) data.allowedLevelIds = body.allowedLevelIds || null
    if (body.allowedCourseIds !== undefined) data.allowedCourseIds = body.allowedCourseIds || null
    if (body.allowedCampusIds !== undefined) data.allowedCampusIds = body.allowedCampusIds || null
    if (body.allowedModalityIds !== undefined) data.allowedModalityIds = body.allowedModalityIds || null
    if (body.paymentProvider !== undefined) data.paymentProvider = body.paymentProvider || null
    if (body.paymentConfig !== undefined) {
      const provider = body.paymentProvider !== undefined ? body.paymentProvider : undefined
      // Se config foi explicitamente enviada, ensure token; lê o provider atual se não veio no body
      const currentProvider = provider ?? (await prisma.enrollmentPortal.findUnique({ where: { id: parseInt(id) }, select: { paymentProvider: true } }))?.paymentProvider
      data.paymentConfig = ensurePaymentConfigToken(currentProvider as any, body.paymentConfig)
    }
    if (body.requirePayment !== undefined) data.requirePayment = !!body.requirePayment
    if (body.paymentDeadlineHours !== undefined) data.paymentDeadlineHours = parseInt(body.paymentDeadlineHours) || 48
    if (body.paymentMode !== undefined) {
      data.paymentMode = body.paymentMode === 'transparent' ? 'transparent' : 'link'
    }
    if (body.formMode !== undefined) {
      const fm = body.formMode === 'interest' ? 'interest' : 'full'
      data.formMode = fm
      // Quando vira 'full', limpa continuationPortalId (não faz sentido).
      if (fm === 'full') data.continuationPortalId = null
    }
    if (body.continuationPortalId !== undefined) {
      const cId = body.continuationPortalId ? parseInt(body.continuationPortalId) : null
      if (cId) {
        const cont = await prisma.enrollmentPortal.findUnique({ where: { id: cId }, select: { id: true, formMode: true } })
        if (!cont || cont.formMode !== 'full') return reply.code(400).send({ error: 'Portal de continuação inválido' })
        if (cId === parseInt(id)) return reply.code(400).send({ error: 'Portal não pode continuar nele mesmo' })
      }
      data.continuationPortalId = cId
    }
    if (body.magicLinkTtlDays !== undefined) {
      data.magicLinkTtlDays = Math.max(1, Math.min(180, parseInt(body.magicLinkTtlDays) || 30))
    }
    if (body.customDomain !== undefined) data.customDomain = body.customDomain || null
    if (body.metaTitle !== undefined) data.metaTitle = body.metaTitle || null
    if (body.metaDescription !== undefined) data.metaDescription = body.metaDescription || null
    if (body.ogImageUrl !== undefined) data.ogImageUrl = body.ogImageUrl || null
    if (body.customCss !== undefined) data.customCss = body.customCss || null
    if (body.customHeadJs !== undefined) data.customHeadJs = body.customHeadJs || null
    if (body.customBodyJs !== undefined) data.customBodyJs = body.customBodyJs || null
    if (body.pixelConfig !== undefined) data.pixelConfig = body.pixelConfig || null
    if (body.teamId !== undefined) data.teamId = body.teamId ? parseInt(body.teamId) : null
    if (body.funnelId !== undefined) data.funnelId = body.funnelId ? parseInt(body.funnelId) : null
    if (body.stageKey !== undefined) data.stageKey = body.stageKey || null
    if (body.docsCompleteStageKey !== undefined) data.docsCompleteStageKey = body.docsCompleteStageKey || null
    if (body.finalApprovalStageKey !== undefined) data.finalApprovalStageKey = body.finalApprovalStageKey || null
    if (body.paymentConnectionId !== undefined) data.paymentConnectionId = body.paymentConnectionId ? parseInt(body.paymentConnectionId) : null
    if (body.codePrefix !== undefined) data.codePrefix = body.codePrefix || 'MAT'
    if (body.active !== undefined) data.active = !!body.active
    if (body.publishedAt !== undefined) data.publishedAt = body.publishedAt ? new Date(body.publishedAt) : null

    applyBrandFields(body, data, 'update')

    try {
      const portal = await prisma.enrollmentPortal.update({ where: { id: parseInt(id) }, data })
      return { ok: true, portal }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  // POST /api/admin/enrollment-portals/:id/branding — atualiza só os campos visuais
  // Útil para o preview ao vivo (debounced) gravar parcialmente sem disparar o
  // full update da tela. Não toca em formConfig/payment/etc.
  app.post('/api/admin/enrollment-portals/:id/branding', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const data: any = {}
    applyBrandFields(body, data, 'update')
    if (Object.keys(data).length === 0) return { ok: true, portal: null }
    try {
      const portal = await prisma.enrollmentPortal.update({ where: { id: parseInt(id) }, data })
      return { ok: true, portal }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  // POST /api/admin/enrollment-portals/:id/upload?kind=logo|favicon|hero
  // Multipart com 1 arquivo. Salva em uploads/portals/{id}/{kind}.{ext}, popula
  // o respectivo campo brand* e devolve a URL pública.
  app.post('/api/admin/enrollment-portals/:id/upload', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const portalId = parseInt(id)
    if (!portalId) return reply.code(400).send({ error: 'ID inválido' })

    const kind = String((req.query as any)?.kind || '').toLowerCase()
    const KINDS: Record<string, { field: string; mimes: string[]; maxBytes: number; allowedExts: string[] }> = {
      logo:    { field: 'brandLogoUrl',    mimes: ['image/png','image/jpeg','image/webp','image/svg+xml','image/gif'], maxBytes: 1024 * 1024, allowedExts: ['.png','.jpg','.jpeg','.webp','.svg','.gif'] },
      favicon: { field: 'brandFaviconUrl', mimes: ['image/png','image/x-icon','image/vnd.microsoft.icon','image/svg+xml'], maxBytes: 200 * 1024, allowedExts: ['.png','.ico','.svg'] },
      hero:    { field: 'brandHeroUrl',    mimes: ['image/png','image/jpeg','image/webp'], maxBytes: 4 * 1024 * 1024, allowedExts: ['.png','.jpg','.jpeg','.webp'] },
    }
    const spec = KINDS[kind]
    if (!spec) return reply.code(400).send({ error: 'kind deve ser logo, favicon ou hero' })

    const portal = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { id: true } })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    const ext = extname(data.filename || '').toLowerCase()
    if (!spec.allowedExts.includes(ext)) {
      return reply.code(400).send({ error: `Formato não suportado para ${kind}: use ${spec.allowedExts.join(', ')}` })
    }
    if (data.mimetype && !spec.mimes.includes(data.mimetype)) {
      return reply.code(400).send({ error: `MIME não permitido: ${data.mimetype}` })
    }

    const portalDir = join(_portalUploadsBase, String(portalId))
    if (!existsSync(portalDir)) mkdirSync(portalDir, { recursive: true })

    // Remove versão anterior (qualquer extensão), evita acumular órfãos.
    for (const oldExt of spec.allowedExts) {
      const old = join(portalDir, `${kind}${oldExt}`)
      if (existsSync(old)) await unlink(old).catch(() => {})
    }

    const fileName = `${kind}${ext}`
    const filePath = join(portalDir, fileName)
    let total = 0
    // Buffer + validação de magic bytes + sanitização de SVG antes de gravar (A8/M6).
    try {
      const raw = await bufferMultipart(data.file, spec.maxBytes)
      total = raw.length
      const safe = validateUploadContent(raw, ext.slice(1), { allowSvg: ext === '.svg' })
      await fsp.writeFile(filePath, safe)
    } catch (err: any) {
      await unlink(filePath).catch(() => {})
      if (err instanceof UploadTooLargeError) {
        const mb = (spec.maxBytes / 1024 / 1024).toFixed(1)
        return reply.code(413).send({ error: `Arquivo muito grande (máximo ${mb}MB para ${kind})` })
      }
      if (err instanceof UploadValidationError) return reply.code(400).send({ error: err.message })
      return reply.code(500).send({ error: 'Falha ao salvar arquivo' })
    }

    // Cache-buster com mtime para forçar refresh em cdn/browser.
    const url = `/uploads/portals/${portalId}/${fileName}?v=${Date.now()}`
    const updateData: any = {}
    updateData[spec.field] = url
    await prisma.enrollmentPortal.update({ where: { id: portalId }, data: updateData })

    return { ok: true, url, kind, sizeBytes: total }
  })

  // DELETE /api/admin/enrollment-portals/:id/upload?kind=logo|favicon|hero
  app.delete('/api/admin/enrollment-portals/:id/upload', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const portalId = parseInt(id)
    const kind = String((req.query as any)?.kind || '').toLowerCase()
    const fieldMap: Record<string, string> = { logo: 'brandLogoUrl', favicon: 'brandFaviconUrl', hero: 'brandHeroUrl' }
    const field = fieldMap[kind]
    if (!field) return reply.code(400).send({ error: 'kind inválido' })

    const portalDir = join(_portalUploadsBase, String(portalId))
    if (existsSync(portalDir)) {
      for (const ext of ['.png','.jpg','.jpeg','.webp','.svg','.gif','.ico']) {
        const f = join(portalDir, `${kind}${ext}`)
        if (existsSync(f)) await unlink(f).catch(() => {})
      }
    }
    await prisma.enrollmentPortal.update({ where: { id: portalId }, data: { [field]: null } })
    return { ok: true }
  })

  // DELETE /api/admin/enrollment-portals/:id
  app.delete('/api/admin/enrollment-portals/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.enrollmentPortal.findUnique({ where: { id: parseInt(id) }, select: { nome: true, slug: true } })
    try {
      await prisma.enrollmentPortal.delete({ where: { id: parseInt(id) } })
      void logUserAudit({
        action: 'portal.deleted',
        targetType: 'portal',
        targetLabel: existing?.nome || existing?.slug || `Portal #${id}`,
        ...auditActor(req),
      })
      return { ok: true }
    } catch (err: any) {
      return reply.code(400).send({ error: 'Não foi possível excluir (há inscrições vinculadas)' })
    }
  })

  // POST /api/admin/enrollment-portals/:id/duplicate — clona portal completo
  // (config, branding, formConfig, permissões, pagamento, CRM). Reseta:
  // contadores, codeSequence, customDomain (1 domínio por portal), landingPageId
  // (relação @unique 1-1), publishedAt. Slug recebe sufixo "-copia" e nome "(cópia)";
  // se já houver colisão, resolveUniquePortalSlug auto-numera.
  app.post('/api/admin/enrollment-portals/:id/duplicate', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const src = await prisma.enrollmentPortal.findUnique({ where: { id: parseInt(id) } })
    if (!src) return reply.code(404).send({ error: 'Portal não encontrado' })

    const newSlug = await resolveUniquePortalSlug(`${src.slug}-copia`, src.nome, null)
    if (!newSlug) return reply.code(400).send({ error: 'Não foi possível gerar slug único para a cópia' })

    // Strip de campos que NÃO devem ser copiados
    const {
      id: _id,
      slug: _slug,
      nome: _nome,
      customDomain: _domain,
      sslStatus: _ssl,
      views: _v,
      submissions: _s,
      conversions: _c,
      codeSequence: _seq,
      publishedAt: _pub,
      createdAt: _cAt,
      updatedAt: _uAt,
      createdBy: _cBy,
      landingPageId: _lp,
      ...config
    } = src as any

    try {
      const portal = await prisma.enrollmentPortal.create({
        data: {
          ...config,
          slug: newSlug,
          nome: `${src.nome} (cópia)`,
          customDomain: null,
          sslStatus: null,
          views: 0,
          submissions: 0,
          conversions: 0,
          codeSequence: 0,
          publishedAt: null,
          landingPageId: null,
          createdBy: user.userId,
        },
      })
      return reply.code(201).send({ ok: true, portal })
    } catch (err: any) {
      req.log.error(`[enrollment-portals] duplicate failed: ${err.message}`)
      return reply.code(400).send({ error: err.message || 'Falha ao duplicar portal' })
    }
  })

  // ─── Inscrições (listagem admin) ─────────────────────────

  // GET /api/admin/enrollment-portals/:id/analytics — KPIs para dashboard
  app.get('/api/admin/enrollment-portals/:id/analytics', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as any
    const portalId = parseInt(id)
    const q = req.query as any
    // Aceita `from`/`to` (seletor de meses da tela) e mantém `days` para quem
    // ainda chama pela querystring antiga.
    const { resolvePeriod } = await import('../lib/period.js')
    const periodo = resolvePeriod(q, 30)
    const days = periodo.days
    const since = periodo.from
    const until = periodo.to

    const [portal, totalReg, paidReg, pendingReg, expiredReg, totalRevenue, byStatus, byDay, bySource] = await Promise.all([
      prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { views: true, submissions: true, conversions: true } }),
      prisma.enrollmentRegistration.count({ where: { portalId, createdAt: { gte: since, lte: until } } }),
      prisma.enrollmentRegistration.count({ where: { portalId, paymentStatus: 'paid', createdAt: { gte: since, lte: until } } }),
      prisma.enrollmentRegistration.count({ where: { portalId, status: 'pending', createdAt: { gte: since, lte: until } } }),
      prisma.enrollmentRegistration.count({ where: { portalId, status: 'expired', createdAt: { gte: since, lte: until } } }),
      prisma.enrollmentRegistration.aggregate({
        _sum: { paymentAmount: true },
        where: { portalId, paymentStatus: 'paid', createdAt: { gte: since, lte: until } },
      }),
      prisma.enrollmentRegistration.groupBy({
        by: ['status'],
        where: { portalId, createdAt: { gte: since, lte: until } },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ day: string; total: bigint; paid: bigint }>>`
        SELECT DATE(createdAt) as day, COUNT(*) as total,
               SUM(CASE WHEN paymentStatus='paid' THEN 1 ELSE 0 END) as paid
        FROM bychat_enrollment_registrations
        WHERE portalId = ${portalId} AND createdAt >= ${since} AND createdAt <= ${until}
        GROUP BY DATE(createdAt) ORDER BY day DESC LIMIT ${days}
      `,
      prisma.enrollmentRegistration.groupBy({
        by: ['utmSource'],
        where: { portalId, createdAt: { gte: since, lte: until } },
        _count: { _all: true },
      }),
    ])

    return {
      views: portal?.views || 0,
      submissions: portal?.submissions || 0,
      conversions: portal?.conversions || 0,
      conversionRate: (portal?.submissions || 0) > 0 ? ((portal?.conversions || 0) / (portal?.submissions || 1)) * 100 : 0,
      period: { days, since },
      registrations: { total: totalReg, paid: paidReg, pending: pendingReg, expired: expiredReg },
      revenue: totalRevenue._sum.paymentAmount || 0,
      byStatus: byStatus.map(x => ({ status: x.status, count: x._count._all })),
      byDay: byDay.map(x => ({ day: String(x.day).slice(0, 10), total: Number(x.total), paid: Number(x.paid) })),
      bySource: bySource.map(x => ({ source: x.utmSource || '(direto)', count: x._count._all })).sort((a, b) => b.count - a.count).slice(0, 10),
    }
  })

  app.get('/api/admin/enrollment-portals/:id/registrations', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as any
    const q = req.query as any
    const portalId = parseInt(id)
    const limit  = Math.min(Math.max(parseInt(q.limit)  || 50, 1), 200)
    const offset = Math.max(parseInt(q.offset) || 0, 0)
    const where: any = { portalId }
    if (q.status) where.status = q.status
    if (q.paymentStatus) where.paymentStatus = q.paymentStatus
    if (q.leadStatus) where.lead = { status: q.leadStatus }
    if (q.utmSource) where.utmSource = q.utmSource
    if (q.utmMedium) where.utmMedium = q.utmMedium
    if (q.utmCampaign) where.utmCampaign = q.utmCampaign
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {}
      if (q.dateFrom) {
        const d = new Date(q.dateFrom)
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d
      }
      if (q.dateTo) {
        const d = new Date(q.dateTo)
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999)
          where.createdAt.lte = d
        }
      }
    }
    if (q.search) {
      const s = String(q.search).trim()
      if (s) {
        where.OR = [
          { candidateCode: { contains: s } },
          { lead: { nome: { contains: s } } },
          { lead: { email: { contains: s } } },
          { lead: { whatsapp: { contains: s.replace(/\D/g, '') || s } } },
        ]
      }
    }

    const [portal, items, total, todayCount, weekCount, conversions] = await Promise.all([
      prisma.enrollmentPortal.findUnique({
        where: { id: portalId },
        select: {
          id: true, nome: true, slug: true, requirePayment: true, paymentConnectionId: true,
          funnelId: true, stageKey: true,
          funnel: {
            select: {
              id: true, name: true,
              stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true, position: true } },
            },
          },
        },
      }),
      prisma.enrollmentRegistration.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
        include: {
          lead: { select: { id: true, nome: true, email: true, whatsapp: true, status: true, funnelId: true } },
          processRegistration: { select: { id: true, status: true, offering: { select: { nome: true } } } },
          _count: { select: { documents: true } },
        },
      }),
      prisma.enrollmentRegistration.count({ where }),
      prisma.enrollmentRegistration.count({
        where: { portalId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
      prisma.enrollmentRegistration.count({
        where: { portalId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      }),
      prisma.enrollmentRegistration.count({
        where: { portalId, status: { in: ['enrolled', 'approved'] } },
      }),
    ])

    return { items, total, portal, kpis: { total, today: todayCount, week: weekCount, conversions } }
  })

  // GET /api/admin/enrollment-portals/:id/registrations.csv — exportação
  app.get('/api/admin/enrollment-portals/:id/registrations.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const where: any = { portalId: parseInt(id) }
    if (q.status) where.status = q.status
    if (q.paymentStatus) where.paymentStatus = q.paymentStatus
    if (q.utmSource) where.utmSource = q.utmSource
    if (q.utmMedium) where.utmMedium = q.utmMedium
    if (q.utmCampaign) where.utmCampaign = q.utmCampaign
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {}
      if (q.dateFrom) {
        const d = new Date(q.dateFrom)
        if (!Number.isNaN(d.getTime())) where.createdAt.gte = d
      }
      if (q.dateTo) {
        const d = new Date(q.dateTo)
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999)
          where.createdAt.lte = d
        }
      }
    }
    if (q.search) {
      const s = String(q.search).trim()
      if (s) {
        where.OR = [
          { candidateCode: { contains: s } },
          { lead: { nome: { contains: s } } },
          { lead: { email: { contains: s } } },
          { lead: { whatsapp: { contains: s.replace(/\D/g, '') || s } } },
        ]
      }
    }

    const items = await prisma.enrollmentRegistration.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 10000,
      include: {
        lead: { select: { nome: true, email: true, whatsapp: true, cidade: true } },
        processRegistration: { select: { offering: { select: { nome: true } } } },
      },
    })
    const portal = await prisma.enrollmentPortal.findUnique({ where: { id: parseInt(id) }, select: { slug: true, nome: true } })

    const cols = ['Código', 'Nome', 'CPF', 'Email', 'WhatsApp', 'Cidade', 'Curso', 'Status', 'Pagamento', 'Valor', 'Pago em', 'UTM Source', 'Criado em']
    const escCsv = (s: any) => {
      if (s == null) return ''
      const str = String(s).replace(/"/g, '""')
      return `"${str}"`
    }
    const lines = [cols.map(c => escCsv(c)).join(',')]
    for (const r of items) {
      const fd = r.formData as any || {}
      lines.push([
        escCsv(r.candidateCode),
        escCsv(r.lead?.nome || fd.nome || ''),
        escCsv(fd.cpf || ''),
        escCsv(r.lead?.email || fd.email || ''),
        escCsv(r.lead?.whatsapp || fd.whatsapp || ''),
        escCsv(r.lead?.cidade || fd.cidade || ''),
        escCsv(r.processRegistration?.offering?.nome || ''),
        escCsv(r.status),
        escCsv(r.paymentStatus || ''),
        escCsv(r.paymentAmount ? Number(r.paymentAmount).toFixed(2) : ''),
        escCsv(r.paymentPaidAt ? new Date(r.paymentPaidAt).toISOString() : ''),
        escCsv(r.utmSource || ''),
        escCsv(new Date(r.createdAt).toISOString()),
      ].join(','))
    }

    const filename = `inscricoes-${portal?.slug || id}-${new Date().toISOString().slice(0,10)}.csv`
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      // BOM pra Excel abrir acentos corretamente
      .send('﻿' + lines.join('\n'))
  })

  // GET /api/admin/enrollment-registrations/:id/receipt.pdf — comprovante imprimível
  // Retorna HTML otimizado para impressão (navegador salva como PDF via Ctrl+P)
  app.get('/api/admin/enrollment-registrations/:id/receipt.pdf', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      include: {
        lead: true,
        portal: {
          include: {
            unit: true,
            funnel: { include: { stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true } } } },
          },
        },
        processRegistration: { include: { offering: { include: { course: true, campuses: { include: { campus: true } } } } } },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    reply.type('text/html').send(renderReceiptHtml(reg))
  })

  // GET /api/candidate/receipt.pdf — mesmo comprovante mas via sessão de candidato
  app.get('/api/candidate/receipt.pdf', async (req, reply) => {
    const auth = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '')
    const { verifyCandidateToken } = await import('./candidatePortal.js') as any
    // Workaround: reimplementa verificação inline pra evitar import circular
    const crypto = await import('crypto')
    const secret = CANDIDATE_SECRET
    if (!auth.includes('.')) return reply.code(401).send({ error: 'Sessão inválida' })
    const [b, s] = auth.split('.')
    const expected = crypto.createHmac('sha256', secret).update(b).digest('base64url')
    if (s !== expected) return reply.code(401).send({ error: 'Sessão inválida' })
    let payload: any
    try { payload = JSON.parse(Buffer.from(b, 'base64url').toString()) } catch { return reply.code(401).send({ error: 'Sessão inválida' }) }
    if (!payload?.exp || payload.exp < Date.now()) return reply.code(401).send({ error: 'Sessão expirada' })

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: payload.enrollmentId },
      include: {
        lead: true,
        portal: {
          include: {
            unit: true,
            funnel: { include: { stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true } } } },
          },
        },
        processRegistration: { include: { offering: { include: { course: true, campuses: { include: { campus: true } } } } } },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    reply.type('text/html').send(renderReceiptHtml(reg))
  })

  // PUT /api/admin/enem-imports/:id — override humano de notas ENEM extraídas
  // Permite operador corrigir notas que a IA extraiu errado, ou forçar classificação
  // quando a automação não tem corte configurado.
  app.put('/api/admin/enem-imports/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user
    if (!['SUPERADMIN','ADMIN','MANAGER'].includes(user?.role)) return reply.code(403).send({ error: 'Sem permissão' })

    const { id } = req.params as any
    const body = (req.body as any) || {}
    const { validateEnemImport } = await import('../services/enemClassification.js')

    const toNum = (v: any) => v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null)
    try {
      const updated = await validateEnemImport(parseInt(id), { userId: user.userId, name: user.name || '' }, {
        cienciasHumanas: body.cienciasHumanas !== undefined ? toNum(body.cienciasHumanas) : undefined,
        cienciasNatureza: body.cienciasNatureza !== undefined ? toNum(body.cienciasNatureza) : undefined,
        linguagens: body.linguagens !== undefined ? toNum(body.linguagens) : undefined,
        matematica: body.matematica !== undefined ? toNum(body.matematica) : undefined,
        redacao: body.redacao !== undefined ? toNum(body.redacao) : undefined,
        passed: body.passed === true ? true : body.passed === false ? false : body.passed === null ? null : undefined,
        validationNote: body.validationNote || undefined,
      })

      // Propaga pra ProcessRegistration se o import veio com registrationId
      if (updated.registrationId) {
        const reg = await prisma.enrollmentRegistration.findUnique({
          where: { id: updated.registrationId },
          select: { processRegistrationId: true },
        })
        if (reg?.processRegistrationId && updated.mediaSimples != null) {
          const pr = await prisma.processRegistration.findUnique({ where: { id: reg.processRegistrationId } })
          if (pr) {
            const updates: any = { notaClassificacao: updated.mediaSimples }
            let newStatus = pr.status
            if (updated.passed === true) { newStatus = 'classificado'; updates.status = 'classificado'; updates.classificadoEm = new Date() }
            else if (updated.passed === false) { newStatus = 'reprovado'; updates.status = 'reprovado' }
            if (newStatus !== pr.status) {
              await prisma.processRegistration.update({ where: { id: pr.id }, data: updates })
              await prisma.processRegistrationStatusLog.create({
                data: {
                  registrationId: pr.id, fromStatus: pr.status, toStatus: newStatus,
                  actorId: user.userId, actorName: user.name || 'Operador',
                  observacao: `Override humano de notas ENEM: média ${updated.mediaSimples.toFixed(1)}${body.validationNote ? ` — ${body.validationNote}` : ''}`,
                },
              }).catch(() => {})
            } else {
              await prisma.processRegistration.update({ where: { id: pr.id }, data: { notaClassificacao: updated.mediaSimples } })
            }
          }
        }
      }

      return { ok: true, import: updated }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Erro ao atualizar import' })
    }
  })

  // GET /api/admin/enrollment-registrations/:id — detalhe completo incluindo docs
  app.get('/api/admin/enrollment-registrations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      include: {
        lead: { select: { id: true, nome: true, email: true, whatsapp: true, cidade: true, segmento: true, status: true, funnelId: true } },
        portal: {
          select: {
            id: true, nome: true, slug: true, requirePayment: true, funnelId: true,
            funnel: { select: { id: true, name: true, stages: { orderBy: { position: 'asc' }, select: { key: true, name: true, color: true } } } },
          },
        },
        processRegistration: {
          include: { offering: { select: { nome: true, course: { select: { nome: true } } } } },
        },
        documents: {
          orderBy: { uploadedAt: 'desc' },
          include: { type: { select: { code: true, name: true, category: true } } },
        },
        enemScoreImports: { orderBy: { createdAt: 'desc' } },
        paymentMethods: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    return { registration: reg }
  })

  // POST /api/admin/enrollment-registrations/:id/cancel — cancelar inscrição (admin)
  app.post('/api/admin/enrollment-registrations/:id/cancel', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const reason = String(body.reason || '').trim() || null

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, status: true, leadId: true, candidateCode: true, portal: { select: { nome: true } } },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.status === 'cancelled') return reply.code(400).send({ error: 'Inscrição já está cancelada' })
    if (reg.status === 'enrolled') return reply.code(400).send({ error: 'Inscrição já matriculada não pode ser cancelada' })

    const updated = await prisma.enrollmentRegistration.update({
      where: { id: reg.id },
      data: { status: 'cancelled' },
    })

    if (reg.leadId) {
      const u = (req as any).user as JwtPayload | undefined
      logEvent({
        leadId: reg.leadId,
        type: EVENT_TYPES.ANNOTATION_SAVED,
        category: 'operator',
        title: `Inscrição ${reg.candidateCode} cancelada`,
        description: reason ? `Motivo: ${reason}` : 'Cancelamento manual pelo admin',
        actorType: 'operator',
        userId: u?.userId,
        userName: u?.name,
      })

      eventBus.emitDomain({
        type: 'enrollment.cancelled',
        leadId: reg.leadId,
        payload: {
          registrationId: reg.id,
          candidateCode: reg.candidateCode,
          portalNome: reg.portal?.nome ?? '',
          reason: reason ?? '',
        },
        timestamp: new Date(),
      })
    }

    return { ok: true, registration: updated }
  })

  // POST /api/admin/enrollment-registrations/:id/ensure-lead — cria ou re-vincula o Lead
  // de uma inscrição órfã (leadId nulo, ex.: lead apagado). Idempotente.
  app.post('/api/admin/enrollment-registrations/:id/ensure-lead', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: parseInt(id) }, select: { id: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const result = await ensureLeadForRegistration(reg.id)
    if (!result.leadId) return reply.code(422).send({ error: result.reason || 'Não foi possível criar/vincular o lead' })
    return { ok: true, ...result }
  })

  // Status válidos de uma inscrição (espelha STATUS_LABELS do frontend).
  const REGISTRATION_STATUSES = [
    'draft', 'pending', 'submitted', 'paid',
    'docs_uploaded', 'docs_reviewing', 'docs_approved', 'docs_rejected',
    'reviewing', 'approved', 'enrolled', 'rejected', 'cancelled', 'expired',
  ]

  // Normaliza o valor de pagamento vindo do body p/ Decimal | null.
  function parseAmount(v: unknown): number | null {
    if (v === undefined || v === null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  // POST /api/admin/enrollment-registrations — criar inscrição manualmente (admin).
  app.post('/api/admin/enrollment-registrations', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const u = (req as any).user as JwtPayload | undefined
    const portalId = body.portalId ? parseInt(body.portalId) : NaN
    if (!Number.isFinite(portalId)) return reply.code(400).send({ error: 'portalId é obrigatório' })

    const portal = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { id: true } })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })

    const status = body.status && REGISTRATION_STATUSES.includes(body.status) ? body.status : 'submitted'
    const formData = (body.formData && typeof body.formData === 'object') ? body.formData : {}
    const candidateCode = await generateCandidateCode(portalId)

    const reg = await prisma.enrollmentRegistration.create({
      data: {
        portalId,
        candidateCode,
        status,
        paymentStatus: body.paymentStatus || null,
        paymentAmount: parseAmount(body.paymentAmount),
        formData,
      },
      select: { id: true, candidateCode: true },
    })

    // Por padrão cria/vincula um Lead (igual à submissão pública). Best-effort:
    // se faltar contato no formData, ensureLeadForRegistration apenas pula.
    let leadId: number | null = null
    if (body.createLead !== false) {
      const r = await ensureLeadForRegistration(reg.id).catch(() => ({ leadId: null as number | null }))
      leadId = r.leadId
    }

    if (leadId) {
      logEvent({
        leadId,
        type: EVENT_TYPES.ANNOTATION_SAVED,
        category: 'operator',
        title: `Inscrição ${reg.candidateCode} criada manualmente`,
        description: `Status: ${status}`,
        actorType: 'operator',
        userId: u?.userId,
        userName: u?.name,
      })
    }

    const full = await prisma.enrollmentRegistration.findUnique({
      where: { id: reg.id },
      include: { lead: { select: { id: true, nome: true, email: true, whatsapp: true } } },
    })
    return reply.code(201).send({ ok: true, registration: full })
  })

  // PUT /api/admin/enrollment-registrations/:id — editar inscrição (admin).
  app.put('/api/admin/enrollment-registrations/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const u = (req as any).user as JwtPayload | undefined

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, status: true, leadId: true, candidateCode: true, formData: true },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const data: any = {}
    if (body.status !== undefined) {
      if (!REGISTRATION_STATUSES.includes(body.status)) return reply.code(400).send({ error: 'Status inválido' })
      data.status = body.status
    }
    if (body.paymentStatus !== undefined) data.paymentStatus = body.paymentStatus || null
    if (body.paymentAmount !== undefined) data.paymentAmount = parseAmount(body.paymentAmount)
    if (body.formData !== undefined && typeof body.formData === 'object' && body.formData) {
      // Merge sobre o formData existente (preserva campos não enviados pelo form do admin).
      data.formData = { ...((reg.formData as object) ?? {}), ...body.formData }
    }

    const updated = await prisma.enrollmentRegistration.update({
      where: { id: reg.id },
      data,
      include: { lead: { select: { id: true, nome: true, email: true, whatsapp: true } } },
    })

    if (reg.leadId) {
      const statusChanged = data.status && data.status !== reg.status
      logEvent({
        leadId: reg.leadId,
        type: EVENT_TYPES.ANNOTATION_SAVED,
        category: 'operator',
        title: `Inscrição ${reg.candidateCode} editada`,
        description: statusChanged ? `Status: ${reg.status} → ${data.status}` : 'Dados atualizados pelo admin',
        actorType: 'operator',
        userId: u?.userId,
        userName: u?.name,
      })
    }

    return { ok: true, registration: updated }
  })

  // DELETE /api/admin/enrollment-registrations/:id — excluir inscrição (admin).
  // Cascade remove filhos (documentos, métodos de pagamento, redações, etc.).
  app.delete('/api/admin/enrollment-registrations/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, status: true, candidateCode: true, leadId: true },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.status === 'enrolled') {
      return reply.code(409).send({ error: 'Inscrição matriculada não pode ser excluída — cancele antes.' })
    }

    await prisma.enrollmentRegistration.delete({ where: { id: reg.id } })

    if (reg.leadId) {
      const u = (req as any).user as JwtPayload | undefined
      logEvent({
        leadId: reg.leadId,
        type: EVENT_TYPES.ANNOTATION_SAVED,
        category: 'operator',
        title: `Inscrição ${reg.candidateCode} excluída`,
        actorType: 'operator',
        userId: u?.userId,
        userName: u?.name,
      })
    }

    void logUserAudit({
      action: 'registration.deleted',
      targetType: 'enrollment_registration',
      targetLabel: reg.candidateCode,
      changes: { status: reg.status, leadId: reg.leadId },
      ...auditActor(req),
    })

    return { ok: true }
  })

  // POST /api/admin/enrollment-registrations/:id/resend-link — admin reenvia link de continuação ao candidato
  app.post('/api/admin/enrollment-registrations/:id/resend-link', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      include: {
        lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
        portal: {
          select: {
            id: true, slug: true, nome: true, formMode: true, magicLinkTtlDays: true,
            continuationPortal: { select: { id: true, slug: true, nome: true, active: true } },
          },
        },
      },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (!reg.lead) return reply.code(400).send({ error: 'Inscrição sem lead vinculado' })
    if (!reg.portal) return reply.code(400).send({ error: 'Portal da inscrição não encontrado' })

    // Para portais 'interest', reenvia magic link p/ portal de continuação.
    // Para portais 'full', reenvia link direto da inscrição (candidato resume).
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    let continueUrl: string
    let continuationPortalNome: string
    let courseName = ''

    if (reg.portal.formMode === 'interest') {
      if (!reg.portal.continuationPortal || !reg.portal.continuationPortal.active) {
        return reply.code(400).send({ error: 'Portal de continuação não configurado' })
      }
      const ttlDays = reg.portal.magicLinkTtlDays || 30
      const token = signMagicLink(reg.lead.id, reg.portal.continuationPortal.slug, ttlDays)
      continueUrl = `${appUrl}/portal/${reg.portal.continuationPortal.slug}?t=${encodeURIComponent(token)}`
      continuationPortalNome = reg.portal.continuationPortal.nome
    } else {
      // Portal 'full': link com candidateCode para o candidato continuar a inscrição existente.
      continueUrl = `${appUrl}/portal/${reg.portal.slug}?c=${encodeURIComponent(reg.candidateCode)}`
      continuationPortalNome = reg.portal.nome
    }

    eventBus.emitDomain({
      type: 'enrollment.interest_submitted',
      leadId: reg.lead.id,
      payload: {
        nome: reg.lead.nome,
        email: reg.lead.email,
        whatsapp: reg.lead.whatsapp,
        portalNome: reg.portal.nome,
        courseName,
        continueUrl,
        continuationPortalNome,
        ttlDays: reg.portal.magicLinkTtlDays || 30,
        resend: true,
      },
      timestamp: new Date(),
    })

    return { ok: true, sent: true, url: continueUrl }
  })

  // GET /api/admin/enrollment-portals/check-slug?slug=X&excludeId=Y — checa disponibilidade
  app.get('/api/admin/enrollment-portals/check-slug', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const requested = String(q.slug || '').trim()
    const excludeId = q.excludeId ? parseInt(q.excludeId) : null
    if (!requested) return { available: false, reason: 'empty' }
    const slug = slugify(requested)
    if (!slug || slug.length < 3) return { available: false, reason: 'too-short', normalized: slug }
    const conflict = await prisma.enrollmentPortal.findFirst({
      where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (!conflict) return { available: true, normalized: slug }
    // Sugere alternativa única
    const suggestion = await resolveUniquePortalSlug(requested, requested, excludeId)
    return { available: false, reason: 'taken', normalized: slug, suggestion }
  })

  // ══════════════════════════════════════════════
  // PÚBLICO (sem auth) — Portal de matrículas
  // ══════════════════════════════════════════════

  // GET /api/public/portals/:slug — metadados para render do portal
  app.get('/api/public/portals/:slug', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { slug },
      select: {
        id: true, slug: true, nome: true,
        unitId: true, unit: { select: { id: true, nome: true } },
        selectionProcessIds: true,
        formConfig: true,
        formMode: true,
        continuationPortal: { select: { slug: true, nome: true } },
        ctaBehavior: true, ctaTarget: true, ctaMessage: true,
        captchaType: true, captchaSiteKey: true,
        allowedLevelIds: true, allowedCourseIds: true, allowedCampusIds: true, allowedModalityIds: true,
        requirePayment: true,
        metaTitle: true, metaDescription: true, ogImageUrl: true,
        customCss: true,
        pixelConfig: true,
        active: true,
        brandLogoUrl: true, brandLogoLink: true, brandFaviconUrl: true,
        brandPrimaryColor: true, brandHeroEnabled: true, brandHeroUrl: true,
        brandHeroTitle: true, brandHeroSubtitle: true, brandHeroOverlayOpacity: true,
        brandFooterText: true, brandFontFamily: true, brandRadiusScale: true,
        landingPage: { select: { id: true, slug: true, sections: true, globalStyles: true, customCss: true, customHead: true, status: true } },
      },
    })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    // Incrementa views (fire-and-forget)
    prisma.enrollmentPortal.update({ where: { id: portal.id }, data: { views: { increment: 1 } } }).catch(() => {})

    // Carrega ofertas filtradas pelos processos + filtros de permissão
    const processIds = (portal.selectionProcessIds as any) || []
    const offerings = await prisma.courseOffering.findMany({
      where: {
        active: true,
        ...(processIds.length > 0 ? { selectionProcessId: { in: processIds } } : { id: -1 }),
        ...(Array.isArray(portal.allowedLevelIds) && (portal.allowedLevelIds as any[]).length > 0 ? { levelId: { in: (portal.allowedLevelIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedCourseIds) && (portal.allowedCourseIds as any[]).length > 0 ? { courseId: { in: (portal.allowedCourseIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedModalityIds) && (portal.allowedModalityIds as any[]).length > 0 ? { modalityId: { in: (portal.allowedModalityIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedCampusIds) && (portal.allowedCampusIds as any[]).length > 0 ? { campuses: { some: { campusId: { in: (portal.allowedCampusIds as any[]).map(Number) } } } } : {}),
      },
      select: {
        id: true, nome: true, turno: true,
        valorMensalidade: true, valorMatricula: true,
        vagasMinimas: true, vagasMaximas: true,
        inicioCurso: true, terminoCurso: true,
        selectionProcessId: true,
        selectionProcess: {
          select: {
            id: true, slug: true, nome: true, taxaInscricao: true,
            entryMode: {
              select: {
                id: true, code: true, name: true, icon: true,
                evaluationType: true, requiresClassification: true,
                defaultFormExtras: true,
              },
            },
          },
        },
        course: { select: { id: true, nome: true } },
        level: { select: { id: true, nome: true } },
        modality: { select: { id: true, nome: true } },
        campuses: {
          select: {
            campus: { select: { id: true, nome: true, cidade: true, estado: true } },
          },
          ...(Array.isArray(portal.allowedCampusIds) && (portal.allowedCampusIds as any[]).length > 0 ? {
            where: { campusId: { in: (portal.allowedCampusIds as any[]).map(Number) } }
          } : {}),
        },
      },
    })

    return { portal, offerings }
  })

  // POST /api/public/portals/:slug/register — submeter inscrição
  app.post('/api/public/portals/:slug/register', async (req, reply) => {
    const { slug } = req.params as any
    const body = req.body as any
    const headers = req.headers as any

    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { slug },
      select: { id: true, nome: true, active: true, unitId: true, selectionProcessIds: true, teamId: true, funnelId: true, stageKey: true, alwaysCreateNew: true, captchaType: true, captchaSecret: true, formConfig: true, requirePayment: true, formMode: true, paymentMode: true },
    })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    // Portais 'interest' não aceitam submissão completa por aqui — eles têm
    // sua própria rota /interest. Defesa em profundidade: se alguém tentar
    // postar JSON no /register de um portal de interesse, recusa explicitamente.
    if (portal.formMode === 'interest') {
      return reply.code(400).send({ error: 'Este portal aceita apenas captura de interesse. Use /interest.' })
    }

    // ── Validação captcha ──
    if (portal.captchaType && portal.captchaSecret) {
      const { verifyCaptcha } = await import('../services/captcha.js')
      const captchaToken = String(body.captchaToken || '')
      const result = await verifyCaptcha(
        { type: portal.captchaType as any, secret: portal.captchaSecret },
        captchaToken,
        req.ip,
      )
      if (!result.ok) {
        req.log.warn(`[enrollment-register] captcha rejeitado: ${result.reason}`)
        return reply.code(403).send({ error: 'Verificação de segurança falhou. Tente novamente.' })
      }
    }

    // Campos mínimos do formData
    const fd = body.formData || {}
    const nome = String(fd.nome || '').trim()
    const email = String(fd.email || '').trim()
    const whatsapp = String(fd.whatsapp || '').trim()
    const cpf = normalizeCpf(String(fd.cpf || ''))
    const offeringId = fd.offeringId ? parseInt(fd.offeringId) : null

    if (!nome) return reply.code(400).send({ error: 'Nome é obrigatório' })
    if (!email && !whatsapp) return reply.code(400).send({ error: 'Informe email ou WhatsApp' })
    if (cpf && !isValidCpf(cpf)) return reply.code(400).send({ error: 'CPF inválido' })

    // Consentimento LGPD obrigatório (defesa em profundidade — o front já bloqueia).
    // Continuação por magic link já consentiu no portal de interesse → exceção.
    const lgpdConsent = fd.lgpdConsent === true || fd.lgpdConsent === 'true'
    const isContinuation = typeof body.continueToken === 'string' && body.continueToken.length > 0
    if (!lgpdConsent && !isContinuation) {
      return reply.code(400).send({ error: 'É necessário aceitar a política de privacidade para enviar a inscrição.' })
    }

    // Verificar captcha (se configurado) — implementação mínima: confia em token e valida depois
    // (A validação server-side completa entra na Fase A.6 com integração reCAPTCHA)

    // Validar offering pertence ao portal
    const processIds = (portal.selectionProcessIds as any[]) || []
    let selectionProcessId: number | null = null
    let offering: any = null
    let entryModeCode: string | null = null
    if (offeringId) {
      offering = await prisma.courseOffering.findFirst({
        where: {
          id: offeringId,
          active: true,
          selectionProcessId: { in: processIds },
        },
        select: {
          id: true, nome: true, selectionProcessId: true,
          selectionProcess: {
            select: {
              taxaInscricao: true,
              entryMode: { select: { code: true, defaultFormExtras: true } },
            },
          },
        },
      })
      if (!offering) return reply.code(400).send({ error: 'Oferta inválida para este portal' })
      selectionProcessId = offering.selectionProcessId
      entryModeCode = offering.selectionProcess?.entryMode?.code || null
    }

    // ── Validação server-side de required × visibleWhen (Gap #1) ──
    // Qualquer campo required que seja visível no modo atual DEVE ter valor enviado.
    // Campos ocultos pela regra de modo não são validados (equivale à UI pública).
    const formConfig = (portal.formConfig as any) || {}
    const steps = Array.isArray(formConfig.steps) ? formConfig.steps : []
    const missingFields: string[] = []
    const seenNames = new Set<string>()
    for (const step of steps) {
      const fields = Array.isArray(step?.fields) ? step.fields : []
      for (const field of fields) {
        if (field?.name) seenNames.add(field.name)
        if (!field?.required) continue
        const rule = field?.visibleWhen?.entryMode
        if (Array.isArray(rule) && rule.length > 0) {
          // Regra existe: só exige se o modo atual está na lista permitida
          if (!entryModeCode || !rule.includes(entryModeCode)) continue
        }
        const val = fd[field.name]
        const empty = val == null || val === '' || (Array.isArray(val) && val.length === 0)
        if (empty) missingFields.push(field.label || field.name || '(sem nome)')
      }
    }
    // Extras do EntryMode da oferta escolhida — aplica required mesmo quando
    // o admin não injetou esses campos no formConfig (espelha o merge do client).
    const offeringExtras = (offering?.selectionProcess?.entryMode?.defaultFormExtras as any[]) || []
    for (const ex of offeringExtras) {
      if (!ex?.required || !ex?.name) continue
      if (seenNames.has(ex.name)) continue
      const val = fd[ex.name]
      const empty = val == null || val === '' || (Array.isArray(val) && val.length === 0)
      if (empty) missingFields.push(ex.label || ex.name)
    }
    if (missingFields.length > 0) {
      return reply.code(400).send({
        error: `Campos obrigatórios não preenchidos: ${missingFields.slice(0, 5).join(', ')}${missingFields.length > 5 ? ` e mais ${missingFields.length - 5}` : ''}`,
        missingFields,
      })
    }

    // Cria/atualiza Lead (dedup por whatsapp/email).
    // Modo "continuação": se o body trouxer um magic link válido, usa o leadId
    // dele direto em vez de duplicar pela busca por whatsapp/email — garante
    // que o lead criado pelo portal de interesse seja o MESMO completado aqui.
    let lead = null as any
    let continuationLeadId: number | null = null
    if (typeof body.continueToken === 'string' && body.continueToken.length > 0) {
      const ml = verifyMagicLink(body.continueToken)
      if (ml && ml.portalSlug === slug) {
        continuationLeadId = ml.leadId
        lead = await prisma.lead.findUnique({ where: { id: ml.leadId } })
        if (!lead) continuationLeadId = null
      }
    }
    // Fase 24 (Categoria A): SEM dedup automático na inscrição. Sempre cria lead novo
    // e sinaliza match via flagDuplicate. Continuação por magic link (acima) mantém
    // o lead original — é a mesma inscrição, não uma nova.

    // Resolve funil: portal.funnelId > default do sistema > null
    let resolvedFunnelId: number | null = portal.funnelId || null
    if (!resolvedFunnelId) {
      const def = await prisma.funnel.findFirst({ where: { isDefault: true }, select: { id: true } })
      resolvedFunnelId = def?.id || null
    }

    // Visitor de tracking (bt.js) — cliente envia visitorId opcional no body
    const trackingVisitorId = typeof body.trackingVisitorId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(body.trackingVisitorId)
      ? body.trackingVisitorId
      : null

    // Resolve a stage destino ANTES de criar/atualizar lead — valida no funil
    // resolvido e cai pra primeira stage ativa quando portal.stageKey está
    // ausente ou não existe no funil (problema clássico do literal 'NOVO').
    const resolvedEntryStage = (await resolveEntryStageKey(resolvedFunnelId, portal.stageKey || null)) || 'NOVO'

    if (!lead) {
      const routedTeamId = portal.teamId || await resolveDefaultTeamId()
      lead = await prisma.lead.create({
        data: {
          nome,
          empresa: fd.empresa || '',
          whatsapp: whatsapp || '',
          email: email || '',
          cidade: fd.cidade || null,
          formData: { _source: 'enrollment_portal', _portalSlug: slug, ...fd },
          scores: {},
          lastStep: 0,
          completed: false,
          status: resolvedEntryStage,
          source: 'enrollment_portal',
          originType: 'enrollment_portal',
          teamId: routedTeamId,
          funnelId: resolvedFunnelId,
          trackingVisitorId,
          utmSource: fd.utm_source || null,
          utmMedium: fd.utm_medium || null,
          utmCampaign: fd.utm_campaign || null,
          utmContent: fd.utm_content || null,
          utmTerm: fd.utm_term || null,
          gclid: fd.gclid || null,
          lastActivityAt: new Date(),
          qualifiedAt: new Date(),
          qualificationSource: 'enrollment_portal',
        },
      })

      // Vincula TrackingVisitor → lead (se cliente mandou visitorId)
      if (trackingVisitorId) {
        prisma.trackingVisitor.updateMany({
          where: { visitorId: trackingVisitorId, leadId: null },
          data: { leadId: lead.id },
        }).catch(() => {})
      }

      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.LEAD_CREATED,
        category: 'lifecycle',
        title: `Lead criado via Portal de Matrículas: ${slug}`,
        channel: 'portal',
        source: 'enrollment_portal',
        actorType: 'lead',
        metadata: {
          portalSlug: slug,
          portalId: portal.id,
          portalNome: (portal as any).nome || null,
          offeringId,
          offeringNome: offering?.nome || null,
          selectionProcessId,
          funnelId: resolvedFunnelId,
          funnelDefault: !portal.funnelId && !!resolvedFunnelId,
          trackingVisitorId,
          utm: { source: fd.utm_source || null, medium: fd.utm_medium || null, campaign: fd.utm_campaign || null },
        },
      })

      // Fase 24: detecta possível duplicado (best-effort, não bloqueia o flow)
      flagDuplicate({ newLeadId: lead.id, channel: 'enrollmentPortal' }).catch((e) => {
        console.error('[enrollmentPortals] flagDuplicate error:', (e as any).message)
      })
    } else {
      // Enriquece dados básicos se vieram vazios + roteia para funil/etapa/team
      // de destino do portal (mesmo lead pode ter chegado antes só por WhatsApp;
      // a inscrição é sinal forte de intenção e o admin configurou o destino).
      const upd: any = {}
      if (nome && !lead.nome) upd.nome = nome
      if (cpf && !(lead.formData as any)?.cpf) upd.formData = { ...(lead.formData as any || {}), cpf }
      if (trackingVisitorId && !lead.trackingVisitorId) upd.trackingVisitorId = trackingVisitorId
      if (!lead.originType) upd.originType = 'enrollment_portal'

      // Roteamento por config do portal — espelha lógica do branch de novo lead.
      const prevFunnelId = lead.funnelId ?? null
      const prevStatus = lead.status
      const prevTeamId = lead.teamId ?? null

      if (portal.funnelId) {
        // Portal define funil destino → muda funil + stage juntos (status só é
        // significativo dentro do funil corrente). Usa resolvedEntryStage que
        // já garantiu que a key existe no funil.
        if (prevFunnelId !== portal.funnelId) upd.funnelId = portal.funnelId
        if (prevStatus !== resolvedEntryStage) upd.status = resolvedEntryStage
      } else if (portal.stageKey) {
        // Portal só define stage (mesmo funil atual). Valida contra o funil
        // que o lead já está, não o resolvido.
        const validKey = await resolveEntryStageKey(prevFunnelId, portal.stageKey)
        if (validKey && prevStatus !== validKey) upd.status = validKey
      }

      const routedTeamId = portal.teamId || await resolveDefaultTeamId()
      if (routedTeamId && prevTeamId !== routedTeamId) {
        upd.teamId = routedTeamId
      }

      if (Object.keys(upd).length > 0) {
        upd.lastActivityAt = new Date()
        lead = await prisma.lead.update({ where: { id: lead.id }, data: upd })
      }

      // Log de mudança de etapa quando o portal moveu o lead — visibilidade no histórico.
      if (upd.status && upd.status !== prevStatus) {
        logEvent({
          leadId: lead.id,
          type: EVENT_TYPES.STATUS_CHANGED,
          category: 'lifecycle',
          title: `Etapa alterada por inscrição no portal: "${upd.status}"`,
          source: 'enrollment_portal',
          actorType: 'system',
          description: `Inscrição submetida em ${slug} — funil ${upd.funnelId || prevFunnelId || 'mantido'}.`,
          metadata: {
            portalId: portal.id,
            portalSlug: slug,
            previousStatus: prevStatus,
            newStatus: upd.status,
            previousFunnelId: prevFunnelId,
            newFunnelId: upd.funnelId || prevFunnelId,
            trigger: 'enrollment_portal_submit',
          },
        })
      }

      if (trackingVisitorId) {
        prisma.trackingVisitor.updateMany({
          where: { visitorId: trackingVisitorId, leadId: null },
          data: { leadId: lead.id },
        }).catch(() => {})
      }
      // Lead já existia (ex: era só conversa WhatsApp) — promover por inscrição.
      const { qualifyLead } = await import('../services/leadQualification.js')
      qualifyLead(lead.id, { source: 'enrollment_portal' }).catch(() => {})
    }

    // Registro de consentimento do titular (LGPD) — prova do aceite na inscrição.
    if (lead && lgpdConsent) {
      await logTitularConsent({
        req, leadId: lead.id, visitorId: trackingVisitorId, action: 'enrollment_submit',
        source: `portal:${slug}`, url: (req.headers.referer as string) || null,
        categories: { enrollment: true },
      })
    }

    // Cria ProcessRegistration se tem oferta e processo
    let processRegistration: any = null
    if (offeringId && selectionProcessId) {
      try {
        processRegistration = await prisma.processRegistration.upsert({
          where: { leadId_offeringId: { leadId: lead.id, offeringId } },
          update: { status: 'inscrito' },
          create: {
            leadId: lead.id,
            offeringId,
            selectionProcessId,
            status: 'inscrito',
          },
        })
      } catch (err: any) {
        req.log.warn(`[enrollment] upsert processRegistration falhou: ${err.message}`)
      }
    }

    // Gera candidateCode único
    const candidateCode = await generateCandidateCode(portal.id)

    // Cria EnrollmentRegistration
    const enrollment = await prisma.enrollmentRegistration.create({
      data: {
        portalId: portal.id,
        processRegistrationId: processRegistration?.id || null,
        candidateCode,
        // 'pending'   = aguardando pagamento (só faz sentido se portal.requirePayment=true)
        // 'submitted' = inscrição recebida; sem cobrança a fazer (portal sem requirePayment)
        status: portal.requirePayment ? 'pending' : 'submitted',
        formData: fd,
        leadId: lead.id,
        ipAddress: (req.ip || '').substring(0, 45),
        userAgent: (headers['user-agent'] || '').toString().substring(0, 500),
        utmSource: fd.utm_source || null,
        utmMedium: fd.utm_medium || null,
        utmCampaign: fd.utm_campaign || null,
        fbclid: fd.fbclid || null,
        gclid: fd.gclid || null,
        referrer: fd.referrer || null,
      },
    })

    // Atualiza counters no portal
    await prisma.enrollmentPortal.update({
      where: { id: portal.id },
      data: { submissions: { increment: 1 } },
    })

    logEvent({
      leadId: lead.id,
      type: 'enrollment_submitted',
      category: 'lifecycle',
      title: `Inscrição submetida: ${candidateCode}`,
      channel: 'portal',
      source: 'enrollment_portal',
      actorType: 'lead',
      metadata: {
        portalId: portal.id,
        portalSlug: slug,
        candidateCode,
        enrollmentId: enrollment.id,
        offeringId,
        offeringNome: offering?.nome || null,
      },
    })

    // ── Fase B: cria cobrança se portal.requirePayment + provider configurado ──
    // VALOR vem de SelectionProcess.taxaInscricao (fonte única) — o portal só
    // controla o "se" cobrar (toggle) e os parâmetros de cobrança (provider,
    // config, deadline). Se o SP não tem valor configurado, log warn e pula.
    //
    // Modos:
    //   paymentMode='link'        → cria cobrança JÁ AQUI (paymentlink/invoiceUrl), redireciona candidato.
    //   paymentMode='transparent' → NÃO cria aqui. Frontend chama /payment-init com método escolhido
    //                               (PIX/boleto/cartão); cobrança nasce naquele momento.
    let paymentUrl: string | null = null
    if (portal.requirePayment && portal.paymentMode === 'link') {
      try {
        const portalFull = await prisma.enrollmentPortal.findUnique({
          where: { id: portal.id },
          select: {
            paymentProvider: true, paymentConfig: true, paymentDeadlineHours: true, nome: true,
            paymentConnectionId: true,
            paymentConnection: { select: { provider: true, environment: true, apiKey: true, defaultBillingType: true, active: true } },
          },
        })

        // Preferir conexão nova (PaymentProviderConnection) sobre config legada no portal
        let asaasCfg: ReturnType<typeof parseAsaasConfig> = null
        let pagarmeCfg: PagarmeConfig | null = null
        const conn = portalFull?.paymentConnection
        if (conn && conn.active) {
          const { decryptToken } = await import('../services/cloudApi.js')
          try {
            const plainKey = decryptToken(conn.apiKey)
            if (conn.provider === 'asaas') {
              asaasCfg = {
                apiKey: plainKey,
                environment: conn.environment === 'production' ? 'production' : 'sandbox',
                billingType: (conn.defaultBillingType as any) || 'UNDEFINED',
              }
            } else if (conn.provider === 'pagarme') {
              pagarmeCfg = { apiKey: plainKey, environment: detectPagarmeEnvironment(plainKey) }
            }
          } catch (e: any) {
            req.log.warn(`[enrollment] falha ao decryptar apiKey da conexão: ${e.message}`)
          }
        } else if (portalFull?.paymentProvider === 'asaas') {
          asaasCfg = parseAsaasConfig(portalFull.paymentConfig)
        }

        const taxaInscricao = offering?.selectionProcess?.taxaInscricao ?? null

        if (taxaInscricao && asaasCfg) {
          const customer = await createOrFindAsaasCustomer(asaasCfg, {
            name: nome || 'Candidato',
            email: email || undefined,
            cpfCnpj: cpf || undefined,
            mobilePhone: whatsapp || undefined,
            externalReference: `lead-${lead.id}`,
          })
          const dueDate = new Date(Date.now() + (portalFull?.paymentDeadlineHours || 48) * 3600 * 1000)
          const payment = await createAsaasPayment(asaasCfg, {
            customerId: customer.id,
            value: Number(taxaInscricao),
            dueDate,
            description: `Taxa de inscrição — ${portalFull?.nome} (${candidateCode})`,
            externalReference: `enrollment-${enrollment.id}`,
          })
          paymentUrl = payment.invoiceUrl
          await prisma.enrollmentRegistration.update({
            where: { id: enrollment.id },
            data: {
              paymentId: payment.id,
              paymentUrl: payment.invoiceUrl,
              paymentAmount: payment.value,
              paymentMethod: payment.billingType,
              paymentStatus: ASAAS_STATUS_MAP[payment.status] || 'pending',
              paymentExpiresAt: dueDate,
            },
          })
        } else if (taxaInscricao && pagarmeCfg) {
          const dueDate = new Date(Date.now() + (portalFull?.paymentDeadlineHours || 48) * 3600 * 1000)
          const customer = await createOrFindPagarmeCustomer(pagarmeCfg, {
            name: nome || 'Candidato',
            email: email || undefined,
            cpfCnpj: cpf || undefined,
            phone: whatsapp || undefined,
            externalReference: `lead-${lead.id}`,
          }).catch((e: any) => {
            req.log.warn(`[enrollment] pagarme: falha criando customer (${e.message}) — usando inline`)
            return null
          })
          const payment = await createPagarmePayment(pagarmeCfg, {
            customerId: customer?.id,
            customer: customer ? undefined : { name: nome || 'Candidato', email: email || undefined, cpfCnpj: cpf || undefined, phone: whatsapp || undefined },
            value: Number(taxaInscricao),
            dueDate,
            description: `Taxa de inscrição — ${portalFull?.nome} (${candidateCode})`,
            externalReference: `enrollment-${enrollment.id}`,
          })
          paymentUrl = payment.invoiceUrl
          await prisma.enrollmentRegistration.update({
            where: { id: enrollment.id },
            data: {
              paymentId: payment.id,
              paymentUrl: payment.invoiceUrl,
              paymentAmount: payment.value,
              paymentMethod: 'UNDEFINED', // cliente escolhe no link
              paymentStatus: 'pending',
              paymentExpiresAt: dueDate,
            },
          })
        } else if (taxaInscricao) {
          req.log.warn(`[enrollment] portal ${portal.id} requirePayment=true mas config de pagamento inválida/ausente`)
        } else {
          req.log.warn(`[enrollment] portal ${portal.id} requirePayment=true mas SelectionProcess ${selectionProcessId} sem taxaInscricao — cobrança pulada`)
        }

        // Timeline: cobrança gerada (modo link)
        if (paymentUrl) {
          logEvent({
            leadId: lead.id,
            type: 'payment_initiated',
            category: 'lifecycle',
            title: `Link de pagamento gerado — ${candidateCode}`,
            channel: 'payment',
            source: pagarmeCfg ? 'pagarme' : 'asaas',
            actorType: 'system',
            metadata: { mode: 'link', amount: taxaInscricao, registrationId: enrollment.id, paymentUrl },
          })
        }
      } catch (payErr: any) {
        req.log.error(`[enrollment] falha ao criar cobrança: ${payErr.message}`)
        // Timeline: falha
        logEvent({
          leadId: lead.id,
          type: 'payment_failed',
          category: 'lifecycle',
          title: `Falha ao gerar link de pagamento — ${candidateCode}`,
          channel: 'payment',
          source: 'enrollment_portal',
          actorType: 'system',
          metadata: { mode: 'link', error: payErr.message?.substring(0, 500) },
        })
        // Não bloqueia a inscrição — candidato pode pagar depois via secretaria
      }
    }

    // Remove draft da sessão ao submeter com sucesso (ignora falha)
    const draftSessionId = String(body.sessionId || '').trim()
    if (/^[a-zA-Z0-9_-]{16,64}$/.test(draftSessionId)) {
      prisma.enrollmentDraft.deleteMany({ where: { sessionId: draftSessionId } }).catch(() => {})
    }

    // Fase A.7: envio de confirmação email + WhatsApp (fire-and-forget)
    import('../services/enrollmentNotify.js').then(m =>
      m.sendEnrollmentConfirmation({ enrollmentId: enrollment.id }).catch(e =>
        req.log.warn(`[enrollment] notify falhou: ${e.message}`)
      )
    )

    // Token curto (1h) que permite o candidato:
    //   • Anexar o boletim ENEM logo após o submit (UX de inscrição em uma só etapa
    //     para EntryMode='enem' — sem precisar logar no /candidato/:code).
    //   • Pollar o status da análise (IA processando → resultado).
    // É o mesmo token de sessão do portal do candidato (mesma assinatura HMAC),
    // então o candidato pode usar para entrar direto no /candidato/:code também.
    const candidateToken = signCandidateToken(enrollment.id, candidateCode)

    // Sinaliza ao frontend público o que renderizar pós-submit:
    //   'link'        → mostra link (paymentUrl) ou "Pagar taxa" botão
    //   'transparent' → renderiza checkout inline (PIX/boleto/cartão), chama /payment-init
    //   'none'        → portal não cobra; só comprovante de inscrição
    const paymentMode = portal.requirePayment
      ? (portal.paymentMode === 'transparent' ? 'transparent' : 'link')
      : 'none'

    return reply.code(201).send({
      ok: true,
      candidateCode,
      enrollmentId: enrollment.id,
      leadId: lead.id,
      status: enrollment.status,
      paymentUrl,
      paymentMode,
      candidateToken,
      // Indica para o frontend se este EntryMode exige upload do boletim ENEM
      // logo após a inscrição (parte da UX de uma única etapa).
      entryModeCode,
    })
  })

  // ══════════════════════════════════════════════
  // Checkout transparente — endpoints públicos
  // ══════════════════════════════════════════════
  //
  // Fluxo:
  //   1. Candidato submete /register (paymentMode='transparent') e recebe candidateToken
  //   2. Frontend pede método ao candidato e chama POST /payment-init
  //   3. Backend cria order no provedor (PIX/boleto/cartão), persiste EnrollmentPaymentMethod
  //   4. Frontend renderiza QR/linha/status e pollar GET /payment-status até 'paid'
  //   5. Webhook do provedor atualiza tudo em paralelo (defesa em profundidade)
  //
  // Auth: Authorization: Bearer <candidateToken> (mesmo token do /candidato/:code).

  function requirePaymentSession(req: any, code: string): { enrollmentId: number; candidateCode: string } | null {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const sess = verifyCandidateToken(auth)
    if (!sess) return null
    if (sess.candidateCode !== code) return null
    return sess
  }

  // POST /api/public/registrations/:code/payment-init
  // body: { method: 'pix'|'boleto'|'credit_card', cardToken?: string }
  app.post('/api/public/registrations/:code/payment-init', async (req, reply) => {
    const { code } = req.params as any
    const sess = requirePaymentSession(req, code)
    if (!sess) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })

    const body = (req.body as any) || {}
    const method = body.method as 'pix' | 'boleto' | 'credit_card'
    if (!['pix', 'boleto', 'credit_card'].includes(method)) {
      return reply.code(400).send({ error: 'Método inválido' })
    }

    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { id: sess.enrollmentId },
      include: {
        lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
        processRegistration: {
          include: {
            selectionProcess: { select: { taxaInscricao: true } },
            offering: { select: { selectionProcessId: true } },
          },
        },
        portal: {
          select: {
            id: true, nome: true, paymentMode: true, paymentDeadlineHours: true,
            requirePayment: true,
            paymentConnection: {
              select: {
                id: true, provider: true, environment: true, apiKey: true,
                defaultBillingType: true, active: true,
              },
            },
          },
        },
      },
    })
    if (!enrollment) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (!enrollment.portal?.requirePayment) {
      return reply.code(400).send({ error: 'Portal não exige pagamento' })
    }
    if (enrollment.portal.paymentMode !== 'transparent') {
      return reply.code(400).send({ error: 'Portal não está em modo transparente' })
    }
    if (enrollment.paymentStatus === 'paid') {
      return reply.code(400).send({ error: 'Pagamento já confirmado' })
    }
    const conn = enrollment.portal.paymentConnection
    if (!conn || !conn.active) {
      return reply.code(400).send({ error: 'Conexão de pagamento inativa ou inexistente' })
    }
    const taxaInscricao = enrollment.processRegistration?.selectionProcess?.taxaInscricao
    if (!taxaInscricao || Number(taxaInscricao) <= 0) {
      return reply.code(400).send({ error: 'Processo seletivo sem taxa de inscrição definida' })
    }
    if (method === 'credit_card' && !body.cardToken) {
      return reply.code(400).send({ error: 'cardToken obrigatório para cartão' })
    }

    const fd = (enrollment.formData as any) || {}
    const apiKeyPlain = (() => {
      try { return decryptToken(conn.apiKey) } catch { return null }
    })()
    if (!apiKeyPlain) return reply.code(500).send({ error: 'Falha ao decifrar credenciais do provedor' })

    const deadlineHours = enrollment.portal.paymentDeadlineHours || 48
    const dueDate = new Date(Date.now() + deadlineHours * 3600 * 1000)
    const description = `Taxa de inscrição — ${enrollment.portal.nome} (${enrollment.candidateCode})`
    const customer = {
      name: enrollment.lead?.nome || fd.nome || 'Candidato',
      email: enrollment.lead?.email || fd.email || undefined,
      cpfCnpj: fd.cpf || undefined,
      phone: enrollment.lead?.whatsapp || fd.whatsapp || undefined,
      externalReference: `lead-${enrollment.leadId ?? 'unknown'}`,
    }

    try {
      let methodRow: any
      if (conn.provider === 'pagarme') {
        const cfg: PagarmeConfig = {
          apiKey: apiKeyPlain,
          environment: detectPagarmeEnvironment(apiKeyPlain),
        }
        const order = await createPagarmeOrder(cfg, {
          method: method as PagarmeOrderMethod,
          customer,
          value: Number(taxaInscricao),
          dueDate,
          description,
          externalReference: `enrollment-${enrollment.id}`,
          ...(body.cardToken ? { cardToken: String(body.cardToken) } : {}),
        })
        methodRow = await persistPaymentMethod({
          registrationId: enrollment.id,
          provider: 'pagarme',
          method,
          externalId: order.chargeId || order.orderId,
          status: order.status,
          amount: Number(taxaInscricao),
          dueDate,
          pixQrCode: order.pixQrCode,
          pixQrCodeUrl: order.pixQrCodeUrl,
          expiresAt: order.expiresAt ? new Date(order.expiresAt) : undefined,
          boletoLine: order.boletoLine,
          boletoBarcode: order.boletoBarcode,
          boletoPdfUrl: order.boletoPdfUrl,
          boletoDueAt: order.boletoDueAt ? new Date(order.boletoDueAt) : undefined,
          cardLastDigits: order.cardLastDigits,
          cardBrand: order.cardBrand,
        })
        await prisma.enrollmentRegistration.update({
          where: { id: enrollment.id },
          data: {
            paymentId: order.chargeId || order.orderId,
            paymentStatus: order.status,
            paymentAmount: Number(taxaInscricao),
            paymentMethod: method.toUpperCase(),
            paymentExpiresAt: dueDate,
          },
        })
      } else if (conn.provider === 'asaas') {
        const cfg = {
          apiKey: apiKeyPlain,
          environment: (conn.environment === 'production' ? 'production' : 'sandbox') as 'production' | 'sandbox',
          billingType: (conn.defaultBillingType as any) || 'UNDEFINED',
        }
        const order = await createAsaasOrder(cfg, {
          method: method as AsaasOrderMethod,
          customer: { ...customer, externalReference: `lead-${enrollment.leadId ?? 'unknown'}` },
          value: Number(taxaInscricao),
          dueDate,
          description,
          externalReference: `enrollment-${enrollment.id}`,
          ...(body.cardToken ? { cardToken: String(body.cardToken) } : {}),
          ...(req.ip ? { remoteIp: req.ip } : {}),
        })
        methodRow = await persistPaymentMethod({
          registrationId: enrollment.id,
          provider: 'asaas',
          method,
          externalId: order.paymentId,
          status: order.status,
          amount: Number(taxaInscricao),
          dueDate,
          pixQrCode: order.pixQrCode,
          pixQrCodeUrl: order.pixQrCodeUrl,
          expiresAt: order.expiresAt ? new Date(order.expiresAt) : undefined,
          boletoLine: order.boletoLine,
          boletoBarcode: order.boletoBarcode,
          boletoPdfUrl: order.boletoPdfUrl,
          boletoDueAt: order.boletoDueAt ? new Date(order.boletoDueAt) : undefined,
          cardLastDigits: order.cardLastDigits,
          cardBrand: order.cardBrand,
        })
        await prisma.enrollmentRegistration.update({
          where: { id: enrollment.id },
          data: {
            paymentId: order.paymentId,
            paymentStatus: order.status,
            paymentAmount: Number(taxaInscricao),
            paymentMethod: method.toUpperCase(),
            paymentExpiresAt: dueDate,
          },
        })
      } else {
        return reply.code(400).send({ error: `Provedor não suportado: ${conn.provider}` })
      }

      // Timeline: cobrança gerada
      if (enrollment.leadId) {
        logEvent({
          leadId: enrollment.leadId,
          type: 'payment_initiated',
          category: 'lifecycle',
          title: `Cobrança ${method === 'pix' ? 'PIX' : method === 'boleto' ? 'Boleto' : 'Cartão'} gerada — ${enrollment.candidateCode}`,
          channel: 'payment',
          source: conn.provider,
          actorType: 'system',
          metadata: {
            method, provider: conn.provider,
            amount: Number(taxaInscricao),
            externalId: methodRow?.externalId,
            registrationId: enrollment.id,
          },
        })
      }

      return reply.send({ ok: true, method: serializePaymentMethod(methodRow) })
    } catch (e: any) {
      req.log.error(`[payment-init] falha ao criar cobrança: ${e.message}`)
      // Persiste o erro pra UI ler depois
      await prisma.enrollmentPaymentMethod.create({
        data: {
          registrationId: enrollment.id,
          provider: conn.provider,
          method,
          status: 'failed',
          amount: Number(taxaInscricao),
          lastErrorMessage: e.message?.substring(0, 1000) || 'Falha desconhecida',
        },
      }).catch(() => {})

      // Timeline: tentativa falhou
      if (enrollment.leadId) {
        logEvent({
          leadId: enrollment.leadId,
          type: 'payment_failed',
          category: 'lifecycle',
          title: `Falha ao gerar cobrança ${method === 'pix' ? 'PIX' : method === 'boleto' ? 'Boleto' : 'Cartão'} — ${enrollment.candidateCode}`,
          channel: 'payment',
          source: conn.provider,
          actorType: 'system',
          metadata: { method, provider: conn.provider, error: e.message?.substring(0, 500) },
        })
      }

      return reply.code(502).send({ error: e.message || 'Falha ao criar cobrança' })
    }
  })

  // GET /api/public/registrations/:code/payment-status
  app.get('/api/public/registrations/:code/payment-status', async (req, reply) => {
    const { code } = req.params as any
    const sess = requirePaymentSession(req, code)
    if (!sess) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })

    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { id: sess.enrollmentId },
      select: {
        id: true, candidateCode: true, paymentStatus: true, paymentAmount: true,
        paymentExpiresAt: true, paymentPaidAt: true, paymentMethod: true,
        portal: { select: { paymentMode: true, requirePayment: true } },
        paymentMethods: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!enrollment) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    return reply.send({
      paymentStatus: enrollment.paymentStatus,
      paymentAmount: enrollment.paymentAmount ? Number(enrollment.paymentAmount) : null,
      paymentExpiresAt: enrollment.paymentExpiresAt,
      paymentPaidAt: enrollment.paymentPaidAt,
      paymentMethod: enrollment.paymentMethod,
      paymentMode: enrollment.portal?.paymentMode,
      methods: enrollment.paymentMethods.map(serializePaymentMethod),
    })
  })

  // GET /api/public/registrations/:code/payment-public-key
  // Retorna a publicKey do Pagar.me sob auth, pra frontend tokenizar cartão direto
  // na api.pagar.me/core/v5/tokens?appId=<pk> (PCI SAQ A — PAN não passa pelo nosso backend).
  // Asaas: não suporta tokenização client-side com chave pública separada — retorna null.
  app.get('/api/public/registrations/:code/payment-public-key', async (req, reply) => {
    const { code } = req.params as any
    const sess = requirePaymentSession(req, code)
    if (!sess) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })

    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { id: sess.enrollmentId },
      select: {
        portal: {
          select: {
            paymentMode: true,
            paymentConnection: { select: { id: true, provider: true, active: true } },
          },
        },
      },
    })
    if (!enrollment?.portal?.paymentConnection?.active) {
      return reply.code(404).send({ error: 'Conexão de pagamento inativa' })
    }
    const conn = enrollment.portal.paymentConnection
    if (conn.provider !== 'pagarme') {
      // Asaas não usa public key separada — frontend deve indicar erro/fallback.
      return reply.send({ provider: conn.provider, publicKey: null })
    }
    const pk = await getConnectionPublicKey(conn.id)
    if (!pk) return reply.code(404).send({ error: 'Public key não cadastrada para esta conexão' })
    return reply.send({ provider: 'pagarme', publicKey: pk })
  })

  // ══════════════════════════════════════════════
  // Upload de boletim ENEM logo após submit (sem login no portal do candidato)
  // POST /api/public/portals/:slug/registrations/:candidateCode/document
  //   - Auth: Bearer <candidateToken> recebido na resposta do submit
  //   - Aceita multipart com type=boletim_enem (é o único caso suportado por
  //     este endpoint — uploads de outros docs continuam pelo /candidato/:code).
  //   - Cria EnrollmentDocument + enfileira aiDocumentReview.
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/registrations/:candidateCode/document', async (req, reply) => {
    const { candidateCode } = req.params as any

    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').toString()
    const session = verifyCandidateToken(auth)
    if (!session || session.candidateCode !== candidateCode) {
      return reply.code(401).send({ error: 'Token inválido ou expirado' })
    }

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: session.enrollmentId },
      select: {
        id: true, candidateCode: true, portalId: true,
        portal: { select: { slug: true } },
      },
    })
    if (!reg || reg.candidateCode !== candidateCode) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    const file = await (req as any).file?.({ limits: { fileSize: 15 * 1024 * 1024 } })
    if (!file) return reply.code(400).send({ error: 'Nenhum arquivo enviado' })

    // Boletim ENEM é PDF emitido pelo INEP (página única ou multi-página). Aceitamos
    // também imagens como fallback (foto do boletim impresso) — a IA lida com ambos.
    const ext = (file.filename.split('.').pop() || 'bin').toLowerCase()
    const allowedExts = ['pdf', 'jpg', 'jpeg', 'png', 'webp']
    if (!allowedExts.includes(ext)) {
      return reply.code(400).send({ error: `Tipo não aceito: .${ext}. Envie PDF do boletim ou foto nítida (JPG/PNG/WEBP).` })
    }

    const requestedType = String(file.fields?.type?.value || 'boletim_enem')
    if (requestedType !== 'boletim_enem') {
      return reply.code(400).send({ error: 'Este endpoint aceita apenas boletim_enem. Para outros documentos, use o portal do candidato.' })
    }

    const uploadsDir = join(process.cwd(), '..', 'uploads', 'enrollment-docs')
    await fsp.mkdir(uploadsDir, { recursive: true })

    const savedName = `${reg.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const filePath = join(uploadsDir, savedName)

    const MAX = 15 * 1024 * 1024
    let total = 0
    let fileBuf: Buffer
    try {
      fileBuf = await bufferMultipart(file.file as any, MAX)
      total = fileBuf.length
      // SVG não está na allowlist deste endpoint; markup é rejeitado por padrão.
      fileBuf = validateUploadContent(fileBuf, ext, { allowSvg: false })
    } catch (err: any) {
      if (err instanceof UploadTooLargeError) return reply.code(413).send({ error: 'Arquivo muito grande (máx 15MB)' })
      if (err instanceof UploadValidationError) return reply.code(400).send({ error: err.message })
      return reply.code(500).send({ error: 'Falha ao processar arquivo' })
    }
    await fsp.writeFile(filePath, fileBuf)

    const docType = await prisma.documentType.findUnique({ where: { code: 'boletim_enem' } }).catch(() => null)
    const aiStatus = docType?.aiAnalysisTemplate ? 'pending' : 'skipped'
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`

    const doc = await prisma.enrollmentDocument.create({
      data: {
        registrationId: reg.id,
        typeCode: 'boletim_enem',
        typeId: docType?.id || null,
        label: 'Boletim ENEM',
        fileUrl: `${appUrl}/uploads/enrollment-docs/${savedName}`,
        fileName: file.filename,
        mimeType: file.mimetype || `application/octet-stream`,
        sizeBytes: total,
        aiStatus,
      },
    })

    if (aiStatus === 'pending') {
      const { queues } = await import('../lib/queues.js')
      queues.documentReview.add('review', { docId: doc.id }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }).catch(err => req.log.warn(`[boletim-upload] enqueue: ${err.message}`))
    }

    return { ok: true, document: { id: doc.id, aiStatus, fileName: doc.fileName } }
  })

  // ══════════════════════════════════════════════
  // Status da análise (polling pela tela de confirmação do portal público)
  // GET /api/public/portals/:slug/registrations/:candidateCode/status
  //   - Auth: Bearer <candidateToken>
  //   - Retorna o estado atual do documento boletim_enem + EnemScoreImport
  //     (média, passed, validatedAt) — frontend usa para mostrar "analisando…"
  //     enquanto a IA processa, e o resultado quando ficar pronto.
  // ══════════════════════════════════════════════
  app.get('/api/public/portals/:slug/registrations/:candidateCode/status', async (req, reply) => {
    const { candidateCode } = req.params as any
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').toString()
    const session = verifyCandidateToken(auth)
    if (!session || session.candidateCode !== candidateCode) {
      return reply.code(401).send({ error: 'Token inválido ou expirado' })
    }

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: session.enrollmentId },
      select: {
        id: true, candidateCode: true, status: true, paymentStatus: true, paymentUrl: true,
        documents: {
          where: { typeCode: 'boletim_enem' },
          orderBy: { uploadedAt: 'desc' },
          take: 1,
          select: { id: true, status: true, aiStatus: true, fileName: true, uploadedAt: true, reviewNote: true },
        },
        enemScoreImports: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true, mediaSimples: true, passed: true, cutoffScore: true,
            validatedAt: true, source: true, aiConfidence: true,
            cienciasHumanas: true, cienciasNatureza: true, linguagens: true,
            matematica: true, redacao: true,
          },
        },
      },
    })
    if (!reg || reg.candidateCode !== candidateCode) return reply.code(404).send({ error: 'Inscrição não encontrada' })

    return {
      ok: true,
      registration: { status: reg.status, paymentStatus: reg.paymentStatus, paymentUrl: reg.paymentUrl },
      document: reg.documents[0] || null,
      scoreImport: reg.enemScoreImports[0] || null,
    }
  })

  // ══════════════════════════════════════════════
  // PORTAL DE INTERESSE — captura leve para sites/LPs/parceiros
  //
  // POST /api/public/portals/:slug/interest
  //   Body: { formData: {nome, whatsapp, email?, offeringId?, lgpdConsent}, captchaToken?, trackingVisitorId? }
  //   - Cria Lead em status do portal (tipicamente INTERESSADO)
  //   - Dispara evento `enrollment.interest_submitted` com `continueUrl`
  //     (workflow envia email + WA com magic link para o portal de continuação)
  //   - NÃO cria EnrollmentRegistration (lead ainda não tem candidateCode)
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/interest', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })
    const body = (req.body as any) || {}

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { slug },
      select: {
        id: true, nome: true, active: true, formMode: true,
        teamId: true, funnelId: true, stageKey: true, alwaysCreateNew: true,
        captchaType: true, captchaSecret: true,
        magicLinkTtlDays: true,
        continuationPortal: { select: { id: true, slug: true, nome: true, active: true } },
      },
    })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })
    if (portal.formMode !== 'interest') {
      return reply.code(400).send({ error: 'Este portal usa formulário completo. Use /register.' })
    }
    if (!portal.continuationPortal || !portal.continuationPortal.active) {
      req.log.warn(`[interest] portal ${portal.id} sem continuationPortal ativo configurado`)
      return reply.code(500).send({ error: 'Portal de continuação não configurado. Contate o suporte da instituição.' })
    }

    if (portal.captchaType && portal.captchaSecret) {
      const { verifyCaptcha } = await import('../services/captcha.js')
      const result = await verifyCaptcha(
        { type: portal.captchaType as any, secret: portal.captchaSecret },
        String(body.captchaToken || ''),
        req.ip,
      )
      if (!result.ok) return reply.code(403).send({ error: 'Verificação de segurança falhou. Tente novamente.' })
    }

    const fd = body.formData || {}
    const nome = String(fd.nome || '').trim()
    const email = String(fd.email || '').trim()
    const whatsapp = String(fd.whatsapp || '').trim()
    const offeringId = fd.offeringId ? parseInt(fd.offeringId) : null
    const lgpdConsent = fd.lgpdConsent === true || fd.lgpdConsent === 'true'

    if (!nome || nome.length < 3) return reply.code(400).send({ error: 'Informe seu nome completo' })
    if (!whatsapp) return reply.code(400).send({ error: 'WhatsApp é obrigatório para podermos enviar o link' })
    if (whatsapp.replace(/\D/g, '').length < 10) return reply.code(400).send({ error: 'WhatsApp inválido' })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'E-mail inválido' })
    if (!lgpdConsent) return reply.code(400).send({ error: 'Você precisa aceitar a política de privacidade para prosseguir' })

    // Curso de interesse — não bloqueia se inválido, só ignora (pode ter mudado).
    let courseName = ''
    if (offeringId) {
      const off = await prisma.courseOffering.findUnique({
        where: { id: offeringId },
        select: { nome: true, course: { select: { nome: true } } },
      })
      courseName = off?.course?.nome || off?.nome || ''
    }

    // Funnel + stage destino (mesma lógica do /register).
    let resolvedFunnelId: number | null = portal.funnelId || null
    if (!resolvedFunnelId) {
      const def = await prisma.funnel.findFirst({ where: { isDefault: true }, select: { id: true } })
      resolvedFunnelId = def?.id || null
    }
    const resolvedEntryStage = (await resolveEntryStageKey(resolvedFunnelId, portal.stageKey || null)) || 'NOVO'

    const trackingVisitorId = typeof body.trackingVisitorId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(body.trackingVisitorId)
      ? body.trackingVisitorId
      : null

    // Fase 24 (Categoria A): SEMPRE cria lead novo. flagDuplicate sinaliza match.
    let lead: any = null

    if (!lead) {
      const routedTeamId = portal.teamId || await resolveDefaultTeamId()
      lead = await prisma.lead.create({
        data: {
          nome,
          empresa: '',
          whatsapp,
          email: email || '',
          formData: { _source: 'enrollment_portal_interest', _portalSlug: slug, _interestOfferingId: offeringId, lgpdConsent: true, lgpdConsentAt: new Date().toISOString(), ...fd },
          scores: {},
          lastStep: 0,
          completed: false,
          status: resolvedEntryStage,
          source: 'enrollment_portal_interest',
          originType: 'web_form',
          teamId: routedTeamId,
          funnelId: resolvedFunnelId,
          trackingVisitorId,
          utmSource: fd.utm_source || null,
          utmMedium: fd.utm_medium || null,
          utmCampaign: fd.utm_campaign || null,
          gclid: fd.gclid || null,
          lastActivityAt: new Date(),
          qualifiedAt: new Date(),
          qualificationSource: 'enrollment_portal_interest',
        },
      })
      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.LEAD_CREATED,
        category: 'lifecycle',
        title: `Lead criado por interesse no portal: ${slug}`,
        channel: 'portal',
        source: 'enrollment_portal_interest',
        actorType: 'lead',
        metadata: { portalId: portal.id, portalSlug: slug, courseName, offeringId, continuationPortalSlug: portal.continuationPortal.slug },
      })

      // Fase 24: detecta possível duplicado (best-effort, não bloqueia o flow)
      flagDuplicate({ newLeadId: lead.id, channel: 'enrollmentPortal' }).catch((e) => {
        console.error('[enrollmentPortals/interest] flagDuplicate error:', (e as any).message)
      })
    }

    if (trackingVisitorId) {
      prisma.trackingVisitor.updateMany({
        where: { visitorId: trackingVisitorId, leadId: null },
        data: { leadId: lead.id },
      }).catch(() => {})
    }

    // Registro de consentimento do titular (LGPD) — aceite na captura de interesse.
    if (lead && lgpdConsent) {
      await logTitularConsent({
        req, leadId: lead.id, visitorId: trackingVisitorId, action: 'interest_submit',
        source: `portal-interest:${slug}`, url: (req.headers.referer as string) || null,
        categories: { interest: true },
      })
    }

    // Counter de submissões do portal de interesse
    await prisma.enrollmentPortal.update({
      where: { id: portal.id },
      data: { submissions: { increment: 1 } },
    })

    // Magic link → portal de continuação
    const ttlDays = portal.magicLinkTtlDays || 30
    const token = signMagicLink(lead.id, portal.continuationPortal.slug, ttlDays)
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    const continueUrl = `${appUrl}/portal/${portal.continuationPortal.slug}?t=${encodeURIComponent(token)}`

    // courseName vai com separador embutido pra renderizar bem nos templates
    // (ex.: "Vestibular 2026 — Medicina" se houver curso, só "Vestibular 2026" se não).
    const courseSuffix = courseName ? ` — ${courseName}` : ''

    eventBus.emitDomain({
      type: 'enrollment.interest_submitted',
      leadId: lead.id,
      payload: {
        nome: lead.nome,
        email: lead.email,
        whatsapp: lead.whatsapp,
        portalNome: portal.nome,
        courseName: courseSuffix,  // já com separador (ou string vazia)
        continueUrl,
        continuationPortalNome: portal.continuationPortal.nome,
        ttlDays,
      },
      timestamp: new Date(),
    })

    return reply.code(201).send({
      ok: true,
      leadId: lead.id,
      message: 'Interesse registrado',
      // Não vazamos o token na resposta (segurança UX): o candidato deve receber
      // o link só pelo canal que ele forneceu (WA + email). Se ele não receber,
      // pode pedir reenvio pela rota /resend-link.
      continuationPortalNome: portal.continuationPortal.nome,
    })
  })

  // ══════════════════════════════════════════════
  // GET /api/public/portals/:slug/continue?t=<token>
  //   - Valida magic link, retorna prefill (nome/email/whatsapp do lead) para
  //     o portal completo abrir o form pré-preenchido.
  // ══════════════════════════════════════════════
  app.get('/api/public/portals/:slug/continue', async (req, reply) => {
    const { slug } = req.params as any
    const q = req.query as any
    const token = String(q.t || '')
    const payload = verifyMagicLink(token)
    if (!payload || payload.portalSlug !== slug) {
      return reply.code(401).send({ error: 'Link expirado ou inválido. Solicite um novo link.' })
    }
    const lead = await prisma.lead.findUnique({
      where: { id: payload.leadId },
      select: { id: true, nome: true, email: true, whatsapp: true, formData: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    const fd = (lead.formData as any) || {}
    return {
      ok: true,
      lead: { id: lead.id, nome: lead.nome, email: lead.email, whatsapp: lead.whatsapp },
      // Prefill útil que o lead já forneceu no portal de interesse
      prefill: {
        nome: lead.nome,
        email: lead.email,
        whatsapp: lead.whatsapp,
        offeringId: fd._interestOfferingId || null,
        cidade: fd.cidade || null,
      },
    }
  })

  // ══════════════════════════════════════════════
  // POST /api/public/portals/:slug/resend-link
  //   Body: { emailOrWhatsapp }
  //   - Acha o lead do portal de interesse, gera novo magic link e dispara evento.
  //   - Rate limit: 3 envios / 15min por IP (mesmo lead pode ser pedido por amigo etc.)
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/resend-link', async (req, reply) => {
    const { slug } = req.params as any
    const body = (req.body as any) || {}
    const raw = String(body.emailOrWhatsapp || '').trim()
    if (!raw) return reply.code(400).send({ error: 'Informe o email ou WhatsApp usado na inscrição' })

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { slug },
      select: {
        id: true, nome: true, active: true, formMode: true,
        magicLinkTtlDays: true,
        continuationPortal: { select: { id: true, slug: true, nome: true, active: true } },
      },
    })
    if (!portal || !portal.active || portal.formMode !== 'interest') {
      return reply.code(404).send({ error: 'Portal indisponível' })
    }
    if (!portal.continuationPortal || !portal.continuationPortal.active) {
      return reply.code(500).send({ error: 'Portal de continuação não configurado' })
    }

    // Rate limit por IP (memória simples, suficiente para abuse leve).
    const ip = (req.ip || '').substring(0, 45)
    const key = `resend:${ip}`
    const now = Date.now()
    const winMs = 15 * 60 * 1000
    if (!(global as any)._resendBuckets) (global as any)._resendBuckets = new Map<string, number[]>()
    const bucket: number[] = ((global as any)._resendBuckets.get(key) || []).filter((t: number) => now - t < winMs)
    if (bucket.length >= 3) {
      return reply.code(429).send({ error: 'Muitos pedidos de reenvio. Aguarde alguns minutos.' })
    }
    bucket.push(now);
    (global as any)._resendBuckets.set(key, bucket)

    // Acha o lead — aceita email ou WhatsApp (com normalização leve).
    const isEmail = raw.includes('@')
    const lookup: any = isEmail
      ? { email: raw.toLowerCase() }
      : { whatsapp: raw.replace(/\D/g, '') }
    const lead = await prisma.lead.findFirst({
      where: lookup,
      orderBy: { createdAt: 'desc' },
    })
    // Sucesso silencioso mesmo se não achou (não vazar existência)
    if (!lead) return { ok: true, sent: false }

    const ttlDays = portal.magicLinkTtlDays || 30
    const token = signMagicLink(lead.id, portal.continuationPortal.slug, ttlDays)
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    const continueUrl = `${appUrl}/portal/${portal.continuationPortal.slug}?t=${encodeURIComponent(token)}`

    eventBus.emitDomain({
      type: 'enrollment.interest_submitted',
      leadId: lead.id,
      payload: {
        nome: lead.nome,
        email: lead.email,
        whatsapp: lead.whatsapp,
        portalNome: portal.nome,
        courseName: '',  // sem separador (caso de reenvio: courseName desconhecido)
        continueUrl,
        continuationPortalNome: portal.continuationPortal.nome,
        ttlDays,
        resend: true,
      },
      timestamp: new Date(),
    })

    return { ok: true, sent: true }
  })

  // ══════════════════════════════════════════════
  // Auto-save por etapa: persiste formData parcial para permitir resume.
  // TTL padrão 72h. Chave por sessionId (gerado/persistido no localStorage).
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/draft', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })

    const body = (req.body as any) || {}
    const sessionId = String(body.sessionId || '').trim()
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(sessionId)) return reply.code(400).send({ error: 'sessionId inválido' })

    const portal = await prisma.enrollmentPortal.findUnique({ where: { slug }, select: { id: true, active: true } })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    const formData = (body.formData && typeof body.formData === 'object') ? body.formData : {}
    const currentStep = Math.max(0, parseInt(body.currentStep) || 0)
    const email = formData.email ? String(formData.email).trim().substring(0, 191) : null
    const whatsapp = formData.whatsapp ? String(formData.whatsapp).replace(/\D/g, '').substring(0, 30) : null

    // Limite por IP: 60 drafts em 15min (proteção contra abuso)
    const ip = (req.ip || '').substring(0, 45)
    const since = new Date(Date.now() - 15 * 60 * 1000)
    const recent = await prisma.enrollmentDraft.count({ where: { ipAddress: ip, updatedAt: { gte: since } } })
    if (recent > 60) return reply.code(429).send({ error: 'Muitas atualizações. Aguarde alguns minutos.' })

    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000)
    const draft = await prisma.enrollmentDraft.upsert({
      where: { sessionId },
      create: { portalId: portal.id, sessionId, formData: formData as any, currentStep, email, whatsapp, ipAddress: ip, expiresAt },
      update: { formData: formData as any, currentStep, email, whatsapp, ipAddress: ip, expiresAt },
    })
    return { ok: true, draftId: draft.id, expiresAt: draft.expiresAt }
  })

  app.get('/api/public/portals/:slug/draft/:sessionId', async (req, reply) => {
    const { slug, sessionId } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(sessionId || '')) return reply.code(400).send({ error: 'sessionId inválido' })

    // Anti-enumeração: o rascunho contém PII e o sessionId é o único segredo.
    // Limita leituras por IP para inviabilizar varredura de sessionIds.
    try {
      const rlKey = `draftget:${req.ip}`
      const hits = await redis.incr(rlKey)
      if (hits === 1) await redis.expire(rlKey, 300)
      if (hits > 60) {
        await logSecurityEvent({ ip: req.ip, type: 'enrollment_draft_enum', severity: 'medium', path: req.url, details: 'Excesso de leituras de rascunho' }).catch(() => {})
        return reply.code(429).send({ error: 'Muitas requisições' })
      }
    } catch { /* redis indisponível — não bloqueia */ }

    const portal = await prisma.enrollmentPortal.findUnique({ where: { slug }, select: { id: true } })
    if (!portal) return reply.code(404).send({ error: 'Portal indisponível' })

    const draft = await prisma.enrollmentDraft.findUnique({ where: { sessionId } })
    if (!draft || draft.portalId !== portal.id) return reply.code(404).send({ error: 'Rascunho não encontrado' })
    if (draft.expiresAt < new Date()) return reply.code(410).send({ error: 'Rascunho expirado' })

    return { ok: true, formData: draft.formData, currentStep: draft.currentStep, expiresAt: draft.expiresAt }
  })

  // ══════════════════════════════════════════════
  // Tracking de funil: visitantes registram eventos (view_step, submit_step, abandon)
  // Armazena em LeadEvent (category='portal_funnel') com metadata leve.
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/track', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })
    const body = (req.body as any) || {}
    const event = String(body.event || '')
    const stepIndex = parseInt(body.stepIndex) || 0
    const sessionId = String(body.sessionId || '')
    const variant = body.variant ? String(body.variant) : null

    if (!['step_reached', 'step_submitted', 'abandoned'].includes(event)) {
      return reply.code(400).send({ error: 'event inválido' })
    }

    const portal = await prisma.enrollmentPortal.findUnique({ where: { slug }, select: { id: true, active: true } })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    // Incrementa counter próprio no portal (contagem simples, sem duplicata por sessionId)
    // Implementação lightweight: armazena em tabela Setting com key dedicado
    const key = `portal_funnel_${portal.id}_${event}_step_${stepIndex}${variant ? '_' + variant : ''}`
    await prisma.setting.upsert({
      where: { key },
      create: {
        key, label: `Funnel ${portal.id} ${event} step ${stepIndex}`,
        grp: 'portal_funnel', fieldType: 'counter',
        value: { count: 1, sessions: sessionId ? [sessionId] : [] } as any,
      },
      update: {
        value: { count: { increment: 1 } } as any,  // não suportado direto — update raw abaixo
      },
    }).catch(() => {})
    // Update correto via SQL bruto
    try {
      await prisma.$executeRaw`UPDATE bychat_settings SET value = JSON_SET(value, '$.count', COALESCE(JSON_EXTRACT(value, '$.count'), 0) + 1) WHERE \`key\` = ${key}`
    } catch {}

    return { ok: true }
  })

  // GET analytics do funil (por etapa)
  app.get('/api/admin/enrollment-portals/:id/funnel', { preHandler: authMiddleware }, async (req) => {
    const { id } = req.params as any
    const portalId = parseInt(id)
    const settings = await prisma.setting.findMany({
      where: { grp: 'portal_funnel', key: { startsWith: `portal_funnel_${portalId}_` } },
      select: { key: true, value: true },
    })
    // Agrupa por step e evento
    const funnel: Record<string, Record<number, Record<string, number>>> = {}  // variant → step → event → count
    for (const s of settings) {
      const m = s.key.match(/^portal_funnel_\d+_(step_reached|step_submitted|abandoned)_step_(\d+)(?:_(.+))?$/)
      if (!m) continue
      const event = m[1]
      const step = parseInt(m[2])
      const variant = m[3] || 'default'
      const count = Number((s.value as any)?.count || 0)
      if (!funnel[variant]) funnel[variant] = {}
      if (!funnel[variant][step]) funnel[variant][step] = {}
      funnel[variant][step][event] = count
    }
    return { funnel }
  })

  // ══════════════════════════════════════════════
  // Chat ao vivo do portal — cria/obtém lead e mensagens
  // Público: autenticado via sessionId opaco (gerado pelo widget)
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/chat/session', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })
    const body = (req.body as any) || {}
    const portal = await prisma.enrollmentPortal.findUnique({ where: { slug }, select: { id: true, active: true, nome: true, teamId: true } })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    const crypto = await import('crypto')
    const sessionId = body.sessionId || crypto.randomBytes(16).toString('hex')

    // Cria/atualiza Lead com base em dados do widget (visitor anônimo)
    const nome = String(body.nome || '').trim() || 'Visitante portal'
    const whatsapp = String(body.whatsapp || '').trim()
    const email = String(body.email || '').trim()

    // Dedup por sessionId armazenado em formData._portalChatSession
    let lead = await prisma.lead.findFirst({
      where: { formData: { path: ['_portalChatSession'], equals: sessionId } as any },
    })

    if (!lead) {
      // Tenta dedup por whatsapp/email se foi fornecido
      if (whatsapp || email) {
        lead = await prisma.lead.findFirst({
          where: {
            OR: [whatsapp ? { whatsapp } : undefined, email ? { email } : undefined].filter(Boolean) as any,
          },
        })
      }
    }

    const teamIdResolved = portal.teamId || (await (await import('../services/teamRouting.js')).resolveDefaultTeamId())

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          nome, whatsapp, email, empresa: '',
          formData: { _portalChatSession: sessionId, _portalSlug: slug, _source: 'portal_chat' },
          scores: {}, lastStep: 0, completed: false, status: 'NOVO',
          source: 'portal_chat',
          originType: 'enrollment_portal',
          teamId: teamIdResolved,
          lastActivityAt: new Date(),
        },
      })
    } else {
      // Atualiza session
      const fd = (lead.formData as any) || {}
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          formData: { ...fd, _portalChatSession: sessionId, _portalSlug: slug },
          nome: lead.nome || nome,
          whatsapp: lead.whatsapp || whatsapp,
          email: lead.email || email,
        },
      })
    }

    return { sessionId, leadId: lead.id }
  })

  // POST envia mensagem do visitante no chat
  app.post('/api/public/portals/:slug/chat/message', async (req, reply) => {
    const body = (req.body as any) || {}
    const sessionId = String(body.sessionId || '')
    const text = String(body.text || '').trim()
    if (!sessionId || !text) return reply.code(400).send({ error: 'sessionId e text obrigatórios' })

    const lead = await prisma.lead.findFirst({
      where: { formData: { path: ['_portalChatSession'], equals: sessionId } as any },
      select: { id: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Sessão não encontrada' })

    const msg = await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: false, body: text, mediaType: 'text',
        provider: 'portal_chat', senderName: 'Visitante',
        timestamp: new Date(),
      },
    })
    await prisma.lead.update({
      where: { id: lead.id },
      data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date(), lastActivityAt: new Date() },
    })

    return { ok: true, messageId: msg.id }
  })

  // GET faz polling de mensagens novas (desde um ID)
  app.get('/api/public/portals/:slug/chat/messages', async (req, reply) => {
    const q = req.query as any
    const sessionId = String(q.sessionId || '')
    const since = q.since ? parseInt(q.since) : 0
    if (!sessionId) return reply.code(400).send({ error: 'sessionId obrigatório' })

    const lead = await prisma.lead.findFirst({
      where: { formData: { path: ['_portalChatSession'], equals: sessionId } as any },
      select: { id: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Sessão não encontrada' })

    const messages = await prisma.message.findMany({
      where: { leadId: lead.id, id: since ? { gt: since } : undefined, isInternal: false, isDeleted: false },
      orderBy: { timestamp: 'asc' },
      take: 100,
      select: { id: true, fromMe: true, body: true, senderName: true, timestamp: true },
    })
    return { messages }
  })

  // ══════════════════════════════════════════════
  // Link pré-preenchido para candidato conhecido (Lead do CRM → Portal)
  // Admin gera link assinado com dados do lead pra compartilhar via WhatsApp/email/QR
  // Portal lê o token ?t=xxx e pré-preenche o formulário automaticamente.
  // ══════════════════════════════════════════════
  app.get('/api/admin/leads/:id/enrollment-link', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const leadId = parseInt(id)
    const q = req.query as any
    let portalId = q.portalId ? parseInt(q.portalId) : null

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nome: true, email: true, whatsapp: true, cidade: true, formData: true, chatbotId: true },
    })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })

    // Se portalId não veio no query, descobre a partir do lead:
    // EnrollmentRegistration mais recente do lead (caso já tenha inscrição em algum portal).
    if (!portalId) {
      const reg = await prisma.enrollmentRegistration.findFirst({
        where: { leadId },
        orderBy: { id: 'desc' },
        select: { portalId: true },
      })
      if (reg) portalId = reg.portalId
    }

    if (!portalId) {
      return reply.code(404).send({ error: 'Lead não tem portal de matrícula vinculado' })
    }

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { id: portalId },
      select: { slug: true, customDomain: true, nome: true },
    })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })

    const fd = (lead.formData as any) || {}
    const prefill = {
      nome: lead.nome || '',
      email: lead.email || '',
      whatsapp: lead.whatsapp || '',
      cidade: lead.cidade || '',
      cpf: fd.cpf || '',
      leadId: lead.id,
      exp: Date.now() + 14 * 24 * 3600 * 1000,  // 14 dias
    }

    const crypto = await import('crypto')
    const secret = CANDIDATE_SECRET
    const body64 = Buffer.from(JSON.stringify(prefill)).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(body64).digest('base64url')
    const token = `${body64}.${sig}`

    const base = portal.customDomain ? `https://${portal.customDomain}` : `${process.env.APP_URL || 'https://bychat.ia.br'}/portal/${portal.slug}`
    const url = `${base}?t=${encodeURIComponent(token)}`

    return { url, token, expiresAt: new Date(prefill.exp), portal: { nome: portal.nome, slug: portal.slug } }
  })

  // ══════════════════════════════════════════════
  // IA — Recomendação de curso (Fase E.4)
  // Público: aceita respostas de "quiz" de 3-5 perguntas e retorna ranking.
  // ══════════════════════════════════════════════
  app.post('/api/public/portals/:slug/recommend-course', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) return reply.code(400).send({ error: 'Slug inválido' })

    const body = (req.body as any) || {}
    const answers = body.answers || {}  // { area, modality, budget, goal, time_available }

    const portal = await prisma.enrollmentPortal.findUnique({
      where: { slug },
      select: {
        id: true, active: true,
        selectionProcessIds: true,
        allowedLevelIds: true, allowedCourseIds: true, allowedModalityIds: true, allowedCampusIds: true,
      },
    })
    if (!portal || !portal.active) return reply.code(404).send({ error: 'Portal indisponível' })

    const processIds = (portal.selectionProcessIds as any[]) || []
    if (processIds.length === 0) return { recommendations: [] }

    const offerings = await prisma.courseOffering.findMany({
      where: {
        active: true,
        selectionProcessId: { in: processIds.map(Number).filter(Boolean) },
        ...(Array.isArray(portal.allowedLevelIds) && (portal.allowedLevelIds as any[]).length > 0 ? { levelId: { in: (portal.allowedLevelIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedCourseIds) && (portal.allowedCourseIds as any[]).length > 0 ? { courseId: { in: (portal.allowedCourseIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedModalityIds) && (portal.allowedModalityIds as any[]).length > 0 ? { modalityId: { in: (portal.allowedModalityIds as any[]).map(Number) } } : {}),
        ...(Array.isArray(portal.allowedCampusIds) && (portal.allowedCampusIds as any[]).length > 0 ? { campuses: { some: { campusId: { in: (portal.allowedCampusIds as any[]).map(Number) } } } } : {}),
      },
      select: {
        id: true, nome: true, turno: true, valorMensalidade: true,
        course: { select: { id: true, nome: true, descricao: true } },
        level: { select: { nome: true } },
        modality: { select: { nome: true } },
        campuses: { select: { campus: { select: { nome: true, cidade: true } } } },
        selectionProcess: {
          select: {
            taxaInscricao: true,
          },
        },
      },
      take: 50,
    })

    // Algoritmo simples de match (sem dependência de AI externa):
    const scored = offerings.map(o => {
      let score = 0
      const courseName = (o.course?.nome || o.nome || '').toLowerCase()
      const courseDesc = (o.course?.descricao || '').toLowerCase()
      const full = `${courseName} ${courseDesc}`
      const reasons: string[] = []

      // area interest (matching por palavra-chave)
      if (answers.area && typeof answers.area === 'string') {
        const keywords = String(answers.area).toLowerCase().split(/\s+/).filter(Boolean)
        const matches = keywords.filter(k => k.length > 3 && full.includes(k))
        if (matches.length > 0) { score += matches.length * 20; reasons.push(`alinhado com "${answers.area}"`) }
      }
      // modality
      if (answers.modality && o.modality?.nome) {
        if (String(o.modality.nome).toLowerCase().includes(String(answers.modality).toLowerCase())) {
          score += 25; reasons.push(`modalidade ${o.modality.nome}`)
        }
      }
      // budget
      if (answers.budget && o.valorMensalidade) {
        const budget = Number(answers.budget)
        const price = Number(o.valorMensalidade)
        if (budget > 0 && price <= budget) { score += 15; reasons.push('dentro do orçamento') }
        else if (budget > 0 && price <= budget * 1.2) { score += 5; reasons.push('próximo do orçamento') }
      }
      // turno
      if (answers.time_available && o.turno) {
        if (String(o.turno).toLowerCase().includes(String(answers.time_available).toLowerCase())) {
          score += 10; reasons.push(`turno ${o.turno}`)
        }
      }

      const taxaInscricao = o.selectionProcess?.taxaInscricao ?? null

      return {
        offeringId: o.id,
        courseName: o.course?.nome || o.nome,
        level: o.level?.nome,
        modality: o.modality?.nome,
        turno: o.turno,
        // Mantido `requiresPayment` no payload por compat de frontend antigo —
        // derivado da existência da taxa, não mais de um flag separado.
        requiresPayment: taxaInscricao != null,
        taxaInscricao,
        campus: o.campuses?.[0]?.campus?.nome,
        score,
        matchReasons: reasons,
      }
    })

    scored.sort((a, b) => b.score - a.score)
    return { recommendations: scored.slice(0, 5) }
  })

  // ══════════════════════════════════════════════
  // ADMIN — sync forçado de cobrança (recovery quando webhook não chegou)
  // POST /api/admin/payment-providers/:id/sync-charge
  // body: { externalId: string }
  //
  // Wrapper sobre paymentSync.syncChargeFromProvider — mesma lógica que o cron
  // de reconciliação roda automaticamente. Idempotente.
  // ══════════════════════════════════════════════
  app.post('/api/admin/payment-providers/:id/sync-charge', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const externalId = String(body.externalId || '').trim()
    if (!externalId) return reply.code(400).send({ error: 'externalId obrigatório' })

    const conn = await prisma.paymentProviderConnection.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, provider: true, active: true, apiKey: true, environment: true },
    })
    if (!conn || !conn.active) return reply.code(404).send({ error: 'Conexão não encontrada ou inativa' })

    const result = await syncChargeFromProvider(conn, externalId)
    if (!result.ok) {
      const status = result.error?.includes('Não consegui linkar') || result.error?.includes('não encontrada')
        ? 404
        : 502
      return reply.code(status).send({ error: result.error })
    }
    return reply.send(result)
  })

  // POST /api/admin/enrollment-registrations/:id/sync-payment
  // Versão alto-nível: descobre a conexão e o(s) método(s) automaticamente.
  // - Se há methods pending, tenta sync de cada um até achar transição pra paid (early return).
  // - Se nenhum method (modo link antigo), faz sync do paymentId direto.
  app.post('/api/admin/enrollment-registrations/:id/sync-payment', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const enrollment = await prisma.enrollmentRegistration.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true, paymentId: true, paymentStatus: true,
        portal: {
          select: {
            paymentConnection: { select: { id: true, provider: true, active: true, apiKey: true, environment: true } },
          },
        },
        paymentMethods: {
          where: { externalId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, externalId: true, status: true, method: true },
        },
      },
    })
    if (!enrollment) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const conn = enrollment.portal?.paymentConnection
    if (!conn || !conn.active) return reply.code(400).send({ error: 'Inscrição sem conexão de pagamento ativa' })

    // Estratégia: tenta TODOS os methods pending recentes; se nenhum, fallback pro paymentId legacy.
    const candidates: string[] = []
    for (const m of enrollment.paymentMethods) {
      if (m.externalId && m.status !== 'paid') candidates.push(m.externalId)
    }
    if (candidates.length === 0 && enrollment.paymentId) candidates.push(enrollment.paymentId)
    if (candidates.length === 0) return reply.code(400).send({ error: 'Nada para sincronizar — inscrição sem paymentId/methods' })

    const results: any[] = []
    let transitionedToPaid = false
    for (const ext of candidates) {
      const r = await syncChargeFromProvider(conn, ext)
      results.push({ externalId: ext, ...r })
      if (r.transitionedToPaid) { transitionedToPaid = true; break }   // já achou: para
      if (r.paymentStatus === 'paid') break  // já estava paid (idempotência)
    }
    return reply.send({ ok: true, transitionedToPaid, results })
  })

  // ── Autenticidade dos webhooks de pagamento ────────────────────────────
  // Asaas envia o token de autenticação configurado no painel no header
  // `asaas-access-token`; Pagar.me usa Basic Auth (`authorization`). Comparamos
  // com o `webhookSecret` da conexão em tempo constante. Sem o secret configurado,
  // aceitamos por compatibilidade mas logamos alerta (configure para fechar a fraude).
  function timingSafeEqualStr(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    if (ba.length !== bb.length) return false
    return crypto.timingSafeEqual(ba, bb)
  }
  function verifyPaymentWebhookAuth(
    provider: 'asaas' | 'pagarme',
    webhookSecret: string | null | undefined,
    req: any,
  ): { ok: boolean; configured: boolean } {
    const secret = (webhookSecret || '').trim()
    if (!secret) return { ok: true, configured: false }
    if (provider === 'asaas') {
      const got = String(req.headers['asaas-access-token'] || '')
      return { ok: !!got && timingSafeEqualStr(got, secret), configured: true }
    }
    // pagarme: aceita o secret cru no Authorization, ou a senha do Basic Auth
    const auth = String(req.headers['authorization'] || '')
    if (auth && timingSafeEqualStr(auth, secret)) return { ok: true, configured: true }
    const m = auth.match(/^Basic\s+(.+)$/i)
    if (m) {
      try {
        const decoded = Buffer.from(m[1], 'base64').toString('utf-8') // user:pass
        const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded
        if (timingSafeEqualStr(decoded, secret) || timingSafeEqualStr(pass, secret)) return { ok: true, configured: true }
      } catch { /* ignore */ }
    }
    return { ok: false, configured: true }
  }

  // ══════════════════════════════════════════════
  // WEBHOOK DE PAGAMENTO — Asaas
  // URL pública: /api/public/payment-webhook/asaas/:token
  // O :token é o paymentConfig.webhookToken do portal (identifica qual portal).
  // Asaas envia POST com { event, payment } após qualquer mudança de status.
  // ══════════════════════════════════════════════

  app.post('/api/public/payment-webhook/asaas/:token', async (req, reply) => {
    const { token } = req.params as any
    if (!token || typeof token !== 'string' || token.length < 20) {
      return reply.code(400).send({ error: 'Token inválido' })
    }

    // Match 1: nova tabela PaymentProviderConnection (preferido)
    // Match 2: legacy — paymentConfig.webhookToken por portal
    let portal: any = null
    const conn = await prisma.paymentProviderConnection.findUnique({
      where: { webhookToken: token },
      select: { id: true, active: true, provider: true, webhookSecret: true },
    })

    // Autenticidade: Asaas envia o token de autenticação no header asaas-access-token.
    // Sem essa checagem, qualquer um que conheça a URL marca matrículas como pagas.
    const asaasAuth = verifyPaymentWebhookAuth('asaas', conn?.webhookSecret, req)
    if (!asaasAuth.ok) {
      await logSecurityEvent({ ip: req.ip, type: 'payment_webhook_invalid_signature', severity: 'high', path: req.url, details: 'Asaas webhook: asaas-access-token inválido' }).catch(() => {})
      return reply.code(401).send({ error: 'Assinatura inválida' })
    }
    if (!asaasAuth.configured) {
      req.log.warn('[asaas-webhook][SECURITY] conexão sem webhookSecret — configure o token de autenticação no painel Asaas para impedir fraude de confirmação de pagamento')
    }
    if (conn && conn.active && conn.provider === 'asaas') {
      // Qualquer portal ligado a essa conexão serve para identificar conversão.
      // O externalReference do payment linka ao enrollment diretamente — portal só
      // é usado para incrementar counters.
      portal = await prisma.enrollmentPortal.findFirst({
        where: { paymentConnectionId: conn.id },
        select: { id: true, paymentConfig: true },
      })
    }
    if (!portal) {
      const portals = await prisma.enrollmentPortal.findMany({
        where: { paymentProvider: 'asaas' },
        select: { id: true, paymentConfig: true },
      })
      portal = portals.find(p => {
        const cfg = p.paymentConfig as any
        return cfg && cfg.webhookToken === token
      })
    }
    if (!portal) return reply.code(404).send({ error: 'Portal/conexão não encontrada' })

    const body = req.body as any
    const event: string = body?.event || ''
    const payment = body?.payment

    // Audit do hit — persistido ANTES de processar pra debug em caso de falha.
    const hitId = await recordWebhookHit({
      connectionId: conn?.id ?? null,
      provider: 'asaas',
      eventType: event || 'unknown',
      externalId: payment?.id ?? null,
      status: 'received',
      payload: body,
      remoteIp: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    })

    if (!isAsaasPaymentEvent(event) || !payment?.id) {
      // Event não reconhecido — responde 200 para Asaas não reenviar
      req.log.info(`[asaas-webhook] event ignorado: ${event}`)
      if (hitId) await updateWebhookHit(hitId, { status: 'ignored' })
      return { ok: true, ignored: true }
    }

    // Identifica enrollment pelo externalReference (formato "enrollment-<id>")
    let enrollmentId: number | null = null
    const ref = String(payment.externalReference || '')
    const m = ref.match(/^enrollment-(\d+)$/)
    if (m) enrollmentId = parseInt(m[1])

    let enrollment: any = null
    if (enrollmentId) {
      enrollment = await prisma.enrollmentRegistration.findUnique({ where: { id: enrollmentId } })
    }
    if (!enrollment) {
      // Fallback: busca pelo paymentId
      enrollment = await prisma.enrollmentRegistration.findFirst({ where: { paymentId: payment.id } })
    }
    if (!enrollment) {
      req.log.warn(`[asaas-webhook] enrollment não encontrado para payment ${payment.id}`)
      if (hitId) await updateWebhookHit(hitId, { status: 'notFound' })
      return { ok: true, notFound: true }
    }

    const newPaymentStatus = ASAAS_STATUS_MAP[payment.status] || 'pending'
    const wasPaid = enrollment.paymentStatus === 'paid'
    const isPaidNow = newPaymentStatus === 'paid'

    const updates: any = {
      paymentStatus: newPaymentStatus,
      paymentMethod: payment.billingType || enrollment.paymentMethod,
    }
    if (isPaidNow && !enrollment.paymentPaidAt) {
      updates.paymentPaidAt = payment.paymentDate ? new Date(payment.paymentDate) : new Date()
      updates.status = 'paid'
    }
    if (newPaymentStatus === 'overdue' && enrollment.status === 'pending') {
      updates.status = 'expired'
    }

    await prisma.enrollmentRegistration.update({ where: { id: enrollment.id }, data: updates })

    // Espelha no EnrollmentPaymentMethod (checkout transparente) — match pelo externalId.
    // Para modo 'link' antigo não há row → updateMany retorna count=0, sem erro.
    await prisma.enrollmentPaymentMethod.updateMany({
      where: { registrationId: enrollment.id, externalId: payment.id, provider: 'asaas' },
      data: {
        status: newPaymentStatus,
        ...(isPaidNow && !wasPaid ? { paidAt: payment.paymentDate ? new Date(payment.paymentDate) : new Date() } : {}),
      },
    }).catch(() => {})

    // Log + atualiza counters do portal (apenas na primeira vez que virou pago)
    if (isPaidNow && !wasPaid) {
      // Trilha de auditoria financeira (F5): registra toda confirmação de pagamento
      // por webhook — ação sensível a fraude (C1). Severidade elevada quando a
      // conexão aceitou o webhook SEM um webhookSecret configurado.
      await logSecurityEvent({
        ip: req.ip,
        type: 'payment_confirmed_webhook',
        severity: asaasAuth.configured ? 'info' : 'medium',
        path: req.url,
        details: `Asaas: ${enrollment.candidateCode} marcado PAGO (paymentId=${payment.id}, valor=${payment.value}, secretConfigurado=${asaasAuth.configured})`,
      }).catch(() => {})
      await prisma.enrollmentPortal.update({
        where: { id: portal.id },
        data: { conversions: { increment: 1 } },
      })
      if (enrollment.leadId) {
        logEvent({
          leadId: enrollment.leadId,
          type: 'payment_received',
          category: 'lifecycle',
          title: `Pagamento recebido — ${enrollment.candidateCode}`,
          channel: 'payment',
          source: 'asaas',
          actorType: 'system',
          metadata: { event, paymentId: payment.id, amount: payment.value, billingType: payment.billingType },
        })
      }
      // Notificação opcional ao candidato
      import('../services/enrollmentNotify.js').then(m =>
        m.sendPaymentConfirmation?.({ enrollmentId: enrollment.id }).catch(() => {})
      ).catch(() => {})
    }

    if (hitId) await updateWebhookHit(hitId, { status: 'processed', registrationId: enrollment.id })
    return { ok: true, event, paymentStatus: newPaymentStatus }
  })

  // ══════════════════════════════════════════════
  // WEBHOOK DE PAGAMENTO — Pagar.me
  // URL pública: /api/public/payment-webhook/pagarme/:token
  // O :token é o webhookToken da PaymentProviderConnection (provider=pagarme).
  // Pagar.me envia POST com { type, data } após qualquer mudança em order/charge.
  // ══════════════════════════════════════════════

  app.post('/api/public/payment-webhook/pagarme/:token', async (req, reply) => {
    const { token } = req.params as any
    if (!token || typeof token !== 'string' || token.length < 20) {
      return reply.code(400).send({ error: 'Token inválido' })
    }

    const conn = await prisma.paymentProviderConnection.findUnique({
      where: { webhookToken: token },
      select: { id: true, active: true, provider: true, webhookSecret: true },
    })
    if (!conn || !conn.active || conn.provider !== 'pagarme') {
      return reply.code(404).send({ error: 'Conexão não encontrada' })
    }

    // Autenticidade: Pagar.me usa Basic Auth (header authorization) no webhook.
    const pagarmeAuth = verifyPaymentWebhookAuth('pagarme', conn.webhookSecret, req)
    if (!pagarmeAuth.ok) {
      await logSecurityEvent({ ip: req.ip, type: 'payment_webhook_invalid_signature', severity: 'high', path: req.url, details: 'Pagar.me webhook: authorization inválido' }).catch(() => {})
      return reply.code(401).send({ error: 'Assinatura inválida' })
    }
    if (!pagarmeAuth.configured) {
      req.log.warn('[pagarme-webhook][SECURITY] conexão sem webhookSecret — configure Basic Auth no webhook do Pagar.me para impedir fraude de confirmação de pagamento')
    }

    const portal = await prisma.enrollmentPortal.findFirst({
      where: { paymentConnectionId: conn.id },
      select: { id: true },
    })

    const { event, payment } = parsePagarmeWebhookPayload(req.body)

    // Audit do hit — persistido ANTES de processar.
    const hitId = await recordWebhookHit({
      connectionId: conn.id,
      provider: 'pagarme',
      eventType: event || 'unknown',
      externalId: payment?.id ?? null,
      status: 'received',
      payload: req.body,
      remoteIp: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    })

    if (!isPagarmePaymentEvent(event) || !payment) {
      req.log.info(`[pagarme-webhook] event ignorado: ${event}`)
      if (hitId) await updateWebhookHit(hitId, { status: 'ignored' })
      return { ok: true, ignored: true }
    }

    // Identifica enrollment pelo externalReference ("enrollment-<id>") ou paymentId
    let enrollment: any = null
    const ref = String(payment.externalReference || '')
    const m = ref.match(/^enrollment-(\d+)$/)
    if (m) {
      enrollment = await prisma.enrollmentRegistration.findUnique({ where: { id: parseInt(m[1]) } })
    }
    if (!enrollment) {
      enrollment = await prisma.enrollmentRegistration.findFirst({ where: { paymentId: payment.id } })
    }
    if (!enrollment) {
      req.log.warn(`[pagarme-webhook] enrollment não encontrado para payment ${payment.id}`)
      if (hitId) await updateWebhookHit(hitId, { status: 'notFound' })
      return { ok: true, notFound: true }
    }

    const newPaymentStatus = payment.status
    const wasPaid = enrollment.paymentStatus === 'paid'
    const isPaidNow = newPaymentStatus === 'paid'

    const updates: any = {
      paymentStatus: newPaymentStatus,
      paymentMethod: payment.billingType !== 'UNDEFINED' ? payment.billingType : enrollment.paymentMethod,
    }
    if (isPaidNow && !enrollment.paymentPaidAt) {
      updates.paymentPaidAt = payment.paymentDate ? new Date(payment.paymentDate) : new Date()
      updates.status = 'paid'
    }
    if (newPaymentStatus === 'overdue' && enrollment.status === 'pending') {
      updates.status = 'expired'
    }

    await prisma.enrollmentRegistration.update({ where: { id: enrollment.id }, data: updates })

    // Espelha no EnrollmentPaymentMethod (checkout transparente) — match pelo externalId.
    // Para modo 'link' antigo não há row → updateMany retorna count=0, sem erro.
    await prisma.enrollmentPaymentMethod.updateMany({
      where: { registrationId: enrollment.id, externalId: payment.id, provider: 'pagarme' },
      data: {
        status: newPaymentStatus,
        ...(isPaidNow && !wasPaid ? { paidAt: payment.paymentDate ? new Date(payment.paymentDate) : new Date() } : {}),
      },
    }).catch(() => {})

    if (isPaidNow && !wasPaid) {
      // Trilha de auditoria financeira (F5): ver bloco Asaas.
      await logSecurityEvent({
        ip: req.ip,
        type: 'payment_confirmed_webhook',
        severity: pagarmeAuth.configured ? 'info' : 'medium',
        path: req.url,
        details: `Pagar.me: ${enrollment.candidateCode} marcado PAGO (paymentId=${payment.id}, valor=${payment.value}, secretConfigurado=${pagarmeAuth.configured})`,
      }).catch(() => {})
    }
    if (isPaidNow && !wasPaid && portal) {
      await prisma.enrollmentPortal.update({
        where: { id: portal.id },
        data: { conversions: { increment: 1 } },
      })
      if (enrollment.leadId) {
        logEvent({
          leadId: enrollment.leadId,
          type: 'payment_received',
          category: 'lifecycle',
          title: `Pagamento recebido — ${enrollment.candidateCode}`,
          channel: 'payment',
          source: 'pagarme',
          actorType: 'system',
          metadata: { event, paymentId: payment.id, amount: payment.value, billingType: payment.billingType },
        })
      }
      import('../services/enrollmentNotify.js').then(m =>
        m.sendPaymentConfirmation?.({ enrollmentId: enrollment.id }).catch(() => {})
      ).catch(() => {})
    }

    if (hitId) await updateWebhookHit(hitId, { status: 'processed', registrationId: enrollment.id })
    return { ok: true, event, paymentStatus: newPaymentStatus }
  })
}

// ─── Helper: HTML de comprovante (imprimível / salvar como PDF) ───
function escHtml(s: any): string {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Traduções de status/método de pagamento — usadas no comprovante e em outros HTMLs.
const PAYMENT_STATUS_PT: Record<string, string> = {
  paid: 'Pago', pending: 'Pendente', failed: 'Falhou', overdue: 'Vencido',
  expired: 'Expirado', refunded: 'Reembolsado', received: 'Recebido',
  cancelled: 'Cancelado', canceled: 'Cancelado', processing: 'Processando',
}
function paymentStatusLabelPt(s: string | null | undefined, uppercase = false): string {
  if (!s) return '—'
  // Forma especial usada no comprovante quando paid=CONFIRMADO
  if (s === 'paid' && uppercase) return 'CONFIRMADO'
  const label = PAYMENT_STATUS_PT[s] || s
  return uppercase ? label.toUpperCase() : label
}

const PAYMENT_METHOD_PT: Record<string, string> = {
  pix: 'PIX', PIX: 'PIX',
  boleto: 'Boleto', BOLETO: 'Boleto',
  credit_card: 'Cartão', CREDIT_CARD: 'Cartão',
  UNDEFINED: 'A escolher',
}
function paymentMethodLabelPt(m: string | null | undefined): string {
  if (!m) return '—'
  return PAYMENT_METHOD_PT[m] || m
}

function renderReceiptHtml(reg: any): string {
  const fd = reg.formData || {}
  const nome = escHtml(reg.lead?.nome || fd.nome || '-')
  const cpf = escHtml(fd.cpf || '-')
  const email = escHtml(reg.lead?.email || fd.email || '-')
  const wpp = escHtml(reg.lead?.whatsapp || fd.whatsapp || '-')
  const portal = reg.portal
  const offering = reg.processRegistration?.offering
  const course = offering?.course
  const campus = offering?.campuses?.[0]?.campus
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'
  const fmtMoney = (v: any) => v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'

  // Foco no funil: derivar etapa atual do lead em vez do status interno do registration
  const stages = reg.portal?.funnel?.stages || []
  const leadStageKey = reg.lead?.status || null
  const stage = stages.find((s: any) => s.key === leadStageKey)
  const stageName = stage?.name || (leadStageKey || 'Em processamento')
  const stageColor = stage?.color || '#1a73e8'
  const requirePayment = !!reg.portal?.requirePayment

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Comprovante de Inscrição — ${escHtml(reg.candidateCode)}</title>
<style>
  @page { size: A4; margin: 20mm }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;color:#1a2332;background:#fff;padding:30px;max-width:800px;margin:0 auto}
  .header{text-align:center;border-bottom:3px double #1a73e8;padding-bottom:16px;margin-bottom:24px}
  h1{font-size:22px;color:#1a73e8;margin-bottom:4px}
  .subtitle{color:#6b7280;font-size:13px}
  .code-box{background:#f0f7ff;border:2px solid #1a73e8;border-radius:10px;padding:16px;margin:20px 0;text-align:center}
  .code-box .label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px}
  .code-box .code{font-family:ui-monospace,monospace;font-size:26px;font-weight:700;color:#1a73e8}
  .section{margin:18px 0}
  .section-title{font-size:13px;font-weight:600;color:#1a73e8;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  td{padding:6px 0;font-size:13px;vertical-align:top}
  td.label{color:#6b7280;width:35%;font-weight:500}
  .badge{display:inline-block;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:600}
  .badge-ok{background:#d1fae5;color:#137333}
  .badge-pending{background:#fef7e0;color:#b06000}
  .footer{margin-top:30px;padding-top:16px;border-top:1px dashed #d1d5db;font-size:10px;color:#9ca3af;text-align:center;line-height:1.6}
  .print-btn{position:fixed;top:20px;right:20px;padding:10px 20px;background:#1a73e8;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:600}
  @media print{.print-btn{display:none}body{padding:0}}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Imprimir / Salvar PDF</button>
<div class="header">
  <h1>Comprovante de Inscrição</h1>
  <div class="subtitle">${escHtml(portal?.unit?.nome || '')} · ${escHtml(portal?.nome || '')}</div>
</div>

<div class="code-box">
  <div class="label">Código do candidato</div>
  <div class="code">${escHtml(reg.candidateCode)}</div>
</div>

<div class="section">
  <div class="section-title">Dados do candidato</div>
  <table>
    <tr><td class="label">Nome completo:</td><td>${nome}</td></tr>
    <tr><td class="label">CPF:</td><td>${cpf}</td></tr>
    <tr><td class="label">E-mail:</td><td>${email}</td></tr>
    <tr><td class="label">WhatsApp:</td><td>${wpp}</td></tr>
    ${fd.cidade ? `<tr><td class="label">Cidade:</td><td>${escHtml(fd.cidade)}</td></tr>` : ''}
    ${fd.endereco ? `<tr><td class="label">Endereço:</td><td>${escHtml(fd.endereco)}${fd.numero ? ', ' + escHtml(fd.numero) : ''}${fd.bairro ? ' — ' + escHtml(fd.bairro) : ''}</td></tr>` : ''}
  </table>
</div>

${offering ? `<div class="section">
  <div class="section-title">Oferta escolhida</div>
  <table>
    <tr><td class="label">Curso:</td><td><strong>${escHtml(course?.nome || offering.nome)}</strong></td></tr>
    ${offering.turno ? `<tr><td class="label">Turno:</td><td>${escHtml(offering.turno)}</td></tr>` : ''}
    ${campus ? `<tr><td class="label">Campus:</td><td>${escHtml(campus.nome)}${campus.cidade ? ' — ' + escHtml(campus.cidade) : ''}${campus.estado ? '/' + escHtml(campus.estado) : ''}</td></tr>` : ''}
    ${offering.valorMatricula ? `<tr><td class="label">Matrícula:</td><td>${fmtMoney(offering.valorMatricula)}</td></tr>` : ''}
    ${offering.valorMensalidade ? `<tr><td class="label">Mensalidade:</td><td>${fmtMoney(offering.valorMensalidade)}</td></tr>` : ''}
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">${requirePayment && (reg.paymentAmount || reg.paymentStatus) ? 'Etapa e pagamento' : 'Etapa atual'}</div>
  <table>
    <tr><td class="label">Etapa do funil:</td><td><span class="badge" style="background:${stageColor}1a;color:${stageColor};border:1px solid ${stageColor}40">${escHtml(stageName)}</span></td></tr>
    ${requirePayment && reg.paymentAmount ? `<tr><td class="label">Taxa de inscrição:</td><td>${fmtMoney(reg.paymentAmount)}</td></tr>` : ''}
    ${requirePayment && reg.paymentStatus ? `<tr><td class="label">Pagamento:</td><td><span class="badge ${reg.paymentStatus === 'paid' ? 'badge-ok' : 'badge-pending'}">${escHtml(paymentStatusLabelPt(reg.paymentStatus, true))}</span></td></tr>` : ''}
    ${requirePayment && reg.paymentPaidAt ? `<tr><td class="label">Pago em:</td><td>${fmtDate(reg.paymentPaidAt)}</td></tr>` : ''}
    ${requirePayment && reg.paymentMethod ? `<tr><td class="label">Método:</td><td>${escHtml(paymentMethodLabelPt(reg.paymentMethod))}</td></tr>` : ''}
  </table>
</div>

<div class="section">
  <div class="section-title">Registro</div>
  <table>
    <tr><td class="label">Data da inscrição:</td><td>${fmtDate(reg.createdAt)}</td></tr>
    <tr><td class="label">Última atualização:</td><td>${fmtDate(reg.updatedAt)}</td></tr>
  </table>
</div>

<div class="footer">
  Este comprovante foi emitido eletronicamente em ${fmtDate(new Date())}.<br>
  Código de autenticação: ${escHtml(reg.candidateCode)} · ID ${reg.id}<br>
  ${escHtml(portal?.unit?.nome || '')} — todos os direitos reservados
</div>
</body></html>`
}
