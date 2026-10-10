// src/services/equipeChat.ts
//
// Equipe — chat interno entre pessoas e equipes, de qualquer papel.
//
//   · direta  — 1 a 1 (chave "menorId:maiorId", uma por par);
//   · equipe  — canal de cada equipe; os membros acompanham a equipe;
//   · grupo   — grupo livre, quem cria administra;
//   · lead    — conversa interna sobre um lead (aparece na ficha do lead);
//               lê quem tem acesso ao lead, entra como membro quem escreve ou
//               é mencionado.
//
// Cartões de ação (mensagem.cartao): lead, indicação, transferência (pedido
// REAL de transferência), negociação e tarefa. O cartão é montado para quem LÊ:
// lead fora do alcance de quem lê vira "Lead restrito", sem nome nem telefone.
//
// Avisos: evento de tempo real `equipe:*` para cada membro; o painel decide
// som e notificação (só direta e menção, e não em conversa silenciada).

import { prisma } from '../lib/prisma.js'
import type { JwtPayload } from '../lib/auth.js'

export type TipoConversa = 'direta' | 'grupo' | 'equipe' | 'lead'
export const PAPEIS_ADMIN = new Set(['SUPERADMIN', 'ADMIN'])

// ─── Pessoas ───────────────────────────────────────────────────────────────

export interface Pessoa { id: number; nome: string; email: string; role: string; workStatus: string | null; online: boolean }

export async function pessoasPorId(ids: Iterable<number>): Promise<Map<number, Pessoa>> {
  const lista = [...new Set([...ids].filter((n) => Number.isInteger(n) && n > 0))]
  if (!lista.length) return new Map()
  const { usuariosConectados } = await import('../routes/realtime.js')
  const on = usuariosConectados()
  const us = await prisma.user.findMany({
    where: { id: { in: lista } },
    select: { id: true, name: true, displayName: true, email: true, role: true, workStatus: true },
  })
  return new Map(us.map((u) => [u.id, {
    id: u.id, nome: u.displayName || u.name || u.email, email: u.email, role: u.role,
    workStatus: u.workStatus ?? null, online: on.has(u.id),
  }]))
}

// ─── Canais de equipe ──────────────────────────────────────────────────────

/**
 * Garante o canal de cada equipe ativa de que a pessoa participa, com os
 * membros iguais aos da equipe (entra quem entrou na equipe, sai quem saiu).
 */
export async function sincronizarCanaisDe(userId: number): Promise<void> {
  const minhas = await prisma.teamMember.findMany({ where: { userId, team: { active: true } }, select: { teamId: true } })
  for (const { teamId } of minhas) await sincronizarCanalDaEquipe(teamId)
}

export async function sincronizarCanalDaEquipe(teamId: number): Promise<number | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true, active: true } })
  if (!team?.active) return null
  let conversa = await prisma.equipeConversa.findUnique({ where: { teamId }, select: { id: true, nome: true } })
  if (!conversa) {
    conversa = await prisma.equipeConversa.create({
      data: { tipo: 'equipe', teamId, nome: team.name },
      select: { id: true, nome: true },
    }).catch(async () => prisma.equipeConversa.findUnique({ where: { teamId }, select: { id: true, nome: true } }))
    if (!conversa) return null
  } else if (conversa.nome !== team.name) {
    await prisma.equipeConversa.update({ where: { id: conversa.id }, data: { nome: team.name } })
  }
  const daEquipe = new Set((await prisma.teamMember.findMany({ where: { teamId, user: { active: true } }, select: { userId: true } })).map((m) => m.userId))
  const doCanal = new Set((await prisma.equipeMembro.findMany({ where: { conversaId: conversa.id }, select: { userId: true } })).map((m) => m.userId))
  const entrar = [...daEquipe].filter((u) => !doCanal.has(u))
  const sair = [...doCanal].filter((u) => !daEquipe.has(u))
  for (const u of entrar) {
    await prisma.equipeMembro.create({ data: { conversaId: conversa.id, userId: u } }).catch(() => {})
  }
  if (sair.length) await prisma.equipeMembro.deleteMany({ where: { conversaId: conversa.id, userId: { in: sair } } })
  return conversa.id
}

// ─── Acesso ────────────────────────────────────────────────────────────────

