// tests/importacao-por-linha.test.ts
//
// "Sincronizar do celular" tem de respeitar a LINHA: o mesmo telefone tem uma
// conversa em cada linha da empresa. Casando só pelo telefone, a importação da
// linha A despejava o histórico na conversa da linha B (kobogo: 8.444
// mensagens em 29 conversas erradas).
//
// Puro: exercita o desempate que a listagem usa.
//
//   cd backend && node --import tsx --test --test-force-exit tests/importacao-por-linha.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadPorTelefoneDaLinha } from '../src/services/whatsappChatImport.js'

test('prefere a conversa desta linha à sem linha', () => {
  const m = leadPorTelefoneDaLinha([
    { id: 1, phoneKey: '5562999', instanceName: null },
    { id: 2, phoneKey: '5562999', instanceName: 'linha_a' },
  ], 'linha_a')
  assert.equal(m.get('5562999')?.id, 2)
})

test('ordem inversa dá o mesmo resultado', () => {
  const m = leadPorTelefoneDaLinha([
    { id: 2, phoneKey: '5562999', instanceName: 'linha_a' },
    { id: 1, phoneKey: '5562999', instanceName: null },
  ], 'linha_a')
  assert.equal(m.get('5562999')?.id, 2)
})

test('sem conversa desta linha, usa a sem linha', () => {
  const m = leadPorTelefoneDaLinha([{ id: 1, phoneKey: '5562999', instanceName: null }], 'linha_a')
  assert.equal(m.get('5562999')?.id, 1)
})
