// Funde as fichas em dobro do MESMO contato na MESMA linha de WhatsApp.
//
// A duplicata é uma corrida, não um problema de identidade: duas mensagens que
// chegam quase juntas passam as duas pela busca do resolvedor (nenhuma acha) e
// as duas criam. Medido no kobogo: 8 dos 10 pares nasceram com 57 a 491
// MILISSEGUNDOS de diferença, na mesma instância.
//
// O critério é `(phoneKey, instanceName)` — o mesmo do índice único que passa a
// impedir o caso daqui para a frente. Fica DE FORA, de propósito, quem tem
// `instanceName` nulo: são as importações em massa (CRM Educacional, Kommo), em
// que a mesma pessoa aparece legitimamente em várias inscrições. No unialfa são
// 31.837 registros assim — fundi-los apagaria histórico de matrícula.
//
// Quem fica: a ficha com MAIS mensagens (menos coisa para mover); empate, a
// mais antiga. O resto é absorvido por `mergeLeads`, que já move mensagens,
// eventos, atividades e etiquetas, resolve o nome pela hierarquia de origem e
// preserva o waLid — sem ele, a próxima mensagem criaria a duplicata de novo.
//
// Uso:
//   npx tsx --env-file=.env scripts/fundir-contatos-duplicados.ts          (relatório)
//   npx tsx --env-file=.env scripts/fundir-contatos-duplicados.ts --aplicar

import { prisma } from '../src/lib/prisma.js'
import { mergeLeads } from '../src/services/dedup.js'

const APLICAR = process.argv.includes('--aplicar')

interface Grupo {
  phoneKey: string
  instanceName: string
  ids: number[]
}

async function gruposDuplicados(): Promise<Grupo[]> {
  const linhas = await prisma.$queryRaw<Array<{ phoneKey: string; instanceName: string; ids: string }>>`
    SELECT phoneKey, instanceName, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM bychat_leads
    WHERE phoneKey IS NOT NULL AND phoneKey <> ''
      AND instanceName IS NOT NULL
    GROUP BY phoneKey, instanceName
    HAVING COUNT(*) > 1
  `
  return linhas.map((l) => ({
    phoneKey: l.phoneKey,
    instanceName: l.instanceName,
    ids: String(l.ids).split(',').map((n) => parseInt(n)).filter(Number.isFinite),
  }))
}

async function main() {
  const grupos = await gruposDuplicados()
  if (!grupos.length) {
    console.log('Nenhuma ficha em dobro na mesma linha. Nada a fazer.')
    return
  }

  console.log(`${grupos.length} contato(s) com ficha em dobro na mesma linha:\n`)
  let fundidos = 0
  let falhas = 0

  for (const g of grupos) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: g.ids } },
      select: {
        id: true, nome: true, createdAt: true, qualifiedAt: true,
        _count: { select: { messages: true } },
      },
      orderBy: { id: 'asc' },
    })

    // Mais mensagens vence; empate, o mais antigo.
    const ordenados = [...leads].sort((a, b) => (b._count.messages - a._count.messages) || (a.id - b.id))
    const fica = ordenados[0]!
    const absorvidos = ordenados.slice(1)

    console.log(`  ${g.instanceName} · ${g.phoneKey}`)
    console.log(`    fica    #${fica.id} "${fica.nome}" (${fica._count.messages} msgs${fica.qualifiedAt ? ', é Lead' : ''})`)
    for (const a of absorvidos) {
      console.log(`    absorve #${a.id} "${a.nome}" (${a._count.messages} msgs${a.qualifiedAt ? ', é Lead' : ''})`)
    }

    if (!APLICAR) continue

    for (const a of absorvidos) {
      try {
        await mergeLeads({ keepId: fica.id, mergeId: a.id, operatorName: 'Fusão automática (fichas em dobro)' })
        fundidos++
      } catch (e: any) {
        console.log(`    ✗ falhou ao absorver #${a.id}: ${e.message}`)
        falhas++
      }
    }
  }

  console.log('')
  if (!APLICAR) {
    console.log('Relatório apenas. Rode com --aplicar para fundir.')
  } else {
    console.log(`Fundidas: ${fundidos}${falhas ? ` · falhas: ${falhas}` : ''}`)
    const resto = await gruposDuplicados()
    console.log(resto.length ? `⚠ ainda restam ${resto.length} grupo(s)` : '✓ nenhuma ficha em dobro restante')
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
