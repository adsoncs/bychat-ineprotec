// Preenche Lead.instanceName nos leads criados antes da regra "um lead por
// telefone POR INSTÂNCIA", usando a instância das mensagens daquele lead.
//
// Lead que só conversou por uma instância recebe o nome dela. Lead com mensagens
// de MAIS DE UMA fica de fora e é listado: separá-lo significa criar um lead
// novo e mover mensagens, o que muda histórico e precisa de decisão humana.
//
//   npx tsx --env-file=.env scripts/backfill-lead-instancia.ts [--apply]

import { prisma } from '../src/lib/prisma.js'

const APLICAR = process.argv.includes('--apply')

async function main() {
  const linhas = await prisma.$queryRawUnsafe<any[]>(`
    SELECT m.leadId AS leadId,
           COUNT(DISTINCT m.evolutionInstance) AS instancias,
           MIN(m.evolutionInstance) AS unica
      FROM bychat_messages m
      JOIN bychat_leads l ON l.id = m.leadId
     WHERE m.evolutionInstance IS NOT NULL AND l.instanceName IS NULL
     GROUP BY m.leadId
  `)

  const simples = linhas.filter((l) => Number(l.instancias) === 1)
  const misturados = linhas.filter((l) => Number(l.instancias) > 1)

  console.log(`  leads sem instância definida: ${linhas.length}`)
  console.log(`    com uma só instância (dá para preencher): ${simples.length}`)
  console.log(`    com mais de uma (precisam de separação):  ${misturados.length}`)

  if (APLICAR) {
    let n = 0
    for (const l of simples) {
      await prisma.lead.update({ where: { id: Number(l.leadId) }, data: { instanceName: String(l.unica) } })
      n++
    }
    console.log(`\n  APLICADO: ${n} leads receberam a instância`)
  } else {
    console.log('\n  (dry-run — use --apply)')
  }

  if (misturados.length) {
    console.log('\n  MISTURADOS (conversas de empresas diferentes no mesmo lead):')
    for (const l of misturados.slice(0, 20)) {
      const lead = await prisma.lead.findUnique({ where: { id: Number(l.leadId) }, select: { nome: true, whatsapp: true } })
      const insts = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT evolutionInstance i FROM bychat_messages WHERE leadId = ${Number(l.leadId)} AND evolutionInstance IS NOT NULL`,
      )
      console.log(`    lead ${l.leadId} · ${lead?.nome ?? '?'} · ${lead?.whatsapp ?? '?'} · ${insts.map((x) => x.i).join(' + ')}`)
    }
    if (misturados.length > 20) console.log(`    … e mais ${misturados.length - 20}`)
    console.log('\n  Esses não foram tocados: separar cria lead novo e move mensagens.')
  }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
