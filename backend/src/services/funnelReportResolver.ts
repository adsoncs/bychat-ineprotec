// src/services/funnelReportResolver.ts
//
// Resolve cada papel do funil (MQL, SQL, RA, RR, Fechamento, Faturamento) no
// dado real, conforme a configuração de funnelReportConfig.ts.
//
// Duas decisões que governam o arquivo:
//
// 1. Cada fonte devolve um CONJUNTO de leadIds (ou uma soma, no faturamento).
//    Conjuntos, e não contadores, garantem que um lead com 3 reuniões conte uma
//    vez, e permitem devolver `null` quando o papel não está configurado — em vez
//    de 0, que é uma afirmação sobre o negócio e não sobre a configuração.
//
// 2. A janela recai sobre o EVENTO, não sobre a criação do lead. Um lead que
//    entrou em janeiro e fechou em março é fechamento de MARÇO. É assim que um
//    funil de vendas se lê, e é diferente do relatório de mídia, que atribui tudo
//    à data de entrada. Por isso o universo é um FILTRO (`leadWhere`), não uma
//    lista de ids: a lista teria de conter todos os leads históricos do funil, o
//    que não passa de alguns milhares de registros.
//
//    Consequência assumida: o topo do funil (Leads) é por coorte de entrada e as
//    etapas seguintes são por evento no período. Um relatório 100% coorte
//    esconderia todo fechamento de ciclo longo.

import { prisma } from '../lib/prisma.js'
import type { DefKpi, ConfigFunil, Papel, FunnelReportConfig } from './funnelReportConfig.js'
import { ehTipoDeValor } from './funnelReportConfig.js'

export interface Janela { from: Date; to: Date }

export interface ContextoResolucao {
  janela: Janela
  /**
   * Filtro base do universo (funil + escopo pago/todos), SEM recorte de data.
   * A data é aplicada por cada fonte, no campo que descreve seu evento.
   */
  leadWhere: Record<string, unknown>
  /** Etapas do funil selecionado, para resolver `etapa` no modo 'atual'. */
  posByKey: Map<string, number>
  contagem: 'passou' | 'atual'
  /**
   * Converte instante em dia-calendário no fuso do relatório. Injetado para a
   * série temporal usar exatamente a mesma regra de fuso das demais séries —
   * duplicar a conversão aqui abriria divergência de um dia entre os gráficos.
   */
  diaDe: (d: Date) => string
}

export interface ResultadoPapel {
  /** null = não configurado. O relatório mostra "—", nunca 0. */
  leads: Set<number> | null
  valor: number | null
  tipo: DefKpi['tipo'] | null
  /** Texto curto dizendo de onde veio o número — vai para a tela. */
  origem: string | null
  /**
   * Série por dia do EVENTO (dia → contagem de leads ou soma em R$). Sem isto o
   * gráfico atribuiria o fechamento ao dia de ENTRADA do lead, o que desloca a
   * curva inteira em ciclos de venda longos.
   */
  porDia: Map<string, number>
}

const VAZIO: ResultadoPapel = { leads: null, valor: null, tipo: null, origem: null, porDia: new Map() }

/**
 * Reduz ids vindos de tabela sem relação Prisma (Booking, Negotiation — `leadId`
 * é coluna solta) ao universo do relatório. O `in` carrega o tamanho do resultado
 * daquela tabela, não o do universo de leads.
 */
async function restringirAoUniverso(ids: number[], ctx: ContextoResolucao): Promise<Set<number>> {
  const unicos = [...new Set(ids)]
  if (!unicos.length) return new Set()
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, id: { in: unicos } },
    select: { id: true },
  })
  return new Set(leads.map((l) => l.id))
}

/**
 * Ocorrência de um papel: qual lead, e QUANDO o evento aconteceu. É o par mínimo
 * que permite montar contagem e série temporal sem consultar duas vezes.
 */
interface Ocorrencia { leadId: number; quando: Date; valor?: number }

