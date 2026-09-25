// Link de acesso da inscrição: gerar sem enviar, copiar e usar.
//
// O ponto do recurso é a secretaria conseguir o link para colar onde a conversa
// já acontece. Então o que precisa ser provado é: (1) gerar não dispara nada,
// (2) o link aparece na tela, (3) o link realmente entra na inscrição.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(44)} ${b}`)

const login = await fetch(`${B}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'teste.tela@local.invalid', password: 'TesteTela2026' }),
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const token = (await login.json())?.token
const cab = { 'Content-Type': 'application/json', cookie, Authorization: `Bearer ${token}` }

const portais = (await (await fetch(`${B}/api/admin/enrollment-portals`, { headers: cab })).json()).portals ?? []
const portal = portais.find((p) => p.slug === 'inscricao')
const regs = await (await fetch(`${B}/api/admin/enrollment-portals/${portal.id}/registrations?limit=1`, { headers: cab })).json()
const reg = (regs.items ?? [])[0]
if (!reg) { console.log('sem inscrição para testar'); process.exit(0) }
console.log(`inscrição: ${reg.candidateCode} (#${reg.id})\n`)

console.log('── gerar sem enviar ──')
const r1 = await fetch(`${B}/api/admin/enrollment-registrations/${reg.id}/resend-link`, {
  method: 'POST', headers: cab, body: JSON.stringify({ enviar: false }),
})
const gerado = await r1.json()
linha('HTTP', r1.status)
linha('disparou mensagem?', gerado.sent === false ? 'não (correto)' : 'SIM (nao deveria)')
linha('devolveu a URL', gerado.url ? 'sim' : 'NÃO')
linha('validade informada', gerado.ttlDays ? `${gerado.ttlDays} dia(s)` : 'NÃO')
linha('url', String(gerado.url).replace(B, '').slice(0, 60))

console.log('\n── o padrão continua enviando ──')
const r2 = await fetch(`${B}/api/admin/enrollment-registrations/${reg.id}/resend-link`, {
  method: 'POST', headers: cab, body: JSON.stringify({}),
})
const enviado = await r2.json()
linha('sem o campo, envia', enviado.sent === true ? 'sim (compatível)' : 'NÃO')

console.log('\n── ficou registrado na timeline? ──')
const hist = await fetch(`${B}/api/leads/${reg.leadId}/history?limit=10`, { headers: cab }).then((r) => r.json()).catch(() => null)
const eventos = (hist?.events ?? hist?.data ?? []).map((e) => e.type)
linha('eventos recentes do lead', JSON.stringify(eventos.slice(0, 4)))
linha('registrou geração/envio', eventos.some((t) => String(t).startsWith('magic_link')) ? 'sim' : 'não encontrado')

console.log('\n── o link entra mesmo na inscrição? ──')
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, isMobile: true })).newPage()
const erros = []
p.on('response', (r) => { if (r.status() >= 500) erros.push(`${r.status()} ${r.url().replace(B, '')}`) })
await p.goto(gerado.url, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
linha('abriu', p.url().replace(B, '').slice(0, 50))
linha('caiu numa tela útil', (await p.locator('.cartao, .fim').count()) ? 'sim' : 'NÃO')
linha('erros 5xx', erros.length ? JSON.stringify(erros.slice(0, 2)) : 'nenhum')
await b.close()

console.log('\n── a tela do admin mostra o link ──')
const b2 = await chromium.launch()
const p2 = await (await b2.newContext({ viewport: { width: 1400, height: 950 } })).newPage()
await p2.goto(`${B}/app/login`, { waitUntil: 'networkidle' })
await p2.fill('input[type="email"]', 'teste.tela@local.invalid')
await p2.fill('input[type="password"]', 'TesteTela2026')
await p2.click('button[type="submit"]')
await p2.waitForTimeout(3500)
await p2.goto(`${B}/app/enrollment-portals/${portal.id}/registrations/${reg.id}`, { waitUntil: 'networkidle' })
await p2.waitForTimeout(2500)
const ac = p2.locator('#bych-cc button:has-text("Aceitar")').first()
if (await ac.count()) { await ac.click(); await p2.waitForTimeout(500) }
const botaoGerar = p2.locator('button:has-text("Gerar link de acesso")').first()
linha('botão "Gerar link de acesso"', (await botaoGerar.count()) ? 'presente' : 'AUSENTE')
if (await botaoGerar.count()) {
  await botaoGerar.click()
  await p2.waitForTimeout(2500)
  linha('link apareceu na tela', (await p2.locator('code').filter({ hasText: 'portal' }).count()) ? 'sim' : 'NÃO')
  linha('avisa a validade', (await p2.locator('text=Vale por').count()) ? 'sim' : 'NÃO')
  linha('avisa que é credencial', (await p2.locator('text=mande só para o candidato').count()) ? 'sim' : 'NÃO')
  linha('botão de copiar', (await p2.locator('button:has-text("Copiar")').count()) >= 2 ? 'sim' : 'NÃO')
}
await p2.screenshot({ path: '/tmp/claude-0/-root/104fdb0f-1570-455e-8371-ea37d1217b15/scratchpad/link-acesso.png' })
await b2.close()
