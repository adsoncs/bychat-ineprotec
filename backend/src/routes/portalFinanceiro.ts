// src/routes/portalFinanceiro.ts
//
// Financeiro das matrículas do portal (Educacional › Financeiro do portal).
//
// É o que entrou pelo checkout: taxa de inscrição ou, quando o portal cobra o
// curso, a matrícula/1ª mensalidade. As mensalidades seguintes são do ERP
// (Acadêmico › Financeiro) e não aparecem aqui — a divisão é a mesma que o
// contrato usa ao abater o que já foi pago no portal.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { logEvent } from '../services/leadHistory.js'
import { consumirCupom } from '../services/portalCupom.js'
import { iuguDaConexao, cancelarFaturaIugu, baixaExternaIugu, estornarFaturaIugu } from '../services/paymentIugu.js'

type Situacao = 'pago' | 'pendente' | 'vencido' | 'falhou' | 'estornado' | 'cancelado' | 'sem_cobranca'

/** Situação que a secretaria entende, a partir dos campos de pagamento. */
function situacaoDe(r: { paymentStatus: string | null; paymentExpiresAt: Date | null; status: string | null; paymentId: string | null }): Situacao {
  const ps = String(r.paymentStatus || '')
  if (ps === 'paid') return 'pago'
  if (ps === 'refunded') return 'estornado'
  if (r.status === 'cancelled' && ps !== 'paid') return 'cancelado'
  if (ps === 'failed') return 'falhou'
  if (ps === 'overdue' || ps === 'expired') return 'vencido'
  if (ps === 'pending') return r.paymentExpiresAt && r.paymentExpiresAt < new Date() ? 'vencido' : 'pendente'
  return r.paymentId ? 'pendente' : 'sem_cobranca'
}

const meioDe = (m: string | null | undefined): 'pix' | 'boleto' | 'cartao' | 'link' | 'manual' | null => {
  const s = String(m || '').toUpperCase()
  if (s.includes('PIX')) return 'pix'
  if (s.includes('BOLETO') || s.includes('BANK_SLIP')) return 'boleto'
  if (s.includes('CARD') || s.includes('CREDIT')) return 'cartao'
  if (s === 'MANUAL') return 'manual'
  if (s === 'UNDEFINED' || s === 'LINK') return 'link'
  return null
}

const mascaraCpf = (c: unknown) => {
  const d = String(c ?? '').replace(/\D/g, '')
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null
}

const SELECT_LINHA = {
  id: true, candidateCode: true, status: true, createdAt: true, formData: true,
  paymentId: true, paymentStatus: true, paymentAmount: true, paymentMethod: true,
  paymentPaidAt: true, paymentExpiresAt: true, paymentPlan: true, paymentUrl: true,
  lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
  portal: { select: { id: true, nome: true, paymentScope: true, paymentConnection: { select: { provider: true } } } },
  processRegistration: {
    select: {
      selectionProcess: { select: { id: true, nome: true, taxaInscricao: true } },
      offering: { select: { id: true, nome: true, course: { select: { id: true, nome: true } } } },
    },
  },
  paymentMethods: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { provider: true, method: true, status: true } },
  _count: { select: { paymentMethods: true } },
} as const

