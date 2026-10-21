// src/routes/portalAcesso.ts
//
// Educacional › Acesso por portal — a matriz equipes × portais que decide
// quem enxerga cada portal (polos e parceiros). A regra mora em
// lib/portalAccess.ts; aqui só se lê, grava e simula.
//
// GET  /api/admin/portal-acesso            matriz atual (portais, equipes, linhas)
// PUT  /api/admin/portal-acesso            grava a matriz inteira (transação)
// GET  /api/admin/portal-acesso/simular    "ver como": o que um usuário enxerga

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { guardTela } from '../lib/eduTelas.js'
import { alcanceDePortais, invalidarAcessoPortais, podeOperarPortal, podeVerPortal, whereInscricoes } from '../lib/portalAccess.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const BASE = '/api/admin/portal-acesso'

interface LinhaIn { portalId: number; teamId: number; nivel: 'VER' | 'OPERAR' }

export async function portalAcessoRoutes(app: FastifyInstance) {
  app.get(BASE, { preHandler: guardTela('admin') }, async () => {
    const [portais, equipes, linhas] = await Promise.all([
      prisma.enrollmentPortal.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, nome: true, active: true, teamId: true, _count: { select: { registrations: true } } },
      }),
      prisma.team.findMany({
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: {
          id: true, name: true, color: true, active: true, veTodosOsPortais: true,
          members: { select: { isLeader: true, user: { select: { id: true, name: true, role: true, active: true } } } },
        },
      }),
      prisma.portalAcessoEquipe.findMany({ select: { portalId: true, teamId: true, nivel: true } }),
    ])
    return {
      portais: portais.map((p) => ({ id: p.id, nome: p.nome, ativo: p.active, equipeDonaId: p.teamId, inscricoes: p._count.registrations })),
      equipes: equipes.map((t) => ({
        id: t.id, nome: t.name, cor: t.color, ativa: t.active, veTodosOsPortais: t.veTodosOsPortais,
        membros: t.members.filter((m) => m.user.active).map((m) => ({ id: m.user.id, nome: m.user.name, papel: m.user.role, lider: m.isLeader })),
      })),
      linhas,
    }
  })

  app.put(BASE, { preHandler: guardTela('admin') }, async (req, reply) => {
    const body = (req.body ?? {}) as { linhas?: LinhaIn[]; equipesVeTodos?: number[]; equipesDonas?: Record<string, number | null> }
    if (!Array.isArray(body.linhas) || !Array.isArray(body.equipesVeTodos)) {
      return reply.code(400).send({ error: 'Envie linhas e equipesVeTodos.' })
    }
    const [portais, equipes] = await Promise.all([
      prisma.enrollmentPortal.findMany({ select: { id: true, teamId: true } }),
      prisma.team.findMany({ select: { id: true, veTodosOsPortais: true } }),
    ])
    const portalIds = new Set(portais.map((p) => p.id))
    const teamIds = new Set(equipes.map((t) => t.id))

    // Valida tudo antes de gravar qualquer coisa: matriz meio gravada é pior que nenhuma.
    const vistas = new Set<string>()
    const linhas: LinhaIn[] = []
    for (const l of body.linhas) {
      const portalId = Number(l?.portalId), teamId = Number(l?.teamId)
      const nivel = l?.nivel === 'OPERAR' ? 'OPERAR' : l?.nivel === 'VER' ? 'VER' : null
      if (!portalIds.has(portalId)) return reply.code(400).send({ error: `Portal ${l?.portalId} não existe.` })
      if (!teamIds.has(teamId)) return reply.code(400).send({ error: `Equipe ${l?.teamId} não existe.` })
      if (!nivel) return reply.code(400).send({ error: 'Nível deve ser VER ou OPERAR.' })
      const k = `${portalId}:${teamId}`
      if (vistas.has(k)) return reply.code(400).send({ error: 'A mesma equipe aparece duas vezes no mesmo portal.' })
      vistas.add(k)
      linhas.push({ portalId, teamId, nivel })
    }
    const veTodos = [...new Set(body.equipesVeTodos.map(Number))]
    for (const id of veTodos) if (!teamIds.has(id)) return reply.code(400).send({ error: `Equipe ${id} não existe.` })
    const donas: Array<{ portalId: number; teamId: number | null }> = []
    for (const [k, v] of Object.entries(body.equipesDonas ?? {})) {
      const portalId = Number(k)
      const teamId = v == null ? null : Number(v)
      if (!portalIds.has(portalId)) return reply.code(400).send({ error: `Portal ${k} não existe.` })
      if (teamId != null && !teamIds.has(teamId)) return reply.code(400).send({ error: `Equipe ${v} não existe.` })
      donas.push({ portalId, teamId })
    }

    const antes = await prisma.portalAcessoEquipe.findMany({ select: { portalId: true, teamId: true, nivel: true } })
    await prisma.$transaction([
      prisma.portalAcessoEquipe.deleteMany({}),
      ...(linhas.length ? [prisma.portalAcessoEquipe.createMany({ data: linhas })] : []),
      prisma.team.updateMany({ where: { id: { notIn: veTodos.length ? veTodos : [-1] } }, data: { veTodosOsPortais: false } }),
      ...(veTodos.length ? [prisma.team.updateMany({ where: { id: { in: veTodos } }, data: { veTodosOsPortais: true } })] : []),
      ...donas.map((d) => prisma.enrollmentPortal.update({ where: { id: d.portalId }, data: { teamId: d.teamId } })),
    ])
    invalidarAcessoPortais()

    const chave = (l: LinhaIn) => `${l.portalId}:${l.teamId}:${l.nivel}`
    const a = new Set(antes.map(chave)), d = new Set(linhas.map(chave))
    void logUserAudit({
      action: 'portal_access.changed',
      targetType: 'portal_access',
      targetLabel: 'Acesso por portal',
      changes: {
        adicionadas: [...d].filter((x) => !a.has(x)),
        removidas: [...a].filter((x) => !d.has(x)),
        veTodosOsPortais: { from: equipes.filter((t) => t.veTodosOsPortais).map((t) => t.id), to: veTodos },
        equipesDonas: donas.filter((x) => portais.find((p) => p.id === x.portalId)?.teamId !== x.teamId),
      },
      ...auditActor(req),
    })
    return { ok: true, linhas: linhas.length }
  })

  app.get(`${BASE}/simular`, { preHandler: guardTela('admin') }, async (req, reply) => {
    const userId = Number((req.query as any)?.userId)
    const u = Number.isFinite(userId) ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, active: true } }) : null
    if (!u) return reply.code(404).send({ error: 'Usuário não encontrado' })
    const alc = await alcanceDePortais(u.id, u.role)
    const where = whereInscricoes(alc)
    const portais = await prisma.enrollmentPortal.findMany({ orderBy: { id: 'asc' }, select: { id: true, nome: true } })
    const visiveis = await Promise.all(portais.map(async (p) => {
      const ve = podeVerPortal(alc, p.id)
      const modo = alc.todos ? 'todos'
        : !alc.restritos.includes(p.id) ? 'aberto'
        : alc.lider.includes(p.id) ? 'lider'
        : alc.membro.includes(p.id) ? 'membro' : 'nenhum'
      const inscricoes = ve ? await prisma.enrollmentRegistration.count({ where: { AND: [{ portalId: p.id }, ...(where ? [where] : [])] } }) : 0
      return { id: p.id, nome: p.nome, ve, modo, opera: ve && podeOperarPortal(alc, p.id), inscricoes }
    }))
    return {
      usuario: { id: u.id, nome: u.name, papel: u.role, ativo: u.active },
      veTodos: alc.todos,
      motivo: alc.todos ? (u.role === 'SUPERADMIN' || u.role === 'ADMIN' ? 'papel' : 'equipe') : null,
      portais: visiveis,
    }
  })
}
