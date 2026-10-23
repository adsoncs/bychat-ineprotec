// src/services/receitaUnica.ts
//
// Fase 4 da integração Negociações/Metas/Comissões × Educacional (23/10/2026):
// RECEITA ÚNICA.
//
// Antes havia três números de receita que não batiam:
//   - o valor da PROPOSTA (comissão, metas, widgets de negociação);
//   - o valor de venda do LEAD (`Lead.saleValue`: placar de agentes, Meta CAPI,
//     Google Ads, ROAS, dashboards, relatórios de origem);
//   - o valor PAGO na inscrição (receita de matrículas do educacional).
// O `saleValue` era gravado por caminhos diferentes — o Ganho digitado, o /close
// da proposta (só a última), o caminho antigo do educacional (mensalidade ×
// duração) —, e cada relatório lia uma coisa.
//
// Com a chave ligada (Setting `receita.fonteUnica`), o `saleValue` passa a ser
// DERIVADO, sempre pela mesma conta:
//   soma das propostas GANHAS do lead
//   + soma das inscrições PAGAS que ainda não viraram proposta (sem dupla contagem).
// Lead sem proposta e sem inscrição com cobrança fica como está: o valor
// digitado à mão continua valendo onde não há fonte melhor.
//
// Como todo relatório já lê `saleValue`, placar, CAPI, Google Ads e ROAS passam
// a bater com Negociações sem mexer em cada tela. A receita de matrículas lê o
// valor pago, que é o mesmo que a proposta da inscrição carrega (Fase 2).
//
// Desligada = nada muda. A conciliação (`conciliacao`) mostra, sem gravar, os
// leads cujo valor atual difere da conta; `aplicar` corrige os escolhidos.

import { prisma } from '../lib/prisma.js'

const CHAVE = 'receita.fonteUnica'
export interface ConfigReceita { ligado: boolean; ligadoEm: string | null; ligadoPor: string | null }

let cache: { valor: ConfigReceita; ate: number } | null = null
export async function configReceita(): Promise<ConfigReceita> {
  if (cache && cache.ate > Date.now()) return cache.valor
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  const valor: ConfigReceita = { ligado: v?.ligado === true, ligadoEm: v?.ligadoEm ?? null, ligadoPor: v?.ligadoPor ?? null }
  cache = { valor, ate: Date.now() + 30_000 }
  return valor
}
export async function fonteUnicaLigada(): Promise<boolean> {
  return (await configReceita()).ligado
}
export async function salvarConfigReceita(ligado: boolean, quem: string | null): Promise<ConfigReceita> {
  const valor: ConfigReceita = { ligado, ligadoEm: ligado ? new Date().toISOString() : null, ligadoPor: ligado ? quem : null }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: valor as any, label: 'Receita única: valor de venda do lead derivado das propostas e inscrições', grp: 'comercial', fieldType: 'json' } as any,
    update: { value: valor as any },
  })
  cache = null
  return valor
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface ReceitaDoLead {
  /** false = lead sem proposta e sem inscrição com cobrança: a conta não se aplica. */
  gerenciado: boolean
  valor: number | null
  propostasGanhas: number
  valorPropostas: number
  inscricoesPagas: number
  valorInscricoes: number
}

/** A conta da receita única para um lead (não grava nada). */
export async function receitaDoLead(leadId: number): Promise<ReceitaDoLead> {
  const [negs, regs] = await Promise.all([
    prisma.negotiation.findMany({ where: { leadId }, select: { resultado: true, valorFinal: true, registrationId: true } }),
    prisma.enrollmentRegistration.findMany({
      where: { leadId, mergedIntoId: null, paymentStatus: { not: null } },
      select: { id: true, paymentStatus: true, paymentAmount: true },
    }),
  ])
  const ganhas = negs.filter((n) => n.resultado === 'won')
  const valorPropostas = r2(ganhas.reduce((s, n) => s + Number(n.valorFinal ?? 0), 0))
  // Inscrição que já tem proposta entra pela proposta — contar as duas dobraria a venda.
  const comProposta = new Set(negs.map((n) => n.registrationId).filter((x): x is number => x != null))
  const pagas = regs.filter((r) => r.paymentStatus === 'paid' && !comProposta.has(r.id))
  const valorInscricoes = r2(pagas.reduce((s, r) => s + Number(r.paymentAmount ?? 0), 0))
  const gerenciado = negs.length > 0 || regs.length > 0
  const total = r2(valorPropostas + valorInscricoes)
  return {
    gerenciado,
    valor: gerenciado && total > 0 ? total : null,
    propostasGanhas: ganhas.length,
    valorPropostas,
    inscricoesPagas: pagas.length,
    valorInscricoes,
  }
}

const iguais = (a: unknown, b: number | null) => (a == null ? null : r2(Number(a))) === b

/**
 * Recalcula o `saleValue` do lead pela conta da receita única. Só age com a
 * chave ligada (ou `forcar`, usado pela conciliação) e em lead gerenciado.
 * Devolve o antes/depois quando mudou.
 */
