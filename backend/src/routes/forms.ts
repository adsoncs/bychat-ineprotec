// src/routes/forms.ts
// Forms — CRUD admin + submit público + embed Web Component + pipeline form→lead

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { JWT_SECRET } from '../lib/secrets.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { logEvent, EVENT_TYPES, getIp } from '../services/leadHistory.js'
import { assertUrlIsPublic } from '../lib/urlSafety.js'
import { onLeadStageChanged } from '../services/metaCapi.js'
import { createLeadFromForm, moveLeadStage, resolveQualification, buildCustomFieldValues } from '../services/formFlow.js'
import { rejectLeadEntry, candidateFromForm } from '../services/leadBlocklist.js'
import { renderFormCanvas } from '../services/formRenderer.js'
import { beyondTrackingSnippet, beyondTrackingInlineJs } from '../lib/beyondTracking.js'
import { dispatchConversion } from '../services/googleAdsConversions.js'
import { logTitularConsent } from './consent.js'
import { createHmac } from 'crypto'

// ── Token de progresso (captura parcial) ──────────────────────────────────────
// Protege o endpoint público /progress e o finalize do /submit: só quem recebeu
// o token (gerado no 'start') pode mover/finalizar AQUELE lead. HMAC do par
// formId:leadId com JWT_SECRET — não dá pra forjar sem o segredo do servidor.
function progressToken(formId: number, leadId: number): string {
  return createHmac('sha256', JWT_SECRET)
    .update(`${formId}:${leadId}`).digest('hex').slice(0, 32)
}
function verifyProgressToken(formId: number, leadId: number, token: any): boolean {
  return typeof token === 'string' && token.length === 32 && token === progressToken(formId, leadId)
}

// Rate limit para submissions
const submitCounts = new Map<string, { count: number, reset: number }>()

// Sanitiza HTML livre de bloco (admin-authored) antes de injetar na página pública:
// remove <script>, handlers on*= e javascript:. Não é um sanitizer completo, mas
// bloqueia os vetores óbvios de XSS para conteúdo exibido ao lead.
export function sanitizeBlockHtml(input: any): string {
  let v = typeof input === 'string' ? input : ''
  if (!v) return ''
  // Dados antigos podem ter vindo entity-encoded (&lt;span&gt;) e devem renderizar
  // como HTML. Decodifica quando parece escapado e não há tags cruas.
  if (/&lt;|&gt;/.test(v) && !/<[a-z!/]/i.test(v)) {
    v = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
         .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  }
  v = v.replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
       .replace(/<\s*script\b[^>]*>/gi, '')
       .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
       .replace(/javascript:/gi, '')
  return v
}

// Normaliza um texto em slug de URL (a-z0-9 + hífens).
function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

// Gera um slug único para Form (sufixa -2, -3… em colisão). excludeId ignora o próprio.
async function uniqueFormSlug(base: string, excludeId?: number): Promise<string> {
  let root = slugify(base) || 'formulario'
  let slug = root
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found = await prisma.form.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } })
    if (!found) return slug
    n++
    slug = `${root}-${n}`.slice(0, 120)
  }
}

