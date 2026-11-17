// Cron de sincronização do Google Ads (GoogleAdsCampaignCost ← Google Ads API).
// Espelho do meta-ads-sync-cron.mjs, mas chama o serviço direto (sem HTTP):
// cada conta ativa (Integrações › Google Ads) relê os últimos 30 dias até ONTEM,
// e reescrever o mesmo dia substitui — correções retroativas entram sozinhas.
//
// Uso:       npx tsx scripts/google-ads-sync-cron.ts
// Histórico: npx tsx scripts/google-ads-sync-cron.ts --desde 2026-01-01   (em blocos de 90 dias)
import { prisma } from '../src/lib/prisma.js'
import { syncGoogleAdsInsights } from '../src/services/googleAdsInsightsSync.js'

const i = process.argv.indexOf('--desde')
const desde = i > 0 ? process.argv[i + 1] : null
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const ontem = new Date(Date.parse(hoje + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)

function blocos(de: string, ate: string, dias = 90): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let ini = Date.parse(de + 'T12:00:00Z')
  const fim = Date.parse(ate + 'T12:00:00Z')
  while (ini <= fim) {
    const f = Math.min(fim, ini + (dias - 1) * 86400000)
    out.push([new Date(ini).toISOString().slice(0, 10), new Date(f).toISOString().slice(0, 10)])
    ini = f + 86400000
  }
  return out
}

const t0 = Date.now()
const configs = await prisma.googleAdsConfig.findMany({ where: { active: true }, select: { connectionId: true, customerId: true } })
if (!configs.length) { console.log(new Date().toISOString(), 'google-sync: nenhuma conta Google Ads ativa'); process.exit(0) }
let falhas = 0
for (const c of configs) {
  const janelas: Array<[string | undefined, string | undefined]> = desde ? blocos(desde, ontem) : [[undefined, undefined]]
  for (const [de, ate] of janelas) {
    try {
      const r = await syncGoogleAdsInsights(c.connectionId, c.customerId, de, ate)
      const erros = r.results.flatMap((x) => x.errors.map((e) => `${x.level}: ${e}`))
      if (erros.length) falhas++
      console.log(new Date().toISOString(), 'google-sync', c.customerId, `${r.dateRange.from}..${r.dateRange.to}`, r.results.map((x) => `${x.level}=${x.rowsUpserted}`).join(' '), erros.length ? 'ERROS ' + erros.slice(0, 3).join(' | ') : 'ok')
    } catch (e: any) {
      falhas++
      console.error(new Date().toISOString(), 'google-sync', c.customerId, 'FALHOU', e?.message || e)
    }
  }
}
console.log(new Date().toISOString(), `google-sync fim ${Math.round((Date.now() - t0) / 1000)}s, contas=${configs.length}, falhas=${falhas}`)
process.exit(falhas ? 1 : 0)
