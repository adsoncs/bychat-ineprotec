// Relatório de Funil (Meta Ads → Funil de Vendas) para "Meus Painéis".
// Entrega TODOS os dados prontos para a view: KPIs com delta vs período
// anterior, série diária por KPI, funil em cascata (Impressão→…→Fechamento)
// com taxas e custo-por-etapa, heatmap por dia e por dia-da-semana, e quebras
// por campanha/adset. Junta CampaignCost (custo de Ads) + Lead (funil) por data
// e por campanha/adset. Reaproveita o padrão do metaAdsReport.
//
// O que define MQL, SQL, RA, RR, Fechamento e Faturamento vem da CONFIGURAÇÃO
// (services/funnelReportConfig.ts), por funil. Antes era hardcoded com as chaves
// de um cliente só — e medido contra os funis reais, a chave QUALIFICADO não
// existia em nenhum deles, o que fazia SQL ser 0 em 100% dos casos e MQL em 4 de
// 5 funis. KPI sem configuração agora devolve `null` (a tela mostra "—"), porque
// zero afirma sobre o negócio e null afirma sobre a configuração.
//
// O filtro `funnelId` troca o funil (padrão: primeiro funil ativo).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, superadminOnly } from '../lib/auth.js'
import {
  PAPEIS, PAPEL_LABEL, FONTES, lerConfig, salvarConfig, configDoFunil, sugerirConfig,
  ehTipoDeValor, type FunnelReportConfig, type Papel,
} from '../services/funnelReportConfig.js'
import {
  resolverTodos, montarLeadWhere, type ContextoResolucao, type ResultadoPapel,
} from '../services/funnelReportResolver.js'

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

interface StageInfo { key: string; position: number }

/** Etapas terminais de perda — usadas apenas para a coluna "perdido" das quebras.
 *  NÃO excluem mais o lead das etapas anteriores: excluí-los apagava 105 leads de
 *  todas as etapas que eles de fato alcançaram e inflava as taxas. */
const LOST_KEYS = ['PERDIDO', 'DESQUALIFICADO', 'DESQUALIFICADO_FORMS']