export async function sincronizarValorDeVenda(
  leadId: number,
  opts: { forcar?: boolean; origem?: string; userId?: number | null; userName?: string | null } = {},
): Promise<{ antes: number | null; depois: number | null } | null> {
  if (!opts.forcar && !(await fonteUnicaLigada())) return null
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { saleValue: true, saleDetected: true } })
  if (!lead) return null
  const r = await receitaDoLead(leadId)
  if (!r.gerenciado || iguais(lead.saleValue, r.valor)) return null
  const antes = lead.saleValue == null ? null : Number(lead.saleValue)
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      saleValue: r.valor,
      ...(r.valor != null && !lead.saleDetected ? { saleDetected: true, saleDetectedAt: new Date() } : {}),
    },
  })
  const fmt = (v: number | null) => (v == null ? 'vazio' : `R$ ${v.toFixed(2).replace('.', ',')}`)
  const partes = [
    r.propostasGanhas ? `${r.propostasGanhas} proposta(s) ganha(s) ${fmt(r.valorPropostas)}` : null,
    r.inscricoesPagas ? `${r.inscricoesPagas} inscrição(ões) paga(s) sem proposta ${fmt(r.valorInscricoes)}` : null,
  ].filter(Boolean)
  const { logEvent } = await import('./leadHistory.js')
  logEvent({
    leadId,
    type: 'sale_value_synced' as any,
    category: 'lifecycle',
    title: `Valor de venda: ${fmt(antes)} → ${fmt(r.valor)}`,
    description: partes.length ? `Receita única: ${partes.join(' + ')}.` : 'Receita única: nenhuma proposta ganha nem inscrição paga.',
    source: 'system',
    actorType: opts.userId ? 'operator' : 'system',
    userId: opts.userId ?? undefined,
    userName: opts.userName ?? undefined,
    metadata: { antes, depois: r.valor, origem: opts.origem ?? null, ...r },
  })
  return { antes, depois: r.valor }
}

export interface Divergencia {
  leadId: number
  nome: string | null
  outcome: string | null
  atual: number | null
  novo: number | null
  diferenca: number
  propostasGanhas: number
  inscricoesPagas: number
}

/** Leads cujo valor de venda difere da conta da receita única (sem gravar). */
export async function conciliacao(): Promise<{ divergencias: Divergencia[]; analisados: number }> {
  // Candidatos: quem tem proposta ou inscrição com cobrança. Os demais não entram na conta.
  const [comProposta, comInscricao] = await Promise.all([
    prisma.negotiation.findMany({ distinct: ['leadId'], select: { leadId: true } }),
    prisma.enrollmentRegistration.findMany({ where: { mergedIntoId: null, paymentStatus: { not: null }, leadId: { not: null } }, distinct: ['leadId'], select: { leadId: true } }),
  ])
  const ids = [...new Set([...comProposta.map((n) => n.leadId), ...comInscricao.map((r) => r.leadId!)])]
  const divergencias: Divergencia[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200)
    const leads = await prisma.lead.findMany({ where: { id: { in: lote } }, select: { id: true, nome: true, outcome: true, saleValue: true } })
    for (const l of leads) {
      const r = await receitaDoLead(l.id)
      if (!r.gerenciado || iguais(l.saleValue, r.valor)) continue
      const atual = l.saleValue == null ? null : r2(Number(l.saleValue))
      divergencias.push({
        leadId: l.id, nome: l.nome, outcome: l.outcome, atual, novo: r.valor,
        diferenca: r2((r.valor ?? 0) - (atual ?? 0)),
        propostasGanhas: r.propostasGanhas, inscricoesPagas: r.inscricoesPagas,
      })
    }
  }
  divergencias.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
  return { divergencias, analisados: ids.length }
}

/**
 * Escuta a inscrição (pagamento, estorno, cancelamento…) e, a cada 10 min,
 * revisa as inscrições mexidas nas últimas 48 h — mesma rede de segurança da
 * proposta da inscrição, para o que não emite evento.
 */
let ligado = false
export function ligarReceitaUnica(): void {
  if (ligado) return
  ligado = true
  const doLead = async (registrationId: number) => {
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true } }).catch(() => null)
    if (reg?.leadId) await sincronizarValorDeVenda(reg.leadId, { origem: 'inscricao' }).catch(() => null)
  }
  import('../lib/eventBus.js').then(({ eventBus }) => {
    eventBus.on('*', async (event: any) => {
      if (typeof event?.type !== 'string' || !event.type.startsWith('enrollment.')) return
      const id = Number(event.payload?.enrollmentId ?? event.payload?.registrationId)
      // Depois da proposta da inscrição (mesmo evento): ela pode criar/ganhar a proposta antes.
      if (Number.isInteger(id) && id > 0) setTimeout(() => { void doLead(id) }, 5_000)
    })
  }).catch(() => {})
  setInterval(async () => {
    if (!(await fonteUnicaLigada())) return
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { updatedAt: { gte: new Date(Date.now() - 48 * 3600_000) }, leadId: { not: null } },
      distinct: ['leadId'], select: { leadId: true }, take: 2000,
    }).catch(() => [])
    for (const r of regs) await sincronizarValorDeVenda(r.leadId!, { origem: 'revisao' }).catch(() => null)
  }, 10 * 60_000).unref()
}
