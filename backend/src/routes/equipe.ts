// src/routes/equipe.ts
//
// Equipe — chat interno (services/equipeChat). Todas as rotas exigem login e o
// módulo 'equipe' ligado (gate global por /api/equipe). Quem pode o quê dentro
// da conversa é decidido aqui: só membro escreve; só o autor edita; autor ou
// admin apaga; grupo é administrado por quem criou. As ações dos cartões que
// já existem no sistema (pedir/aceitar/recusar transferência, assumir conversa)
// passam pelas MESMAS rotas de sempre, com o login de quem clicou — valem as
// mesmas regras e os mesmos avisos.

import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, type JwtPayload } from '../lib/auth.js'
import {
  PAPEIS_ADMIN, acessaLead, avisarAtualizacao, avisarNovaMensagem, conversasDe, garantirMembro,
  lerLinks, lerMencoes, mensagemDoSistema, montarMensagens, pessoasPorId, podeLer, sincronizarCanaisDe,
} from '../services/equipeChat.js'

const MAX_CORPO = 5000
const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅', '👀', '🎉']

export async function equipeRoutes(app: FastifyInstance) {
  const auth = { preHandler: authMiddleware }
  const eu = (req: any) => req.user as JwtPayload

  /** Chama uma rota do próprio sistema como a pessoa logada. */
  async function comoAPessoa(req: any, method: 'GET' | 'POST', url: string, payload?: unknown) {
    const r = await app.inject({ method, url, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}) })
    let body: any = null
    try { body = r.json() } catch { body = null }
    return { status: r.statusCode, body }
  }

  // ── Resumo para o ícone do topo ──
  app.get('/api/equipe/resumo', auth, async (req) => {
    const lista = await conversasDe(eu(req))
    return {
      naoLidas: lista.filter((c) => !c.silenciada).reduce((s, c) => s + c.naoLidas, 0),
      mencoes: lista.reduce((s, c) => s + c.mencoes, 0),
      conversasComNaoLidas: lista.filter((c) => c.naoLidas > 0 && !c.silenciada).length,
    }
  })

  // ── Conversas ──
  app.get('/api/equipe/conversas', auth, async (req) => ({ conversas: await conversasDe(eu(req)) }))

  app.post('/api/equipe/conversas', auth, async (req, reply) => {
    const user = eu(req)
    const b = (req.body as any) ?? {}
    if (b.tipo === 'direta') {
      const outro = Number(b.userId)
      if (!Number.isInteger(outro) || outro <= 0 || outro === user.userId) return reply.code(400).send({ error: 'Escolha outra pessoa.' })
      const existe = await prisma.user.findFirst({ where: { id: outro, active: true }, select: { id: true } })
      if (!existe) return reply.code(404).send({ error: 'Pessoa não encontrada.' })
      const chave = [user.userId, outro].sort((a, b) => a - b).join(':')
      let c = await prisma.equipeConversa.findUnique({ where: { chaveDireta: chave }, select: { id: true } })
      if (!c) {
        c = await prisma.equipeConversa.create({ data: { tipo: 'direta', chaveDireta: chave, criadoPorId: user.userId }, select: { id: true } })
          .catch(async () => prisma.equipeConversa.findUnique({ where: { chaveDireta: chave }, select: { id: true } }))
      }
      if (!c) return reply.code(500).send({ error: 'Não foi possível abrir a conversa.' })
      await garantirMembro(c.id, user.userId)
      await garantirMembro(c.id, outro)
      return { id: c.id }
    }
    if (b.tipo === 'grupo') {
      const nome = String(b.nome ?? '').trim().slice(0, 120)
      if (!nome) return reply.code(400).send({ error: 'Dê um nome ao grupo.' })
      const ids = [...new Set((Array.isArray(b.membros) ? b.membros : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0 && n !== user.userId))] as number[]
      const ativos = await prisma.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } })
      const c = await prisma.equipeConversa.create({ data: { tipo: 'grupo', nome, descricao: String(b.descricao ?? '').trim().slice(0, 255) || null, criadoPorId: user.userId }, select: { id: true } })
      await prisma.equipeMembro.create({ data: { conversaId: c.id, userId: user.userId, papel: 'admin' } })
      for (const a of ativos) await garantirMembro(c.id, a.id)
      await mensagemDoSistema(c.id, `${(await pessoasPorId([user.userId])).get(user.userId)?.nome ?? 'Alguém'} criou o grupo "${nome}".`)
      await avisarAtualizacao(c.id)
      return { id: c.id }
    }
    if (b.tipo === 'lead') {
      const leadId = Number(b.leadId)
      if (!Number.isInteger(leadId) || !(await acessaLead(user, leadId))) return reply.code(403).send({ error: 'Sem acesso a este lead.' })
      let c = await prisma.equipeConversa.findUnique({ where: { leadId }, select: { id: true } })
      if (!c) {
        c = await prisma.equipeConversa.create({ data: { tipo: 'lead', leadId, criadoPorId: user.userId }, select: { id: true } })
          .catch(async () => prisma.equipeConversa.findUnique({ where: { leadId }, select: { id: true } }))
      }
      if (!c) return reply.code(500).send({ error: 'Não foi possível abrir a conversa do lead.' })
      await garantirMembro(c.id, user.userId)
      return { id: c.id }
    }
    return reply.code(400).send({ error: 'Tipo de conversa inválido.' })
  })

  /** Conversa interna de um lead (na ficha do lead): devolve a existente sem criar. */
  app.get('/api/equipe/lead/:leadId', auth, async (req, reply) => {
    const leadId = Number((req.params as any).leadId)
    if (!(await acessaLead(eu(req), leadId))) return reply.code(403).send({ error: 'Sem acesso a este lead.' })
    const c = await prisma.equipeConversa.findUnique({ where: { leadId }, select: { id: true, _count: { select: { mensagens: true } } } })
    return { conversaId: c?.id ?? null, mensagens: c?._count.mensagens ?? 0 }
  })

  app.get('/api/equipe/conversas/:id', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const acesso = await podeLer(user, id)
    if (!acesso.ok) return reply.code(404).send({ error: 'Conversa não encontrada.' })
    const c = await prisma.equipeConversa.findUnique({ where: { id }, select: { id: true, tipo: true, nome: true, descricao: true, teamId: true, leadId: true, criadoPorId: true } })
    const membros = await prisma.equipeMembro.findMany({ where: { conversaId: id }, select: { userId: true, papel: true, silenciada: true } })
    const pessoas = await pessoasPorId(membros.map((m) => m.userId))
    const eu_ = membros.find((m) => m.userId === user.userId)
    const lead = c?.leadId ? await prisma.lead.findUnique({ where: { id: c.leadId }, select: { id: true, nome: true } }) : null
    return {
      ...c,
      lead,
      souMembro: !!eu_,
      souAdmin: eu_?.papel === 'admin' || (c?.tipo === 'grupo' && PAPEIS_ADMIN.has(user.role)),
      silenciada: !!eu_?.silenciada,
      membros: membros.map((m) => ({ ...(pessoas.get(m.userId) ?? { id: m.userId, nome: '—' }), papel: m.papel }))
        .sort((a: any, b: any) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
    }
  })

  app.patch('/api/equipe/conversas/:id', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const c = await prisma.equipeConversa.findUnique({ where: { id }, select: { tipo: true } })
    const m = await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId: id, userId: user.userId } }, select: { papel: true } })
    if (!c || c.tipo !== 'grupo' || !(m?.papel === 'admin' || PAPEIS_ADMIN.has(user.role))) return reply.code(403).send({ error: 'Só quem administra o grupo pode alterar.' })
    const b = (req.body as any) ?? {}
    const nome = b.nome !== undefined ? String(b.nome).trim().slice(0, 120) : undefined
    if (nome === '') return reply.code(400).send({ error: 'O grupo precisa de um nome.' })
    await prisma.equipeConversa.update({ where: { id }, data: { ...(nome ? { nome } : {}), ...(b.descricao !== undefined ? { descricao: String(b.descricao).trim().slice(0, 255) || null } : {}) } })
    await avisarAtualizacao(id)
    return { ok: true }
  })

  app.post('/api/equipe/conversas/:id/membros', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const c = await prisma.equipeConversa.findUnique({ where: { id }, select: { tipo: true } })
    const m = await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId: id, userId: user.userId } }, select: { papel: true } })
    if (!c || c.tipo !== 'grupo' || !(m?.papel === 'admin' || PAPEIS_ADMIN.has(user.role))) return reply.code(403).send({ error: 'Só quem administra o grupo adiciona pessoas.' })
    const ids = [...new Set(((req.body as any)?.userIds ?? []).map(Number).filter((n: number) => n > 0))] as number[]
    const ativos = await prisma.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } })
    for (const a of ativos) await garantirMembro(id, a.id)
    const nomes = await pessoasPorId(ativos.map((a) => a.id))
    if (ativos.length) await mensagemDoSistema(id, `${[...nomes.values()].map((p) => p.nome).join(', ')} entrou no grupo.`)
    await avisarAtualizacao(id)
    return { ok: true, adicionados: ativos.length }
  })

  app.delete('/api/equipe/conversas/:id/membros/:userId', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const alvo = Number((req.params as any).userId)
    const c = await prisma.equipeConversa.findUnique({ where: { id }, select: { tipo: true } })
    const m = await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId: id, userId: user.userId } }, select: { papel: true } })
    if (!c) return reply.code(404).send({ error: 'Conversa não encontrada.' })
    if (c.tipo === 'equipe') return reply.code(400).send({ error: 'O canal da equipe acompanha a equipe — mude os membros em Equipes.' })
    if (c.tipo === 'direta') return reply.code(400).send({ error: 'Conversa direta não tem membros para remover.' })
    const saindo = alvo === user.userId
    if (!saindo && !(m?.papel === 'admin' || PAPEIS_ADMIN.has(user.role))) return reply.code(403).send({ error: 'Só quem administra o grupo remove pessoas.' })
    await prisma.equipeMembro.deleteMany({ where: { conversaId: id, userId: alvo } })
    const nome = (await pessoasPorId([alvo])).get(alvo)?.nome ?? 'Alguém'
    if (c.tipo === 'grupo') await mensagemDoSistema(id, saindo ? `${nome} saiu do grupo.` : `${nome} foi removido do grupo.`)
    await avisarAtualizacao(id)
    return { ok: true }
  })

  app.put('/api/equipe/conversas/:id/silenciar', auth, async (req) => {
    const id = Number((req.params as any).id)
    const silenciada = !!(req.body as any)?.silenciada
    await prisma.equipeMembro.updateMany({ where: { conversaId: id, userId: eu(req).userId }, data: { silenciada } })
    return { ok: true, silenciada }
  })

  app.post('/api/equipe/conversas/:id/lida', auth, async (req) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const ultima = await prisma.equipeMensagem.findFirst({ where: { conversaId: id }, orderBy: { id: 'desc' }, select: { id: true } })
    if (ultima) await prisma.equipeMembro.updateMany({ where: { conversaId: id, userId: user.userId }, data: { ultimaLidaId: ultima.id } })
    const { enviarParaUsuarios } = await import('./realtime.js')
    enviarParaUsuarios([user.userId], { type: 'equipe:lida', payload: { conversaId: id } })
    return { ok: true }
  })

  // ── Mensagens ──
  app.get('/api/equipe/conversas/:id/mensagens', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const acesso = await podeLer(user, id)
    if (!acesso.ok) return reply.code(404).send({ error: 'Conversa não encontrada.' })
    const q = req.query as any
    const limit = Math.min(Number(q.limit) || 50, 100)
    const before = Number(q.before) || null
    const msgs = await prisma.equipeMensagem.findMany({
      where: { conversaId: id, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit,
    })
    msgs.reverse()
    const ultimaLida = acesso.membro
      ? (await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId: id, userId: user.userId } }, select: { ultimaLidaId: true } }))?.ultimaLidaId ?? null
      : null
    return { mensagens: await montarMensagens(user, msgs), temMais: msgs.length === limit, ultimaLidaId: ultimaLida }
  })

  app.post('/api/equipe/conversas/:id/mensagens', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const acesso = await podeLer(user, id)
    if (!acesso.ok || !acesso.conversa) return reply.code(404).send({ error: 'Conversa não encontrada.' })
    // Conversa de lead: quem tem acesso ao lead entra ao escrever.
    if (!acesso.membro) {
      if (acesso.conversa.tipo !== 'lead') return reply.code(403).send({ error: 'Você não participa desta conversa.' })
      await garantirMembro(id, user.userId)
    }
    const b = (req.body as any) ?? {}
    const corpo = typeof b.corpo === 'string' ? b.corpo.trim().slice(0, MAX_CORPO) : ''
    const anexos = Array.isArray(b.anexos)
      ? b.anexos.filter((a: any) => typeof a?.url === 'string' && a.url.startsWith('/uploads/equipe/')).slice(0, 10)
        .map((a: any) => ({ url: a.url, nome: String(a.nome ?? 'arquivo').slice(0, 191), tipo: String(a.tipo ?? '').slice(0, 80), tamanho: Number(a.tamanho) || null }))
      : []
    const cartao = b.cartao ? await prepararCartao(req, user, b.cartao, acesso.conversa) : null
    if (cartao && 'erro' in cartao) return reply.code(cartao.status ?? 400).send({ error: cartao.erro })
    if (!corpo && !anexos.length && !cartao) return reply.code(400).send({ error: 'Mensagem vazia.' })
    const respostaAId = Number(b.respostaAId) || null
    if (respostaAId) {
      const r = await prisma.equipeMensagem.findFirst({ where: { id: respostaAId, conversaId: id }, select: { id: true } })
      if (!r) return reply.code(400).send({ error: 'A mensagem respondida não é desta conversa.' })
    }
    const mencoes = lerMencoes(corpo)
    // Conversa de lead: quem é mencionado e tem acesso ao lead passa a acompanhar.
    if (acesso.conversa.tipo === 'lead' && acesso.conversa.leadId) {
      for (const u of mencoes.users) {
        const p = await prisma.user.findUnique({ where: { id: u }, select: { id: true, role: true, active: true } })
        if (p?.active && await acessaLead({ userId: p.id, role: p.role }, acesso.conversa.leadId)) await garantirMembro(id, u)
      }
    }
    const links = lerLinks(corpo)
    const m = await prisma.equipeMensagem.create({
      data: {
        conversaId: id, userId: user.userId, corpo: corpo || null,
        cartao: (cartao as any) ?? undefined, anexos: anexos.length ? anexos : undefined,
        mencoes: mencoes.users.length || mencoes.teams.length ? mencoes : undefined,
        links: links.length ? links : undefined,
        respostaAId,
      },
    })
    await prisma.equipeConversa.update({ where: { id }, data: { ultimaMensagemEm: m.createdAt } })
    await prisma.equipeMembro.updateMany({ where: { conversaId: id, userId: user.userId }, data: { ultimaLidaId: m.id } })
    await avisarNovaMensagem(id, m.id, user.userId, corpo || (cartao ? `[${(cartao as any).tipo}]` : '📎 Anexo'), mencoes)
    const [montada] = await montarMensagens(user, [m])
    return { mensagem: montada }
  })

  app.patch('/api/equipe/mensagens/:id', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const m = await prisma.equipeMensagem.findUnique({ where: { id }, select: { userId: true, conversaId: true, apagadaEm: true } })
    if (!m || m.apagadaEm) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    if (m.userId !== user.userId) return reply.code(403).send({ error: 'Só quem escreveu pode editar.' })
    const corpo = String((req.body as any)?.corpo ?? '').trim().slice(0, MAX_CORPO)
    if (!corpo) return reply.code(400).send({ error: 'A mensagem não pode ficar vazia.' })
    const mencoes = lerMencoes(corpo)
    const links = lerLinks(corpo)
    await prisma.equipeMensagem.update({ where: { id }, data: { corpo, editadaEm: new Date(), mencoes: mencoes.users.length || mencoes.teams.length ? mencoes : undefined, links: links.length ? links : undefined } })
    await avisarAtualizacao(m.conversaId)
    return { ok: true }
  })

  app.delete('/api/equipe/mensagens/:id', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const m = await prisma.equipeMensagem.findUnique({ where: { id }, select: { userId: true, conversaId: true, apagadaEm: true } })
    if (!m || m.apagadaEm) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    if (m.userId !== user.userId && !PAPEIS_ADMIN.has(user.role)) return reply.code(403).send({ error: 'Só quem escreveu (ou um admin) pode apagar.' })
    await prisma.equipeMensagem.update({ where: { id }, data: { apagadaEm: new Date(), corpo: null } })
    await avisarAtualizacao(m.conversaId)
    return { ok: true }
  })

  app.post('/api/equipe/mensagens/:id/reacao', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const emoji = String((req.body as any)?.emoji ?? '')
    if (!EMOJIS.includes(emoji)) return reply.code(400).send({ error: 'Reação inválida.' })
    const m = await prisma.equipeMensagem.findUnique({ where: { id }, select: { conversaId: true, reacoes: true, apagadaEm: true } })
    if (!m || m.apagadaEm) return reply.code(404).send({ error: 'Mensagem não encontrada.' })
    if (!(await podeLer(user, m.conversaId)).membro) return reply.code(403).send({ error: 'Você não participa desta conversa.' })
    const r: Record<string, number[]> = { ...((m.reacoes as any) ?? {}) }
    const lista = new Set(r[emoji] ?? [])
    if (lista.has(user.userId)) lista.delete(user.userId); else lista.add(user.userId)
    if (lista.size) r[emoji] = [...lista]; else delete r[emoji]
    await prisma.equipeMensagem.update({ where: { id }, data: { reacoes: r } })
    await avisarAtualizacao(m.conversaId)
    return { ok: true, reacoes: r }
  })

  // ── Ações dos cartões ──
  app.post('/api/equipe/mensagens/:id/acao', auth, async (req, reply) => {
    const user = eu(req)
    const id = Number((req.params as any).id)
    const acao = String((req.body as any)?.acao ?? '')
    const m = await prisma.equipeMensagem.findUnique({ where: { id }, select: { id: true, userId: true, conversaId: true, cartao: true, apagadaEm: true } })
    if (!m || m.apagadaEm || !m.cartao) return reply.code(404).send({ error: 'Cartão não encontrado.' })
    if (!(await podeLer(user, m.conversaId)).ok) return reply.code(403).send({ error: 'Sem acesso a esta conversa.' })
    const c: any = { ...(m.cartao as any) }

    if (c.tipo === 'transferencia' && ['aceitar', 'recusar', 'cancelar'].includes(acao)) {
      const rota = acao === 'aceitar' ? 'accept' : acao === 'recusar' ? 'reject' : 'cancel'
      const r = await comoAPessoa(req, 'POST', `/api/atendimento/transfer-requests/${c.transferRequestId}/${rota}`, { response: (req.body as any)?.resposta ?? undefined })
      if (r.status >= 400) return reply.code(r.status).send({ error: r.body?.error ?? 'Não foi possível concluir.' })
    } else if (c.tipo === 'indicacao' && acao === 'assumir') {
      if (c.paraUserId && Number(c.paraUserId) !== user.userId) return reply.code(403).send({ error: 'A indicação foi para outra pessoa.' })
      const r = await comoAPessoa(req, 'POST', `/api/atendimento/tickets/${c.leadId}/claim`, {})
      if (r.status >= 400) return reply.code(r.status).send({ error: r.body?.error ?? 'Não foi possível assumir.' })
      c.assumidoPor = user.userId
      await prisma.equipeMensagem.update({ where: { id }, data: { cartao: c } })
    } else if (c.tipo === 'tarefa' && (acao === 'concluir' || acao === 'reabrir')) {
      const responsavel = !c.paraUserId || Number(c.paraUserId) === user.userId
      if (!responsavel && m.userId !== user.userId) return reply.code(403).send({ error: 'Só o responsável ou quem pediu altera a tarefa.' })
      c.status = acao === 'concluir' ? 'concluida' : 'aberta'
      c.concluidaPor = acao === 'concluir' ? user.userId : null
      c.concluidaEm = acao === 'concluir' ? new Date().toISOString() : null
      await prisma.equipeMensagem.update({ where: { id }, data: { cartao: c } })
      if (c.atividadeId) {
        await prisma.activity.update({ where: { id: Number(c.atividadeId) }, data: acao === 'concluir' ? { status: 'completed', completedAt: new Date() } : { status: 'pending', completedAt: null } }).catch(() => {})
      }
    } else {
      return reply.code(400).send({ error: 'Ação inválida para este cartão.' })
    }
    await avisarAtualizacao(m.conversaId)
    return { ok: true }
  })

  /**
   * Valida e completa o cartão antes de gravar. Transferência cria o pedido
   * REAL (rota de sempre, como quem envia); tarefa sobre um lead cria a
   * atividade (aparece em Atividades).
   */
  async function prepararCartao(req: any, user: JwtPayload, bruto: any, conversa: { id: number; tipo: string }): Promise<any> {
    const tipo = String(bruto?.tipo ?? '')
    const leadId = Number(bruto?.leadId) || null
    const paraUserId = Number(bruto?.paraUserId) || null
    const motivo = typeof bruto?.motivo === 'string' ? bruto.motivo.trim().slice(0, 255) || null : null
    if (leadId && !(await acessaLead(user, leadId))) return { erro: 'Você não tem acesso a este lead.', status: 403 }
    if (paraUserId) {
      const membro = await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId: conversa.id, userId: paraUserId } }, select: { id: true } })
      if (!membro) return { erro: 'A pessoa escolhida não participa desta conversa.' }
    }
    if (tipo === 'lead') {
      if (!leadId) return { erro: 'Escolha o lead.' }
      return { tipo, leadId }
    }
    if (tipo === 'indicacao') {
      if (!leadId) return { erro: 'Escolha o lead que você quer indicar.' }
      return { tipo, leadId, paraUserId, motivo }
    }
    if (tipo === 'transferencia') {
      if (!leadId || !paraUserId) return { erro: 'Escolha o lead e para quem transferir.' }
      const r = await comoAPessoa(req, 'POST', '/api/atendimento/transfer-requests', { leadId, toUserId: paraUserId, reason: motivo ?? undefined })
      if (r.status >= 400) return { erro: r.body?.error ?? 'Não foi possível pedir a transferência.', status: r.status }
      const trId = Number(r.body?.request?.id ?? r.body?.id ?? r.body?.transferRequest?.id)
      if (!trId) return { erro: 'O pedido de transferência não voltou com o número.' }
      return { tipo, leadId, paraUserId, motivo, transferRequestId: trId }
    }
    if (tipo === 'negociacao') {
      const n = await prisma.negotiation.findUnique({ where: { id: Number(bruto?.negociacaoId) }, select: { id: true, leadId: true } }).catch(() => null)
      if (!n) return { erro: 'Negociação não encontrada.' }
      if (n.leadId && !(await acessaLead(user, n.leadId))) return { erro: 'Você não tem acesso a esta negociação.', status: 403 }
      return { tipo, negociacaoId: n.id, leadId: n.leadId ?? null }
    }
    if (tipo === 'tarefa') {
      const titulo = String(bruto?.titulo ?? '').trim().slice(0, 191)
      if (!titulo) return { erro: 'Descreva a tarefa.' }
      const prazo = bruto?.prazo ? new Date(bruto.prazo) : null
      if (prazo && Number.isNaN(prazo.getTime())) return { erro: 'Prazo inválido.' }
      const detalhe = typeof bruto?.detalhe === 'string' ? bruto.detalhe.trim().slice(0, 1000) || null : null
      let atividadeId: number | null = null
      // Sobre um lead: vira atividade de verdade (aparece em Atividades).
      if (leadId) {
        const a = await prisma.activity.create({
          data: {
            leadId, userId: user.userId, userName: (await pessoasPorId([user.userId])).get(user.userId)?.nome ?? null,
            assignedUserId: paraUserId ?? user.userId, type: 'task', title: titulo, description: detalhe,
            scheduledAt: prazo ?? new Date(Date.now() + 86400_000), metadata: { origem: 'equipe', conversaId: conversa.id },
          },
          select: { id: true },
        }).catch(() => null)
        atividadeId = a?.id ?? null
      }
      return { tipo, titulo, detalhe, prazo: prazo?.toISOString() ?? null, paraUserId, leadId, status: 'aberta', atividadeId }
    }
    return { erro: 'Cartão inválido.' }
  }

  // ── Pessoas, equipes e referências (para os seletores) ──
  app.get('/api/equipe/pessoas', auth, async (req) => {
    const user = eu(req)
    const q = String((req.query as any)?.q ?? '').trim()
    const us = await prisma.user.findMany({
      where: { active: true, id: { not: user.userId }, ...(q ? { OR: [{ name: { contains: q } }, { displayName: { contains: q } }, { email: { contains: q } }] } : {}) },
      select: { id: true },
      take: 200,
      orderBy: { name: 'asc' },
    })
    const pessoas = await pessoasPorId(us.map((u) => u.id))
    const equipes = await prisma.team.findMany({ where: { active: true, ...(q ? { name: { contains: q } } : {}) }, select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } })
    const membros = await prisma.teamMember.findMany({ where: { teamId: { in: equipes.map((e) => e.id) } }, select: { teamId: true, userId: true } })
    return {
      pessoas: [...pessoas.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.nome.localeCompare(b.nome, 'pt-BR')),
      equipes: equipes.map((e) => ({ ...e, membros: membros.filter((m) => m.teamId === e.id).map((m) => m.userId) })),
    }
  })

  app.get('/api/equipe/referencias', auth, async (req) => {
    const user = eu(req)
    const q = String((req.query as any)?.q ?? '').trim()
    const tipo = String((req.query as any)?.tipo ?? 'lead')
    const { buildLeadAccessWhere } = await import('../lib/teamAccess.js')
    const alcance = await buildLeadAccessWhere(user.userId, user.role as any)
    const digitos = q.replace(/\D/g, '')
    if (tipo === 'negociacao') {
      const leadsVisiveis = await prisma.lead.findMany({
        where: { AND: [alcance ?? {}, q ? { OR: [{ nome: { contains: q } }, ...(digitos.length >= 4 ? [{ whatsapp: { contains: digitos } }] : [])] } : {}] },
        select: { id: true, nome: true }, take: 50, orderBy: { lastMessageAt: 'desc' },
      })
      const ns = await prisma.negotiation.findMany({
        where: { OR: [{ leadId: { in: leadsVisiveis.map((l) => l.id) } }, ...(q ? [{ titulo: { contains: q } }] : [])] },
        select: { id: true, titulo: true, status: true, valorFinal: true, moeda: true, leadId: true },
        take: 40, orderBy: { updatedAt: 'desc' },
      }).catch(() => [])
      const nomeLead = new Map(leadsVisiveis.map((l) => [l.id, l.nome]))
      const out: any[] = []
      for (const n of ns) {
        if (n.leadId && !nomeLead.has(n.leadId) && !(await acessaLead(user, n.leadId))) continue
        out.push({ id: n.id, titulo: n.titulo, status: n.status, valor: n.valorFinal != null ? Number(n.valorFinal) : null, moeda: n.moeda, lead: n.leadId ? nomeLead.get(n.leadId) ?? null : null })
        if (out.length >= 20) break
      }
      return { itens: out }
    }
    const leads = await prisma.lead.findMany({
      where: { AND: [alcance ?? {}, q ? { OR: [{ nome: { contains: q } }, { email: { contains: q } }, ...(digitos.length >= 4 ? [{ whatsapp: { contains: digitos } }] : []), ...(/^\d+$/.test(q) ? [{ id: Number(q) }] : [])] } : {}] },
      select: { id: true, nome: true, whatsapp: true, status: true, assignedUser: { select: { name: true, displayName: true } } },
      take: 20, orderBy: { lastMessageAt: 'desc' },
    })
    return { itens: leads.map((l) => ({ id: l.id, nome: l.nome, whatsapp: l.whatsapp, atendente: l.assignedUser ? (l.assignedUser.displayName || l.assignedUser.name) : null })) }
  })

  // ── Busca nas minhas conversas ──
  app.get('/api/equipe/busca', auth, async (req) => {
    const user = eu(req)
    const q = String((req.query as any)?.q ?? '').trim()
    if (q.length < 2) return { resultados: [] }
    await sincronizarCanaisDe(user.userId)
    const minhas = await prisma.equipeMembro.findMany({ where: { userId: user.userId }, select: { conversaId: true } })
    const msgs = await prisma.equipeMensagem.findMany({
      where: { conversaId: { in: minhas.map((m) => m.conversaId) }, apagadaEm: null, corpo: { contains: q } },
      orderBy: { id: 'desc' }, take: 30,
      select: { id: true, conversaId: true, userId: true, corpo: true, createdAt: true },
    })
    const autores = await pessoasPorId(msgs.map((m) => m.userId).filter(Boolean) as number[])
    return {
      resultados: msgs.map((m) => ({
        id: m.id, conversaId: m.conversaId, autor: m.userId ? autores.get(m.userId)?.nome ?? null : null,
        trecho: String(m.corpo ?? '').replace(/@\[([^\]]+)\]\([ut]:\d+\)/g, '@$1').slice(0, 200), em: m.createdAt,
      })),
    }
  })

  // ── Anexos ──
  app.post('/api/equipe/anexos', auth, async (req, reply) => {
    const MAX = 25 * 1024 * 1024
    const data = await (req as any).file({ limits: { fileSize: MAX } })
    if (!data) return reply.code(400).send({ error: 'Nenhum arquivo enviado.' })
    const ext = String(data.filename.split('.').pop() || '').toLowerCase()
    const permitidas = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip', 'mp4', 'mov', 'mp3', 'm4a', 'ogg', 'wav', 'webm']
    if (!permitidas.includes(ext)) return reply.code(400).send({ error: `Tipo de arquivo não permitido: .${ext}` })
    const perigosas = ['php', 'phtml', 'exe', 'sh', 'bat', 'cmd', 'ps1', 'py', 'rb', 'pl', 'cgi', 'jsp', 'asp', 'aspx', 'html', 'htm', 'svg', 'js']
    if (data.filename.split('.').slice(0, -1).some((p: string) => perigosas.includes(p.toLowerCase()))) return reply.code(400).send({ error: 'Nome de arquivo suspeito.' })
    const { bufferMultipart, validateUploadContent, UploadTooLargeError, UploadValidationError } = await import('../lib/uploadSafety.js')
    let buf: Buffer
    try {
      buf = await bufferMultipart(data.file, MAX)
      if (data.file.truncated) throw new UploadTooLargeError('grande')
      buf = validateUploadContent(buf, ext)
    } catch (e: any) {
      if (e instanceof UploadTooLargeError) return reply.code(413).send({ error: 'Arquivo grande demais (máximo 25 MB).' })
      if (e instanceof UploadValidationError) return reply.code(400).send({ error: e.message })
      throw e
    }
    if (!buf.length) return reply.code(400).send({ error: 'O arquivo chegou vazio.' })
    const { mkdirSync, writeFileSync } = await import('fs')
    const { randomUUID } = await import('crypto')
    const { uploadsPath } = await import('../lib/uploadsDir.js')
    const mes = new Date().toISOString().slice(0, 7)
    const pasta = uploadsPath('equipe', mes)
    mkdirSync(pasta, { recursive: true })
    const nome = `${randomUUID()}.${ext}`
    writeFileSync(uploadsPath('equipe', mes, nome), buf)
    return { url: `/uploads/equipe/${mes}/${nome}`, nome: String(data.filename).slice(0, 191), tipo: String(data.mimetype || '').split(';')[0], tamanho: buf.length }
  })
}