export async function formsRoutes(app: FastifyInstance) {

  // ══════════════════════════════════════════════
  // PUBLIC — Submit de formulário
  // ══════════════════════════════════════════════

  app.post('/api/forms/submit/:id', async (req, reply) => {
    const { id } = req.params as any
    const ip = getIp(req)

    // Rate limit: 5 submits/min per IP
    const now = Date.now()
    const entry = submitCounts.get(ip) || { count: 0, reset: now + 60000 }
    if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000 }
    entry.count++
    submitCounts.set(ip, entry)
    if (entry.count > 5) {
      return reply.code(429).send({ ok: false, error: 'Muitas tentativas. Aguarde 1 minuto.' })
    }

    try {
      const form = await prisma.form.findUnique({ where: { id: parseInt(id) } })
      if (!form || !form.active) return reply.code(404).send({ ok: false, error: 'Formulário não encontrado' })

      const body = req.body as any
      const data = body.data || {}
      const fields: any[] = Array.isArray(form.fields) ? form.fields as any[] : []
      const settings = form.settings as any || {}

      // Resolve a qualificação já aqui (função pura sobre as respostas): decide
      // etapa, finalização e se a validação de obrigatórios deve ser pulada.
      const qualify = resolveQualification(fields, data, settings)

      // Validar campos obrigatórios — EXCETO quando a qualificação finaliza o form
      // antes (early-finish): os campos seguintes não foram respondidos de propósito,
      // então exigir obrigatórios aqui abortaria o submit e impediria o redirect.
      if (!qualify?.finish) {
        for (const field of fields) {
          if (field.required && !data[field.key]) {
            return reply.code(400).send({ ok: false, error: `Campo "${field.label}" é obrigatório` })
          }
        }
      }

      // Salvar submission.
      // Quando o lead JÁ converteu ao agendar (recordFormConversionFromBooking
      // grava a submissão no servidor, no /book), reaproveita aquela linha em vez
      // de criar uma segunda — senão o mesmo lead contaria duas conversões.
      const alreadyId = (body.leadId && verifyProgressToken(form.id, Number(body.leadId), body.token))
        ? (await prisma.formSubmission.findFirst({ where: { formId: form.id, leadId: Number(body.leadId) }, select: { id: true } }))?.id ?? null
        : null

      const submission = alreadyId
        ? await prisma.formSubmission.update({
            where: { id: alreadyId },
            data: {
              data,
              pageSlug: body.pageSlug || null,
              ip,
              userAgent: (req.headers['user-agent'] || '').slice(0, 500),
              referrer: body.referrer || req.headers.referer || null,
            },
          })
        : await prisma.formSubmission.create({
            data: {
              formId: form.id,
              data,
              pageSlug: body.pageSlug || null,
              visitorId: body.bt_vid || null,
              ip,
              userAgent: (req.headers['user-agent'] || '').slice(0, 500),
              referrer: body.referrer || req.headers.referer || null,
              utmSource: body.utmSource || null,
              utmMedium: body.utmMedium || null,
              utmCampaign: body.utmCampaign || null,
            }
          })

      // Incrementar contador — só quando a submissão é nova.
      if (!alreadyId) {
        prisma.form.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } }).catch(() => {})
      }

      // Incrementar submissions na LP se veio de uma
      if (body.pageSlug) {
        prisma.landingPage.updateMany({
          where: { slug: body.pageSlug },
          data: { submissions: { increment: 1 } }
        }).catch(() => {})
      }

      // ── Pipeline: criar/vincular lead ──
      let leadId: number | null = null
      // Tokens p/ interpolar no redirect (ex.: /agendar/x?name={{nome}}&email={{email}})
      const redirectTokens: Record<string, string> = {}
      try {
        // Mapeados p/ interpolar no redirect (mapeados têm prioridade sobre crus).
        Object.assign(redirectTokens, data)
        for (const field of fields) if (field.mapTo && data[field.key]) redirectTokens[field.mapTo] = String(data[field.key])

        // Finaliza um lead já capturado parcialmente (/progress, via token) OU cria um novo.
        const finalizeId = (body.leadId && verifyProgressToken(form.id, Number(body.leadId), body.token)) ? Number(body.leadId) : null
        let convStageKey: string | null = null
        if (finalizeId) {
          const ex = await prisma.lead.findUnique({ where: { id: finalizeId }, select: { status: true, formData: true, customFields: true } })
          if (ex) {
            leadId = finalizeId
            convStageKey = ex.status
            // Re-mapeia campos personalizados a partir das respostas COMPLETAS: na
            // captura parcial o lead nasce só com nome/telefone, e respostas tardias
            // (instagram, faturamento, etc.) só chegam agora, no envio final.
            const cfv = await buildCustomFieldValues(fields, data)
            await prisma.lead.update({ where: { id: finalizeId }, data: {
              formData: { ...((ex.formData as any) || {}), ...data },
              completed: true,
              ...(Object.keys(cfv).length > 0 ? { customFields: { ...((ex.customFields as any) || {}), ...cfv } } : {}),
            } })
          }
        }
        // Lista de bloqueio: submissão segue registrada (auditoria), mas o lead
        // não nasce. A resposta é a mesma de sempre — bloqueio silencioso.
        const bloqueio = await rejectLeadEntry(candidateFromForm(fields, data, ip), 'formulário')
        if (!leadId && !bloqueio) {
          const created = await createLeadFromForm(form, fields, data, body, ip, submission.id)
          if (created) {
            leadId = created.leadId
            convStageKey = created.targetStageKey
            try { const { notifyNewLead } = await import('../services/notify.js'); notifyNewLead(created.newLead).catch(() => {}) } catch {}
          }
        }

        // Roteamento por qualificação (negativo vence): move o lead para a etapa
        // decisiva do funil (já resolvido acima a partir das respostas).
        if (leadId && qualify && qualify.stageKey) {
          // forwardOnly em qualificação positiva: não regride o lead que já avançou
          // (ex.: agendou a reunião neste mesmo form). Desqualificação (finish) move sempre.
          const effectiveStage = await moveLeadStage(leadId, qualify.funnelId ?? form.funnelId ?? null, qualify.stageKey, 'form', { forwardOnly: !qualify.finish }).catch(() => null)
          if (effectiveStage) convStageKey = effectiveStage
        }

        // Conversão server-side (Meta CAPI + Google Ads), gated pelo toggle do form.
        if (leadId) {
          const dm = settings.displayMode === 'conversational' ? 'conversational' : 'classic'
          const fireConv = settings.fireConversions !== undefined ? !!settings.fireConversions : (dm === 'conversational')
          if (fireConv) {
            onLeadStageChanged(leadId, convStageKey || form.stageKey || 'NOVO', body.eventId ? String(body.eventId) : undefined).catch((e) => console.error('[Forms] CAPI fire error:', (e as any).message))
            dispatchConversion('lead_qualified', leadId).catch((e) => console.error('[Forms] GoogleAds fire error:', (e as any).message))
          }
        }

        // Vincular submission ao lead
        if (leadId) {
          await prisma.formSubmission.update({ where: { id: submission.id }, data: { leadId } })
        }

        // Registro de consentimento do titular (LGPD): o envio só é aceito pelo
        // client após marcar o checkbox da Política — aqui gravamos a prova.
        if (leadId && body.lgpdConsent === true) {
          await logTitularConsent({
            req, leadId, visitorId: body.bt_vid || null, action: 'form_submit',
            source: body.pageSlug ? `form:${body.pageSlug}` : `form:${form.id}`,
            url: body.referrer || (req.headers.referer as string) || null,
            categories: { form: true },
          })
        }
      } catch (e) {
        console.error('[Forms] lead pipeline error:', (e as any).message)
      }

      // Webhook externo (com SSRF protection + HMAC signature). Revalida no
      // disparo (resolve DNS) e usa timeout para não pendurar a request pública.
      if (form.webhookUrl) {
        const whUrl = form.webhookUrl
        ;(async () => {
          const pub = await assertUrlIsPublic(whUrl)
          if (!pub.ok) return
          const payload = JSON.stringify({ formId: form.id, formName: form.name, data, submissionId: submission.id, leadId, timestamp: new Date().toISOString() })
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          const secret = (form as any).webhookSecret as string | undefined
          if (secret) {
            const crypto = await import('crypto')
            const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
            headers['X-Form-Signature'] = `sha256=${sig}`
          }
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10000)
          await fetch(whUrl, { method: 'POST', headers, body: payload, signal: controller.signal }).catch(() => {})
          clearTimeout(timeout)
        })().catch(() => {})
      }

      const response: any = { ok: true, submissionId: submission.id }

      // Interpola {{token}} (valores enviados, URL-encoded) e valida o destino:
      // path relativo de mesma origem OU http/https — bloqueia javascript:/data:/etc.
      // URL é do admin (não do submitter). Retorna a URL segura ou null.
      const buildRedirect = (url: any): string | null => {
        if (!url || typeof url !== 'string') return null
        const r = url.trim().replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m: string, k: string) => {
          const val = redirectTokens[k]
          return val != null ? encodeURIComponent(String(val)) : ''
        })
        if (!r) return null
        if (r.startsWith('/') && !r.startsWith('//')) return r
        try {
          const ru = new URL(r)
          if (ru.protocol === 'http:' || ru.protocol === 'https:') return r
        } catch { /* invalid */ }
        return null
      }

      // Finalização por QUALIFICAÇÃO tem precedência sobre o redirect global do form.
      if (qualify && qualify.finish) {
        if (qualify.finishAction === 'redirect') {
          const rr = buildRedirect(qualify.redirectUrl)
          if (rr) response.redirect = rr
        } else {
          const msg = sanitizeBlockHtml(qualify.message)
          if (msg) response.successHtml = msg // senão, client usa a mensagem padrão
        }
        return response
      }

      // Redirect global do form: respeita toggle redirectEnabled (compat: habilitado
      // quando há URL preenchida em forms antigos).
      const redirectEnabled = settings.redirectEnabled !== undefined
        ? !!settings.redirectEnabled
        : !!(settings.redirectUrl && String(settings.redirectUrl).trim())
      if (redirectEnabled) {
        const rr = buildRedirect(settings.redirectUrl)
        if (rr) response.redirect = rr
      }

      return response
    } catch (err: any) {
      console.error('[Forms] submit error:', err.message)
      return reply.code(500).send({ ok: false, error: 'Erro interno' })
    }
  })

  // ── POST /api/forms/progress/:id ─── Captura PARCIAL (jornada de funil) ──
  // phase 'start': cria o lead na etapa inicial assim que nome+telefone existem
  //   → devolve { leadId, token }. phase 'qualify': move o lead p/ a etapa
  //   positiva/negativa conforme a resposta da pergunta de qualificação.
  app.post('/api/forms/progress/:id', async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id)
      if (isNaN(id)) return reply.code(404).send({ ok: false })
      const form = await prisma.form.findUnique({ where: { id } })
      if (!form || !form.active) return reply.code(404).send({ ok: false })

      const settings = (form.settings as any) || {}
      const journey = settings.journey || {}
      if (journey.partialCapture === false) return reply.send({ ok: true, skipped: true })

      const body = req.body as any
      const data = body.data || {}
      const fields: any[] = Array.isArray(form.fields) ? form.fields as any[] : []
      const ip = getIp(req)
      const phase = body.phase

      if (phase === 'start') {
        // Rate limit (cria lead) — mesmo balde do submit: 5/min por IP.
        const now = Date.now()
        const entry = submitCounts.get(ip) || { count: 0, reset: now + 60000 }
        if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000 }
        entry.count++; submitCounts.set(ip, entry)
        if (entry.count > 5) return reply.code(429).send({ ok: false })

        if (await rejectLeadEntry(candidateFromForm(fields, data, ip), 'formulário (início)')) {
          return reply.send({ ok: true })
        }
        const created = await createLeadFromForm(form, fields, data, body, ip, null)
        if (!created) return reply.send({ ok: true }) // ainda sem nome/email/whatsapp

        // Prova do consentimento no MOMENTO em que o lead nasce. O aceite passou a
        // ser pedido antes da coleta, e o envio final pode nunca acontecer (quem
        // agenda e fecha a aba já conta como conversão) — gravar só lá deixaria a
        // conversão registrada sem a prova correspondente.
        if (body.lgpdConsent === true) {
          await logTitularConsent({
            req, leadId: created.leadId, visitorId: body.bt_vid || null, action: 'form_start',
            source: body.pageSlug ? `form:${body.pageSlug}` : `form:${form.id}`,
            url: body.referrer || (req.headers.referer as string) || null,
            categories: { form: true },
          }).catch(() => {})
        }
        return reply.send({ ok: true, leadId: created.leadId, token: progressToken(form.id, created.leadId) })
      }

      if (phase === 'qualify') {
        const leadId = Number(body.leadId)
        if (!leadId || !verifyProgressToken(form.id, leadId, body.token)) return reply.code(403).send({ ok: false })
        // Persiste as respostas dadas ATÉ AQUI (não esperar o envio final): se o lead
        // abandonar ou for desqualificado no meio, nenhuma resposta se perde. Salva no
        // formData (histórico) e nos campos personalizados (buildCustomFieldValues).
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true, customFields: true } })
        if (lead) {
          const cfv = await buildCustomFieldValues(fields, data)
          await prisma.lead.update({ where: { id: leadId }, data: {
            formData: { ...((lead.formData as any) || {}), ...data },
            ...(Object.keys(cfv).length > 0 ? { customFields: { ...((lead.customFields as any) || {}), ...cfv } } : {}),
          } }).catch(() => {})
        }
        const q = resolveQualification(fields, data, settings)
        if (q && q.stageKey) {
          await moveLeadStage(leadId, q.funnelId ?? form.funnelId ?? null, q.stageKey, 'form', { forwardOnly: !q.finish }).catch(() => {})
        }
        return reply.send({ ok: true })
      }

      return reply.send({ ok: true })
    } catch (err: any) {
      console.error('[Forms] progress error:', err.message)
      return reply.code(500).send({ ok: false })
    }
  })

  // ── GET /api/forms/config/:id ─── Config pública do form (para embed) ──
  app.get('/api/forms/config/:id', async (req, reply) => {
    const { id } = req.params as any
    const form = await prisma.form.findUnique({ where: { id: parseInt(id) } })
    if (!form || !form.active) return reply.code(404).send({ error: 'Formulário não encontrado' })

    reply.header('Cache-Control', 'public, max-age=300')
    // Mescla styling do form com defaults — clientes do config não precisam
    // duplicar lógica de fallback. Se form.styling é null, devolve só defaults.
    const styling = { ...getDefaultFormStyling(), ...((form.styling as any) ?? {}) }
    return {
      id: form.id,
      name: form.name,
      fields: form.fields,
      settings: form.settings,
      styling,
    }
  })

  // ── GET /api/forms/embed/:id.js ─── Script embed Web Component ──
  app.get('/api/forms/embed/:idjs', async (req, reply) => {
    const idjs = (req.params as any).idjs
    const id = parseInt(idjs.replace('.js', ''))
    if (isNaN(id)) return reply.code(404).send('// form not found')

    const form = await prisma.form.findUnique({ where: { id } })
    if (!form || !form.active) return reply.code(404).send('// form not found')

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const fields: any[] = Array.isArray(form.fields) ? form.fields as any[] : []
    const settings = form.settings as any || {}
    const styling = form.styling as any || {}

    const script = generateEmbedScript(id, fields, settings, styling, baseUrl)

    // O embed reflete a config AO VIVO do formulário (campos, opções, estilo).
    // NÃO pode ser cacheado: um cache antigo serve um formulário desatualizado
    // (ex.: opções de select sem `value` quebram a validação e o botão Enviar
    // "não faz nada"). `Cloudflare-CDN-Cache-Control` instrui o edge do
    // Cloudflare a não cachear, além do Cache-Control padrão para browsers.
    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Cloudflare-CDN-Cache-Control', 'no-store')
      .header('Access-Control-Allow-Origin', '*')
      .send(script)
  })

  // ── GET /f/:id ─── Página hospedada do formulário conversacional (estilo Typeform) ──
  // Full-screen, uma pergunta por vez. ?embed=1 permite iframe (frame-ancestors *).
  app.get('/f/:idOrSlug', async (req, reply) => {
    const raw = String((req.params as any).idOrSlug || '')
    // Resolve por id numérico OU slug amigável (URL acessada direto no navegador).
    const form = /^\d+$/.test(raw)
      ? await prisma.form.findUnique({ where: { id: parseInt(raw) } })
      : await prisma.form.findUnique({ where: { slug: raw } })
    if (!form || !form.active) return reply.code(404).type('text/html').send('<!doctype html><title>404</title>Formulário não encontrado')

    const embed = (req.query as any)?.embed === '1' || (req.query as any)?.embed === 'true'
    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const fields: any[] = Array.isArray(form.fields) ? form.fields as any[] : []
    const settings = form.settings as any || {}
    const styling = { ...getDefaultFormStyling(), ...((form.styling as any) ?? {}) }

    const html = generateConversationalPage(form.id, form.name, fields, settings, styling, baseUrl, embed)
    reply
      .header('Content-Security-Policy', 'frame-ancestors *')
      .header('Cache-Control', 'no-store')
      .type('text/html')
      .send(html)
  })

  // ══════════════════════════════════════════════
  // ADMIN — CRUD de Forms
  // ══════════════════════════════════════════════

  // ── GET /api/forms ──
  app.get('/api/forms', { preHandler: authMiddleware }, async () => {
    const forms = await prisma.form.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, slug: true, active: true, submissions: true,
        funnelId: true, stageKey: true, defaultTeamId: true,
        createdAt: true, updatedAt: true,
      }
    })
    return { forms }
  })

  // ── GET /api/forms/templates ─── Modelos pré-definidos (ANTES de :id!) ──
  app.get('/api/forms/templates', { preHandler: authMiddleware }, async () => {
    return { templates: FORM_TEMPLATES }
  })

  // ── GET /api/forms/:id ──
  app.get('/api/forms/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const form = await prisma.form.findUnique({
      where: { id: parseInt(id) },
      include: { formSubmissions: { orderBy: { createdAt: 'desc' }, take: 50 } }
    })
    if (!form) return reply.code(404).send({ error: 'Formulário não encontrado' })
    return form
  })

  // ── POST /api/forms/:id/preview-html ── Render do canvas (modo editor) ──
  // Espelha POST /api/pages/:id/preview-html: mescla overrides do body sobre o
  // registro e devolve HTML cru (não JSON) do renderFormCanvas. Usado pelo iframe
  // do builder visual. NÃO afeta os renderers públicos (/f/:slug e embed.js).
  app.post('/api/forms/:id/preview-html', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const formId = parseInt(id)
    if (!Number.isFinite(formId)) return reply.code(400).send({ error: 'ID inválido' })

    const stored = await prisma.form.findUnique({ where: { id: formId } })
    if (!stored) return reply.code(404).send({ error: 'Formulário não encontrado' })

    const body = (req.body || {}) as any
    const fields = body.fields !== undefined ? body.fields : (stored.fields as any)
    const settings = body.settings !== undefined ? body.settings : ((stored.settings as any) || {})
    const styling = { ...getDefaultFormStyling(), ...(((body.styling ?? stored.styling) as any) || {}) }

    const baseUrl = process.env.APP_URL || `https://${req.hostname}`
    const html = renderFormCanvas(
      { id: formId, name: stored.name, fields: Array.isArray(fields) ? fields : [], settings, styling, baseUrl },
      { edit: body.edit === true },
    )
    reply.type('text/html').header('Cache-Control', 'no-cache').send(html)
  })

  // ── POST /api/forms ──
  app.post('/api/forms', { preHandler: authMiddleware }, async (req, reply) => {
    const body = req.body as any
    if (!body.name) return reply.code(400).send({ error: 'Nome obrigatório' })

    const slug = await uniqueFormSlug(body.slug || body.name)
    const form = await prisma.form.create({
      data: {
        name: body.name,
        slug,
        fields: body.fields || getDefaultFormFields(),
        settings: body.settings || getDefaultFormSettings(),
        styling: body.styling || null,
        funnelId: body.funnelId || null,
        stageKey: body.stageKey || null,
        defaultTeamId: body.defaultTeamId || null,
        notifyEmails: body.notifyEmails || null,
        webhookUrl: body.webhookUrl || null,
        active: true,
        createdBy: (req as any).user?.userId || null,
      }
    })

    return reply.code(201).send({ ok: true, form })
  })

  // ── PUT /api/forms/:id ──
  app.put('/api/forms/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.slug !== undefined) {
      // slug vazio → regenera a partir do nome; senão normaliza e garante unicidade
      const base = body.slug?.trim() ? body.slug : (body.name ?? '')
      data.slug = await uniqueFormSlug(base, parseInt(id))
    }
    if (body.fields !== undefined) data.fields = body.fields
    if (body.settings !== undefined) data.settings = body.settings
    if (body.styling !== undefined) data.styling = body.styling
    if (body.funnelId !== undefined) data.funnelId = body.funnelId
    if (body.stageKey !== undefined) data.stageKey = body.stageKey
    if (body.defaultTeamId !== undefined) data.defaultTeamId = body.defaultTeamId
    if (body.notifyEmails !== undefined) data.notifyEmails = body.notifyEmails
    if (body.webhookUrl !== undefined) data.webhookUrl = body.webhookUrl
    if (body.active !== undefined) data.active = body.active

    const form = await prisma.form.update({ where: { id: parseInt(id) }, data })
    return { ok: true, form }
  })

  // ── POST /api/forms/:id/duplicate ── Duplicar formulário ──
  // Espelha o comportamento de POST /api/pages/:id/duplicate: cria nova
  // entrada com sufixo "(Cópia)" e zera contador de submissions. Vínculos
  // (funil/etapa/equipe/notificações/webhook) e estilo/fields são copiados.
  app.post('/api/forms/:id/duplicate', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const original = await prisma.form.findUnique({ where: { id: parseInt(id) } })
    if (!original) return reply.code(404).send({ error: 'Formulário não encontrado' })

    const copyName = `${original.name} (Cópia)`.slice(0, 191)
    const copy = await prisma.form.create({
      data: {
        name: copyName,
        slug: await uniqueFormSlug(copyName),
        fields: original.fields as any,
        settings: original.settings as any,
        styling: original.styling as any || undefined,
        funnelId: original.funnelId,
        stageKey: original.stageKey,
        defaultTeamId: original.defaultTeamId,
        notifyEmails: original.notifyEmails,
        webhookUrl: original.webhookUrl,
        active: original.active,
        // submissions zera (cada form tem seu próprio histórico).
        createdBy: (req as any).user?.userId || null,
      }
    })

    return reply.code(201).send({ ok: true, form: copy })
  })

  // ── DELETE /api/forms/:id (move para lixeira) ──
  app.delete('/api/forms/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const user = (req as any).user as JwtPayload
    const snapshot = await snapshotEntity('form', parseInt(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'form',
        entityId: parseInt(id),
        entityLabel: (snapshot as any).name,
        snapshot,
        deletedBy: user.userId,
        deletedByName: user.name || user.email,
      })
    }
    await prisma.form.delete({ where: { id: parseInt(id) } })
    void logUserAudit({
      action: 'form.deleted',
      targetType: 'form',
      targetLabel: (snapshot as any)?.name || `Formulário #${id}`,
      ...auditActor(req),
    })
    return { ok: true }
  })

  // ── GET /api/forms/:id/submissions ─── Listar submissions com dados do lead ──
  app.get('/api/forms/:id/submissions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const q = req.query as any
    const limit = Math.min(100, parseInt(q.limit) || 50)
    const offset = parseInt(q.offset) || 0

    const [submissions, total] = await Promise.all([
      prisma.formSubmission.findMany({
        where: { formId: parseInt(id) },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.formSubmission.count({ where: { formId: parseInt(id) } }),
    ])

    // Enriquecer com dados do lead
    const leadIds = submissions.filter(s => s.leadId).map(s => s.leadId as number)
    let leadsMap: Record<number, any> = {}
    if (leadIds.length > 0) {
      const leads = await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, nome: true, empresa: true, email: true, whatsapp: true, status: true, funnelId: true }
      })
      leadsMap = Object.fromEntries(leads.map(l => [l.id, l]))
    }

    const enriched = submissions.map(s => ({
      ...s,
      lead: s.leadId ? leadsMap[s.leadId] || null : null,
    }))

    return { submissions: enriched, total }
  })

  // ── GET /api/forms/:id/embed-code ─── Snippet de embed ──
  app.get('/api/forms/:id/embed-code', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const baseUrl = process.env.APP_URL || `https://${req.hostname}`

    const form = await prisma.form.findUnique({ where: { id: parseInt(id) }, select: { settings: true, slug: true } })
    const displayMode = (form?.settings as any)?.displayMode === 'conversational' ? 'conversational' : 'classic'

    const snippet = `<!-- Beyond Form Embed -->
<script src="${baseUrl}/api/forms/embed/${id}.js" defer></script>
<beyond-form form-id="${id}"></beyond-form>`

    // Modo conversacional: página hospedada full-screen + embed por iframe.
    // Usa o slug amigável quando disponível; senão cai no id.
    const ref = form?.slug || id
    const hostedUrl = `${baseUrl}/f/${ref}`
    const iframeSnippet = `<!-- Beyond Form (conversacional) -->
<iframe src="${hostedUrl}?embed=1" style="width:100%;min-height:520px;border:0" loading="lazy"></iframe>`

    return { snippet, baseUrl, displayMode, hostedUrl, iframeSnippet }
  })
}

