import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, authMiddleware, type JwtPayload } from '../lib/auth.js'

// Resolve a config da Evolution: Setting do painel (whatsapp.evolution_*)
// sobrepõe o env — mesma estratégia de workers/chatbotFlow/evolutionMonitor.
// Sem isso, instalações multi-tenant (config via painel) não criam instância.
async function getEvoConfig(): Promise<{ url: string; key: string }> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } },
  })
  const db: Record<string, string> = {}
  rows.forEach(r => {
    db[r.key] = typeof r.value === 'string' ? r.value : String(r.value).replace(/"/g, '')
  })
  return {
    url: db['whatsapp.evolution_url'] || process.env.EVOLUTION_API_URL || '',
    key: db['whatsapp.evolution_key'] || process.env.EVOLUTION_API_KEY || '',
  }
}

async function evoFetch(path: string, method = 'GET', body?: any) {
  const { url, key } = await getEvoConfig()
  const opts: any = { method, headers: { 'Content-Type': 'application/json', 'apikey': key } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${url}${path}`, opts)
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

const ADMIN_ROLES = new Set(['SUPERADMIN', 'ADMIN', 'MANAGER'])
function isAdminRole(role?: string | null): boolean {
  return !!role && ADMIN_ROLES.has(role)
}

/**
 * Valida permissão sobre uma instância específica.
 *  - SUPERADMIN/ADMIN/MANAGER → sempre permite
 *  - AGENT → só se for `ownerUserId` da instância
 *  - VIEWER → bloqueia ações (read-only)
 *
 * Retorna a instância (e seta status 4xx no reply se bloquear).
 */
async function assertInstanceAccess(
  req: FastifyRequest, reply: FastifyReply, instId: number, requireWrite = true,
): Promise<{ id: number; instanceName: string; ownerUserId: number | null } | null> {
  const user = (req as any).user as JwtPayload
  const inst = await prisma.whatsAppInstance.findUnique({
    where: { id: instId },
    select: { id: true, instanceName: true, ownerUserId: true },
  })
  if (!inst) { reply.code(404).send({ error: 'Instância não encontrada' }); return null }
  if (isAdminRole(user.role)) return inst
  if (user.role === 'VIEWER' && requireWrite) {
    reply.code(403).send({ error: 'VIEWER não pode operar instâncias' })
    return null
  }
  if (inst.ownerUserId !== user.userId) {
    reply.code(403).send({ error: 'Você não é o dono desta instância' })
    return null
  }
  return inst
}

/**
 * Valida que o `ownerUserId` informado é um user real, ativo e com role
 * adequado pra ser dono de instância (não pode ser VIEWER nem inativo).
 */
async function assertValidOwner(ownerUserId: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (ownerUserId === null || ownerUserId === undefined || ownerUserId === '') return { ok: true }
  const id = Number(ownerUserId)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: 'ownerUserId inválido' }
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, active: true, role: true } })
  if (!u) return { ok: false, reason: 'Usuário destino não encontrado' }
  if (!u.active) return { ok: false, reason: 'Usuário destino inativo' }
  if (u.role === 'VIEWER') return { ok: false, reason: 'VIEWER não pode ser dono de instância' }
  return { ok: true }
}

export async function instancesRoutes(app: FastifyInstance) {

  // GET /api/admin/instances — Lista instâncias.
  // Admin (SUPERADMIN/ADMIN/MANAGER) vê todas; AGENT vê só as próprias;
  // VIEWER vê só as próprias (read-only).
  // Cross-check: connectionState precisa estar `open` E ownerJid não-vazio.
  // Sessão fantasma (open mas sem ownerJid) é reportada como disconnected.
  app.get('/api/admin/instances', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const where = isAdminRole(user.role) ? {} : { ownerUserId: user.userId }
    const instances = await prisma.whatsAppInstance.findMany({
      where, orderBy: { createdAt: 'asc' },
    })

    // Batch fetch: 1 chamada à Evolution retorna todas as instâncias com ownerJid
    let evoMap = new Map<string, { connectionStatus?: string; ownerJid?: string }>()
    try {
      const evoList = await evoFetch('/instance/fetchInstances')
      if (Array.isArray(evoList)) {
        for (const e of evoList) {
          const name = e?.name || e?.instanceName
          if (name) evoMap.set(name, { connectionStatus: e?.connectionStatus, ownerJid: e?.ownerJid })
        }
      }
    } catch {
      // fallback silencioso — usa per-instance connectionState abaixo
    }

    const withStatus = await Promise.all(instances.map(async inst => {
      let status: 'connected' | 'disconnected' | 'error' | 'unknown' = 'unknown'
      let ownerJid: string | null = null

      const batch = evoMap.get(inst.instanceName)
      if (batch) {
        ownerJid = batch.ownerJid || null
        const isOpen = batch.connectionStatus === 'open' || batch.connectionStatus === 'connected'
        const hasOwner = !!(ownerJid && ownerJid.trim())
        status = (isOpen && hasOwner) ? 'connected' : 'disconnected'
      } else {
        try {
          const result = await evoFetch(`/instance/connectionState/${inst.instanceName}`)
          const state = result?.state || result?.instance?.state || ''
          status = (state === 'open' || state === 'connected') ? 'connected' : 'disconnected'
        } catch { status = 'error' }
      }

      return { ...inst, status, ownerJid }
    }))

    return { instances: withStatus }
  })

  // POST /api/admin/instances — Create new instance (admin-only).
  // Valida que ownerUserId (se informado) é um user real, ativo e elegível.
  app.post('/api/admin/instances', { preHandler: adminOnly }, async (req, reply) => {
    const { name, instanceName, chatbotId, defaultTeamId, ownerUserId } = req.body as any
    if (!name || !instanceName) {
      return reply.code(400).send({ error: 'Nome e nome da instância são obrigatórios' })
    }

    const clean = instanceName.toLowerCase().replace(/[^a-z0-9_-]/g, '')
    const exists = await prisma.whatsAppInstance.findUnique({ where: { instanceName: clean } })
    if (exists) return reply.code(409).send({ error: 'Já existe uma instância com este nome' })

    // Reforma F2: dono pode ser setor OU agente — mutuamente exclusivos.
    if (defaultTeamId && ownerUserId) {
      return reply.code(400).send({ error: 'Instância pode ter apenas um dono: setor OU agente, não ambos.' })
    }

    // Valida que ownerUserId é um user válido (existe + ativo + role aceitável)
    const ownerCheck = await assertValidOwner(ownerUserId)
    if (!ownerCheck.ok) return reply.code(400).send({ error: ownerCheck.reason })

    const inst = await prisma.whatsAppInstance.create({
      data: {
        name,
        instanceName: clean,
        chatbotId: chatbotId || null,
        defaultTeamId: defaultTeamId ? Number(defaultTeamId) : null,
        ownerUserId: ownerUserId ? Number(ownerUserId) : null,
        active: true,
      },
    })
    return inst
  })

  // PUT /api/admin/instances/:id — Update instance (admin-only).
  app.put('/api/admin/instances/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { name, chatbotId, defaultTeamId, ownerUserId, active, funnelId, stageKey } = req.body as any
    const data: any = {}
    if (name !== undefined) data.name = name
    if (chatbotId !== undefined) data.chatbotId = chatbotId || null

    // Funil dos leads do chatbot (validar funil + etapa). Vazio = não promove.
    if (funnelId !== undefined || stageKey !== undefined) {
      const fid = funnelId ? Number(funnelId) : null
      let skey: string | null = stageKey ? String(stageKey) : null
      if (fid) {
        const f = await prisma.funnel.findUnique({ where: { id: fid }, select: { id: true } })
        if (!f) return reply.code(400).send({ error: 'Funil não encontrado' })
        if (skey) {
          const s = await prisma.stage.findFirst({ where: { funnelId: fid, key: skey, active: true }, select: { key: true } })
          if (!s) skey = null
        }
      } else { skey = null }
      data.funnelId = fid
      data.stageKey = skey
    }
    // Reforma F2: dono é mutuamente exclusivo. Trocar para um zera o outro.
    if (defaultTeamId !== undefined && ownerUserId !== undefined) {
      if (defaultTeamId && ownerUserId) {
        return reply.code(400).send({ error: 'Instância pode ter apenas um dono: setor OU agente.' })
      }
      const ownerCheck = await assertValidOwner(ownerUserId)
      if (!ownerCheck.ok) return reply.code(400).send({ error: ownerCheck.reason })
      data.defaultTeamId = defaultTeamId ? Number(defaultTeamId) : null
      data.ownerUserId = ownerUserId ? Number(ownerUserId) : null
    } else if (defaultTeamId !== undefined) {
      data.defaultTeamId = defaultTeamId ? Number(defaultTeamId) : null
      if (data.defaultTeamId) data.ownerUserId = null
    } else if (ownerUserId !== undefined) {
      const ownerCheck = await assertValidOwner(ownerUserId)
      if (!ownerCheck.ok) return reply.code(400).send({ error: ownerCheck.reason })
      data.ownerUserId = ownerUserId ? Number(ownerUserId) : null
      if (data.ownerUserId) data.defaultTeamId = null
    }
    if (active !== undefined) data.active = active
    const inst = await prisma.whatsAppInstance.update({ where: { id: Number(id) }, data })
    return inst
  })

  // DELETE /api/admin/instances/:id — Delete instance (admin-only).
  app.delete('/api/admin/instances/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const inst = await prisma.whatsAppInstance.findUnique({ where: { id: Number(id) } })
    if (!inst) return reply.code(404).send({ error: 'Instância não encontrada' })

    // Try to disconnect on Evolution API
    try { await evoFetch(`/instance/logout/${inst.instanceName}`, 'DELETE') } catch {}
    try { await evoFetch(`/instance/delete/${inst.instanceName}`, 'DELETE') } catch {}

    await prisma.whatsAppInstance.delete({ where: { id: Number(id) } })
    return { ok: true }
  })

  // ── Instance actions ──
  // Owner-or-admin: o AGENT só pode conectar/desconectar/reiniciar/ver status
  // da própria instância. SUPERADMIN/ADMIN/MANAGER passam livre.

  // POST /api/admin/instances/:id/connect — Connect (QR code)
  app.post('/api/admin/instances/:id/connect', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const inst = await assertInstanceAccess(req, reply, Number(id))
    if (!inst) return

    try {
      // Check if instance exists on Evolution
      let instanceExists = false
      try {
        const state = await evoFetch(`/instance/connectionState/${inst.instanceName}`)
        instanceExists = !!state && !state.status && !state.error
      } catch {}

      // Create if not exists
      if (!instanceExists) {
        const webhookUrl = `${process.env.APP_URL || 'https://bychat.ia.br'}/api/whatsapp/webhook`
        const createResult = await evoFetch('/instance/create', 'POST', {
          instanceName: inst.instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          webhook: { url: webhookUrl, webhookByEvents: false, webhookBase64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'PRESENCE_UPDATE', 'CONNECTION_UPDATE'] }
        })
        if (createResult?.qrcode?.base64 || createResult?.base64) return createResult
      }

      const qr = await evoFetch(`/instance/connect/${inst.instanceName}`)
      return qr
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/admin/instances/:id/disconnect
  app.post('/api/admin/instances/:id/disconnect', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const inst = await assertInstanceAccess(req, reply, Number(id))
    if (!inst) return
    try {
      await evoFetch(`/instance/logout/${inst.instanceName}`, 'DELETE')
      return { ok: true }
    } catch (err: any) { return reply.code(500).send({ error: err.message }) }
  })

  // POST /api/admin/instances/:id/restart
  app.post('/api/admin/instances/:id/restart', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const inst = await assertInstanceAccess(req, reply, Number(id))
    if (!inst) return
    try {
      await evoFetch(`/instance/restart/${inst.instanceName}`, 'PUT')
      return { ok: true }
    } catch (err: any) { return reply.code(500).send({ error: err.message }) }
  })

  // GET /api/admin/instances/:id/status
  app.get('/api/admin/instances/:id/status', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const inst = await assertInstanceAccess(req, reply, Number(id), false) // false = read-only OK pra VIEWER do dono
    if (!inst) return
    try {
      const result = await evoFetch(`/instance/connectionState/${inst.instanceName}`)
      return { instance: inst.instanceName, ...result }
    } catch (err: any) { return reply.code(500).send({ error: err.message }) }
  })
}
