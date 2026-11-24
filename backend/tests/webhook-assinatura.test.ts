// tests/webhook-assinatura.test.ts
//
// O aviso do provedor de assinatura precisa achar o envelope. Na ineprotec
// (24/11/2026) nenhum aviso da Autentique casava: o evento de assinatura
// (signature.*) traz o documento como TEXTO em `data.document` e o signatário
// em `public_id`, e o leitor só olhava `id`/`key`/`uuid`. O contrato assinado
// pelo link seguia "não assinado" até alguém sincronizar à mão.
//
// ⚠️ TOCA O BANCO. Cria um envelope com provider fictício (não chama API
// nenhuma) e apaga no fim, pela marca no título.
//
//   cd backend && npx tsx --test --test-force-exit tests/webhook-assinatura.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { processarWebhook } from '../src/services/acaAssinatura.js'

const MARCA = '[teste-automatizado webhook]'
const DOC = 'teste-doc-' + Date.now()
const SIG = 'teste-sig-' + Date.now()
let envelopeId = 0

describe('webhook de assinatura acha o envelope', () => {
  before(async () => {
    const env = await prisma.acaAssinatura.create({ data: {
      titulo: MARCA, provider: 'TESTE', documentoExternoId: DOC, status: 'ENVIADO' as any,
      signatarios: { create: [{ nome: 'Teste', publicId: SIG }] },
    } })
    envelopeId = env.id
  })
  after(async () => {
    await prisma.acaAssinatura.deleteMany({ where: { titulo: MARCA } })
  })

  test('evento de documento (data.id)', async () => {
    const r = await processarWebhook({ event: { type: 'document.finished', data: { object: 'document', id: DOC } } })
    assert.equal(r.envelopeId, envelopeId)
  })
  test('evento de assinatura com document em texto', async () => {
    const r = await processarWebhook({ id: 'evt-x', object: 'webhook', event: { id: 'e1', type: 'signature.accepted', data: { object: 'signature', document: DOC, public_id: 'outro' } } })
    assert.equal(r.envelopeId, envelopeId)
  })
  test('evento que só traz o public_id do signatário', async () => {
    const r = await processarWebhook({ event: { type: 'signature.viewed', data: { object: 'signature', public_id: SIG } } })
    assert.equal(r.envelopeId, envelopeId)
  })
  test('aviso de outro documento não casa', async () => {
    const r = await processarWebhook({ event: { type: 'signature.accepted', data: { document: 'nao-existe-' + Date.now() } } })
    assert.equal(r.envelopeId, undefined)
  })
})
