// Relatório de Funil (Meta Ads → Funil de Vendas) para "Meus Painéis".
// Entrega TODOS os dados prontos para a view: KPIs com delta vs período
// anterior, série diária por KPI, funil em cascata (Impressão→…→Fechamento)
// com taxas e custo-por-etapa, heatmap por dia e por dia-da-semana, e quebras
// por campanha/adset. Junta CampaignCost (custo de Ads) + Lead (funil) por data
// e por campanha/adset. Reaproveita o padrão do metaAdsReport.
//
// Mapeamento de etapas (terram, funis PET/PASTO): MQL=QUALIFICACAO,
// SQL=QUALIFICADO, RA=RR=REUNIAO, Fechamento=FECHADO, Perdido=PERDIDO.
// O filtro `funnelId` troca o funil (padrão: primeiro funil ativo).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

function parseBrazilDate(dateStr: string, kind: 'start' | 'end'): Date {
  const suffix = kind === 'start' ? 'T00:00:00-03:00' : 'T23:59:59.999-03:00'
  const d = new Date(dateStr + suffix)
  return Number.isNaN(d.getTime()) ? new Date() : d
}
function toBrazilDay(d: Date): string {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
function brWeekday(dateStr: string): number {
  // 0=domingo … 6=sábado, no fuso Brasil
  return new Date(dateStr + 'T12:00:00-03:00').getDay()
}
const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function deltaPct(value: number, prev: number): number | null {
  if (prev === 0) return value === 0 ? 0 : null // N/A quando não há base
  return ((value - prev) / prev) * 100
}
function round2(n: number): number { return Math.round(n * 100) / 100 }

// Chaves de etapa por "papel" no funil. Resolve contra as etapas REAIS do funil
// selecionado; se a chave não existir, o KPI fica 0 (degrada com elegância).
const STAGE_ROLE: Record<string, string[]> = {
  mql: ['QUALIFICACAO'],
  sql: ['QUALIFICADO'],
  ra: ['REUNIAO'],
  rr: ['REUNIAO'], // por definição do cliente: a própria Reunião conta como realizada
  fechamento: ['FECHADO'],
}
const LOST_KEYS = ['PERDIDO']

interface StageInfo { key: string; position: number }

/** Conta leads que ALCANÇARAM uma etapa (posição do status atual >= posição da
 *  etapa), excluindo os perdidos da contagem progressiva. */
function reachedCount(leads: { status: string | null }[], targetPos: number, posByKey: Map<string, number>): number {
  let n = 0
  for (const l of leads) {
    if (!l.status || LOST_KEYS.includes(l.status)) continue
    const p = posByKey.get(l.status)
    if (p !== undefined && p >= targetPos) n++
  }
  return n
}
function rolePos(role: string, posByKey: Map<string, number>): number | null {
  for (const k of STAGE_ROLE[role] ?? []) {
    if (posByKey.has(k)) return posByKey.get(k)!
  }
  return null
}

export async function funnelReportRoutes(app: FastifyInstance) {
  // ── GET /api/admin/funnel-report ──
  // Query: from, to (YYYY-MM-DD, fuso BR), funnelId (opcional)
  app.get('/api/admin/funnel-report', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any

    const funnels = await prisma.funnel.findMany({
      where: { active: true },
      select: { id: true, name: true, isDefault: true, stages: { select: { key: true, position: true }, orderBy: { position: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    })
    const funnelList = funnels.map((f) => ({ id: f.id, name: f.name }))
    const selFunnel = funnels.find((f) => f.id === parseInt(q.funnelId)) ?? funnels[0] ?? null
    const funnelId = selFunnel?.id ?? null
    const posByKey = new Map<string, number>((selFunnel?.stages ?? []).map((s: StageInfo) => [s.key, s.position]))

    const to = q.to ? parseBrazilDate(q.to, 'end') : new Date()
    const from = q.from ? parseBrazilDate(q.from, 'start') : new Date(Date.now() - 29 * 86400000)
    const spanMs = to.getTime() - from.getTime()
    const prevTo = new Date(from.getTime() - 1)
    const prevFrom = new Date(prevTo.getTime() - spanMs)

    // ── Helpers de agregação por janela ──────────────────────────
    async function aggregate(winFrom: Date, winTo: Date) {
      // Espelha o filtro do Relatório Meta Ads: só leads ATRIBUÍDOS a campanha
      // (campaignId not null) entram — assim Leads/MQL/SQL e as quebras batem
      // exatamente com aquele relatório. Leads orgânicos (sem campanha) ficam de fora.
      const leadWhere: any = { createdAt: { gte: winFrom, lte: winTo }, campaignId: { not: null } }
      if (funnelId) leadWhere.funnelId = funnelId
      // CampaignCost.date é @db.Date (UTC midnight); limites em UTC p/ não perder o 1º dia.
      const cFrom = new Date(toBrazilDay(winFrom) + 'T00:00:00.000Z')
      const cTo = new Date(toBrazilDay(winTo) + 'T23:59:59.999Z')
      const [leads, campaignCosts] = await Promise.all([
        prisma.lead.findMany({
          where: leadWhere,
          select: { id: true, status: true, createdAt: true, saleValue: true, saleDetected: true, outcome: true, campaignId: true, campaignName: true, adsetId: true, adsetName: true },
        }),
        prisma.campaignCost.findMany({
          where: { date: { gte: cFrom, lte: cTo }, level: 'campaign' },
          select: { campaignId: true, campaignName: true, date: true, spend: true, impressions: true, clicks: true },
        }),
      ])
      const investimento = campaignCosts.reduce((s, c) => s + Number(c.spend), 0)
      const impressoes = campaignCosts.reduce((s, c) => s + (c.impressions ?? 0), 0)
      const cliques = campaignCosts.reduce((s, c) => s + (c.clicks ?? 0), 0)
      const count = (role: string) => {
        const p = rolePos(role, posByKey); return p === null ? 0 : reachedCount(leads, p, posByKey)
      }
      const mql = count('mql'), sql = count('sql'), ra = count('ra'), rr = count('rr'), fechamento = count('fechamento')
      // Faturamento = receita das vendas detectadas (mesma regra do Relatório Meta Ads).
      const faturamento = leads.filter((l) => l.saleDetected).reduce((s, l) => s + Number(l.saleValue ?? 0), 0)
      return { leads, campaignCosts, investimento, impressoes, cliques, leadsCount: leads.length, mql, sql, ra, rr, fechamento, faturamento }
    }

    const cur = await aggregate(from, to)
    const prev = await aggregate(prevFrom, prevTo)

    const kpi = (cV: number, pV: number, format: 'money' | 'int') => ({ value: cV, prev: pV, deltaPct: deltaPct(cV, pV), format })
    const kpis = {
      investimento: kpi(round2(cur.investimento), round2(prev.investimento), 'money'),
      mql: kpi(cur.mql, prev.mql, 'int'),
      sql: kpi(cur.sql, prev.sql, 'int'),
      ra: kpi(cur.ra, prev.ra, 'int'),
      rr: kpi(cur.rr, prev.rr, 'int'),
      fechamento: kpi(cur.fechamento, prev.fechamento, 'int'),
      faturamento: kpi(round2(cur.faturamento), round2(prev.faturamento), 'money'),
    }

    // ── Funil em cascata (volume + taxa entre etapas + custo por etapa) ──
    const safeRate = (a: number, b: number) => (b > 0 ? round2((a / b) * 100) : 0)
    const safeCost = (spend: number, n: number) => (n > 0 ? round2(spend / n) : 0)
    const funnel = [
      { key: 'impressao', label: 'Impressão', value: cur.impressoes, prev: prev.impressoes, deltaPct: deltaPct(cur.impressoes, prev.impressoes) },
      { key: 'cliques', label: 'Cliques', value: cur.cliques, prev: prev.cliques, deltaPct: deltaPct(cur.cliques, prev.cliques), rate: { label: 'CTR', value: safeRate(cur.cliques, cur.impressoes), unit: '%' }, cost: { label: 'CPC', value: safeCost(cur.investimento, cur.cliques), unit: 'money' } },
      { key: 'leads', label: 'Leads', value: cur.leadsCount, prev: prev.leadsCount, deltaPct: deltaPct(cur.leadsCount, prev.leadsCount), rate: { label: 'Taxa de Cadastro', value: safeRate(cur.leadsCount, cur.cliques), unit: '%' }, cost: { label: 'Custo por Lead', value: safeCost(cur.investimento, cur.leadsCount), unit: 'money' } },
      { key: 'mql', label: 'MQL', value: cur.mql, prev: prev.mql, deltaPct: deltaPct(cur.mql, prev.mql), rate: { label: 'Taxa MQL', value: safeRate(cur.mql, cur.leadsCount), unit: '%' }, cost: { label: 'CMQL', value: safeCost(cur.investimento, cur.mql), unit: 'money' } },
      { key: 'sql', label: 'SQL', value: cur.sql, prev: prev.sql, deltaPct: deltaPct(cur.sql, prev.sql), rate: { label: 'Taxa SQL', value: safeRate(cur.sql, cur.mql), unit: '%' }, cost: { label: 'Custo por SQL', value: safeCost(cur.investimento, cur.sql), unit: 'money' } },
      { key: 'ra', label: 'RA', value: cur.ra, prev: prev.ra, deltaPct: deltaPct(cur.ra, prev.ra), rate: { label: 'Taxa Reunião', value: safeRate(cur.ra, cur.sql), unit: '%' }, cost: { label: 'Custo por RA', value: safeCost(cur.investimento, cur.ra), unit: 'money' } },
      { key: 'fechamento', label: 'Fechamento', value: cur.fechamento, prev: prev.fechamento, deltaPct: deltaPct(cur.fechamento, prev.fechamento), rate: { label: 'Tx Fechamento', value: safeRate(cur.fechamento, cur.ra), unit: '%' }, cost: { label: 'Custo por Fechamento', value: safeCost(cur.investimento, cur.fechamento), unit: 'money' } },
    ]
    const extraMetrics = {
      cpm: cur.impressoes > 0 ? round2((cur.investimento / cur.impressoes) * 1000) : 0,
      cpl: safeCost(cur.investimento, cur.leadsCount),
      roas: cur.investimento > 0 ? round2(cur.faturamento / cur.investimento) : 0,
    }

    // ── Série diária (sparklines + heatmap por dia) ──────────────
    const dayMap = new Map<string, { date: string; investimento: number; cmql: number; mql: number; sql: number; ra: number; rr: number; fechamento: number; faturamento: number }>()
    const ensureDay = (d: string) => {
      if (!dayMap.has(d)) dayMap.set(d, { date: d, investimento: 0, cmql: 0, mql: 0, sql: 0, ra: 0, rr: 0, fechamento: 0, faturamento: 0 })
      return dayMap.get(d)!
    }
    // preenche todos os dias do período (sem buracos)
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) ensureDay(toBrazilDay(new Date(t)))
    // c.date é @db.Date (UTC midnight) = dia-calendário do gasto → agrupar por dia UTC.
    for (const c of cur.campaignCosts) ensureDay(c.date.toISOString().slice(0, 10)).investimento += Number(c.spend)
    const posMql = rolePos('mql', posByKey), posSql = rolePos('sql', posByKey), posRa = rolePos('ra', posByKey), posFec = rolePos('fechamento', posByKey)
    for (const l of cur.leads) {
      const d = ensureDay(toBrazilDay(l.createdAt))
      const p = l.status && !LOST_KEYS.includes(l.status) ? posByKey.get(l.status) : undefined
      if (p !== undefined) {
        if (posMql !== null && p >= posMql) d.mql++
        if (posSql !== null && p >= posSql) d.sql++
        if (posRa !== null && p >= posRa) { d.ra++; d.rr++ }
        if (posFec !== null && p >= posFec) d.fechamento++
      }
      if (l.saleDetected) d.faturamento += Number(l.saleValue ?? 0)
    }
    for (const d of dayMap.values()) d.cmql = d.mql > 0 ? round2(d.investimento / d.mql) : 0
    const daily = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))

    // ── Por dia da semana (heatmap) ──────────────────────────────
    const wdMap = new Map<number, { weekday: number; label: string; investimento: number; mql: number; sql: number; ra: number; rr: number; fechamento: number }>()
    for (let i = 0; i < 7; i++) wdMap.set(i, { weekday: i, label: WEEKDAY_LABELS[i]!, investimento: 0, mql: 0, sql: 0, ra: 0, rr: 0, fechamento: 0 })
    for (const d of daily) {
      const w = wdMap.get(brWeekday(d.date))!
      w.investimento += d.investimento; w.mql += d.mql; w.sql += d.sql; w.ra += d.ra; w.rr += d.rr; w.fechamento += d.fechamento
    }
    const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((i) => { const w = wdMap.get(i)!; return { ...w, investimento: round2(w.investimento), cmql: w.mql > 0 ? round2(w.investimento / w.mql) : 0 } })

    // ── Quebras por campanha e adset ─────────────────────────────
    function breakdown(dimId: 'campaignId' | 'adsetId', dimName: 'campaignName' | 'adsetName', costLevel: 'campaign' | 'adset') {
      const rows = new Map<string, any>()
      const get = (id: string, name: string) => {
        if (!rows.has(id)) rows.set(id, { id, name: name || '(sem nome)', investimento: 0, leads: 0, mql: 0, sql: 0, ra: 0, rr: 0, fechamento: 0, perdido: 0 })
        return rows.get(id)
      }
      for (const l of cur.leads) {
        const id = (l as any)[dimId] || (dimId === 'campaignId' ? '0' : '(sem adset)')
        const r = get(String(id), (l as any)[dimName] || (id === '0' ? 'SEM_CAMPANHA' : ''))
        r.leads++
        if (l.status && LOST_KEYS.includes(l.status)) r.perdido++
        const p = l.status && !LOST_KEYS.includes(l.status) ? posByKey.get(l.status) : undefined
        if (p !== undefined) {
          if (posMql !== null && p >= posMql) r.mql++
          if (posSql !== null && p >= posSql) r.sql++
          if (posRa !== null && p >= posRa) { r.ra++; r.rr++ }
          if (posFec !== null && p >= posFec) r.fechamento++
        }
      }
      return { rows, get }
    }
    const campBd = breakdown('campaignId', 'campaignName', 'campaign')
    const adsetBd = breakdown('adsetId', 'adsetName', 'adset')
    // injeta custo por campanha/adset
    const costFrom = new Date(toBrazilDay(from) + 'T00:00:00.000Z')
    const costTo = new Date(toBrazilDay(to) + 'T23:59:59.999Z')
    const [campCostRows, adsetCostRows] = await Promise.all([
      prisma.campaignCost.findMany({ where: { date: { gte: costFrom, lte: costTo }, level: 'campaign' }, select: { campaignId: true, campaignName: true, spend: true } }),
      prisma.campaignCost.findMany({ where: { date: { gte: costFrom, lte: costTo }, level: 'adset' }, select: { adsetId: true, adsetName: true, spend: true } }),
    ])
    for (const c of campCostRows) { const r = campBd.get(String(c.campaignId), c.campaignName); r.investimento += Number(c.spend) }
    for (const c of adsetCostRows) { if (!c.adsetId) continue; const r = adsetBd.get(String(c.adsetId), c.adsetName || ''); r.investimento += Number(c.spend) }
    const finalize = (m: Map<string, any>) => [...m.values()]
      .map((r) => ({ ...r, investimento: round2(r.investimento), taxaMql: r.leads > 0 ? round2((r.mql / r.leads) * 100) : 0 }))
      .sort((a, b) => b.investimento - a.investimento || b.mql - a.mql)
    const campaigns = finalize(campBd.rows)
    const adsets = finalize(adsetBd.rows)

    return {
      funnels: funnelList,
      funnelId,
      period: { from: toBrazilDay(from), to: toBrazilDay(to), prevFrom: toBrazilDay(prevFrom), prevTo: toBrazilDay(prevTo) },
      kpis,
      funnel,
      extraMetrics,
      daily,
      byWeekday,
      campaigns,
      adsets,
    }
  })
}
