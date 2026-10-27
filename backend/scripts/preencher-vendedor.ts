// scripts/preencher-vendedor.ts
//
// Leads ganhos ANTES de existir Lead.vendedorUserId (migration 0196) ficam sem
// vendedor. Este script preenche com quem fechou, nesta ordem:
//   1. responsável da proposta ganha mais recente (é o que a comissão já usa);
//   2. vendedor gravado na inscrição (EnrollmentRegistration.vendedorUserId);
//   3. quem marcou o Ganho (Lead.outcomeBy);
//   4. o responsável atual.
// Sem `--gravar` só LISTA o que faria — destacando onde o vendedor encontrado é
// diferente do responsável atual (são os casos em que a venda "tinha sumido").
// Depois de gravar, rode o Recalcular das comissões (comissão paga não muda).
//
// Uso:
//   cd backend && npx tsx --env-file=.env scripts/preencher-vendedor.ts            # confere
//   cd backend && npx tsx --env-file=.env scripts/preencher-vendedor.ts --gravar   # grava

import { prisma } from '../src/lib/prisma.js'

const GRAVAR = process.argv.includes('--gravar')

async function main() {
  const leads = await prisma.lead.findMany({
    where: { outcome: 'won', vendedorUserId: null },
    select: { id: true, nome: true, assignedUserId: true, outcomeBy: true, outcomeAt: true },
    orderBy: { id: 'asc' },
  })
  const nomes = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const nome = (id: number | null) => (id == null ? '—' : nomes.get(id) ?? `#${id}`)

  let gravados = 0
  const diferentes: string[] = []
  const porFonte: Record<string, number> = { proposta: 0, inscricao: 0, marcouGanho: 0, responsavel: 0, nenhum: 0 }
  for (const l of leads) {
    const prop = await prisma.negotiation.findFirst({
      where: { leadId: l.id, resultado: 'won', responsavelUserId: { not: null } },
      orderBy: { fechadaEm: 'desc' },
      select: { responsavelUserId: true },
    })
    const insc = prop ? null : await prisma.enrollmentRegistration.findFirst({
      where: { leadId: l.id, vendedorUserId: { not: null }, mergedIntoId: null },
      orderBy: { id: 'desc' },
      select: { vendedorUserId: true },
    })
    let fonte = 'nenhum'
    let vendedor: number | null = null
    if (prop?.responsavelUserId) { vendedor = prop.responsavelUserId; fonte = 'proposta' }
    else if (insc?.vendedorUserId) { vendedor = insc.vendedorUserId; fonte = 'inscricao' }
    else if (l.outcomeBy) { vendedor = l.outcomeBy; fonte = 'marcouGanho' }
    else if (l.assignedUserId) { vendedor = l.assignedUserId; fonte = 'responsavel' }
    porFonte[fonte]!++
    if (vendedor == null) continue
    if (vendedor !== l.assignedUserId) {
      diferentes.push(`  lead ${l.id} (${l.nome || 'sem nome'}): vendedor ${nome(vendedor)} [${fonte}] · responsável hoje ${nome(l.assignedUserId)}`)
    }
    if (GRAVAR) {
      await prisma.$executeRawUnsafe(
        'UPDATE bychat_leads SET vendedorUserId = ?, vendedorEm = COALESCE(outcomeAt, NOW(3)) WHERE id = ? AND vendedorUserId IS NULL',
        vendedor, l.id,
      )
      gravados++
    }
  }
  console.log(`Leads ganhos sem vendedor: ${leads.length}`)
  console.log(`Fonte usada: ${JSON.stringify(porFonte)}`)
  console.log(`Vendedor diferente do responsável atual: ${diferentes.length}`)
  for (const d of diferentes) console.log(d)
  console.log(GRAVAR ? `Gravados: ${gravados}` : '(só conferência — rode com --gravar para gravar)')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect().then(() => process.exit()))
