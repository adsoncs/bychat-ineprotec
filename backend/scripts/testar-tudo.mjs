// scripts/testar-tudo.mjs
//
// Roda as duas suítes — vitest e runner nativo do Node — e devolve um resumo
// único. É o que `npm test` chama.
//
// Existe porque metade dos testes usa `node:test` e a outra metade usa vitest.
// Antes era preciso lembrar de rodar seis comandos separados, e o relatório do
// vitest contava como falha os arquivos que ele nem sabe executar. Verde aqui
// quer dizer verde de verdade.
//
// Os testes tocam o banco real da instalação: rodam em série, nunca em paralelo.

import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const raiz = process.cwd()
const dirTestes = join(raiz, 'tests')

const nativos = readdirSync(dirTestes)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => /from ['"]node:test['"]/.test(readFileSync(join(dirTestes, f), 'utf8')))
  .sort()

const larg = 34
const linha = (a, b) => console.log(`  ${String(a).padEnd(larg)} ${b}`)
const resultados = []

function rodar(nome, cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: raiz })
  const saida = `${r.stdout || ''}${r.stderr || ''}`
  const passou = r.status === 0
  // Conta os testes para o resumo: cada runner relata de um jeito.
  const nativo = saida.match(/^# pass (\d+)/m)
  const vit = saida.match(/Tests\s+(\d+) passed/)
  const n = Number(nativo?.[1] ?? vit?.[1] ?? 0)
  resultados.push({ nome, passou, n, saida })
  linha(nome, passou ? `ok · ${n} teste(s)` : 'FALHOU')
  return passou
}

console.log('\n── vitest ──')
rodar('vitest', 'npx', ['vitest', 'run', '--reporter=dot'])

// `--test-force-exit` encerra o processo assim que o teste de topo termina, e
// leva junto subtests ainda em voo: `telefoneInternacional` reportava 28, 36 ou
// 44 dos seus 51 casos, sempre "verde". Um número que muda a cada execução do
// mesmo código é sinal de que a contagem não vale nada.
//
// Então a regra passou a ser: roda SEM a flag; se o arquivo não encerrar sozinho
// dentro do limite, é porque deixou conexão aberta — aí repete com a flag e o
// relatório diz qual arquivo foi, para o defeito não sumir de vista.
const LIMITE_MS = 240_000
const naoEncerramSozinhos = []

console.log('\n── runner nativo (node:test) ──')
for (const arquivo of nativos) {
  const nome = arquivo.replace('.test.ts', '')
  const base = ['--import', 'tsx', '--test', `tests/${arquivo}`]
  const primeira = spawnSync('node', base, { encoding: 'utf8', cwd: raiz, timeout: LIMITE_MS })
  if (primeira.error?.code === 'ETIMEDOUT' || primeira.signal) {
    naoEncerramSozinhos.push(nome)
    rodar(nome, 'node', ['--import', 'tsx', '--test', '--test-force-exit', `tests/${arquivo}`])
    continue
  }
  const saida = `${primeira.stdout || ''}${primeira.stderr || ''}`
  const n = Number(saida.match(/^# pass (\d+)/m)?.[1] ?? 0)
  resultados.push({ nome, passou: primeira.status === 0, n, saida })
  linha(nome, primeira.status === 0 ? `ok · ${n} teste(s)` : 'FALHOU')
}

const falhas = resultados.filter((r) => !r.passou)
const total = resultados.reduce((s, r) => s + r.n, 0)

console.log(`\n${'─'.repeat(52)}`)
if (naoEncerramSozinhos.length) {
  console.log(`⚠️  não encerram sozinhos (conexão aberta), rodados com --test-force-exit:`)
  console.log(`    ${naoEncerramSozinhos.join(', ')}`)
  console.log(`    A flag corta subtests em voo: a contagem destes pode estar abaixo do real.\n`)
}

if (falhas.length === 0) {
  console.log(`✅ tudo verde — ${total} testes em ${resultados.length} suíte(s).\n`)
  process.exit(0)
}

console.log(`❌ ${falhas.length} suíte(s) com falha (${total} testes passaram nas demais):\n`)
for (const f of falhas) {
  console.log(`── ${f.nome} ──`)
  // Só o que interessa: as linhas de falha, não o relatório inteiro.
  const trechos = f.saida
    .split('\n')
    .filter((l) => /^not ok|AssertionError|Error:|✗|FAIL|error TS/.test(l))
    .slice(0, 12)
  console.log(trechos.length ? trechos.join('\n') : f.saida.split('\n').slice(-15).join('\n'))
  console.log('')
}
process.exit(1)