/** A pessoa pode ler esta conversa? Membro sempre; conversa de lead: quem tem acesso ao lead. */
export async function podeLer(user: JwtPayload, conversaId: number): Promise<{ ok: boolean; membro: boolean; conversa: { id: number; tipo: string; leadId: number | null } | null }> {
  const conversa = await prisma.equipeConversa.findUnique({ where: { id: conversaId }, select: { id: true, tipo: true, leadId: true } })
  if (!conversa) return { ok: false, membro: false, conversa: null }
  const m = await prisma.equipeMembro.findUnique({ where: { conversaId_userId: { conversaId, userId: user.userId } }, select: { id: true } })
  if (m) return { ok: true, membro: true, conversa }
  if (conversa.tipo === 'lead' && conversa.leadId) {
    return { ok: await acessaLead(user, conversa.leadId), membro: false, conversa }
  }
  return { ok: false, membro: false, conversa }
}

/** Mesma checagem da tela de Conversas (números reservados, matriz, alcance). */
export async function acessaLead(user: { userId: number; role: string }, leadId: number): Promise<boolean> {
  const { checarAcessoTicket } = await import('../routes/atendimento.js')
  const r = await checarAcessoTicket(user as JwtPayload, leadId, 'view').catch(() => ({ ok: false }))
  return r.ok
}

export async function garantirMembro(conversaId: number, userId: number): Promise<void> {
  await prisma.equipeMembro.create({ data: { conversaId, userId } }).catch(() => {})
}

// ─── Menções e links ───────────────────────────────────────────────────────

/** Menção no texto: @[Nome](u:12) ou @[Equipe](t:3). */
export function lerMencoes(corpo: string | null | undefined): { users: number[]; teams: number[] } {
  const users = new Set<number>()
  const teams = new Set<number>()
  for (const m of String(corpo ?? '').matchAll(/@\[[^\]]{1,80}\]\((u|t):(\d{1,9})\)/g)) {
    ;(m[1] === 'u' ? users : teams).add(Number(m[2]))
  }
  return { users: [...users], teams: [...teams] }
}

/** Links internos colados (…/app/leads/123, …/conversations?leadId=123) viram cartão. */
export function lerLinks(corpo: string | null | undefined): Array<{ tipo: 'lead'; id: number }> {
  const ids = new Set<number>()
  for (const m of String(corpo ?? '').matchAll(/\/app\/leads\/(\d{1,9})|conversations\?leadId=(\d{1,9})/g)) {
    ids.add(Number(m[1] ?? m[2]))
  }
  return [...ids].slice(0, 5).map((id) => ({ tipo: 'lead' as const, id }))
}

// ─── Cartões montados para quem lê ─────────────────────────────────────────

export interface ResumoDoLead {
  id: number
  restrito?: boolean
  nome?: string
  whatsapp?: string
  etapa?: string | null
  funil?: string | null
  atendente?: string | null
  semAtendente?: boolean
  ultimaMensagemEm?: string | null
}

async function resumoDoLead(user: JwtPayload, leadId: number, cache: Map<number, ResumoDoLead>): Promise<ResumoDoLead> {
  const c = cache.get(leadId)
  if (c) return c
  let r: ResumoDoLead
  if (!(await acessaLead(user, leadId))) {
    r = { id: leadId, restrito: true }
  } else {
    const l = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, nome: true, whatsapp: true, status: true, lastMessageAt: true, assignedUserId: true,
        assignedUser: { select: { name: true, displayName: true } },
        funnel: { select: { name: true, stages: { select: { key: true, name: true } } } },
      },
    })
    r = l
      ? {
          id: l.id, nome: l.nome, whatsapp: l.whatsapp,
          etapa: l.funnel?.stages.find((s) => s.key === l.status)?.name ?? l.status,
          funil: l.funnel?.name ?? null,
          atendente: l.assignedUser ? (l.assignedUser.displayName || l.assignedUser.name) : null,
          semAtendente: !l.assignedUserId,
          ultimaMensagemEm: l.lastMessageAt?.toISOString() ?? null,
        }
      : { id: leadId, restrito: true }
  }
  cache.set(leadId, r)
  return r
}

