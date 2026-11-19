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
//   GET  /api/admin/moodle/inscricao/:id/progresso  (andamento no curso, para a ficha)
//   GET  /api/admin/moodle/vincular · POST /api/admin/moodle/vincular { ids }  (alunos que já estavam no Moodle, pelo CPF)
//   GET  /api/public/portal/area/ava/entrar?registro=  (Meu Portal → Moodle)
//   GET  /api/public/portal/area/ava/progresso?registro=  (Meu Portal: aba AVA)
//   GET  /api/admin/moodle/instancias · POST /api/admin/moodle/instancias { nome } · PUT /api/admin/moodle/instancias/:id { nome }
//
// Vários Moodles (17/11/2026): as rotas de admin recebem ?instancia= (ou
// "instancia" no corpo); vazio = o Moodle principal. As da inscrição acham o
// Moodle pelo portal dela.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import * as moodle from '../lib/moodleClient.js'
import {
  aptidao, liberar, suspender, reativar, trocarCurso, varrer, estadoDaInscricao, quadroDepara, destinoDeEntrada, naInstanciaDa,
} from '../services/moodleAcessos.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { candidatosAoVinculo, progressoDaInscricao, vincular } from '../services/moodleProgresso.js'

const guardAdmin = { preHandler: [authMiddleware, adminOnly] }
const guardAgente = { preHandler: [authMiddleware] }

async function salvar(key: string, value: string, label: string, fieldType = 'text') {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'moodle', fieldType },
    update: { value },
  })
}

/** Moodle escolhido na tela (?instancia= ou corpo). Inválido/desconhecido = erro. */
async function instDaReq(req: any): Promise<string> {
  const v = String((req.query as any)?.instancia ?? (req.body as any)?.instancia ?? '').trim()
  if (!v) return moodle.PRINCIPAL
  if (!moodle.instanciaValida(v) || !(await moodle.listarInstancias()).some((i) => i.id === v)) throw new Error('Moodle não encontrado.')
  return v
}

/** Roda o handler no Moodle escolhido na tela. */
async function noMoodleDaTela<T>(req: any, reply: any, fn: (inst: string) => Promise<T>) {
  try {
    const inst = await instDaReq(req)
    return await moodle.comInstancia(inst, () => fn(inst))
  } catch (e) { return erro(reply, e) }
}

function ator(req: any) {
  const u = req.user as { userId?: number; name?: string; email?: string } | undefined
  return { origem: 'manual' as const, userId: u?.userId ?? null, userName: u?.name || u?.email || null }
}

function erro(reply: any, e: any) {
  return reply.code(e instanceof moodle.MoodleError ? 502 : 400).send({ error: e?.message || String(e) })
}

/** Inscrições dos portais que liberam neste Moodle (para listas e totais). */
async function registrosDoMoodle(inst: string): Promise<number[]> {
  const portais = await prisma.enrollmentPortal.findMany({ select: { id: true } })
  const meus: number[] = []
  for (const p of portais) if ((await moodle.instanciaDoPortal(p.id)) === inst) meus.push(p.id)
  if (!meus.length) return []
  const acessos = await prisma.moodleAcesso.findMany({ select: { registrationId: true } })
  const regs = await prisma.enrollmentRegistration.findMany({ where: { id: { in: acessos.map((a) => a.registrationId) }, portalId: { in: meus } }, select: { id: true } })
  return regs.map((r) => r.id)
}

