// src/routes/papeis.ts
//
// Configurações › Papéis e acessos — a tela do novo modelo de permissões
// (spec "Papéis e Permissões — especificação"; plano /root/planos/papeis-permissoes.md).
//
// Papéis (capacidades + alcance), pacotes por pessoa, atribuição, "Ver como",
// modo sombra e o liga/desliga do motor. Papel de sistema (Superadmin e
// Administrador) não se edita: é o que impede o cliente de se trancar para fora.
// Trocar o papel de alguém também alinha `users.role` ao papelBase — as
// checagens cravadas no código leem o role até a fase 4.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { invalidatePermCache, invalidarMotorCache, resolvePermissions, motorDePapeisLigado, getActiveModuleIds } from '../lib/permissions.js'
import { invalidarAcessoPortais, alcanceDePortais, whereInscricoes } from '../lib/portalAccess.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'
import { catalogo } from '../lib/capacidades.js'
import { EDU_TELAS } from '../lib/eduTelas.js'
import { MODULE_REGISTRY } from '../lib/moduleRegistry.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const BASE = '/api/admin/papeis'
const guard = { preHandler: [authMiddleware, adminOnly] }
const TIPOS = ['LEADS', 'AGENDA', 'INSCRICOES', 'FINANCEIRO', 'VISOES'] as const
const NIVEIS = ['MEUS', 'EQUIPE', 'LIDERADAS', 'RECORTES', 'TUDO'] as const
const ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const

function limpar() { invalidatePermCache(); invalidarAcessoPortais() }

// `jaTinha`: o que o papel/pacote já guarda. O espelho do modelo antigo traz
// ações que a tela não lista (ex.: alerts.create, que a ModulePermission
// gravava mesmo sem o módulo ter "Criar"); sem aceitá-las de volta, qualquer
// edição de um papel clonado era recusada — e descartá-las mudaria o acesso.
async function capacidadesValidas(lista: unknown, jaTinha: Iterable<string> = []): Promise<string[] | string> {
  if (!Array.isArray(lista)) return 'capacidades deve ser uma lista'
  const ids = new Set([...catalogo().map((c) => c.id), ...jaTinha])
  const out = [...new Set(lista.map(String))]
  const ruins = out.filter((c) => !ids.has(c))
  return ruins.length ? `capacidade(s) inexistente(s): ${ruins.slice(0, 5).join(', ')}` : out
}

