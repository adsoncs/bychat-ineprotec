import { FastifyInstance } from 'fastify'
import nodemailer from 'nodemailer'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { adminOnly, superadminOnly, type JwtPayload } from '../lib/auth.js'
import { isPrimaryInstall } from '../lib/install.js'

export async function settingsRoutes(app: FastifyInstance) {

  // GET /api/admin/settings — All settings grouped
  app.get('/api/admin/settings', { preHandler: adminOnly }, async () => {
    const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } })
    const grouped: Record<string, any[]> = {}
    settings.forEach(s => {
      if (!grouped[s.grp]) grouped[s.grp] = []
      grouped[s.grp].push(s)
    })
    return { settings, grouped }
  })

  // PUT /api/admin/settings — Bulk update
  app.put('/api/admin/settings', { preHandler: adminOnly }, async (req) => {
    const updates = req.body as Record<string, any>
    for (const [key, value] of Object.entries(updates)) {
      await prisma.setting.updateMany({ where: { key }, data: { value } })
    }
    // Invalida cache de modos de dedup quando relevantes mudam (Fase 24)
    if (Object.keys(updates).some(k => k.startsWith('dedup.mode.'))) {
      const { invalidateDedupModeCache } = await import('../services/dedup.js')
      invalidateDedupModeCache()
    }
    // Invalida cache do Google Ads developer token quando admin alterar (Fase 25)
    if (Object.keys(updates).some(k => k === 'google.ads.developer_token')) {
      const { invalidateGoogleAdsTokenCache } = await import('./googleAds.js')
      invalidateGoogleAdsTokenCache()
    }
    return { ok: true }
  })

  // POST /api/admin/sms/test — envia SMS de teste via provider configurado (Comtele)
  app.post('/api/admin/sms/test', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const to = String(body?.to || '').trim()
    const message = String(body?.message || '').trim() || 'Teste de SMS via ByChat (Comtele).'
    if (!to) return reply.code(400).send({ error: 'Telefone (to) obrigatório' })
    const { sendSms } = await import('../services/smsProvider.js')
    const r = await sendSms({ to, message })
    if (!r.ok) return reply.code(400).send({ ok: false, error: r.error })
    return { ok: true, providerId: r.providerId, message: r.message }
  })

  // ── GET /api/admin/business-hours — Configuração de horário de atendimento ──
  app.get('/api/admin/business-hours', { preHandler: adminOnly }, async () => {
    const { getBusinessHoursConfig } = await import('../services/businessHours.js')
    const config = await getBusinessHoursConfig()
    return { config }
  })

  // ── GET /api/admin/default-team — Setor fallback global para leads sem roteamento ──
  app.get('/api/admin/default-team', { preHandler: adminOnly }, async () => {
    const setting = await prisma.setting.findUnique({ where: { key: 'default_team_id' } })
    let teamId: number | null = null
    if (setting?.value != null) {
      const raw = setting.value as any
      if (typeof raw === 'number') teamId = raw
      else if (typeof raw === 'string' && /^\d+$/.test(raw)) teamId = parseInt(raw)
      else if (typeof raw === 'object' && typeof raw.id === 'number') teamId = raw.id
    }
    let team = null
    if (teamId) {
      team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true, slug: true, color: true, active: true },
      })
    }
    return { teamId, team }
  })

  // ── PUT /api/admin/default-team — Atualizar setor fallback ──
  app.put('/api/admin/default-team', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    const teamId = body?.teamId ? parseInt(body.teamId) : null

    if (teamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, active: true } })
      if (!team || !team.active) return reply.code(400).send({ error: 'Equipe destino inválida ou inativa' })
    }

    await prisma.setting.upsert({
      where: { key: 'default_team_id' },
      create: {
        key: 'default_team_id',
        label: 'Setor padrão (fallback global)',
        grp: 'whatsapp',
        fieldType: 'team',
        value: teamId as any,
      },
      update: { value: teamId as any },
    })

    const { invalidateRoutingCache } = await import('../services/teamRouting.js')
    invalidateRoutingCache()

    return { ok: true, teamId }
  })

  // ── PUT /api/admin/business-hours — Atualizar configuração ──
  app.put('/api/admin/business-hours', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as any
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'Configuração inválida' })

    // Sanitização básica
    const config = {
      enabled: !!body.enabled,
      timezone: typeof body.timezone === 'string' ? body.timezone : 'America/Sao_Paulo',
      schedule: body.schedule && typeof body.schedule === 'object' ? body.schedule : {},
      message: typeof body.message === 'string' ? body.message.substring(0, 1000) : '',
      throttleHours: Math.max(0, Math.min(168, parseInt(body.throttleHours) || 12)),
    }

    await prisma.setting.upsert({
      where: { key: 'business_hours' },
      create: {
        key: 'business_hours',
        label: 'Horário de Atendimento',
        grp: 'whatsapp',
        fieldType: 'json',
        value: config as any,
      },
      update: { value: config as any },
    })

    const { invalidateBusinessHoursCache } = await import('../services/businessHours.js')
    invalidateBusinessHoursCache()

    return { ok: true, config }
  })

  // ── POST /api/admin/business-hours/test — envia mensagem fora do horário de teste ──
  app.post('/api/admin/business-hours/test', { preHandler: adminOnly }, async (req, reply) => {
    const { to } = (req.body ?? {}) as { to?: string }
    if (!to || !/^\d{10,15}$/.test(String(to).replace(/\D/g, ''))) {
      return reply.code(400).send({ error: 'Informe um número (apenas dígitos, com DDI). Ex: 5511999999999' })
    }

    const setting = await prisma.setting.findUnique({ where: { key: 'business_hours' } }).catch(() => null)
    const cfg = (setting?.value ?? {}) as { message?: string }
    const message = (cfg.message ?? '').trim()
    if (!message) return reply.code(400).send({ error: 'Mensagem fora do horário não configurada' })

    try {
      const { getDefaultProvider } = await import('../services/whatsappProvider.js')
      const provider = await getDefaultProvider()
      const phone = String(to).replace(/\D/g, '')
      await provider.sendText(phone, `[teste] ${message}`)
      return { ok: true }
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Falha ao enviar mensagem de teste' })
    }
  })

  // POST /api/admin/settings/dns — Create DNS record
  app.post('/api/admin/settings/dns', { preHandler: adminOnly }, async (req, reply) => {
    const { key, label, value } = req.body as any
    if (!key || !label || !value) return reply.code(400).send({ error: 'key, label e value são obrigatórios' })
    const exists = await prisma.setting.findUnique({ where: { key } })
    if (exists) return reply.code(409).send({ error: 'Registro com essa chave já existe' })
    await prisma.setting.create({ data: { key, label, value: JSON.stringify(value), grp: 'dns', fieldType: 'dns' } })
    return { ok: true }
  })

  // PUT /api/admin/settings/dns — Update DNS record
  app.put('/api/admin/settings/dns', { preHandler: adminOnly }, async (req, reply) => {
    const { key, label, value } = req.body as any
    if (!key) return reply.code(400).send({ error: 'key é obrigatório' })
    const exists = await prisma.setting.findUnique({ where: { key } })
    if (!exists) return reply.code(404).send({ error: 'Registro não encontrado' })
    await prisma.setting.update({ where: { key }, data: { label, value: JSON.stringify(value) } })
    return { ok: true }
  })

  // DELETE /api/admin/settings/dns/:key — Delete DNS record
  app.delete('/api/admin/settings/dns/:key', { preHandler: adminOnly }, async (req, reply) => {
    const { key } = req.params as any
    const exists = await prisma.setting.findUnique({ where: { key } })
    if (!exists || exists.grp !== 'dns') return reply.code(404).send({ error: 'Registro DNS não encontrado' })
    await prisma.setting.delete({ where: { key } })
    return { ok: true }
  })

  // POST /api/admin/settings/ai-test — Test AI API key
  app.post('/api/admin/settings/ai-test', { preHandler: adminOnly }, async (req, reply) => {
    const { provider } = req.body as { provider: string }
    if (!provider || !['anthropic', 'openai'].includes(provider)) {
      return reply.code(400).send({ error: 'Provedor inválido. Use "anthropic" ou "openai".' })
    }

    const keyField = provider === 'anthropic' ? 'ai.anthropic_api_key' : 'ai.openai_api_key'
    const row = await prisma.setting.findUnique({ where: { key: keyField } })
    const apiKey = row ? (typeof row.value === 'string' ? row.value : String(row.value)).replace(/^"|"$/g, '') : ''

    if (!apiKey) {
      return reply.code(400).send({ error: `Token ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} não configurado.` })
    }

    try {
      if (provider === 'anthropic') {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
          signal: AbortSignal.timeout(15000)
        })
        if (!resp.ok) {
          const body = await resp.text()
          throw new Error(`HTTP ${resp.status}: ${body}`)
        }
        return { ok: true, provider: 'Anthropic' }
      } else {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }),
          signal: AbortSignal.timeout(15000)
        })
        if (!resp.ok) {
          const body = await resp.text()
          throw new Error(`HTTP ${resp.status}: ${body}`)
        }
        return { ok: true, provider: 'OpenAI' }
      }
    } catch (err: any) {
      return reply.code(400).send({ error: `Falha ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}: ${err.message}` })
    }
  })

  // ── POST /api/admin/settings/email-test — Envia email de teste com o provider configurado
  app.post('/api/admin/settings/email-test', { preHandler: adminOnly }, async (req, reply) => {
    const { to } = (req.body ?? {}) as { to?: string }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return reply.code(400).send({ error: 'E-mail destinatário inválido' })
    }

    try {
      const { sendEmailGeneric, getEmailConfig, getFromAddress } = await import('../services/notify.js')
      const { renderSystemEmail, nowVars } = await import('../services/systemEmailTemplates.js')
      const { getBranding } = await import('../lib/branding.js')
      const cfg = await getEmailConfig()
      const brand = await getBranding()
      const rendered = await renderSystemEmail('email_test', { brand, ...nowVars() })
      const subject = rendered?.subject || `[teste] ${brand.brandName} — Email funcionando`
      const html = rendered?.html || `<div style="font-family:system-ui,sans-serif;padding:24px">
        <h2 style="margin:0 0 12px">Email de teste enviado com sucesso ✓</h2>
        <p>Provedor de email do ${brand.brandName} está corretamente configurado.</p>
      </div>`
      await sendEmailGeneric({ from: getFromAddress(cfg, 'Teste'), to, subject, html })
      return { ok: true }
    } catch (e: any) {
      return reply.code(500).send({ error: e.message || 'Falha ao enviar email de teste' })
    }
  })

  // POST /api/admin/settings/smtp-test — Test SMTP connection
  app.post('/api/admin/settings/smtp-test', { preHandler: adminOnly }, async (_req, reply) => {
    const keys = ['smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass']
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
    const cfg: Record<string, string> = {}
    rows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value) })

    const host = cfg['smtp.host']
    const port = parseInt(cfg['smtp.port'] || '587')
    const secure = cfg['smtp.secure'] === 'true'
    const user = cfg['smtp.user']
    const pass = cfg['smtp.pass']

    if (!host || !user || !pass) {
      return reply.code(400).send({ error: 'Preencha servidor, usuário e senha antes de testar.' })
    }

    try {
      const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, connectionTimeout: 10000 })
      await transporter.verify()
      return { ok: true }
    } catch (err: any) {
      return reply.code(400).send({ error: `Falha: ${err.message || 'Não foi possível conectar ao servidor SMTP.'}` })
    }
  })

  // ══════════════════════════════════════════════
  // EVOLUTION API MONITOR
  // ══════════════════════════════════════════════

  // GET /api/admin/evolution-monitor — Status atual do monitoramento
  app.get('/api/admin/evolution-monitor', { preHandler: adminOnly }, async () => {
    const { getLastHealth, forceCheck } = await import('../services/evolutionMonitor.js')
    let health = getLastHealth()
    if (!health) health = await forceCheck()
    return health
  })

  // POST /api/admin/evolution-monitor/check — Forçar verificação agora
  app.post('/api/admin/evolution-monitor/check', { preHandler: adminOnly }, async () => {
    const { forceCheck } = await import('../services/evolutionMonitor.js')
    return await forceCheck()
  })

  // POST /api/admin/evolution-monitor/fix — Executar ação de correção
  app.post('/api/admin/evolution-monitor/fix', { preHandler: adminOnly }, async (req) => {
    const { action } = req.body as any
    if (!action) return { ok: false, message: 'Ação não especificada' }
    const { executeFixAction } = await import('../services/evolutionMonitor.js')
    return await executeFixAction(action)
  })

  // ── GET /api/admin/evolution/version — Versão instalada + última disponível ──
  app.get('/api/admin/evolution/version', { preHandler: adminOnly }, async () => {
    const { getVersionInfo, getActiveJob, getLastJob, canStartUpgrade } = await import('../services/evolutionUpgrade.js')
    const info = await getVersionInfo()
    const guard = canStartUpgrade()
    const active = getActiveJob()
    const last = getLastJob()
    return {
      ...info,
      canUpgrade: guard.ok,
      waitSeconds: guard.waitSeconds || 0,
      guardReason: guard.reason || null,
      activeJob: active ? summarizeJob(active) : null,
      lastJob: !active && last ? summarizeJob(last) : null,
    }
  })

  // ── POST /api/admin/evolution/upgrade — Disparar upgrade (SUPERADMIN + senha) ──
  app.post('/api/admin/evolution/upgrade', { preHandler: superadminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const targetTag: string | undefined = body.targetTag
    const password: string | undefined = body.password

    if (!targetTag || !/^v\d+\.\d+\.\d+$/.test(targetTag)) {
      return reply.code(400).send({ error: 'targetTag inválida. Esperado formato vX.Y.Z' })
    }
    if (!password || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Senha de confirmação obrigatória' })
    }

    // Valida senha do superadmin logado
    const user = (req as any).user as JwtPayload
    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } })
    if (!dbUser) return reply.code(401).send({ error: 'Usuário não encontrado' })
    const ok = await bcrypt.compare(password, dbUser.passwordHash)
    if (!ok) return reply.code(401).send({ error: 'Senha incorreta' })

    const { startUpgrade } = await import('../services/evolutionUpgrade.js')
    try {
      const job = await startUpgrade(targetTag, { userId: user.userId, email: user.email })
      return { ok: true, job: summarizeJob(job) }
    } catch (e: any) {
      return reply.code(409).send({ error: e.message || 'Falha ao iniciar upgrade' })
    }
  })

  // ── GET /api/admin/evolution/upgrade/status — Status + logs do upgrade ──
  app.get('/api/admin/evolution/upgrade/status', { preHandler: adminOnly }, async (req) => {
    const { getActiveJob, getLastJob } = await import('../services/evolutionUpgrade.js')
    const active = getActiveJob()
    const last = getLastJob()
    const job = active || last
    if (!job) return { active: false, job: null }
    const query = req.query as any
    const since = parseInt(query.since) || 0
    return {
      active: !!active,
      job: { ...summarizeJob(job), logs: job.logs.slice(since), logCount: job.logs.length },
    }
  })

  // ── GET /api/admin/enrichment/phone-identity — config atual (sem token plain) ──
  app.get('/api/admin/enrichment/phone-identity', { preHandler: adminOnly }, async () => {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [
        'enrichment.phone_identity.enabled',
        'enrichment.phone_identity.provider',
        'enrichment.phone_identity.endpoint',
        'enrichment.phone_identity.token',
        'enrichment.phone_identity.purpose',
      ] } },
    })
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    function unwrap(raw: any): string {
      if (raw === null || raw === undefined) return ''
      if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
      return String(raw)
    }
    const tokenCipher = unwrap(byKey.get('enrichment.phone_identity.token'))
    return {
      enabled: unwrap(byKey.get('enrichment.phone_identity.enabled')).toLowerCase() === 'true',
      provider: unwrap(byKey.get('enrichment.phone_identity.provider')) || 'mock',
      endpoint: unwrap(byKey.get('enrichment.phone_identity.endpoint')),
      tokenConfigured: !!tokenCipher,
      tokenMasked: tokenCipher ? '•••' : '',
      purpose: unwrap(byKey.get('enrichment.phone_identity.purpose')),
    }
  })

  // ── PUT /api/admin/enrichment/phone-identity — atualizar config ──
  // O token só é gravado quando vier preenchido (não-vazio e não-mascarado).
  app.put('/api/admin/enrichment/phone-identity', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const provider = ['mock', 'custom_http', 'celcoin'].includes(body.provider) ? body.provider : 'mock'
    const enabled = !!body.enabled
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim().substring(0, 500) : ''
    const purpose = typeof body.purpose === 'string' ? body.purpose.trim().substring(0, 500) : ''

    if (enabled && provider !== 'mock' && !endpoint) {
      return reply.code(400).send({ error: 'Endpoint é obrigatório quando o provedor não é "mock"' })
    }

    async function upsertSetting(key: string, value: any, label: string, fieldType: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, label, grp: 'enrichment', fieldType, value: value as any },
        update: { value: value as any },
      })
    }

    await upsertSetting('enrichment.phone_identity.enabled',  enabled ? 'true' : 'false', 'Identidade do Telefone — Ativo', 'boolean')
    await upsertSetting('enrichment.phone_identity.provider', provider,                   'Identidade do Telefone — Provedor', 'select')
    await upsertSetting('enrichment.phone_identity.endpoint', endpoint,                   'Identidade do Telefone — Endpoint', 'text')
    await upsertSetting('enrichment.phone_identity.purpose',  purpose,                    'Identidade do Telefone — Finalidade LGPD', 'textarea')

    // Token: só atualiza se veio explicitamente preenchido (e não for a máscara)
    if (typeof body.token === 'string' && body.token && !body.token.includes('•')) {
      const { encryptToken } = await import('../services/cloudApi.js')
      const cipher = encryptToken(body.token)
      await upsertSetting('enrichment.phone_identity.token', cipher, 'Identidade do Telefone — Token (criptografado)', 'password')
    }

    const { clearPhoneIdentityCache } = await import('../lib/phoneIdentity.js')
    clearPhoneIdentityCache()

    return { ok: true }
  })

  // ── LANDING INSTITUCIONAL — contatos editáveis sem rebuild ──
  // Só os contatos da vitrine pública (bychat.ia.br) são editáveis por painel;
  // textos e seções continuam em código (landing.copy.ts). Os valores são
  // injetados em window.__LANDING_CONTACT__ pelo serveLandingPage (server.ts).
  const LANDING_CONTACT_DEFAULTS = {
    whatsappNumber: '5562985703567',
    whatsappMessage: 'Olá! Quero conhecer o ByChat e agendar uma demonstração.',
    loginUrl: '/app',
  }

  function unwrapSetting(raw: any): string {
    if (raw === null || raw === undefined) return ''
    if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
    return String(raw)
  }

  app.get('/api/admin/landing-contact', { preHandler: superadminOnly }, async (_req, reply) => {
    // Landing principal só existe na instalação principal (domínio principal).
    // Instalações filhas (subdomínio) não têm acesso.
    if (!isPrimaryInstall()) {
      return reply.code(404).send({ error: 'Recurso indisponível nesta instalação' })
    }
    const rows = await prisma.setting.findMany({
      where: { key: { in: [
        'landing.contact.whatsapp_number',
        'landing.contact.whatsapp_message',
        'landing.contact.login_url',
      ] } },
    })
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    return {
      whatsappNumber: unwrapSetting(byKey.get('landing.contact.whatsapp_number')) || LANDING_CONTACT_DEFAULTS.whatsappNumber,
      whatsappMessage: unwrapSetting(byKey.get('landing.contact.whatsapp_message')) || LANDING_CONTACT_DEFAULTS.whatsappMessage,
      loginUrl: unwrapSetting(byKey.get('landing.contact.login_url')) || LANDING_CONTACT_DEFAULTS.loginUrl,
    }
  })

  app.put('/api/admin/landing-contact', { preHandler: superadminOnly }, async (req, reply) => {
    if (!isPrimaryInstall()) {
      return reply.code(404).send({ error: 'Recurso indisponível nesta instalação' })
    }
    const body = (req.body as any) || {}
    const whatsappNumber = String(body.whatsappNumber ?? '').replace(/\D/g, '').slice(0, 20)
    const whatsappMessage = String(body.whatsappMessage ?? '').trim().slice(0, 500)
    const loginUrl = String(body.loginUrl ?? '').trim().slice(0, 300)

    if (!/^\d{10,15}$/.test(whatsappNumber)) {
      return reply.code(400).send({ error: 'WhatsApp inválido. Use o formato internacional só com dígitos (ex.: 5562985703567).' })
    }
    if (!whatsappMessage) {
      return reply.code(400).send({ error: 'A mensagem inicial do WhatsApp é obrigatória.' })
    }
    if (loginUrl && !/^(\/|https?:\/\/)/.test(loginUrl)) {
      return reply.code(400).send({ error: 'O link de login deve começar com / ou http(s)://.' })
    }

    async function upsertSetting(key: string, value: string, label: string, fieldType: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, label, grp: 'landing', fieldType, value: value as any },
        update: { value: value as any },
      })
    }

    await upsertSetting('landing.contact.whatsapp_number', whatsappNumber, 'Landing — WhatsApp', 'text')
    await upsertSetting('landing.contact.whatsapp_message', whatsappMessage, 'Landing — Mensagem inicial WhatsApp', 'textarea')
    await upsertSetting('landing.contact.login_url', loginUrl || LANDING_CONTACT_DEFAULTS.loginUrl, 'Landing — Link do botão Entrar', 'text')

    return { ok: true, whatsappNumber, whatsappMessage, loginUrl: loginUrl || LANDING_CONTACT_DEFAULTS.loginUrl }
  })
}

function summarizeJob(job: any) {
  return {
    id: job.id,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    targetTag: job.targetTag,
    status: job.status,
    triggeredBy: job.triggeredBy,
    backupPath: job.backupPath,
    error: job.error,
    logCount: job.logs.length,
  }
}
