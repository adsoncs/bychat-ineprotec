// tests/iugu-estorno-parcial.test.ts
//
// Estorno parcial na iugu (services/paymentIugu.ts + paymentSync.ts).
//
// O defeito que motivou (fabad, MAT-26-000009, 19/10): R$ 39,10 de R$ 99,00
// estornados no painel da iugu; o status `partially_refunded` não estava no
// mapa, caía no padrão 'pending' e a inscrição paga voltou a "aguardando".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusIugu, normalizarFatura } from '../src/services/paymentIugu.js'
import { cobrancaDaFaturaIugu } from '../src/services/paymentSync.js'

test('estorno parcial continua pago; total continua estornado', () => {
  assert.equal(statusIugu('partially_refunded'), 'paid')
  assert.equal(statusIugu('refunded'), 'refunded')
})

test('a cobrança normalizada traz o que ficou pago e o que voltou', () => {
  const f = normalizarFatura({
    id: 'ABC', status: 'partially_refunded', total_cents: 9900, paid_cents: 5990, refunded_cents: 3910,
    paid_at: '2026-10-16T12:32:42-03:00', payment_method: 'iugu_credit_card', external_reference: 'enrollment-122',
  })
  const c = cobrancaDaFaturaIugu(f)
  assert.equal(c.status, 'paid')
  assert.equal(c.amount, 59.9)
  assert.equal(c.refunded, 39.1)
  assert.equal(c.billingType, 'CREDIT_CARD')
  assert.equal(c.enrollmentRefId, 122)
})
