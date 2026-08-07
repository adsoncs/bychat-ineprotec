// src/routes/homeScreens.ts
// Tela Inicial — o que cada papel vê ao entrar no sistema.
//
// Uma tela é uma PILHA DE BLOCOS (aviso, KPIs, atalhos, meu dia, placar) que o
// admin monta em Configurações › Tela inicial e atribui a um papel, com exceção
// por usuário quando alguém precisa de algo diferente do cargo.
//
// Regra que atravessa o arquivo: escolher a tela NÃO libera dado. Os blocos são
// podados pela permissão de quem está olhando (atalho de módulo sem acesso some,
// KPI só aparece com canView em 'dashboard') e as métricas vêm com `scoped`,
// que faz o widget-data recortar por own/team/all.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { resolvePermissions } from '../lib/permissions.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'

const ROLES = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const
export const BLOCK_TYPES = ['notice', 'kpis', 'shortcuts', 'my_day', 'leaderboard'] as const
type BlockType = (typeof BLOCK_TYPES)[number]

type Block = { id: string; type: BlockType; config: any }

/** Aceita só bloco com tipo conhecido e config objeto — lixo no JSON vira tela quebrada. */
function sanitizeBlocks(input: any): Block[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((b) => b && typeof b === 'object' && (BLOCK_TYPES as readonly string[]).includes(b.type))
    .slice(0, 20)
    .map((b, i) => ({
      id: String(b.id || `b${i}`).substring(0, 40),
      type: b.type as BlockType,
      config: b.config && typeof b.config === 'object' ? b.config : {},
    }))
}

/**
 * Poda os blocos pelo que ESTE usuário pode ver. O atalho carrega o moduleId
 * escolhido no editor; sem canView, o cartão some em vez de virar um 403 na
 * cara de quem clicou. Bloco que fica sem conteúdo nenhum é descartado.
 */
async function pruneForUser(blocks: Block[], user: JwtPayload): Promise<Block[]> {
  const perms = user.role === 'SUPERADMIN' ? null : await resolvePermissions(user.userId, user.role)
  const canView = (moduleId?: string) => {
    if (!moduleId) return true
    if (!perms) return true // SUPERADMIN
    return perms[moduleId]?.canView === true
  }
  // O bloco de KPIs busca dados em POST /api/admin/widget-data, e o gate de
  // permissões deriva a ação do método HTTP → POST vira 'create'. Ou seja: quem
  // tem "ver" no Dashboard mas não "criar" (VIEWER, por padrão) leva 403 em cada
  // card. Melhor não entregar o bloco do que entregar uma fileira de "Sem
  // permissão" na cara de quem abriu o sistema.
  const canLoadKpis = () => !perms || (perms['dashboard']?.canView === true && perms['dashboard']?.canCreate === true)

  const out: Block[] = []
  for (const b of blocks) {
    if (b.type === 'shortcuts') {
      const items = (Array.isArray(b.config?.items) ? b.config.items : []).filter((i: any) => canView(i?.moduleId))
      if (items.length === 0) continue
      out.push({ ...b, config: { ...b.config, items } })
      continue
    }
    if (b.type === 'notice') {
      const links = (Array.isArray(b.config?.links) ? b.config.links : []).filter((l: any) => canView(l?.moduleId))
      out.push({ ...b, config: { ...b.config, links } })
      continue
    }
    if (b.type === 'kpis' && !canLoadKpis()) continue
    out.push(b)
  }
  return out
}

