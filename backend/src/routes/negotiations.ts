// src/routes/negotiations.ts
// Negociação/proposta do lead (pipeline). Itens vêm do Catálogo (productId) ou
// livres. Ao fechar, atualiza Lead.outcome + motivo de perda (LossReason).

import { FastifyInstance } from 'fastify'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { buildNegotiationSuggestion } from '../services/negotiationSuggestion.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

interface ItemInput {
  productId?: number | null; nome: string; quantidade?: number; precoUnit?: number; descontoItem?: number | null
  cobranca?: string; parcelas?: number | null; recorrenciaMeses?: number | null
}

/** `recorrente` = mensalidade (MRR); qualquer outro valor cai em `unico`. */
function normCobranca(v: unknown): 'unico' | 'recorrente' {
  return String(v ?? '').toLowerCase() === 'recorrente' ? 'recorrente' : 'unico'
}
/** Dia do vencimento da mensalidade: 1..31, ou null. */
function diaDoMes(v: unknown): number | null {
  const n = num(v)
  if (n == null) return null
  const i = Math.round(n)
  return i >= 1 && i <= 31 ? i : null
}
/** Parcelas/meses: inteiro ≥ 1, ou null (à vista / sem prazo declarado). */
function posInt(v: unknown): number | null {
  const n = num(v)
  if (n == null) return null
  const i = Math.round(n)
  return i >= 1 ? i : null
}

interface NormItem {
  productId: number | null; nome: string; quantidade: number; precoUnit: number
  descontoItem: number | null; subtotal: number
  cobranca: 'unico' | 'recorrente'; parcelas: number | null; recorrenciaMeses: number | null
}

function normItems(raw: any[]): NormItem[] {
  return (Array.isArray(raw) ? raw : []).map((i: ItemInput) => {
    const quantidade = Math.max(1, Math.round(num(i.quantidade) ?? 1))
    const precoUnit = num(i.precoUnit) ?? 0
    const descontoItem = num(i.descontoItem)
    const subtotal = Math.max(0, precoUnit * quantidade - (descontoItem ?? 0))
    const cobranca = normCobranca(i.cobranca)
    return {
      productId: i.productId ? Number(i.productId) : null, nome: String(i.nome || '').slice(0, 191),
      quantidade, precoUnit, descontoItem, subtotal, cobranca,
      // Cada campo só faz sentido de um lado do toggle — zerar o outro evita
      // guardar "6x" numa mensalidade e confundir quem ler a proposta depois.
      parcelas: cobranca === 'unico' ? posInt(i.parcelas) : null,
      recorrenciaMeses: cobranca === 'recorrente' ? posInt(i.recorrenciaMeses) : null,
    }
  }).filter((i) => i.nome)
}

/**
 * Totais da negociação, separando mensalidade de pagamento único.
 *
 * Cada bloco tem o SEU desconto: ceder no valor cobrado uma vez e ceder na
 * mensalidade são concessões diferentes, de valores diferentes — antes um só era
 * rateado entre os dois e não dava para dizer onde ele realmente caiu. Os
 * acréscimos (frete, taxas) pertencem ao único: taxa pontual não é recorrente.
 *
 * `valorFinal` continua sendo o valor de face do 1º ciclo (único + 1 ×
 * mensalidade) — é o que os relatórios e o `saleValue` do lead já usavam, e
 * numa proposta sem mensalidade o número não muda em nada.
 */
export interface DiscountInput {
  descontoTipo: string | null
  descontoValor: number | null
  descontoRecTipo: string | null
  descontoRecValor: number | null
  frete: number | null
}

function aplicaDesconto(subtotal: number, tipo: string | null, valor: number | null): number {
  if (!valor) return 0
  return tipo === 'percent' ? subtotal * (valor / 100) : valor
}

