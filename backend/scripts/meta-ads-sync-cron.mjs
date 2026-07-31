// Cron de sincronização do Meta Ads (CampaignCost ← Marketing API).
// Roda via crontab do sistema, chamando o endpoint /sync-meta em localhost
// (127.0.0.1) — NÃO passa por nginx/Cloudflare, então não sofre o corte de
// timeout (o sync histórico leva minutos). Mantém os custos atualizados sem
// depender do clique manual no painel.
//
// Uso:   node scripts/meta-ads-sync-cron.mjs
// Teste: node scripts/meta-ads-sync-cron.mjs --dry   (não dispara o sync)
import fs from 'fs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import http from 'http'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const getEnv = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '')
const secret = getEnv('JWT_SECRET')
const port = parseInt(getEnv('PORT') || '3005', 10)
if (!secret) { console.error(new Date().toISOString(), 'meta-sync ABORT: JWT_SECRET ausente'); process.exit(1) }

// Token de serviço (SUPERADMIN). adminOnly valida o role do token; jti aleatório.
const token = jwt.sign({ userId: 1, email: 'cron@system', name: 'meta-sync-cron', role: 'SUPERADMIN', jti: crypto.randomUUID() }, secret, { expiresIn: '30m' })

if (process.argv.includes('--dry')) {
  console.log('dry-run OK · port', port, '· token', token.slice(0, 20) + '…')
  process.exit(0)
}

const t0 = Date.now()
const req = http.request(
  { host: '127.0.0.1', port, path: '/api/admin/meta-ads-report/sync-meta', method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } },
  (res) => {
    let b = ''
    res.on('data', (d) => (b += d))
    res.on('end', () => console.log(new Date().toISOString(), 'meta-sync', res.statusCode, `${Math.round((Date.now() - t0) / 1000)}s`, b.slice(0, 300)))
  },
)
// trava de segurança: aborta se passar de 20 min (não deve)
req.setTimeout(20 * 60 * 1000, () => { console.error(new Date().toISOString(), 'meta-sync TIMEOUT 20min, abortando'); req.destroy() })
req.on('error', (e) => console.error(new Date().toISOString(), 'meta-sync ERR', e.message))
req.end('{}')