/** Colapsa ocorrências em conjunto de leads + série por dia do evento. */
function agregar(occ: Ocorrencia[], ctx: ContextoResolucao, somarValor = false): { leads: Set<number>; porDia: Map<string, number> } {
  const leads = new Set<number>()
  const porDia = new Map<string, number>()
  const jaContado = new Set<string>()
  for (const o of occ) {
    const dia = ctx.diaDe(o.quando)
    if (somarValor) {
      porDia.set(dia, (porDia.get(dia) ?? 0) + (o.valor ?? 0))
      leads.add(o.leadId)
      continue
    }
    leads.add(o.leadId)
    // Um lead que voltou à mesma etapa duas vezes no mesmo dia conta uma vez no
    // dia; em dias diferentes, conta em cada dia (a série mostra atividade).
    const chave = `${o.leadId}|${dia}`
    if (jaContado.has(chave)) continue
    jaContado.add(chave)
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1)
  }
  return { leads, porDia }
}

// ── Fontes de contagem ────────────────────────────────────────────

/**
 * Leads que ALCANÇARAM uma das etapas no período.
 *
 * Com `contagem='passou'`, lê o histórico e inclui quem já saiu da etapa —
 * inclusive quem foi perdido depois. Era aqui que o relatório antigo perdia 15
 * dos 18 leads que passaram por REUNIAO, e 2 dos 4 que chegaram a FECHADO.
 */
async function porEtapa(def: Extract<DefKpi, { tipo: 'etapa' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const alvos = def.stageKeys.filter(Boolean)
  if (!alvos.length) return []

  if (ctx.contagem === 'passou') {
    // LeadEvent TEM relação com Lead — filtra pelo universo no próprio banco.
    const ev = await prisma.leadEvent.findMany({
      where: {
        type: 'status_changed',
        newValue: { in: alvos },
        createdAt: { gte: ctx.janela.from, lte: ctx.janela.to },
        lead: ctx.leadWhere,
      },
      select: { leadId: true, createdAt: true },
    })
    const occ: Ocorrencia[] = ev.map((e) => ({ leadId: e.leadId, quando: e.createdAt }))
    // O histórico só registra MUDANÇAS. Lead criado já na etapa alvo (importação,
    // webhook que entra direto em CONTATADO) nunca gerou evento — sem isto,
    // desapareceria da etapa em que nasceu.
    const nascidos = await prisma.lead.findMany({
      where: { ...ctx.leadWhere, status: { in: alvos }, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
      select: { id: true, createdAt: true },
    })
    const jaTem = new Set(occ.map((o) => o.leadId))
    for (const l of nascidos) if (!jaTem.has(l.id)) occ.push({ leadId: l.id, quando: l.createdAt })
    return occ
  }

  // contagem='atual': está na etapa ou além. Mantido como opção, com uma
  // diferença deliberada em relação ao código antigo — os perdidos NÃO são mais
  // excluídos. Excluí-los apagava 105 leads de todas as etapas que eles de fato
  // alcançaram e inflava as taxas de conversão.
  const posAlvo = Math.min(...alvos.map((k) => ctx.posByKey.get(k) ?? Number.POSITIVE_INFINITY))
  if (!Number.isFinite(posAlvo)) return []
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, status: true, createdAt: true },
  })
  const occ: Ocorrencia[] = []
  for (const l of leads) {
    const p = l.status ? ctx.posByKey.get(l.status) : undefined
    // Neste modo a data do evento é desconhecida — só se sabe onde o lead está
    // AGORA. Usa a entrada, que é a única data disponível.
    if (p !== undefined && p >= posAlvo) occ.push({ leadId: l.id, quando: l.createdAt })
  }
  return occ
}

/**
 * Leads que responderam valor POSITIVO num campo qualificador.
 *
 * Os valores positivos vivem em `Form.fields[].positiveValues` (JSON) e a
 * resposta em `Lead.customFields` (JSON) — nenhum é coluna, então o cruzamento é
 * em memória. Isso também permite reproduzir exatamente a regra de
 * `resolveQualification`: sem positiveValues declarados, qualquer resposta
 * preenchida conta como positiva.
 *
 * A janela é a de ENTRADA do lead: a resposta é dada na captação, não depois.
 */
