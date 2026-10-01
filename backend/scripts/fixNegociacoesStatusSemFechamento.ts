// Correção de dados (01/10/2026). Dry-run por padrão; --apply grava.
//
// Até esta data o select de Status da aba Negociação aceitava "Aceita"/"Recusada"
// sem passar pelo fechamento: a proposta ficava com o rótulo, mas sem
// resultado/fechadaEm, e a Visão Geral a contava como em negociação.
//
// 1) Fecha as que o operador marcou e cujo LEAD já tem o desfecho correspondente
//    (aceita + lead ganho → won; recusada + lead perdido → lost), com a data e o
//    autor do desfecho do lead. Vale mesmo com 2+ propostas abertas: foi o
//    operador quem apontou QUAL foi aceita. Não chama markLeadWon/Lost (o lead já
//    está fechado). Divergentes ficam listadas para a equipe.
// 2) Preenche valorUnico/valorRecorrente onde faltam e todos os itens são únicos.
import { prisma } from '../src/lib/prisma.js'
import { onNegotiationChanged } from '../src/services/commissions.js'

const APPLY = process.argv.includes('--apply')

const marcadas = await prisma.negotiation.findMany({
  where: { status: { in: ['aceita', 'recusada'] }, resultado: null },
  select: { id: true, leadId: true, titulo: true, status: true, valorFinal: true, updatedAt: true },
})
const fechar: { id: number; resultado: 'won' | 'lost'; fechadaEm: Date; fechadaPor: number | null; valor: number }[] = []
for (const n of marcadas) {
  const lead = await prisma.lead.findUnique({ where: { id: n.leadId }, select: { outcome: true, outcomeAt: true, outcomeBy: true } })
  const esperado = n.status === 'aceita' ? 'won' : 'lost'
  if (lead?.outcome === esperado) {
    fechar.push({ id: n.id, resultado: esperado, fechadaEm: lead.outcomeAt ?? n.updatedAt, fechadaPor: lead.outcomeBy ?? null, valor: Number(n.valorFinal ?? 0) })
  } else {
    console.log(`   fica para a equipe: #${n.id} "${n.titulo}" (${n.status}, lead ${n.leadId} outcome=${lead?.outcome ?? '—'})`)
  }
}
const ganho = fechar.filter((f) => f.resultado === 'won')
console.log(`[1] marcadas sem fechamento: ${marcadas.length} → fechar ${fechar.length} (${ganho.length} ganhas, R$ ${ganho.reduce((s, f) => s + f.valor, 0).toFixed(2)})`)

const semSplit = await prisma.negotiation.findMany({
  where: { valorUnico: null, valorFinal: { not: null } },
  select: { id: true, valorFinal: true, items: { select: { cobranca: true } } },
})
const soUnico = semSplit.filter((n) => n.items.every((i) => i.cobranca === 'unico'))
console.log(`[2] sem valorUnico: ${semSplit.length} → preencher ${soUnico.length}`)

if (!APPLY) { console.log('dry-run — nada gravado. Use --apply.'); process.exit(0) }

for (const f of fechar) {
  await prisma.negotiation.update({ where: { id: f.id }, data: { resultado: f.resultado, fechadaEm: f.fechadaEm, fechadaPor: f.fechadaPor } })
  await onNegotiationChanged(f.id).catch((e) => console.warn(`comissão #${f.id}:`, (e as Error).message))
}
for (const n of soUnico) {
  await prisma.negotiation.update({ where: { id: n.id }, data: { valorUnico: n.valorFinal, valorRecorrente: 0 } })
}
console.log('aplicado.')
process.exit(0)
