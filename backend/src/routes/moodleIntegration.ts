// src/routes/moodleIntegration.ts
//
// Integração com o Moodle — Integrações › Moodle (config + de-para + lista) e
// o cartão "Moodle" na ficha da inscrição (ações do agente).
//
//   GET  /api/admin/moodle/config              POST /api/admin/moodle/config
//   POST /api/admin/moodle/testar              GET  /api/admin/moodle/cursos
//   GET  /api/admin/moodle/depara              PUT  /api/admin/moodle/depara
//   GET  /api/admin/moodle/acessos             POST /api/admin/moodle/varrer
//   GET  /api/admin/moodle/inscricao/:id       (estado + aptidão)
//   POST /api/admin/moodle/inscricao/:id/liberar | /suspender | /reativar | /curso
//   GET  /api/public/portal/area/ava/entrar?registro=  (Meu Portal → Moodle)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import * as moodle from '../lib/moodleClient.js'
import {
  aptidao, liberar, suspender, reativar, trocarCurso, varrer, estadoDaInscricao, quadroDepara, destinoDeEntrada,
} from '../services/moodleAcessos.js'
import { contaDaRequisicao } from '../lib/portalSession.js'

const guardAdmin = { preHandler: [authMiddleware, adminOnly] }
const guardAgente = { preHandler: [authMiddleware] }

async function salvar(key: string, value: string, label: string, fieldType = 'text') {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'moodle', fieldType },
    update: { value },
  })
}

function ator(req: any) {
  const u = req.user as { userId?: number; name?: string; email?: string } | undefined
  return { origem: 'manual' as const, userId: u?.userId ?? null, userName: u?.name || u?.email || null }
}

function erro(reply: any, e: any) {
  return reply.code(e instanceof moodle.MoodleError ? 502 : 400).send({ error: e?.message || String(e) })
}

