import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numeroDiferente } from '../src/lib/prisma.js'

test('duplicata de outro número não desvia para a principal', () => {
  assert.equal(numeroDiferente({ instanceName: 'beyond-main', cloudApiConnectionId: null }, { instanceName: null, cloudApiConnectionId: 1 }), true)
  assert.equal(numeroDiferente({ instanceName: 'a', cloudApiConnectionId: null }, { instanceName: 'b', cloudApiConnectionId: null }), true)
  assert.equal(numeroDiferente({ instanceName: null, cloudApiConnectionId: 1 }, { instanceName: null, cloudApiConnectionId: 2 }), true)
})

test('mesmo número, ou ficha sem número, continua desviando', () => {
  assert.equal(numeroDiferente({ instanceName: 'a', cloudApiConnectionId: null }, { instanceName: 'a', cloudApiConnectionId: null }), false)
  assert.equal(numeroDiferente({ instanceName: null, cloudApiConnectionId: null }, { instanceName: 'a', cloudApiConnectionId: null }), false)
  assert.equal(numeroDiferente({ instanceName: null, cloudApiConnectionId: 3 }, { instanceName: null, cloudApiConnectionId: null }), false)
})
