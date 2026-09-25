// Cupom no checkout: as três regras decididas com o cliente.
//
//  1. cupom e desconto à vista não somam — vale o maior;
//  2. o preço muda para todos os meios;
//  3. o cupom só é consumido quando o pagamento é confirmado.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(48)} ${b}`)

const login = await fetch(`${B}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'teste.tela@local.invalid', password: 'TesteTela2026' }),
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const token = (await login.json())?.token
const cab = { 'Content-Type': 'application/json', cookie, Authorization: `Bearer ${token}` }

// Cupons de teste: um generoso (vence o desconto à vista) e um pequeno (perde).
const criar = async (code, type, value) => {
  const r = await fetch(`${B}/api/admin/coupons`, {
    method: 'POST', headers: cab,
    body: JSON.stringify({ code, type, value, description: `teste ${code}`, active: true }),
  })
  return { code, status: r.status }
}
const c1 = await criar('TESTE30', 'percent', 30)
const c2 = await criar('TESTE1', 'percent', 1)
console.log(`cupons de teste: ${c1.code} (${c1.status}) · ${c2.code} (${c2.status})\n`)

const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 420, height: 900 }, isMobile: true })).newPage()
const erros = []
p.on('pageerror', (e) => erros.push(String(e)))
p.on('response', (r) => { if (r.status() >= 500) erros.push(`${r.status()} ${r.url().replace(B, '')}`) })

await p.goto(`${B}/portal/inscricao`, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.waitForSelector('.cartao h2')
await p.fill('input[name="nome"]', 'TESTE ATTRAE CUPOM')
await p.fill('input[name="cpf"]', '168.995.350-09')
await p.fill('input[name="email"]', 'teste.cupom@example.com')
await p.fill('input[name="whatsapp"]', '62994445566')
await p.click('button.principal'); await p.waitForTimeout(700)
await p.locator('.curso').first().click(); await p.waitForTimeout(400)
await p.click('button.principal'); await p.waitForTimeout(700)
await p.click('button.principal')
await p.waitForSelector('.fim', { timeout: 20000 })
const codigo = await p.textContent('.fim .codigo')
await p.waitForSelector('.opcao-pagamento', { timeout: 10000 })

const precoNaTela = async () => (await p.locator('.cartao .sub').first().textContent())?.replace(/\s+/g, ' ').trim()
const pix = async () => (await p.locator('.opcao-pagamento', { hasText: 'PIX' }).textContent())?.replace(/\s+/g, ' ').trim()

console.log('── antes do cupom ──')
linha('preço', await precoNaTela())
linha('campo de cupom aparece', (await p.locator('#cupom').count()) ? 'sim' : 'NÃO')

console.log('\n── cupom que vence o desconto à vista (30%) ──')
await p.fill('#cupom', 'TESTE30')
await p.locator('button:has-text("Aplicar")').click()
await p.waitForTimeout(2500)
linha('preço', await precoNaTela())
linha('mostra preço cheio riscado', (await p.locator('.riscado').count()) ? 'sim' : 'NÃO')
linha('confirma o cupom aplicado', (await p.locator('.cupom-ok').textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim().slice(0, 60))
linha('afeta o botão do PIX', await pix())

console.log('\n── cupom menor que o desconto à vista (1%) ──')
await p.locator('.cupom-ok button:has-text("remover")').click()
await p.waitForTimeout(1500)
await p.fill('#cupom', 'TESTE1')
await p.locator('button:has-text("Aplicar")').click()
await p.waitForTimeout(2500)
const okTexto = (await p.locator('.cupom-ok').textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim()
linha('avisa que manteve o desconto maior', /à vista, que é maior/.test(okTexto ?? '') ? 'sim' : `NÃO (${okTexto?.slice(0, 50)})`)
linha('preço', await precoNaTela())

console.log('\n── cupom inexistente ──')
await p.locator('.cupom-ok button:has-text("remover")').click()
await p.waitForTimeout(1200)
await p.fill('#cupom', 'NAOEXISTE')
await p.locator('button:has-text("Aplicar")').click()
await p.waitForTimeout(2500)
linha('explica o motivo', (await p.locator('.cupom .erro').textContent().catch(() => 'sem mensagem'))?.trim())
linha('preço voltou ao cheio', await precoNaTela())
linha('erros de console/5xx', erros.length ? JSON.stringify(erros.slice(0, 2)) : 'nenhum')
await b.close()

console.log('\n── o cupom foi consumido? (não, ninguém pagou) ──')
const lista = await (await fetch(`${B}/api/admin/coupons`, { headers: cab })).json()
const t30 = (lista.coupons ?? lista.items ?? []).find((c) => c.code === 'TESTE30')
linha('usageCount do TESTE30', t30 ? t30.usageCount : '?')
linha('regra: só conta quando pagam', t30 && t30.usageCount === 0 ? 'respeitada' : 'VIOLADA')

console.log(`\nInscrição de teste: ${codigo}`)
