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

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function fileUrl(storagePath: string): string {
  const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3005}`
  return `${base}/uploads/${storagePath}`
}

interface ItemInput { productId?: number | null; nome: string; quantidade?: number; precoUnit?: number; descontoItem?: number | null }

function normItems(raw: any[]): { productId: number | null; nome: string; quantidade: number; precoUnit: number; descontoItem: number | null; subtotal: number }[] {
  return (Array.isArray(raw) ? raw : []).map((i: ItemInput) => {
    const quantidade = Math.max(1, Math.round(num(i.quantidade) ?? 1))
    const precoUnit = num(i.precoUnit) ?? 0
    const descontoItem = num(i.descontoItem)
    const subtotal = Math.max(0, precoUnit * quantidade - (descontoItem ?? 0))
    return { productId: i.productId ? Number(i.productId) : null, nome: String(i.nome || '').slice(0, 191), quantidade, precoUnit, descontoItem, subtotal }
  }).filter((i) => i.nome)
}

function computeTotals(items: { subtotal: number }[], descontoTipo: string | null, descontoValor: number | null, frete: number | null) {
  const valorTabela = items.reduce((s, i) => s + i.subtotal, 0)
  let desconto = 0
  if (descontoValor) desconto = descontoTipo === 'percent' ? valorTabela * (descontoValor / 100) : descontoValor
  const valorFinal = Math.max(0, valorTabela - desconto + (frete ?? 0))
  return { valorTabela, valorFinal }
}

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
    const frete = num(b.frete)
    const { valorTabela, valorFinal } = computeTotals(items, descontoTipo, descontoValor, frete)
    const actor = auditActor(req)
    const n = await prisma.negotiation.create({
      data: {
        leadId: Number(b.leadId), titulo: String(b.titulo || 'Proposta').slice(0, 191),
        status: STATUSES.includes(b.status) ? b.status : 'rascunho',
        valorTabela, descontoTipo, descontoValor, frete, valorFinal,
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
    void logUserAudit({ action: 'negotiation.created', targetType: 'lead', targetUserId: null, targetLabel: `Negociação ${n.titulo}`, changes: { leadId: n.leadId, valorFinal }, ...actor })
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
    const frete = b.frete !== undefined ? num(b.frete) : (cur.frete != null ? Number(cur.frete) : null)
    const baseItems = items ?? (await prisma.negotiationItem.findMany({ where: { negotiationId: id }, select: { subtotal: true } })).map((i) => ({ subtotal: Number(i.subtotal) }))
    const { valorTabela, valorFinal } = computeTotals(baseItems, descontoTipo, descontoValor, frete)
    const data: any = { valorTabela, valorFinal, descontoTipo, descontoValor, frete }
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
    const updated = await prisma.negotiation.update({
      where: { id },
      data: {
        resultado, status: resultado === 'won' ? 'aceita' : 'recusada',
        lostReasonId: resultado === 'lost' && b.lostReasonId ? Number(b.lostReasonId) : null,
        fechadaEm: new Date(), fechadaPor: actor.actorId,
        valorFinal: num(b.valorFinal) ?? (n.valorFinal != null ? Number(n.valorFinal) : null),
      },
    })
    // Reflete no lead (Fase 23: outcome won/lost + motivo de perda). Ganha
    // também grava saleValue = total da negociação → entra na "Receita ganha"
    // da Visão Geral/Relatórios sem precisar de mais nada.
    const finalValue = updated.valorFinal != null ? Number(updated.valorFinal) : null
    await prisma.lead.update({
      where: { id: n.leadId },
      data: {
        outcome: resultado, outcomeAt: new Date(), outcomeBy: actor.actorId,
        lostReasonId: resultado === 'lost' && b.lostReasonId ? Number(b.lostReasonId) : undefined,
        saleValue: resultado === 'won' && finalValue != null ? finalValue : undefined,
      },
    }).catch(() => {})
    void logUserAudit({ action: 'negotiation.closed', targetType: 'lead', targetLabel: `Negociação ${n.titulo} → ${resultado}`, changes: { resultado, valorFinal: updated.valorFinal }, ...actor })
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
    const lead = await prisma.lead.findUnique({ where: { id: n.leadId }, select: { outcome: true } })
    if (lead?.outcome === prevResultado) {
      await prisma.lead.update({
        where: { id: n.leadId },
        data: { outcome: null, outcomeAt: null, outcomeBy: null, lostReasonId: null },
      }).catch(() => {})
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