// ─── Default form fields ─────────────────────────
function getDefaultFormFields(): any[] {
  return [
    { id: 'f1', type: 'text', key: 'nome', label: 'Nome', placeholder: 'Seu nome completo', required: true, mapTo: 'nome' },
    { id: 'f2', type: 'email', key: 'email', label: 'E-mail', placeholder: 'seu@email.com', required: true, mapTo: 'email' },
    { id: 'f3', type: 'phone', key: 'whatsapp', label: 'WhatsApp', placeholder: '(62) 9 9999-9999', required: true, mapTo: 'whatsapp' },
    { id: 'f4', type: 'text', key: 'empresa', label: 'Empresa', placeholder: 'Nome da empresa', required: false, mapTo: 'empresa' },
  ]
}

function getDefaultFormSettings(): any {
  return {
    submitText: 'Enviar',
    successTitle: 'Enviado com sucesso!',
    successMessage: 'Entraremos em contato em breve.',
    redirectUrl: null,
  }
}

// ─── Modelos pré-definidos de formulário ("A partir de um modelo") ───────────
// Cada modelo já vem com fields (id+key próprios), settings e styling. Ao criar,
// o frontend manda { name, fields, settings, styling } pro POST /api/forms.
const FORM_TEMPLATES = [
  {
    id: 'capture_fast',
    name: 'Captação rápida',
    description: 'Nome, WhatsApp e e-mail. Poucos campos, foco em conversão — ideal para tráfego pago.',
    category: 'Aquisição',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Nome', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_whats', type: 'phone', key: 'whatsapp', label: 'WhatsApp', mapTo: 'whatsapp', required: true, placeholder: '(00) 00000-0000' },
      { id: 'f_email', type: 'email', key: 'email', label: 'E-mail', mapTo: 'email', required: false, placeholder: 'voce@email.com' },
    ],
    settings: {
      displayMode: 'classic', submitText: 'Quero receber',
      successMode: 'message', successTitle: 'Recebemos seus dados!', successMessage: 'Em breve nossa equipe entra em contato.',
      journey: { partialCapture: true },
    },
    styling: { primaryColor: '#1a73e8' },
  },
  {
    id: 'qualify_conversational',
    name: 'Qualificação conversacional',
    description: 'Uma pergunta por vez (estilo Typeform) com pergunta de qualificação que roteia o lead e pode finalizar.',
    category: 'Qualificação',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Como podemos te chamar?', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_whats', type: 'phone', key: 'whatsapp', label: 'Qual seu WhatsApp?', mapTo: 'whatsapp', required: true, placeholder: '(00) 00000-0000' },
      {
        id: 'f_qualif', type: 'select', key: 'momento', label: 'Você já tem verba definida para investir agora?', required: true,
        isQualifier: true, positiveValues: ['sim'],
        options: [{ value: 'sim', label: 'Sim, já tenho orçamento' }, { value: 'nao', label: 'Ainda não / só pesquisando' }],
        qualifyPositive: { finish: false },
        qualifyNegative: { finish: true, finishAction: 'message', message: '<p>Obrigado por responder! 🙌 No momento ajudamos quem já tem verba definida — mas vamos te enviar materiais gratuitos para te ajudar a chegar lá.</p>' },
      },
    ],
    settings: {
      displayMode: 'conversational', submitText: 'Enviar',
      successMode: 'message', successTitle: 'Tudo certo!', successMessage: 'Recebemos suas respostas. Em breve falamos com você.',
      conversational: { welcomeEnabled: true, welcomeTitle: 'Vamos entender seu momento', welcomeText: 'Leva menos de 1 minuto.', startButtonText: 'Começar', navButtonText: 'OK', showProgress: true },
      journey: { partialCapture: true },
    },
    styling: { primaryColor: '#7c3aed' },
  },
  {
    id: 'scheduling',
    name: 'Agendamento',
    description: 'Coleta o contato e abre um passo de Agendamento para o lead escolher data e hora.',
    category: 'Reuniões',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Seu nome', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_whats', type: 'phone', key: 'whatsapp', label: 'WhatsApp', mapTo: 'whatsapp', required: true, placeholder: '(00) 00000-0000' },
      { id: 'f_email', type: 'email', key: 'email', label: 'E-mail', mapTo: 'email', required: true, placeholder: 'voce@email.com' },
      { id: 'f_agenda', type: 'scheduling', key: 'agendamento', label: 'Escolha o melhor horário', required: false, meetingSlug: '' },
    ],
    settings: {
      displayMode: 'conversational', submitText: 'Confirmar',
      successMode: 'message', successTitle: 'Reunião agendada!', successMessage: 'Enviamos a confirmação para o seu e-mail.',
      conversational: { welcomeEnabled: true, welcomeTitle: 'Vamos marcar sua reunião', welcomeText: 'Escolha um horário que funcione para você.', startButtonText: 'Começar', navButtonText: 'OK', showProgress: true },
      journey: { partialCapture: true },
    },
    styling: { primaryColor: '#0891b2' },
  },
  {
    id: 'quote',
    name: 'Orçamento',
    description: 'Pedido de orçamento com empresa, tipo de serviço e detalhes do projeto.',
    category: 'Vendas',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Nome', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_empresa', type: 'text', key: 'empresa', label: 'Empresa', mapTo: 'empresa', required: false, placeholder: 'Nome da empresa' },
      { id: 'f_whats', type: 'phone', key: 'whatsapp', label: 'WhatsApp', mapTo: 'whatsapp', required: true, placeholder: '(00) 00000-0000' },
      { id: 'f_serv', type: 'select', key: 'servico', label: 'O que você precisa?', required: false, options: [{ value: 'consultoria', label: 'Consultoria' }, { value: 'implementacao', label: 'Implementação' }, { value: 'suporte', label: 'Suporte' }, { value: 'outro', label: 'Outro' }] },
      { id: 'f_det', type: 'textarea', key: 'detalhes', label: 'Detalhes do projeto', required: false, placeholder: 'Conte um pouco sobre o que você precisa…' },
    ],
    settings: {
      displayMode: 'classic', submitText: 'Pedir orçamento',
      successMode: 'message', successTitle: 'Pedido recebido!', successMessage: 'Vamos analisar e retornar com uma proposta.',
      journey: { partialCapture: true },
    },
    styling: { primaryColor: '#0d47a1' },
  },
  {
    id: 'contact',
    name: 'Contato / Fale conosco',
    description: 'Formulário simples de contato: nome, e-mail e mensagem.',
    category: 'Atendimento',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Nome', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_email', type: 'email', key: 'email', label: 'E-mail', mapTo: 'email', required: true, placeholder: 'voce@email.com' },
      { id: 'f_msg', type: 'textarea', key: 'mensagem', label: 'Mensagem', required: true, placeholder: 'Como podemos ajudar?' },
    ],
    settings: {
      displayMode: 'classic', submitText: 'Enviar mensagem',
      successMode: 'message', successTitle: 'Mensagem enviada!', successMessage: 'Respondemos o mais rápido possível.',
      journey: { partialCapture: false },
    },
    styling: { primaryColor: '#202124' },
  },
  {
    id: 'event',
    name: 'Inscrição em evento',
    description: 'Inscrição estilo capa de evento/webinar (conversacional) com nome, e-mail e WhatsApp.',
    category: 'Eventos',
    fields: [
      { id: 'f_nome', type: 'text', key: 'nome', label: 'Seu nome completo', mapTo: 'nome', required: true, placeholder: 'Seu nome' },
      { id: 'f_email', type: 'email', key: 'email', label: 'Seu melhor e-mail', mapTo: 'email', required: true, placeholder: 'voce@email.com' },
      { id: 'f_whats', type: 'phone', key: 'whatsapp', label: 'WhatsApp (para o lembrete)', mapTo: 'whatsapp', required: true, placeholder: '(00) 00000-0000' },
    ],
    settings: {
      displayMode: 'conversational', submitText: 'Garantir minha vaga',
      successMode: 'message', successTitle: 'Inscrição confirmada! 🎉', successMessage: 'Enviamos os detalhes para o seu e-mail. Até lá!',
      conversational: { welcomeEnabled: true, welcomeTitle: 'Garanta sua vaga no evento', welcomeText: 'Vagas limitadas — leva 30 segundos.', startButtonText: 'Quero me inscrever', navButtonText: 'OK', showProgress: true },
      journey: { partialCapture: true },
    },
    styling: { primaryColor: '#d81b60' },
  },
]