async function porQualificacao(
  def: Extract<DefKpi, { tipo: 'qualificacao' }>,
  ctx: ContextoResolucao,
): Promise<Ocorrencia[]> {
  const chaves = def.fieldKeys.filter(Boolean)
  if (!chaves.length) return []

  const forms = await prisma.form.findMany({ select: { fields: true } })
  const positivosPorChave = new Map<string, string[]>()
  for (const f of forms) {
    const campos: any[] = Array.isArray(f.fields) ? (f.fields as any[]) : []
    for (const c of campos) {
      if (!c?.key || !chaves.includes(c.key)) continue
      const pv: string[] = Array.isArray(c.positiveValues) ? c.positiveValues.map(String) : []
      const atual = positivosPorChave.get(c.key) ?? []
      // O mesmo campo aparece em vários formulários com listas diferentes (é o
      // caso de invest_inicial). União, para não perder o lead de um dos forms.
      positivosPorChave.set(c.key, [...new Set([...atual, ...pv])])
    }
  }

  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, customFields: true, createdAt: true },
  })
  const occ: Ocorrencia[] = []
  for (const l of leads) {
    const cf = (l.customFields ?? {}) as Record<string, unknown>
    for (const k of chaves) {
      const resp = cf[k]
      if (resp === undefined || resp === null || resp === '') continue
      const positivos = positivosPorChave.get(k) ?? []
      const ehPositivo = positivos.length ? positivos.includes(String(resp)) : !!resp
      if (ehPositivo) { occ.push({ leadId: l.id, quando: l.createdAt }); break }
    }
  }
  return occ
}

async function porCampo(def: Extract<DefKpi, { tipo: 'campo' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  if (!def.key) return []
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, customFields: true, createdAt: true },
  })
  const valores = (def.valores ?? []).map(String)
  const occ: Ocorrencia[] = []
  for (const l of leads) {
    const v = ((l.customFields ?? {}) as Record<string, unknown>)[def.key]
    const preenchido = v !== undefined && v !== null && v !== ''
    if (def.operador === 'preenchido') { if (preenchido) occ.push({ leadId: l.id, quando: l.createdAt }); continue }
    if (!preenchido) continue
    const bate = valores.includes(String(v))
    if (def.operador === 'igual' ? bate : !bate) occ.push({ leadId: l.id, quando: l.createdAt })
  }
  return occ
}

async function porScore(def: Extract<DefKpi, { tipo: 'score' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to }, [def.campo]: { gte: def.min } } as any,
    select: { id: true, createdAt: true },
  })
  return leads.map((l) => ({ leadId: l.id, quando: l.createdAt }))
}

async function porScoreLabel(def: Extract<DefKpi, { tipo: 'score_label' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const labels = (def.labels ?? []).filter(Boolean)
  if (!labels.length) return []
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to }, aiScoreLabel: { in: labels } },
    select: { id: true, createdAt: true },
  })
  return leads.map((l) => ({ leadId: l.id, quando: l.createdAt }))
}

async function porTag(def: Extract<DefKpi, { tipo: 'tag' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const ids = (def.tagIds ?? []).filter((n) => Number.isFinite(n))
  if (!ids.length) return []
  // LeadTag tem relação com Lead — e a data é a da marcação, que é o evento.
  const rows = await prisma.leadTag.findMany({
    where: { tagId: { in: ids }, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to }, lead: ctx.leadWhere },
    select: { leadId: true, createdAt: true },
  })
  return rows.map((r) => ({ leadId: r.leadId, quando: r.createdAt }))
}

/**
 * Leads com agendamento. A janela recai sobre `startAt` (quando a reunião
 * acontece), não sobre a criação do booking: reunião marcada em março para abril
 * é reunião de abril.
 */
