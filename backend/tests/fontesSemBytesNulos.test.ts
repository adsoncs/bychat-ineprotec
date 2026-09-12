// tests/fontesSemBytesNulos.test.ts
//
// Nenhum arquivo de código pode ter byte NUL cru.
//
// O `server.ts` teve quatro deles por semanas — um marcador sentinela
// `NUL + AMP + NUL` escrito como byte literal em vez de escapado. Não quebrava
// nada em produção, mas fazia o `file` classificar o arquivo como binário e o
// `grep` se recusar a lê-lo sem `-a`: buscar qualquer coisa no arquivo mais
// central do backend devolvia "binary file matches" e nada mais.
//
// O risco maior era silencioso: um editor que normalize o arquivo remove os NUL
// sem avisar, e o marcador passa a sobreviver ao texto final como "AMP" no meio
// do conteúdo do cliente. Nenhum teste de comportamento pegaria isso, porque o
// código continua válido.
//
// Escapado (\u0000) o caractere é o mesmo em tempo de execução; muda só o
// que está gravado no arquivo.
//
//   cd backend && npx tsx --test tests/fontesSemBytesNulos.test.ts

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = new URL('../src', import.meta.url).pathname
const EXTENSOES = ['.ts', '.tsx', '.js', '.mjs', '.json']

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      if (nome === 'node_modules' || nome === 'generated') continue
      achados.push(...arquivosDeCodigo(caminho))
    } else if (EXTENSOES.some((e) => nome.endsWith(e))) {
      achados.push(caminho)
    }
  }
  return achados
}

describe('bytes NUL no código-fonte', () => {
  test('nenhum arquivo de src/ tem byte NUL cru', () => {
    const sujos: string[] = []
    for (const f of arquivosDeCodigo(RAIZ)) {
      const buf = readFileSync(f)
      const n = buf.filter((b) => b === 0).length
      if (n > 0) sujos.push(`${f.replace(RAIZ, 'src')} (${n})`)
    }
    assert.deepEqual(sujos, [],
      'byte NUL cru: use a forma escapada — o arquivo vira binário para grep/diff e o byte some se um editor normalizar')
  })

  test('a varredura realmente enxerga os arquivos', () => {
    // Sem isto, um erro de caminho tornaria o teste acima verde para sempre.
    const todos = arquivosDeCodigo(RAIZ)
    assert.ok(todos.length > 50, `só ${todos.length} arquivos varridos — caminho errado?`)
    assert.ok(todos.some((f) => f.endsWith('server.ts')), 'server.ts ficou de fora da varredura')
  })
})