/** O cartão como esta pessoa vê, com o estado ao vivo e o que ela pode fazer. */
export async function montarCartao(user: JwtPayload, cartao: any, autorId: number | null, cache: Map<number, ResumoDoLead>): Promise<any> {
  if (!cartao || typeof cartao !== 'object') return null
  const tipo = String(cartao.tipo)
  const lead = cartao.leadId ? await resumoDoLead(user, Number(cartao.leadId), cache) : null
  const nomes = await pessoasPorId([cartao.paraUserId, cartao.concluidaPor, autorId].filter(Boolean))
  const para = cartao.paraUserId ? nomes.get(Number(cartao.paraUserId))?.nome ?? null : null

  if (tipo === 'lead') return { tipo, lead }
  if (tipo === 'indicacao') {
    return {
      tipo, lead, motivo: cartao.motivo ?? null, paraUserId: cartao.paraUserId ?? null, para,
      // "Assumir": lead sem atendente, e só para quem foi indicado (ou qualquer um, se a indicação foi para o grupo).
      podeAssumir: !!lead && !lead.restrito && !!lead.semAtendente && (!cartao.paraUserId || Number(cartao.paraUserId) === user.userId),
      assumidoPor: cartao.assumidoPor ? (await pessoasPorId([cartao.assumidoPor])).get(Number(cartao.assumidoPor))?.nome ?? null : null,
    }
  }
  if (tipo === 'transferencia') {
    const tr = cartao.transferRequestId
      ? await prisma.leadTransferRequest.findUnique({ where: { id: Number(cartao.transferRequestId) }, select: { id: true, status: true, fromUserId: true, toUserId: true, reason: true, response: true } }).catch(() => null)
      : null
    const quem = tr ? await pessoasPorId([tr.fromUserId, tr.toUserId]) : new Map()
    return {
      tipo, lead,
      status: tr?.status ?? 'desconhecido',
      de: tr ? quem.get(tr.fromUserId)?.nome ?? null : null,
      para: tr ? quem.get(tr.toUserId)?.nome ?? null : para,
      motivo: tr?.reason ?? cartao.motivo ?? null,
      resposta: tr?.response ?? null,
      podeResponder: !!tr && tr.status === 'pending' && tr.toUserId === user.userId,
      podeCancelar: !!tr && tr.status === 'pending' && tr.fromUserId === user.userId,
    }
  }
  if (tipo === 'negociacao') {
    const n = await prisma.negotiation.findUnique({
      where: { id: Number(cartao.negociacaoId) },
      select: { id: true, titulo: true, status: true, valorFinal: true, moeda: true, leadId: true },
    }).catch(() => null)
    if (!n) return { tipo, restrito: true }
    const doLead = n.leadId ? await resumoDoLead(user, n.leadId, cache) : null
    if (doLead?.restrito) return { tipo, restrito: true }
    return { tipo, negociacao: { id: n.id, titulo: n.titulo, status: n.status, valor: n.valorFinal != null ? Number(n.valorFinal) : null, moeda: n.moeda }, lead: doLead }
  }
  if (tipo === 'tarefa') {
    const ehResponsavel = !cartao.paraUserId || Number(cartao.paraUserId) === user.userId
    return {
      tipo, titulo: cartao.titulo, detalhe: cartao.detalhe ?? null, prazo: cartao.prazo ?? null,
      paraUserId: cartao.paraUserId ?? null, para, lead,
      status: cartao.status === 'concluida' ? 'concluida' : 'aberta',
      concluidaPor: cartao.concluidaPor ? nomes.get(Number(cartao.concluidaPor))?.nome ?? null : null,
      concluidaEm: cartao.concluidaEm ?? null,
      podeConcluir: cartao.status !== 'concluida' && (ehResponsavel || autorId === user.userId),
      podeReabrir: cartao.status === 'concluida' && (ehResponsavel || autorId === user.userId),
      atividadeId: cartao.atividadeId ?? null,
    }
  }
  return null
}

// ─── Mensagens para a tela ─────────────────────────────────────────────────