function computeTotals(items: { subtotal: number; cobranca?: string }[], d: DiscountInput) {
  const subUnico = items.reduce((s, i) => s + (normCobranca(i.cobranca) === 'unico' ? i.subtotal : 0), 0)
  const subRecorrente = items.reduce((s, i) => s + (normCobranca(i.cobranca) === 'recorrente' ? i.subtotal : 0), 0)
  const descUnico = aplicaDesconto(subUnico, d.descontoTipo, d.descontoValor)
  const descRecorrente = aplicaDesconto(subRecorrente, d.descontoRecTipo, d.descontoRecValor)
  const valorUnico = Math.max(0, subUnico - descUnico + (d.frete ?? 0))
  const valorRecorrente = Math.max(0, subRecorrente - descRecorrente)
  return {
    valorTabela: subUnico + subRecorrente,
    valorUnico: round2(valorUnico),
    valorRecorrente: round2(valorRecorrente),
    valorFinal: round2(valorUnico + valorRecorrente),
  }
}
function round2(n: number): number { return Math.round(n * 100) / 100 }

const STATUSES = ['rascunho', 'enviada', 'em_negociacao', 'aceita', 'recusada', 'expirada']

export async function negotiationsRoutes(app: FastifyInstance) {
  // Lista de negociações de um lead.
  app.get('/api/admin/negotiations', { preHandler: authMiddleware }, async (req) => {
    const leadId = Number((req.query as any)?.leadId)
    if (!leadId) return { negotiations: [] }
    const rows = await prisma.negotiation.findMany({
      where: { leadId }, orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true, attachments: true } } },
    })
    return { negotiations: rows }
  })

  // ── Tela do módulo: todas as negociações + KPIs ────────────────────────
  //
  // O `where` sai de duas partes: o que é da própria negociação (status,
  // resultado, responsável, período) e o que é do LEAD (funil, busca por nome).
  // `Negotiation` só guarda `leadId` escalar — sem relação declarada —, então o
  // recorte por lead vira um `in` de ids resolvido antes. Cabe: negociação é uma
  // por oportunidade, não uma por mensagem.
  //
  // Período: negociação fechada pertence à data do FECHAMENTO, aberta à de
  // criação. Filtrar as duas por `createdAt` esconderia o que foi fechado no mês
  // mas proposto antes — que é justamente o que a gestão quer ver.
  app.get('/api/admin/negotiations/overview', { preHandler: authMiddleware }, async (req, reply) => {
    const q = req.query as any
    const page = Math.max(1, Number(q.page) || 1)
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))
    const from = q.dateFrom ? new Date(String(q.dateFrom) + 'T00:00:00.000Z') : null
    const to = q.dateTo ? new Date(String(q.dateTo) + 'T23:59:59.999Z') : null
    const statusList = String(q.status || '').split(',').map((s) => s.trim()).filter((s) => STATUSES.includes(s))
    const resultado = q.resultado === 'won' || q.resultado === 'lost' ? q.resultado : q.resultado === 'open' ? 'open' : null
    const responsavelUserId = Number(q.responsavelUserId) > 0 ? Number(q.responsavelUserId) : null
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : null
    const cobranca = q.cobranca === 'recorrente' || q.cobranca === 'unico' ? q.cobranca : null
    const search = String(q.q || '').trim()
    const orderBy = String(q.orderBy || 'recent')

    // Ids de lead quando o filtro é do lado do lead (funil ou busca por nome).
    let leadIdFilter: number[] | null = null
    if (funnelId || search) {
      const leadWhere: any = {}
      if (funnelId) leadWhere.funnelId = funnelId
      if (search) leadWhere.OR = [{ nome: { contains: search } }, { email: { contains: search } }, { whatsapp: { contains: search } }]
      const leads = await prisma.lead.findMany({ where: leadWhere, select: { id: true }, take: 5000 })
      leadIdFilter = leads.map((l) => l.id)
    }

    const where: any = {}
    if (statusList.length) where.status = { in: statusList }
    if (resultado === 'open') where.resultado = null
    else if (resultado) where.resultado = resultado
    if (responsavelUserId) where.responsavelUserId = responsavelUserId
    if (cobranca === 'recorrente') where.valorRecorrente = { gt: 0 }
    if (cobranca === 'unico') where.valorUnico = { gt: 0 }
    if (leadIdFilter) where.leadId = { in: leadIdFilter.length ? leadIdFilter : [-1] }
    // Busca também casa com o título da proposta, não só com o lead.
    if (search && leadIdFilter) {
      delete where.leadId
      where.OR = [{ leadId: { in: leadIdFilter.length ? leadIdFilter : [-1] } }, { titulo: { contains: search } }]
    }
    if (from || to) {
      const range: any = {}
      if (from) range.gte = from
      if (to) range.lte = to
      const periodo = [{ fechadaEm: range }, { AND: [{ resultado: null }, { createdAt: range }] }]
      where.AND = [...(where.AND ?? []), { OR: periodo }]
    }

    const order: any = orderBy === 'value' ? [{ valorFinal: 'desc' }]
      : orderBy === 'mrr' ? [{ valorRecorrente: 'desc' }]
      : orderBy === 'oldest' ? [{ createdAt: 'asc' }]
      : [{ createdAt: 'desc' }]

    // Exportação: o mesmo recorte da tela, sem paginação (teto de 5.000 linhas
    // para não montar um arquivo que ninguém abre).
    if (q.format === 'csv') {
      const todas = await prisma.negotiation.findMany({ where, orderBy: order, take: 5000 })
      const ids = Array.from(new Set(todas.map((n) => n.leadId)))
      const uids = Array.from(new Set(todas.map((n) => n.responsavelUserId).filter((v): v is number => !!v)))
      const [ls, us] = await Promise.all([
        ids.length ? prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }) : [],
        uids.length ? prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }) : [],
      ])
      const lname = new Map(ls.map((l) => [l.id, l.nome]))
      const uname = new Map(us.map((u) => [u.id, u.name]))
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const head = ['Lead', 'Proposta', 'Status', 'Resultado', 'Pagamento único', 'Mensalidade', 'Total 1º ciclo', 'Responsável', 'Criada em', 'Fechada em']
      const linhas = todas.map((n) => [
        lname.get(n.leadId) ?? `Lead #${n.leadId}`, n.titulo, n.status, n.resultado ?? 'em aberto',
        n.valorUnico ?? 0, n.valorRecorrente ?? 0, n.valorFinal ?? 0,
        n.responsavelUserId ? uname.get(n.responsavelUserId) ?? '' : '',
        n.createdAt.toISOString().slice(0, 10), n.fechadaEm ? n.fechadaEm.toISOString().slice(0, 10) : '',
      ].map(esc).join(';'))
      // BOM + ';' para o Excel em pt-BR abrir sem passar pelo assistente de importação.
      return reply
        .header('Content-Disposition', 'attachment; filename="negociacoes.csv"')
        .type('text/csv; charset=utf-8')
        .send('﻿' + [head.map(esc).join(';'), ...linhas].join('\n'))
    }

    const [rows, total, agrupado] = await Promise.all([
      prisma.negotiation.findMany({
        where, orderBy: order, skip: (page - 1) * limit, take: limit,
        include: { _count: { select: { items: true, attachments: true } } },
      }),
      prisma.negotiation.count({ where }),
      // Pipeline por status (contagem + valores) — alimenta as colunas do quadro
      // e os totais de cada uma sem uma segunda volta ao banco por coluna.
      prisma.negotiation.groupBy({
        by: ['status'], where,
        _count: { _all: true }, _sum: { valorUnico: true, valorRecorrente: true, valorFinal: true },
      }),
    ])

    // Nome do lead e do responsável só dos registros da página.
    const leadIds = Array.from(new Set(rows.map((r) => r.leadId)))
    const userIds = Array.from(new Set(rows.map((r) => r.responsavelUserId).filter((v): v is number => !!v)))
    const [leads, users] = await Promise.all([
      leadIds.length ? prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, nome: true, email: true, whatsapp: true, funnelId: true, status: true } }) : [],
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ])
    const leadById = new Map(leads.map((l) => [l.id, l]))
    const userById = new Map(users.map((u) => [u.id, u]))

    // KPIs do recorte ATUAL (mesmo `where`), menos o filtro de resultado: os
    // cards mostram aberto x ganho x perdido lado a lado, então filtrar por
    // resultado antes deixaria dois deles sempre zerados.
    const kpiWhere: any = { ...where }
    delete kpiWhere.resultado
    const [aberto, ganho, perdidoCount] = await Promise.all([
      prisma.negotiation.aggregate({ where: { ...kpiWhere, resultado: null }, _sum: { valorUnico: true, valorRecorrente: true, valorFinal: true }, _count: { _all: true } }),
      prisma.negotiation.aggregate({ where: { ...kpiWhere, resultado: 'won' }, _sum: { valorUnico: true, valorRecorrente: true, valorFinal: true }, _count: { _all: true } }),
      prisma.negotiation.count({ where: { ...kpiWhere, resultado: 'lost' } }),
    ])
    const dec = (v: unknown) => (v != null ? Number(v) : 0)
    const wonCount = ganho._count._all
    const fechadas = wonCount + perdidoCount

    return {
      negotiations: rows.map((n) => ({
        ...n,
        lead: leadById.get(n.leadId) ?? null,
        responsavelNome: n.responsavelUserId ? userById.get(n.responsavelUserId)?.name ?? null : null,
      })),
      total, page, limit,
      byStatus: agrupado.map((g) => ({
        status: g.status, count: g._count._all,
        valorUnico: dec(g._sum.valorUnico), valorRecorrente: dec(g._sum.valorRecorrente), valorFinal: dec(g._sum.valorFinal),
      })),
      kpis: {
        openCount: aberto._count._all,
        openUnico: dec(aberto._sum.valorUnico), openMrr: dec(aberto._sum.valorRecorrente), openTotal: dec(aberto._sum.valorFinal),
        wonCount, wonUnico: dec(ganho._sum.valorUnico), wonMrr: dec(ganho._sum.valorRecorrente), wonTotal: dec(ganho._sum.valorFinal),
        lostCount: perdidoCount,
        winRate: fechadas > 0 ? Math.round((wonCount / fechadas) * 100) : null,
        avgTicket: wonCount > 0 ? Math.round(dec(ganho._sum.valorFinal) / wonCount) : 0,
      },
    }
  })

  // Uma negociação (itens + anexos + motivo de perda).
  app.get('/api/admin/negotiations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const n = await prisma.negotiation.findUnique({
      where: { id },
      include: { items: true, attachments: { orderBy: { createdAt: 'desc' } } },
    })
    if (!n) return reply.code(404).send({ error: 'Negociação não encontrada' })
    const lostReason = n.lostReasonId
      ? await prisma.lossReason.findUnique({ where: { id: n.lostReasonId } }).catch(() => null)
      : null
    return { negotiation: { ...n, lostReason, attachments: n.attachments.map((a) => ({ ...a, url: fileUrl(a.storagePath) })) } }
  })

  // Rascunho sugerido a partir do que o lead já traz da Kommo (curso + valor de
  // tabela, forma de pagamento, parcelamento, desconto). Não persiste nada — a
  // UI usa para pré-preencher o formulário de nova negociação.
  app.get('/api/admin/negotiations/suggestion/:leadId', { preHandler: authMiddleware }, async (req) => {
    const leadId = Number((req.params as any).leadId)
    if (!leadId) return { suggestion: null }
    const suggestion = await buildNegotiationSuggestion(leadId).catch(() => null)
    return { suggestion }
  })

  // Criar.
  app.post('/api/admin/negotiations', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.leadId) return reply.code(400).send({ error: 'leadId é obrigatório' })
    const items = normItems(b.items)
    const descontoTipo = b.descontoTipo === 'percent' ? 'percent' : (b.descontoValor != null ? 'valor' : null)
    const descontoValor = num(b.descontoValor)
    const descontoRecTipo = b.descontoRecTipo === 'percent' ? 'percent' : (b.descontoRecValor != null ? 'valor' : null)
    const descontoRecValor = num(b.descontoRecValor)
    const frete = num(b.frete)
    const { valorTabela, valorFinal, valorUnico, valorRecorrente } = computeTotals(items, { descontoTipo, descontoValor, descontoRecTipo, descontoRecValor, frete })
    const actor = auditActor(req)
    const n = await prisma.negotiation.create({
      data: {
        leadId: Number(b.leadId), titulo: String(b.titulo || 'Proposta').slice(0, 191),
        status: STATUSES.includes(b.status) ? b.status : 'rascunho',
        valorTabela, descontoTipo, descontoValor, frete, valorFinal, valorUnico, valorRecorrente,
        descontoRecTipo, descontoRecValor,
        pagamentoFormaRec: b.pagamentoFormaRec ? String(b.pagamentoFormaRec).slice(0, 20) : null,
        vencimentoDiaRec: diaDoMes(b.vencimentoDiaRec),
        pagamentoForma: b.pagamentoForma ? String(b.pagamentoForma).slice(0, 20) : null,
        parcelas: num(b.parcelas) ? Math.round(num(b.parcelas)!) : null,
        entrada: num(b.entrada), condicaoPagamento: b.condicaoPagamento ? String(b.condicaoPagamento).slice(0, 2000) : null,
        probabilidade: b.probabilidade != null ? Math.max(0, Math.min(100, Math.round(num(b.probabilidade) ?? 0))) : null,
        validadeAte: b.validadeAte ? new Date(b.validadeAte) : null,
        fechamentoPrevisto: b.fechamentoPrevisto ? new Date(b.fechamentoPrevisto) : null,
        responsavelUserId: b.responsavelUserId ? Number(b.responsavelUserId) : actor.actorId,
        observacoes: b.observacoes ? String(b.observacoes).slice(0, 5000) : null,
        items: { create: items },
      },
      include: { items: true },
    })
    void logUserAudit({ action: 'negotiation.created', targetType: 'lead', targetUserId: null, targetLabel: `Negociação ${n.titulo}`, changes: { leadId: n.leadId, valorFinal, valorUnico, valorRecorrente }, ...actor })
    return { negotiation: n }
  })

  // Atualizar (substitui itens + recalcula).
  app.put('/api/admin/negotiations/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const cur = await prisma.negotiation.findUnique({ where: { id } })
    if (!cur) return reply.code(404).send({ error: 'Negociação não encontrada' })
    const items = b.items !== undefined ? normItems(b.items) : null
    const descontoTipo = b.descontoTipo !== undefined ? (b.descontoTipo === 'percent' ? 'percent' : (b.descontoValor != null ? 'valor' : null)) : cur.descontoTipo
    const descontoValor = b.descontoValor !== undefined ? num(b.descontoValor) : (cur.descontoValor != null ? Number(cur.descontoValor) : null)
    const descontoRecTipo = b.descontoRecTipo !== undefined ? (b.descontoRecTipo === 'percent' ? 'percent' : (b.descontoRecValor != null ? 'valor' : null)) : cur.descontoRecTipo
    const descontoRecValor = b.descontoRecValor !== undefined ? num(b.descontoRecValor) : (cur.descontoRecValor != null ? Number(cur.descontoRecValor) : null)
    const frete = b.frete !== undefined ? num(b.frete) : (cur.frete != null ? Number(cur.frete) : null)
    const baseItems = items ?? (await prisma.negotiationItem.findMany({ where: { negotiationId: id }, select: { subtotal: true, cobranca: true } })).map((i) => ({ subtotal: Number(i.subtotal), cobranca: i.cobranca }))
    const { valorTabela, valorFinal, valorUnico, valorRecorrente } = computeTotals(baseItems, { descontoTipo, descontoValor, descontoRecTipo, descontoRecValor, frete })
    const data: any = { valorTabela, valorFinal, valorUnico, valorRecorrente, descontoTipo, descontoValor, descontoRecTipo, descontoRecValor, frete }
    if (b.pagamentoFormaRec !== undefined) data.pagamentoFormaRec = b.pagamentoFormaRec ? String(b.pagamentoFormaRec).slice(0, 20) : null
    if (b.vencimentoDiaRec !== undefined) data.vencimentoDiaRec = diaDoMes(b.vencimentoDiaRec)
    if (b.titulo !== undefined) data.titulo = String(b.titulo).slice(0, 191)
    if (b.status !== undefined && STATUSES.includes(b.status)) data.status = b.status
    if (b.pagamentoForma !== undefined) data.pagamentoForma = b.pagamentoForma ? String(b.pagamentoForma).slice(0, 20) : null
    if (b.parcelas !== undefined) data.parcelas = num(b.parcelas) ? Math.round(num(b.parcelas)!) : null
    if (b.entrada !== undefined) data.entrada = num(b.entrada)
    if (b.condicaoPagamento !== undefined) data.condicaoPagamento = b.condicaoPagamento ? String(b.condicaoPagamento).slice(0, 2000) : null
    if (b.probabilidade !== undefined) data.probabilidade = b.probabilidade != null ? Math.max(0, Math.min(100, Math.round(num(b.probabilidade) ?? 0))) : null
    if (b.validadeAte !== undefined) data.validadeAte = b.validadeAte ? new Date(b.validadeAte) : null
    if (b.fechamentoPrevisto !== undefined) data.fechamentoPrevisto = b.fechamentoPrevisto ? new Date(b.fechamentoPrevisto) : null
    if (b.observacoes !== undefined) data.observacoes = b.observacoes ? String(b.observacoes).slice(0, 5000) : null
    if (items) { await prisma.negotiationItem.deleteMany({ where: { negotiationId: id } }); data.items = { create: items } }
    const n = await prisma.negotiation.update({ where: { id }, data, include: { items: true } })
    return { negotiation: n }
  })

  app.delete('/api/admin/negotiations/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.negotiation.delete({ where: { id } }).catch(() => {})
    return { ok: true }
  })

  // Fechar (ganha/perdida) → atualiza outcome do lead + motivo de perda.
  app.post('/api/admin/negotiations/:id/close', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    const resultado = b.resultado === 'won' ? 'won' : b.resultado === 'lost' ? 'lost' : null
    if (!resultado) return reply.code(400).send({ error: 'resultado deve ser won ou lost' })
    const n = await prisma.negotiation.findUnique({ where: { id } })
    if (!n) return reply.code(404).send({ error: 'Negociação não encontrada' })
    const actor = auditActor(req)
    // A UI pode fechar com um total diferente do salvo (ajuste de última hora).
    // Nesse caso o split mensal/único acompanha na mesma proporção — sem isso os
    // KPIs de recorrência ficariam contando um valor que a negociação não tem mais.
    const storedFinal = n.valorFinal != null ? Number(n.valorFinal) : null
    const closingFinal = num(b.valorFinal) ?? storedFinal
    const ratio = storedFinal && closingFinal != null && storedFinal > 0 ? closingFinal / storedFinal : 1
    const splitPatch = ratio === 1 ? {} : {
      valorUnico: n.valorUnico != null ? round2(Number(n.valorUnico) * ratio) : null,
      valorRecorrente: n.valorRecorrente != null ? round2(Number(n.valorRecorrente) * ratio) : null,
    }
    const updated = await prisma.negotiation.update({
      where: { id },
      data: {
        resultado, status: resultado === 'won' ? 'aceita' : 'recusada',
        lostReasonId: resultado === 'lost' && b.lostReasonId ? Number(b.lostReasonId) : null,
        fechadaEm: new Date(), fechadaPor: actor.actorId,
        valorFinal: closingFinal,
        ...splitPatch,
      },
    })
    // Reflete no lead (Fase 23: outcome won/lost + motivo de perda). Ganha
    // também grava saleValue = total da negociação → entra na "Receita ganha"
    // da Visão Geral/Relatórios sem precisar de mais nada.
    const finalValue = updated.valorFinal != null ? Number(updated.valorFinal) : null
    const leadClosed = await prisma.lead.update({
      where: { id: n.leadId },
      data: {
        outcome: resultado, outcomeAt: new Date(), outcomeBy: actor.actorId,
        lostReasonId: resultado === 'lost' && b.lostReasonId ? Number(b.lostReasonId) : undefined,
        saleValue: resultado === 'won' && finalValue != null ? finalValue : undefined,
      },
    }).then(() => true).catch(() => false)

    // Timeline do lead: fechar por aqui grava outcome/outcomeAt igual aos botões
    // Ganho/Perdido, mas antes não deixava rastro no histórico — o desfecho ficava
    // só na auditoria e na aba Negociação. Registra o evento no mesmo formato que
    // markLeadWon/markLeadLost para a Timeline mostrar quando e por quem.
    if (leadClosed) {
      let reasonName: string | undefined
      if (resultado === 'lost' && updated.lostReasonId) {
        const r = await prisma.lossReason.findUnique({
          where: { id: updated.lostReasonId },
          select: { name: true },
        }).catch(() => null)
        reasonName = r?.name ?? undefined
      }
      const via = `negociação "${n.titulo}"`
      // "R$ 8.000,00 + R$ 890,00/mês" — a timeline mostra a composição, senão um
      // contrato de mensalidade parece uma venda avulsa do valor do 1º ciclo.
      const unico = updated.valorUnico != null ? Number(updated.valorUnico) : null
      const mrr = updated.valorRecorrente != null ? Number(updated.valorRecorrente) : null
      const wonValue = mrr && mrr > 0
        ? `R$ ${(unico ?? 0).toFixed(2)} + R$ ${mrr.toFixed(2)}/mês`
        : finalValue != null ? `R$ ${finalValue.toFixed(2)}` : null
      logEvent({
        leadId: n.leadId,
        type: resultado === 'won' ? EVENT_TYPES.LEAD_WON : EVENT_TYPES.LEAD_LOST,
        category: 'lifecycle',
        title: resultado === 'won'
          ? (wonValue ? `Ganho na ${via} — ${wonValue}` : `Ganho na ${via}`)
          : (reasonName ? `Perdido na ${via} — ${reasonName}` : `Perdido na ${via}`),
        source: 'panel',
        actorType: actor.actorId ? 'operator' : 'system',
        userId: actor.actorId ?? undefined,
        userName: actor.actorName ?? undefined,
        metadata: {
          negotiationId: id,
          valorFinal: finalValue,
          valorUnico: unico,
          valorRecorrente: mrr,
          lostReasonId: updated.lostReasonId ?? null,
          reasonName: reasonName ?? null,
          viaNegotiation: true,
        },
        ipAddress: actor.ipAddress ?? undefined,
      })
    }
    void logUserAudit({ action: 'negotiation.closed', targetType: 'lead', targetLabel: `Negociação ${n.titulo} → ${resultado}`, changes: { resultado, valorFinal: updated.valorFinal, valorUnico: updated.valorUnico, valorRecorrente: updated.valorRecorrente }, ...actor })
    return { negotiation: updated }
  })

  // Reabrir uma negociação fechada (voltou a negociar / fechou sem querer).
  // Desfaz o outcome do lead apenas se ele veio desta negociação.
  app.post('/api/admin/negotiations/:id/reopen', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const n = await prisma.negotiation.findUnique({ where: { id } })
    if (!n) return reply.code(404).send({ error: 'Negociação não encontrada' })
    if (!n.resultado) return reply.code(400).send({ error: 'Negociação já está aberta' })
    const actor = auditActor(req)
    const prevResultado = n.resultado
    const updated = await prisma.negotiation.update({
      where: { id },
      data: { resultado: null, lostReasonId: null, fechadaEm: null, fechadaPor: null, status: 'em_negociacao' },
    })
    const lead = await prisma.lead.findUnique({ where: { id: n.leadId }, select: { outcome: true, saleValue: true } })
    if (lead?.outcome === prevResultado) {
      // O /close grava saleValue = total da negociação; reabrir sem devolver esse
      // campo deixava a "Receita ganha" contando uma venda que não existe mais.
      // Só limpa se o valor ainda for o desta negociação — se alguém digitou outro
      // valor no lead depois, ele manda.
      const saleFromThis = lead.saleValue != null && n.valorFinal != null
        && Number(lead.saleValue) === Number(n.valorFinal)
      const cleared = await prisma.lead.update({
        where: { id: n.leadId },
        data: {
          outcome: null, outcomeAt: null, outcomeBy: null, lostReasonId: null,
          ...(saleFromThis ? { saleValue: null } : {}),
        },
      }).then(() => true).catch(() => false)
      // Contrapartida do evento gravado no /close: sem isto a Timeline mostraria
      // um Ganho/Perdido que não vale mais (a data de encerramento foi apagada).
      if (cleared) {
        logEvent({
          leadId: n.leadId,
          type: EVENT_TYPES.LEAD_OUTCOME_CLEARED,
          category: 'lifecycle',
          title: `Desfecho desfeito — negociação "${n.titulo}" reaberta`,
          source: 'panel',
          actorType: actor.actorId ? 'operator' : 'system',
          userId: actor.actorId ?? undefined,
          userName: actor.actorName ?? undefined,
          metadata: { negotiationId: id, previousOutcome: prevResultado, viaNegotiation: true },
          ipAddress: actor.ipAddress ?? undefined,
        })
      }
    }
    void logUserAudit({ action: 'negotiation.reopened', targetType: 'lead', targetLabel: `Negociação ${n.titulo} reaberta`, changes: { prevResultado }, ...actor })
    return { negotiation: updated }
  })

  // Anexar a proposta enviada (arquivo).
  app.post('/api/admin/negotiations/:id/attachments', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const n = await prisma.negotiation.findUnique({ where: { id }, select: { id: true } })
    if (!n) return reply.code(404).send({ error: 'Negociação não encontrada' })
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Arquivo é obrigatório (multipart "file")' })
    const buffer = await data.toBuffer()
    const dir = join(process.cwd(), '..', 'uploads', 'negotiations')
    await fs.mkdir(dir, { recursive: true })
    const safe = (data.filename || 'proposta').replace(/[^\w.\-]+/g, '_').slice(0, 120)
    const fileName = `neg-${id}-${Date.now()}-${safe}`
    await fs.writeFile(join(dir, fileName), buffer)
    const storagePath = `negotiations/${fileName}`
    const att = await prisma.negotiationAttachment.create({
      data: { negotiationId: id, fileName: data.filename || fileName, storagePath, mimeType: data.mimetype || null, fileSize: buffer.length },
    })
    return { attachment: { ...att, url: fileUrl(storagePath) } }
  })

  app.delete('/api/admin/negotiations/attachments/:attId', { preHandler: authMiddleware }, async (req) => {
    const attId = Number((req.params as any).attId)
    const att = await prisma.negotiationAttachment.findUnique({ where: { id: attId } })
    if (att) {
      await fs.unlink(join(process.cwd(), '..', 'uploads', att.storagePath)).catch(() => {})
      await prisma.negotiationAttachment.delete({ where: { id: attId } }).catch(() => {})
    }
    return { ok: true }
  })
}
