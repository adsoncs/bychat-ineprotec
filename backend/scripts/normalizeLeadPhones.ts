// Backfill: grava Lead.whatsapp no formato canônico (55 + DDD + 9 + 8) e
// recalcula phoneKey. Corrige o passivo deixado pelos canais que entregavam o
// número sem DDI — sobretudo o Lead Ads da Meta ("18988059971") —, cujo disparo
// automático era recusado pela Evolution (`exists:false`) e pela Meta (131009).
//
// Da criação em diante o middleware de lib/prisma.ts já normaliza na escrita;
// este script existe para os leads gravados ANTES da correção.
//
// Uso:
//   npx tsx scripts/normalizeLeadPhones.ts            → simulação (não grava)
//   npx tsx scripts/normalizeLeadPhones.ts --apply    → grava
import { prisma } from '../src/lib/prisma.js'
import { phoneKey, toWaNumber } from '../src/lib/phone.js'

const APPLY = process.argv.includes('--apply')

async function main() {
  const leads = await prisma.lead.findMany({
    select: { id: true, nome: true, whatsapp: true, phoneKey: true, source: true },
    orderBy: { id: 'asc' },
  })

  const changed: Array<{ id: number; from: string; to: string }> = []
  const invalid: Array<{ id: number; nome: string; whatsapp: string; source: string | null }> = []

  for (const l of leads) {
    const raw = l.whatsapp || ''
    if (!raw) continue
    // JID completo (@lid/@g.us) é identificador de sessão, não telefone: intacto.
    if (raw.includes('@')) continue

    const canonical = toWaNumber(raw)
    if (!canonical) {
      invalid.push({ id: l.id, nome: l.nome, whatsapp: raw, source: l.source })
      continue
    }
    if (canonical !== raw) changed.push({ id: l.id, from: raw, to: canonical })
  }

  console.log(`\n=== Normalização de telefone — ${leads.length} leads ===`)
  console.log(`${changed.length} a normalizar | ${invalid.length} não discáveis | modo: ${APPLY ? 'GRAVANDO' : 'simulação'}\n`)

  for (const c of changed) console.log(`  #${c.id}  ${c.from}  ->  ${c.to}`)

  if (invalid.length) {
    console.log(`\n--- Não discáveis (exigem correção manual do cadastro) ---`)
    for (const i of invalid) {
      console.log(`  #${i.id}  "${i.whatsapp}"  ${i.nome} (${i.source ?? 'sem origem'})`)
    }
  }

  if (APPLY) {
    for (const c of changed) {
      // O middleware recalcula phoneKey a partir do whatsapp gravado.
      await prisma.lead.update({ where: { id: c.id }, data: { whatsapp: c.to } })
    }
    // phoneKey pode estar defasado mesmo onde o whatsapp já era canônico
    // (regras novas: DDD com zero à esquerda, DDI duplicado, número colado).
    let keysFixed = 0
    for (const l of leads) {
      const pk = phoneKey(changed.find(c => c.id === l.id)?.to ?? l.whatsapp)
      if (pk !== l.phoneKey) {
        await prisma.lead.update({ where: { id: l.id }, data: { phoneKey: pk } })
        keysFixed++
      }
    }
    console.log(`\n[ok] ${changed.length} telefones normalizados; ${keysFixed} phoneKey recalculados`)
  } else {
    console.log(`\n[simulação] nada foi gravado — rode com --apply para aplicar`)
  }

  // Duplicatas que a canonização torna visíveis (mesmo contato em 2 cadastros).
  const groups = await prisma.lead.groupBy({
    by: ['phoneKey'],
    where: { phoneKey: { not: null } },
    _count: { _all: true },
  })
  const dups = groups.filter(g => g._count._all > 1)
  console.log(`\n[dups] ${dups.length} grupo(s) com o mesmo telefone canônico`)
  for (const g of dups) {
    const ls = await prisma.lead.findMany({
      where: { phoneKey: g.phoneKey },
      select: { id: true, nome: true, source: true, _count: { select: { messages: true } } },
      orderBy: { createdAt: 'asc' },
    })
    console.log(`  ${g.phoneKey}: ` + ls.map(l => `#${l.id}[${l.nome}|msgs:${l._count.messages}|${l.source}]`).join('  '))
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