export async function montarMensagens(user: JwtPayload, msgs: any[]): Promise<any[]> {
  const autores = await pessoasPorId(msgs.map((m) => m.userId).filter(Boolean))
  const respostasIds = [...new Set(msgs.map((m) => m.respostaAId).filter(Boolean))] as number[]
  const respostas = respostasIds.length
    ? await prisma.equipeMensagem.findMany({ where: { id: { in: respostasIds } }, select: { id: true, userId: true, corpo: true, cartao: true, anexos: true, apagadaEm: true } })
    : []
  const autoresResp = await pessoasPorId(respostas.map((r) => r.userId).filter(Boolean) as number[])
  const porId = new Map(respostas.map((r) => [r.id, r]))
  const cache = new Map<number, ResumoDoLead>()
  const out: any[] = []
  for (const m of msgs) {
    const apagada = !!m.apagadaEm
    const r = m.respostaAId ? porId.get(m.respostaAId) : null
    const linkCards = !apagada && Array.isArray(m.links)
      ? await Promise.all((m.links as any[]).map((l) => resumoDoLead(user, Number(l.id), cache)))
      : []
    out.push({
      id: m.id,
      conversaId: m.conversaId,
      autor: m.userId ? autores.get(m.userId) ?? { id: m.userId, nome: 'Usuário removido' } : null,
      minha: m.userId === user.userId,
      sistema: !m.userId,
      corpo: apagada ? null : m.corpo,
      anexos: apagada ? [] : (m.anexos ?? []),
      cartao: apagada ? null : await montarCartao(user, m.cartao, m.userId, cache),
      linksDeLead: linkCards,
      mencionaMim: Array.isArray(m.mencoes?.users) && m.mencoes.users.includes(user.userId),
      reacoes: m.reacoes ?? {},
      resposta: r ? {
        id: r.id,
        autor: r.userId ? autoresResp.get(r.userId)?.nome ?? null : null,
        trecho: r.apagadaEm ? 'Mensagem apagada' : (r.corpo ? String(r.corpo).replace(/@\[([^\]]+)\]\([ut]:\d+\)/g, '@$1').slice(0, 140) : r.cartao ? `Cartão: ${(r.cartao as any).tipo}` : (r.anexos as any[])?.length ? 'Anexo' : ''),
      } : null,
      editada: !!m.editadaEm,
      apagada,
      createdAt: m.createdAt,
    })
  }
  return out
}

// ─── Lista de conversas ────────────────────────────────────────────────────

export async function conversasDe(user: JwtPayload): Promise<any[]> {
  await sincronizarCanaisDe(user.userId)
  const minhas = await prisma.equipeMembro.findMany({
    where: { userId: user.userId },
    select: {
      silenciada: true, ultimaLidaId: true, papel: true,
      conversa: { select: { id: true, tipo: true, nome: true, descricao: true, teamId: true, leadId: true, chaveDireta: true, ultimaMensagemEm: true, createdAt: true } },
    },
  })
  const ids = minhas.map((m) => m.conversa.id)
  if (!ids.length) return []

  // Outra pessoa de cada conversa direta.
  const outros = await prisma.equipeMembro.findMany({
    where: { conversaId: { in: minhas.filter((m) => m.conversa.tipo === 'direta').map((m) => m.conversa.id) }, userId: { not: user.userId } },
    select: { conversaId: true, userId: true },
  })
  const outroDe = new Map(outros.map((o) => [o.conversaId, o.userId]))
  const pessoas = await pessoasPorId(outros.map((o) => o.userId))
  const leads = await prisma.lead.findMany({ where: { id: { in: minhas.map((m) => m.conversa.leadId).filter(Boolean) as number[] } }, select: { id: true, nome: true } })
  const nomeLead = new Map(leads.map((l) => [l.id, l.nome]))
  const contagem = await prisma.equipeMembro.groupBy({ by: ['conversaId'], where: { conversaId: { in: ids } }, _count: { _all: true } })
  const membrosPorConversa = new Map(contagem.map((c) => [c.conversaId, c._count._all]))

  const out: any[] = []
  for (const m of minhas) {
    const c = m.conversa
    const ultima = await prisma.equipeMensagem.findFirst({
      where: { conversaId: c.id },
      orderBy: { id: 'desc' },
      select: { id: true, userId: true, corpo: true, cartao: true, anexos: true, apagadaEm: true, createdAt: true },
    })
    const naoLidas = await prisma.equipeMensagem.count({
      where: { conversaId: c.id, id: { gt: m.ultimaLidaId ?? 0 }, apagadaEm: null, OR: [{ userId: { not: user.userId } }, { userId: null }] },
    })
    const mencoes = naoLidas
      ? (await prisma.equipeMensagem.findMany({
          where: { conversaId: c.id, id: { gt: m.ultimaLidaId ?? 0 }, apagadaEm: null, NOT: { mencoes: { equals: null as any } } },
          select: { mencoes: true },
        }).catch(() => [])).filter((x: any) => Array.isArray(x.mencoes?.users) && x.mencoes.users.includes(user.userId)).length
      : 0
    const outro = c.tipo === 'direta' ? pessoas.get(outroDe.get(c.id) ?? 0) ?? null : null
    const nome = c.tipo === 'direta' ? (outro?.nome ?? 'Conversa') : c.tipo === 'lead' ? `Lead: ${nomeLead.get(c.leadId ?? 0) ?? `#${c.leadId}`}` : (c.nome ?? 'Grupo')
    const autorUltima = ultima?.userId ? (ultima.userId === user.userId ? 'Você' : (await pessoasPorId([ultima.userId])).get(ultima.userId)?.nome?.split(' ')[0] ?? '') : ''
    out.push({
      id: c.id, tipo: c.tipo, nome, descricao: c.descricao, teamId: c.teamId, leadId: c.leadId,
      outro,
      membros: membrosPorConversa.get(c.id) ?? 0,
      souAdmin: m.papel === 'admin',
      silenciada: m.silenciada,
      naoLidas, mencoes,
      ultima: ultima ? {
        id: ultima.id,
        autor: autorUltima,
        texto: ultima.apagadaEm ? 'Mensagem apagada'
          : ultima.corpo ? String(ultima.corpo).replace(/@\[([^\]]+)\]\([ut]:\d+\)/g, '@$1').slice(0, 120)
          : ultima.cartao ? rotuloDoCartao((ultima.cartao as any).tipo)
          : (ultima.anexos as any[])?.length ? '📎 Anexo' : '',
        em: ultima.createdAt,
      } : null,
      ordem: (ultima?.createdAt ?? c.ultimaMensagemEm ?? c.createdAt).toISOString(),
    })
  }
  return out.sort((a, b) => (a.ordem < b.ordem ? 1 : -1))
}

