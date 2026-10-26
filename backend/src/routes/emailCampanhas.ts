// src/routes/emailCampanhas.ts — E-mail marketing (módulo email_marketing).
//
// Campanha nasce rascunho; "Enviar" põe para enviar agora ou agenda. O envio
// em si é do agendador (services/emailCampanhas.ts). Cada ação exige a
// permissão correspondente do módulo.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import { requireModule } from '../lib/permissions.js'
import { previa, iniciarEnvio, numeros, VARS_EXEMPLO, type Publico } from '../services/emailCampanhas.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from '../services/notify.js'
import { replaceVariables } from './templates.js'

const M = 'email_marketing'
const pode = (acao: 'view' | 'create' | 'edit' | 'delete') => [authMiddleware, requireModule(M, acao)]

function lerPublico(v: unknown): Publico {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const lista = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 200) : [])
  return {
    funnelId: p.funnelId ? Number(p.funnelId) : null,
    etapas: lista(p.etapas),
    tagIds: lista(p.tagIds).map(Number).filter(Boolean),
    tagModo: p.tagModo === 'todas' ? 'todas' : 'qualquer',
    origens: lista(p.origens),
    criadoDe: /^\d{4}-\d{2}-\d{2}$/.test(String(p.criadoDe ?? '')) ? String(p.criadoDe) : null,
    criadoAte: /^\d{4}-\d{2}-\d{2}$/.test(String(p.criadoAte ?? '')) ? String(p.criadoAte) : null,
    cidade: p.cidade ? String(p.cidade).slice(0, 100) : null,
    segmento: p.segmento ? String(p.segmento).slice(0, 100) : null,
  }
}

function lerCampanha(b: any): { ok: true; data: any } | { ok: false; erro: string } {
  const nome = String(b?.nome ?? '').trim()
  const assunto = String(b?.assunto ?? '').trim()
  if (!nome) return { ok: false, erro: 'Dê um nome à campanha' }
  if (!assunto) return { ok: false, erro: 'Informe o assunto' }
  if (!b?.templateId) return { ok: false, erro: 'Escolha o modelo de e-mail' }
  return {
    ok: true,
    data: {
      nome: nome.slice(0, 191), assunto: assunto.slice(0, 191),
      assuntoB: String(b?.assuntoB ?? '').trim().slice(0, 191) || null,
      templateId: Number(b.templateId), publico: lerPublico(b?.publico) as any,
    },
  }
}