export async function moodleIntegrationRoutes(app: FastifyInstance) {
  app.get('/api/admin/moodle/config', guardAdmin, async () => {
    const c = await moodle.getMoodleConfig(true)
    const grupos = await prisma.moodleAcesso.groupBy({ by: ['status'], _count: { _all: true } })
    const totais = Object.fromEntries(grupos.map((g) => [g.status, g._count._all]))
    const portais = await prisma.enrollmentPortal.findMany({ select: { id: true, nome: true, active: true }, orderBy: { id: 'asc' } })
    return {
      baseUrl: c.baseUrl, tokenConfigurado: !!c.token, senhaConfigurada: !!c.senha, // segredos nunca saem daqui
      enabled: c.enabled, sso: c.sso, papelId: c.papelId, portais: c.portais, desde: c.desde,
      todosPortais: portais, totais,
    }
  })

  app.post('/api/admin/moodle/config', guardAdmin, async (req, reply) => {
    const b = (req.body ?? {}) as any
    try {
      if (b.baseUrl !== undefined) {
        const url = String(b.baseUrl).trim().replace(/\/+$/, '')
        if (url && !/^https:\/\/[^\s/]+/i.test(url)) throw new Error('A URL do Moodle precisa começar com https://')
        await salvar(moodle.MOODLE_KEYS.baseUrl, url, 'URL do Moodle')
      }
      if (typeof b.token === 'string' && b.token.trim()) await salvar(moodle.MOODLE_KEYS.token, b.token.trim(), 'Token do Moodle', 'password')
      if (typeof b.senha === 'string' && b.senha.trim()) await salvar(moodle.MOODLE_KEYS.senha, b.senha.trim(), 'Senha inicial do aluno no Moodle', 'password')
      if (b.sso !== undefined) await salvar(moodle.MOODLE_KEYS.sso, b.sso ? 'true' : 'false', 'Entrar no Moodle já logado (auth_userkey)', 'boolean')
      if (b.papelId !== undefined) await salvar(moodle.MOODLE_KEYS.papelId, String(Number(b.papelId) || 5), 'Papel do aluno no Moodle', 'number')
      if (Array.isArray(b.portais)) await salvar(moodle.MOODLE_KEYS.portais, JSON.stringify(b.portais.map(Number).filter((n: number) => n > 0)), 'Portais ligados ao Moodle', 'json')
      if (b.enabled !== undefined) {
        const atual = await moodle.getMoodleConfig(true)
        await salvar(moodle.MOODLE_KEYS.enabled, b.enabled ? 'true' : 'false', 'Liberação automática no Moodle', 'boolean')
        // Ao ligar a 1ª vez, o automático só pega o que ficar apto DAQUI EM DIANTE.
        if (b.enabled && !atual.desde) await salvar(moodle.MOODLE_KEYS.desde, new Date().toISOString(), 'Liberação automática a partir de')
      }
      if (b.desde !== undefined) {
        const d = b.desde ? new Date(String(b.desde)) : null
        if (d && Number.isNaN(d.getTime())) throw new Error('Data inválida')
        await salvar(moodle.MOODLE_KEYS.desde, d ? d.toISOString() : '', 'Liberação automática a partir de')
      }
      moodle.resetMoodleCache()
      return { ok: true }
    } catch (e) { return erro(reply, e) }
  })

  app.post('/api/admin/moodle/testar', guardAdmin, async (_req, reply) => {
    try { moodle.resetMoodleCache(); return await moodle.testarConexao() } catch (e) { return erro(reply, e) }
  })

  app.get('/api/admin/moodle/cursos', guardAgente, async (req, reply) => {
    try { return { cursos: await moodle.listarCursos((req.query as any)?.atualizar === '1') } } catch (e) { return erro(reply, e) }
  })

  app.get('/api/admin/moodle/depara', guardAdmin, async (_req, reply) => {
    try { return { linhas: await quadroDepara() } } catch (e) { return erro(reply, e) }
  })

  // { itens: { "<portalId>:<offeringId>": courseId | null } } — mescla com o que existe.
  app.put('/api/admin/moodle/depara', guardAdmin, async (req, reply) => {
    try {
      const itens = ((req.body ?? {}) as any).itens ?? {}
      const atual = { ...(await moodle.getMoodleConfig(true)).depara }
      for (const [k, v] of Object.entries(itens)) {
        if (!/^\d+:\d+$/.test(k)) continue
        const n = Number(v)
        if (Number.isInteger(n) && n > 0) atual[k] = n
        else delete atual[k]
      }
      await salvar(moodle.MOODLE_KEYS.depara, JSON.stringify(atual), 'De-para oferta × curso do Moodle', 'json')
      moodle.resetMoodleCache()
      return { ok: true, total: Object.keys(atual).length }
    } catch (e) { return erro(reply, e) }
  })

  app.get('/api/admin/moodle/acessos', guardAdmin, async (req) => {
    const q = (req.query ?? {}) as any
    const status = q.status ? String(q.status) : undefined
    const lista = await prisma.moodleAcesso.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 200 })
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { id: { in: lista.map((a) => a.registrationId) } },
      select: { id: true, portalId: true, candidateCode: true, formData: true, lead: { select: { nome: true } }, portal: { select: { nome: true } } },
    })
    const porId = new Map(regs.map((r) => [r.id, r]))
    return {
      acessos: lista.map((a) => {
        const r = porId.get(a.registrationId)
        return { ...a, portalId: r?.portalId ?? null, codigo: r?.candidateCode ?? null, aluno: (r?.formData as any)?.nome || r?.lead?.nome || null, portal: r?.portal?.nome ?? null }
      }),
    }
  })

  app.post('/api/admin/moodle/varrer', guardAdmin, async (_req, reply) => {
    try { return await varrer(50) } catch (e) { return erro(reply, e) }
  })

  app.get('/api/admin/moodle/inscricao/:id', guardAgente, async (req, reply) => {
    const id = Number((req.params as any).id)
    try {
      const estado = await estadoDaInscricao(id)
      if (!estado.habilitada) return { ...estado, aptidao: null }
      return { ...estado, aptidao: await aptidao(id) }
    } catch (e) { return erro(reply, e) }
  })

  app.post('/api/admin/moodle/inscricao/:id/liberar', guardAgente, async (req, reply) => {
    const id = Number((req.params as any).id)
    const r = await liberar(id, ator(req), { forcar: ((req.body ?? {}) as any).forcar === true })
    return r.ok ? { ok: true } : reply.code(400).send({ error: r.erro })
  })

  app.post('/api/admin/moodle/inscricao/:id/suspender', guardAgente, async (req, reply) => {
    try { await suspender(Number((req.params as any).id), ator(req)); return { ok: true } } catch (e) { return erro(reply, e) }
  })

  app.post('/api/admin/moodle/inscricao/:id/reativar', guardAgente, async (req, reply) => {
    try { await reativar(Number((req.params as any).id), ator(req)); return { ok: true } } catch (e) { return erro(reply, e) }
  })

  app.post('/api/admin/moodle/inscricao/:id/curso', guardAgente, async (req, reply) => {
    const courseId = Number(((req.body ?? {}) as any).courseId)
    if (!Number.isInteger(courseId) || courseId <= 0) return reply.code(400).send({ error: 'Escolha o curso do Moodle.' })
    try { await trocarCurso(Number((req.params as any).id), courseId, ator(req)); return { ok: true } } catch (e) { return erro(reply, e) }
  })

  // Meu Portal → Moodle. Só a conta dona da inscrição; abre já logado (SSO) ou no curso.
  app.get('/api/public/portal/area/ava/entrar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).type('text/html; charset=utf-8').send('<p>Entre no portal de novo para acessar o curso.</p>')
    const registro = Number((req.query as any)?.registro)
    const reg = Number.isInteger(registro) ? await prisma.enrollmentRegistration.findFirst({ where: { id: registro, leadId: conta.leadId }, select: { id: true } }) : null
    if (!reg) return reply.code(404).type('text/html; charset=utf-8').send('<p>Curso não encontrado nesta conta.</p>')
    const destino = await destinoDeEntrada(reg.id)
    if (!destino) return reply.code(409).type('text/html; charset=utf-8').send('<p>Seu acesso ao curso ainda não está liberado. Fale com a secretaria.</p>')
    return reply.redirect(destino)
  })
}
