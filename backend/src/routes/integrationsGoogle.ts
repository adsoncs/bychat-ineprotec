// src/routes/integrationsGoogle.ts
// Rotas user-level para o operador conectar SUA conta Google.
// Híbrido B: Calendar/Tasks/Gmail vão para o Google do operador,
// Drive/Sheets ficam na conexão da empresa (kind=COMPANY).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { getAuthUrl, isGoogleConfigured } from '../lib/google.js'
import { invalidateCalendarCache } from '../services/googleCalendarSync.js'

export async function integrationsGoogleRoutes(app: FastifyInstance) {

  // GET /api/integrations/google/me — Status da conexão do user atual
  app.get('/api/integrations/google/me', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const conn = await prisma.googleConnection.findFirst({
      where: { userId: user.userId, kind: 'OPERATOR' },
      select: { id: true, email: true, active: true, scopes: true, updatedAt: true },
    })
    const company = await prisma.googleConnection.findFirst({
      where: { kind: 'COMPANY', active: true },
      select: { email: true },
    })
    return {
      configured: await isGoogleConfigured(),
      connection: conn,
      companyFallback: company ? { email: company.email } : null,
    }
  })

  // GET /api/integrations/google/auth-url — Inicia OAuth do operador
  app.get('/api/integrations/google/auth-url', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    try {
      const url = await getAuthUrl(`user:${user.userId}`)
      return { url }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/integrations/google/disconnect — Desativa conexão do user atual
  app.post('/api/integrations/google/disconnect', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const conn = await prisma.googleConnection.findFirst({
      where: { userId: user.userId, kind: 'OPERATOR' },
    })
    if (!conn) return reply.code(404).send({ error: 'Sem conexão Google ativa' })

    // Desativa integrações dependentes (mantém para histórico, marca inativas)
    await prisma.googleCalendarIntegration.updateMany({
      where: { connectionId: conn.id }, data: { active: false },
    })
    await prisma.googleTasksConfig.updateMany({
      where: { connectionId: conn.id }, data: { active: false },
    })
    await prisma.gmailConfig.updateMany({
      where: { connectionId: conn.id }, data: { active: false },
    })
    await prisma.googleConnection.update({
      where: { id: conn.id }, data: { active: false },
    })
    invalidateCalendarCache()
    return { ok: true }
  })
}

// ── Auto-provisionar integrações de operador ──────────────
// Chamado pelo callback OAuth quando state=user:<id>.
// Cria default Calendar (primary) + Tasks (@default) + Gmail (sender = nome do user)
export async function provisionOperatorIntegrations(connectionId: number, userId: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  })

  // Calendar — primary do operador, com Meet automático para reuniões
  const hasCalendar = await prisma.googleCalendarIntegration.findFirst({
    where: { connectionId },
  })
  if (!hasCalendar) {
    await prisma.googleCalendarIntegration.create({
      data: {
        name: `Agenda de ${user?.name || user?.email || 'operador'}`,
        connectionId,
        calendarId: 'primary',
        activityTypes: ['meeting', 'call'] as any,
        autoMeetLink: true,
        notifyLead: false,
        createdBy: userId,
      },
    })
  }

  // Tasks — lista padrão do operador
  const hasTasks = await prisma.googleTasksConfig.findFirst({
    where: { connectionId },
  })
  if (!hasTasks) {
    await prisma.googleTasksConfig.create({
      data: {
        connectionId,
        taskListId: '@default',
        taskListTitle: 'Minhas tarefas',
        activityTypes: ['task', 'follow_up'] as any,
        createdBy: userId,
      },
    })
  }

  // Gmail — assinatura padrão com nome do operador
  const hasGmail = await prisma.gmailConfig.findFirst({
    where: { connectionId },
  })
  if (!hasGmail) {
    await prisma.gmailConfig.create({
      data: {
        connectionId,
        senderName: user?.name || '',
        signature: '',
        createdBy: userId,
      },
    })
  }
  invalidateCalendarCache()
}
