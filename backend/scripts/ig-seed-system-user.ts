// Conecta o Instagram/Messenger de um tenant com o SYSTEM USER TOKEN, sem
// passar pelo "Conectar via Facebook" do painel.
//
// Por que existe: o login do painel deriva o token da Página do USUÁRIO que
// clicou. Como é a mesma pessoa conectando todos os clientes no mesmo app, cada
// novo login troca as Páginas autorizadas para esse usuário e o token do tenant
// conectado antes perde `pages_messaging` (era o terram derrubando o beyond e
// vice-versa). O token da Página derivado do System User é permanente e não
// depende de login de ninguém.
//
// Pré-requisito no Business Manager: a Página atribuída ao System User com a
// tarefa MESSAGING (Usuários do sistema > ByChat Integração > Atribuir ativos).
//
// Uso (dentro de <tenant>/backend):
//   npx tsx --env-file=.env scripts/ig-seed-system-user.ts --page <pageId> [--aplicar]
// Sem --aplicar só valida e mostra o que faria. Não imprime token nenhum.
// O System User token vem de /etc/bychat/meta-system-user.token (0600).
// Em servidor sem esse arquivo (VPS do elementus/kobogo), o token da Página já
// derivado pode chegar pela entrada padrão com --page-token-stdin: o System
// User token não sai do servidor principal, e as mesmas validações valem.
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.js'
import { getMetaAppId, getMetaAppSecret } from '../src/lib/meta.js'

const GRAPH = 'https://graph.facebook.com/v23.0'
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const aplicar = process.argv.includes('--aplicar')
const pageId = arg('page')
if (!pageId) throw new Error('informe --page <pageId>')

const viaStdin = process.argv.includes('--page-token-stdin')
const suToken = viaStdin ? '' : (process.env.META_SYSTEM_USER_TOKEN || readFileSync('/etc/bychat/meta-system-user.token', 'utf8')).trim()
const appToken = `${await getMetaAppId()}|${await getMetaAppSecret()}`

async function g(path: string, token: string, method = 'GET'): Promise<any> {
  const r = await fetch(`${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { method })
  const j: any = await r.json()
  if (j.error) throw new Error(`${path.split('?')[0]}: ${j.error.message}`)
  return j
}
const debug = async (t: string) => (await g(`/debug_token?input_token=${encodeURIComponent(t)}`, appToken)).data

let page: any
if (viaStdin) {
  const tok = readFileSync(0, 'utf8').trim()
  page = { ...(await g(`/${pageId}?fields=id,name,instagram_business_account{id,username}`, tok)), access_token: tok }
} else {
  // 1. O token de origem tem que ser mesmo o System User permanente.
  const su = await debug(suToken)
  if (su.type !== 'SYSTEM_USER' || su.expires_at !== 0 || su.data_access_expires_at !== 0) {
    throw new Error(`token de origem não é System User permanente (type=${su.type})`)
  }
  // 2. Token da Página derivado do System User + a conta IG vinculada.
  page = await g(`/${pageId}?fields=id,name,access_token,instagram_business_account{id,username}`, suToken)
  if (!page.access_token) throw new Error('Página não atribuída ao System User (sem access_token)')
}
const pd = await debug(page.access_token)
if (!pd.is_valid || pd.type !== 'PAGE' || pd.expires_at !== 0) throw new Error(`token da Página inválido (type=${pd.type})`)
// Pela entrada padrão não dá para ver a origem antes: o dono do token tem que ser o System User.
if (viaStdin && String(pd.user_id) !== '122110799108872109') throw new Error('token da Página não veio do System User')
const faltando = ['pages_messaging', 'instagram_manage_messages'].filter((s) => !(pd.scopes || []).includes(s))
if (faltando.length) throw new Error(`token da Página sem ${faltando.join(', ')}`)
const ig = page.instagram_business_account
console.log(`Página ${page.id} "${page.name}" · IG ${ig ? `@${ig.username} ${ig.id}` : 'NÃO VINCULADO (só Messenger)'} · token PAGE permanente`)

// Um tenant pode ter várias contas (uma por empresa): a lista fica em
// `instagram.connections` e `instagram.connection` guarda a primeira — o mesmo
// formato que routes/instagram.ts lê e grava.
const ler = (row: any) => { if (!row) return null; try { return typeof row.value === 'string' ? JSON.parse(row.value) : row.value } catch { return null } }
const listaRow = await prisma.setting.findUnique({ where: { key: 'instagram.connections' } })
const unicaRow = await prisma.setting.findUnique({ where: { key: 'instagram.connection' } })
const lista: any[] = Array.isArray(ler(listaRow)) ? ler(listaRow) : (ler(unicaRow)?.pageId ? [ler(unicaRow)] : [])
const mesma = lista.find((c) => String(c.pageId) === String(pageId))
console.log(`contas conectadas: ${lista.length ? lista.map((c) => `${c.pageId} @${c.igUsername} (${c.tokenType})`).join(' · ') : 'nenhuma'}`)
console.log(mesma ? '→ esta conta já está na lista: o token será trocado, setor e funil mantidos' : '→ conta nova: será ADICIONADA, as outras continuam')
if (!aplicar) { console.log('(simulação — rode com --aplicar)'); process.exit(0) }

// 3. Página assina o app (DM, postback e eco).
await g(`/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes`, page.access_token, 'POST')

// 4. Grava a conexão no mesmo formato do painel. Backup do valor anterior fora do banco.
if (lista.length) {
  const arq = `/root/.bychat-ig-backup-${process.env.APP_URL?.replace(/^https?:\/\//, '').split('.')[0]}-${Date.now()}.json`
  writeFileSync(arq, JSON.stringify(lista), { mode: 0o600 })
  console.log(`backup das conexões anteriores: ${arq}`)
}
const conn = {
  pageId: page.id,
  pageName: page.name,
  igUserId: ig?.id ?? '',
  igUsername: ig?.username ?? '',
  pageAccessToken: page.access_token,
  active: true,
  connectedAt: new Date().toISOString(),
  tokenExpiresAt: 0,
  tokenType: 'system_user',
  defaultTeamId: mesma?.defaultTeamId ?? null,
  funnelId: mesma?.funnelId ?? null,
  stageKey: mesma?.stageKey ?? null,
}
const nova = mesma ? lista.map((c) => (c === mesma ? conn : c)) : [...lista, conn]
const salvar = async (key: string, v: unknown, label: string) => {
  const value = JSON.stringify(v)
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value, label, grp: 'channels', fieldType: 'json' } })
}
await salvar('instagram.connections', nova, 'Instagram connections')
await salvar('instagram.connection', nova[0], 'Instagram connection')
console.log(`✅ conectado com System User. Rota para a mãe: ids ["${page.id}"${ig ? `,"${ig.id}"` : ''}]`)
await prisma.$disconnect()
