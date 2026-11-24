// tests/cadastro-nao-segura.test.ts
//
// Regra do usuário (24/11/2026): dado faltando no cadastro é só pendência.
// Quem pagou e assinou segue o fluxo (funil → Matrícula realizada, Ganho).
// Caso real: ineprotec INE-26-000019-9VMQ, pago + assinado, sem raça/cor e
// naturalidade, ficou preso em PRÉ-MATRICULADO.
//
//   cd backend && npx tsx --test --test-force-exit tests/cadastro-nao-segura.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etapasQueSeguram } from '../src/services/portalJornada.js'

const et = (chave: string, situacao: string, liberada = false) => ({ chave, situacao, liberada })

test('pagou e assinou com cadastro incompleto: só documentos segura', () => {
  const r = etapasQueSeguram([et('cadastro', 'pendente'), et('pagamento', 'feito'), et('contrato', 'feito'), et('documentos', 'pendente')])
  assert.deepEqual(r.map((e) => e.chave), ['documentos'])
})
test('tudo feito menos o cadastro: concluída', () => {
  assert.equal(etapasQueSeguram([et('cadastro', 'pendente'), et('pagamento', 'feito'), et('contrato', 'feito')]).length, 0)
})
test('inscrição que não andou: cadastro continua sendo a etapa atual', () => {
  const r = etapasQueSeguram([et('cadastro', 'pendente'), et('pagamento', 'pendente'), et('contrato', 'pendente')])
  assert.equal(r[0].chave, 'cadastro')
})
test('etapa liberada pela equipe conta como andada', () => {
  const r = etapasQueSeguram([et('cadastro', 'pendente'), et('pagamento', 'pendente', true), et('contrato', 'pendente')])
  assert.deepEqual(r.map((e) => e.chave), ['contrato'])
})
test('outras etapas pendentes continuam segurando', () => {
  const r = etapasQueSeguram([et('cadastro', 'feito'), et('pagamento', 'feito'), et('contrato', 'pendente'), et('documentos', 'pendente')])
  assert.deepEqual(r.map((e) => e.chave), ['contrato', 'documentos'])
})
