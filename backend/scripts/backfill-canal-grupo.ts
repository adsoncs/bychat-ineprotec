// Define o número TITULAR dos grupos que nasceram antes dessa regra.
//
// Grupo é conversa que o WhatsApp entrega a TODAS as linhas da casa que estão
// nele. Enquanto o canal saía da última mensagem recebida, o rótulo alternava
// entre as linhas irmãs — no kobogo, dois grupos "Acesso Remoto" (um por linha)
// apareciam ambos sob o mesmo número. Agora o grupo pertence a um número, em
// `Lead.instanceName` (ver src/services/whatsappGroups.ts).
//
// O critério aqui é conservador de propósito: titular = a linha que MAIS
// recebeu mensagem do grupo, que é justamente a que a tela já vinha mostrando.
// Assim o backfill não muda o que ninguém pediu para mudar — ele só congela o
// que estava oscilando. Quem quiser outro número troca na conversa, no painel
// Informações, que é onde a decisão é de quem conhece o grupo.
//
//   npx tsx --env-file=.env scripts/backfill-canal-grupo.ts [--apply]

import { prisma } from '../src/lib/prisma.js'

const APLICAR = process.argv.includes('--apply')

async function main() {
  const grupos = await prisma.lead.findMany({
    where: { isGroup: true, instanceName: null },
    select: { id: true, nome: true },
  })
  if (!grupos.length) {
    console.log('  nenhum grupo sem número titular — nada a fazer')
    return
  }

  console.log(`  grupos sem número titular: ${grupos.length}\n`)
  let definidos = 0
  let semDados = 0

  for (const g of grupos) {
    // Só RECEBIDAS: o que a equipe enviou pode ter saído por qualquer linha
    // (inclusive por escolha manual do superadmin) e não diz de quem é o grupo.
    const porLinha = await prisma.message.groupBy({
      by: ['evolutionInstance'],
      where: { leadId: g.id, provider: 'evolution', evolutionInstance: { not: null }, fromMe: false, isInternal: false },
      _count: { _all: true },
    })
    if (!porLinha.length) { semDados++; continue }

    const ordenado = [...porLinha].sort((a, b) => b._count._all - a._count._all)
    const titular = ordenado[0]!.evolutionInstance as string
    const viva = await prisma.whatsAppInstance.findFirst({
      where: { instanceName: titular, active: true },
      select: { id: true },
    })
    if (!viva) { semDados++; continue }

    const disputa = ordenado.length > 1
      ? `  (disputado: ${ordenado.map((o) => `${o.evolutionInstance}=${o._count._all}`).join(', ')})`
      : ''
    console.log(`  #${g.id} ${g.nome} → ${titular}${disputa}`)
    if (APLICAR) {
      await prisma.lead.update({ where: { id: g.id }, data: { instanceName: titular } })
    }
    definidos++
  }

  console.log(`\n  ${definidos} grupo(s) com titular; ${semDados} sem mensagem recebida por linha ativa (ficam como estão)`)
  if (!APLICAR) console.log('  (dry-run — use --apply)')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
