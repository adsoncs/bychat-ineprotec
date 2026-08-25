// scripts/importKommoTalks.ts
//
// Varre o histórico de conversas da Kommo e grava em `Message`.
//
//   npx tsx scripts/importKommoTalks.ts                 # dry-run: só mede
//   npx tsx scripts/importKommoTalks.ts --apply         # importa tudo
//   npx tsx scripts/importKommoTalks.ts --apply --de=1 --ate=500
//   npx tsx scripts/importKommoTalks.ts --apply --sem-midia
//
// Idempotente: repetir não duplica (a chave é o uuid da mensagem na Kommo), e
// uma varredura interrompida pode ser repetida inteira sem limpar nada.
//
// Roda em paralelo com a sync incremental de leads, que usa a MESMA conta da
// Kommo. As duas somadas passam do teto de ~7 req/s, então 429 acontece — o
// backoff do kommoFetch absorve. Se for preciso apertar o passo, rode fora da
// janela do cron de 15 minutos.

import { importarTalk, descobrirTopoDeTalks } from '../src/services/kommoTalks.js'
import { getKommoChatsConfig } from '../src/lib/kommoClient.js'
import { prisma } from '../src/lib/prisma.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const semMidia = args.includes('--sem-midia')
const num = (flag: string) => {
  const a = args.find((x) => x.startsWith(`--${flag}=`))
  return a ? parseInt(a.split('=')[1]!, 10) : undefined
}

const cfg = await getKommoChatsConfig()
const de = num('de') ?? 1
const ate = num('ate') ?? (await descobrirTopoDeTalks(cfg))

console.log(`[kommo-talks] faixa ${de}..${ate}${semMidia ? ' (sem mídia)' : ''}${apply ? '' : '  — DRY-RUN, nada será gravado'}`)
if (!apply) {
  console.log('[kommo-talks] rode com --apply para importar.')
  await prisma.$disconnect()
  process.exit(0)
}

const t0 = Date.now()
let lidos = 0, pulados = 0, novas = 0, midias = 0, erros = 0

for (let id = de; id <= ate; id++) {
  try {
    const r = await importarTalk(id, { baixarMidia: !semMidia, cfg })
    if (r.pulou) pulados++
    else { lidos++; novas += r.novas; midias += r.midiasBaixadas }
  } catch (e: any) {
    erros++
    if (erros <= 10) console.error(`[kommo-talks] talk ${id}: ${e?.message || e}`)
  }
  if (id % 100 === 0 || id === ate) {
    const min = ((Date.now() - t0) / 60000).toFixed(1)
    const pct = (((id - de + 1) / (ate - de + 1)) * 100).toFixed(1)
    console.log(`[kommo-talks] ${id}/${ate} (${pct}%) · ${lidos} conversas · ${novas} mensagens · ${midias} mídias · ${pulados} puladas · ${erros} erros · ${min} min`)
  }
}

const totalMsgs = await prisma.message.count({ where: { provider: 'kommo' } })
const totalConversas = await prisma.message.findMany({
  where: { provider: 'kommo' },
  distinct: ['leadId'],
  select: { leadId: true },
})
console.log(`[kommo-talks] FIM em ${((Date.now() - t0) / 60000).toFixed(1)} min`)
console.log(`[kommo-talks] no banco: ${totalMsgs} mensagens em ${totalConversas.length} conversas`)
await prisma.$disconnect()
