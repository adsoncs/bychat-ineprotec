// src/routes/voip.ts
// Módulo VoIP — integração FaleMaisVoip. Configuração (credenciais das duas APIs),
// teste de conexão, mapeamento de ramais por operador, click-to-call e histórico.
// Blueprint: routes/paymentProviders.ts. Cliente: lib/falemaisVoip.ts.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware, type JwtPayload } from '../lib/auth.js'
import { encryptToken } from '../services/cloudApi.js'
import {
  getVoipConfig,
  clearVoipCache,
  sigmaStatus,
  getSigmaToken,
  gravacoesPing,
  registerCallbackUrl,
  type VoipConfig,
} from '../lib/falemaisVoip.js'
import { createClickToCall } from '../services/voipCallService.js'
import { syncVoipRecordings } from '../services/voipRecordingSync.js'

// Token usado na URL pública de callback (notificação de zip pronto). Gerado
// uma vez e guardado em Setting.
async function getOrCreateCallbackToken(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'voip.recordings.callback_token' } })
  const existing = typeof row?.value === 'string' ? row.value.replace(/^"|"$/g, '') : ''
  if (existing) return existing
  const token = crypto.randomBytes(24).toString('hex')
  await prisma.setting.upsert({
    where: { key: 'voip.recordings.callback_token' },
    create: { key: 'voip.recordings.callback_token', label: 'VoIP — Token de callback de gravações', grp: 'voip', fieldType: 'text', value: token as any },
    update: { value: token as any },
  })
  return token
}

function mask(plain: string): string {
  if (!plain) return ''
  if (plain.length <= 4) return '•'.repeat(plain.length)
  return `${plain.slice(0, 2)}…${plain.slice(-2)}`
}

// Não vaza segredos: senhas viram flag + máscara; o resto é texto puro.
function summarizeConfig(cfg: VoipConfig) {
  return {
    enabled: cfg.enabled,
    sigma: {
      baseUrl: cfg.sigmaBaseUrl,
      user: cfg.sigmaUser,
      hasPassword: !!cfg.sigmaPassword,
      passwordMasked: mask(cfg.sigmaPassword),
      hasToken: !!cfg.sigmaToken,
      tokenMasked: mask(cfg.sigmaToken),
      accountCode: cfg.sigmaAccountCode,
      defaultCallerId: cfg.sigmaDefaultCallerId,
    },
    gravacoes: {
      baseUrl: cfg.gravacoesBaseUrl,
      email: cfg.gravacoesEmail,
      hasPassword: !!cfg.gravacoesPassword,
      passwordMasked: mask(cfg.gravacoesPassword),
      insecureTLS: cfg.gravacoesInsecureTLS,
    },
    recordings: {
      autoSync: cfg.recordingsAutoSync,
      syncIntervalMin: cfg.recordingsSyncIntervalMin,
    },
  }
}

async function upsertSetting(key: string, value: string, label: string, fieldType: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, label, grp: 'voip', fieldType, value: value as any },
    update: { value: value as any },
  })
}

// senha só é gravada quando vier preenchida e não-mascarada (não sobrescrever com máscara/vazio)
function isRealSecret(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !v.includes('•') && !v.includes('…')
}

