// scripts/mover-mat-para-ine.ts
//
// Passa para o "INE - FUNIL DE VENDAS" (funil 4) os leads que caíram no
// "MAT - FUNIL DE VENDAS" (funil 1) entre 04 e 11/09/2026.
//
// Os dois funis têm a MESMA escada de etapas, com chaves diferentes (`kommo_1027…`
// no MAT, `kommo_1036…` no INE). Mover só o `funnelId` deixaria o lead numa etapa
// que o funil de destino não conhece: ele some do Kanban, porque nenhuma coluna
// responde por aquela chave. Então cada lead é movido de PAR — funil e etapa
// juntos, pela etapa de mesma posição.
//
// Usa `moveLeadStage` (services/leadStageMove.ts), a mesma do painel: grava o
// movimento em LeadStageMovement (é o que alimenta o Relatório de Funil), registra
// na timeline do lead e invalida sugestões vencidas da Jornada IA. Um UPDATE cru
// mudaria o número sem deixar rastro de quem mudou, quando, e de onde veio.
//
// Conferido antes de rodar: o ineprotec não tem nenhum workflow ativo, então o
// evento `lead.stage_changed` não dispara mensagem para ninguém.
//
//   npx tsx scripts/mover-mat-para-ine.ts            (só relata)
//   npx tsx scripts/mover-mat-para-ine.ts --aplicar  (move)

import { prisma } from '../src/lib/prisma.js'
import { moveLeadStage } from '../src/services/leadStageMove.js'

const aplicar = process.argv.includes('--aplicar')

const DE = 1   // MAT - FUNIL DE VENDAS
const PARA = 4 // INE - FUNIL DE VENDAS

// A janela é em horário de Brasília (UTC-3): 04/09 00:00 até 11/09 23:59.
const INICIO = new Date('2026-09-04T03:00:00.000Z')
const FIM = new Date('2026-09-12T02:59:59.999Z')

const [funilDe, funilPara] = await Promise.all([
  prisma.funnel.findUnique({ where: { id: DE }, select: { name: true } }),
  prisma.funnel.findUnique({ where: { id: PARA }, select: { name: true } }),
])

// Etapa de destino = a de MESMA POSIÇÃO no funil novo. As chaves diferem entre
// os dois funis, mas a escada é a mesma; a posição é o que diz "este degrau".
const [etapasDe, etapasPara] = await Promise.all([
  prisma.stage.findMany({ where: { funnelId: DE }, select: { key: true, name: true, position: true } }),
  prisma.stage.findMany({ where: { funnelId: PARA }, select: { key: true, name: true, position: true } }),
])
const destinoDaPosicao = new Map(etapasPara.map((e) => [e.position, e]))
const etapaDe = new Map(etapasDe.map((e) => [e.key, e]))

const leads = await prisma.lead.findMany({
  where: { funnelId: DE, createdAt: { gte: INICIO, lte: FIM } },
  select: {
    id: true, uid: true, nome: true, whatsapp: true, status: true,
    source: true, createdAt: true, outcome: true,
  },
  orderBy: { createdAt: 'asc' },
})

console.log(`\n═══ "${funilDe?.name}" → "${funilPara?.name}" ═══`)
console.log(`janela: 04/09 a 11/09/2026 (horário de Brasília)\n`)

const brt = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

let movidos = 0, semDestino = 0
for (const l of leads) {
  const origem = l.status ? etapaDe.get(l.status) : undefined
  const destino = origem ? destinoDaPosicao.get(origem.position) : undefined

  if (!destino) {
    console.log(`  ⚠ #${l.id} ${l.uid} "${l.nome}" — etapa "${l.status}" não tem equivalente no destino. NÃO movido.`)
    semDestino++
    continue
  }

  const alerta = l.outcome ? `  ⚠ desfecho "${l.outcome}"` : ''
  console.log(`  #${l.id} ${l.uid} · ${brt(l.createdAt)} · "${l.nome}" (${l.whatsapp || 'sem telefone'})`)
  console.log(`      ${origem!.name} → ${destino.name}${alerta}`)
  movidos++

  if (aplicar) {
    await moveLeadStage({
      leadId: l.id,
      toFunnelId: PARA,
      toStageKey: destino.key,
      source: 'manual',
      reason: 'Correção de funil: entrada no MAT que pertence ao INE',
    })
  }
}

console.log(`\n${'─'.repeat(58)}`)
console.log(`  leads na janela ............. ${leads.length}`)
console.log(`  a mover ..................... ${movidos}`)
console.log(`  sem etapa equivalente ....... ${semDestino}`)
console.log(aplicar ? '\nMovidos.\n' : '\nNada foi alterado. Rode com --aplicar.\n')

await prisma.$disconnect()
