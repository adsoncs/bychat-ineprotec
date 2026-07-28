// Preenche o "Curso de Interesse" (e derivados) dos leads já importados da Kommo.
//
// Os campos `Curso de Interesse 1/2/3` são do tipo `chained_list`: a Kommo não
// devolve um `value`, e sim `{catalog_id, catalog_element_id}` — uma referência
// ao catálogo de Produtos. O `extractCfValue` antigo filtrava por `v.value` e
// descartava tudo, então NENHUM dos 38k leads tinha curso (0 preenchidos, contra
// ~83% na Kommo). O código já foi corrigido; isto reconstrói o passivo.
//
// Duas fases:
//   A) catálogos → `importCatalogs` popula o dicionário catalog_element
//   B) leads     → varre /leads e regrava SÓ as chaves de curso em
//                  `Lead.customFields`, mesclando (não sobrescreve o resto) e
//                  sem tocar em etapa, dono, telefone ou qualquer outro campo.
//
// Uso: npx tsx scripts/backfillKommoCursos.ts [--apply] [--skip-catalogs]
import { prisma } from '../src/lib/prisma.js'
import { getKommoConfig, kommoFetch } from '../src/lib/kommoClient.js'
import { importCatalogs, ensureKommoAuxFields } from '../src/services/kommoSync.js'

const APPLY = process.argv.includes('--apply')
const SKIP_CATALOGS = process.argv.includes('--skip-catalogs')

/** Chaves que este script pode escrever — tudo fora daqui fica intocado. */
const DERIVED = ['kommo_curso_valor', 'kommo_curso_escola', 'kommo_curso_grupo'] as const

async function main() {
  const cfg = await getKommoConfig(true)
  if (!cfg.subdomain || !cfg.token) throw new Error('Kommo não configurado')
  console.log(`Conta: ${cfg.subdomain} | modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --apply)'}`)

  // ── FASE A — catálogos + campos derivados ──
  // Os CustomFields derivados são criados SEMPRE (mesmo em dry-run e com
  // --skip-catalogs): sem eles os valores gravados não aparecem na aba "Campos".
  await ensureKommoAuxFields()
  if (!SKIP_CATALOGS) {
    console.log('\n=== FASE A — catálogos ===')
    const r = await importCatalogs(cfg)
    console.log(`catálogos: ${r.catalogs} | elementos: ${r.elements}`)
  }

  const catalogRows = await prisma.kommoMapping.findMany({ where: { entityType: 'catalog_element' }, select: { kommoId: true, meta: true } })
  const catalog = new Map(catalogRows.map((r) => [r.kommoId, r.meta as any]))
  console.log(`dicionário de catálogo: ${catalog.size} elementos`)
  if (catalog.size === 0) throw new Error('Nenhum elemento de catálogo — rode sem --skip-catalogs')

  // custom fields do tipo chained_list: field_id → key local (kommo_<id>)
  const cfRows = await prisma.kommoMapping.findMany({ where: { entityType: 'custom_field' }, select: { kommoId: true, meta: true } })
  const cfKeyById = new Map(cfRows.map((r) => [r.kommoId, (r.meta as any)?.key as string | undefined]))

  const leadRows = await prisma.kommoMapping.findMany({ where: { entityType: 'lead' }, select: { kommoId: true, localId: true } })
  const leadIdByKommo = new Map(leadRows.map((r) => [r.kommoId, r.localId]))
  console.log(`leads mapeados: ${leadIdByKommo.size}`)

  // ── FASE B — leads ──
  console.log('\n=== FASE B — leads ===')
  let page = 1, varridos = 0, comCurso = 0, atualizados = 0, semMapping = 0
  const amostra: string[] = []

  for (;;) {
    const data = await kommoFetch(`/leads?limit=250&page=${page}`, cfg)
    const items: any[] = data?._embedded?.leads ?? []
    if (items.length === 0) break

    for (const l of items) {
      varridos++
      // pares {nome do campo, id do elemento} — o de menor nome é o curso principal
      const refs: Array<{ name: string; id: number; fieldId: string }> = []
      const cursos: Record<string, any> = {}
      for (const fv of l.custom_fields_values ?? []) {
        const ids = (fv?.values ?? []).map((v: any) => v?.catalog_element_id).filter((x: any) => x != null)
        if (ids.length === 0) continue
        const key = cfKeyById.get(String(fv.field_id))
        const nomes = ids.map((id: number) => catalog.get(String(id))?.name ?? `#${id}`)
        if (key) cursos[key] = nomes.length === 1 ? nomes[0] : nomes
        refs.push({ name: String(fv.field_name || ''), id: Number(ids[0]), fieldId: String(fv.field_id) })
      }
      if (refs.length === 0) continue
      comCurso++

      refs.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      const el = catalog.get(String(refs[0].id))
      if (el?.price != null) cursos['kommo_curso_valor'] = el.price
      if (el?.escola) cursos['kommo_curso_escola'] = el.escola
      if (el?.group) cursos['kommo_curso_grupo'] = el.group

      const localId = leadIdByKommo.get(String(l.id))
      if (!localId) { semMapping++; continue }

      const cur = await prisma.lead.findUnique({ where: { id: localId }, select: { customFields: true } })
      if (!cur) { semMapping++; continue }
      const atual = (cur.customFields as any) || {}
      // só grava se alguma chave de curso mudou de fato
      const mudou = Object.entries(cursos).some(([k, v]) => JSON.stringify(atual[k]) !== JSON.stringify(v))
      if (!mudou) continue

      if (amostra.length < 5) {
        amostra.push(`lead ${localId} (kommo ${l.id}): ${JSON.stringify(cursos)}`)
      }
      if (APPLY) {
        await prisma.lead.update({ where: { id: localId }, data: { customFields: { ...atual, ...cursos } as any } })
      }
      atualizados++
    }

    if (page % 10 === 0 || !data?._links?.next) {
      console.log(`  página ${page} | varridos ${varridos} | com curso ${comCurso} | a atualizar ${atualizados}`)
    }
    if (!data?._links?.next) break
    page++
  }

  console.log('\n=== RESUMO ===')
  console.log(`leads varridos na Kommo : ${varridos}`)
  console.log(`com curso preenchido    : ${comCurso} (${varridos ? ((100 * comCurso) / varridos).toFixed(1) : 0}%)`)
  console.log(`leads ${APPLY ? 'atualizados' : 'a atualizar'}   : ${atualizados}`)
  if (semMapping) console.log(`sem lead local (ignorados): ${semMapping}`)
  if (amostra.length) { console.log('\namostra:'); amostra.forEach((s) => console.log('  ' + s)) }
  if (!APPLY) console.log('\nDRY-RUN — nada foi gravado. Rode de novo com --apply.')
  console.log(`\ncampos derivados escritos: ${DERIVED.join(', ')}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
