// Provisiona a integração Meta de um tenant JÁ COM O SYSTEM USER TOKEN,
// sem passar pelo "Conectar Meta" do painel.
//
// Por que existe: o fluxo OAuth do painel grava um token de USUÁRIO pessoal
// (que expira / é invalidado por troca de senha) e SOBRESCREVE o System User
// token permanente. Este script grava direto no banco o token permanente e,
// em seguida, sincroniza todos os formulários nativos (Lead Ads) da página.
//
// Pré-requisito no Business Manager: a PÁGINA precisa estar atribuída ao
// System User (Usuários do sistema > ByChat Integração > Atribuir ativos >
// Páginas > Controle total). Sem isso o Graph devolve erro #10.
//
// Uso (dentro de <tenant>/backend):
//   node scripts/meta-seed-system-user.mjs --page <pageId> [--accounts act_1,act_2] [--dry]
//
// O System User token é lido, nesta ordem:
//   1. --token <valor>
//   2. env META_SYSTEM_USER_TOKEN
//   3. arquivo /etc/bychat/meta-system-user.token (0600, fora dos repos)
import fs from 'fs'
import http from 'http'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'

const GRAPH = 'https://graph.facebook.com/v21.0'

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const getEnv = (k) => (env.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '')

const arg = (name) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY = process.argv.includes('--dry')

const pageId = arg('page')
if (!pageId) {
  console.error('ABORT: informe --page <pageId>')
  process.exit(1)
}
const accounts = (arg('accounts') || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.startsWith('act_'))

const TOKEN_FILE = '/etc/bychat/meta-system-user.token'
const suToken =
  arg('token') ||
  process.env.META_SYSTEM_USER_TOKEN ||
  (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : '')
if (!suToken) {
  console.error(`ABORT: System User token ausente (--token, META_SYSTEM_USER_TOKEN ou ${TOKEN_FILE})`)
  process.exit(1)
}

const appId = getEnv('META_APP_ID')
const appSecret = getEnv('META_APP_SECRET')
if (!appId || !appSecret) {
  console.error('ABORT: META_APP_ID/META_APP_SECRET ausentes no .env')
  process.exit(1)
}

const graph = async (path, params = {}) => {
  const qs = new URLSearchParams({ ...params, access_token: suToken })
  const r = await fetch(`${GRAPH}${path}?${qs}`)
  const j = await r.json()
  if (j.error) throw new Error(`Graph ${path}: ${j.error.message} (code ${j.error.code})`)
  return j
}

// 1. Confirma que o token é mesmo de System User e não expira.
const dbg = await (
  await fetch(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(suToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
  )
).json()
const info = dbg.data || {}
if (!info.is_valid) throw new Error(`token inválido: ${JSON.stringify(info.error || dbg)}`)
if (info.type !== 'SYSTEM_USER') throw new Error(`token não é SYSTEM_USER (type=${info.type}) — abortando para não plantar token que expira`)
if (info.expires_at !== 0 || info.data_access_expires_at !== 0)
  throw new Error(`token de System User com expiração (expires_at=${info.expires_at}, data_access=${info.data_access_expires_at})`)
console.log(`token OK: SYSTEM_USER ${info.user_id}, nunca expira`)

// 2. Deriva o PAGE token permanente a partir do System User.
let page
try {
  page = await graph(`/${pageId}`, { fields: 'access_token,name' })
} catch (e) {
  console.error(`ABORT: não consegui derivar o page token de ${pageId}.`)
  console.error(`  ${e.message}`)
  console.error(`  Provável causa: a página não está atribuída ao System User ${info.user_id}.`)
  console.error(`  No Business Manager: Usuários do sistema > ByChat Integração > Atribuir ativos > Páginas > Controle total.`)
  process.exit(1)
}
if (!page.access_token) {
  console.error(`ABORT: página ${pageId} não devolveu access_token — atribua a página ao System User no Business Manager`)
  process.exit(1)
}
console.log(`página: ${page.name} (${pageId}) — page token derivado`)

const metadata = {
  tokenType: 'system_user_permanent',
  systemUserId: String(info.user_id),
  seededAt: new Date().toISOString(),
  ...(accounts.length ? { adAccountIds: accounts } : {}),
}

if (DRY) {
  console.log('dry-run — nada gravado. metadata seria:', JSON.stringify(metadata))
  process.exit(0)
}

// 3. Grava a integração (upsert por pageId, que é UNIQUE).
const dbUrl = new URL(getEnv('DATABASE_URL'))
const conn = await mysql.createConnection({
  host: dbUrl.hostname,
  port: Number(dbUrl.port || 3306),
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password),
  database: dbUrl.pathname.slice(1),
})

// webhookSecret só é gerado na criação; manter o existente evita quebrar
// webhooks já cadastrados na Meta para esta página.
const webhookSecret = crypto.randomBytes(16).toString('hex')
await conn.execute(
  `INSERT INTO bychat_meta_integrations
     (pageId, pageName, pageAccessToken, userAccessToken, appId, webhookSecret, active, metadata, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, 1, ?, NOW(3), NOW(3))
   ON DUPLICATE KEY UPDATE
     pageName=VALUES(pageName),
     pageAccessToken=VALUES(pageAccessToken),
     userAccessToken=VALUES(userAccessToken),
     appId=VALUES(appId),
     active=1,
     metadata=JSON_MERGE_PATCH(IFNULL(metadata,'{}'), VALUES(metadata)),
     updatedAt=NOW(3)`,
  [pageId, page.name || pageId, page.access_token, suToken, appId, webhookSecret, JSON.stringify(metadata)],
)
const [[row]] = await conn.query('SELECT id FROM bychat_meta_integrations WHERE pageId = ?', [pageId])
await conn.end()
console.log(`integração gravada: id=${row.id}${accounts.length ? ` · contas ${accounts.join(', ')}` : ' · SEM adAccountIds (relatório de anúncios ficará vazio)'}`)

// 4. Sincroniza os formulários nativos reusando o endpoint do painel
//    (mantém o auto-mapeamento de campos idêntico ao do botão da tela).
const jwtSecret = getEnv('JWT_SECRET')
const port = parseInt(getEnv('PORT') || '3005', 10)
const authToken = jwt.sign(
  { userId: 1, email: 'cron@system', name: 'meta-seed', role: 'SUPERADMIN', jti: crypto.randomUUID() },
  jwtSecret,
  { expiresIn: '15m' },
)

const body = await new Promise((resolve, reject) => {
  const req = http.request(
    {
      host: '127.0.0.1',
      port,
      path: `/api/meta/integrations/${row.id}/sync-forms`,
      method: 'POST',
      headers: { Authorization: 'Bearer ' + authToken, 'Content-Type': 'application/json' },
    },
    (res) => {
      let b = ''
      res.on('data', (d) => (b += d))
      res.on('end', () => resolve({ status: res.statusCode, b }))
    },
  )
  req.on('error', reject)
  req.end('{}')
})

if (body.status !== 200) {
  console.error(`sync-forms falhou (HTTP ${body.status}): ${body.b.slice(0, 300)}`)
  process.exit(1)
}
const parsed = JSON.parse(body.b)
console.log(`formulários sincronizados: ${parsed.total}`)
for (const f of parsed.forms || []) console.log(`  ${f.formId}  ${f.formName}`)
