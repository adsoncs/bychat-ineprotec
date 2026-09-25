import { chromium } from '@playwright/test'
const B='http://127.0.0.1:3110', linha=(a,b)=>console.log(`  ${String(a).padEnd(44)} ${b}`)
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:1280,height:900}})).newPage()
const erros=[]
p.on('pageerror', e=>erros.push(String(e)))
p.on('response', r=>{ if(r.status()>=400 && !r.url().includes('favicon')) erros.push(`${r.status()} ${r.url().replace(B,'')}`) })

await p.goto(`${B}/app/login`, { waitUntil: 'networkidle' })
await p.fill('input[type="email"]', 'teste.tela@local.invalid')
await p.fill('input[type="password"]', 'TesteTela2026')
await p.click('button[type="submit"]')
await p.waitForTimeout(3500)
linha('após login', p.url().replace(B,''))

await p.goto(`${B}/app/aca/funil-matriculas`, { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
linha('título da página', JSON.stringify(await p.textContent('h1').catch(()=>null)))
const chips = await p.locator('button:has-text("Documentos"), button:has-text("Todas"), button:has-text("Contrato")').allTextContents()
linha('filtros de etapa', JSON.stringify(chips.slice(0,6)))
const linhas = await p.locator('.divide-y > div').count()
linha('inscrições listadas', linhas)
if (linhas) {
  linha('primeira linha', JSON.stringify((await p.locator('.divide-y > div').first().textContent())?.replace(/\s+/g,' ').trim().slice(0,110)))
}
// filtrar por etapa
const chipDocs = p.locator('button').filter({ hasText: /^Documentos/ }).first()
if (await chipDocs.count()) {
  await chipDocs.click(); await p.waitForTimeout(1800)
  linha('após filtrar Documentos', await p.locator('.divide-y > div').count())
}
// selecionar e ver o botão de lote aparecer
const chk = p.locator('input[type=checkbox]:not([disabled])').first()
if (await chk.count()) {
  await chk.check(); await p.waitForTimeout(800)
  linha('botão de lote aparece', JSON.stringify(await p.locator('button:has-text("Efetivar")').first().textContent().catch(()=>null)))
}
await p.screenshot({ path: '/tmp/funil.png', fullPage: false })
linha('erros', erros.length ? JSON.stringify(erros.slice(0,3)) : 'nenhum')
await b.close()
