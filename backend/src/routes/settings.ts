import { FastifyInstance } from 'fastify'
import nodemailer from 'nodemailer'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { adminOnly, adminStrict, superadminOnly, type JwtPayload } from '../lib/auth.js'
import { isPrimaryInstall } from '../lib/install.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { MEETINGS_NOTICE_DEFAULT, invalidateMeetingsConfigCache } from '../lib/meetingsConfig.js'
import { isGroupJid } from '../lib/phone.js'

// ── Mascaramento de segredos ────────────────────────────────────────────
// Configurações cujo nome indica credencial (api key, token, secret, senha)
// NUNCA devem trafegar em texto plano no GET. O painel exibe a máscara; ao
// salvar, valores ainda mascarados são ignorados (não sobrescrevem o segredo).
const SECRET_MASK = '••••••••'
function isSecretKey(key: string): boolean {
  return /(secret|token|api[_-]?key|apikey|password|passwd|\.pass\b|\.key\b|credential|client[_-]?secret|private[_-]?key|access[_-]?key)/i.test(key)
}
function isMaskedValue(v: unknown): boolean {
  return typeof v === 'string' && (v === SECRET_MASK || /^["']?[•·]+["']?$/.test(v))
}

export async function settingsRoutes(app: FastifyInstance) {

  // GET /api/admin/settings — All settings grouped (segredos mascarados)
  app.get('/api/admin/settings', { preHandler: adminStrict }, async () => {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } })
    const settings = rows.map(s => {
      const v = typeof s.value === 'string' ? s.value : String(s.value ?? '')
      if (isSecretKey(s.key) && v && v !== '""' && v !== 'null') {
        return { ...s, value: SECRET_MASK, _masked: true }
      }
      return s
    })
    const grouped: Record<string, any[]> = {}
    settings.forEach(s => {
      if (!grouped[s.grp]) grouped[s.grp] = []
      grouped[s.grp].push(s)
    })
    return { settings, grouped }
  })

  // PUT /api/admin/settings — Bulk update
  app.put('/api/admin/settings', { preHandler: adminStrict }, async (req, reply) => {
    const updates = req.body as Record<string, any>
    // Códigos personalizados (scripts head/body/CTA) injetados executáveis →
    // só SUPERADMIN, mesma regra do PUT /api/admin/appearance.
    const actor = (req as any).user as JwtPayload
    if (actor.role !== 'SUPERADMIN' && Object.keys(updates).some(k => /custom_head_code|custom_body_code|lp_event_btn_(form|chat)/.test(k))) {
      return reply.code(403).send({ error: 'Apenas SUPERADMIN pode alterar códigos personalizados (head/body/scripts).' })
    }
    for (const [key, value] of Object.entries(updates)) {
      // Não sobrescrever um segredo existente com a máscara reenviada pelo painel.
      if (isSecretKey(key) && isMaskedValue(value)) continue
      // upsert (não updateMany): cria a Setting se ela ainda não existir no tenant.
      // Antes, salvar uma chave/token novo (sem linha pré-existente) era um no-op
      // silencioso — a API key salva no painel "sumia". Agora persiste sempre.
      await prisma.setting.upsert({
        where: { key },
        update: { value },
        create: {
          key,
          value,
          label: key,
          grp: key.includes('.') ? key.split('.')[0] : 'general',
          fieldType: isSecretKey(key) ? 'password' : 'text',
        },
      })
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
    // Auditoria: registra apenas as CHAVES alteradas — nunca os valores (podem
    // conter segredos: tokens, api keys, senhas SMTP).
    const keys = Object.keys(updates)
    if (keys.length > 0) {
      void logUserAudit({
        action: 'setting.changed',
        targetType: 'setting',
        targetLabel: keys.length <= 3 ? keys.join(', ') : `${keys.length} configurações`,
        changes: { keys },
        ...auditActor(req),
      })
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
  // ── Identidade da empresa: endereço, mapa e PIX ────────────────────────
  app.get('/api/admin/company-identity', { preHandler: adminOnly }, async () => {
    const { getCompanyIdentity, pixCopiaECola, enderecoEmLinha } = await import('../services/companyIdentity.js')
    const dados = await getCompanyIdentity()
    return {
      dados,
      // Já devolve pronto: a tela mostra o copia e cola e o QR sem recalcular.
      pixCopiaECola: await pixCopiaECola(),
      enderecoLinha: enderecoEmLinha(dados),
    }
  })

  app.put('/api/admin/company-identity', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body ?? {}) as any
    const tipos = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria']
    const num = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) && n !== 0 ? n : null
    }
    const value = {
      endereco: String(b.endereco ?? '').slice(0, 255),
      cidade: String(b.cidade ?? '').slice(0, 120),
      estado: String(b.estado ?? '').slice(0, 2).toUpperCase(),
      cep: String(b.cep ?? '').slice(0, 12),
      latitude: num(b.latitude),
      longitude: num(b.longitude),
      mapaUrl: String(b.mapaUrl ?? '').slice(0, 500),
      pixChave: String(b.pixChave ?? '').trim().slice(0, 191),
      pixTipo: tipos.includes(b.pixTipo) ? b.pixTipo : 'cnpj',
      pixBeneficiario: String(b.pixBeneficiario ?? '').slice(0, 120),
      pixCidade: String(b.pixCidade ?? '').slice(0, 120),
      pixBanco: String(b.pixBanco ?? '').slice(0, 120),
    }

    // Valida a chave gerando o código: chave inválida só apareceria quando o
    // cliente tentasse pagar, e aí o estrago já está feito.
    if (value.pixChave) {
      try {
        const { gerarPixCopiaECola, validarBrCode } = await import('../lib/pixBrCode.js')
        const cod = gerarPixCopiaECola({
          chave: value.pixChave, tipo: value.pixTipo as any,
          beneficiario: value.pixBeneficiario, cidade: value.pixCidade || value.cidade,
        })
        if (!validarBrCode(cod)) throw new Error('código inválido')
      } catch {
        return reply.code(400).send({ error: 'Não foi possível gerar o PIX com esta chave. Confira o tipo e o valor informados.' })
      }
    }

    await prisma.setting.upsert({
      where: { key: 'company_identity' },
      create: { key: 'company_identity', label: 'Identidade da empresa', grp: 'company', fieldType: 'json', value: value as any },
      update: { value: value as any },
    })
    const { invalidateCompanyIdentityCache, pixCopiaECola } = await import('../services/companyIdentity.js')
    invalidateCompanyIdentityCache()
    return { ok: true, dados: value, pixCopiaECola: await pixCopiaECola() }
  })

  // GET /api/admin/company-identity/pix-qrcode.png — o mesmo código, em imagem.
  // Copia e cola e QR são o MESMO payload: um para colar no banco, outro para
  // apontar a câmera.
  app.get('/api/admin/company-identity/pix-qrcode.png', { preHandler: adminOnly }, async (req, reply) => {
    const { size, valor } = req.query as { size?: string; valor?: string }
    const px = Math.min(Math.max(parseInt(size || '320', 10) || 320, 120), 1024)
    const { pixCopiaECola } = await import('../services/companyIdentity.js')
    const codigo = await pixCopiaECola({ valor: valor ? Number(valor) : null })
    if (!codigo) return reply.code(404).send({ error: 'PIX não configurado' })
    const QRCode = (await import('qrcode')).default
    const buf = await QRCode.toBuffer(codigo, { type: 'png', width: px, margin: 2, errorCorrectionLevel: 'M' })
    reply.header('Content-Type', 'image/png')
    reply.header('Cache-Control', 'no-store')
    return reply.send(buf)
  })

  // ── Identificação do operador nas Conversas ────────────────────────────
  app.get('/api/admin/conversation-identity', { preHandler: adminOnly }, async () => {
    const { getIdentityConfig } = await import('../services/operatorIdentity.js')
    return { config: await getIdentityConfig() }
  })

  app.put('/api/admin/conversation-identity', { preHandler: adminOnly }, async (req) => {
    const body = (req.body ?? {}) as any
    const config = {
      identificarOperador: !!body.identificarOperador,
      identificarModo: body.identificarModo === 'sempre' ? 'sempre' : 'ao_mudar',
      incluirSetor: body.incluirSetor !== false,
      avisarTransferencia: !!body.avisarTransferencia,
      avisarTransferenciaTexto: typeof body.avisarTransferenciaTexto === 'string' && body.avisarTransferenciaTexto.trim()
        ? body.avisarTransferenciaTexto.trim().slice(0, 500)
        : 'Você agora está sendo atendido por {agente}, do setor {setor}.',
    }
    await prisma.setting.upsert({
      where: { key: 'conversation_identity' },
      create: {
        key: 'conversation_identity',
        label: 'Identificação do operador (Conversas)',
        grp: 'whatsapp',
        fieldType: 'json',
        value: config as any,
      },
      update: { value: config as any },
    })
    const { invalidateIdentityCache } = await import('../services/operatorIdentity.js')
    invalidateIdentityCache()
    return { ok: true, config }
  })

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

  // ── Reuniões (Transcrição) — opt-in de GRAVAÇÃO com aceite LGPD ──────────
  // Portão de consentimento (F0.2). A gravação/transcrição de reuniões trata
  // dado pessoal de TODOS os participantes (inclusive o lead), então só liga
  // por ação explícita do admin, que declara assumir a responsabilidade de
  // controlador pela base legal. Guardamos quem aceitou e quando (auditoria).
  // O texto-padrão MEETINGS_NOTICE_DEFAULT vem de lib/meetingsConfig (fonte única).

  // Rota sob /api/admin/legal/* (não /api/admin/meetings/*) de propósito: é
  // config LEGAL sempre acessível ao admin, e NÃO deve ser barrada pelo gate do
  // módulo 'meetings' (que nasce inativo). Os prefixos /api/admin/meetings ficam
  // reservados às rotas da feature (F1: disparo de bot, transcrições).
  app.get('/api/admin/legal/meetings-recording', { preHandler: adminOnly }, async () => {
    const rows = await prisma.setting.findMany({
      where: { key: { startsWith: 'meetings.recording.' } },
    })
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    const u = (raw: any): string => {
      if (raw === null || raw === undefined) return ''
      if (typeof raw === 'string') return raw.replace(/^"|"$/g, '').trim()
      return String(raw)
    }
    const retentionRaw = parseInt(u(byKey.get('meetings.recording.retention_days')), 10)
    return {
      enabled: u(byKey.get('meetings.recording.enabled')).toLowerCase() === 'true',
      noticeText: u(byKey.get('meetings.recording.notice_text')) || MEETINGS_NOTICE_DEFAULT,
      retentionDays: Number.isFinite(retentionRaw) && retentionRaw > 0 ? retentionRaw : 90,
      legalAcceptedBy: u(byKey.get('meetings.recording.legal_accepted_by')) || null,
      legalAcceptedAt: u(byKey.get('meetings.recording.legal_accepted_at')) || null,
    }
  })

  app.put('/api/admin/legal/meetings-recording', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const enabled = !!body.enabled
    const noticeText = typeof body.noticeText === 'string' && body.noticeText.trim()
      ? body.noticeText.trim().substring(0, 2000)
      : MEETINGS_NOTICE_DEFAULT
    let retentionDays = parseInt(String(body.retentionDays), 10)
    if (!Number.isFinite(retentionDays) || retentionDays < 1) retentionDays = 90
    if (retentionDays > 3650) retentionDays = 3650

    // Estado atual (para detectar a transição desligado→ligado)
    const prev = await prisma.setting.findUnique({ where: { key: 'meetings.recording.enabled' } })
    const wasEnabled = typeof prev?.value === 'string'
      ? prev.value.replace(/^"|"$/g, '').trim().toLowerCase() === 'true'
      : false

    // Portão legal: LIGAR a gravação exige aceite explícito de responsabilidade.
    if (enabled && !wasEnabled && body.legalAccepted !== true) {
      return reply.code(400).send({
        error: 'Para ativar a gravação de reuniões é necessário aceitar a responsabilidade de controlador pela base legal (LGPD).',
        code: 'LEGAL_ACCEPTANCE_REQUIRED',
      })
    }

    async function upsertSetting(key: string, value: any, label: string, fieldType: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, label, grp: 'meetings', fieldType, value: value as any },
        update: { value: value as any },
      })
    }

    await upsertSetting('meetings.recording.enabled', enabled ? 'true' : 'false', 'Reuniões — Gravação ativa', 'boolean')
    await upsertSetting('meetings.recording.notice_text', noticeText, 'Reuniões — Aviso de gravação (convite)', 'textarea')
    await upsertSetting('meetings.recording.retention_days', String(retentionDays), 'Reuniões — Retenção (dias)', 'number')

    // Registra o aceite no momento em que a gravação é LIGADA.
    if (enabled && !wasEnabled) {
      const actor = auditActor(req)
      await upsertSetting('meetings.recording.legal_accepted_by', actor.actorName || 'desconhecido', 'Reuniões — Aceite legal por', 'text')
      await upsertSetting('meetings.recording.legal_accepted_at', new Date().toISOString(), 'Reuniões — Aceite legal em', 'text')
    }

    void logUserAudit({
      action: enabled && !wasEnabled ? 'meetings.recording.enabled'
        : (!enabled && wasEnabled ? 'meetings.recording.disabled' : 'meetings.recording.updated'),
      targetType: 'setting',
      targetLabel: 'Gravação de reuniões (LGPD)',
      changes: { enabled, retentionDays },
      ...auditActor(req),
    })

    invalidateMeetingsConfigCache()
    return { ok: true }
  })

  // ── LANDING INSTITUCIONAL — contatos editáveis sem rebuild ──
  // Só os contatos da vitrine pública (bychat.ia.br) são editáveis por painel;
  // textos e seções continuam em código (landing.copy.ts). Os valores são
  // injetados em window.__LANDING_CONTACT__ pelo serveLandingPage (server.ts).
  const LANDING_CONTACT_DEFAULTS = {
    whatsappNumber: '5511944742843',
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

  // ── LGPD / Legal ────────────────────────────────────────────────────────
  // Dados do controlador exibidos nas páginas SSR /privacidade, /termos,
  // /cookies (rota legal.ts). Cada tenant é controlador dos seus titulares →
  // disponível por instalação (adminOnly), não só na principal.
  app.get('/api/admin/legal', { preHandler: adminOnly }, async () => {
    const keys = ['legal.company_name', 'legal.cnpj', 'legal.dpo_email', 'legal.version',
      'legal.privacy_html', 'legal.terms_html', 'legal.cookies_html']
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    return {
      companyName: unwrapSetting(byKey.get('legal.company_name')),
      cnpj: unwrapSetting(byKey.get('legal.cnpj')),
      dpoEmail: unwrapSetting(byKey.get('legal.dpo_email')),
      version: unwrapSetting(byKey.get('legal.version')) || '1.0',
      privacyHtml: unwrapSetting(byKey.get('legal.privacy_html')),
      termsHtml: unwrapSetting(byKey.get('legal.terms_html')),
      cookiesHtml: unwrapSetting(byKey.get('legal.cookies_html')),
    }
  })

  app.put('/api/admin/legal', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const companyName = String(b.companyName ?? '').trim().slice(0, 200)
    const cnpj = String(b.cnpj ?? '').trim().slice(0, 25)
    const dpoEmail = String(b.dpoEmail ?? '').trim().slice(0, 160)
    const version = (String(b.version ?? '').trim() || '1.0').slice(0, 20)
    const privacyHtml = typeof b.privacyHtml === 'string' ? b.privacyHtml.slice(0, 60000) : ''
    const termsHtml = typeof b.termsHtml === 'string' ? b.termsHtml.slice(0, 60000) : ''
    const cookiesHtml = typeof b.cookiesHtml === 'string' ? b.cookiesHtml.slice(0, 60000) : ''

    if (dpoEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dpoEmail)) {
      return reply.code(400).send({ error: 'E-mail do Encarregado (DPO) inválido.' })
    }

    async function up(key: string, value: string, label: string, fieldType: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, label, grp: 'legal', fieldType, value: value as any },
        update: { value: value as any },
      })
    }
    await up('legal.company_name', companyName, 'LGPD — Razão social', 'text')
    await up('legal.cnpj', cnpj, 'LGPD — CNPJ', 'text')
    await up('legal.dpo_email', dpoEmail, 'LGPD — E-mail do Encarregado (DPO)', 'text')
    await up('legal.version', version, 'LGPD — Versão da política', 'text')
    await up('legal.privacy_html', privacyHtml, 'LGPD — HTML da Política de Privacidade (opcional)', 'textarea')
    await up('legal.terms_html', termsHtml, 'LGPD — HTML dos Termos (opcional)', 'textarea')
    await up('legal.cookies_html', cookiesHtml, 'LGPD — HTML da Política de Cookies (opcional)', 'textarea')

    return { ok: true }
  })

  // ── Empresa ─────────────────────────────────────────────────────────────
  // Dados da empresa (razão social/CNPJ, compartilhados com a LGPD) + Dados de
  // Notificações: listas de e-mails e WhatsApps que recebem avisos internos
  // (novo lead, agendamento, LGPD). Fonte única consumida por
  // getNotificationTargets() em services/notify.ts.
  app.get('/api/admin/company', { preHandler: adminOnly }, async () => {
    const keys = ['legal.company_name', 'legal.cnpj',
      'company.notify_emails', 'company.notify_whatsapps', 'company.notify_cc_agents']
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
    const byKey = new Map(rows.map(r => [r.key, r.value]))
    const asArray = (raw: any): string[] => {
      if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean)
      if (typeof raw === 'string' && raw.trim()) {
        try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map((v) => String(v).trim()).filter(Boolean) : [raw.trim()] }
        catch { return raw.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean) }
      }
      return []
    }
    const ccRaw = byKey.get('company.notify_cc_agents')
    return {
      companyName: unwrapSetting(byKey.get('legal.company_name')),
      cnpj: unwrapSetting(byKey.get('legal.cnpj')),
      notifyEmails: asArray(byKey.get('company.notify_emails')),
      notifyWhatsapps: asArray(byKey.get('company.notify_whatsapps')),
      ccAgents: ccRaw === undefined || ccRaw === null ? true : (ccRaw === true || ccRaw === 'true' || ccRaw === 1),
    }
  })

  // Grupos do WhatsApp do número conectado — alimenta o seletor de destino dos
  // avisos internos (escolher pelo nome em vez de colar o JID). Só Evolution:
  // a Cloud API oficial não envia a grupos.
  app.get('/api/admin/company/whatsapp-groups', { preHandler: adminOnly }, async (_req, reply) => {
    try {
      const { createEvolutionProvider } = await import('../services/whatsappProvider.js')
      const groups = await createEvolutionProvider().listGroups()
      return { groups }
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || 'Não foi possível listar os grupos do WhatsApp' })
    }
  })

  app.put('/api/admin/company', { preHandler: adminOnly }, async (req, reply) => {
    const b = (req.body as any) || {}
    const companyName = String(b.companyName ?? '').trim().slice(0, 200)
    const cnpj = String(b.cnpj ?? '').trim().slice(0, 25)

    const cleanEmails = Array.isArray(b.notifyEmails)
      ? Array.from(new Set(b.notifyEmails.map((v: any) => String(v).trim()).filter(Boolean))) as string[]
      : []
    // Destino pode ser número (só dígitos) OU grupo do WhatsApp (JID `...@g.us`,
    // escolhido pelo seletor). A higienização antiga tirava tudo que não fosse
    // dígito e transformava o JID do grupo num número inválido.
    const cleanWhatsapps = Array.isArray(b.notifyWhatsapps)
      ? Array.from(new Set(b.notifyWhatsapps.map((v: any) => {
          const s = String(v).trim()
          return isGroupJid(s) ? s : s.replace(/[^\d+]/g, '')
        }).filter(Boolean))) as string[]
      : []
    const ccAgents = b.ccAgents === undefined ? true : !!b.ccAgents

    const badEmail = cleanEmails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (badEmail) return reply.code(400).send({ error: `E-mail de notificação inválido: ${badEmail}` })

    async function up(key: string, value: any, label: string, fieldType: string) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, label, grp: 'company', fieldType, value: value as any },
        update: { value: value as any },
      })
    }
    // Razão social/CNPJ continuam no grupo legal (fonte única com a LGPD).
    await prisma.setting.upsert({
      where: { key: 'legal.company_name' },
      create: { key: 'legal.company_name', label: 'LGPD — Razão social', grp: 'legal', fieldType: 'text', value: companyName as any },
      update: { value: companyName as any },
    })
    await prisma.setting.upsert({
      where: { key: 'legal.cnpj' },
      create: { key: 'legal.cnpj', label: 'LGPD — CNPJ', grp: 'legal', fieldType: 'text', value: cnpj as any },
      update: { value: cnpj as any },
    })
    await up('company.notify_emails', cleanEmails, 'Empresa — E-mails que recebem notificações', 'json')
    await up('company.notify_whatsapps', cleanWhatsapps, 'Empresa — WhatsApps que recebem notificações', 'json')
    await up('company.notify_cc_agents', ccAgents, 'Empresa — Copiar agentes ativos nos avisos por e-mail', 'boolean')

    return { ok: true, notifyEmails: cleanEmails, notifyWhatsapps: cleanWhatsapps, ccAgents }
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
