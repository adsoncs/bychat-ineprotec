// Traz da Kommo o que já foi ganho ou perdido: marca o desfecho no lead e
// registra a negociação correspondente.
//
// Por que os dois de uma vez: a Visão Geral tem indicadores que leem de lugares
// diferentes. Conversão/receita saem de `Lead.outcome` + `Lead.saleValue`;
// "Em negociação", "Fechado em negociações" e "Ticket médio" saem da tabela de
// negociações. Sem isto, 411 matrículas realizadas e 584 perdidas ficavam
// invisíveis no painel, e os três KPIs de negociação em zero.
//
// Fases:
//   A) motivos de perda da Kommo → LossReason (mapeados por KommoMapping)
//   B) varredura /leads: status_id 142 (ganho) / 143 (perdido)
//        → Lead.outcome/outcomeAt/lostReasonId/saleValue
//        → Negotiation fechada (só quando há valor — ver NOTA)
//
// NOTA sobre valor: a negociação só é criada quando há valor conhecido (o
// `price` da Kommo ou o preço do curso no catálogo). Criar proposta de valor
// zero distorceria o ticket médio, que divide receita por número de ganhas.
// O desfecho do lead é gravado sempre, com ou sem valor.
//
// Idempotente: KommoMapping('negotiation', kommoId=<leadId da Kommo>).
//
// Uso: npx tsx scripts/importKommoClosedDeals.ts [--apply] [--limit-pages=N]
import { prisma } from '../src/lib/prisma.js'
import { getKommoConfig, kommoFetch } from '../src/lib/kommoClient.js'
import { loadSuggestionContext, buildSuggestionFromFields } from '../src/services/negotiationSuggestion.js'

const APPLY = process.argv.includes('--apply')
const LIMIT_PAGES = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit-pages='))
  return a ? parseInt(a.split('=')[1], 10) : 0
})()

/** Status fixos da Kommo, iguais em todos os funis. */
const STATUS_WON = 142
const STATUS_LOST = 143

const unix = (s?: number | null): Date | null => (s ? new Date(s * 1000) : null)

async function importLossReasons(cfg: any): Promise<Map<string, number>> {
  const data = await kommoFetch('/leads/loss_reasons?limit=250', cfg)
  const list: any[] = data?._embedded?.loss_reasons ?? []
  const map = new Map<string, number>()
  for (const r of list) {
    const name = String(r.name || '').substring(0, 100)
    if (!name) continue
    const existing = await prisma.lossReason.findFirst({ where: { name }, select: { id: true } })
    let localId = existing?.id
    if (!localId) {
      if (!APPLY) { map.set(String(r.id), -1); continue }
      const created = await prisma.lossReason.create({ data: { name, active: true, position: r.sort ?? 0 } })
      localId = created.id
    }
    if (APPLY) {
      await prisma.kommoMapping.upsert({
        where: { entityType_kommoId: { entityType: 'loss_reason', kommoId: String(r.id) } },
        create: { entityType: 'loss_reason', kommoId: String(r.id), localId, meta: { name } },
        update: { localId, meta: { name } },
      })
    }
    map.set(String(r.id), localId)
  }
  return map
}

