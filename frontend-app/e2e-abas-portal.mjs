// Aba de Pagamento separada da Configuração.
//
// O que precisa ser provado não é a tela existir, e sim que salvar numa aba
// não desfaz o que a outra acabou de gravar — era esse o conflito, escondido no
// payload compartilhado.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(46)} ${b}`)

const login = await fetch(`${B}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'teste.tela@local.invalid', password: 'TesteTela2026' }),
})
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const token = (await login.json())?.token
const cab = { 'Content-Type': 'application/json', cookie, Authorization: `Bearer ${token}` }

const lerPortal = async () => {
  const r = await fetch(`${B}/api/admin/enrollment-portals`, { headers: cab })
  return ((await r.json()).portals ?? []).find((p) => p.slug === 'inscricao')
}
const antes = await lerPortal()
const guardado = {
  paymentScope: antes.paymentScope,
  paymentMethodsConfig: antes.paymentMethodsConfig,
  paymentDeadlineHours: antes.paymentDeadlineHours,
  captchaType: antes.captchaType,
  customDomain: antes.customDomain,
}
console.log('estado inicial guardado para restaurar no fim\n')

const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage()
const erros = []
p.on('pageerror', (e) => erros.push(String(e)))
p.on('response', (r) => { if (r.status() >= 500) erros.push(`${r.status()} ${r.url().replace(B, '')}`) })

await p.goto(`${B}/app/login`, { waitUntil: 'networkidle' })
await p.fill('input[type="email"]', 'teste.tela@local.invalid')
await p.fill('input[type="password"]', 'TesteTela2026')
await p.click('button[type="submit"]')
// O login é assíncrono: `networkidle` volta antes do token ser guardado, e a
// navegação seguinte cai de volta na tela de entrada.
await p.waitForTimeout(3500)
await p.goto(`${B}/app/enrollment-portals/${antes.id}`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

// O banner de cookies fica por cima e engole clique — inclusive o de salvar,
// que mora no fim da página. Um operador aceita uma vez; aqui também.
const aceitar = p.locator('#bych-cc button:has-text("Aceitar")').first()
if (await aceitar.count()) {
  await aceitar.click()
  await p.waitForTimeout(600)
  console.log('  (banner de cookies aceito)')
}

console.log('── as abas ──')
const abas = await p.locator('.border-b button').allTextContents()
linha('abas do portal', JSON.stringify(abas.map((t) => t.trim()).filter(Boolean)))

await p.locator('button:has-text("Pagamento")').first().click()
await p.waitForTimeout(900)
linha('aba Pagamento tem provedor', (await p.locator('text=Exigir pagamento').count()) ? 'sim' : 'NÃO')
linha('aba Pagamento tem meios', (await p.locator('text=Meios de pagamento').count()) ? 'sim' : 'NÃO')
linha('aba Pagamento tem cartão', (await p.locator('text=Cartão de crédito').count()) ? 'sim' : 'NÃO')

await p.locator('button:has-text("Configuração")').first().click()
await p.waitForTimeout(900)
const textoConfig = (await p.locator('main').textContent()) ?? ''
linha('Configuração ainda fala de pagamento?', /Meios de pagamento|Modo de cobrança|Conexão de pagamento/.test(textoConfig) ? 'SIM (nao deveria)' : 'não (correto)')
linha('Configuração manteve captcha', /Captcha/.test(textoConfig) ? 'sim' : 'NÃO')
linha('Configuração manteve filtros/funil', /Funil|Filtros/.test(textoConfig) ? 'sim' : 'NÃO')

console.log('\n── o conflito: salvar numa aba não pode desfazer a outra ──')
// 1. grava pela aba de Pagamento
await p.locator('button:has-text("Pagamento")').first().click()
await p.waitForTimeout(800)
const selectEscopo = p.locator('select').filter({ hasText: 'Taxa de inscrição' }).first()
await selectEscopo.selectOption('curso')
await p.waitForTimeout(300)
await p.locator('button:has-text("Salvar pagamento")').click()
await p.waitForTimeout(2000)
const depoisDoPagamento = await lerPortal()
linha('Pagamento gravou escopo=curso', depoisDoPagamento.paymentScope === 'curso' ? 'sim' : `NÃO (${depoisDoPagamento.paymentScope})`)

// 2. mexe em algo da Configuração e salva — é aqui que antes o pagamento era
// sobrescrito, porque os dois viajavam no mesmo payload.
await p.locator('button:has-text("Configuração")').first().click()
await p.waitForTimeout(1200)
const dominio = p.locator('input[placeholder="inscricoes.suainstituicao.com.br"]').first()
await dominio.fill('teste-abas.exemplo.br')
await p.waitForTimeout(400)
const salvarConfig = p.locator('button:has-text("Salvar")').last()
linha('botão Salvar da Configuração habilitou', (await salvarConfig.isEnabled()) ? 'sim' : 'NÃO')
await salvarConfig.click()
await p.waitForTimeout(3000)
const depoisDaConfig = await lerPortal()
linha('escopo sobreviveu ao salvar da Configuração', depoisDaConfig.paymentScope === 'curso' ? 'sim' : `NÃO — voltou para "${depoisDaConfig.paymentScope}"`)
linha('regras dos meios sobreviveram', JSON.stringify(depoisDaConfig.paymentMethodsConfig) === JSON.stringify(depoisDoPagamento.paymentMethodsConfig) ? 'sim' : 'NÃO')
linha('erros de console/5xx', erros.length ? JSON.stringify(erros.slice(0, 3)) : 'nenhum')

await b.close()

// Restaura o estado original.
const r = await fetch(`${B}/api/admin/enrollment-portals/${antes.id}`, {
  method: 'PUT', headers: cab, body: JSON.stringify(guardado),
})
console.log(`\nestado restaurado: HTTP ${r.status}`)
const fim = await lerPortal()
console.log(`  paymentScope=${fim.paymentScope} captchaType=${fim.captchaType ?? 'null'}`)
