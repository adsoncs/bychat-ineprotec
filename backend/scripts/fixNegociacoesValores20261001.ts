// Correção pontual de 01/10/2026 (ineprotec). Dry-run por padrão; --apply grava.
//
// 1) Propostas sem valorUnico/valorRecorrente (importKommoClosedDeals de 19/08
//    gravava só valorFinal): todos os itens são `unico` → único = total.
// 2) Propostas com status 'aceita' mas sem resultado, cujo lead JÁ está ganho e
//    que são a única proposta aberta dele: fecha como ganha, com a data/autor do
//    desfecho do lead. Não chama markLeadWon (o lead já está ganho).
import { prisma } from '../src/lib/prisma.js'
import { onNegotiationChanged } from '../src/services/commissions.js'

const APPLY = process.argv.includes('--apply')

const semSplit = await prisma.negotiation.findMany({
  where: { valorUnico: null, valorFinal: { not: null } },
  select: { id: true, valorFinal: true, items: { select: { cobranca: true } } },
})
const comRecorrente = semSplit.filter((n) => n.items.some((i) => i.cobranca !== 'unico'))
console.log(`[1] sem valorUnico: ${semSplit.length} (com item recorrente, pulados: ${comRecorrente.length})`)

const aceitas = await prisma.negotiation.findMany({
  where: { status: 'aceita', resultado: null },
  select: { id: true, leadId: true, titulo: true, valorFinal: true, updatedAt: true },
})
const alvo2: { id: number; fechadaEm: Date; fechadaPor: number | null }[] = []
for (const n of aceitas) {
  const lead = await prisma.lead.findUnique({ where: { id: n.leadId }, select: { outcome: true, outcomeAt: true, outcomeBy: true } })
  const abertas = await prisma.negotiation.count({ where: { leadId: n.leadId, resultado: null } })
  if (lead?.outcome === 'won' && abertas === 1) alvo2.push({ id: n.id, fechadaEm: lead.outcomeAt ?? n.updatedAt, fechadaPor: lead.outcomeBy ?? null })
  else console.log(`   fica para a equipe: #${n.id} "${n.titulo}" (lead ${n.leadId}, outcome=${lead?.outcome ?? '—'}, abertas=${abertas})`)
}
const soma2 = aceitas.filter((n) => alvo2.some((a) => a.id === n.id)).reduce((s, n) => s + Number(n.valorFinal ?? 0), 0)
console.log(`[2] aceitas sem resultado: ${aceitas.length} → fechar como ganha: ${alvo2.length} (R$ ${soma2.toFixed(2)})`)

if (!APPLY) { console.log('dry-run — nada gravado. Use --apply.'); process.exit(0) }

for (const n of semSplit) {
  if (comRecorrente.includes(n)) continue
  await prisma.negotiation.update({ where: { id: n.id }, data: { valorUnico: n.valorFinal, valorRecorrente: 0 } })
}
for (const a of alvo2) {
  await prisma.negotiation.update({ where: { id: a.id }, data: { resultado: 'won', fechadaEm: a.fechadaEm, fechadaPor: a.fechadaPor } })
  await onNegotiationChanged(a.id).catch((e) => console.warn(`comissão #${a.id}:`, (e as Error).message))
}
console.log('aplicado.')
process.exit(0)
