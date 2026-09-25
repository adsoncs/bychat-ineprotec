// Checkout de cartão no nosso portal (sem sair para o Asaas).
//
// Testa o que dá para testar sem um cartão real: o formulário, as máscaras, a
// detecção de bandeira, a validação local e a recusa vinda do provedor. O
// caminho de aprovação exige um cartão de verdade — é o passo humano.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(44)} ${b}`)

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, isMobile: true })
const p = await ctx.newPage()
const erros = []
p.on('pageerror', (e) => erros.push(String(e)))
p.on('response', (r) => { if (r.status() >= 500) erros.push(`${r.status()} ${r.url().replace(B, '')}`) })

await p.goto(`${B}/portal/inscricao`, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.waitForSelector('.cartao h2')
await p.fill('input[name="nome"]', 'TESTE ATTRAE CARTAO')
await p.fill('input[name="cpf"]', '168.995.350-09')
await p.fill('input[name="email"]', 'teste.cartao@example.com')
await p.fill('input[name="whatsapp"]', '62994445566')
await p.click('button.principal'); await p.waitForTimeout(700)
await p.locator('.curso').first().click(); await p.waitForTimeout(400)
await p.click('button.principal'); await p.waitForTimeout(700)
await p.click('button.principal')
await p.waitForSelector('.fim', { timeout: 20000 })
const codigo = await p.textContent('.fim .codigo')
linha('inscrição', codigo)

await p.waitForSelector('.opcao-pagamento', { timeout: 10000 })
await p.locator('.opcao-pagamento', { hasText: 'Cartão' }).click()
await p.waitForSelector('#cc-numero', { timeout: 8000 })

console.log('\n── o formulário é nosso ──')
linha('campo de número', (await p.locator('#cc-numero').count()) ? 'presente' : 'AUSENTE')
linha('parcelas clicáveis', await p.locator('.opcao-parcela:not([disabled])').count())
linha('aviso de página externa', (await p.locator('text=página segura').count()) ? 'PRESENTE (nao deveria)' : 'ausente (correto)')

console.log('\n── máscara e bandeira ──')
await p.fill('#cc-numero', '4111111111111111')
await p.waitForTimeout(300)
linha('número formatado', JSON.stringify(await p.inputValue('#cc-numero')))
linha('bandeira detectada', JSON.stringify((await p.locator('.marca-cartao').textContent().catch(() => null))))
await p.fill('#cc-numero', '378282246310005')
await p.waitForTimeout(300)
linha('Amex formatado', JSON.stringify(await p.inputValue('#cc-numero')))
linha('Amex → bandeira', JSON.stringify((await p.locator('.marca-cartao').textContent().catch(() => null))))
linha('Amex → dígitos do CVV', JSON.stringify((await p.locator('label[for="cc-ccv"] .opcional').textContent())?.trim()))

console.log('\n── validação antes de enviar ──')
await p.fill('#cc-numero', '4111111111111112') // dígito final errado
await p.fill('#cc-nome', 'Fulano de Tal')
await p.fill('#cc-validade', '1230')
await p.fill('#cc-ccv', '123')
await p.locator('button.principal:has-text("Pagar")').click()
await p.waitForTimeout(600)
linha('número inválido é barrado aqui', JSON.stringify((await p.locator('.campo.ruim .erro').first().textContent().catch(() => null))))
await p.fill('#cc-validade', '0120')
await p.locator('button.principal:has-text("Pagar")').click()
await p.waitForTimeout(600)
const textoErros = (await p.locator('.campo.ruim .erro').allTextContents()).join(' | ')
linha('cartão vencido é barrado', textoErros.includes('vencido') ? 'sim' : `nao (${textoErros})`)

console.log('\n── recusa vinda do provedor ──')
await p.fill('#cc-numero', '4000000000000002') // Luhn ok, recusado na adquirente
await p.fill('#cc-validade', '1230')
await p.locator('button.principal:has-text("Pagar")').click()
await p.waitForTimeout(9000)
const aviso = await p.locator('.aviso.erro').textContent().catch(() => null)
linha('mensagem ao candidato', JSON.stringify(aviso?.replace(/\s+/g, ' ').trim().slice(0, 90)))
linha('formulário segue disponível', (await p.locator('#cc-numero').count()) ? 'sim' : 'nao')
linha('erros de console/5xx', erros.length ? JSON.stringify(erros.slice(0, 3)) : 'nenhum')
console.log(`\nCódigo: ${codigo}`)
await b.close()
