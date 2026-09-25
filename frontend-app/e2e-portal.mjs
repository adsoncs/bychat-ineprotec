// Percorre o portal novo num navegador de verdade: JS roda, máscara aplica,
// validação dispara, rascunho salva. É o teste que curl não faz.
import { chromium } from '@playwright/test'

const BASE = process.env.BASE || 'http://127.0.0.1:3110'
const SLUG = 'inscricao'
const linha = (a, b) => console.log(`  ${String(a).padEnd(46)} ${b}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()

const errosDeConsole = []
page.on('console', (m) => m.type() === 'error' && errosDeConsole.push(m.text()))
page.on('pageerror', (e) => errosDeConsole.push(String(e)))

console.log('\n── 1. a tela abre e monta ──')
await page.goto(`${BASE}/portal/${SLUG}`, { waitUntil: 'networkidle' })
await page.waitForSelector('.cartao h2', { timeout: 10000 })
linha('título da etapa', JSON.stringify(await page.textContent('.cartao h2')))
linha('etapas na trilha', (await page.locator('.trilha .etapa').count()))
// A capa é opcional no builder (brandHeroEnabled) e não existe quando o portal
// usa a faixa de topo — esperar por ela travava o teste por escolha de marca.
linha('capa com o nome do processo', (await page.locator('.capa h1').count())
  ? JSON.stringify((await page.textContent('.capa h1'))?.slice(0, 40))
  : 'sem capa (hero desligado)')
linha('faixa de topo', (await page.locator('.barra-topo').count()) ? 'sim' : 'não')
linha('campos visíveis', await page.locator('.campo input, .campo select').count())

console.log('\n── 2. máscara enquanto digita ──')
await page.fill('input[name="cpf"]', '39053344705')
linha('CPF digitado sem pontuação vira', JSON.stringify(await page.inputValue('input[name="cpf"]')))
await page.fill('input[name="whatsapp"]', '62999887766')
linha('WhatsApp vira', JSON.stringify(await page.inputValue('input[name="whatsapp"]')))
await page.fill('input[name="nascimento"]', '15081999')
linha('data vira', JSON.stringify(await page.inputValue('input[name="nascimento"]')))

console.log('\n── 3. validação diz o que corrigir ──')
await page.fill('input[name="cpf"]', '111.111.111-11')
await page.locator('input[name="email"]').click()
await page.waitForTimeout(150)
linha('CPF com dígito errado', JSON.stringify(await page.textContent('.campo.ruim .erro')))
await page.fill('input[name="email"]', 'nao-e-email')
await page.locator('input[name="nome"]').click()
await page.waitForTimeout(150)
const errosVisiveis = await page.locator('.campo .erro').allTextContents()
linha('erros mostrados juntos', JSON.stringify(errosVisiveis))

console.log('\n── 4. avançar com erro não passa e leva ao campo ──')
await page.click('button.principal')
await page.waitForTimeout(400)
linha('continua na mesma etapa', JSON.stringify(await page.textContent('.cartao h2')))
linha('foco foi para', await page.evaluate(() => document.activeElement?.getAttribute('name')))

console.log('\n── 5. preenchendo certo, avança ──')
await page.fill('input[name="nome"]', 'Camila Ferreira Duarte')
await page.fill('input[name="cpf"]', '39053344705')
await page.fill('input[name="email"]', 'camila.duarte@example.com')
await page.fill('input[name="whatsapp"]', '62991234567')
await page.click('button.principal')
await page.waitForTimeout(600)
linha('etapa atual', JSON.stringify(await page.textContent('.cartao h2')))

console.log('\n── 6. escolha do curso com busca ──')
linha('cursos listados', await page.locator('.curso').count())
await page.fill('#busca_curso', 'direito')
await page.waitForTimeout(250)
linha('após buscar "direito"', await page.locator('.curso').count())
await page.locator('.curso').first().click()
await page.waitForTimeout(250)
linha('curso marcado', await page.locator('.curso[aria-pressed="true"]').count())
linha('resumo apareceu', (await page.locator('.resumo').count()) ? 'sim' : 'não')
linha('   mensalidade no resumo', JSON.stringify((await page.textContent('.resumo .destaque'))?.replace(/\s+/g, ' ').trim()))

console.log('\n── 7. rascunho sobrevive a recarregar a página ──')
await page.waitForTimeout(1500) // deixa o salvamento no servidor acontecer
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.cartao', { timeout: 10000 })
linha('avisa que retomou', (await page.locator('.aviso.info').count()) ? 'sim' : 'não')
const nomeGuardado = await page.evaluate(() => JSON.parse(localStorage.getItem('bh_rascunho_inscricao') || '{}').nome)
linha('nome preservado', JSON.stringify(nomeGuardado))

console.log('\n── 8. revisão antes de enviar ──')
while ((await page.locator('.revisao').count()) === 0) {
  const antes = await page.textContent('.cartao h2')
  await page.click('button.principal')
  await page.waitForTimeout(500)
  if (antes === (await page.textContent('.cartao h2').catch(() => null))) break
}
linha('tela de revisão', (await page.locator('.revisao').count()) ? 'sim' : 'não')
const itens = await page.locator('.revisao .item').allTextContents()
linha('itens conferidos', JSON.stringify(itens.slice(0, 4)))

console.log('\n── 9. envio de verdade ──')
await page.click('button.principal')
await page.waitForSelector('.fim, .aviso.erro', { timeout: 15000 })
const deuCerto = await page.locator('.fim').count()
linha('resultado', deuCerto ? 'inscrição concluída' : 'ERRO: ' + (await page.textContent('.aviso.erro')))
if (deuCerto) linha('código na tela', JSON.stringify(await page.textContent('.fim .codigo')))

console.log('\n── 10. saúde da página ──')
linha('erros de console', errosDeConsole.length ? JSON.stringify(errosDeConsole.slice(0, 3)) : 'nenhum')
linha('rolagem horizontal', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 ? 'SIM (bug)' : 'não'))
await page.screenshot({ path: '/tmp/portal-fim.png' })

await browser.close()
