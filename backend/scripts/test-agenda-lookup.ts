// Consulta a agenda do aparelho conectado para alguns números reais.
// Só leitura — não grava nada.
//
//   npx tsx --env-file=.env scripts/test-agenda-lookup.ts
import { nomeNaAgenda } from '../src/services/whatsappAgendaSync.js'
import { prisma } from '../src/lib/prisma.js'

async function main() {
  const leads = await prisma.lead.findMany({
    where: { source: 'whatsapp', isGroup: false, whatsapp: { not: '' } },
    select: { id: true, nome: true, whatsapp: true, nomeOrigem: true },
    orderBy: { id: 'desc' },
    take: 12,
  })
  const inst = process.env.EVOLUTION_INSTANCE || 'beyond-main'
  console.log(`instância: ${inst}\n`)
  console.log('telefone'.padEnd(15), 'nome no CRM'.padEnd(26), 'origem'.padEnd(11), 'nome na agenda')
  let achados = 0
  for (const l of leads) {
    const n = await nomeNaAgenda(inst, l.whatsapp)
    if (n) achados++
    console.log(
      (l.whatsapp || '').padEnd(15),
      (l.nome || '').slice(0, 25).padEnd(26),
      (l.nomeOrigem || '—').padEnd(11),
      n ?? '(não salvo na agenda)',
    )
  }
  console.log(`\n${achados}/${leads.length} contatos estão salvos na agenda do aparelho`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
