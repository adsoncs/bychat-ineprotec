// Grava o NÚMERO DONO (instanceName / cloudApiConnectionId) em todo lead que já
// conversou e ainda não tem dono — o número que a conversa já usa hoje
// (whatsappProvider → canalDaConversa: última recebida, senão a última).
//
// Por que existe: com a regra "uma conversa por número" (22/09/2026), lead sem
// dono é "livre" e seria ADOTADO pelo primeiro número que o contato usasse — o
// webhook do outro número juntaria as conversas de novo. Gravar o dono congela
// cada conversa no número em que ela está.
//
//   npx tsx --env-file=.env scripts/backfill-dono-da-conversa.ts          (só conta)
//   npx tsx --env-file=.env scripts/backfill-dono-da-conversa.ts --aplicar
import { prisma } from '../src/lib/prisma.js'
import { canalDaConversa } from '../src/services/whatsappProvider.js'
import { adotarNoCanal } from '../src/services/contactIdentity.js'

const aplicar = process.argv.includes('--aplicar')
const leads = await prisma.$queryRaw<{ id: number }[]>`
  SELECT DISTINCT l.id FROM bychat_leads l
  JOIN bychat_messages m ON m.leadId = l.id AND m.isInternal = 0
  WHERE l.instanceName IS NULL AND l.cloudApiConnectionId IS NULL AND l.groupJid IS NULL`
console.log(`candidatos: ${leads.length}`)
const porCanal = new Map<string, number>()
let semCanal = 0
for (const { id } of leads) {
  const c = await canalDaConversa(Number(id))
  if (!c) { semCanal++; continue }
  porCanal.set(c.channelId, (porCanal.get(c.channelId) ?? 0) + 1)
  if (aplicar) await adotarNoCanal(Number(id), c.cloudApiConnectionId ? { cloudApiConnectionId: c.cloudApiConnectionId } : { instanceName: c.instanceName })
}
console.log(`${aplicar ? 'APLICADO' : 'SIMULAÇÃO'} — leads sem dono com conversa: ${leads.length}`)
for (const [k, v] of porCanal) console.log(`  ${k}: ${v}`)
console.log(`  sem canal cadastrado (ficam livres): ${semCanal}`)
await prisma.$disconnect()
// Imports do provider abrem Redis/agendadores: sem isto o processo não termina.
process.exit(0)
