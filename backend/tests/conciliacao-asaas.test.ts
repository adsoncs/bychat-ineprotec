// tests/conciliacao-asaas.test.ts
//
// Conciliação por conta do Asaas (24/11/2026): cada pagamento recebido no Asaas
// é casado com o sistema — conciliado, aberto no sistema (aviso perdido) ou sem
// vínculo. Pagamentos do Asaas aqui são objetos simulados: nada vai à API.
//
// ⚠️ TOCA O BANCO da demo. Tudo leva o prefixo `test:` e é apagado no fim.
//
//   cd backend && node --import tsx --test --test-force-exit tests/conciliacao-asaas.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { noSistema } from '../src/services/conciliacaoAsaas.js'

const ids = { unidade: 0, portal: 0, lead: 0, regPaga: 0, regAberta: 0, regParcela: 0 }
let c = ''

before(async () => {
  c = String(Date.now()).slice(-7)
  ids.unidade = (await prisma.educationalUnit.create({ data: { nome: `test:unidade conc ${c}` } })).id
  ids.portal = (await prisma.enrollmentPortal.create({ data: { nome: `test:portal conc ${c}`, slug: `test-conc-${c}`, unitId: ids.unidade, active: true, requirePayment: true, selectionProcessIds: [], formConfig: {} } })).id
  ids.lead = (await prisma.lead.create({ data: { nome: `test:Conc ${c}`, empresa: 'test:conc', whatsapp: '', email: `conc.${c}@local.invalid`, formData: {}, scores: {} } })).id
  const reg = (code: string, extra: any = {}) => prisma.enrollmentRegistration.create({ data: { portalId: ids.portal, leadId: ids.lead, candidateCode: `TCC-${code}-${c}`, status: 'pending', formData: {}, ...extra } })
  ids.regPaga = (await reg('PAGA', { status: 'paid', paymentStatus: 'paid', paymentId: `pay_tpaga${c}` })).id
  await prisma.enrollmentPaymentMethod.create({ data: { registrationId: ids.regPaga, method: 'pix', provider: 'asaas', amount: 100, status: 'paid', externalId: `pay_tpaga${c}` } })
  ids.regAberta = (await reg('ABERTA')).id
  await prisma.enrollmentPaymentMethod.create({ data: { registrationId: ids.regAberta, method: 'pix', provider: 'asaas', amount: 100, status: 'pending', externalId: `pay_taberta${c}` } })
  await prisma.enrollmentTitulo.create({ data: { registrationId: ids.regAberta, ordem: 2, meio: 'boleto', valorCentavos: 5000, vencimento: '2026-11-10', status: 'aberta', externalId: `pay_ttitulo${c}` } })
  ids.regParcela = (await reg('PARC', { status: 'paid', paymentStatus: 'paid', paymentPlan: { parcelasPortal: { '2': { id: `pay_tparc${c}`, situacao: 'paga' }, '3': { id: `pay_tparc3${c}` } } } })).id
})

after(async () => {
  const regs = [ids.regPaga, ids.regAberta, ids.regParcela]
  const t = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e: any) { console.warn('[limpeza]', e?.message || e) } }
  await t(() => prisma.enrollmentTitulo.deleteMany({ where: { registrationId: { in: regs } } }))
  await t(() => prisma.enrollmentPaymentMethod.deleteMany({ where: { registrationId: { in: regs } } }))
  await t(() => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: regs } } }))
  await t(() => prisma.leadEvent.deleteMany({ where: { leadId: ids.lead } }))
  await t(() => prisma.lead.deleteMany({ where: { id: ids.lead } }))
  await t(() => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await t(() => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('conciliação: o que o sistema sabe do pagamento', () => {
  test('1ª cobrança paga no sistema = conciliado', async () => {
    assert.equal((await noSistema({ id: `pay_tpaga${c}`, externalReference: `enrollment-${ids.regPaga}` })).situacao, 'conciliado')
  })
  test('Asaas recebeu mas o sistema ainda mostra em aberto', async () => {
    const r = await noSistema({ id: `pay_taberta${c}`, externalReference: `enrollment-${ids.regAberta}` })
    assert.equal(r.situacao, 'aberto_no_sistema')
    assert.equal(r.registrationId, ids.regAberta)
  })
  test('título do combinado em aberto', async () => {
    assert.equal((await noSistema({ id: `pay_ttitulo${c}`, externalReference: 'titulo-0' })).situacao, 'aberto_no_sistema')
  })
  test('parcela do Meu Portal paga e em aberto', async () => {
    assert.equal((await noSistema({ id: `pay_tparc${c}`, externalReference: `portal-parcela:${ids.regParcela}:2` })).situacao, 'conciliado')
    assert.equal((await noSistema({ id: `pay_tparc3${c}`, externalReference: `portal-parcela:${ids.regParcela}:3` })).situacao, 'aberto_no_sistema')
  })
  test('referência enrollment-<id> sem a cobrança registrada nem o código na descrição = sem vínculo', async () => {
    const r = await noSistema({ id: `pay_outra${c}`, externalReference: `enrollment-${ids.regAberta}`, description: 'Curso de outra base (INE-26-000031-GJG)' })
    assert.equal(r.situacao, 'sem_vinculo')
  })
  test('mesma referência com o código da inscrição na descrição = vale', async () => {
    const r = await noSistema({ id: `pay_outra2${c}`, externalReference: `enrollment-${ids.regAberta}`, description: `Curso (TCC-ABERTA-${c})` })
    assert.equal(r.situacao, 'aberto_no_sistema')
  })
  test('cobrança criada fora do sistema = sem vínculo', async () => {
    assert.equal((await noSistema({ id: `pay_fora${c}`, externalReference: null })).situacao, 'sem_vinculo')
  })
})
