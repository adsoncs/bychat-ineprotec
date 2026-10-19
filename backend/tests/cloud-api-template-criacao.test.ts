// tests/cloud-api-template-criacao.test.ts
//
// Data de criação dos modelos da Cloud API (services/cloudApiTemplates.ts).
//
// A Meta não informa a criação, só a última edição. O `createdAt` local é
// quando o sistema viu o modelo — e para o que já existia ao conectar a conta,
// isso é a data da conexão, não a da criação. Mostrar essa data como "criado
// em" seria afirmar algo falso para o cliente.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criacaoDosModelos } from '../src/services/cloudApiTemplates.js'

const d = (s: string) => new Date(s)

test('primeiro lote da conta já existia: "antes de" a data mais antiga conhecida', () => {
  const r = criacaoDosModelos([
    { id: 1, wabaId: 'A', createdAt: d('2026-09-01T22:44:17.126Z'), metaUpdatedAt: d('2026-08-20T12:31:02Z') },
    { id: 2, wabaId: 'A', createdAt: d('2026-09-01T22:44:17.379Z'), metaUpdatedAt: d('2026-09-10T10:00:00Z') },
  ])
  assert.deepEqual(r.get(1), { data: d('2026-08-20T12:31:02Z'), exata: false })
  // editado DEPOIS da conexão: a última edição não ajuda, mas segue "antes de"
  assert.deepEqual(r.get(2), { data: d('2026-09-01T22:44:17.379Z'), exata: false })
})

test('modelo criado depois da conexão tem data exata', () => {
  const r = criacaoDosModelos([
    { id: 1, wabaId: 'B', createdAt: d('2026-10-16T01:22:23Z'), metaUpdatedAt: d('2026-10-01T00:00:00Z') },
    { id: 2, wabaId: 'B', createdAt: d('2026-10-16T01:22:24Z'), metaUpdatedAt: d('2026-10-02T00:00:00Z') },
    { id: 3, wabaId: 'B', createdAt: d('2026-10-16T15:14:58Z'), metaUpdatedAt: d('2026-10-16T15:14:59Z') },
    // editado na Meta depois: continua valendo a data em que nasceu aqui
    { id: 4, wabaId: 'B', createdAt: d('2026-10-17T09:00:00Z'), metaUpdatedAt: d('2026-10-18T09:00:00Z') },
  ])
  assert.deepEqual(r.get(3), { data: d('2026-10-16T15:14:58Z'), exata: true })
  assert.deepEqual(r.get(4), { data: d('2026-10-17T09:00:00Z'), exata: true })
})

test('visto bem depois da última edição: já existia', () => {
  const r = criacaoDosModelos([
    { id: 1, wabaId: 'C', createdAt: d('2026-10-01T10:00:00Z'), metaUpdatedAt: d('2026-10-01T09:59:00Z') },
    { id: 2, wabaId: 'C', createdAt: d('2026-10-05T10:00:00Z'), metaUpdatedAt: d('2026-09-01T00:00:00Z') },
  ])
  assert.equal(r.get(1)!.exata, true) // primeiro lote de 1 só: era o primeiro modelo da conta
  assert.deepEqual(r.get(2), { data: d('2026-09-01T00:00:00Z'), exata: false })
})

test('sem última edição da Meta (ainda não sincronizado com o código novo)', () => {
  const r = criacaoDosModelos([{ id: 1, wabaId: 'D', createdAt: d('2026-10-10T00:00:00Z'), metaUpdatedAt: null }])
  assert.deepEqual(r.get(1), { data: d('2026-10-10T00:00:00Z'), exata: true })
})