/** Valor de um papel para a view: contagem, soma ou null (não configurado). */
const valorDoPapel = (r: ResultadoPapel | undefined): number | null => {
  if (!r) return null
  if (r.valor !== null) return r.valor
  return r.leads ? r.leads.size : null
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

    // Configuração define os papéis; o escopo define quem entra no universo.
    const config = await lerConfig()
    const cfgFunil = configDoFunil(config, funnelId)
    const baseWhere = montarLeadWhere(funnelId, config.escopo)

    // ── Helpers de agregação por janela ──────────────────────────
    async function aggregate(winFrom: Date, winTo: Date) {
      // O topo do funil é por coorte de ENTRADA; as etapas seguintes são por
      // evento no período (ver funnelReportResolver.ts). Com escopo 'pago' o
      // universo bate com o Relatório Meta Ads; com 'todos', inclui orgânicos.
      const leadWhere: any = { ...baseWhere, createdAt: { gte: winFrom, lte: winTo } }
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
      const ctx: ContextoResolucao = {
        janela: { from: winFrom, to: winTo },
        leadWhere: baseWhere,
        posByKey,
        contagem: config.contagem,
        diaDe: toBrazilDay,
      }
      const papeis = await resolverTodos(cfgFunil, PAPEIS, ctx)
      return {
        leads, campaignCosts, investimento, impressoes, cliques, leadsCount: leads.length,
        papeis,
        mql: valorDoPapel(papeis.mql), sql: valorDoPapel(papeis.sql),
        ra: valorDoPapel(papeis.ra), rr: valorDoPapel(papeis.rr),
        fechamento: valorDoPapel(papeis.fechamento), faturamento: valorDoPapel(papeis.faturamento),
      }
    }

    const cur = await aggregate(from, to)
    const prev = await aggregate(prevFrom, prevTo)

    // `value: null` = papel sem configuração. A tela mostra "—" e um aviso para
    // configurar, em vez de afirmar que o resultado foi zero.
    const kpi = (cV: number | null, pV: number | null, format: 'money' | 'int', papel?: Papel) => ({
      value: cV, prev: pV,
      deltaPct: cV === null || pV === null ? null : deltaPct(cV, pV),
      format,
      ...(papel ? { origem: cur.papeis[papel]?.origem ?? null, configurado: cur.papeis[papel]?.tipo != null } : {}),
    })
    const arred = (v: number | null) => (v === null ? null : round2(v))
    const kpis = {
      investimento: kpi(round2(cur.investimento), round2(prev.investimento), 'money'),
      mql: kpi(cur.mql, prev.mql, 'int', 'mql'),
      sql: kpi(cur.sql, prev.sql, 'int', 'sql'),
      ra: kpi(cur.ra, prev.ra, 'int', 'ra'),
      rr: kpi(cur.rr, prev.rr, 'int', 'rr'),
      fechamento: kpi(cur.fechamento, prev.fechamento, 'int', 'fechamento'),
      faturamento: kpi(arred(cur.faturamento), arred(prev.faturamento), 'money', 'faturamento'),
    }

    // ── Funil em cascata (volume + taxa entre etapas + custo por etapa) ──
    // Taxa e custo devolvem null quando qualquer ponta não está configurada:
    // dividir por um KPI inexistente produziria 0% com cara de resultado ruim.
    //
    // Denominador zero com numerador positivo também é null, não 0%: houve 2
    // fechamentos e 0 reuniões concluídas — dizer "0% de fechamento" negaria os
    // fechamentos que existem. Só 0/0 é legitimamente 0%.
    const safeRate = (a: number | null, b: number | null) => {
      if (a === null || b === null) return null
      if (b > 0) return round2((a / b) * 100)
      return a > 0 ? null : 0
    }
    const safeCost = (spend: number, n: number | null) =>
      (n === null ? null : n > 0 ? round2(spend / n) : 0)
    // Base da taxa de fechamento: reunião realizada quando ela é medida e houve
    // alguma; senão, reunião agendada. Sem esse cuidado, um RR configurado mas
    // zerado zeraria a taxa de fechamento de quem fechou.
    const baseFechamento = cur.rr !== null && cur.rr > 0 ? cur.rr : cur.ra
    const funnel = [
      { key: 'impressao', label: 'Impressão', value: cur.impressoes, prev: prev.impressoes, deltaPct: deltaPct(cur.impressoes, prev.impressoes) },
      { key: 'cliques', label: 'Cliques', value: cur.cliques, prev: prev.cliques, deltaPct: deltaPct(cur.cliques, prev.cliques), rate: { label: 'CTR', value: safeRate(cur.cliques, cur.impressoes), unit: '%' }, cost: { label: 'CPC', value: safeCost(cur.investimento, cur.cliques), unit: 'money' } },
      { key: 'leads', label: 'Leads', value: cur.leadsCount, prev: prev.leadsCount, deltaPct: deltaPct(cur.leadsCount, prev.leadsCount), rate: { label: 'Taxa de Cadastro', value: safeRate(cur.leadsCount, cur.cliques), unit: '%' }, cost: { label: 'Custo por Lead', value: safeCost(cur.investimento, cur.leadsCount), unit: 'money' } },
      { key: 'mql', label: 'MQL', value: cur.mql, prev: prev.mql, deltaPct: kpis.mql.deltaPct, origem: cur.papeis.mql?.origem ?? null, rate: { label: 'Taxa MQL', value: safeRate(cur.mql, cur.leadsCount), unit: '%' }, cost: { label: 'CMQL', value: safeCost(cur.investimento, cur.mql), unit: 'money' } },
      { key: 'sql', label: 'SQL', value: cur.sql, prev: prev.sql, deltaPct: kpis.sql.deltaPct, origem: cur.papeis.sql?.origem ?? null, rate: { label: 'Taxa SQL', value: safeRate(cur.sql, cur.mql), unit: '%' }, cost: { label: 'Custo por SQL', value: safeCost(cur.investimento, cur.sql), unit: 'money' } },
      { key: 'ra', label: 'RA', value: cur.ra, prev: prev.ra, deltaPct: kpis.ra.deltaPct, origem: cur.papeis.ra?.origem ?? null, rate: { label: 'Taxa Reunião', value: safeRate(cur.ra, cur.sql), unit: '%' }, cost: { label: 'Custo por RA', value: safeCost(cur.investimento, cur.ra), unit: 'money' } },
      // RR entra na cascata: com fonte de agenda, é o comparecimento real e o
      // gargalo mais informativo do funil (antes era cópia de RA e ficava fora).
      { key: 'rr', label: 'RR', value: cur.rr, prev: prev.rr, deltaPct: kpis.rr.deltaPct, origem: cur.papeis.rr?.origem ?? null, rate: { label: 'Comparecimento', value: safeRate(cur.rr, cur.ra), unit: '%' }, cost: { label: 'Custo por RR', value: safeCost(cur.investimento, cur.rr), unit: 'money' } },
      { key: 'fechamento', label: 'Fechamento', value: cur.fechamento, prev: prev.fechamento, deltaPct: kpis.fechamento.deltaPct, origem: cur.papeis.fechamento?.origem ?? null, rate: { label: 'Tx Fechamento', value: safeRate(cur.fechamento, baseFechamento), unit: '%' }, cost: { label: 'Custo por Fechamento', value: safeCost(cur.investimento, cur.fechamento), unit: 'money' } },
    ]
    // Com fontes independentes, uma etapa pode ter MAIS leads que a anterior (ex.:
    // RA por agenda = 19 contra SQL por etapa = 10, dando "190%"). Não é erro de
    // cálculo, é a configuração não descrevendo um funil encaixado — e quem lê
    // precisa saber disso antes de concluir que a taxa está errada.
    const taxasAcimaDe100 = funnel
      .filter((f) => f.rate && f.rate.value !== null && f.rate.value > 100)
      .map((f) => ({ etapa: f.label, taxa: f.rate!.label, valor: f.rate!.value }))

    const extraMetrics = {
      cpm: cur.impressoes > 0 ? round2((cur.investimento / cur.impressoes) * 1000) : 0,
      cpl: safeCost(cur.investimento, cur.leadsCount),
      roas: cur.faturamento !== null && cur.investimento > 0 ? round2(cur.faturamento / cur.investimento) : null,
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
    // A série vem do resolvedor, já agrupada pelo dia do EVENTO (fechamento cai no
    // dia em que fechou, não no dia em que o lead entrou).
    for (const papel of PAPEIS) {
      const serie = cur.papeis[papel]?.porDia
      if (!serie) continue
      for (const [dia, n] of serie) {
        const d = ensureDay(dia)
        ;(d as any)[papel] = ((d as any)[papel] ?? 0) + n
      }
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
    // Cada papel resolvido é um conjunto de leadIds; a quebra apenas verifica a
    // que campanha/adset cada lead do conjunto pertence. Assim campanha e KPI
    // usam a MESMA definição — antes a quebra reimplementava a contagem por
    // posição de etapa e podia divergir do topo do relatório.
    const conjuntos: Partial<Record<Papel, Set<number>>> = {}
    for (const papel of PAPEIS) {
      const leads = cur.papeis[papel]?.leads
      if (leads) conjuntos[papel] = leads
    }
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
        for (const papel of ['mql', 'sql', 'ra', 'rr', 'fechamento'] as const) {
          if (conjuntos[papel]?.has(l.id)) r[papel]++
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

    // Papéis sem configuração: a tela precisa distinguir "não houve" de "não
    // medido" e oferecer o caminho para resolver.
    const naoConfigurados = PAPEIS.filter((papel) => cur.papeis[papel]?.tipo == null)
      .map((papel) => ({ papel, label: PAPEL_LABEL[papel] }))

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
      // Como o relatório foi apurado — o usuário precisa saber para interpretar.
      apuracao: {
        escopo: config.escopo,
        contagem: config.contagem,
        naoConfigurados,
        taxasAcimaDe100,
        origens: Object.fromEntries(PAPEIS.map((p) => [p, cur.papeis[p]?.origem ?? null])),
      },
    }
  })

  // ── Configuração (somente superadmin) ────────────────────────────
  //
  // Fica atrás de `superadminOnly` porque muda o significado de todo KPI do
  // relatório: quem configura define o que a agência chama de MQL.

  app.get('/api/admin/funnel-report/config', { preHandler: superadminOnly }, async () => {
    const [config, funnels, tags, customFields, forms] = await Promise.all([
      lerConfig(),
      prisma.funnel.findMany({
        where: { active: true },
        select: { id: true, name: true, isDefault: true, stages: { select: { key: true, name: true, position: true }, orderBy: { position: 'asc' } } },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
      prisma.tag.findMany({ where: { active: true }, select: { id: true, name: true, color: true }, orderBy: { position: 'asc' } }),
      prisma.customField.findMany({ where: { active: true }, select: { key: true, label: true, type: true, options: true }, orderBy: { position: 'asc' } }),
      prisma.form.findMany({ select: { id: true, name: true, fields: true } }),
    ])

    // Campos qualificadores existentes, com os valores considerados positivos.
    // É o que permite escolher "resposta positiva na qualificação" sabendo
    // exatamente qual resposta conta.
    const qualificadores: Array<{ key: string; label: string; positiveValues: string[]; forms: string[] }> = []
    const porChave = new Map<string, { key: string; label: string; positiveValues: Set<string>; forms: Set<string> }>()
    for (const f of forms) {
      const campos: any[] = Array.isArray(f.fields) ? (f.fields as any[]) : []
      for (const c of campos) {
        if (!c?.isQualifier || !c.key) continue
        let reg = porChave.get(c.key)
        if (!reg) { reg = { key: c.key, label: c.label || c.key, positiveValues: new Set(), forms: new Set() }; porChave.set(c.key, reg) }
        for (const v of (Array.isArray(c.positiveValues) ? c.positiveValues : [])) reg.positiveValues.add(String(v))
        reg.forms.add(f.name)
      }
    }
    for (const r of porChave.values()) {
      qualificadores.push({ key: r.key, label: r.label, positiveValues: [...r.positiveValues], forms: [...r.forms] })
    }

    return {
      config,
      fontes: FONTES,
      papeis: PAPEIS.map((p) => ({ key: p, label: PAPEL_LABEL[p] })),
      funnels,
      // Sugestão por funil, derivada das etapas REAIS. Não é aplicada sozinha:
      // sugestão auto-aplicada viraria o mesmo hardcode de antes, só mais
      // difícil de enxergar.
      sugestoes: Object.fromEntries(funnels.map((f) => [String(f.id), sugerirConfig(f.stages)])),
      catalogos: {
        tags,
        customFields,
        qualificadores,
        bookingStatuses: ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show', 'rescheduled'],
        negotiationStatuses: ['rascunho', 'enviada', 'em_negociacao', 'aceita', 'recusada', 'expirada'],
        scoreLabels: ['hot', 'warm', 'cold'],
      },
    }
  })

  app.put('/api/admin/funnel-report/config', { preHandler: superadminOnly }, async (req, reply) => {
    const b = (req.body ?? {}) as Partial<FunnelReportConfig>
    if (!b || typeof b !== 'object') return reply.code(400).send({ error: 'corpo inválido' })
    const salvo = await salvarConfig({
      porFunil: b.porFunil ?? {},
      escopo: b.escopo === 'pago' ? 'pago' : 'todos',
      contagem: b.contagem === 'atual' ? 'atual' : 'passou',
    })
    return { ok: true, config: salvo }
  })
}
