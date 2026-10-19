// tests/portal-redacao-etapa.test.ts
//
// Situação da etapa Redação no portal e no painel (services/portalJornada.ts).
//
// O defeito que motivou: com a nova tentativa liberada pela secretaria, a etapa
// continuava dizendo "Não aprovada" — o candidato não sabia que podia refazer.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etapaDaRedacao } from '../src/services/portalJornada.js'

test('reprovada com tentativa liberada avisa que pode refazer', () => {
  // processo com 1 tentativa + 1 liberada; só a reprovada foi usada
  assert.deepEqual(etapaDaRedacao(['rejected'], 2), { situacao: 'pendente', detalhe: 'Não aprovada — nova tentativa disponível' })
})

test('reprovada sem tentativa sobrando segue "Não aprovada"', () => {
  assert.deepEqual(etapaDaRedacao(['rejected'], 1), { situacao: 'pendente', detalhe: 'Não aprovada' })
  assert.deepEqual(etapaDaRedacao(['rejected', 'rejected'], 2), { situacao: 'pendente', detalhe: 'Não aprovada' })
})

test('rascunho não conta como tentativa usada', () => {
  // nova tentativa já começada: a mais nova é o rascunho
  assert.equal(etapaDaRedacao(['draft', 'rejected'], 2).detalhe, 'Em andamento')
  // rascunho velho não consome o limite
  assert.equal(etapaDaRedacao(['rejected', 'draft'], 2).detalhe, 'Não aprovada — nova tentativa disponível')
})

test('expirada: com tentativa sobrando falta fazer; sem, diz que esgotou', () => {
  assert.deepEqual(etapaDaRedacao(['expired'], 2), { situacao: 'pendente', detalhe: 'Falta fazer' })
  assert.deepEqual(etapaDaRedacao(['expired'], 1), { situacao: 'pendente', detalhe: 'Tempo esgotado, sem nova tentativa' })
})

test('estados que não mudaram', () => {
  assert.deepEqual(etapaDaRedacao([], 1), { situacao: 'pendente', detalhe: 'Falta fazer' })
  assert.deepEqual(etapaDaRedacao(['approved', 'rejected'], 2), { situacao: 'feito', detalhe: 'Aprovada' })
  for (const st of ['ai_reviewing', 'needs_human', 'submitted']) {
    assert.deepEqual(etapaDaRedacao([st], 1), { situacao: 'aguardando', detalhe: 'Enviada, em correção' })
  }
})
