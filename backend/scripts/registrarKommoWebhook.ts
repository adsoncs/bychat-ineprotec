// scripts/registrarKommoWebhook.ts
//
// Registra (ou confere) o webhook `add_message` da Kommo apontando para cá.
//
//   npx tsx scripts/registrarKommoWebhook.ts            # só mostra o estado
//   npx tsx scripts/registrarKommoWebhook.ts --apply    # cria, se faltar
//   npx tsx scripts/registrarKommoWebhook.ts --remover  # desfaz
//
// Idempotente: se o hook já existe para este destino, não cria outro — a conta
// do cliente tem outras integrações (wearekwid, Supabase) usando add_message,
// e duplicar o nosso só geraria trabalho repetido.
//
// A conta é de produção do cliente: o script NUNCA toca em hook de terceiro,
// só no que aponta para o nosso APP_URL.

import { getKommoChatsConfig, kommoFetch } from '../src/lib/kommoClient.js'
import { getKommoWebhookToken } from '../src/routes/kommoWebhook.js'
import { prisma } from '../src/lib/prisma.js'

const apply = process.argv.includes('--apply')
const remover = process.argv.includes('--remover')

const cfg = await getKommoChatsConfig()
const token = await getKommoWebhookToken()
const base = (process.env.APP_URL || '').replace(/\/+$/, '')
if (!base) {
  console.error('[hook] APP_URL vazio no .env — sem ele não há destino para registrar.')
  process.exit(1)
}
const destino = `${base}/api/kommo/webhook/${token}`

async function api(metodo: 'POST' | 'DELETE', corpo: unknown): Promise<any> {
  const resp = await fetch(`https://${cfg.subdomain}.kommo.com/api/v4/webhooks`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(corpo),
  })
  const texto = await resp.text()
  if (!resp.ok) throw new Error(`${resp.status} ${texto.slice(0, 300)}`)
  return texto ? JSON.parse(texto) : null
}

const atuais = await kommoFetch('/webhooks', cfg).catch(() => null)
const lista: any[] = atuais?._embedded?.webhooks ?? []
const nosso = lista.find((w) => typeof w.destination === 'string' && w.destination.startsWith(`${base}/api/kommo/webhook/`))

console.log(`[hook] conta ${cfg.subdomain} · ${lista.length} webhook(s) registrados`)
for (const w of lista) {
  const meu = w === nosso ? '  ← NOSSO' : ''
  console.log(`  ${w.id} · ${w.disabled ? 'DESATIVADO' : 'ativo'} · ${String(w.destination).slice(0, 60)}…${meu}`)
}

if (remover) {
  if (!nosso) { console.log('\n[hook] nada nosso para remover.') }
  else {
    await api('DELETE', { request: [{ id: nosso.id }] })
    console.log(`\n[hook] removido (id ${nosso.id}).`)
  }
} else if (nosso && !nosso.disabled) {
  console.log(`\n[hook] já registrado e ativo (id ${nosso.id}) — nada a fazer.`)
} else if (!apply) {
  console.log(`\n[hook] FALTA registrar. Rode com --apply para criar:\n  ${destino.replace(token, token.slice(0, 6) + '…')}`)
} else {
  // A Kommo aceita `settings` com os eventos desejados. Só `add_message`: é o
  // que o espelho precisa, e pedir mais eventos seria receber (e ignorar)
  // tráfego que não usamos.
  const r = await api('POST', { destination: destino, settings: ['add_message'] })
  const criado = r?._embedded?.webhooks?.[0]
  console.log(`\n[hook] registrado: id ${criado?.id ?? '?'} · eventos ${JSON.stringify(criado?.settings ?? ['add_message'])}`)
  console.log('[hook] a partir de agora a Kommo avisa a cada mensagem; o ciclo de 5 min vira só rede de segurança.')
}

await prisma.$disconnect()
