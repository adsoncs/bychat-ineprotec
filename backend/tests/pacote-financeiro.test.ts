// tests/pacote-financeiro.test.ts
//
// Pacote (combo) no Financeiro (24/11/2026): a 1ª cobrança paga UMA vez, na
// principal, não pode contar de novo no curso de dentro do pacote. Caso real:
// Samara (ineprotec) — R$ 215,80 apareciam como R$ 315,80. As parcelas próprias
// do curso de dentro do pacote seguem contando.
//
// ⚠️ TOCA O BANCO da demo e fala com o servidor dela. Tudo leva `test:` e é
// apagado no fim. Nenhuma cobrança vai para gateway.
//
//   cd backend && node --import tsx --test --test-force-exit tests/pacote-financeiro.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { BASE, token } from './apoio.js'

const ids = { unidade: 0, portal: 0, lead: 0, pri: 0, mem: 0 }
let c = ''

before(async () => {
  c = String(Date.now()).slice(-7)
  ids.unidade = (await prisma.educationalUnit.create({ data: { nome: `test:unidade pac ${c}` } })).id
  ids.portal = (await prisma.enrollmentPortal.create({ data: { nome: `test:portal pac ${c}`, slug: `test-pac-${c}`, unitId: ids.unidade, active: true, requirePayment: true, selectionProcessIds: [], formConfig: {} } })).id
  ids.lead = (await prisma.lead.create({ data: { nome: `test:Pacote ${c}`, empresa: 'test:pac', whatsapp: '', email: `pac.${c}@local.invalid`, formData: {}, scores: {} } })).id
  const pago = new Date(Date.now() - 86_400_000)
  ids.pri = (await prisma.enrollmentRegistration.create({ data: { portalId: ids.portal, leadId: ids.lead, candidateCode: `TPC-PRI-${c}`, status: 'paid', paymentStatus: 'paid', paymentMethod: 'PIX', paymentAmount: 215.8, paymentPaidAt: pago, formData: {}, paymentPlan: { meio: 'boleto', parcelas: 12, valorParcela: 144.9, valorCobrado: 215.8 } } })).id
  ids.mem = (await prisma.enrollmentRegistration.create({ data: { portalId: ids.portal, leadId: ids.lead, candidateCode: `TPC-MEM-${c}`, status: 'paid', paymentStatus: 'paid', paymentMethod: 'PACOTE', paymentAmount: null, paymentPaidAt: pago, formData: {},
    paymentPlan: { meio: 'boleto', parcelas: 12, valorParcela: 129.9, valorCobrado: 99.9, pacote: { papel: 'membro', principalId: 0, principalCodigo: `TPC-PRI-${c}`, principalCurso: 'Curso A', valorCentavos: 9990, em: pago.toISOString(), por: 'teste' },
      parcelasPortal: { '2': { id: `pay_tpc2${c}`, vencimento: '2026-12-10', valor: 129.9, em: pago.toISOString(), situacao: 'paga', pagaEm: pago.toISOString().slice(0, 10) } } } } })).id
  await prisma.enrollmentRegistration.update({ where: { id: ids.pri }, data: { paymentPlan: { meio: 'boleto', parcelas: 12, valorParcela: 144.9, valorCobrado: 215.8, pacote: { papel: 'principal', valorProprioCentavos: 11590, membros: [{ id: ids.mem, codigo: `TPC-MEM-${c}`, curso: 'Curso B', valorCentavos: 9990 }], em: pago.toISOString(), por: 'teste' } } as any } })
})

after(async () => {
  const t = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e: any) { console.warn('[limpeza]', e?.message || e) } }
  await t(() => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: [ids.pri, ids.mem] } } }))
  await t(() => prisma.leadEvent.deleteMany({ where: { leadId: ids.lead } }))
  await t(() => prisma.lead.deleteMany({ where: { id: ids.lead } }))
  await t(() => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await t(() => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('pacote no Financeiro', () => {
  test('a 1ª cobrança conta uma vez só; a parcela própria do membro conta', async () => {
    const r = await fetch(`${BASE}/admin/educational/portal-financeiro?search=TPC-&portalId=${ids.portal}&de=2020-01-01&ate=2030-12-31&limit=10`, { headers: { Authorization: `Bearer ${token('superadmin')}` } })
    const j = await r.json() as any
    assert.equal(r.status, 200, JSON.stringify(j))
    const pri = j.items.find((l: any) => l.id === ids.pri)
    const mem = j.items.find((l: any) => l.id === ids.mem)
    assert.equal(pri.recebidoTotal, 215.8)
    assert.equal(mem.recebidoTotal, 129.9, 'só a parcela 2 própria; a 1ª já está na principal')
    assert.equal(mem.valorCobrado, null)
    assert.equal(Math.round((pri.recebidoTotal + mem.recebidoTotal) * 100) / 100, 345.7)
  })
})
