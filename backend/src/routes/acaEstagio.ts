// src/routes/acaEstagio.ts
// Módulo Acadêmico · O2.9 — Estágio supervisionado + Atividades complementares.
// Acumula horas por aluno e compara com a meta (config). Atividades passam por
// aprovação da secretaria; estágio tem status próprio.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const META_KEYS = ['aca.estagio.meta_horas', 'aca.atividades.meta_horas'] as const
const META_DEF: Record<string, number> = { 'aca.estagio.meta_horas': 300, 'aca.atividades.meta_horas': 120 }

export async function getMetasHoras() {
  const rows = await prisma.setting.findMany({ where: { key: { in: META_KEYS as unknown as string[] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); return r ? Number(r.value as any) : META_DEF[k] }
  return { estagioMeta: v('aca.estagio.meta_horas'), atividadesMeta: v('aca.atividades.meta_horas') }
}

/** Resumo de horas do aluno (estágio concluído + atividades aprovadas vs metas). */
export async function resumoHoras(alunoId: number) {
  const [estagios, atividades, metas] = await Promise.all([
    prisma.acaEstagio.findMany({ where: { alunoId } }),
    prisma.acaAtividadeComplementar.findMany({ where: { alunoId } }),
    getMetasHoras(),
  ])
  const estagioHoras = estagios.filter((e) => e.status === 'CONCLUIDO').reduce((s, e) => s + e.cargaHorariaH, 0)
  const atividadesHoras = atividades.filter((a) => a.status === 'APROVADA').reduce((s, a) => s + a.horas, 0)
  return {
    estagio: { horas: estagioHoras, meta: metas.estagioMeta, cumprido: estagioHoras >= metas.estagioMeta },
    atividades: { horas: atividadesHoras, meta: metas.atividadesMeta, cumprido: atividadesHoras >= metas.atividadesMeta, pendentes: atividades.filter((a) => a.status === 'PENDENTE').length },
  }
}

export async function acaEstagioRoutes(app: FastifyInstance) {
  // ── Config metas ──
  app.get('/api/admin/aca/estagio/metas', { preHandler: authMiddleware }, async () => getMetasHoras())
  app.put('/api/admin/aca/estagio/metas', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const map: Record<string, any> = { 'aca.estagio.meta_horas': b.estagioMeta, 'aca.atividades.meta_horas': b.atividadesMeta }
    for (const k of META_KEYS) { if (map[k] === undefined) continue; await prisma.setting.upsert({ where: { key: k }, update: { value: Math.max(0, Number(map[k]) || 0) as any }, create: { key: k, label: k, grp: 'academico', fieldType: 'number', value: Math.max(0, Number(map[k]) || 0) as any } }) }
    return getMetasHoras()
  })

  // ── Painel do aluno (estágios + atividades + resumo) ──
  app.get('/api/admin/aca/alunos/:id/estagio', { preHandler: authMiddleware }, async (req) => {
    const alunoId = Number((req.params as any).id)
    const [estagios, atividades, resumo] = await Promise.all([
      prisma.acaEstagio.findMany({ where: { alunoId }, orderBy: { createdAt: 'desc' } }),
      prisma.acaAtividadeComplementar.findMany({ where: { alunoId }, orderBy: { createdAt: 'desc' } }),
      resumoHoras(alunoId),
    ])
    return { estagios, atividades, resumo }
  })

  // ── Estágio CRUD ──
  app.post('/api/admin/aca/estagios', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.alunoId || !b.empresa) return reply.code(400).send({ error: 'alunoId e empresa são obrigatórios' })
    const estagio = await prisma.acaEstagio.create({ data: {
      alunoId: Number(b.alunoId), empresa: String(b.empresa).slice(0, 191), supervisor: b.supervisor || null,
      cargaHorariaH: Number(b.cargaHorariaH) || 0, dataInicio: b.dataInicio ? new Date(b.dataInicio) : null, dataFim: b.dataFim ? new Date(b.dataFim) : null,
      status: ['EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'].includes(b.status) ? b.status : 'EM_ANDAMENTO', descricao: b.descricao || null,
    } })
    return reply.code(201).send({ estagio })
  })
  app.put('/api/admin/aca/estagios/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('empresa' in b) data.empresa = String(b.empresa).slice(0, 191)
    if ('supervisor' in b) data.supervisor = b.supervisor || null
    if ('cargaHorariaH' in b) data.cargaHorariaH = Number(b.cargaHorariaH) || 0
    if ('status' in b && ['EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'].includes(b.status)) data.status = b.status
    if ('dataInicio' in b) data.dataInicio = b.dataInicio ? new Date(b.dataInicio) : null
    if ('dataFim' in b) data.dataFim = b.dataFim ? new Date(b.dataFim) : null
    if ('descricao' in b) data.descricao = b.descricao || null
    return { estagio: await prisma.acaEstagio.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/estagios/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaEstagio.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── Atividades complementares ──
  app.post('/api/admin/aca/atividades', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.alunoId || !b.titulo) return reply.code(400).send({ error: 'alunoId e titulo são obrigatórios' })
    const atividade = await prisma.acaAtividadeComplementar.create({ data: {
      alunoId: Number(b.alunoId), titulo: String(b.titulo).slice(0, 191), categoria: b.categoria || null, horas: Number(b.horas) || 0,
      data: b.data ? new Date(b.data) : null, comprovanteUrl: b.comprovanteUrl || null, status: b.status || 'PENDENTE',
    } })
    return reply.code(201).send({ atividade })
  })
  app.put('/api/admin/aca/atividades/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('status' in b && ['PENDENTE', 'APROVADA', 'REJEITADA'].includes(b.status)) data.status = b.status
    if ('horas' in b) data.horas = Number(b.horas) || 0
    if ('observacao' in b) data.observacao = b.observacao || null
    if ('titulo' in b) data.titulo = String(b.titulo).slice(0, 191)
    return { atividade: await prisma.acaAtividadeComplementar.update({ where: { id }, data }) }
  })
  app.delete('/api/admin/aca/atividades/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaAtividadeComplementar.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })
}
