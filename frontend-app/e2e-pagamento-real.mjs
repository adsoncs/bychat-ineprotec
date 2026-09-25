// Fluxo real contra gateway (Asaas): inscrição → PIX → tela de acompanhamento.
// Diferente do e2e-pagamento.mjs, NÃO confirma: em conexão real a confirmação
// manual responde 403 por desenho, e quem dá a baixa é o webhook do provedor.
// Imprime o id da cobrança para que ela possa ser cancelada depois do teste.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(42)} ${b}`)

const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 })).newPage()
const erros = []
p.on('pageerror', (e) => erros.push(String(e)))
p.on('response', (r) => { if (r.status() >= 400) erros.push(`${r.status()} ${r.url().replace(B, '')}`) })

await p.goto(`${B}/portal/inscricao`, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })

await p.waitForSelector('.cartao h2')
await p.fill('input[name="nome"]', 'TESTE ATTRAE NAO COBRAR')
await p.fill('input[name="cpf"]', '168.995.350-09')
await p.fill('input[name="email"]', 'teste.attrae@example.com')
await p.fill('input[name="whatsapp"]', '62994445566')
await p.click('button.principal'); await p.waitForTimeout(600)
await p.locator('.curso').first().click(); await p.waitForTimeout(300)
await p.click('button.principal'); await p.waitForTimeout(600)
await p.click('button.principal')
await p.waitForSelector('.fim', { timeout: 20000 })
const codigo = await p.textContent('.fim .codigo')
linha('inscrição', codigo)

console.log('\n── etapa de pagamento ──')
await p.waitForSelector('.opcao-pagamento', { timeout: 10000 })
linha('opções oferecidas', (await p.locator('.opcao-pagamento b').allTextContents()).join(' · '))
await p.locator('.opcao-pagamento').first().click()

// A tela deve mostrar "Preparando…" enquanto o código não chega, e preencher
// sozinha assim que chegar — sem a pessoa recarregar nem começar de novo.
await p.waitForTimeout(1200)
const preparando = await p.locator('text=Preparando seu').count()
linha('estado de espera enquanto prepara', preparando ? 'sim' : 'não (código veio direto)')

await p.waitForSelector('.qr-caixa img', { timeout: 25000 })
linha('QR renderizado', 'sim')
linha('valor e vencimento', JSON.stringify((await p.locator('.cartao .sub').last().textContent())?.trim()))
const qrSrc = await p.locator('.qr-caixa img').getAttribute('src')
linha('imagem do QR', qrSrc?.slice(0, 32) + '…')
const copia = await p.locator('.codigo-longo').textContent().catch(() => null)
linha('payload PIX', JSON.stringify(copia?.slice(0, 40)))
linha('botão "Já paguei"', (await p.locator('button:has-text("Já paguei")').count()) ? 'presente' : 'AUSENTE')
linha('botão de simular', (await p.locator('button:has-text("Simular pagamento")').count()) ? 'PRESENTE (não deveria)' : 'ausente (correto)')

// O botão manual precisa dizer algo útil quando ainda não caiu, sem travar a tela.
await p.locator('button:has-text("Já paguei")').click()
await p.waitForTimeout(2500)
const aviso = await p.locator('.aviso.erro').textContent().catch(() => null)
linha('resposta do "Já paguei"', JSON.stringify(aviso?.trim().slice(0, 60)))
linha('QR continua na tela', (await p.locator('.qr-caixa img').count()) ? 'sim' : 'NÃO')

await p.screenshot({ path: '/tmp/pagamento-real.png', fullPage: true })
linha('erros de console/rede', erros.length ? JSON.stringify(erros.slice(0, 4)) : 'nenhum')
console.log(`\nCódigo da inscrição: ${codigo}`)
await b.close()
