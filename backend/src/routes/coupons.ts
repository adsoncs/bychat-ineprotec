// src/routes/coupons.ts
// Cupons: CRUD completo do admin (travas por curso/oferta/processo/nível/
// modalidade, meio de pagamento, taxa × curso, público por CPF/domínio,
// limites, validade, campanha, lote), números por cupom e endpoint público de
// validação. A regra que decide se o cupom vale mora em services/portalCupom.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { avaliarCupom } from '../services/portalCupom.js'

const COUPON_TYPES = ['percent', 'fixed'] as const
type CouponType = typeof COUPON_TYPES[number]
const MEIOS = ['pix', 'boleto', 'credit_card'] as const

function normalizeCode(s: string): string {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 50)
}

const idsOuNull = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null
  const ids = [...new Set(v.map((x) => parseInt(String(x))).filter((n) => Number.isFinite(n) && n > 0))]
  return ids.length ? ids : null
}
const textosOuNull = (v: unknown, limpar: (s: string) => string): string[] | null => {
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/) : []
  const out = [...new Set(lista.map((x) => limpar(String(x))).filter(Boolean))]
  return out.length ? out : null
}
const cpfLimpo = (s: string) => { const d = s.replace(/\D/g, ''); return d.length === 11 ? d : '' }
const dominioLimpo = (s: string) => {
  const d = s.trim().toLowerCase().replace(/^.*@/, '').replace(/^@/, '')
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : ''
}

/** Situação calculada — o que a secretaria quer ver na lista. */
function situacao(c: any): 'ativo' | 'inativo' | 'agendado' | 'expirado' | 'esgotado' | 'arquivado' {
  if (c.archivedAt) return 'arquivado'
  if (!c.active) return 'inativo'
  const agora = new Date()
  if (c.validUntil && new Date(c.validUntil) < agora) return 'expirado'
  if (c.validFrom && new Date(c.validFrom) > agora) return 'agendado'
  if (c.usageLimit && c.usageCount >= c.usageLimit) return 'esgotado'
  return 'ativo'
}

