// scripts/kommoTalksCiclo.ts
//
// Roda UM ciclo do espelho de conversas da Kommo, à mão.
//
//   npx tsx scripts/kommoTalksCiclo.ts                # desde o cursor guardado
//   npx tsx scripts/kommoTalksCiclo.ts --horas=3      # força olhar 3h para trás
//
// Serve para conferir o mecanismo sem esperar o ciclo do servidor, e para
// recuperar à mão uma janela específica (deploy demorado, hook desativado sem
// aviso). O ciclo é idempotente: repetir não duplica mensagem.

import { prisma } from '../src/lib/prisma.js'
import { cicloTalksLive } from '../src/services/kommoTalksLive.js'

const arg = process.argv.find((a) => a.startsWith('--horas='))
const horas = arg ? parseFloat(arg.split('=')[1]!) : null

if (horas && horas > 0) {
  const desde = Math.floor(Date.now() / 1000) - Math.round(horas * 3600)
  await prisma.setting.upsert({
    where: { key: 'kommo.talks_live_cursor' },
    create: {
      key: 'kommo.talks_live_cursor',
      value: desde,
      label: 'Kommo — último evento de conversa processado',
      grp: 'kommo',
      fieldType: 'number',
    },
    update: { value: desde },
  })
  console.log(`[ciclo] cursor recuado para ${new Date(desde * 1000).toLocaleString('pt-BR')}`)
}

const t0 = Date.now()
const r = await cicloTalksLive()
console.log(`[ciclo] ${r.conversas} conversa(s) com movimento · ${r.importadas} com mensagem nova · ${r.pendentes} esperando lead · ${((Date.now() - t0) / 1000).toFixed(1)}s`)

await prisma.$disconnect()