// Defaults de aparência. Mantenha em sincronia com o painel de aparência no
// frontend (`frontend-app/src/components/FormAppearancePanel.tsx`) — ambos os
// lados precisam concordar nos nomes/valores pra que o preview bata 100% com
// o embed real. Cores em hex (#rrggbb), tamanhos em CSS units (px/rem/%),
// fonts em CSS font-family stack válido.
export function getDefaultFormStyling(): any {
  return {
    // Cores principais
    primaryColor:        '#1a73e8',
    primaryHoverColor:   '#1557b0',
    buttonTextColor:     '#ffffff',

    // Fundo do wrap (use 'transparent' pra integrar com a página onde foi embedado)
    backgroundColor:     'transparent',

    // Labels
    labelColor:          '#202124',
    labelSize:           '13px',
    labelWeight:         '600',

    // Campos (input/select/textarea)
    fieldBgColor:        '#ffffff',
    fieldBorderColor:    '#dadce0',
    fieldTextColor:      '#202124',
    fieldPlaceholderColor: '#9aa0a6',
    fieldFontSize:       '14px',
    fieldPadding:        '11px 14px',

    // Bordas / formato
    borderRadius:        '8px',
    buttonRadius:        '8px',
    buttonPadding:       '13px',
    buttonFontSize:      '15px',
    buttonFontWeight:    '600',

    // Tipografia
    fontFamily:          "'Inter', system-ui, sans-serif",
    fontSize:            '14px',

    // Layout
    maxWidth:            '480px',
    fieldSpacing:        '16px',

    // Sucesso
    successTitleColor:   '#34a853',
    successTextColor:    '#5f6368',
    successTitleSize:    '20px',

    // Erro
    errorBorderColor:    '#c5221f',

    // Modo conversacional (página hospedada full-screen)
    pageBgColor:         '#ffffff',
    questionSize:        '26px',
    questionWeight:      '600',
    questionColor:       '#202124',
  }
}

