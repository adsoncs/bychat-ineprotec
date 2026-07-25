// Recupera os telefones que a sincronização do Kommo truncou.
//
// `kommoSync.ts` gravava o contato com `phoneDigits()` — os ÚLTIMOS 8 DÍGITOS,
// função de comparação do dedup — então DDI e DDD se perderam em toda a base
// importada (38.026 de 38.273 leads aqui). O código já foi corrigido; isto
// reconstrói o passivo a partir do Kommo, que mantém o número íntegro.
//
// Duas fases, porque re-sincronizar leads NÃO basta: o ramo de UPDATE de
// `importLeadsPage` não toca em `whatsapp` (só o de criação grava), então o
// telefone dos leads já existentes nunca seria atualizado.
//
//   A) contatos → `importContactsPage` regrava meta.phone completo no mapping
//   B) leads    → varre /leads?with=contacts e propaga o telefone do contato
//                 principal para `Lead.whatsapp`, SEM tocar em status, dono,
//                 etapa ou campos personalizados.
//
// Uso: npx tsx scripts/recoverKommoPhones.ts [--apply] [--skip-contacts]
import { prisma } from '../src/lib/prisma.js'
import { getKommoConfig, kommoFetch } from '../src/lib/kommoClient.js'
import { importContactsPage } from '../src/services/kommoSync.js'
import { toWaNumber, displayPhone } from '../src/lib/phone.js'

const APPLY = process.argv.includes('--apply')
const SKIP_CONTACTS = process.argv.includes('--skip-contacts')

async function faseContatos(cfg: any) {
  console.log('\n=== FASE A — contatos ===')
  let page = 1, total = 0
  for (;;) {
    const r = await importContactsPage(page, undefined, cfg)
    total += r.processed
    if (page % 10 === 0 || !r.hasNext) console.log(`  página ${page} — ${total} contatos`)
    if (!r.hasNext) break
    page++
  }
  const [{ n }]: any = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) n FROM bychat_kommo_mappings WHERE entityType='contact'
       AND LENGTH(JSON_UNQUOTE(JSON_EXTRACT(meta,'$.phone'))) BETWEEN 1 AND 10`)
  console.log(`  ${total} contatos processados; ainda truncados: ${Number(n)}`)
}

async function faseLeads(cfg: any) {
  console.log(`\n=== FASE B — propagar para os leads (${APPLY ? 'GRAVANDO' : 'simulação'}) ===`)

  // mapping kommoLeadId → leadId local
  const mapRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT kommoId, localId FROM bychat_kommo_mappings WHERE entityType='lead'`)
  const leadMap = new Map<string, number>(mapRows.map(r => [String(r.kommoId), Number(r.localId)]))

  // mapping kommoContactId → telefone já corrigido
  const cRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT kommoId, JSON_UNQUOTE(JSON_EXTRACT(meta,'$.phone')) phone
       FROM bychat_kommo_mappings WHERE entityType='contact'`)
  const contatoTel = new Map<string, string>(cRows.map(r => [String(r.kommoId), String(r.phone || '')]))
  console.log(`  ${leadMap.size} leads mapeados, ${contatoTel.size} contatos em cache`)

  let page = 1, vistos = 0, atualizados = 0, semTelefone = 0, jaOk = 0
  for (;;) {
    const data = await kommoFetch(`/leads?limit=250&with=contacts&page=${page}`, cfg)
    const items: any[] = data?._embedded?.leads ?? []
    for (const l of items) {
      vistos++
      const localId = leadMap.get(String(l.id))
      if (!localId) continue

      const emb: any[] = l?._embedded?.contacts ?? []
      const main = emb.find(x => x.is_main) ?? emb[0]
      const tel = main ? contatoTel.get(String(main.id)) : ''
      const novo = tel ? toWaNumber(tel) : null
      if (!novo) { semTelefone++; continue }

      const atual = await prisma.lead.findUnique({ where: { id: localId }, select: { whatsapp: true } })
      if (!atual) continue
      if (displayPhone(atual.whatsapp) === novo) { jaOk++; continue }

      if (APPLY) {
        // Só o telefone. Status, etapa, dono e campos personalizados ficam intactos.
        await prisma.lead.update({ where: { id: localId }, data: { whatsapp: novo } })
      }
      atualizados++
      if (atualizados <= 5) console.log(`    #${localId}: "${atual.whatsapp}" -> ${novo}`)
    }
    if (page % 10 === 0) console.log(`  página ${page} — ${vistos} leads vistos, ${atualizados} a corrigir`)
    if (!data?._links?.next) break
    page++
  }
  console.log(`\n  vistos ${vistos} | corrigidos ${atualizados} | já corretos ${jaOk} | sem telefone no Kommo ${semTelefone}`)
}

async function main() {
  const cfg = await getKommoConfig(true)
  if (!SKIP_CONTACTS) await faseContatos(cfg)
  await faseLeads(cfg)

  const [{ n }]: any = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) n FROM bychat_leads WHERE whatsapp <> '' AND LENGTH(whatsapp) <= 10`)
  console.log(`\nleads ainda com telefone curto: ${Number(n)}`)
  await prisma.$disconnect()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