async function main() {
  const cfg = await getKommoConfig(true)
  if (!cfg.subdomain || !cfg.token) throw new Error('Kommo não configurado')
  console.log(`Conta: ${cfg.subdomain} | modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --apply)'}`)

  console.log('\n=== FASE A — motivos de perda ===')
  const lossMap = await importLossReasons(cfg)
  console.log(`motivos: ${lossMap.size}${APPLY ? '' : ' (não gravados em dry-run)'}`)

  const ctx = await loadSuggestionContext()
  const leadRows = await prisma.kommoMapping.findMany({ where: { entityType: 'lead' }, select: { kommoId: true, localId: true } })
  const leadIdByKommo = new Map(leadRows.map((r) => [r.kommoId, r.localId]))
  const negRows = await prisma.kommoMapping.findMany({ where: { entityType: 'negotiation' }, select: { kommoId: true, localId: true } })
  const negByKommoLead = new Map(negRows.map((r) => [r.kommoId, r.localId]))

  console.log('\n=== FASE B — leads fechados ===')
  let page = 1, varridos = 0, ganhos = 0, perdidos = 0
  let outcomeGravados = 0, negCriadas = 0, negJaExistiam = 0, semValor = 0, semLeadLocal = 0
  let somaGanho = 0
  const amostra: string[] = []

  for (;;) {
    const data = await kommoFetch(`/leads?limit=250&page=${page}`, cfg)
    const items: any[] = data?._embedded?.leads ?? []
    if (items.length === 0) break

    for (const l of items) {
      varridos++
      const st = Number(l.status_id)
      if (st !== STATUS_WON && st !== STATUS_LOST) continue
      const won = st === STATUS_WON
      won ? ganhos++ : perdidos++

      const leadId = leadIdByKommo.get(String(l.id))
      if (!leadId) { semLeadLocal++; continue }

      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true, assignedUserId: true, outcome: true } })
      if (!lead) { semLeadLocal++; continue }

      const fechadaEm = unix(l.closed_at) ?? unix(l.updated_at) ?? new Date()
      const lostReasonId = !won && l.loss_reason_id ? lossMap.get(String(l.loss_reason_id)) ?? null : null

      // ── Valores: o item é o curso (valor de tabela); o preço fechado na
      // Kommo, quando existe, é o que vale — a diferença vira desconto para a
      // conta da proposta continuar batendo (subtotal − desconto = total).
      const sug = buildSuggestionFromFields(((lead.customFields as any) || {}) as Record<string, any>, ctx)
      const items_ = sug?.items ?? []
      const valorTabela = items_.reduce((s, i) => s + i.precoUnit * i.quantidade - (i.descontoItem || 0), 0)
      const priceKommo = Number(l.price) > 0 ? Number(l.price) : null
      let valorFinal = priceKommo ?? valorTabela
      let descontoTipo = sug?.descontoTipo ?? null
      let descontoValor = sug?.descontoValor ?? null
      if (priceKommo != null && valorTabela > 0 && priceKommo < valorTabela) {
        descontoTipo = 'valor'
        descontoValor = Number((valorTabela - priceKommo).toFixed(2))
      } else if (priceKommo == null && descontoTipo && descontoValor) {
        valorFinal = descontoTipo === 'percent'
          ? Math.max(0, valorTabela - valorTabela * (descontoValor / 100))
          : Math.max(0, valorTabela - descontoValor)
      }

      if (won && valorFinal > 0) somaGanho += valorFinal

      // ── Desfecho no lead (sempre) ──
      if (APPLY) {
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            outcome: won ? 'won' : 'lost',
            outcomeAt: fechadaEm,
            outcomeNote: 'Importado da Kommo',
            ...(lostReasonId ? { lostReasonId } : {}),
            ...(won && valorFinal > 0 ? { saleValue: valorFinal } : {}),
          },
        }).catch(() => {})
      }
      outcomeGravados++

      // ── Negociação (só com valor conhecido) ──
      if (valorFinal <= 0) { semValor++; continue }
      if (negByKommoLead.has(String(l.id))) { negJaExistiam++; continue }

      if (amostra.length < 5) {
        amostra.push(`lead ${leadId} · ${won ? 'GANHA' : 'PERDIDA'} · ${items_[0]?.nome ?? 'sem item'} · tabela ${valorTabela} → final ${valorFinal}${lostReasonId ? ' · motivo mapeado' : ''}`)
      }

      if (APPLY) {
        const neg = await prisma.negotiation.create({
          data: {
            leadId,
            titulo: (sug?.titulo ?? 'Proposta').substring(0, 191),
            status: won ? 'aceita' : 'recusada',
            valorTabela: valorTabela > 0 ? valorTabela : valorFinal,
            descontoTipo, descontoValor,
            valorFinal,
            pagamentoForma: sug?.pagamentoForma ?? null,
            parcelas: sug?.parcelas ?? null,
            condicaoPagamento: sug?.condicaoPagamento ?? null,
            responsavelUserId: lead.assignedUserId ?? null,
            observacoes: `Importada da Kommo (lead ${l.id}).`,
            resultado: won ? 'won' : 'lost',
            lostReasonId,
            fechadaEm,
            createdAt: unix(l.created_at) ?? fechadaEm,
            items: items_.length > 0 ? {
              create: items_.map((i) => ({
                productId: i.productId, nome: i.nome, quantidade: i.quantidade,
                precoUnit: i.precoUnit, descontoItem: i.descontoItem || null,
                subtotal: Math.max(0, i.precoUnit * i.quantidade - (i.descontoItem || 0)),
              })),
            } : undefined,
          },
        })
        await prisma.kommoMapping.upsert({
          where: { entityType_kommoId: { entityType: 'negotiation', kommoId: String(l.id) } },
          create: { entityType: 'negotiation', kommoId: String(l.id), localId: neg.id, meta: { resultado: won ? 'won' : 'lost' } },
          update: { localId: neg.id },
        })
      }
      negCriadas++
    }

    if (page % 25 === 0) console.log(`  página ${page} | varridos ${varridos} | ganhos ${ganhos} | perdidos ${perdidos}`)
    if (!data?._links?.next) break
    if (LIMIT_PAGES && page >= LIMIT_PAGES) { console.log(`  (parando em ${LIMIT_PAGES} páginas por --limit-pages)`); break }
    page++
  }

  console.log('\n=== RESUMO ===')
  console.log(`leads varridos           : ${varridos}`)
  console.log(`ganhos (142)             : ${ganhos}`)
  console.log(`perdidos (143)           : ${perdidos}`)
  console.log(`desfecho ${APPLY ? 'gravado ' : 'a gravar'} no lead : ${outcomeGravados}`)
  console.log(`negociações ${APPLY ? 'criadas ' : 'a criar '}    : ${negCriadas}`)
  if (negJaExistiam) console.log(`já existiam (puladas)    : ${negJaExistiam}`)
  if (semValor) console.log(`sem valor (só desfecho)  : ${semValor}`)
  if (semLeadLocal) console.log(`sem lead local           : ${semLeadLocal}`)
  console.log(`receita ganha somada     : R$ ${somaGanho.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  if (amostra.length) { console.log('\namostra:'); amostra.forEach((s) => console.log('  ' + s)) }
  if (!APPLY) console.log('\nDRY-RUN — nada foi gravado. Rode de novo com --apply.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