// Lê valor de styling com fallback no default. Sanitiza minimamente
// (CSS values entram no <style> do shadow DOM — string simples sem `;` extras
// nem `</style>`). Valores vêm da UI do admin, então o risco é baixo, mas
// vale o cuidado contra acidentes de copy/paste.
function cssVal(input: any, fallback: string): string {
  const v = typeof input === 'string' ? input.trim() : ''
  if (!v) return fallback
  // Bloqueia tentativas de fechar a tag style ou injetar JS via CSS expression()
  if (/<\/style|<script|expression\s*\(|javascript:/i.test(v)) return fallback
  return v
}

// ─── Embed Script Generator (Web Component) ─────
function generateEmbedScript(
  formId: number,
  fields: any[],
  settings: any,
  styling: any,
  baseUrl: string
): string {
  const d = getDefaultFormStyling()
  const s = styling ?? {}
  // Resolve cada token com fallback no default — qualquer chave ausente cai
  // no padrão sem quebrar o CSS.
  const v = {
    primary:                cssVal(s.primaryColor,        d.primaryColor),
    primaryHover:           cssVal(s.primaryHoverColor,   d.primaryHoverColor),
    buttonText:             cssVal(s.buttonTextColor,     d.buttonTextColor),
    background:             cssVal(s.backgroundColor,     d.backgroundColor),
    labelColor:             cssVal(s.labelColor,          d.labelColor),
    labelSize:              cssVal(s.labelSize,           d.labelSize),
    labelWeight:            cssVal(s.labelWeight,         d.labelWeight),
    fieldBg:                cssVal(s.fieldBgColor,        d.fieldBgColor),
    fieldBorder:            cssVal(s.fieldBorderColor,    d.fieldBorderColor),
    fieldText:              cssVal(s.fieldTextColor,      d.fieldTextColor),
    fieldPlaceholder:       cssVal(s.fieldPlaceholderColor, d.fieldPlaceholderColor),
    fieldFontSize:          cssVal(s.fieldFontSize,       d.fieldFontSize),
    fieldPadding:           cssVal(s.fieldPadding,        d.fieldPadding),
    radius:                 cssVal(s.borderRadius,        d.borderRadius),
    buttonRadius:           cssVal(s.buttonRadius,        d.buttonRadius),
    buttonPadding:          cssVal(s.buttonPadding,       d.buttonPadding),
    buttonFontSize:         cssVal(s.buttonFontSize,      d.buttonFontSize),
    buttonFontWeight:       cssVal(s.buttonFontWeight,    d.buttonFontWeight),
    fontFamily:             cssVal(s.fontFamily,          d.fontFamily),
    fontSize:               cssVal(s.fontSize,            d.fontSize),
    maxWidth:               cssVal(s.maxWidth,            d.maxWidth),
    fieldSpacing:           cssVal(s.fieldSpacing,        d.fieldSpacing),
    successTitleColor:      cssVal(s.successTitleColor,   d.successTitleColor),
    successTextColor:       cssVal(s.successTextColor,    d.successTextColor),
    successTitleSize:       cssVal(s.successTitleSize,    d.successTitleSize),
    errorBorder:            cssVal(s.errorBorderColor,    d.errorBorderColor),
  }
  // primary com alpha 22 (~13%) pra ring de focus quando primary é hex
  const focusRing = /^#([0-9a-f]{6})$/i.test(v.primary) ? `${v.primary}22` : `${v.primary}`

  const fieldsHTML = fields.map(f => {
    const req = f.required ? 'required' : ''
    const id = `bf-${f.key}`
    if (f.type === 'scheduling') {
      // No embed clássico (inline simples) o agendamento vira um link pro booking.
      // ?f=<formId>: a página de agendamento usa o funil DESTE formulário (ver resolveFormFunnel).
      return f.meetingSlug ? `<div class="bf-field"><a href="${baseUrl}/agendar/${esc(f.meetingSlug)}?f=${formId}" target="_blank" rel="noopener" style="display:block;text-align:center;padding:${v.buttonPadding};background:${v.primary};color:${v.buttonText};border-radius:${v.buttonRadius};text-decoration:none;font-weight:${v.buttonFontWeight}">${esc(f.label || 'Agendar reunião')}</a></div>` : ''
    }
    if (f.type === 'statement') {
      return `<div class="bf-statement" style="text-align:${f.align === 'left' || f.align === 'right' ? f.align : 'center'}">${f.icon?`<div class="bf-st-ico">${esc(f.icon)}</div>`:''}${f.imageUrl?`<img class="bf-st-img" src="${esc(f.imageUrl)}" alt="">`:''}${f.label?`<div class="bf-st-h">${sanitizeBlockHtml(f.label)}</div>`:''}${f.helpText?`<div class="bf-st-p">${sanitizeBlockHtml(f.helpText)}</div>`:''}${f.html?`<div class="bf-st-html">${sanitizeBlockHtml(f.html)}</div>`:''}</div>`
    }
    if (f.type === 'select') {
      return `<div class="bf-field"><label for="${id}">${esc(f.label)}${f.required?' *':''}</label><select id="${id}" name="${esc(f.key)}" ${req}><option value="">${esc(f.placeholder||'Selecione...')}</option>${(f.options||[]).map((o:any)=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></div>`
    }
    if (f.type === 'textarea') {
      return `<div class="bf-field"><label for="${id}">${esc(f.label)}${f.required?' *':''}</label><textarea id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder||'')}" ${req}></textarea></div>`
    }
    if (f.type === 'hidden') return `<input type="hidden" name="${esc(f.key)}" value="${esc(f.defaultValue||'')}">`
    const inputType = f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : 'text'
    const numeric = f.type === 'phone' || f.type === 'number'
    return `<div class="bf-field"><label for="${id}">${esc(f.label)}${f.required?' *':''}</label><input type="${inputType}" id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder||'')}" ${numeric?'inputmode="numeric" data-num="1"':''} ${req}></div>`
  }).join('\n        ')

  function esc(s: string): string {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
  }

  return `(function(){
  if(customElements.get('beyond-form'))return;

  class BeyondForm extends HTMLElement {
    constructor(){super();this.attachShadow({mode:'open'})}
    connectedCallback(){
      var fid=${formId};
      this.shadowRoot.innerHTML=\`
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:host{display:block;font-family:${v.fontFamily};color:${v.labelColor};line-height:1.5;font-size:${v.fontSize}}
.bf-wrap{max-width:${v.maxWidth};margin:0 auto;background:${v.background};padding:0}
.bf-field{margin-bottom:${v.fieldSpacing}}
.bf-statement{margin-bottom:${v.fieldSpacing};text-align:center}
.bf-st-ico{font-size:40px;line-height:1;margin-bottom:8px}
.bf-st-img{max-width:100%;max-height:200px;border-radius:10px;margin:0 0 10px;display:inline-block}
.bf-st-h{font-size:18px;font-weight:700;color:${v.labelColor};margin-bottom:4px}
.bf-st-p{font-size:14px;color:${v.fieldPlaceholder}}
.bf-st-html{font-size:14px;color:${v.labelColor};text-align:left;margin-top:6px}
.bf-field label{display:block;font-size:${v.labelSize};font-weight:${v.labelWeight};margin-bottom:6px;color:${v.labelColor}}
.bf-field input,.bf-field select,.bf-field textarea{width:100%;padding:${v.fieldPadding};border:1px solid ${v.fieldBorder};border-radius:${v.radius};font-size:${v.fieldFontSize};font-family:inherit;color:${v.fieldText};background:${v.fieldBg};transition:border-color .2s,box-shadow .2s;outline:none}
.bf-field input::placeholder,.bf-field textarea::placeholder{color:${v.fieldPlaceholder}}
.bf-field input:focus,.bf-field select:focus,.bf-field textarea:focus{border-color:${v.primary};box-shadow:0 0 0 3px ${focusRing}}
.bf-field textarea{min-height:80px;resize:vertical}
.bf-field.has-error input,.bf-field.has-error select,.bf-field.has-error textarea{border-color:${v.errorBorder}}
.bf-btn{display:block;width:100%;padding:${v.buttonPadding};background:${v.primary};color:${v.buttonText};border:none;border-radius:${v.buttonRadius};font-size:${v.buttonFontSize};font-weight:${v.buttonFontWeight};cursor:pointer;font-family:inherit;transition:background .15s,opacity .15s}
.bf-btn:hover{background:${v.primaryHover}}
.bf-btn:disabled{opacity:.5;cursor:default}
.bf-success{text-align:center;padding:32px 16px}
.bf-success h3{font-size:${v.successTitleSize};font-weight:700;color:${v.successTitleColor};margin-bottom:8px}
.bf-success p{font-size:${v.fontSize};color:${v.successTextColor}}
</style>
<div class="bf-wrap">
  <form id="bf">
    ${fieldsHTML}
    <div class="bf-field bf-lgpd">
      <label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:13px;cursor:pointer">
        <input type="checkbox" id="bf-lgpd" style="width:auto;margin:3px 0 0">
        <span style="font-size:13px;color:${v.fieldPlaceholder}">Li e aceito a <a href="${baseUrl}/privacidade" target="_blank" rel="noopener" style="color:${v.primary}">Política de Privacidade</a>.</span>
      </label>
      <div class="bf-lgpd-err" style="color:${v.errorBorder};font-size:12px;margin-top:4px;display:none">É necessário aceitar para enviar.</div>
    </div>
    <button type="submit" class="bf-btn">${esc(settings.submitText||'Enviar')}</button>
  </form>
  <div class="bf-success" id="bf-ok" style="display:none">
    ${sanitizeBlockHtml(settings.successHtml) ? `<div class="bf-success-html">${sanitizeBlockHtml(settings.successHtml)}</div>` : `<h3>${esc(settings.successTitle||'Enviado!')}</h3><p>${esc(settings.successMessage||'Entraremos em contato em breve.')}</p>`}
  </div>
</div>\`;

      ${beyondTrackingInlineJs(baseUrl)}
      var form=this.shadowRoot.getElementById('bf');
      var ok=this.shadowRoot.getElementById('bf-ok');
      Array.prototype.forEach.call(form.querySelectorAll('[data-num]'),function(el){el.addEventListener('input',function(){var c=el.value.replace(/\\D/g,'');if(el.value!==c)el.value=c;});});
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var btn=form.querySelector('.bf-btn');
        var els=form.querySelectorAll('input,select,textarea');
        var data={},valid=true;
        els.forEach(function(f){
          if(f.id==='bf-lgpd')return;
          var p=f.closest('.bf-field');if(p)p.classList.remove('has-error');
          if(f.type==='checkbox'){data[f.name]=f.checked}else if(f.name){data[f.name]=f.value}
          if(f.required&&!f.value){if(p)p.classList.add('has-error');valid=false}
        });
        var lg=form.querySelector('#bf-lgpd');var lgErr=form.querySelector('.bf-lgpd-err');
        if(lg&&!lg.checked){if(lgErr)lgErr.style.display='block';valid=false;}else if(lgErr){lgErr.style.display='none';}
        if(!valid)return;
        btn.disabled=true;btn.textContent='Enviando...';
        var payload={data:data,lgpdConsent:!!(lg&&lg.checked)};
        try{if(window.BT&&BT.getVisitorId)payload.bt_vid=BT.getVisitorId()}catch(ex){}
        try{var sp=new URL(location.href).searchParams;
          if(sp.get('utm_source'))payload.utmSource=sp.get('utm_source');
          if(sp.get('utm_medium'))payload.utmMedium=sp.get('utm_medium');
          if(sp.get('utm_campaign'))payload.utmCampaign=sp.get('utm_campaign');
          if(sp.get('utm_content'))payload.utmContent=sp.get('utm_content');
          if(sp.get('utm_term'))payload.utmTerm=sp.get('utm_term');
          if(sp.get('utm_id'))payload.utmId=sp.get('utm_id');
          if(sp.get('gclid'))payload.gclid=sp.get('gclid');
          if(sp.get('fbclid'))payload.fbclid=sp.get('fbclid');
        }catch(ex){}
        payload.referrer=document.referrer||'';

        fetch('${baseUrl}/api/forms/submit/'+fid,{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
        }).then(function(r){return r.json()}).then(function(res){
          if(res.ok){
            form.style.display='none';ok.style.display='block';
            try{if(window.BT){var id={};if(data.email)id.email=data.email;if(data.whatsapp||data.telefone||data.phone)id.phone=data.whatsapp||data.telefone||data.phone;if(data.nome||data.name)id.name=data.nome||data.name;if(Object.keys(id).length>0&&BT.identify)BT.identify(id);if(BT.track)BT.track('form_conversion',{formId:fid})}}catch(ex){}
            if(res.redirect)window.location.href=res.redirect;
          }else{btn.disabled=false;btn.textContent='${esc(settings.submitText||'Enviar')}';alert(res.error||'Erro')}
        }).catch(function(){btn.disabled=false;btn.textContent='${esc(settings.submitText||'Enviar')}';alert('Erro de conexao')});
      });

      try{if(window.BT&&BT.track)BT.track('form_view',{formId:fid})}catch(ex){}
    }
  }
  customElements.define('beyond-form',BeyondForm);
})();`
}

// ─── Página conversacional hospedada (estilo Typeform, full-screen, SSR) ─────
// Reaproveita o mesmo endpoint de submit, styling e pipeline de lead. Dispara
// pixels client-side (fbq/gtag) configurados por form + BT, e captura
// utm/gclid/fbclid/ctwaClid + event_id (dedup Pixel↔CAPI).
function generateConversationalPage(
  formId: number,
  formName: string,
  fields: any[],
  settings: any,
  styling: any,
  baseUrl: string,
  embed: boolean,
): string {
  const e = (s: any): string => (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const px = settings.pixels || {}
  const cv = settings.conversational || {}
  const visible = fields.filter((f) => f.type !== 'hidden').map((f) => {
    const stmt = f.type === 'statement'
    // Em statement, headline (label) e copy (helpText) são HTML rico → sanitiza e
    // renderiza cru no client. Nos demais campos seguem texto puro (escapado).
    return {
      type: f.type, key: f.key, placeholder: f.placeholder || '',
      required: !!f.required, options: Array.isArray(f.options) ? f.options : [],
      label: stmt ? sanitizeBlockHtml(f.label) : (f.label || ''),
      helpText: stmt ? sanitizeBlockHtml(f.helpText) : (f.helpText || ''),
      icon: f.icon || '', imageUrl: f.imageUrl || '', html: sanitizeBlockHtml(f.html),
      align: (f.align === 'left' || f.align === 'right') ? f.align : 'center',
      meetingSlug: f.meetingSlug || '',
      isQualifier: !!f.isQualifier,
      positiveValues: Array.isArray(f.positiveValues) ? f.positiveValues : [],
      qualifyPositive: f.qualifyPositive || null,
      qualifyNegative: f.qualifyNegative || null,
    }
  })
  const hidden: Record<string, string> = {}
  for (const f of fields) if (f.type === 'hidden') hidden[f.key] = f.defaultValue || ''
  const cfg = {
    submitText: settings.submitText || 'Enviar',
    successTitle: settings.successTitle || 'Enviado!',
    successMessage: settings.successMessage || '',
    successHtml: sanitizeBlockHtml(settings.successHtml),
    welcomeEnabled: !!cv.welcomeEnabled,
    welcomeTitle: cv.welcomeTitle || '',
    welcomeText: cv.welcomeText || '',
    welcomeIcon: cv.welcomeIcon || '',
    welcomeImageUrl: cv.welcomeImageUrl || '',
    startButtonText: cv.startButtonText || 'Começar',
    navButtonText: cv.navButtonText || 'OK',
    showProgress: cv.showProgress !== false,
    metaEventName: px.metaEventName || 'Lead',
  }
  const gads = { id: px.googleConversionId || '', label: px.googleConversionLabel || '' }
  // Config da jornada (captura parcial): chaves de nome/telefone e da qualificação.
  const journeyCfg = {
    partialCapture: ((settings.journey || {}).partialCapture !== false),
    nameKey: (fields.find((f: any) => ['nome', 'name'].includes(f.mapTo)) || {}).key || '',
    phoneKey: (fields.find((f: any) => ['whatsapp', 'phone', 'telefone'].includes(f.mapTo)) || {}).key || '',
    emailKey: (fields.find((f: any) => f.mapTo === 'email') || {}).key || '',
    qualifierKey: (fields.find((f: any) => f.isQualifier) || {}).key || '',
    qualPositive: (settings.journey || {}).qualifyPositive || null, // fallback global
    qualNegative: (settings.journey || {}).qualifyNegative || null,
  }
  const metaPixelId = px.metaPixelId || ''
  const g = (k: string, fb: string): string => e(styling[k] || fb)

  const metaSnippet = metaPixelId
    ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${e(metaPixelId)}');</script>`
    : ''
  const gtagSnippet = gads.id
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${e(gads.id)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${e(gads.id)}');</script>`
    : ''

  return `<!doctype html>
<html lang="pt-br"><head>
<!-- Google tag (gtag.js) + Consent Mode v2 (LGPD) -->
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
gtag('js', new Date());
gtag('config', 'G-S4VLV24XH3');
window.bychOnMarketingConsent=window.bychOnMarketingConsent||function(f){(window.__bychMktQ=window.__bychMktQ||[]).push(f)};
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-S4VLV24XH3"></script>
<script async src="/api/consent/cc.js"></script>

<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${e(formName)}</title>
${metaSnippet}
${gtagSnippet}
${beyondTrackingSnippet(baseUrl)}
<style>
:root{
  --bg:${g('pageBgColor', '#ffffff')};--accent:${g('primaryColor', '#1a73e8')};--accent-hover:${g('primaryHoverColor', '#1557b0')};
  --btn-text:${g('buttonTextColor', '#ffffff')};--q-color:${g('questionColor', '#202124')};--q-size:${g('questionSize', '26px')};
  --q-weight:${g('questionWeight', '600')};--field-bg:${g('fieldBgColor', '#ffffff')};--field-border:${g('fieldBorderColor', '#dadce0')};
  --field-text:${g('fieldTextColor', '#202124')};--font:${g('fontFamily', "'Inter',system-ui,sans-serif")};--radius:${g('buttonRadius', '8px')};
  --err:${g('errorBorderColor', '#c5221f')};--success-color:${g('successTitleColor', '#34a853')};--success-size:${g('successTitleSize', '20px')};--success-text:${g('successTextColor', '#5f6368')};
}
*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%}
body{font-family:var(--font);background:var(--bg);color:var(--q-color);display:flex;flex-direction:column;min-height:100vh}
.progress{height:4px;background:rgba(0,0,0,.06)}.progress>i{display:block;height:100%;width:0;background:var(--accent);transition:width .35s ease}
.main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.screen{width:100%;max-width:640px;animation:fade .3s ease}
@keyframes fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.q{font-size:var(--q-size);font-weight:var(--q-weight);line-height:1.3;color:var(--q-color);margin-bottom:8px}
.req{color:var(--accent)}.help{font-size:15px;color:var(--success-text);margin-bottom:18px}
.bf-ico{font-size:44px;line-height:1;margin-bottom:12px}
.bf-img{max-width:100%;max-height:240px;border-radius:12px;margin:0 0 16px;display:inline-block}
.bf-html{font-size:15px;color:var(--q-color);margin-bottom:16px}.bf-html *{max-width:100%}
.bf-days{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;text-align:left}
.bf-day{min-width:118px}.bf-dh{font-size:12px;color:var(--q-color);opacity:.7;margin-bottom:6px;text-transform:capitalize}
.bf-slot{display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:8px;cursor:pointer;font-size:13px;font-family:inherit}
.bf-slot:hover{background:var(--accent);color:var(--btn-text)}
.inp{width:100%;padding:12px 14px;font-size:18px;font-family:inherit;color:var(--field-text);background:var(--field-bg);border:none;border-bottom:2px solid var(--field-border);outline:none}
.inp:focus{border-color:var(--accent)}.inp.bad{border-color:var(--err)}select.inp{padding:12px 6px}
.err{color:var(--err);font-size:13px;min-height:18px;margin-top:8px}
.actions{margin-top:22px;display:flex;align-items:center;gap:14px}
.btn{background:var(--accent);color:var(--btn-text);border:none;border-radius:var(--radius);padding:12px 22px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{background:var(--accent-hover)}.btn-ghost{background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px;font-family:inherit}
.hint{font-size:12px;color:#9aa0a6}.success-ico{font-size:46px;color:var(--success-color);margin-bottom:8px}
.success-title{font-size:var(--success-size);font-weight:700;color:var(--success-color);margin-bottom:6px}
.foot{text-align:center;font-size:11px;color:#9aa0a6;padding:10px}
</style></head>
<body>
${cfg.showProgress ? '<div class="progress"><i id="bar"></i></div>' : ''}
<div class="main"><div id="root"></div></div>
${embed ? '' : '<div class="foot">Feito com ByChat</div>'}
<script>
(function(){
var FID=${formId};var API=${JSON.stringify(baseUrl)};var TITLE=${JSON.stringify(formName)};
var FIELDS=${JSON.stringify(visible)};var HIDDEN=${JSON.stringify(hidden)};var CFG=${JSON.stringify(cfg)};var GADS=${JSON.stringify(gads)};var JOURNEY=${JSON.stringify(journeyCfg)};var leadId=null,ltoken=null;
var root=document.getElementById('root');var bar=document.getElementById('bar');
var answers={};for(var k in HIDDEN){answers[k]=HIDDEN[k];}
var TRACK=capture();
var EVID='bf-'+FID+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
var idx=0;var consentGiven=false;
function nextLabel(last,isStmt){if(idx===0&&CFG.startButtonText)return CFG.startButtonText;return isStmt?'Continuar':(last?CFG.submitText:CFG.navButtonText);}
try{if(window.fbq)fbq('track','PageView');}catch(ex){}
render();
function capture(){var o={};try{var sp=new URL(location.href).searchParams;['utm_source','utm_medium','utm_campaign','utm_content','utm_term','utm_id'].forEach(function(k){if(sp.get(k))o[k]=sp.get(k);});if(sp.get('gclid'))o.gclid=sp.get('gclid');if(sp.get('fbclid'))o.fbclid=sp.get('fbclid');var c=sp.get('ctwa_clid')||sp.get('ctwaClid');if(c)o.ctwaClid=c;}catch(ex){}try{if(window.BT&&BT.getVisitorId)o.bt_vid=BT.getVisitorId();}catch(ex){}o.referrer=document.referrer||'';return o;}
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function setBar(p){if(bar)bar.style.width=p+'%';}
function render(){if(idx<0){renderWelcome();return;}if(idx>=FIELDS.length)return;var f=FIELDS[idx];/* LGPD: aceite ANTES de coletar qualquer dado. statement e' so' apresentacao, entao a tela de consentimento entra logo depois dele e antes da primeira pergunta. */if(!consentGiven&&f.type!=='statement'){renderConsent();return;}renderStep(f);}
function media(f){return (f.icon?'<div class="bf-ico">'+esc(f.icon)+'</div>':'')+(f.imageUrl?'<img class="bf-img" src="'+esc(f.imageUrl)+'" alt="">':'');}
function renderWelcome(){setBar(0);var h='<div class="screen" style="text-align:center">'+media({icon:CFG.welcomeIcon,imageUrl:CFG.welcomeImageUrl})+'<div class="q">'+esc(CFG.welcomeTitle||TITLE)+'</div>';if(CFG.welcomeText)h+='<div class="help">'+esc(CFG.welcomeText)+'</div>';h+='<div class="actions"><button class="btn" id="go">'+esc(CFG.startButtonText)+'</button></div></div>';root.innerHTML=h;document.getElementById('go').onclick=function(){idx=0;render();};}
function renderStep(f){var n=FIELDS.length;if(CFG.showProgress)setBar(Math.round((idx/n)*100));var last=(idx===n-1);
if(f.type==='scheduling'){renderSchedule(f,last);return;}
if(f.type==='statement'){var hs='<div class="screen" style="text-align:'+(f.align||'center')+'">'+media(f);if(f.label)hs+='<div class="q">'+f.label+'</div>';if(f.helpText)hs+='<div class="help">'+f.helpText+'</div>';if(f.html)hs+='<div class="bf-html">'+f.html+'</div>';hs+='<div class="actions">';if(idx>0)hs+='<button class="btn-ghost" id="back">Voltar</button>';hs+='<button class="btn" id="next">'+esc(last?CFG.submitText:nextLabel(last,true))+'</button></div></div>';root.innerHTML=hs;var sb=document.getElementById('back');if(sb)sb.onclick=function(){idx--;render();};document.getElementById('next').onclick=function(){if(last){submit();}else{idx++;render();}};return;}
var val=answers[f.key]||'';var ctrl='';
if(f.type==='textarea'){ctrl='<textarea id="inp" class="inp" rows="3">'+esc(val)+'</textarea>';}
else if(f.type==='select'){var opts='<option value="">'+esc(f.placeholder||'Selecione…')+'</option>';for(var i=0;i<f.options.length;i++){var o=f.options[i];opts+='<option value="'+esc(o.value)+'"'+(o.value===val?' selected':'')+'>'+esc(o.label)+'</option>';}ctrl='<select id="inp" class="inp">'+opts+'</select>';}
else{var t=f.type==='email'?'email':f.type==='phone'?'tel':f.type==='number'?'number':f.type==='url'?'url':'text';ctrl='<input id="inp" class="inp" type="'+t+'" value="'+esc(val)+'" placeholder="'+esc(f.placeholder||'')+'">';}
var h='<div class="screen">'+media(f)+'<div class="q">'+esc(f.label)+(f.required?' <span class="req">*</span>':'')+'</div>';if(f.helpText)h+='<div class="help">'+esc(f.helpText)+'</div>';h+=ctrl+'<div class="err" id="err"></div><div class="actions">';if(idx>0)h+='<button class="btn-ghost" id="back">Voltar</button>';h+='<button class="btn" id="next">'+esc(last?CFG.submitText:nextLabel(last,false))+'</button><span class="hint">pressione Enter ↵</span></div></div>';
root.innerHTML=h;var inp=document.getElementById('inp');if(inp){inp.focus();if(f.type==='phone'||f.type==='number'){inp.setAttribute('inputmode','numeric');inp.addEventListener('input',function(){var c=inp.value.replace(/\\D/g,'');if(inp.value!==c)inp.value=c;});}inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'&&f.type!=='textarea'){ev.preventDefault();go();}});}var b=document.getElementById('back');if(b)b.onclick=function(){idx--;render();};document.getElementById('next').onclick=go;
function go(){var v=inp?inp.value.trim():'';var er=validate(f,v);if(er){document.getElementById('err').textContent=er;if(inp)inp.classList.add('bad');return;}answers[f.key]=v;maybeProgress(f);if(f.isQualifier){var q=resolveQual(answers);if(q&&q.finish){submit();return;}}if(last){submit();}else{idx++;render();}}}
function maybeProgress(f){if(!JOURNEY.partialCapture)return;var p=Promise.resolve();if(!leadId&&JOURNEY.nameKey&&JOURNEY.phoneKey&&answers[JOURNEY.nameKey]&&answers[JOURNEY.phoneKey]){p=postProgress('start');}if(f&&f.isQualifier){p.then(function(){if(leadId)postProgress('qualify');});}}
function resolveQual(ans){var lastPos=null;for(var i=0;i<FIELDS.length;i++){var f=FIELDS[i];if(!f.isQualifier)continue;var a=ans[f.key];if(a===undefined||a===null||a==='')continue;var pv=f.positiveValues||[];var isPos=pv.length?pv.indexOf(a)>=0:!!a;if(!isPos){var neg=f.qualifyNegative||JOURNEY.qualNegative;if(neg&&(neg.stageKey||neg.finish))return neg;}else{var pos=f.qualifyPositive||JOURNEY.qualPositive;if(pos&&(pos.stageKey||pos.finish))lastPos=pos;}}return lastPos;}
function postProgress(phase){var payload={phase:phase,data:answers,leadId:leadId,token:ltoken,lgpdConsent:consentGiven};for(var k in TRACK){if(k==='utm_source')payload.utmSource=TRACK[k];else if(k==='utm_medium')payload.utmMedium=TRACK[k];else if(k==='utm_campaign')payload.utmCampaign=TRACK[k];else if(k==='utm_content')payload.utmContent=TRACK[k];else if(k==='utm_term')payload.utmTerm=TRACK[k];else if(k==='utm_id')payload.utmId=TRACK[k];else payload[k]=TRACK[k];}return fetch(API+'/api/forms/progress/'+FID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(res){if(res&&res.leadId){leadId=res.leadId;ltoken=res.token;}}).catch(function(){});}
function renderSchedule(f,last){var slug=f.meetingSlug;if(!slug){var hm='<div class="screen"><div class="help">Agendamento não configurado.</div><div class="actions"><button class="btn" id="next">'+(last?esc(CFG.submitText):esc(CFG.navButtonText))+'</button></div></div>';root.innerHTML=hm;document.getElementById('next').onclick=function(){if(last)submit();else{idx++;render();}};return;}
var h='<div class="screen"><div class="q">'+(f.label?esc(f.label):'Escolha um horário')+'</div><div id="sched"><div class="help">Carregando horários…</div></div>';if(idx>0)h+='<div class="actions"><button class="btn-ghost" id="back">Voltar</button></div>';h+='</div>';root.innerHTML=h;var bb=document.getElementById('back');if(bb)bb.onclick=function(){idx--;render();};var box=document.getElementById('sched');
fetch(API+'/api/public/scheduling/'+encodeURIComponent(slug)+'/slots').then(function(r){return r.json();}).then(function(d){var days=((d&&d.days)||[]).filter(function(x){return x.slots&&x.slots.length;});if(!days.length){box.innerHTML='<div class="help">Nenhum horário disponível no momento.</div>';return;}var WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];var hh='<div class="bf-days">';days.slice(0,14).forEach(function(day){var dd=day.date.slice(8,10)+'/'+day.date.slice(5,7);hh+='<div class="bf-day"><div class="bf-dh">'+WD[day.weekday]+' '+dd+'</div>';day.slots.forEach(function(sl){hh+='<button class="bf-slot" data-s="'+esc(sl.startAt)+'" data-l="'+esc(sl.label)+'">'+esc(sl.label)+'</button>';});hh+='</div>';});hh+='</div>';box.innerHTML=hh;Array.prototype.forEach.call(box.querySelectorAll('.bf-slot'),function(btn){btn.onclick=function(){pickSlot(f,last,btn.getAttribute('data-s'),btn.getAttribute('data-l'));};});}).catch(function(){box.innerHTML='<div class="help">Erro ao carregar horários.</div>';});}
function pickSlot(f,last,startAt,labelTxt){var email=(JOURNEY.emailKey&&answers[JOURNEY.emailKey])||'';var h='<div class="screen"><div class="q">Confirmar agendamento</div><div class="help">'+esc(labelTxt)+'</div>';if(!email)h+='<input id="bk-email" class="inp" type="email" placeholder="Seu e-mail (para enviar o convite)">';h+='<div class="err" id="bk-err"></div><div class="actions"><button class="btn-ghost" id="bk-back">Voltar</button><button class="btn" id="bk-go">Confirmar</button></div></div>';root.innerHTML=h;document.getElementById('bk-back').onclick=function(){renderSchedule(f,last);};
document.getElementById('bk-go').onclick=function(){var ie=document.getElementById('bk-email');var em=email||(ie?ie.value.trim():'');var er=document.getElementById('bk-err');var ph=(JOURNEY.phoneKey&&answers[JOURNEY.phoneKey])||'';if(!em&&!ph){er.textContent='Informe seu e-mail';return;}if(em&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em)){er.textContent='E-mail inválido';return;}if(em&&JOURNEY.emailKey)answers[JOURNEY.emailKey]=em;var go=document.getElementById('bk-go');go.disabled=true;go.textContent='Agendando…';var nm=(JOURNEY.nameKey&&answers[JOURNEY.nameKey])||'Lead';var utm={};if(TRACK.utm_source)utm.source=TRACK.utm_source;if(TRACK.utm_medium)utm.medium=TRACK.utm_medium;if(TRACK.utm_campaign)utm.campaign=TRACK.utm_campaign;if(TRACK.utm_content)utm.content=TRACK.utm_content;if(TRACK.utm_term)utm.term=TRACK.utm_term;
fetch(API+'/api/public/scheduling/'+encodeURIComponent(f.meetingSlug)+'/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:nm,email:em,phone:ph,startAt:startAt,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,visitorId:TRACK.bt_vid||null,utm:utm,formId:FID})}).then(function(r){return r.json();}).then(function(res){if(res&&res.error){er.textContent=res.error;go.disabled=false;go.textContent='Confirmar';return;}answers[f.key]=startAt;if(last){submit();}else{idx++;render();}}).catch(function(){er.textContent='Erro ao agendar.';go.disabled=false;go.textContent='Confirmar';});};}
function validate(f,v){if(f.type==='statement'||f.type==='scheduling')return '';if(f.required&&!v)return 'Campo obrigatório';if(v&&f.type==='email'&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v))return 'E-mail inválido';if(v&&f.type==='phone'&&v.replace(/\\D/g,'').length<8)return 'Telefone inválido';return '';}
function submit(){/* consentimento e' pedido no inicio (ver render); isto e' so' salvaguarda para formularios sem nenhum campo de coleta */if(!consentGiven){renderConsent();return;}doSubmit();}
function renderConsent(){var h='<div class="screen"><div class="q">Antes de começar</div><label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;cursor:pointer;margin:18px 0 4px"><input type="checkbox" id="lgpd" style="margin-top:4px;width:18px;height:18px;flex-shrink:0"><span>Li e aceito a <a href="'+API+'/privacidade" target="_blank" rel="noopener" style="color:var(--accent)">Política de Privacidade</a> e autorizo o contato pelos canais informados.</span></label><div class="err" id="lgpd-err"></div><div class="actions">';if(idx>0)h+='<button class="btn-ghost" id="back">Voltar</button>';h+='<button class="btn" id="next">'+esc(CFG.navButtonText||'Continuar')+'</button></div></div>';root.innerHTML=h;var cb=document.getElementById('lgpd');var bk=document.getElementById('back');if(bk)bk.onclick=function(){idx--;render();};document.getElementById('next').onclick=function(){if(!cb.checked){document.getElementById('lgpd-err').textContent='É necessário aceitar para continuar.';return;}consentGiven=true;render();};}
function doSubmit(){setBar(100);root.innerHTML='<div class="screen"><div class="q">Enviando…</div></div>';var payload={data:answers,eventId:EVID,leadId:leadId,token:ltoken,lgpdConsent:true};for(var k in TRACK){if(k==='utm_source')payload.utmSource=TRACK[k];else if(k==='utm_medium')payload.utmMedium=TRACK[k];else if(k==='utm_campaign')payload.utmCampaign=TRACK[k];else if(k==='utm_content')payload.utmContent=TRACK[k];else if(k==='utm_term')payload.utmTerm=TRACK[k];else if(k==='utm_id')payload.utmId=TRACK[k];else payload[k]=TRACK[k];}
fetch(API+'/api/forms/submit/'+FID,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(function(r){return r.json();}).then(function(res){if(res.ok){fireConv();if(res.redirect){location.href=res.redirect;return;}renderSuccess(res.successHtml);}else{root.innerHTML='<div class="screen"><div class="q">Ops…</div><div class="help">'+esc(res.error||'Erro ao enviar')+'</div></div>';}}).catch(function(){root.innerHTML='<div class="screen"><div class="q">Erro de conexão</div></div>';});}
function fireConv(){try{if(window.fbq)fbq('track',CFG.metaEventName,{},{eventID:EVID});}catch(ex){}try{if(window.gtag&&GADS.id){var st=GADS.id+(GADS.label?('/'+GADS.label):'');gtag('event','conversion',{send_to:st});}}catch(ex){}try{if(window.BT){var idd={};if(answers.email)idd.email=answers.email;var ph=answers.whatsapp||answers.telefone||answers.phone;if(ph)idd.phone=ph;if(answers.nome||answers.name)idd.name=answers.nome||answers.name;if(BT.identify&&Object.keys(idd).length)BT.identify(idd);if(BT.track)BT.track('form_conversion',{formId:FID});}}catch(ex){}}
function renderSuccess(overrideHtml){setBar(100);var h='<div class="screen" style="text-align:center">';var oh=overrideHtml||CFG.successHtml;if(oh){h+='<div class="bf-html" style="text-align:center">'+oh+'</div>';}else{h+='<div class="success-ico">✓</div><div class="success-title">'+esc(CFG.successTitle)+'</div><div class="help">'+esc(CFG.successMessage)+'</div>';}h+='</div>';root.innerHTML=h;}
})();
</script>
</body></html>`
}
