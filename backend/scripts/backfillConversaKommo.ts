// scripts/backfillConversaKommo.ts
//
// Recoloca na caixa de Conversas o histórico da Kommo que foi importado sem os
// marcadores do lead.
//
//   npx tsx scripts/backfillConversaKommo.ts            # dry-run: só conta
//   npx tsx scripts/backfillConversaKommo.ts --apply
//
// Por que existe: as caixas do módulo Conversas não olham `Message` — filtram o
// LEAD por `lastMessageAt`, `conversationOpenedAt` e `conversationClosedAt`.
// Com os três em NULL a conversa não cai em caixa nenhuma, nem na aba "Todos",
// e a lista aparece vazia com as mensagens gravadas. O importarTalk() passou a
// gravar esses campos, mas a varredura de 25/08 começou às 13:57 e o serviço só
// ganhou o trecho às 14:34 — o processo já rodando ficou com a versão antiga em
// memória, e as conversas daquela janela entraram mudas.
//
// Não custa nenhuma requisição à Kommo: a data sai do MAX(timestamp) das
// mensagens já gravadas. Idempotente, e as mesmas duas travas do importarTalk:
// nunca puxa `lastMessageAt` para trás, e só fecha quem não tem atendimento
// vivo no bychat.

import { prisma } from '../src/lib/prisma.js'

const apply = process.argv.includes('--apply')

const porLead = await prisma.message.groupBy({
  by: ['leadId'],
  where: { provider: 'kommo' },
  _max: { timestamp: true },
  _count: { _all: true },
})

console.log(`[backfill] ${porLead.length} leads com mensagem da Kommo${apply ? '' : '  — DRY-RUN, nada será gravado'}`)

let tocouLastMessage = 0, fechou = 0, jaOk = 0, semLead = 0, comAtendimentoVivo = 0

for (const g of porLead) {
  if (!g.leadId) { semLead++; continue }
  const fim = g._max.timestamp
  if (!fim) continue

  const lead = await prisma.lead.findUnique({
    where: { id: g.leadId },
    select: { lastMessageAt: true, conversationOpenedAt: true, conversationClosedAt: true },
  })
  if (!lead) { semLead++; continue }

  const data: Record<string, unknown> = {}
  if (!lead.lastMessageAt || lead.lastMessageAt < fim) data.lastMessageAt = fim
  if (!lead.conversationOpenedAt && !lead.conversationClosedAt) data.conversationClosedAt = fim
  else if (lead.conversationOpenedAt && !lead.conversationClosedAt) comAtendimentoVivo++

  if (!Object.keys(data).length) { jaOk++; continue }
  if (data.lastMessageAt) tocouLastMessage++
  if (data.conversationClosedAt) fechou++
  if (apply) await prisma.lead.update({ where: { id: g.leadId }, data })
}

console.log(`\n[backfill] ${apply ? 'RESULTADO' : 'DIAGNÓSTICO (dry-run)'}`)
console.log(`  lastMessageAt ajustado ........ ${tocouLastMessage}`)
console.log(`  marcadas como resolvidas ...... ${fechou}`)
console.log(`  já estavam certas ............. ${jaOk}`)
console.log(`  atendimento aberto no bychat .. ${comAtendimentoVivo}  (preservado, não foi fechado)`)
console.log(`  lead ausente .................. ${semLead}`)

await prisma.$disconnect()