async function porAgendamento(def: Extract<DefKpi, { tipo: 'agendamento' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const statuses = (def.statuses ?? []).filter(Boolean)
  if (!statuses.length) return []
  const bookings = await prisma.booking.findMany({
    where: {
      leadId: { not: null }, status: { in: statuses },
      startAt: { gte: ctx.janela.from, lte: ctx.janela.to },
    },
    select: { leadId: true, startAt: true },
  })
  const permitidos = await restringirAoUniverso(bookings.map((b) => b.leadId!), ctx)
  return bookings
    .filter((b) => b.leadId != null && permitidos.has(b.leadId))
    .map((b) => ({ leadId: b.leadId!, quando: b.startAt }))
}

async function porNegociacao(def: Extract<DefKpi, { tipo: 'negociacao' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const negs = await buscarNegociacoes(def, ctx)
  const permitidos = await restringirAoUniverso(negs.map((n) => n.leadId), ctx)
  return negs
    .filter((n) => permitidos.has(n.leadId))
    .map((n) => ({ leadId: n.leadId, quando: n.fechadaEm ?? n.createdAt }))
}

/**
 * Consulta compartilhada por porNegociacao e valorNegociacao. Proposta fechada
 * pertence à data do FECHAMENTO; em aberto, à de criação — juntar as duas regras
 * num só lugar evita que a contagem e a soma divirjam de janela.
 */
async function buscarNegociacoes(
  def: { statuses?: string[]; resultado?: 'won' | 'lost' },
  ctx: ContextoResolucao,
) {
  const where: any = {}
  if (def.statuses?.length) where.status = { in: def.statuses }
  if (def.resultado) where.resultado = def.resultado
  Object.assign(where, def.resultado
    ? { fechadaEm: { gte: ctx.janela.from, lte: ctx.janela.to } }
    : { createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } })
  return prisma.negotiation.findMany({
    where,
    select: { leadId: true, valorFinal: true, fechadaEm: true, createdAt: true },
  })
}

async function porOutcome(def: Extract<DefKpi, { tipo: 'outcome' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const leads = await prisma.lead.findMany({
    where: {
      ...ctx.leadWhere, outcome: def.valor,
      // outcomeAt, não createdAt: o fechamento pertence ao mês em que aconteceu.
      outcomeAt: { gte: ctx.janela.from, lte: ctx.janela.to },
    },
    select: { id: true, outcomeAt: true },
  })
  return leads.map((l) => ({ leadId: l.id, quando: l.outcomeAt! }))
}

async function porVendaIa(ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, saleDetected: true, saleDetectedAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, saleDetectedAt: true },
  })
  return leads.map((l) => ({ leadId: l.id, quando: l.saleDetectedAt! }))
}

// ── Fontes de valor (faturamento) ─────────────────────────────────

async function valorNegociacao(def: Extract<DefKpi, { tipo: 'valor_negociacao' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const negs = await buscarNegociacoes(def, ctx)
  if (!negs.length) return []
  // Sem relação Prisma, o universo é aplicado depois — somar sem isso contaria
  // proposta de lead fora do funil selecionado.
  const permitidos = await restringirAoUniverso(negs.map((n) => n.leadId), ctx)
  return negs
    .filter((n) => permitidos.has(n.leadId))
    .map((n) => ({ leadId: n.leadId, quando: n.fechadaEm ?? n.createdAt, valor: Number(n.valorFinal ?? 0) }))
}

async function valorVendaIa(ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, saleDetected: true, saleDetectedAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, saleDetectedAt: true, saleValue: true },
  })
  return leads.map((l) => ({ leadId: l.id, quando: l.saleDetectedAt!, valor: Number(l.saleValue ?? 0) }))
}