function linha(r: any) {
  const plano = (r.paymentPlan ?? {}) as Record<string, any>
  const escopo = plano.escopo === 'curso' || (!plano.escopo && r.portal?.paymentScope === 'curso') ? 'curso' : 'taxa'
  const valorTabela = Number(plano.valorTabela ?? (escopo === 'taxa' ? r.processRegistration?.selectionProcess?.taxaInscricao : 0) ?? 0) || null
  const descontoCupom = Number(plano.descontoCupom ?? 0)
  const descontoAVista = Number(plano.descontoAVista ?? 0)
  const ultimo = r.paymentMethods?.[0]
  return {
    id: r.id,
    candidateCode: r.candidateCode,
    nome: r.lead?.nome ?? (r.formData as any)?.nome ?? null,
    leadId: r.lead?.id ?? null,
    email: r.lead?.email ?? null,
    whatsapp: r.lead?.whatsapp ?? null,
    cpf: mascaraCpf((r.formData as any)?.cpf),
    portal: r.portal ? { id: r.portal.id, nome: r.portal.nome } : null,
    curso: r.processRegistration?.offering?.course ?? null,
    oferta: r.processRegistration?.offering ? { id: r.processRegistration.offering.id, nome: r.processRegistration.offering.nome } : null,
    processo: r.processRegistration?.selectionProcess ? { id: r.processRegistration.selectionProcess.id, nome: r.processRegistration.selectionProcess.nome } : null,
    escopo,
    rotulo: plano.rotulo ?? (escopo === 'curso' ? 'Matrícula / 1ª mensalidade' : 'Taxa de inscrição'),
    valorTabela,
    descontoCupom,
    descontoAVista,
    cupom: plano.cupom ?? null,
    acrescimo: Number(plano.acrescimo ?? 0),
    valorCobrado: r.paymentAmount != null ? Number(r.paymentAmount) : plano.valorCobrado != null ? Number(plano.valorCobrado) : null,
    parcelas: Number(plano.parcelas ?? 1) || 1,
    meio: meioDe(plano.meio ?? r.paymentMethod),
    gateway: ultimo?.provider ?? r.portal?.paymentConnection?.provider ?? null,
    situacao: situacaoDe(r),
    paymentStatus: r.paymentStatus,
    inscricaoStatus: r.status,
    pagoEm: r.paymentPaidAt,
    venceEm: r.paymentExpiresAt,
    criadoEm: r.createdAt,
    tentativas: r._count?.paymentMethods ?? 0,
    temLink: !!r.paymentUrl,
  }
}

function filtros(q: any) {
  const where: any = { OR: [{ paymentId: { not: null } }, { portal: { requirePayment: true } }] }
  const de = q.de ? new Date(`${q.de}T00:00:00-03:00`) : null
  const ate = q.ate ? new Date(`${q.ate}T23:59:59.999-03:00`) : null
  if (de || ate) where.createdAt = { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) }
  if (q.portalId) where.portalId = parseInt(q.portalId)
  if (q.offeringId) where.processRegistration = { offeringId: parseInt(q.offeringId) }
  else if (q.courseId) where.processRegistration = { offering: { courseId: parseInt(q.courseId) } }
  if (q.processId) where.processRegistration = { ...(where.processRegistration ?? {}), selectionProcessId: parseInt(q.processId) }
  if (q.search) {
    const t = String(q.search).trim()
    where.AND = [{ OR: [{ candidateCode: { contains: t } }, { lead: { nome: { contains: t } } }, { lead: { email: { contains: t } } }, { paymentId: { contains: t } }] }]
  }
  return where
}

/** Filtros que dependem do cálculo da linha (situação, meio, cupom, gateway…). */
function filtrarLinhas(itens: ReturnType<typeof linha>[], q: any) {
  return itens.filter((l) =>
    (!q.situacao || String(q.situacao).split(',').includes(l.situacao))
    && (!q.meio || l.meio === q.meio)
    && (!q.gateway || l.gateway === q.gateway)
    && (!q.escopo || l.escopo === q.escopo)
    && (!q.cupom || (q.cupom === 'com' ? !!l.cupom : q.cupom === 'sem' ? !l.cupom : l.cupom === String(q.cupom).toUpperCase())),
  )
}

