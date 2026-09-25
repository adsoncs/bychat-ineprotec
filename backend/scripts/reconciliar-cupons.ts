// scripts/reconciliar-cupons.ts
//
// Compara o contador `usageCount` de cada cupom com os resgates realmente
// registrados em `CouponRedemption`.
//
// Por que importa: `usageCount` é o que decide se um cupom ainda tem estoque
// (`usageCount + reservados >= usageLimit` → "esgotado"). Um contador inflado
// tira do ar uma campanha que ninguém usou; um contador atrasado deixa passar
// mais desconto do que se pretendia. Na demo havia 113, 49 e 280 usos contra
// **zero** resgates — números de vitrine que o checkout leva a sério.
//
//   npx tsx scripts/reconciliar-cupons.ts            (só relata)
//   npx tsx scripts/reconciliar-cupons.ts --aplicar  (corrige)

import { prisma } from '../src/lib/prisma.js'

const aplicar = process.argv.includes('--aplicar')

const cupons = await prisma.coupon.findMany({
  select: { id: true, code: true, usageCount: true, usageLimit: true, active: true },
  orderBy: { id: 'asc' },
})

console.log(`\n═══ CUPONS: CONTADOR × RESGATES ═══\n`)

let divergentes = 0
for (const c of cupons) {
  const reais = await prisma.couponRedemption.count({ where: { couponId: c.id } })
  const diverge = c.usageCount !== reais
  if (diverge) divergentes++

  const estoque = c.usageLimit ? `${c.usageCount}/${c.usageLimit}` : `${c.usageCount}/∞`
  const marca = diverge ? '  ⚠' : '   '
  console.log(`${marca} ${c.code.padEnd(12)} contador ${estoque.padEnd(10)} resgates reais: ${reais}`)

  if (diverge && c.usageLimit && c.usageCount >= c.usageLimit && reais < c.usageLimit) {
    console.log(`      └─ ESGOTADO no papel, com ${c.usageLimit - reais} uso(s) reais disponíveis.`)
  }

  if (diverge && aplicar) {
    await prisma.coupon.update({ where: { id: c.id }, data: { usageCount: reais } })
  }
}

console.log(`\n${cupons.length} cupom(ns) · ${divergentes} divergente(s)`)
if (divergentes > 0) {
  console.log(aplicar
    ? 'Contadores alinhados aos resgates.'
    : 'Nada foi gravado. Rode com --aplicar para alinhar.')
}

await prisma.$disconnect()