export async function emailCampanhasRoutes(app: FastifyInstance) {
  /** Opções dos filtros: funis com etapas, tags e origens que existem nos leads. */
  app.get('/api/email-campanhas/opcoes', { preHandler: pode('view') }, async () => {
    const [funis, tags, origens, modelos] = await Promise.all([
      prisma.funnel.findMany({ where: { active: true }, select: { id: true, name: true, stages: { select: { key: true, name: true }, orderBy: { position: 'asc' } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      prisma.tag.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.lead.groupBy({ by: ['source'], _count: { _all: true }, where: { source: { not: null } } }),
      prisma.messageTemplate.findMany({ where: { channel: 'email', active: true }, select: { id: true, name: true, subject: true, bodyHtml: true }, orderBy: { name: 'asc' } }),
    ])
    return {
      funis, tags,
      origens: origens.map((o) => ({ valor: o.source, leads: o._count._all })).sort((a, b) => b.leads - a.leads),
      modelos: modelos.map((m) => ({ id: m.id, nome: m.name, assunto: m.subject, temConteudo: !!m.bodyHtml?.trim() })),
    }
  })

  app.post('/api/email-campanhas/previa', { preHandler: pode('view') }, async (req) => previa(lerPublico((req.body as any)?.publico)))

  app.get('/api/email-campanhas', { preHandler: pode('view') }, async () => {
    const lista = await prisma.emailCampanha.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, nome: true, status: true, assunto: true, assuntoB: true, agendadaPara: true, iniciadaEm: true, concluidaEm: true, total: true, createdAt: true } })
    const campanhas = await Promise.all(lista.map(async (c) => ({ ...c, numeros: c.status === 'rascunho' ? null : await numeros(c.id) })))
    return { campanhas }
  })

  app.get('/api/email-campanhas/:id', { preHandler: pode('view') }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const c = await prisma.emailCampanha.findUnique({ where: { id } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    return { campanha: { ...c, html: undefined }, numeros: await numeros(id) }
  })

  app.get('/api/email-campanhas/:id/envios', { preHandler: pode('view') }, async (req) => {
    const id = Number((req.params as any).id)
    const q = req.query as { status?: string; busca?: string; pagina?: string }
    const where: any = { campanhaId: id }
    if (q.status) where.status = q.status
    if (q.busca?.trim()) where.email = { contains: q.busca.trim().toLowerCase() }
    const pagina = Math.max(1, Number(q.pagina ?? 1))
    const [itens, total] = await Promise.all([
      prisma.emailCampanhaEnvio.findMany({ where, orderBy: { id: 'asc' }, skip: (pagina - 1) * 50, take: 50 }),
      prisma.emailCampanhaEnvio.count({ where }),
    ])
    const ids = itens.map((i) => i.externalId).filter(Boolean) as string[]
    const acomp = new Map((await prisma.outboundSend.findMany({ where: { externalId: { in: ids } }, select: { externalId: true, status: true, opens: true, clicks: true } })).map((o) => [o.externalId, o]))
    return { total, pagina, itens: itens.map((i) => ({ ...i, acompanhamento: i.externalId ? acomp.get(i.externalId) ?? null : null })) }
  })

  app.post('/api/email-campanhas', { preHandler: pode('create') }, async (req, reply) => {
    const r = lerCampanha(req.body)
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    const u = (req as any).user as JwtPayload
    const c = await prisma.emailCampanha.create({ data: { ...r.data, criadoPor: u?.email ?? null } })
    return reply.code(201).send({ campanha: c })
  })

  app.put('/api/email-campanhas/:id', { preHandler: pode('edit') }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const c = await prisma.emailCampanha.findUnique({ where: { id } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['rascunho', 'agendada'].includes(c.status)) return reply.code(400).send({ error: 'Só rascunho ou agendada pode ser editada' })
    const r = lerCampanha(req.body)
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    return { campanha: await prisma.emailCampanha.update({ where: { id }, data: r.data }) }
  })

  app.delete('/api/email-campanhas/:id', { preHandler: pode('delete') }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const c = await prisma.emailCampanha.findUnique({ where: { id } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (['enviando', 'pausada'].includes(c.status)) return reply.code(400).send({ error: 'Cancele a campanha antes de excluir' })
    await prisma.emailCampanha.delete({ where: { id } })
    return { ok: true }
  })

  /** Enviar agora ou agendar (`agendadaPara` ISO no futuro). */
  app.post('/api/email-campanhas/:id/enviar', { preHandler: pode('edit') }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const c = await prisma.emailCampanha.findUnique({ where: { id } })
    if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
    if (!['rascunho', 'agendada'].includes(c.status)) return reply.code(400).send({ error: `A campanha está ${c.status}` })
    const cfg = await getEmailConfig()
    const configurado = cfg['email.provider'] === 'smtp' ? !!cfg['smtp.host'] : !!(cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY)
    if (!configurado) return reply.code(400).send({ error: 'O envio de e-mail não está configurado (Configurações › E-mail).' })
    const quando = (req.body as any)?.agendadaPara ? new Date((req.body as any).agendadaPara) : null
    if (quando && !Number.isNaN(quando.getTime()) && quando.getTime() > Date.now() + 60_000) {
      await prisma.emailCampanha.update({ where: { id }, data: { status: 'agendada', agendadaPara: quando } })
      return { ok: true, status: 'agendada', agendadaPara: quando }
    }
    const r = await iniciarEnvio(id)
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    return { ok: true, status: 'enviando', total: r.total }
  })

  for (const [acao, de, para] of [['pausar', ['enviando', 'agendada'], 'pausada'], ['retomar', ['pausada'], 'enviando'], ['cancelar', ['enviando', 'pausada', 'agendada'], 'cancelada']] as const) {
    app.post(`/api/email-campanhas/:id/${acao}`, { preHandler: pode('edit') }, async (req, reply) => {
      const id = Number((req.params as any).id)
      const c = await prisma.emailCampanha.findUnique({ where: { id } })
      if (!c) return reply.code(404).send({ error: 'Campanha não encontrada' })
      if (!(de as readonly string[]).includes(c.status)) return reply.code(400).send({ error: `Não dá para ${acao} uma campanha ${c.status}` })
      // Retomar uma agendada que foi pausada antes de começar: ainda não tem destinatários.
      if (acao === 'retomar' && !c.iniciadaEm) {
        const r = await iniciarEnvio(id)
        return r.ok ? { ok: true, status: 'enviando' } : reply.code(400).send({ error: r.erro })
      }
      await prisma.emailCampanha.update({ where: { id }, data: { status: para, ...(para === 'cancelada' ? { concluidaEm: new Date() } : {}) } })
      if (para === 'cancelada') await prisma.emailCampanhaEnvio.updateMany({ where: { campanhaId: id, status: 'pendente' }, data: { status: 'ignorado', motivo: 'campanha cancelada' } })
      return { ok: true, status: para }
    })
  }

  /** Envio de teste: as duas versões de assunto, variáveis com valor de exemplo. */
  app.post('/api/email-campanhas/teste', { preHandler: pode('view') }, async (req, reply) => {
    const b = req.body as { to?: string; templateId?: number; assunto?: string; assuntoB?: string }
    const to = String(b?.to ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reply.code(400).send({ error: 'E-mail de destino inválido' })
    const tpl = b?.templateId ? await prisma.messageTemplate.findUnique({ where: { id: Number(b.templateId) } }) : null
    if (!tpl?.bodyHtml?.trim()) return reply.code(400).send({ error: 'O modelo escolhido não tem conteúdo de e-mail' })
    const cfg = await getEmailConfig()
    const configurado = cfg['email.provider'] === 'smtp' ? !!cfg['smtp.host'] : !!(cfg['notification.resend_api_key'] || process.env.RESEND_API_KEY)
    if (!configurado) return reply.code(400).send({ error: 'O envio de e-mail não está configurado (Configurações › E-mail).' })
    const assuntos = [b.assunto, b.assuntoB].map((x) => String(x ?? '').trim()).filter(Boolean)
    if (!assuntos.length) assuntos.push(tpl.subject || tpl.name)
    try {
      for (const [i, a] of assuntos.entries()) {
        await sendEmailGeneric({
          from: getFromAddress(cfg, 'Novidades'), to, origem: 'teste',
          subject: `[Teste${assuntos.length > 1 ? ` ${i ? 'B' : 'A'}` : ''}] ${replaceVariables(a, VARS_EXEMPLO)}`,
          html: replaceVariables(tpl.bodyHtml, VARS_EXEMPLO),
        })
      }
    } catch (e) { return reply.code(502).send({ error: (e as Error).message }) }
    return { ok: true, enviados: assuntos.length }
  })
}
