import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

// Duas suítes convivem aqui: parte dos testes usa o vitest e parte usa o runner
// nativo do Node (`node:test`). O vitest não sabe executar os do Node — ele
// carrega o arquivo, não encontra suíte nenhuma e marca "No test suite found",
// que aparece como falha.
//
// A lista de exclusão era escrita à mão e envelheceu: nomeava um arquivo quando
// já havia catorze. Um relatório com 13 falhas que não são falhas é pior do que
// não ter relatório — ninguém consegue distinguir o vermelho real do ruído.
//
// Agora a divisão é lida do próprio código: quem importa `node:test` sai do
// vitest. `npm test` roda os dois runners e só fica verde se ambos passarem.
function testesDoRunnerNativo(): string[] {
  const dir = join(process.cwd(), 'tests')
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => /from ['"]node:test['"]/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => `tests/${f}`)
  } catch {
    return []
  }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', ...testesDoRunnerNativo()],
    // Os testes batem numa instalação real e compartilham o mesmo banco:
    // rodar arquivos em paralelo faria um apagar o dado do outro.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
})