export async function papeisRoutes(app: FastifyInstance) {
  // Catálogo: capacidades dos módulos ativos, agrupadas, e as opções de alcance.
  app.get(`${BASE}/catalogo`, guard, async () => {
    const ativos = await getActiveModuleIds()
    const telaPai = new Map(EDU_TELAS.map((t) => [t.id, t.parent]))
    const nomeMod = new Map(MODULE_REGISTRY.map((m) => [m.id, m.name]))
    const ativo = (modulo: string) => ativos.has(telaPai.get(modulo) ?? modulo)
    const caps = catalogo().filter((c) => ativo(c.modulo))
    const recursos = new Map<string, { recurso: string; nome: string; area: string; acoes: string[] }>()
    for (const c of caps.filter((x) => x.tipo === 'basica')) {
      const rec = c.id.slice(0, c.id.lastIndexOf('.'))
      const r = recursos.get(rec) ?? { recurso: rec, nome: EDU_TELAS.find((t) => t.id === rec)?.name ?? nomeMod.get(rec) ?? rec, area: c.area, acoes: [] }
      r.acoes.push(c.acao!)
      recursos.set(rec, r)
    }
    return {
      recursos: [...recursos.values()],
      nomeadas: caps.filter((c) => c.tipo === 'nomeada').map((c) => ({ id: c.id, nome: c.nome, separavel: !!c.separavel })),
      tipos: TIPOS, niveis: NIVEIS,
    }
  })

  app.get(BASE, guard, async () => {
    const papeis = await prisma.papel.findMany({
      orderBy: [{ sistema: 'desc' }, { nome: 'asc' }],
      include: { alcances: true, _count: { select: { capacidades: true, usuarios: true } } },
    })
    return {
      motorLigado: await motorDePapeisLigado(),
      papeis: papeis.map((p) => ({
        id: p.id, nome: p.nome, descricao: p.descricao, sistema: p.sistema, papelBase: p.papelBase, origem: p.origem, arquivado: p.arquivado,
        capacidades: p._count.capacidades, pessoas: p._count.usuarios,
        alcances: Object.fromEntries(p.alcances.map((a) => [a.tipo, a.alcance])),
      })),
    }
  })

  app.get(`${BASE}/:id`, guard, async (req, reply) => {
    const id = Number((req.params as any).id)
    const p = await prisma.papel.findUnique({
      where: { id },
      include: { capacidades: true, alcances: true, usuarios: { select: { id: true, name: true, email: true, active: true }, orderBy: { name: 'asc' } } },
    })
    if (!p) return reply.code(404).send({ error: 'Papel não encontrado' })
    return {
      ...p,
      capacidades: p.capacidades.map((c) => ({ capacidade: c.capacidade, separacao: c.separacao })),
      alcances: Object.fromEntries(p.alcances.map((a) => [a.tipo, a.alcance])),
    }
  })

  app.post(BASE, guard, async (req, reply) => {
    const b = (req.body ?? {}) as { nome?: string; descricao?: string; clonarDe?: number; papelBase?: string }
    const nome = String(b.nome ?? '').trim()
    if (nome.length < 2) return reply.code(400).send({ error: 'Dê um nome ao papel.' })
    if (await prisma.papel.findUnique({ where: { nome } })) return reply.code(409).send({ error: 'Já existe um papel com esse nome.' })
    const origem = b.clonarDe ? await prisma.papel.findUnique({ where: { id: Number(b.clonarDe) }, include: { capacidades: true, alcances: true } }) : null
    if (b.clonarDe && !origem) return reply.code(404).send({ error: 'Papel de origem não encontrado' })
    const papelBase = String(b.papelBase ?? origem?.papelBase ?? 'AGENT')
    if (!(ROLES as readonly string[]).includes(papelBase)) return reply.code(400).send({ error: 'papelBase inválido' })
    const p = await prisma.papel.create({
      data: {
        nome, descricao: b.descricao?.slice(0, 255) ?? null, papelBase, origem: origem ? `clone:${origem.id}` : 'manual',
        criadoPor: ((req as any).user as JwtPayload).userId,
        capacidades: { create: (origem?.capacidades ?? []).map((c) => ({ capacidade: c.capacidade, separacao: c.separacao })) },
        alcances: { create: (origem?.alcances ?? TIPOS.map((tipo) => ({ tipo, alcance: 'MEUS' as const }))).map((a: any) => ({ tipo: a.tipo, alcance: a.alcance })) },
      },
    })
    void logUserAudit({ action: 'papel.criado', targetType: 'papel', targetLabel: `#${p.id} ${p.nome}`, changes: { clonarDe: origem?.id ?? null }, ...auditActor(req) })
    return { ok: true, id: p.id }
  })

  app.put(`${BASE}/:id`, guard, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body ?? {}) as { nome?: string; descricao?: string; papelBase?: string; capacidades?: string[]; separacao?: string[]; alcances?: Record<string, string> }
    const p = await prisma.papel.findUnique({ where: { id }, include: { capacidades: true, alcances: true, _count: { select: { usuarios: true } } } })
    if (!p) return reply.code(404).send({ error: 'Papel não encontrado' })
    if (p.sistema) return reply.code(403).send({ error: 'Papel do sistema não se edita — clone-o para criar um papel novo.' })
    const data: any = {}
    if (b.nome !== undefined) {
      const nome = String(b.nome).trim()
      if (nome.length < 2) return reply.code(400).send({ error: 'Nome muito curto.' })
      const outro = await prisma.papel.findUnique({ where: { nome } })
      if (outro && outro.id !== id) return reply.code(409).send({ error: 'Já existe um papel com esse nome.' })
      data.nome = nome
    }
    if (b.descricao !== undefined) data.descricao = String(b.descricao).slice(0, 255) || null
    if (b.papelBase !== undefined) {
      if (!(ROLES as readonly string[]).includes(b.papelBase)) return reply.code(400).send({ error: 'papelBase inválido' })
      data.papelBase = b.papelBase
    }
    let caps: string[] | null = null
    if (b.capacidades !== undefined) {
      const v = await capacidadesValidas(b.capacidades, p.capacidades.map((c) => c.capacidade))
      if (typeof v === 'string') return reply.code(400).send({ error: v })
      caps = v
    }
    const separacao = new Set((b.separacao ?? []).map(String))
    let alc: Array<{ tipo: any; alcance: any }> | null = null
    if (b.alcances !== undefined) {
      alc = []
      for (const [tipo, alcance] of Object.entries(b.alcances)) {
        if (!(TIPOS as readonly string[]).includes(tipo) || !(NIVEIS as readonly string[]).includes(alcance)) return reply.code(400).send({ error: `alcance inválido: ${tipo}=${alcance}` })
        alc.push({ tipo, alcance })
      }
    }
    await prisma.$transaction([
      prisma.papel.update({ where: { id }, data }),
      ...(caps ? [prisma.papelCapacidade.deleteMany({ where: { papelId: id } }), prisma.papelCapacidade.createMany({ data: caps.map((capacidade) => ({ papelId: id, capacidade, separacao: separacao.has(capacidade) })) })] : []),
      ...(alc ? [prisma.papelAlcance.deleteMany({ where: { papelId: id } }), prisma.papelAlcance.createMany({ data: alc.map((a) => ({ papelId: id, ...a })) })] : []),
      ...(data.papelBase ? [prisma.user.updateMany({ where: { papelId: id }, data: { role: data.papelBase } })] : []),
    ])
    limpar()
    const antes = new Set(p.capacidades.map((c) => c.capacidade))
    void logUserAudit({
      action: 'papel.alterado', targetType: 'papel', targetLabel: `#${id} ${data.nome ?? p.nome}`,
      changes: {
        ...(caps ? { capacidadesAdicionadas: caps.filter((c) => !antes.has(c)), capacidadesRemovidas: [...antes].filter((c) => !caps!.includes(c)) } : {}),
        ...(alc ? { alcances: { from: Object.fromEntries(p.alcances.map((a) => [a.tipo, a.alcance])), to: Object.fromEntries(alc.map((a) => [a.tipo, a.alcance])) } } : {}),
        ...(data.papelBase ? { papelBase: { from: p.papelBase, to: data.papelBase } } : {}),
      },
      ...auditActor(req),
    })
    return { ok: true, pessoasAfetadas: p._count.usuarios }
  })

  app.post(`${BASE}/:id/arquivar`, guard, async (req, reply) => {
    const id = Number((req.params as any).id)
    const p = await prisma.papel.findUnique({ where: { id }, include: { _count: { select: { usuarios: true } } } })
    if (!p) return reply.code(404).send({ error: 'Papel não encontrado' })
    if (p.sistema) return reply.code(403).send({ error: 'Papel do sistema não se arquiva.' })
    if (p._count.usuarios) return reply.code(409).send({ error: `${p._count.usuarios} pessoa(s) ainda têm este papel — troque o papel delas antes.` })
    await prisma.papel.update({ where: { id }, data: { arquivado: !p.arquivado } })
    void logUserAudit({ action: p.arquivado ? 'papel.reativado' : 'papel.arquivado', targetType: 'papel', targetLabel: `#${id} ${p.nome}`, ...auditActor(req) })
    return { ok: true, arquivado: !p.arquivado }
  })

  // Pessoas: papel e pacotes de cada uma.
  app.get(`${BASE}/pessoas`, guard, async () => {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true, active: true, papelId: true, pacotes: { select: { pacoteId: true } } },
    })
    return { pessoas: users.map((u) => ({ ...u, pacotes: u.pacotes.map((p) => p.pacoteId) })) }
  })

  app.put(`${BASE}/pessoas/:userId`, guard, async (req, reply) => {
    const userId = Number((req.params as any).userId)
    const ator = (req as any).user as JwtPayload
    const b = (req.body ?? {}) as { papelId?: number; pacotes?: number[] }
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, papelId: true } })
    if (!u) return reply.code(404).send({ error: 'Pessoa não encontrada' })
    const data: any = {}
    if (b.papelId !== undefined) {
      const p = await prisma.papel.findUnique({ where: { id: Number(b.papelId) } })
      if (!p || p.arquivado) return reply.code(404).send({ error: 'Papel não encontrado' })
      // Superadmin só é dado (ou tirado) por Superadmin.
      if ((p.papelBase === 'SUPERADMIN' || u.role === 'SUPERADMIN') && ator.role !== 'SUPERADMIN') return reply.code(403).send({ error: 'Só um Superadmin altera o papel Superadmin.' })
      data.papelId = p.id
      data.role = p.papelBase
    }
    await prisma.$transaction([
      ...(Object.keys(data).length ? [prisma.user.update({ where: { id: userId }, data })] : []),
      ...(b.pacotes ? [prisma.usuarioPacote.deleteMany({ where: { userId } }), prisma.usuarioPacote.createMany({ data: [...new Set(b.pacotes.map(Number))].map((pacoteId) => ({ userId, pacoteId })) })] : []),
    ])
    limpar()
    void logUserAudit({ action: 'pessoa.papel_alterado', targetType: 'user', targetUserId: userId, targetLabel: u.name, changes: { papelId: { from: u.papelId, to: data.papelId ?? u.papelId }, ...(b.pacotes ? { pacotes: b.pacotes } : {}) }, ...auditActor(req) })
    return { ok: true }
  })

  // Pacotes
  app.get(`${BASE}/pacotes`, guard, async () => {
    const ps = await prisma.pacote.findMany({ orderBy: { nome: 'asc' }, include: { capacidades: true, _count: { select: { usuarios: true } } } })
    return { pacotes: ps.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, origem: p.origem, capacidades: p.capacidades.map((c) => c.capacidade), pessoas: p._count.usuarios })) }
  })
  app.post(`${BASE}/pacotes`, guard, async (req, reply) => {
    const b = (req.body ?? {}) as { nome?: string; descricao?: string; capacidades?: string[] }
    const nome = String(b.nome ?? '').trim()
    if (nome.length < 2) return reply.code(400).send({ error: 'Dê um nome ao pacote.' })
    const v = await capacidadesValidas(b.capacidades ?? [])
    if (typeof v === 'string') return reply.code(400).send({ error: v })
    if (await prisma.pacote.findUnique({ where: { nome } })) return reply.code(409).send({ error: 'Já existe um pacote com esse nome.' })
    const p = await prisma.pacote.create({ data: { nome, descricao: b.descricao ?? null, origem: 'manual', capacidades: { create: v.map((capacidade) => ({ capacidade })) } } })
    void logUserAudit({ action: 'pacote.criado', targetType: 'pacote', targetLabel: `#${p.id} ${p.nome}`, changes: { capacidades: v }, ...auditActor(req) })
    return { ok: true, id: p.id }
  })
  app.put(`${BASE}/pacotes/:id`, guard, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body ?? {}) as { nome?: string; descricao?: string; capacidades?: string[] }
    const p = await prisma.pacote.findUnique({ where: { id }, include: { capacidades: true } })
    if (!p) return reply.code(404).send({ error: 'Pacote não encontrado' })
    const v = b.capacidades !== undefined ? await capacidadesValidas(b.capacidades, p.capacidades.map((c) => c.capacidade)) : null
    if (typeof v === 'string') return reply.code(400).send({ error: v })
    await prisma.$transaction([
      prisma.pacote.update({ where: { id }, data: { ...(b.nome ? { nome: b.nome.trim() } : {}), ...(b.descricao !== undefined ? { descricao: b.descricao || null } : {}) } }),
      ...(v ? [prisma.pacoteCapacidade.deleteMany({ where: { pacoteId: id } }), prisma.pacoteCapacidade.createMany({ data: v.map((capacidade) => ({ pacoteId: id, capacidade })) })] : []),
    ])
    limpar()
    void logUserAudit({ action: 'pacote.alterado', targetType: 'pacote', targetLabel: `#${id} ${p.nome}`, changes: { ...(v ? { capacidades: v } : {}) }, ...auditActor(req) })
    return { ok: true }
  })
  app.delete(`${BASE}/pacotes/:id`, guard, async (req, reply) => {
    const id = Number((req.params as any).id)
    const p = await prisma.pacote.findUnique({ where: { id } })
    if (!p) return reply.code(404).send({ error: 'Pacote não encontrado' })
    await prisma.pacote.delete({ where: { id } })
    limpar()
    void logUserAudit({ action: 'pacote.excluido', targetType: 'pacote', targetLabel: `#${id} ${p.nome}`, ...auditActor(req) })
    return { ok: true }
  })

  // Ver como: o que a pessoa enxerga pelo motor novo.
  app.get(`${BASE}/ver-como/:userId`, guard, async (req, reply) => {
    const userId = Number((req.params as any).userId)
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, papel: { select: { id: true, nome: true } }, pacotes: { select: { pacote: { select: { nome: true } } } } } })
    if (!u) return reply.code(404).send({ error: 'Pessoa não encontrada' })
    const { resolverNovo } = await import('../services/papeisMotor.js')
    const novo = await resolverNovo(userId)
    // Sem papel a pessoa segue a regra antiga — mostra o que ela vê de fato, não "nada".
    const perms = novo?.perms ?? await resolvePermissions(userId, u.role)
    const modulos = Object.entries(perms).filter(([, p]) => p.canView).map(([k]) => k)
    const leadsW = await buildLeadAccessWhere(userId, u.role)
    const insW = whereInscricoes(await alcanceDePortais(userId, u.role))
    const [leads, inscricoes] = await Promise.all([
      prisma.lead.count({ where: leadsW }),
      prisma.enrollmentRegistration.count({ where: insW ?? {} }),
    ])
    return { pessoa: { id: u.id, nome: u.name, papelBase: u.role }, papel: u.papel, pacotes: u.pacotes.map((p) => p.pacote.nome), modulosVisiveis: modulos, leads, inscricoes, motorLigado: await motorDePapeisLigado() }
  })

  // Modo sombra e motor (Superadmin)
  app.get(`${BASE}/sombra`, guard, async () => {
    const { compararSombra } = await import('../services/papeisMotor.js')
    const r = await compararSombra()
    return { ...r, divergencias: r.divergencias.slice(0, 500), total: r.divergencias.length }
  })
  app.put(`${BASE}/motor`, guard, async (req, reply) => {
    const ator = (req as any).user as JwtPayload
    if (ator.role !== 'SUPERADMIN') return reply.code(403).send({ error: 'Só o Superadmin liga ou desliga o motor.' })
    const b = (req.body ?? {}) as { ligado?: boolean; forcar?: boolean }
    if (b.ligado && !b.forcar) {
      const { compararSombra } = await import('../services/papeisMotor.js')
      const s = await compararSombra()
      if (s.divergencias.length || s.semPapel) return reply.code(409).send({ error: `O modo sombra ainda aponta ${s.divergencias.length} divergência(s) e ${s.semPapel} pessoa(s) sem papel.`, sombra: { ...s, divergencias: s.divergencias.slice(0, 50) } })
    }
    const valor = b.ligado ? 'papeis' : 'legado'
    await prisma.setting.upsert({ where: { key: 'permissoes.motor' }, update: { value: valor as any }, create: { key: 'permissoes.motor', label: 'Motor de permissões', grp: 'seguranca', fieldType: 'text', value: valor as any } })
    invalidarMotorCache(); invalidarAcessoPortais()
    void logUserAudit({ action: b.ligado ? 'motor_papeis.ligado' : 'motor_papeis.desligado', targetType: 'setting', targetLabel: 'permissoes.motor', changes: { forcado: !!b.forcar }, ...auditActor(req) })
    return { ok: true, motorLigado: !!b.ligado }
  })
}