export function rotuloDoCartao(tipo: string): string {
  return ({ lead: '👤 Lead', indicacao: '👉 Indicação de lead', transferencia: '🔁 Transferência', negociacao: '💼 Negociação', tarefa: '✅ Tarefa' } as Record<string, string>)[tipo] ?? 'Cartão'
}

// ─── Avisos ────────────────────────────────────────────────────────────────

/** Avisa os membros (menos quem enviou) que chegou mensagem. */
export async function avisarNovaMensagem(conversaId: number, mensagemId: number, autorId: number | null, corpo: string | null, mencoes: { users: number[]; teams: number[] }): Promise<void> {
  const { enviarParaUsuarios } = await import('../routes/realtime.js')
  const conversa = await prisma.equipeConversa.findUnique({ where: { id: conversaId }, select: { tipo: true, nome: true } })
  const membros = await prisma.equipeMembro.findMany({ where: { conversaId }, select: { userId: true, silenciada: true } })
  const daEquipe = mencoes.teams.length
    ? new Set((await prisma.teamMember.findMany({ where: { teamId: { in: mencoes.teams } }, select: { userId: true } })).map((t) => t.userId))
    : new Set<number>()
  const autor = autorId ? (await pessoasPorId([autorId])).get(autorId)?.nome ?? '' : ''
  const previa = String(corpo ?? '').replace(/@\[([^\]]+)\]\([ut]:\d+\)/g, '@$1').slice(0, 140)
  for (const m of membros) {
    if (m.userId === autorId) continue
    const mencionado = mencoes.users.includes(m.userId) || daEquipe.has(m.userId)
    enviarParaUsuarios([m.userId], {
      type: 'equipe:mensagem',
      payload: {
        conversaId, mensagemId, autor, previa,
        direta: conversa?.tipo === 'direta',
        conversaNome: conversa?.tipo === 'direta' ? autor : conversa?.nome ?? null,
        mencionado, silenciada: m.silenciada,
      },
    })
  }
  // Quem enviou também atualiza as outras abas dele.
  if (autorId) enviarParaUsuarios([autorId], { type: 'equipe:atualizada', payload: { conversaId } })
}

/** Algo mudou na conversa (cartão, reação, edição, membros): todos recarregam. */
export async function avisarAtualizacao(conversaId: number): Promise<void> {
  const { enviarParaUsuarios } = await import('../routes/realtime.js')
  const membros = await prisma.equipeMembro.findMany({ where: { conversaId }, select: { userId: true } })
  enviarParaUsuarios(membros.map((m) => m.userId), { type: 'equipe:atualizada', payload: { conversaId } })
}

export async function mensagemDoSistema(conversaId: number, texto: string): Promise<void> {
  const m = await prisma.equipeMensagem.create({ data: { conversaId, userId: null, corpo: texto } })
  await prisma.equipeConversa.update({ where: { id: conversaId }, data: { ultimaMensagemEm: m.createdAt } })
}
