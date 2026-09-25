import { chromium } from '@playwright/test'
const B = 'http://127.0.0.1:3110'
const linha = (a, b) => console.log(`  ${String(a).padEnd(44)} ${b}`)
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
const p = await ctx.newPage()
const erros = []
p.on('pageerror', e => erros.push(String(e)))
p.on('response', r => r.status() >= 400 && erros.push(`${r.status()} ${r.url().replace(B,'')}`))

await p.goto(`${B}/portal/login`)
await p.fill('#id', '529.982.247-25'); await p.fill('#s', 'Estudar2026')
await p.click('button[type="submit"]'); await p.waitForLoadState('networkidle')

console.log('\n── lista de documentos ──')
await p.goto(`${B}/portal/documentos`, { waitUntil: 'networkidle' })
await p.waitForSelector('.doc', { timeout: 10000 })
linha('documentos listados', await p.locator('.doc').count())
linha('aviso do topo', JSON.stringify((await p.textContent('.aviso.info'))?.replace(/\s+/g,' ').trim().slice(0,70)))
linha('primeiro item', JSON.stringify(await p.textContent('.doc .doc-nome')))
linha('explica o porquê', JSON.stringify(await p.textContent('.doc .doc-ajuda')))
linha('marca opcional', (await p.locator('.opcional').count()) ? 'sim' : 'não')

console.log('\n── enviar pelo celular ──')
// Documento já enviado não mostra campo de arquivo. O teste rodava em cima do
// primeiro da lista e quebrava assim que aquele item passava a ter arquivo —
// falha do teste, não da tela. Pega o primeiro que ainda aceita envio.
const pendente = p.locator('.doc').filter({ has: p.locator('input[type=file]') }).first()
if (!(await pendente.count())) {
  linha('nenhum documento pendente', 'todos já enviados — nada a testar aqui')
  await b.close()
  process.exit(0)
}
const nomeEscolhido = (await pendente.locator('.doc-nome').textContent())?.trim()
linha('documento escolhido', JSON.stringify(nomeEscolhido))
await pendente.locator('input[type=file]').setInputFiles('/tmp/rg-frente.png')
await p.waitForTimeout(2500)
// Depois do envio o item perde o campo de arquivo, então o localizador filtrado
// por input deixa de casar: seguir pelo nome é o que continua valendo.
const enviado = p.locator('.doc').filter({ hasText: nomeEscolhido }).first()
linha('selo do documento enviado', JSON.stringify((await enviado.locator('.selo').textContent().catch(()=>null))?.trim()))
linha('arquivo aparece', JSON.stringify((await enviado.locator('.doc-arquivo-nome').textContent().catch(()=>null))?.trim()))
linha('aviso do topo agora', JSON.stringify((await p.textContent('.aviso.info'))?.replace(/\s+/g,' ').trim().slice(0,60)))

console.log('\n── recusa de arquivo inválido ──')
const outro = p.locator('.doc').filter({ has: p.locator('input[type=file]') }).first()
if (await outro.count()) {
  await outro.locator('input[type=file]').setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ fake') })
  await p.waitForTimeout(1500)
  linha('mensagem de recusa', JSON.stringify((await outro.locator('.aviso.erro').textContent().catch(()=>null))?.slice(0,80)))
} else {
  linha('mensagem de recusa', 'sem documento pendente para testar')
}

console.log('\n── recarregar mantém o enviado ──')
await p.reload({ waitUntil: 'networkidle' })
await p.waitForSelector('.doc')
linha('arquivo continua lá', JSON.stringify(await p.textContent('.doc-arquivo-nome').catch(()=>null)))
await p.screenshot({ path: '/tmp/docs.png', fullPage: true })
linha('erros de rede/console', erros.length ? JSON.stringify(erros.slice(0,3)) : 'nenhum')
await b.close()