export async function voipRoutes(app: FastifyInstance) {
  // ── Configuração ──────────────────────────────────────────
  app.get('/api/admin/voip/config', { preHandler: adminOnly }, async () => {
    const cfg = await getVoipConfig()
    return { config: summarizeConfig(cfg) }
  })

  app.put('/api/admin/voip/config', { preHandler: adminOnly }, async (req) => {
    const body = (req.body as any) || {}
    const sigma = body.sigma || {}
    const grav = body.gravacoes || {}
    const rec = body.recordings || {}

    if (body.enabled !== undefined) {
      await upsertSetting('voip.enabled', body.enabled ? 'true' : 'false', 'VoIP — Ativo', 'boolean')
    }
    if (sigma.baseUrl !== undefined) {
      await upsertSetting('voip.sigma.base_url', String(sigma.baseUrl).trim().substring(0, 255), 'VoIP Sigma — Base URL', 'text')
    }
    if (sigma.user !== undefined) {
      await upsertSetting('voip.sigma.user', String(sigma.user).trim().substring(0, 191), 'VoIP Sigma — Usuário', 'text')
    }
    if (isRealSecret(sigma.password)) {
      await upsertSetting('voip.sigma.password', encryptToken(sigma.password), 'VoIP Sigma — Senha (criptografada)', 'password')
    }
    // Token estático (FaleMaisVoip já entrega pronto). isRealSecret grava;
    // string vazia explícita limpa (volta pro fluxo user/senha).
    if (isRealSecret(sigma.token)) {
      await upsertSetting('voip.sigma.token', encryptToken(sigma.token), 'VoIP Sigma — Token (criptografado)', 'password')
    } else if (sigma.token === '') {
      await upsertSetting('voip.sigma.token', '', 'VoIP Sigma — Token (criptografado)', 'password')
    }
    if (sigma.accountCode !== undefined) {
      await upsertSetting('voip.sigma.account_code', String(sigma.accountCode).trim().substring(0, 60), 'VoIP Sigma — Accountcode (fila)', 'text')
    }
    if (sigma.defaultCallerId !== undefined) {
      await upsertSetting('voip.sigma.default_caller_id', String(sigma.defaultCallerId).replace(/\D/g, '').substring(0, 20), 'VoIP Sigma — Bina padrão', 'text')
    }
    if (grav.baseUrl !== undefined) {
      await upsertSetting('voip.gravacoes.base_url', String(grav.baseUrl).trim().substring(0, 255), 'VoIP Gravações — Base URL', 'text')
    }
    if (grav.email !== undefined) {
      await upsertSetting('voip.gravacoes.email', String(grav.email).trim().substring(0, 191), 'VoIP Gravações — Email', 'text')
    }
    if (isRealSecret(grav.password)) {
      await upsertSetting('voip.gravacoes.password', encryptToken(grav.password), 'VoIP Gravações — Senha (criptografada)', 'password')
    }
    if (grav.insecureTLS !== undefined) {
      await upsertSetting('voip.gravacoes.insecure_tls', grav.insecureTLS ? 'true' : 'false', 'VoIP Gravações — Aceitar certificado inválido', 'boolean')
    }
    if (rec.autoSync !== undefined) {
      await upsertSetting('voip.recordings.auto_sync', rec.autoSync ? 'true' : 'false', 'VoIP — Sync automático de gravações', 'boolean')
    }
    if (rec.syncIntervalMin !== undefined) {
      const n = Math.max(5, parseInt(String(rec.syncIntervalMin), 10) || 60)
      await upsertSetting('voip.recordings.sync_interval_min', String(n), 'VoIP — Intervalo de sync (min)', 'number')
    }

    clearVoipCache()
    const cfg = await getVoipConfig()
    return { ok: true, config: summarizeConfig(cfg) }
  })

  // ── Teste de conexão (ambas as APIs) ──────────────────────
  app.post('/api/admin/voip/test', { preHandler: adminOnly }, async () => {
    clearVoipCache()
    const cfg = await getVoipConfig()

    const status = await sigmaStatus(cfg)
    let sigmaAuth = { ok: false, message: '' }
    try {
      await getSigmaToken(cfg, true)
      sigmaAuth = { ok: true, message: 'Token gerado com sucesso' }
    } catch (e: any) {
      sigmaAuth = { ok: false, message: e?.message || 'Falha ao gerar token' }
    }

    const grav = await gravacoesPing(cfg)

    return {
      sigma: {
        status: status.ok,
        statusInfo: status.info ?? null,
        statusError: status.error ?? null,
        auth: sigmaAuth.ok,
        authMessage: sigmaAuth.message,
      },
      gravacoes: {
        login: grav.ok,
        message: grav.ok ? 'Autenticado com sucesso' : (grav.error ?? 'Falha'),
      },
    }
  })

  // ── Ramais por operador ───────────────────────────────────
  app.get('/api/admin/voip/extensions', { preHandler: adminOnly }, async () => {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, voipExtension: true },
      orderBy: { name: 'asc' },
    })
    return { users }
  })

  app.put('/api/admin/voip/extensions', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const items: Array<{ userId: number; extension: string | null }> = Array.isArray(body.extensions) ? body.extensions : []
    if (!items.length) return reply.code(400).send({ error: 'Nenhum ramal informado' })

    for (const it of items) {
      const userId = parseInt(String(it.userId), 10)
      if (!Number.isFinite(userId)) continue
      const ext = it.extension == null ? null : String(it.extension).replace(/\D/g, '').substring(0, 20) || null
      await prisma.user.update({ where: { id: userId }, data: { voipExtension: ext } }).catch(() => {})
    }
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, voipExtension: true },
      orderBy: { name: 'asc' },
    })
    return { ok: true, users }
  })

  // ── Histórico de chamadas ─────────────────────────────────
  app.get('/api/voip/calls', { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    const where: any = {}
    if (q.leadId) where.leadId = parseInt(String(q.leadId), 10)
    if (q.userId) where.userId = parseInt(String(q.userId), 10)
    if (q.status) where.status = String(q.status)
    if (q.source) where.source = String(q.source)
    if (q.from || q.to) {
      where.startedAt = {}
      if (q.from) where.startedAt.gte = new Date(String(q.from))
      if (q.to) where.startedAt.lte = new Date(String(q.to))
    }
    const take = Math.min(parseInt(String(q.limit), 10) || 100, 500)
    const calls = await prisma.voipCall.findMany({ where, orderBy: { startedAt: 'desc' }, take })
    return { calls }
  })

  // ── Status de UMA chamada (polling do widget flutuante) ──
  app.get('/api/voip/calls/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10)
    const call = await prisma.voipCall.findUnique({ where: { id } })
    if (!call) return reply.code(404).send({ error: 'Chamada não encontrada' })
    let leadName: string | null = null
    if (call.leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: call.leadId }, select: { nome: true, empresa: true } })
      leadName = lead?.nome || lead?.empresa || null
    }
    return { call: { ...call, leadName } }
  })

  // ── Click-to-call ─────────────────────────────────────────
  // Origina a chamada pelo ramal do operador logado e registra VoipCall+Activity.
  app.post('/api/voip/calls', { preHandler: authMiddleware }, async (req, reply) => {
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const phone = String(body.phone || '').trim()
    if (!phone) return reply.code(400).send({ error: 'Telefone é obrigatório' })

    const operator = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { voipExtension: true, name: true },
    })
    if (!operator?.voipExtension) {
      return reply.code(400).send({ error: 'Seu usuário não tem ramal VoIP configurado. Peça ao administrador para mapear seu ramal em VoIP > Ramais.' })
    }

    const result = await createClickToCall({
      leadId: body.leadId ? parseInt(String(body.leadId), 10) : null,
      phone,
      userId: user.userId,
      userName: operator.name,
      extension: operator.voipExtension,
      callerId: body.callerId ? String(body.callerId) : null,
    })

    if (!result.ok) return reply.code(400).send({ error: result.error })
    return { ok: true, call: result.call }
  })

  // ── Sincronização de gravações em massa ───────────────────
  app.post('/api/admin/voip/recordings/sync', { preHandler: adminOnly }, async (req) => {
    const body = (req.body as any) || {}
    const opts: { from?: string; to?: string } = {}
    if (body.from) opts.from = String(body.from)
    if (body.to) opts.to = String(body.to)
    const result = await syncVoipRecordings(opts)
    return { ok: !result.error, result }
  })

  // Informa a URL de callback a cadastrar no provedor (e cria o token se faltar).
  app.get('/api/admin/voip/recordings/callback-info', { preHandler: adminOnly }, async () => {
    const token = await getOrCreateCallbackToken()
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    return { callbackUrl: `${base}/api/public/voip/recordings-callback/${token}` }
  })

  // Cadastra a URL de callback diretamente na API de Gravações do provedor.
  app.post('/api/admin/voip/recordings/register-callback', { preHandler: adminOnly }, async (req, reply) => {
    const token = await getOrCreateCallbackToken()
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
    const url = `${base}/api/public/voip/recordings-callback/${token}`
    try {
      const r = await registerCallbackUrl(url)
      if (!r.ok) return reply.code(400).send({ error: 'Provedor recusou o cadastro do callback', raw: r.raw })
      return { ok: true, callbackUrl: url }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Falha ao cadastrar callback' })
    }
  })

  // ── Callback público (notificação de zip pronto) ──────────
  // Fora de /api/voip de propósito: não passa pelo gating de módulo nem exige auth.
  // Valida o token; ao ser chamado, dispara um sync (download individual cobre o período).
  app.post('/api/public/voip/recordings-callback/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const expected = await prisma.setting.findUnique({ where: { key: 'voip.recordings.callback_token' } })
    const valid = typeof expected?.value === 'string' && expected.value.replace(/^"|"$/g, '') === token
    if (!valid) return reply.code(403).send({ error: 'token inválido' })
    // Responde rápido e roda o sync em background (não bloqueia o provedor)
    void syncVoipRecordings().catch(() => {})
    return { ok: true }
  })
}
