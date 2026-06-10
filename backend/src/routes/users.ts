import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { signToken, authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { moveToTrash, snapshotEntity } from '../services/trash.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { sendPasswordResetEmail } from '../services/notify.js'
import { onLoginFail, onLoginSuccess, logSecurityEvent, blacklistToken } from '../services/security.js'
import { resolvePermissions, invalidatePermCache, getActiveModuleIds } from '../lib/permissions.js'
import { broadcastRealtimeEvent } from './realtime.js'
import { MODULE_REGISTRY } from '../lib/moduleRegistry.js'
import { redis } from '../lib/redis.js'
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeByRaw,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from '../lib/refreshToken.js'

// Rate limit por email (anti account-enumeration): 5 tentativas/10min por email
async function checkEmailRateLimit(email: string): Promise<boolean> {
  const key = `login_email:${email.toLowerCase().trim()}`
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, 600)
  return n > 5
}
async function resetEmailRateLimit(email: string): Promise<void> {
  await redis.del(`login_email:${email.toLowerCase().trim()}`)
}
async function checkForgotRateLimit(ipOrEmail: string): Promise<boolean> {
  const key = `forgot_pw:${ipOrEmail}`
  const n = await redis.incr(key)
  if (n === 1) await redis.expire(key, 900)
  return n > 3
}
// Timing mínimo para evitar enumeration via timing attack
async function minDelay(startTime: number, minMs: number): Promise<void> {
  const elapsed = Date.now() - startTime
  const wait = Math.max(0, minMs - elapsed)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

const MIN_PASSWORD_LENGTH = 10
function validatePassword(pw: string): string | null {
  if (!pw || pw.length < MIN_PASSWORD_LENGTH) return `Senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`
  if (!/[A-Z]/.test(pw)) return 'Senha deve conter pelo menos uma letra maiúscula'
  if (!/[a-z]/.test(pw)) return 'Senha deve conter pelo menos uma letra minúscula'
  if (!/[0-9]/.test(pw)) return 'Senha deve conter pelo menos um número'
  return null
}

export async function usersRoutes(app: FastifyInstance) {

  // ── POST /api/admin/login — Login com email + senha ──
  app.post('/api/admin/login', async (req, reply) => {
    const startTime = Date.now()
    const { email, password } = req.body as any
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Email e senha são obrigatórios' })
    }

    const ua = req.headers['user-agent'] || ''
    const ip = req.ip

    // Rate limit por email (evita brute-force com rotação de IPs)
    if (await checkEmailRateLimit(email)) {
      await logSecurityEvent({ ip, type: 'login_email_rate_limited', severity: 'high', email, userAgent: ua, path: '/api/admin/login', details: 'Rate limit por email excedido' })
      await minDelay(startTime, 500)
      return reply.code(429).send({ error: 'Muitas tentativas para este email. Tente em 10 minutos.' })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (!user) {
      await onLoginFail(ip, email, ua)
      await minDelay(startTime, 500)  // previne timing enumeration
      return reply.code(401).send({ error: 'Email ou senha incorretos' })
    }

    // Check if user is locked
    if (user.lockedAt) {
      return reply.code(403).send({ error: 'Conta bloqueada. Motivo: ' + (user.lockReason || 'Contate o administrador') })
    }

    if (!user.active) {
      return reply.code(403).send({ error: 'Conta desativada. Contate o administrador.' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      // Increment login attempts and auto-lock at 10 failures
      const attempts = (user.loginAttempts || 0) + 1
      const lockData: any = { loginAttempts: attempts }
      if (attempts >= 10) {
        lockData.lockedAt = new Date()
        lockData.lockReason = `Bloqueio automatico: ${attempts} tentativas de login falhadas`
        lockData.active = false
        await logSecurityEvent({ ip, type: 'user_auto_locked', severity: 'critical', email, userAgent: ua, path: '/api/admin/login', details: `Usuario ${email} bloqueado apos ${attempts} tentativas` })
      }
      await prisma.user.update({ where: { id: user.id }, data: lockData })
      await onLoginFail(ip, email, ua)
      await minDelay(startTime, 500)
      return reply.code(401).send({ error: attempts >= 10 ? 'Conta bloqueada por excesso de tentativas. Contate o administrador.' : 'Email ou senha incorretos' })
    }

    // Reset attempts on success + marca operador como disponível.
    // Se ele já estava em "away"/"busy" voluntariamente, mantém — só promove
    // de offline pra available.
    const promoteStatus = user.workStatus === 'offline'
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginAttempts: 0,
        ...(promoteStatus ? { workStatus: 'available', workStatusUpdatedAt: new Date() } : {}),
      },
    })
    await resetEmailRateLimit(email)
    await onLoginSuccess(ip, user.email, ua)

    // Audit: login bem-sucedido (ator = o próprio usuário).
    void logUserAudit({
      action: 'auth.login',
      actorId: user.id,
      actorName: user.name || user.email,
      targetUserId: user.id,
      targetType: 'auth',
      ipAddress: ip,
    })

    const token = signToken({ userId: user.id, email: user.email, name: user.name, role: user.role })
    const refresh = await issueRefreshToken({ userId: user.id, userAgent: ua, ip })
    setRefreshCookie(req, reply, refresh.raw, refresh.expiresAt)
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    }
  })

  // ── POST /api/admin/refresh — Rotaciona refresh token e devolve novo access ──
  // Anônima (sem authMiddleware): a credencial é o cookie httpOnly bh_refresh.
  app.post('/api/admin/refresh', async (req, reply) => {
    const raw = readRefreshCookie(req)
    if (!raw) return reply.code(401).send({ error: 'Sem refresh token' })

    const uaHeader = req.headers['user-agent']
    const ua = (Array.isArray(uaHeader) ? uaHeader[0] : uaHeader) || ''
    const ip = req.ip
    const result = await rotateRefreshToken({ raw, userAgent: ua, ip })

    if (result.kind === 'reuse') {
      await logSecurityEvent({
        ip, type: 'refresh_token_reuse', severity: 'critical', userAgent: ua,
        path: '/api/admin/refresh',
        details: `Refresh reuse detectado — família ${result.family} revogada`,
      })
      clearRefreshCookie(req, reply)
      return reply.code(401).send({ error: 'Sessão revogada por motivo de segurança' })
    }
    if (result.kind === 'invalid' || result.kind === 'expired') {
      clearRefreshCookie(req, reply)
      return reply.code(401).send({ error: 'Refresh token inválido ou expirado' })
    }

    const user = await prisma.user.findUnique({ where: { id: result.userId } })
    if (!user || !user.active || user.lockedAt) {
      clearRefreshCookie(req, reply)
      return reply.code(401).send({ error: 'Conta indisponível' })
    }

    const token = signToken({ userId: user.id, email: user.email, name: user.name, role: user.role })
    setRefreshCookie(req, reply, result.raw, result.expiresAt)
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    }
  })

  // ── POST /api/admin/logout — Revogar token JWT + refresh ──
  app.post('/api/admin/logout', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    if (user.jti) {
      const token = req.headers.authorization?.replace('Bearer ', '') || ''
      try {
        const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
        const ttl = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000))
        if (ttl > 0) await blacklistToken(user.jti, ttl)
      } catch { /* token malformed, ignore */ }
    }
    const raw = readRefreshCookie(req)
    if (raw) await revokeByRaw(raw)
    clearRefreshCookie(req, reply)
    // Logout volta o status pra offline (se ainda não estiver). Operador pode
    // logar em outra aba e voltar a available no próximo login.
    await prisma.user.update({
      where: { id: user.userId },
      data: { workStatus: 'offline', workStatusUpdatedAt: new Date() },
    }).catch(() => {})

    void logUserAudit({
      action: 'auth.logout',
      targetUserId: user.userId,
      targetType: 'auth',
      ...auditActor(req),
    })

    return { ok: true }
  })

  // ── GET /api/admin/me — Dados do usuário logado ──
  app.get('/api/admin/me', { preHandler: authMiddleware }, async (req) => {
    const { userId } = (req as any).user as JwtPayload
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { error: 'Usuário não encontrado' }
    return {
      id: user.id, email: user.email, name: user.name, role: user.role,
      active: user.active, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
      workStatus: user.workStatus,
      workStatusUpdatedAt: user.workStatusUpdatedAt,
      capacity: user.capacity,
    }
  })

  // ── PUT /api/admin/me/work-status — Operador troca seu próprio status ──
  // body: { status: 'available' | 'away' | 'busy' | 'offline' }
  app.put('/api/admin/me/work-status', { preHandler: authMiddleware }, async (req, reply) => {
    const { userId } = (req as any).user as JwtPayload
    const body = req.body as any
    const status = String(body?.status || '')
    const allowed = ['available', 'away', 'busy', 'offline']
    if (!allowed.includes(status)) {
      return reply.code(400).send({ error: 'Status inválido', allowed })
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { workStatus: status, workStatusUpdatedAt: new Date() },
      select: { id: true, workStatus: true, workStatusUpdatedAt: true },
    })
    return { ok: true, ...updated }
  })

  // ── POST /api/admin/heartbeat — Atualiza presença online do operador ──
  // Frontend chama a cada 30s. lastSeenAt é usado para classificar status.
  app.post('/api/admin/heartbeat', { preHandler: authMiddleware }, async (req) => {
    const { userId } = (req as any).user as JwtPayload
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    })
    return { ok: true, ts: new Date().toISOString() }
  })

  // ── PUT /api/admin/me — Editar perfil do usuário logado ──
  app.put('/api/admin/me', { preHandler: authMiddleware }, async (req, reply) => {
    const { userId } = (req as any).user as JwtPayload
    const { name, email, password, currentPassword, signature } = req.body as any

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

    // Require current password for email or password changes
    if ((email && email.toLowerCase().trim() !== user.email) || password) {
      if (!currentPassword) return reply.code(400).send({ error: 'Senha atual é obrigatória para alterar email ou senha' })
      const valid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!valid) return reply.code(401).send({ error: 'Senha atual incorreta' })
    }

    const data: any = {}
    if (name !== undefined) data.name = name.trim()
    if (email && email.toLowerCase().trim() !== user.email) {
      const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
      if (exists) return reply.code(409).send({ error: 'Email já em uso por outro usuário' })
      data.email = email.toLowerCase().trim()
    }
    if (password) {
      const pwErr = validatePassword(password)
      if (pwErr) return reply.code(400).send({ error: pwErr })
      data.passwordHash = await bcrypt.hash(password, 12)
    }
    // Reforma F1.6: assinatura personalizada (anexada no fim das mensagens outbound)
    if (signature === null) data.signature = null
    else if (typeof signature === 'string') data.signature = signature.trim().slice(0, 255) || null

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nenhuma alteração enviada' })

    const updated = await prisma.user.update({ where: { id: userId }, data })
    const updatedUser = { id: updated.id, email: updated.email, name: updated.name, role: updated.role }
    return updatedUser
  })

  // ── GET /api/admin/users — Listar todos os usuários ──
  app.get('/api/admin/users', { preHandler: adminOnly }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, role: true, active: true,
        lastLoginAt: true, lastSeenAt: true, createdAt: true,
        workStatus: true, workStatusUpdatedAt: true, capacity: true, notifyWhatsapp: true,
      }
    })
    return { users }
  })

  // ── POST /api/admin/users — Criar usuário (admin only) ──
  app.post('/api/admin/users', { preHandler: adminOnly }, async (req, reply) => {
    const { email, name, password, role } = req.body as any
    if (!email || !name || !password) {
      return reply.code(400).send({ error: 'Email, nome e senha são obrigatórios' })
    }
    const pwErr2 = validatePassword(password)
    if (pwErr2) return reply.code(400).send({ error: pwErr2 })

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
    if (exists) {
      return reply.code(409).send({ error: 'Já existe um usuário com este email' })
    }

    // Somente SUPERADMIN pode criar outro SUPERADMIN
    const requester = (req as any).user as JwtPayload
    if (role === 'SUPERADMIN' && requester.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas um Super Admin pode criar outro Super Admin' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        role: role || 'VIEWER'
      }
    })

    // Audit: user created
    const cAct = auditActor(req)
    void logUserAudit({
      action: 'user.created',
      targetUserId: user.id,
      targetType: 'user',
      targetLabel: `${user.name} (${user.email})`,
      changes: { role: user.role, email: user.email, name: user.name },
      ...cAct,
    })

    return { id: user.id, email: user.email, name: user.name, role: user.role, active: user.active, createdAt: user.createdAt }
  })

  // ── PUT /api/admin/users/:id — Editar usuário ──
  app.put('/api/admin/users/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { email, name, role, active, password, capacity, notifyWhatsapp } = req.body as any

    const user = await prisma.user.findUnique({ where: { id: Number(id) } })
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

    // Check email uniqueness if changing
    if (email && email.toLowerCase().trim() !== user.email) {
      const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
      if (exists) return reply.code(409).send({ error: 'Email já em uso por outro usuário' })
    }

    const requester = (req as any).user as JwtPayload

    // Somente SUPERADMIN pode promover/rebaixar SUPERADMIN
    if (role !== undefined && role === 'SUPERADMIN' && requester.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas um Super Admin pode promover a Super Admin' })
    }
    if (user.role === 'SUPERADMIN' && requester.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas um Super Admin pode editar outro Super Admin' })
    }

    const data: any = {}
    if (email !== undefined) data.email = email.toLowerCase().trim()
    if (name !== undefined) data.name = name.trim()
    if (role !== undefined) data.role = role
    if (active !== undefined) data.active = active
    if (password) {
      const pwErrUpdate = validatePassword(password)
      if (pwErrUpdate) return reply.code(400).send({ error: pwErrUpdate })
      data.passwordHash = await bcrypt.hash(password, 12)
    }
    if (capacity !== undefined) {
      const c = Number(capacity)
      if (!Number.isFinite(c) || c < 1 || c > 200) {
        return reply.code(400).send({ error: 'Capacidade deve ser um inteiro entre 1 e 200' })
      }
      data.capacity = Math.floor(c)
    }
    if (notifyWhatsapp !== undefined) data.notifyWhatsapp = notifyWhatsapp ? String(notifyWhatsapp).replace(/\D/g, '').slice(0, 30) || null : null

    const updated = await prisma.user.update({ where: { id: Number(id) }, data })

    // Audit: user edited — log only fields that actually changed
    const changes: Record<string, { from: any; to: any }> = {}
    if (email !== undefined && email.toLowerCase().trim() !== user.email) changes.email = { from: user.email, to: updated.email }
    if (name !== undefined && name.trim() !== user.name) changes.name = { from: user.name, to: updated.name }
    if (role !== undefined && role !== user.role) changes.role = { from: user.role, to: updated.role }
    if (active !== undefined && active !== user.active) changes.active = { from: user.active, to: updated.active }
    if (password && password.length >= 6) changes.password = { from: '***', to: '***' }
    if (capacity !== undefined && updated.capacity !== user.capacity) changes.capacity = { from: user.capacity, to: updated.capacity }

    if (Object.keys(changes).length > 0) {
      void logUserAudit({
        action: 'user.edited',
        targetUserId: Number(id),
        targetType: 'user',
        targetLabel: `${updated.name} (${updated.email})`,
        changes,
        ...auditActor(req),
      })
    }

    return { id: updated.id, email: updated.email, name: updated.name, role: updated.role, active: updated.active }
  })

  // ── DELETE /api/admin/users/:id — Remover usuário (move para lixeira) ──
  app.delete('/api/admin/users/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const requester = (req as any).user as JwtPayload

    if (requester.userId === Number(id)) {
      return reply.code(400).send({ error: 'Você não pode excluir sua própria conta' })
    }

    // Somente SUPERADMIN pode excluir outro SUPERADMIN
    const target = await prisma.user.findUnique({ where: { id: Number(id) } })
    if (!target) return reply.code(404).send({ error: 'Usuário não encontrado' })
    if (target.role === 'SUPERADMIN' && requester.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas um Super Admin pode excluir outro Super Admin' })
    }

    const snapshot = await snapshotEntity('user', Number(id))
    if (snapshot) {
      await moveToTrash({
        entityType: 'user',
        entityId: Number(id),
        entityLabel: `${(snapshot as any).name} (${(snapshot as any).email})`,
        snapshot,
        deletedBy: requester.userId,
        deletedByName: requester.name || requester.email,
      })
    }

    await prisma.user.delete({ where: { id: Number(id) } })

    // Audit: targetUserId NULL de propósito — o cascade (FK userId) apagaria a
    // própria entrada se apontasse para o usuário recém-excluído. Fica no
    // histórico do ATOR, com o alvo descrito em targetLabel.
    void logUserAudit({
      action: 'user.deleted',
      targetUserId: null,
      targetType: 'user',
      targetLabel: `${target.name} (${target.email})`,
      changes: { role: target.role, email: target.email },
      ...auditActor(req),
    })

    return { ok: true }
  })

  // ── GET /api/admin/users/:id/audit — Histórico de alterações do usuário ──
  app.get('/api/admin/users/:id/audit', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const user = await prisma.user.findUnique({ where: { id: Number(id) } })
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' })

    // Mostra TUDO relacionado ao usuário: o que ELE fez (actorId) e o que
    // fizeram COM ele (userId). Assim o histórico vira trilho de auditoria.
    const audits = await prisma.userAudit.findMany({
      where: { OR: [{ userId: Number(id) }, { actorId: Number(id) }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        action: true,
        actorName: true,
        actorId: true,
        userId: true,
        targetType: true,
        targetLabel: true,
        changes: true,
        ipAddress: true,
        createdAt: true,
      }
    })

    // viewerIsActor: a entrada representa algo que ESTE usuário fez (vs. sofreu).
    const data = audits.map((a) => ({ ...a, viewerIsActor: a.actorId === Number(id) }))
    return { data }
  })

  // ── POST /api/admin/forgot-password — Solicitar redefinição de senha ──
  app.post('/api/admin/forgot-password', async (req, reply) => {
    const startTime = Date.now()
    const { email } = req.body as any
    if (!email || typeof email !== 'string') {
      return reply.code(400).send({ error: 'Email é obrigatório' })
    }

    // Rate limit por IP e por email (anti enumeration + anti spam)
    if (await checkForgotRateLimit(req.ip) || await checkForgotRateLimit(email.toLowerCase().trim())) {
      await minDelay(startTime, 800)
      return reply.code(429).send({ error: 'Muitas tentativas. Tente em 15 minutos.' })
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })

    // Sempre retorna sucesso para não expor se o email existe (+ timing constante)
    if (!user || !user.active) {
      await minDelay(startTime, 800)
      return { ok: true }
    }

    // Invalida tokens anteriores do mesmo usuário
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true }
    })

    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutos

    await prisma.passwordReset.create({
      data: { userId: user.id, token: tokenHash, expiresAt }
    })

    const appUrl = process.env.APP_URL || 'https://bychat.ia.br'
    const resetLink = `${appUrl}/app/reset-password?token=${token}`

    try {
      await sendPasswordResetEmail(user.email, user.name, resetLink)
    } catch (e) {
      console.error('Erro ao enviar email de redefinição:', e)
      await minDelay(startTime, 800)
      return reply.code(500).send({ error: 'Erro ao enviar email' })
    }

    await minDelay(startTime, 800)
    return { ok: true }
  })

  // ── POST /api/admin/reset-password — Redefinir senha com token ──
  app.post('/api/admin/reset-password', async (req, reply) => {
    const { token, password } = req.body as any
    if (!token || !password) {
      return reply.code(400).send({ error: 'Token e nova senha são obrigatórios' })
    }
    const pwErr3 = validatePassword(password)
    if (pwErr3) return reply.code(400).send({ error: pwErr3 })

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const reset = await prisma.passwordReset.findUnique({ where: { token: tokenHash } })
    if (!reset || reset.used || reset.expiresAt < new Date()) {
      return reply.code(400).send({ error: 'Link inválido ou expirado. Solicite um novo.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.$transaction([
      prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      prisma.passwordReset.update({ where: { id: reset.id }, data: { used: true } })
    ])

    void logUserAudit({
      action: 'auth.password_reset',
      actorId: reset.userId,
      targetUserId: reset.userId,
      targetType: 'auth',
      ipAddress: req.ip,
    })

    return { ok: true }
  })

  // ── GET /api/admin/my-permissions — Permissões do usuário logado ──
  app.get('/api/admin/my-permissions', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const permissions = await resolvePermissions(user.userId, user.role)
    // Filtra módulos inativos: frontend não precisa saber que existem
    // (resolvePermissions já omite eles em `permissions`; aqui alinhamos
    // `modules[]`). SUPERADMIN recebe TODOS pra poder reativar via UI.
    const activeIds = await getActiveModuleIds()
    const modulesSource = user.role === 'SUPERADMIN'
      ? MODULE_REGISTRY
      : MODULE_REGISTRY.filter((m) => activeIds.has(m.id))
    const modules = modulesSource.map((m) => ({
      id: m.id, name: m.name, icon: m.icon, category: m.category, pages: m.pages,
      active: activeIds.has(m.id),
    }))
    return { permissions, modules }
  })

  // ── GET /api/admin/module-permissions — Todas as permissões por role ──
  app.get('/api/admin/module-permissions', { preHandler: adminOnly }, async () => {
    const all = await prisma.modulePermission.findMany({ orderBy: [{ moduleId: 'asc' }, { role: 'asc' }] })
    return { permissions: all, modules: MODULE_REGISTRY.map(m => ({ id: m.id, name: m.name, icon: m.icon, category: m.category })) }
  })

  // ── PUT /api/admin/module-permissions — Atualizar permissões por role (batch) ──
  app.put('/api/admin/module-permissions', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    if (user.role !== 'SUPERADMIN') {
      return reply.code(403).send({ error: 'Apenas SUPERADMIN pode alterar permissões de módulos' })
    }
    const { permissions } = req.body as { permissions: { moduleId: string; role: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }[] }
    if (!Array.isArray(permissions)) return reply.code(400).send({ error: 'permissions deve ser um array' })

    for (const p of permissions) {
      await prisma.modulePermission.upsert({
        where: { moduleId_role: { moduleId: p.moduleId, role: p.role as any } },
        create: { moduleId: p.moduleId, role: p.role as any, canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete },
        update: { canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete },
      })
    }
    invalidatePermCache()
    // Reforma F4: notifica frontend de TODOS os usuários conectados (mudança
    // em ModulePermission afeta defaults por role). Sem scope = global.
    broadcastRealtimeEvent({ type: 'permissions:invalidated', payload: { reason: 'role_permissions_changed' } })

    void logUserAudit({
      action: 'permission.role_changed',
      targetType: 'module_permission',
      targetLabel: `${permissions.length} permissão(ões) por perfil`,
      changes: { roles: [...new Set(permissions.map((p) => p.role))], modules: [...new Set(permissions.map((p) => p.moduleId))] },
      ...auditActor(req),
    })

    return { ok: true, updated: permissions.length }
  })

  // ── GET /api/admin/user-module-overrides/:userId — Overrides de um usuário ──
  app.get('/api/admin/user-module-overrides/:userId', { preHandler: adminOnly }, async (req) => {
    const { userId } = req.params as { userId: string }
    const overrides = await prisma.userModuleOverride.findMany({ where: { userId: Number(userId) } })
    return { overrides }
  })

  // ── PUT /api/admin/user-module-overrides/:userId — Atualizar overrides de um usuário ──
  app.put('/api/admin/user-module-overrides/:userId', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    if (user.role !== 'SUPERADMIN' && user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Apenas SUPERADMIN ou ADMIN pode alterar overrides' })
    }
    const { userId } = req.params as { userId: string }
    const { overrides } = req.body as { overrides: { moduleId: string; canView: boolean | null; canCreate: boolean | null; canEdit: boolean | null; canDelete: boolean | null }[] }
    if (!Array.isArray(overrides)) return reply.code(400).send({ error: 'overrides deve ser um array' })

    const uid = Number(userId)
    for (const o of overrides) {
      // Se todos null, deletar override (herdar do role)
      if (o.canView === null && o.canCreate === null && o.canEdit === null && o.canDelete === null) {
        await prisma.userModuleOverride.deleteMany({ where: { userId: uid, moduleId: o.moduleId } })
      } else {
        await prisma.userModuleOverride.upsert({
          where: { userId_moduleId: { userId: uid, moduleId: o.moduleId } },
          create: { userId: uid, moduleId: o.moduleId, canView: o.canView, canCreate: o.canCreate, canEdit: o.canEdit, canDelete: o.canDelete },
          update: { canView: o.canView, canCreate: o.canCreate, canEdit: o.canEdit, canDelete: o.canDelete },
        })
      }
    }
    invalidatePermCache(uid)
    // Reforma F4: notifica apenas o usuário afetado (override é per-user).
    broadcastRealtimeEvent({
      type: 'permissions:invalidated',
      payload: { reason: 'user_override_changed' },
      scope: { userId: uid },
    })

    void logUserAudit({
      action: 'permission.user_override_changed',
      targetUserId: uid,
      targetType: 'module_permission',
      targetLabel: `Overrides de permissão (${overrides.length} módulo(s))`,
      changes: { modules: overrides.map((o) => o.moduleId) },
      ...auditActor(req),
    })

    return { ok: true }
  })
}