export async function homeScreensRoutes(app: FastifyInstance) {
  // ── Resolução da tela do usuário logado ───────────────────────────────
  // Precedência: exceção do usuário → regra do papel → nada (o frontend cai na
  // Visão Geral de fábrica, que é o comportamento de sempre).
  app.get('/api/home-screen/me', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const assignment =
      (await prisma.homeScreenAssignment.findFirst({
        where: { userId: user.userId, screen: { active: true } },
        include: { screen: true },
      })) ||
      (await prisma.homeScreenAssignment.findFirst({
        where: { role: user.role as any, screen: { active: true } },
        include: { screen: true },
      }))

    if (!assignment?.screen) return { screen: null }
    const originais = sanitizeBlocks(assignment.screen.blocks)
    const blocks = await pruneForUser(originais, user)
    return {
      screen: {
        id: assignment.screen.id,
        name: assignment.screen.name,
        description: assignment.screen.description,
        blocks,
      },
      // Quantos blocos a permissão removeu. Com a tela inteira podada, o
      // frontend precisa dizer "seu acesso não alcança nada aqui" em vez de
      // "tela sem blocos" — o admin configurou algo, só não para este papel.
      pruned: originais.length - blocks.length,
      // De onde veio a tela — o admin consegue explicar "por que estou vendo isto".
      source: assignment.userId ? 'user' : 'role',
    }
  })

  // ── Dados do bloco "Meu dia" ──────────────────────────────────────────
  // Sempre do próprio usuário: é a fila de trabalho dele, não um relatório.
  app.get('/api/home-screen/my-day', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as { staleHours?: string }
    const staleHours = Math.min(Math.max(Number(q.staleHours) || 24, 1), 720)

    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999)

    const [todayActivities, overdue, staleLeads] = await Promise.all([
      prisma.activity.findMany({
        where: { userId: user.userId, status: 'pending', scheduledAt: { gte: dayStart, lte: dayEnd } },
        select: { id: true, type: true, title: true, scheduledAt: true, leadId: true, lead: { select: { nome: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }),
      prisma.activity.count({
        where: { userId: user.userId, status: 'pending', scheduledAt: { lt: dayStart } },
      }),
      prisma.lead.count({
        where: {
          assignedUserId: user.userId,
          outcome: null,
          OR: [
            { lastMessageAt: { lt: new Date(now.getTime() - staleHours * 3600_000) } },
            { lastMessageAt: null },
          ],
        },
      }),
    ])

    const meetings = todayActivities.filter((a) => a.type === 'meeting')
    return {
      activities: todayActivities.map((a) => ({
        id: a.id, type: a.type, title: a.title, scheduledAt: a.scheduledAt,
        leadId: a.leadId, leadName: a.lead?.nome || null,
      })),
      counts: { today: todayActivities.length, meetings: meetings.length, overdue, staleLeads },
      staleHours,
    }
  })

  // ── Dados do bloco "Placar" ───────────────────────────────────────────
  // Ranking de negócios ganhos no período. O recorte respeita o scope de quem
  // olha: agente com scope 'own' vê só a própria linha, e é assim mesmo — o
  // placar não é atalho para ver a carteira dos colegas.
  app.get('/api/home-screen/leaderboard', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as { days?: string; limit?: string }
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365)
    const limit = Math.min(Math.max(Number(q.limit) || 5, 1), 20)
    const since = new Date(Date.now() - days * 86400_000)

    const access = await buildLeadAccessWhere(user.userId, user.role)
    const where: any = { outcome: 'won', outcomeAt: { gte: since } }
    if (Object.keys(access).length > 0) where.AND = [access]

    const rows = await prisma.lead.groupBy({
      by: ['assignedUserId'],
      where,
      _count: { _all: true },
      _sum: { saleValue: true },
    })
    const userIds = rows.map((r) => r.assignedUserId).filter((v): v is number => v != null)
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const nameById = new Map(users.map((u) => [u.id, u.name]))

    const entries = rows
      .filter((r) => r.assignedUserId != null)
      .map((r) => ({
        userId: r.assignedUserId as number,
        name: nameById.get(r.assignedUserId as number) || 'Sem nome',
        won: r._count._all,
        revenue: Number(r._sum.saleValue || 0),
        isMe: r.assignedUserId === user.userId,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.won - a.won)

    return { days, entries: entries.slice(0, limit), total: entries.length }
  })

  // ── Administração das telas ───────────────────────────────────────────
  app.get('/api/admin/home-screens', { preHandler: adminOnly }, async () => {
    const [screens, assignments, users] = await Promise.all([
      prisma.homeScreen.findMany({ orderBy: { id: 'asc' } }),
      prisma.homeScreenAssignment.findMany(),
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: 'asc' } }),
    ])
    return { screens, assignments, users, roles: ROLES }
  })

  app.post('/api/admin/home-screens', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { name?: string; description?: string; blocks?: any }
    const name = String(body.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório' })
    const screen = await prisma.homeScreen.create({
      data: {
        name: name.substring(0, 120),
        description: body.description ? String(body.description).substring(0, 255) : null,
        blocks: sanitizeBlocks(body.blocks) as any,
      },
    })
    return { screen }
  })

  app.put('/api/admin/home-screens/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const body = req.body as { name?: string; description?: string; blocks?: any; active?: boolean }
    const existing = await prisma.homeScreen.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Tela não encontrada' })
    const data: any = {}
    if (body.name !== undefined) data.name = String(body.name).trim().substring(0, 120) || existing.name
    if (body.description !== undefined) data.description = body.description ? String(body.description).substring(0, 255) : null
    if (body.blocks !== undefined) data.blocks = sanitizeBlocks(body.blocks) as any
    if (body.active !== undefined) data.active = !!body.active
    const screen = await prisma.homeScreen.update({ where: { id }, data })
    return { screen }
  })

  app.delete('/api/admin/home-screens/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const existing = await prisma.homeScreen.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Tela não encontrada' })
    if (existing.isSystem) return reply.code(400).send({ error: 'Tela de fábrica não pode ser removida' })
    // As atribuições caem junto (onDelete: Cascade) e quem apontava para ela
    // volta à Visão Geral — nunca fica com tela em branco.
    await prisma.homeScreen.delete({ where: { id } })
    return { ok: true }
  })

  // ── Atribuições ───────────────────────────────────────────────────────
  // Body: { roles: { AGENT: 3, MANAGER: null, ... }, users: [{ userId, screenId|null }] }
  // screenId null = remove a atribuição (volta para a regra do papel / Visão Geral).
  app.put('/api/admin/home-screens/assignments', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { roles?: Record<string, number | null>; users?: { userId: number; screenId: number | null }[] }

    const screenIds = new Set<number>()
    for (const v of Object.values(body.roles || {})) if (v) screenIds.add(Number(v))
    for (const u of body.users || []) if (u.screenId) screenIds.add(Number(u.screenId))
    if (screenIds.size > 0) {
      const found = await prisma.homeScreen.count({ where: { id: { in: [...screenIds] } } })
      if (found !== screenIds.size) return reply.code(400).send({ error: 'Tela inexistente na atribuição' })
    }

    for (const [role, screenId] of Object.entries(body.roles || {})) {
      if (!(ROLES as readonly string[]).includes(role)) continue
      if (screenId) {
        await prisma.homeScreenAssignment.upsert({
          where: { role: role as any },
          create: { role: role as any, screenId: Number(screenId) },
          update: { screenId: Number(screenId) },
        })
      } else {
        await prisma.homeScreenAssignment.deleteMany({ where: { role: role as any } })
      }
    }

    for (const u of body.users || []) {
      const userId = Number(u.userId)
      if (!userId) continue
      if (u.screenId) {
        await prisma.homeScreenAssignment.upsert({
          where: { userId },
          create: { userId, screenId: Number(u.screenId) },
          update: { screenId: Number(u.screenId) },
        })
      } else {
        await prisma.homeScreenAssignment.deleteMany({ where: { userId } })
      }
    }

    const assignments = await prisma.homeScreenAssignment.findMany()
    return { assignments }
  })

  // Pré-visualização: mostra a tela como um papel específico a veria, sem
  // precisar sair e entrar com outro usuário.
  app.get('/api/admin/home-screens/:id/preview', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const role = String((req.query as any).role || 'AGENT')
    const screen = await prisma.homeScreen.findUnique({ where: { id } })
    if (!screen) return reply.code(404).send({ error: 'Tela não encontrada' })
    const me = (req as any).user as JwtPayload
    const blocks = await pruneForUser(sanitizeBlocks(screen.blocks), { ...me, role })
    return { screen: { id: screen.id, name: screen.name, blocks }, role }
  })
}
