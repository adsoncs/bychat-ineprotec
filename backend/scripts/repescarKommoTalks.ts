// scripts/repescarKommoTalks.ts
//
// Segunda passada da importação de conversas: pega tudo que a varredura NÃO
// trouxe e diz, por motivo, o que sobrou de fora.
//
//   npx tsx scripts/repescarKommoTalks.ts              # só diagnostica
//   npx tsx scripts/repescarKommoTalks.ts --apply      # tenta importar de novo
//
// Existe porque "importou 9 mil conversas" não é a mesma pergunta que "sobrou
// alguma?". A varredura conta puladas num número só, misturando id que não
// existe na Kommo (esperado) com conversa real que não achou lead (perda). Aqui
// os dois se separam, e a perda vira uma lista com nome e telefone — não um
// percentual.

import { importarTalk, descobrirTopoDeTalks } from '../src/services/kommoTalks.js'
import { getKommoChatsConfig, kommoFetch } from '../src/lib/kommoClient.js'
import { prisma } from '../src/lib/prisma.js'

const apply = process.argv.includes('--apply')
const cfg = await getKommoChatsConfig()
const topo = await descobrirTopoDeTalks(cfg)

const jaTem = new Set(
  (await prisma.kommoMapping.findMany({ where: { entityType: 'talk' }, select: { kommoId: true } }))
    .map((m) => Number(m.kommoId)),
)
const faltando = Array.from({ length: topo }, (_, i) => i + 1).filter((id) => !jaTem.has(id))
console.log(`[repesca] topo=${topo} · importados=${jaTem.size} · a verificar=${faltando.length}`)

let inexistentes = 0, recuperados = 0, semLead = 0, semMensagem = 0, erros = 0
const perdidas: Array<{ talkId: number; contactId: number | null; origin: string; msgs: number }> = []

for (const id of faltando) {
  try {
    if (apply) {
      const r = await importarTalk(id, { cfg })
      if (!r.pulou) { recuperados++; continue }
      if (r.pulou === 'sem-talk') { inexistentes++; continue }
      if (r.pulou === 'sem-mensagens') { semMensagem++; continue }
    }
    // Ou é dry-run, ou o import pulou por falta de lead: descobre o que era.
    const t = await kommoFetch(`/talks/${id}`, cfg).catch(() => null)
    if (!t?.talk_id) { inexistentes++; continue }
    const d = await kommoFetch(`/talks/${id}/messages?limit=1`, cfg).catch(() => null)
    const n = d?._embedded?.messages?.length ?? 0
    if (!n) { semMensagem++; continue }
    semLead++
    perdidas.push({ talkId: id, contactId: t.contact_id ?? null, origin: t.origin, msgs: n })
  } catch {
    erros++
  }
}

console.log(`\n[repesca] ${apply ? 'RESULTADO' : 'DIAGNÓSTICO (dry-run)'}`)
console.log(`  id inexistente na Kommo ....... ${inexistentes}  (esperado — a numeração tem buracos)`)
console.log(`  conversa sem mensagem ......... ${semMensagem}`)
console.log(`  recuperadas agora ............. ${recuperados}`)
console.log(`  AINDA sem destino ............. ${semLead}`)
console.log(`  erros ......................... ${erros}`)

if (perdidas.length) {
  console.log('\n[repesca] conversas com mensagem que não acharam lead:')
  for (const p of perdidas.slice(0, 40)) {
    console.log(`  talk ${p.talkId} · contato ${p.contactId ?? '—'} · ${p.origin}`)
  }
  if (perdidas.length > 40) console.log(`  … e mais ${perdidas.length - 40}`)
}
await prisma.$disconnect()
