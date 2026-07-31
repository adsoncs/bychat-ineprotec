// Cron de saúde dos tokens Meta. Chama /token-health?notify=1 em localhost —
// se algum token estiver inválido, expirado ou a janela de acesso a dados
// estiver perto de fechar, dispara alerta (WhatsApp + e-mail) reusando os
// destinos de Configurações › Empresa › Notificações. Assim o relatório nunca
// mais fica defasado em silêncio por dias.
//
// Uso:   node scripts/meta-token-health-cron.mjs
import fs from 'fs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import http from 'http'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const getEnv = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '')
const secret = getEnv('JWT_SECRET')
const port = parseInt(getEnv('PORT') || '3005', 10)
if (!secret) { console.error(new Date().toISOString(), 'token-health ABORT: JWT_SECRET ausente'); process.exit(1) }

const token = jwt.sign({ userId: 1, email: 'cron@system', name: 'meta-token-health', role: 'SUPERADMIN', jti: crypto.randomUUID() }, secret, { expiresIn: '10m' })

const t0 = Date.now()
const req = http.request(
  { host: '127.0.0.1', port, path: '/api/admin/meta-ads-report/token-health?notify=1', method: 'GET', headers: { Authorization: 'Bearer ' + token } },
  (res) => {
    let b = ''
    res.on('data', (d) => (b += d))
    res.on('end', () => console.log(new Date().toISOString(), 'token-health', res.statusCode, `${Math.round((Date.now() - t0) / 1000)}s`, b.slice(0, 400)))
  },
)
req.setTimeout(5 * 60 * 1000, () => { console.error(new Date().toISOString(), 'token-health TIMEOUT 5min, abortando'); req.destroy() })
req.on('error', (e) => console.error(new Date().toISOString(), 'token-health ERR', e.message))
req.end()