function summarize(c: any) {
  const n = (v: any) => (v !== null && v !== undefined ? Number(v) : null)
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    type: c.type,
    value: Number(c.value),
    minAmount: n(c.minAmount),
    maxDiscount: n(c.maxDiscount),
    usageLimit: c.usageLimit,
    usageCount: c.usageCount,
    perUserLimit: c.perUserLimit,
    portalIds: c.portalIds ?? null,
    courseIds: c.courseIds ?? null,
    offeringIds: c.offeringIds ?? null,
    processIds: c.processIds ?? null,
    levelIds: c.levelIds ?? null,
    modalityIds: c.modalityIds ?? null,
    paymentMethods: c.paymentMethods ?? null,
    scope: c.scope ?? null,
    allowedCpfs: c.allowedCpfs ?? null,
    emailDomains: c.emailDomains ?? null,
    stackWithPix: !!c.stackWithPix,
    maxInstallments: c.maxInstallments ?? null,
    campaign: c.campaign ?? null,
    batch: c.batch ?? null,
    notes: c.notes ?? null,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    active: c.active,
    archivedAt: c.archivedAt ?? null,
    situacao: situacao(c),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

/** Lê e valida o corpo de criação/edição. `parcial` = PUT (só o que veio). */
function lerCorpo(body: any, parcial: boolean): { erro: string } | { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  const tem = (k: string) => body[k] !== undefined
  if (!parcial || tem('type')) {
    if (!COUPON_TYPES.includes(body.type)) return { erro: 'Tipo inválido (percentual ou valor fixo)' }
    data.type = body.type as CouponType
  }
  if (!parcial || tem('value')) {
    const v = Number(body.value)
    if (!Number.isFinite(v) || v <= 0) return { erro: 'Valor do desconto inválido' }
    const tipo = (data.type ?? body.type) as string | undefined
    if (tipo === 'percent' && v > 100) return { erro: 'Percentual máximo: 100%' }
    data.value = v
  }
  if (tem('description')) data.description = body.description ? String(body.description).slice(0, 255) : null
  const dinheiro = (k: string) => {
    if (!tem(k)) return
    const v = body[k] === '' || body[k] === null ? null : Number(body[k])
    data[k] = v !== null && Number.isFinite(v) && v > 0 ? v : null
  }
  dinheiro('minAmount'); dinheiro('maxDiscount')
  const inteiro = (k: string, min = 1) => {
    if (!tem(k)) return
    const v = body[k] === '' || body[k] === null ? null : parseInt(body[k])
    data[k] = v !== null && Number.isFinite(v) && v >= min ? v : null
  }
  inteiro('usageLimit'); inteiro('maxInstallments')
  if (tem('perUserLimit')) {
    const v = parseInt(body.perUserLimit)
    data.perUserLimit = Number.isFinite(v) && v >= 0 ? v : 1 // 0 = sem limite por pessoa
  }
  for (const k of ['portalIds', 'courseIds', 'offeringIds', 'processIds', 'levelIds', 'modalityIds']) {
    if (tem(k)) data[k] = idsOuNull(body[k])
  }
  if (tem('paymentMethods')) {
    const m = Array.isArray(body.paymentMethods) ? body.paymentMethods.filter((x: string) => (MEIOS as readonly string[]).includes(x)) : []
    data.paymentMethods = m.length && m.length < MEIOS.length ? [...new Set(m)] : null
  }
  if (tem('scope')) data.scope = body.scope === 'taxa' || body.scope === 'curso' ? body.scope : null
  if (tem('allowedCpfs')) data.allowedCpfs = textosOuNull(body.allowedCpfs, cpfLimpo)
  if (tem('emailDomains')) data.emailDomains = textosOuNull(body.emailDomains, dominioLimpo)
  if (tem('stackWithPix')) data.stackWithPix = !!body.stackWithPix
  if (tem('campaign')) data.campaign = body.campaign ? String(body.campaign).trim().slice(0, 100) || null : null
  if (tem('notes')) data.notes = body.notes ? String(body.notes).slice(0, 5000) : null
  if (tem('validFrom')) data.validFrom = body.validFrom ? new Date(body.validFrom) : null
  if (tem('validUntil')) data.validUntil = body.validUntil ? new Date(body.validUntil) : null
  if (data.validFrom && data.validUntil && (data.validUntil as Date) < (data.validFrom as Date)) {
    return { erro: 'O fim da validade é antes do início' }
  }
  if (tem('active')) data.active = !!body.active
  return { data }
}

/** Uso por cupom a partir dos resgates e das reservas (cobranças abertas). */
async function numerosDoCupom(ids: number[]) {
  if (!ids.length) return new Map<number, { resgates: number; desconto: number; receita: number; reservados: number }>()
  const r = await prisma.couponRedemption.groupBy({
    by: ['couponId'],
    where: { couponId: { in: ids } },
    _count: { _all: true },
    _sum: { discountValue: true, amountAfter: true },
  })
  const cupons = await prisma.coupon.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } })
  const codigos = cupons.map((c) => c.code)
  const res = codigos.length
    ? await prisma.$queryRawUnsafe<Array<{ code: string; n: bigint }>>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(paymentPlan, '$.cupom')) AS code, COUNT(*) AS n
           FROM bychat_enrollment_registrations
          WHERE paymentStatus = 'pending' AND paymentExpiresAt > NOW()
            AND JSON_UNQUOTE(JSON_EXTRACT(paymentPlan, '$.cupom')) IN (${codigos.map(() => '?').join(',')})
          GROUP BY 1`, ...codigos,
      ).catch(() => [])
    : []
  const reservas = new Map(res.map((x) => [x.code, Number(x.n)]))
  const out = new Map<number, { resgates: number; desconto: number; receita: number; reservados: number }>()
  for (const c of cupons) {
    const g = r.find((x) => x.couponId === c.id)
    out.set(c.id, {
      resgates: g?._count._all ?? 0,
      desconto: Number(g?._sum.discountValue ?? 0),
      receita: Number(g?._sum.amountAfter ?? 0),
      reservados: reservas.get(c.code) ?? 0,
    })
  }
  return out
}

function filtroDaLista(q: any) {
  const where: any = {}
  const sit = String(q.situacao || q.status || '')
  const agora = new Date()
  if (q.active === 'true') where.active = true
  if (q.active === 'false') where.active = false
  if (sit === 'arquivado') where.archivedAt = { not: null }
  else if (sit !== 'todos') where.archivedAt = null
  if (sit === 'ativo') Object.assign(where, { active: true, OR: [{ validUntil: null }, { validUntil: { gte: agora } }], AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: agora } }] }] })
  if (sit === 'inativo') where.active = false
  if (sit === 'expirado') where.validUntil = { lt: agora }
  if (sit === 'agendado') where.validFrom = { gt: agora }
  if (q.campaign) where.campaign = String(q.campaign)
  if (q.batch) where.batch = String(q.batch)
  if (q.search) {
    const t = String(q.search)
    where.AND = [...(where.AND ?? []), { OR: [{ code: { contains: t } }, { description: { contains: t } }, { campaign: { contains: t } }] }]
  }
  return where
}

export async function couponsRoutes(app: FastifyInstance) {
  // GET /api/admin/coupons — lista com situação e números
  app.get('/api/admin/coupons', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where = filtroDaLista(q)
    const limit = Math.max(1, Math.min(parseInt(q.limit) || 50, 500))
    const offset = parseInt(q.offset) || 0
    const [rows, total] = await Promise.all([
      prisma.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      prisma.coupon.count({ where }),
    ])
    let items = rows.map(summarize)
    // "esgotado" depende de contagem × limite — filtrado depois de ler.
    if (String(q.situacao) === 'esgotado') items = items.filter((c) => c.situacao === 'esgotado')
    const nums = await numerosDoCupom(items.map((c) => c.id))
    return { items: items.map((c) => ({ ...c, numeros: nums.get(c.id) ?? null })), total, limit, offset }
  })

  // GET /api/admin/coupons/resumo — números gerais para o topo da tela
  app.get('/api/admin/coupons/resumo', { preHandler: authMiddleware }, async () => {
    const todos = await prisma.coupon.findMany({ where: { archivedAt: null } })
    const porSit: Record<string, number> = {}
    for (const c of todos) { const s = situacao(c); porSit[s] = (porSit[s] ?? 0) + 1 }
    const agg = await prisma.couponRedemption.aggregate({ _count: { _all: true }, _sum: { discountValue: true, amountAfter: true } })
    const trinta = await prisma.couponRedemption.aggregate({
      where: { redeemedAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
      _count: { _all: true }, _sum: { discountValue: true },
    })
    const campanhas = await prisma.coupon.groupBy({ by: ['campaign'], where: { campaign: { not: null }, archivedAt: null }, _count: { _all: true } })
    const lotes = await prisma.coupon.groupBy({ by: ['batch'], where: { batch: { not: null } }, _count: { _all: true } })
    return {
      total: todos.length,
      porSituacao: porSit,
      resgates: agg._count._all,
      descontoConcedido: Number(agg._sum.discountValue ?? 0),
      receitaComCupom: Number(agg._sum.amountAfter ?? 0),
      resgates30d: trinta._count._all,
      desconto30d: Number(trinta._sum.discountValue ?? 0),
      campanhas: campanhas.map((c) => ({ nome: c.campaign, cupons: c._count._all })),
      lotes: lotes.map((l) => ({ nome: l.batch, cupons: l._count._all })),
    }
  })

  // GET /api/admin/coupons/export.csv
  app.get('/api/admin/coupons/export.csv', { preHandler: authMiddleware }, async (req, reply) => {
    const rows = await prisma.coupon.findMany({ where: filtroDaLista(req.query as any), orderBy: { createdAt: 'desc' }, take: 10000 })
    const nums = await numerosDoCupom(rows.map((c) => c.id))
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const linhas = [
      ['Código', 'Descrição', 'Tipo', 'Valor', 'Situação', 'Campanha', 'Lote', 'Usos', 'Limite', 'Reservados', 'Desconto concedido', 'Receita com cupom', 'Início', 'Fim'].join(';'),
      ...rows.map((c) => {
        const n = nums.get(c.id)
        return [c.code, c.description, c.type === 'percent' ? '%' : 'R$', Number(c.value), situacao(c), c.campaign, c.batch,
          c.usageCount, c.usageLimit ?? '', n?.reservados ?? 0, (n?.desconto ?? 0).toFixed(2), (n?.receita ?? 0).toFixed(2),
          c.validFrom ? c.validFrom.toISOString().slice(0, 10) : '', c.validUntil ? c.validUntil.toISOString().slice(0, 10) : '',
        ].map(esc).join(';')
      }),
    ]
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="cupons.csv"')
    return '﻿' + linhas.join('\n')
  })

  // GET /api/admin/coupons/:id — detalhe, números e resgates com o candidato
  app.get('/api/admin/coupons/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const c = await prisma.coupon.findUnique({
      where: { id },
      include: { redemptions: { orderBy: { redeemedAt: 'desc' }, take: 200 } },
    })
    if (!c) return reply.code(404).send({ error: 'Cupom não encontrado' })
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { id: { in: c.redemptions.map((r) => r.registrationId) } },
      select: {
        id: true, candidateCode: true, paymentMethod: true, portal: { select: { nome: true } },
        lead: { select: { id: true, nome: true } },
        processRegistration: { select: { offering: { select: { nome: true, course: { select: { nome: true } } } } } },
      },
    })
    const porId = new Map(regs.map((r) => [r.id, r]))
    const reservas = await prisma.enrollmentRegistration.findMany({
      where: { paymentStatus: 'pending', paymentExpiresAt: { gt: new Date() } },
      select: { id: true, candidateCode: true, paymentPlan: true, paymentExpiresAt: true, lead: { select: { nome: true } } },
      take: 500,
    }).then((l) => l.filter((r) => (r.paymentPlan as any)?.cupom === c.code))
    const porCurso = new Map<string, { usos: number; desconto: number }>()
    for (const r of c.redemptions) {
      const nomeCurso = porId.get(r.registrationId)?.processRegistration?.offering?.course?.nome ?? 'Sem curso'
      const a = porCurso.get(nomeCurso) ?? { usos: 0, desconto: 0 }
      a.usos++; a.desconto += Number(r.discountValue)
      porCurso.set(nomeCurso, a)
    }
    const nums = (await numerosDoCupom([c.id])).get(c.id)
    return {
      coupon: summarize(c),
      numeros: nums,
      porCurso: [...porCurso.entries()].map(([curso, v]) => ({ curso, ...v })).sort((a, b) => b.usos - a.usos),
      redemptions: c.redemptions.map((r) => {
        const reg = porId.get(r.registrationId)
        return {
          id: r.id,
          registrationId: r.registrationId,
          candidateCode: reg?.candidateCode ?? null,
          nome: reg?.lead?.nome ?? null,
          leadId: reg?.lead?.id ?? null,
          portal: reg?.portal?.nome ?? null,
          curso: reg?.processRegistration?.offering?.course?.nome ?? null,
          oferta: reg?.processRegistration?.offering?.nome ?? null,
          meio: reg?.paymentMethod ?? null,
          amountBefore: Number(r.amountBefore),
          discountValue: Number(r.discountValue),
          amountAfter: Number(r.amountAfter),
          redeemedAt: r.redeemedAt,
        }
      }),
      reservas: reservas.map((r) => ({ id: r.id, candidateCode: r.candidateCode, nome: r.lead?.nome ?? null, expiraEm: r.paymentExpiresAt })),
    }
  })

  // POST /api/admin/coupons — criar
  app.post('/api/admin/coupons', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const code = normalizeCode(body.code)
    if (code.length < 3) return reply.code(400).send({ error: 'Código inválido (mínimo 3 caracteres: letras, números, - ou _)' })
    const lido = lerCorpo(body, false)
    if ('erro' in lido) return reply.code(400).send({ error: lido.erro })
    if (await prisma.coupon.findUnique({ where: { code } })) return reply.code(409).send({ error: `Código '${code}' já cadastrado` })
    const c = await prisma.coupon.create({
      data: { perUserLimit: 1, active: true, ...lido.data, code, createdBy: user.userId } as any,
    })
    return reply.code(201).send({ ok: true, coupon: summarize(c) })
  })

  // POST /api/admin/coupons/lote — N códigos únicos de uso único, mesma regra
  app.post('/api/admin/coupons/lote', { preHandler: adminOnly }, async (req, reply) => {
    const body = (req.body as any) || {}
    const user = (req as any).user as JwtPayload
    const qtd = Math.min(Math.max(parseInt(body.quantidade) || 0, 1), 1000)
    const prefixo = normalizeCode(body.prefixo || 'CUPOM').slice(0, 20)
    if (prefixo.length < 2) return reply.code(400).send({ error: 'Prefixo inválido' })
    const lido = lerCorpo(body, false)
    if ('erro' in lido) return reply.code(400).send({ error: lido.erro })
    const lote = String(body.lote || `${prefixo}-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(2).toString('hex')}`).slice(0, 60)
    // Sem 0/O/1/I: código de lote costuma ser digitado a partir de papel.
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const codigos: string[] = []
    for (let tent = 0; codigos.length < qtd && tent < qtd * 5; tent++) {
      const sufixo = Array.from(crypto.randomBytes(6), (b) => alfabeto[b % alfabeto.length]).join('')
      const code = `${prefixo}-${sufixo}`
      if (codigos.includes(code)) continue
      if (await prisma.coupon.findUnique({ where: { code }, select: { id: true } })) continue
      codigos.push(code)
    }
    for (const code of codigos) {
      await prisma.coupon.create({
        data: { perUserLimit: 1, active: true, ...lido.data, usageLimit: 1, code, batch: lote, createdBy: user.userId } as any,
      })
    }
    return reply.code(201).send({ ok: true, lote, criados: codigos.length, codigos })
  })

  // POST /api/admin/coupons/:id/duplicar — cópia com código novo, zerada
  app.post('/api/admin/coupons/:id/duplicar', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const user = (req as any).user as JwtPayload
    const o = await prisma.coupon.findUnique({ where: { id } })
    if (!o) return reply.code(404).send({ error: 'Cupom não encontrado' })
    const code = normalizeCode((req.body as any)?.code || `${o.code}-COPIA`)
    if (await prisma.coupon.findUnique({ where: { code } })) return reply.code(409).send({ error: `Código '${code}' já cadastrado` })
    const { id: _i, createdAt: _c, updatedAt: _u, usageCount: _n, archivedAt: _a, batch: _b, ...resto } = o as any
    const c = await prisma.coupon.create({ data: { ...resto, code, usageCount: 0, active: false, createdBy: user.userId } })
    return reply.code(201).send({ ok: true, coupon: summarize(c) })
  })

  // POST /api/admin/coupons/:id/arquivar | /desarquivar
  app.post('/api/admin/coupons/:id/arquivar', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const c = await prisma.coupon.update({ where: { id }, data: { archivedAt: new Date(), active: false } }).catch(() => null)
    return c ? { ok: true, coupon: summarize(c) } : reply.code(404).send({ error: 'Cupom não encontrado' })
  })
  app.post('/api/admin/coupons/:id/desarquivar', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const c = await prisma.coupon.update({ where: { id }, data: { archivedAt: null } }).catch(() => null)
    return c ? { ok: true, coupon: summarize(c) } : reply.code(404).send({ error: 'Cupom não encontrado' })
  })

  // POST /api/admin/coupons/:id/simular — testa o cupom numa inscrição real
  // (código do candidato) sem aplicar nada: diz se vale e quanto dá.
  app.post('/api/admin/coupons/:id/simular', { preHandler: authMiddleware }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const b = (req.body as any) || {}
    const c = await prisma.coupon.findUnique({ where: { id }, select: { code: true } })
    if (!c) return reply.code(404).send({ error: 'Cupom não encontrado' })
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { candidateCode: String(b.candidateCode || '').trim().toUpperCase() },
      select: { id: true, portalId: true, formData: true, portal: { select: { paymentMethodsConfig: true } } },
    })
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada para esse código' })
    const { cobrancaDoPortal } = await import('../services/portalCobranca.js')
    const { lerRegras } = await import('../services/portalPagamento.js')
    const cob = await cobrancaDoPortal(reg.id)
    const regras = lerRegras(reg.portal?.paymentMethodsConfig)
    const r = await avaliarCupom({
      codigo: c.code, valor: cob?.valor ?? 0, portalId: reg.portalId,
      cpf: (reg.formData as any)?.cpf, descontoAVistaPct: regras.pix.descontoPct,
      contexto: cob?.contexto ?? null, escopo: cob?.escopo ?? 'taxa',
      ...(MEIOS.includes(b.metodo) ? { metodo: b.metodo } : {}),
    })
    return { cobranca: cob ? { valor: cob.valor, rotulo: cob.rotulo, escopo: cob.escopo } : null, resultado: r }
  })

  // PUT /api/admin/coupons/:id
  app.put('/api/admin/coupons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const body = (req.body as any) || {}
    const lido = lerCorpo(body, true)
    if ('erro' in lido) return reply.code(400).send({ error: lido.erro })
    const data: any = { ...lido.data }
    if (body.code !== undefined) {
      const code = normalizeCode(body.code)
      if (code.length < 3) return reply.code(400).send({ error: 'Código inválido' })
      const dup = await prisma.coupon.findFirst({ where: { code, NOT: { id } } })
      if (dup) return reply.code(409).send({ error: `Código '${code}' já cadastrado` })
      // Código de cupom já usado não muda: o histórico e as reservas o
      // guardam por código, e renomear quebraria a contagem de estoque.
      const atual = await prisma.coupon.findUnique({ where: { id }, select: { code: true, usageCount: true } })
      if (atual && atual.code !== code && atual.usageCount > 0) {
        return reply.code(400).send({ error: 'Cupom já usado não pode trocar de código. Duplique e desative este.' })
      }
      data.code = code
    }
    try {
      const c = await prisma.coupon.update({ where: { id }, data })
      return { ok: true, coupon: summarize(c) }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // DELETE /api/admin/coupons/:id — só nunca usado; usado, arquive
  app.delete('/api/admin/coupons/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const usedBy = await prisma.couponRedemption.count({ where: { couponId: id } })
    if (usedBy > 0) {
      return reply.code(400).send({ error: `Cupom já foi usado ${usedBy} vez(es). Arquive em vez de excluir para preservar o histórico.` })
    }
    try {
      await prisma.coupon.delete({ where: { id } })
      return { ok: true }
    } catch (e: any) {
      return reply.code(404).send({ error: e.message })
    }
  })

  // GET /api/public/coupons/validate?code=&amount=&portalId=
  // Mantido por compatibilidade: responde pela mesma regra do checkout, mas sem
  // o contexto da inscrição (curso, CPF…). O checkout de verdade usa
  // /registrations/:code/payment-options?cupom=, que confere todas as travas.
  app.get('/api/public/coupons/validate', async (req, reply) => {
    const q = req.query as any
    const amount = Number(q.amount)
    if (normalizeCode(q.code || '').length < 3) return reply.code(400).send({ error: 'Código inválido' })
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ error: 'Valor inválido' })
    const r = await avaliarCupom({ codigo: String(q.code), valor: amount, portalId: q.portalId ? parseInt(q.portalId) : 0 })
    if ('valido' in r) return reply.send({ valid: false, reason: r.motivo })
    return {
      valid: true, code: r.code, description: r.descricao,
      amountBefore: r.valorCheio, discountValue: r.descontoCupom, amountAfter: r.valorComCupom,
    }
  })
}