function indicadores(itens: ReturnType<typeof linha>[]) {
  const soma = (f: (l: any) => number) => Math.round(itens.reduce((a, l) => a + f(l), 0) * 100) / 100
  const pagos = itens.filter((l) => l.situacao === 'pago')
  const comCobranca = itens.filter((l) => l.situacao !== 'sem_cobranca')
  const porMeio: Record<string, { quantidade: number; valor: number }> = {}
  for (const l of pagos) {
    const k = l.meio ?? 'outro'
    porMeio[k] = porMeio[k] ?? { quantidade: 0, valor: 0 }
    porMeio[k].quantidade++; porMeio[k].valor = Math.round((porMeio[k].valor + (l.valorCobrado ?? 0)) * 100) / 100
  }
  const porCurso = new Map<string, { curso: string; inscritos: number; pagos: number; recebido: number }>()
  for (const l of itens) {
    const k = l.curso?.nome ?? 'Sem curso'
    const a = porCurso.get(k) ?? { curso: k, inscritos: 0, pagos: 0, recebido: 0 }
    a.inscritos++
    if (l.situacao === 'pago') { a.pagos++; a.recebido = Math.round((a.recebido + (l.valorCobrado ?? 0)) * 100) / 100 }
    porCurso.set(k, a)
  }
  const porDia = new Map<string, number>()
  for (const l of pagos) {
    if (!l.pagoEm) continue
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(l.pagoEm))
    porDia.set(d, Math.round(((porDia.get(d) ?? 0) + (l.valorCobrado ?? 0)) * 100) / 100)
  }
  const contar = (s: Situacao) => itens.filter((l) => l.situacao === s).length
  return {
    inscricoes: itens.length,
    comCobranca: comCobranca.length,
    pagos: pagos.length,
    conversao: comCobranca.length ? Math.round((pagos.length / comCobranca.length) * 1000) / 10 : 0,
    recebido: soma((l) => (l.situacao === 'pago' ? l.valorCobrado ?? 0 : 0)),
    pendente: soma((l) => (l.situacao === 'pendente' ? l.valorCobrado ?? l.valorTabela ?? 0 : 0)),
    vencido: soma((l) => (l.situacao === 'vencido' ? l.valorCobrado ?? l.valorTabela ?? 0 : 0)),
    ticketMedio: pagos.length ? Math.round((pagos.reduce((a, l) => a + (l.valorCobrado ?? 0), 0) / pagos.length) * 100) / 100 : 0,
    descontos: soma((l) => (l.situacao === 'pago' ? l.descontoCupom + l.descontoAVista : 0)),
    comCupom: pagos.filter((l) => l.cupom).length,
    porSituacao: { pago: contar('pago'), pendente: contar('pendente'), vencido: contar('vencido'), falhou: contar('falhou'), estornado: contar('estornado'), cancelado: contar('cancelado'), sem_cobranca: contar('sem_cobranca') },
    porMeio,
    porCurso: [...porCurso.values()].sort((a, b) => b.recebido - a.recebido || b.inscritos - a.inscritos).slice(0, 12),
    porDia: [...porDia.entries()].sort().map(([dia, valor]) => ({ dia, valor })),
  }
}

async function conexaoIuguDa(regId: number) {
  const r = await prisma.enrollmentRegistration.findUnique({
    where: { id: regId },
    select: { portal: { select: { paymentConnection: { select: { provider: true, apiKey: true, publicKey: true, environment: true, active: true } } } } },
  })
  const c = r?.portal?.paymentConnection
  return c?.provider === 'iugu' ? iuguDaConexao(c) : null
}

