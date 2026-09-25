// Fotografa o portal, para comparar com a tela de referência.
//   node _shot-portal.mjs <saida.png> [etapa] [largura]
// etapa 2 preenche os dados e escolhe um curso, para ver o resumo com conteúdo.
import { chromium } from '@playwright/test'

const B = 'http://127.0.0.1:3110'
const saida = process.argv[2] || '/tmp/portal-desktop.png'
const etapa = Number(process.argv[3] || 1)
const largura = Number(process.argv[4] || 1919)

const b = await chromium.launch()
const ctx = await b.newContext({
  viewport: { width: largura, height: 967 },
  deviceScaleFactor: 1,
  isMobile: largura < 700,
})
const p = await ctx.newPage()
await p.goto(`${B}/portal/inscricao`, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.waitForSelector('.cartao h2')

if (etapa >= 2) {
  await p.fill('input[name="nome"]', 'Camila Ferreira Duarte')
  await p.fill('input[name="cpf"]', '390.533.447-05')
  await p.fill('input[name="email"]', 'camila.duarte@example.com')
  await p.fill('input[name="whatsapp"]', '62994445566')
  await p.click('button.principal')
  await p.waitForTimeout(700)
  await p.locator('.curso').first().click()
  await p.waitForTimeout(700)
}

await p.waitForTimeout(900)
await p.screenshot({ path: saida }) // viewport: a faixa fixa se repetiria em fullPage
const rolagem = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
console.log('salvo em', saida, '| rolagem horizontal:', rolagem ? 'SIM' : 'não')
await b.close()
