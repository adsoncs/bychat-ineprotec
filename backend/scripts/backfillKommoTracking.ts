// Copia o tracking importado da Kommo para as colunas nativas do Lead.
//
// Os UTMs e o gclid sempre vieram no import, mas apenas como custom field opaco
// (`customFields.kommo_1110434`). Toda a atribuição do bychat — relatórios de
// origem, enriquecimento por gclid, conversões do Google Ads, export de leads —
// lê as COLUNAS (`Lead.utmSource`, `Lead.gclid`), então o dado existia e não
// aparecia em lugar nenhum. O importador já foi corrigido; isto reconstrói o
// passivo.
//
// NÃO consulta a Kommo: os valores já estão no banco. O de-para sai do
// KommoMapping('custom_field'), pelo `code` padronizado da Kommo (UTM_SOURCE,
// GCLID…), nunca pelo id — `kommo_1110434` só existe nesta conta.
//
// Só preenche coluna VAZIA. Um lead já atribuído pelo tracking nativo do bychat
// não é sobrescrito por dado antigo do CRM.
//
// Uso: npx tsx scripts/backfillKommoTracking.ts [--apply]
import { prisma } from '../src/lib/prisma.js'

const APPLY = process.argv.includes('--apply')

/** code da Kommo → coluna do Lead + limite da coluna. */
const BY_CODE: Record<string, { field: string; max: number }> = {
  UTM_SOURCE:   { field: 'utmSource',   max: 100 },
  UTM_MEDIUM:   { field: 'utmMedium',   max: 100 },
  UTM_CAMPAIGN: { field: 'utmCampaign', max: 191 },
  UTM_CONTENT:  { field: 'utmContent',  max: 191 },
  UTM_TERM:     { field: 'utmTerm',     max: 191 },
  GCLID:        { field: 'gclid',       max: 191 },
  FBCLID:       { field: 'fbclid',      max: 255 },
}

/** Placeholder de ValueTrack que o Google não substituiu ("{campaignname}").
 * Contamos para relatar — o valor é gravado como está, porque é o que o CRM tem. */
const isPlaceholder = (s: string) => /\{[a-z_]+\}/i.test(s)

async function main() {
  console.log(`modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (use --apply)'}`)

  // key local (kommo_<id>) → coluna do Lead
  const cfRows = await prisma.kommoMapping.findMany({ where: { entityType: 'custom_field' }, select: { meta: true } })
  const keyToField = new Map<string, { field: string; max: number }>()
  for (const r of cfRows) {
    const m = r.meta as any
    const target = m?.code ? BY_CODE[String(m.code).toUpperCase()] : null
    if (target && m?.key) keyToField.set(m.key, target)
  }
  console.log(`campos de tracking mapeados: ${keyToField.size}`)
  for (const [k, v] of keyToField) console.log(`  ${k} → Lead.${v.field}`)
  if (keyToField.size === 0) throw new Error('Nenhum campo de tracking mapeado — rode o sync de metadados antes')

  const contagem: Record<string, number> = {}
  let varridos = 0, atualizados = 0, placeholders = 0, originTypeSet = 0
  const amostra: string[] = []
  const PAGE = 500
  let cursor = 0

  for (;;) {
    const leads = await prisma.lead.findMany({
      where: { id: { gt: cursor }, customFields: { not: null as any } },
      select: {
        id: true, customFields: true, originType: true,
        utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true, gclid: true, fbclid: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
    })
    if (leads.length === 0) break
    cursor = leads[leads.length - 1].id

    for (const lead of leads) {
      varridos++
      const cf = (lead.customFields as any) || {}
      const patch: Record<string, string> = {}
      for (const [key, target] of keyToField) {
        const raw = cf[key]
        if (raw === null || raw === undefined || raw === '') continue
        const value = String(Array.isArray(raw) ? raw[0] : raw).trim().substring(0, target.max)
        if (!value) continue
        if (isPlaceholder(value)) placeholders++
        if ((lead as any)[target.field]) continue // coluna já preenchida — não toca
        patch[target.field] = value
        contagem[target.field] = (contagem[target.field] ?? 0) + 1
      }
      if (Object.keys(patch).length === 0) continue

      // gclid presente é sinal forte de Google Ads — preenche a origem se vazia.
      if (patch.gclid && !lead.originType) { patch.originType = 'google_ads'; originTypeSet++ }

      if (amostra.length < 5) {
        amostra.push(`lead ${lead.id}: ${Object.entries(patch).map(([k, v]) => `${k}=${String(v).substring(0, 30)}`).join(' · ')}`)
      }
      if (APPLY) await prisma.lead.update({ where: { id: lead.id }, data: patch as any })
      atualizados++
    }
    if (varridos % 5000 === 0) console.log(`  ${varridos} varridos | ${atualizados} ${APPLY ? 'atualizados' : 'a atualizar'}`)
  }

  console.log('\n=== RESUMO ===')
  console.log(`leads varridos            : ${varridos}`)
  console.log(`leads ${APPLY ? 'atualizados' : 'a atualizar'}     : ${atualizados}`)
  console.log(`originType=google_ads     : ${originTypeSet}`)
  console.log('preenchimento por coluna  :')
  for (const [f, n] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(12)}: ${n}`)
  if (placeholders) console.log(`\nATENÇÃO: ${placeholders} valores são placeholders de ValueTrack não substituídos (ex: "{campaignname}") — dado ruim na origem, gravado como está.`)
  if (amostra.length) { console.log('\namostra:'); amostra.forEach((s) => console.log('  ' + s)) }
  if (!APPLY) console.log('\nDRY-RUN — nada foi gravado. Rode de novo com --apply.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