async function valorCampo(def: Extract<DefKpi, { tipo: 'valor_campo' }>, ctx: ContextoResolucao): Promise<Ocorrencia[]> {
  if (!def.key) return []
  const leads = await prisma.lead.findMany({
    where: { ...ctx.leadWhere, createdAt: { gte: ctx.janela.from, lte: ctx.janela.to } },
    select: { id: true, customFields: true, createdAt: true },
  })
  const occ: Ocorrencia[] = []
  for (const l of leads) {
    const v = ((l.customFields ?? {}) as Record<string, unknown>)[def.key]
    if (v === undefined || v === null || v === '') continue
    // Aceita "1.234,56" e "1234.56": campo digitado por operador vem dos dois jeitos.
    const n = Number(String(v).replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
    if (Number.isFinite(n)) occ.push({ leadId: l.id, quando: l.createdAt, valor: n })
  }
  return occ
}

// ── Descrição de origem ───────────────────────────────────────────

/** Texto curto que o relatório mostra sob o KPI. Sem isto, o número é opaco. */
export function descreverOrigem(def: DefKpi): string {
  switch (def.tipo) {
    case 'etapa': return `Etapa do funil: ${def.stageKeys.join(', ')}`
    case 'qualificacao': return `Resposta positiva em: ${def.fieldKeys.join(', ')}`
    case 'campo': return `Campo "${def.key}" ${def.operador === 'preenchido' ? 'preenchido' : `${def.operador} a ${(def.valores ?? []).join('/')}`}`
    case 'score': return `${def.campo === 'aiScore' ? 'Score de IA' : 'Score de prioridade'} ≥ ${def.min}`
    case 'score_label': return `Classificação do score: ${def.labels.join(', ')}`
    case 'tag': return `Tag do lead (${def.tagIds.length})`
    case 'agendamento': return `Agenda: ${def.statuses.join(', ')}`
    case 'negociacao': return def.resultado ? `Proposta com resultado "${def.resultado}"` : `Proposta em: ${(def.statuses ?? []).join(', ')}`
    case 'outcome': return `Desfecho "${def.valor === 'won' ? 'ganho' : 'perdido'}" classificado pelo operador`
    case 'venda_ia': return 'Venda detectada por IA na conversa'
    case 'valor_negociacao': return def.resultado ? `Valor das propostas com resultado "${def.resultado}"` : `Valor das propostas em: ${(def.statuses ?? []).join(', ')}`
    case 'valor_venda_ia': return 'Valor da venda detectada por IA'
    case 'valor_campo': return `Soma do campo "${def.key}"`
    case 'nenhum': return 'Não medido'
    default: return 'Origem desconhecida'
  }
}

// ── Entrada principal ─────────────────────────────────────────────

export async function resolverPapel(def: DefKpi | undefined, ctx: ContextoResolucao): Promise<ResultadoPapel> {
  // Distingue "desligado de propósito" de "nunca configurado": os dois mostram
  // "—", mas só o segundo aparece como pendência na tela de configuração.
  if (!def) return VAZIO
  if (def.tipo === 'nenhum') return { leads: null, valor: null, tipo: 'nenhum', origem: 'Não medido', porDia: new Map() }

  const origem = descreverOrigem(def)

  if (ehTipoDeValor(def)) {
    let occ: Ocorrencia[] = []
    if (def.tipo === 'valor_negociacao') occ = await valorNegociacao(def, ctx)
    else if (def.tipo === 'valor_venda_ia') occ = await valorVendaIa(ctx)
    else if (def.tipo === 'valor_campo') occ = await valorCampo(def, ctx)
    const { porDia } = agregar(occ, ctx, true)
    const total = occ.reduce((s, o) => s + (o.valor ?? 0), 0)
    return { leads: null, valor: Math.round(total * 100) / 100, tipo: def.tipo, origem, porDia }
  }

  let occ: Ocorrencia[] = []
  switch (def.tipo) {
    case 'etapa': occ = await porEtapa(def, ctx); break
    case 'qualificacao': occ = await porQualificacao(def, ctx); break
    case 'campo': occ = await porCampo(def, ctx); break
    case 'score': occ = await porScore(def, ctx); break
    case 'score_label': occ = await porScoreLabel(def, ctx); break
    case 'tag': occ = await porTag(def, ctx); break
    case 'agendamento': occ = await porAgendamento(def, ctx); break
    case 'negociacao': occ = await porNegociacao(def, ctx); break
    case 'outcome': occ = await porOutcome(def, ctx); break
    case 'venda_ia': occ = await porVendaIa(ctx); break
  }
  const { leads, porDia } = agregar(occ, ctx)
  return { leads, valor: null, tipo: def.tipo, origem, porDia }
}

export async function resolverTodos(
  cfgFunil: Partial<ConfigFunil>,
  papeis: readonly Papel[],
  ctx: ContextoResolucao,
): Promise<Record<Papel, ResultadoPapel>> {
  const out = {} as Record<Papel, ResultadoPapel>
  // Sequencial de propósito: são 6 papéis, cada um podendo varrer a mesma tabela.
  // Em paralelo abriria 6 consultas concorrentes por janela (12 com o período
  // anterior) sem ganho perceptível num relatório sob demanda.
  for (const p of papeis) out[p] = await resolverPapel(cfgFunil[p], ctx)
  return out
}

/** Filtro base do universo: funil + escopo, sem recorte de data. */
export function montarLeadWhere(
  funnelId: number | null,
  escopo: FunnelReportConfig['escopo'],
): Record<string, unknown> {
  const where: Record<string, unknown> = {}
  if (funnelId) where.funnelId = funnelId
  // 'pago' preserva a paridade com o Relatório Meta Ads; 'todos' é o funil de
  // vendas de verdade — 43% dos leads não vêm de campanha.
  if (escopo === 'pago') where.campaignId = { not: null }
  return where
}