export async function portalFinanceiroRoutes(app: FastifyInstance) {
  const BASE = '/api/admin/educational/portal-financeiro'

  // Lista + indicadores do mesmo recorte
  app.get(BASE, { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const rows = await prisma.enrollmentRegistration.findMany({
      where: filtros(q), select: SELECT_LINHA, orderBy: { createdAt: 'desc' }, take: 5000,
    })
    const itens = filtrarLinhas(rows.map(linha), q)
    const ordem = String(q.ordenar || 'recentes')
    if (ordem === 'valor') itens.sort((a, b) => (b.valorCobrado ?? 0) - (a.valorCobrado ?? 0))
    if (ordem === 'pagamento') itens.sort((a, b) => +new Date(b.pagoEm ?? 0) - +new Date(a.pagoEm ?? 0))
    if (ordem === 'vencimento') itens.sort((a, b) => +new Date(a.venceEm ?? 8.64e15) - +new Date(b.venceEm ?? 8.64e15))
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 500))
    const offset = parseInt(q.offset) || 0
    return { indicadores: indicadores(itens), total: itens.length, limit, offset, items: itens.slice(offset, offset + limit) }
  })

  app.get(`${BASE}/export.csv`, { preHandler: adminOnly }, async (req, reply) => {
    const q = req.query as any
    const rows = await prisma.enrollmentRegistration.findMany({ where: filtros(q), select: SELECT_LINHA, orderBy: { createdAt: 'desc' }, take: 20000 })
    const itens = filtrarLinhas(rows.map(linha), q)
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const n = (v: number | null) => (v == null ? '' : v.toFixed(2).replace('.', ','))
    const dt = (d: Date | string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
    const linhas = [
      ['Código', 'Candidato', 'E-mail', 'Portal', 'Curso', 'Oferta', 'Processo', 'Cobrança', 'Valor de tabela', 'Desconto cupom', 'Desconto à vista', 'Cupom', 'Valor cobrado', 'Parcelas', 'Meio', 'Gateway', 'Situação', 'Pago em', 'Vence em', 'Inscrito em'].join(';'),
      ...itens.map((l) => [l.candidateCode, l.nome, l.email, l.portal?.nome, l.curso?.nome, l.oferta?.nome, l.processo?.nome, l.rotulo,
        n(l.valorTabela), n(l.descontoCupom), n(l.descontoAVista), l.cupom, n(l.valorCobrado), l.parcelas, l.meio, l.gateway, l.situacao,
        dt(l.pagoEm), dt(l.venceEm), dt(l.criadoEm)].map(esc).join(';')),
    ]
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="financeiro-portal.csv"')
    return '﻿' + linhas.join('\n')
  })

  // Detalhe: tentativas, avisos do gateway, cupom, linha do tempo
  app.get(`${BASE}/:id`, { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const r = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: SELECT_LINHA })
    if (!r) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const [tentativas, avisos, resgate, eventos] = await Promise.all([
      prisma.enrollmentPaymentMethod.findMany({
        where: { registrationId: id }, orderBy: { createdAt: 'desc' },
        select: { id: true, provider: true, method: true, status: true, amount: true, externalId: true, createdAt: true, paidAt: true, expiresAt: true, boletoLine: true, boletoPdfUrl: true, qrCode: true, cardBrand: true, cardLastDigits: true, lastErrorMessage: true },
      }),
      prisma.paymentWebhookHit.findMany({
        where: { OR: [{ registrationId: id }, ...(r.paymentId ? [{ externalId: r.paymentId }] : [])] },
        orderBy: { receivedAt: 'desc' }, take: 50,
        select: { id: true, provider: true, eventType: true, status: true, receivedAt: true, errorMessage: true },
      }),
      prisma.couponRedemption.findFirst({ where: { registrationId: id }, include: { coupon: { select: { id: true, code: true, description: true } } } }),
      r.lead?.id
        ? prisma.leadEvent.findMany({
            where: { leadId: r.lead.id, type: { startsWith: 'payment' } }, orderBy: { createdAt: 'desc' }, take: 30,
            select: { id: true, type: true, title: true, description: true, createdAt: true, userName: true },
          }).catch(() => [])
        : Promise.resolve([]),
    ])
    return {
      linha: linha(r),
      plano: r.paymentPlan,
      paymentUrl: r.paymentUrl,
      tentativas: tentativas.map((t) => ({ ...t, amount: t.amount != null ? Number(t.amount) : null })),
      avisos,
      cupom: resgate ? { ...resgate.coupon, desconto: Number(resgate.discountValue), em: resgate.redeemedAt } : null,
      eventos,
    }
  })

  // Baixa manual: pagou por fora (dinheiro, transferência, PIX direto na conta).
  // Mesmos efeitos da confirmação do gateway, uma vez só.
  app.post(`${BASE}/:id/baixa-manual`, { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const b = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const valor = Number(b.valor)
    if (!Number.isFinite(valor) || valor <= 0) return reply.code(400).send({ error: 'Informe o valor recebido' })
    const forma = ['dinheiro', 'transferencia', 'pix_direto', 'cartao_maquininha', 'outro'].includes(b.forma) ? b.forma : 'outro'
    const obs = String(b.observacao || '').slice(0, 500)
    const quando = b.pagoEm ? new Date(b.pagoEm) : new Date()
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { id: true, leadId: true, portalId: true, candidateCode: true, paymentStatus: true, paymentPlan: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.paymentStatus === 'paid') return reply.code(400).send({ error: 'Esta inscrição já está paga' })

    const r = await prisma.enrollmentRegistration.updateMany({
      where: { id, paymentStatus: { not: 'paid' } },
      data: {
        paymentStatus: 'paid', status: 'paid', paymentPaidAt: quando, paymentAmount: valor, paymentMethod: 'MANUAL',
        paymentPlan: { ...((reg.paymentPlan as any) ?? {}), baixaManual: { forma, observacao: obs, por: user.userId, em: new Date().toISOString() } } as any,
      },
    })
    if (r.count !== 1) return reply.code(409).send({ error: 'Pagamento já confirmado por outro caminho' })

    // Cobranças abertas no gateway ficam sem efeito: na iugu, "paga externamente".
    const abertas = await prisma.enrollmentPaymentMethod.findMany({ where: { registrationId: id, status: 'pending', externalId: { not: null } } })
    const cfg = abertas.some((m) => m.provider === 'iugu') ? await conexaoIuguDa(id) : null
    for (const m of abertas) {
      if (m.provider === 'iugu' && cfg) await baixaExternaIugu(cfg, m.externalId!, `inscricao-${id}`, 'Baixa manual na secretaria')
      await prisma.enrollmentPaymentMethod.update({ where: { id: m.id }, data: { status: 'failed', lastErrorMessage: 'Substituída por baixa manual' } }).catch(() => {})
    }
    await prisma.enrollmentPaymentMethod.create({
      data: { registrationId: id, provider: 'manual', method: forma, status: 'paid', amount: valor, paidAt: quando, lastErrorMessage: obs || null },
    })
    void consumirCupom(id)
    await prisma.enrollmentPortal.update({ where: { id: reg.portalId }, data: { conversions: { increment: 1 } } }).catch(() => {})
    if (reg.leadId) {
      logEvent({
        leadId: reg.leadId, type: 'payment_received', category: 'lifecycle', channel: 'payment', source: 'manual',
        title: `Pagamento recebido (baixa manual) — ${reg.candidateCode}`,
        description: `${forma.replace('_', ' ')} · ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${obs ? ` · ${obs}` : ''}`,
        actorType: 'operator', userId: user.userId, userName: user.name,
        metadata: { registrationId: id, manual: true, forma, valor },
      })
    }
    import('../services/enrollmentNotify.js').then((m) => m.sendPaymentConfirmation?.({ enrollmentId: id }).catch(() => {})).catch(() => {})
    return { ok: true }
  })

  // Cancelar a cobrança pendente (a inscrição continua; a pessoa pode gerar outra).
  app.post(`${BASE}/:id/cancelar-cobranca`, { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const user = (req as any).user as JwtPayload
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { leadId: true, candidateCode: true, paymentStatus: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.paymentStatus === 'paid') return reply.code(400).send({ error: 'Cobrança já paga — para devolver, use o estorno' })
    const abertas = await prisma.enrollmentPaymentMethod.findMany({ where: { registrationId: id, status: 'pending' } })
    const cfg = abertas.some((m) => m.provider === 'iugu') ? await conexaoIuguDa(id) : null
    const avisos: string[] = []
    for (const m of abertas) {
      if (m.provider === 'iugu' && m.externalId) {
        const r = cfg ? await cancelarFaturaIugu(cfg, m.externalId) : { ok: false, message: 'conexão iugu indisponível' }
        if (!r.ok) avisos.push(`Fatura ${m.externalId}: ${r.message}`)
      } else if (m.provider !== 'simulado' && m.externalId) {
        avisos.push(`${m.provider}: cancele também no painel do gateway (${m.externalId})`)
      }
      await prisma.enrollmentPaymentMethod.update({ where: { id: m.id }, data: { status: 'failed', lastErrorMessage: 'Cancelada pela secretaria' } })
    }
    await prisma.enrollmentRegistration.update({ where: { id }, data: { paymentStatus: null, paymentId: null, paymentUrl: null, paymentExpiresAt: null } })
    if (reg.leadId) {
      logEvent({ leadId: reg.leadId, type: 'payment_canceled', category: 'lifecycle', channel: 'payment', source: 'manual', title: `Cobrança cancelada pela secretaria — ${reg.candidateCode}`, actorType: 'operator', userId: user.userId, userName: user.name, metadata: { registrationId: id } })
    }
    return { ok: true, canceladas: abertas.length, avisos }
  })

  // Estorno (iugu: cartão e PIX; parcial só no cartão).
  app.post(`${BASE}/:id/estornar`, { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const b = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: { leadId: true, candidateCode: true, paymentStatus: true } })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    if (reg.paymentStatus !== 'paid') return reply.code(400).send({ error: 'Só dá para estornar cobrança paga' })
    const paga = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId: id, status: 'paid' }, orderBy: { paidAt: 'desc' } })
    if (!paga) return reply.code(400).send({ error: 'Pagamento não encontrado' })
    if (paga.provider === 'manual') return reply.code(400).send({ error: 'Baixa manual: devolva o valor por fora e cancele a inscrição, se for o caso' })
    if (paga.provider !== 'iugu') return reply.code(400).send({ error: `Estorno pelo sistema disponível para a iugu. Para ${paga.provider}, faça no painel do gateway` })
    if (paga.method === 'boleto') return reply.code(400).send({ error: 'Boleto não tem estorno automático na iugu — devolva por transferência' })
    const cfg = await conexaoIuguDa(id)
    if (!cfg || !paga.externalId) return reply.code(400).send({ error: 'Conexão iugu indisponível' })
    const parcial = b.valor ? Math.round(Number(b.valor) * 100) : undefined
    if (parcial && paga.method !== 'credit_card') return reply.code(400).send({ error: 'Estorno parcial só no cartão' })
    try {
      const f = await estornarFaturaIugu(cfg, paga.externalId, parcial)
      await prisma.enrollmentPaymentMethod.update({ where: { id: paga.id }, data: { status: f.status === 'refunded' || !parcial ? 'refunded' : paga.status } })
      if (!parcial) await prisma.enrollmentRegistration.update({ where: { id }, data: { paymentStatus: 'refunded' } })
      if (reg.leadId) {
        logEvent({ leadId: reg.leadId, type: 'payment_refunded', category: 'lifecycle', channel: 'payment', source: 'iugu', title: `Pagamento estornado${parcial ? ' (parcial)' : ''} — ${reg.candidateCode}`, description: String(b.motivo || '').slice(0, 300) || undefined, actorType: 'operator', userId: user.userId, userName: user.name, metadata: { registrationId: id, parcialCentavos: parcial ?? null } })
      }
      return { ok: true }
    } catch (e: any) {
      return reply.code(502).send({ error: e?.message || 'Falha ao estornar na iugu' })
    }
  })
}