export async function moodleIntegrationRoutes(app: FastifyInstance) {
  app.get('/api/admin/moodle/config', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async (inst) => {
    const c = await moodle.getMoodleConfig(true)
    const instancias = await moodle.listarInstancias()
    const portais = await prisma.enrollmentPortal.findMany({ select: { id: true, nome: true, active: true }, orderBy: { id: 'asc' } })
    // Portal ligado a OUTRO Moodle aparece travado na lista deste.
    const outros: Record<number, string> = {}
    for (const i of instancias) {
      if (i.id === inst) continue
      for (const pid of (await moodle.getMoodleConfig(true, i.id)).portais) outros[pid] = i.nome
    }
    const idsDoMoodle = await registrosDoMoodle(inst)
    const grupos = await prisma.moodleAcesso.groupBy({ by: ['status'], where: { registrationId: { in: idsDoMoodle.length ? idsDoMoodle : [-1] } }, _count: { _all: true } })
    const totais = Object.fromEntries(grupos.map((g) => [g.status, g._count._all]))
    return {
      instancia: inst, instancias,
      baseUrl: c.baseUrl, tokenConfigurado: !!c.token, senhaConfigurada: !!c.senha, // segredos nunca saem daqui
      enabled: c.enabled, sso: c.sso, papelId: c.papelId, portais: c.portais, desde: c.desde,
      todosPortais: portais.map((p) => ({ ...p, outroMoodle: outros[p.id] ?? null })), totais,
    }
  }))

  app.get('/api/admin/moodle/instancias', guardAdmin, async () => ({ instancias: await moodle.listarInstancias() }))

  // Outro Moodle no mesmo tenant (ex.: a segunda empresa com o AVA dela).
  app.post('/api/admin/moodle/instancias', guardAdmin, async (req, reply) => {
    const nome = String(((req.body ?? {}) as any).nome ?? '').trim().slice(0, 80)
    if (!nome) return reply.code(400).send({ error: 'Dê um nome ao Moodle (ex.: o nome da empresa).' })
    const lista = await moodle.listarInstancias()
    let n = 2
    while (lista.some((i) => i.id === `m${n}`)) n++
    const extras = [...lista.filter((i) => i.id !== moodle.PRINCIPAL), { id: `m${n}`, nome }]
    await salvar(moodle.MOODLE_INSTANCIAS_KEY, JSON.stringify(extras), 'Outros Moodles', 'json')
    moodle.resetMoodleCache()
    return { ok: true, id: `m${n}` }
  })

  app.put('/api/admin/moodle/instancias/:id', guardAdmin, async (req, reply) => {
    const id = String((req.params as any).id ?? '')
    const nome = String(((req.body ?? {}) as any).nome ?? '').trim().slice(0, 80)
    if (!nome) return reply.code(400).send({ error: 'Dê um nome ao Moodle.' })
    const lista = await moodle.listarInstancias()
    if (id === 'principal') await salvar(moodle.MOODLE_NOME_KEY, nome, 'Nome do Moodle principal')
    else {
      if (!lista.some((i) => i.id === id)) return reply.code(404).send({ error: 'Moodle não encontrado.' })
      await salvar(moodle.MOODLE_INSTANCIAS_KEY, JSON.stringify(lista.filter((i) => i.id !== moodle.PRINCIPAL).map((i) => (i.id === id ? { id, nome } : i))), 'Outros Moodles', 'json')
    }
    moodle.resetMoodleCache()
    return { ok: true }
  })

  app.post('/api/admin/moodle/config', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async (inst) => {
    const b = (req.body ?? {}) as any
    const K = (base: string) => moodle.chaveDa(base, inst)
    {
      if (b.baseUrl !== undefined) {
        const url = String(b.baseUrl).trim().replace(/\/+$/, '')
        if (url && !/^https:\/\/[^\s/]+/i.test(url)) throw new Error('A URL do Moodle precisa começar com https://')
        await salvar(K(moodle.MOODLE_KEYS.baseUrl), url, 'URL do Moodle')
      }
      if (typeof b.token === 'string' && b.token.trim()) await salvar(K(moodle.MOODLE_KEYS.token), b.token.trim(), 'Token do Moodle', 'password')
      if (typeof b.senha === 'string' && b.senha.trim()) await salvar(K(moodle.MOODLE_KEYS.senha), b.senha.trim(), 'Senha inicial do aluno no Moodle', 'password')
      if (b.sso !== undefined) await salvar(K(moodle.MOODLE_KEYS.sso), b.sso ? 'true' : 'false', 'Entrar no Moodle já logado (auth_userkey)', 'boolean')
      if (b.papelId !== undefined) await salvar(K(moodle.MOODLE_KEYS.papelId), String(Number(b.papelId) || 5), 'Papel do aluno no Moodle', 'number')
      if (Array.isArray(b.portais)) {
        // Um portal só pode liberar em UM Moodle.
        for (const i of await moodle.listarInstancias()) {
          if (i.id === inst) continue
          const choque = (await moodle.getMoodleConfig(true, i.id)).portais.filter((pid) => b.portais.map(Number).includes(pid))
          if (choque.length) throw new Error(`O portal ${choque.join(', ')} já está ligado ao "${i.nome}". Tire de lá primeiro.`)
        }
      }
      if (Array.isArray(b.portais)) await salvar(K(moodle.MOODLE_KEYS.portais), JSON.stringify(b.portais.map(Number).filter((n: number) => n > 0)), 'Portais ligados ao Moodle', 'json')
      if (b.enabled !== undefined) {
        const atual = await moodle.getMoodleConfig(true)
        await salvar(K(moodle.MOODLE_KEYS.enabled), b.enabled ? 'true' : 'false', 'Liberação automática no Moodle', 'boolean')
        // Ao ligar a 1ª vez, o automático só pega o que ficar apto DAQUI EM DIANTE.
        if (b.enabled && !atual.desde) await salvar(K(moodle.MOODLE_KEYS.desde), new Date().toISOString(), 'Liberação automática a partir de')
      }
      if (b.desde !== undefined) {
        const d = b.desde ? new Date(String(b.desde)) : null
        if (d && Number.isNaN(d.getTime())) throw new Error('Data inválida')
        await salvar(K(moodle.MOODLE_KEYS.desde), d ? d.toISOString() : '', 'Liberação automática a partir de')
      }
      moodle.resetMoodleCache()
      return { ok: true }
    }
  }))

  app.post('/api/admin/moodle/testar', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async () => {
    moodle.resetMoodleCache(); return await moodle.testarConexao()
  }))

  // ?registro= (ficha da inscrição): cursos do Moodle do portal dela.
  app.get('/api/admin/moodle/cursos', guardAgente, async (req, reply) => {
    const q = (req.query ?? {}) as any
    const registro = Number(q.registro)
    if (Number.isInteger(registro) && registro > 0) {
      try { return { cursos: await naInstanciaDa(registro, () => moodle.listarCursos(q.atualizar === '1')) } } catch (e) { return erro(reply, e) }
    }
    return noMoodleDaTela(req, reply, async () => ({ cursos: await moodle.listarCursos(q.atualizar === '1') }))
  })

  app.get('/api/admin/moodle/depara', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async () => ({ linhas: await quadroDepara() })))

  // { itens: { "<portalId>:<offeringId>": courseId | null } } — mescla com o que existe.
  app.put('/api/admin/moodle/depara', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async (inst) => {
    {
      const itens = ((req.body ?? {}) as any).itens ?? {}
      const atual = { ...(await moodle.getMoodleConfig(true)).depara }
      for (const [k, v] of Object.entries(itens)) {
        if (!/^\d+:\d+$/.test(k)) continue
        const n = Number(v)
        if (Number.isInteger(n) && n > 0) atual[k] = n
        else delete atual[k]
      }
      await salvar(moodle.chaveDa(moodle.MOODLE_KEYS.depara, inst), JSON.stringify(atual), 'De-para oferta × curso do Moodle', 'json')
      moodle.resetMoodleCache()
      return { ok: true, total: Object.keys(atual).length }
    }
  }))

  app.get('/api/admin/moodle/acessos', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async (inst) => {
    const q = (req.query ?? {}) as any
    const status = q.status ? String(q.status) : undefined
    const ids = await registrosDoMoodle(inst)
    const lista = await prisma.moodleAcesso.findMany({ where: { registrationId: { in: ids.length ? ids : [-1] }, ...(status ? { status } : {}) }, orderBy: { updatedAt: 'desc' }, take: 200 })
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
  }))

  app.post('/api/admin/moodle/varrer', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, (inst) => varrer(50, inst)))

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

  // Andamento do aluno no curso (progresso, avaliações, requisitos de conclusão).
  app.get('/api/admin/moodle/inscricao/:id/progresso', guardAgente, async (req, reply) => {
    try {
      const p = await progressoDaInscricao(Number((req.params as any).id), { forcar: String((req.query as any)?.forcar ?? '') === '1' })
      return { progresso: p }
    } catch (e) { return erro(reply, e) }
  })

  // Alunos que já estudavam no Moodle antes da integração: o time confere e
  // vincula pelo CPF (usuário do Moodle). Não inscreve ninguém no Moodle.
  app.get('/api/admin/moodle/vincular', guardAdmin, async (req, reply) => noMoodleDaTela(req, reply, async () => ({ candidatos: await candidatosAoVinculo() })))
  app.post('/api/admin/moodle/vincular', guardAdmin, async (req, reply) => {
    const ids = (((req.body ?? {}) as any).ids ?? []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    if (!ids.length) return reply.code(400).send({ error: 'Escolha ao menos uma inscrição.' })
    const u = (req as any).user as { userId?: number; name?: string; email?: string } | undefined
    return noMoodleDaTela(req, reply, () => vincular(ids, { userId: u?.userId ?? null, userName: u?.name || u?.email || null }))
  })

  // Meu Portal: aba AVA. Só a conta dona da inscrição.
  app.get('/api/public/portal/area/ava/progresso', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).send({ error: 'Entre no portal de novo.' })
    const registro = Number((req.query as any)?.registro)
    const reg = Number.isInteger(registro) ? await prisma.enrollmentRegistration.findFirst({ where: { id: registro, leadId: { in: await (await import('../services/portalAccount.js')).fichasDaConta(conta.leadId) } }, select: { id: true } }) : null
    if (!reg) return reply.code(404).send({ error: 'Curso não encontrado nesta conta.' })
    try {
      return { progresso: await progressoDaInscricao(reg.id, { forcar: String((req.query as any)?.forcar ?? '') === '1' }) }
    } catch (e: any) {
      return reply.code(502).send({ error: 'Não foi possível ler o seu andamento no AVA agora. Tente de novo em alguns minutos.' })
    }
  })

  // Meu Portal → Moodle. Só a conta dona da inscrição; abre já logado (SSO) ou no curso.
  app.get('/api/public/portal/area/ava/entrar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).type('text/html; charset=utf-8').send('<p>Entre no portal de novo para acessar o curso.</p>')
    const registro = Number((req.query as any)?.registro)
    const reg = Number.isInteger(registro) ? await prisma.enrollmentRegistration.findFirst({ where: { id: registro, leadId: { in: await (await import('../services/portalAccount.js')).fichasDaConta(conta.leadId) } }, select: { id: true } }) : null
    if (!reg) return reply.code(404).type('text/html; charset=utf-8').send('<p>Curso não encontrado nesta conta.</p>')
    const destino = await destinoDeEntrada(reg.id)
    if (!destino) return reply.code(409).type('text/html; charset=utf-8').send('<p>Seu acesso ao curso ainda não está liberado. Fale com a secretaria.</p>')
    return reply.redirect(destino)
  })
}
