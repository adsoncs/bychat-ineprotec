import { chromium } from '@playwright/test'
const B='http://127.0.0.1:3110', linha=(a,b)=>console.log(`  ${String(a).padEnd(44)} ${b}`)
const b=await chromium.launch()
const p=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:2})).newPage()
const erros=[]
p.on('pageerror', e=>erros.push(String(e)))
p.on('response', r=>r.status()>=400 && erros.push(`${r.status()} ${r.url().replace(B,'')}`))

await p.goto(`${B}/portal/login`)
await p.fill('#id','529.982.247-25'); await p.fill('#s','Estudar2026')
await p.click('button[type="submit"]'); await p.waitForLoadState('networkidle')

console.log('\n── painel do aluno ──')
await p.goto(`${B}/portal/aluno`, { waitUntil: 'networkidle' })
await p.waitForSelector('.passo', { timeout: 10000 })
linha('nome', JSON.stringify(await p.textContent('.cartao h2')))
linha('subtítulo', JSON.stringify(await p.textContent('.cartao .sub')))
linha('título do bloco de passos', JSON.stringify(await p.textContent('.cartao:nth-of-type(2) h2').catch(()=>null)))
console.log('  passos:')
for (const li of await p.locator('.passo').all()) {
  const cls = await li.getAttribute('class')
  const t = (await li.textContent())?.replace(/\s+/g,' ').trim()
  console.log(`     [${cls?.replace('passo ','')}] ${t}`)
}
console.log('\n── financeiro ──')
linha('parcelas na tela', await p.locator('.parcela').count())
linha('primeira parcela', JSON.stringify((await p.locator('.parcela').first().textContent())?.replace(/\s+/g,' ').trim().slice(0,70)))
linha('aviso de cobrança não gerada', (await p.locator('text=A cobrança desta parcela ainda não').count()) ? 'sim' : 'não')

console.log('\n── ações levam a algum lugar ──')
const href = await p.locator('.passo-acao').first().getAttribute('href')
linha('primeira ação aponta para', href)
await p.locator('.passo-acao').first().click()
await p.waitForLoadState('networkidle')
linha('destino', p.url().replace(B,''))

await p.goto(`${B}/portal/aluno`, { waitUntil: 'networkidle' })
await p.waitForSelector('.passo')
await p.screenshot({ path: '/tmp/aluno.png', fullPage: true })
linha('erros', erros.length ? JSON.stringify(erros.slice(0,3)) : 'nenhum')
linha('rolagem horizontal', await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1?'SIM':'não'))
await b.close()
