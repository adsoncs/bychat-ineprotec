// Carga histórica da timeline da Kommo → LeadEvent + LeadStageMovement.
//
// A conta guarda ~768 mil eventos desde a origem (abr/2026). Importamos o
// conjunto curado (ver KOMMO_EVENT_MAP em kommoSync): criação, mudança de
// etapa, troca de responsável, tags, valor da venda e mensagens de chat —
// ~298 mil. Ficam de fora `entity_linked`, `name_field_changed` e
// `custom_field_value_changed` (~395 mil), ruído estrutural que encheria a
// timeline sem contar nada ao operador.
//
// A mudança de etapa também vira LeadStageMovement, que é o que alimenta os
// relatórios de tempo por etapa e conversão entre etapas — até agora vazios
// para os leads importados.
//
// Retomável: a marca d'água (`kommo.events_synced_until`) avança a cada página,
// então uma execução interrompida continua de onde parou em vez de duplicar.
// O sync incremental do worker usa a mesma marca.
//
// Uso: npx tsx scripts/importKommoTimeline.ts [--apply] [--max-pages=N]
import { prisma } from '../src/lib/prisma.js'
import { getKommoConfig } from '../src/lib/kommoClient.js'
import {
  importEventsPage, getEventsWatermark, setEventsWatermark,
  getBackfillOldest, setBackfillOldest, KOMMO_EVENT_TYPES,
} from '../src/services/kommoSync.js'

const APPLY = process.argv.includes('--apply')
const MAX_PAGES = (() => {
  const a = process.argv.find((x) => x.startsWith('--max-pages='))
  return a ? parseInt(a.split('=')[1], 10) : 0
})()

async function main() {
  const cfg = await getKommoConfig(true)
  if (!cfg.subdomain || !cfg.token) throw new Error('Kommo não configurado')
  console.log(`Conta: ${cfg.subdomain} | modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (só a 1ª página, use --apply)'}`)
  console.log(`tipos importados: ${KOMMO_EVENT_TYPES.join(', ')}`)

  const antes = await prisma.leadEvent.count()
  const antesMov = await prisma.leadStageMovement.count()
  const marca = await getEventsWatermark()
  console.log(`LeadEvent atual: ${antes} | LeadStageMovement atual: ${antesMov}`)
  console.log(`marca d'água: ${marca ? new Date(marca * 1000).toISOString() : '(nenhuma — carga completa)'}`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada será gravado. Rode com --apply para a carga completa.')
    return
  }

  const t0 = Date.now()
  let page = 1, totalEventos = 0, totalMov = 0, paginas = 0, maiorTs = marca ?? 0
  // Retomada: continua de onde a execução anterior parou, pedindo só o que é
  // mais antigo que o ponto já alcançado. Sem isso, uma execução interrompida
  // recomeçaria da página 1 e duplicaria tudo.
  let until = await getBackfillOldest()
  if (until) console.log(`retomando: importando eventos anteriores a ${new Date(until * 1000).toISOString()}`)

  for (;;) {
    const r = await importEventsPage(page, undefined, cfg, until ? until - 1 : undefined)
    paginas++
    totalEventos += r.created
    totalMov += r.movements
    if (r.newestAt > maiorTs) maiorTs = r.newestAt
    if (r.oldestAt > 0) await setBackfillOldest(r.oldestAt)

    if (page % 25 === 0 || !r.hasNext) {
      const min = ((Date.now() - t0) / 60000).toFixed(1)
      const ate = r.oldestAt ? new Date(r.oldestAt * 1000).toISOString().slice(0, 16) : '—'
      console.log(`  página ${page} | ${totalEventos} eventos | ${totalMov} movimentações | até ${ate} | ${min} min`)
    }
    if (!r.hasNext) break
    if (MAX_PAGES && paginas >= MAX_PAGES) { console.log(`  (parando em ${MAX_PAGES} páginas por --max-pages)`); break }
    page++

    // A cada 200 páginas reancora o filtro no ponto já alcançado e volta à
    // página 1: paginação profunda na Kommo fica lenta e frágil.
    if (page > 200) {
      until = await getBackfillOldest()
      page = 1
    }
  }

  // A marca d'água guarda o evento mais NOVO visto: a Kommo pagina do mais
  // recente para o mais antigo, então o topo é a página 1.
  if (maiorTs > 0) await setEventsWatermark(maiorTs)

  const depois = await prisma.leadEvent.count()
  const depoisMov = await prisma.leadStageMovement.count()
  console.log('\n=== RESUMO ===')
  console.log(`páginas varridas       : ${paginas}`)
  console.log(`eventos criados        : ${totalEventos}`)
  console.log(`movimentações de etapa : ${totalMov}`)
  console.log(`LeadEvent          : ${antes} → ${depois}`)
  console.log(`LeadStageMovement  : ${antesMov} → ${depoisMov}`)
  console.log(`marca d'água       : ${maiorTs ? new Date(maiorTs * 1000).toISOString() : '—'}`)
  console.log(`tempo              : ${((Date.now() - t0) / 60000).toFixed(1)} min`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
