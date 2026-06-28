// Backfill de Lead.phoneKey + relatório de grupos duplicados por telefone canônico.
import { prisma } from '../src/lib/prisma.js'
import { phoneKey } from '../src/lib/phone.js'

async function main() {
  const leads = await prisma.lead.findMany({ select: { id: true, whatsapp: true, phoneKey: true } })
  let updated = 0
  for (const l of leads) {
    const pk = phoneKey(l.whatsapp)
    if (pk !== l.phoneKey) { await prisma.lead.update({ where: { id: l.id }, data: { phoneKey: pk } }); updated++ }
  }
  console.log(`[backfill] phoneKey atualizado em ${updated}/${leads.length} leads`)

  const groups = await prisma.lead.groupBy({
    by: ['phoneKey'],
    where: { phoneKey: { not: null } },
    _count: { _all: true },
  })
  const dups = groups.filter(g => g._count._all > 1)
  console.log(`[dups] ${dups.length} grupo(s) com telefone duplicado`)
  for (const g of dups) {
    const ls = await prisma.lead.findMany({
      where: { phoneKey: g.phoneKey },
      select: { id: true, nome: true, whatsapp: true, waLid: true, source: true, createdAt: true,
                _count: { select: { messages: true } } },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`  ${g.phoneKey}: ` + ls.map(l => `#${l.id}[${l.nome}|${l.whatsapp}|msgs:${l._count.messages}|${l.source}]`).join('  '))
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
