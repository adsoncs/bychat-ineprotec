// tests/uma-pessoa-uma-ficha.test.ts
//
// Regra do usuário (24/11/2026): combo, transferência ou matrícula em mais de
// um curso NUNCA duplicam a ficha. Casos reais na ineprotec: Carlos 42415/42416
// e Weslley 42794/42795 — o segundo curso abria uma ficha nova "ligada".
//
// ⚠️ TOCA O BANCO da demo e fala com o servidor dela. Tudo leva o prefixo
// `test:` e é apagado no fim. Portal sem cobrança: nada sai para gateway.
//
//   cd backend && node --import tsx --test --test-force-exit tests/uma-pessoa-uma-ficha.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { BASE } from './apoio.js'

const ids = { unidade: 0, processo: 0, ofertas: [] as number[], portal: 0, funil: 0 }
let carimbo = ''
let slug = ''
/** CPF válido a partir de 9 dígitos (dígitos verificadores calculados). */
function cpfValido(base9: string): string {
  const d = base9.split('').map(Number)
  for (const n of [9, 10]) {
    const soma = d.slice(0, n).reduce((s, x, i) => s + x * (n + 1 - i), 0)
    d.push(((soma * 10) % 11) % 10)
  }
  return d.join('')
}
const CPF = cpfValido(String(Date.now()).slice(-9))

async function enviar(formData: Record<string, unknown>) {
  const r = await fetch(`${BASE}/public/portals/${slug}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ formData: { lgpdConsent: true, ...formData } }),
  })
  const j = await r.json() as any
  assert.ok([200, 201].includes(r.status), JSON.stringify(j))
  return j as { leadId: number; candidateCode: string; enrollmentId: number }
}

before(async () => {
  carimbo = String(Date.now()).slice(-6)
  slug = `test-uma-ficha-${carimbo}`
  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade ficha ${carimbo}` } })
  ids.unidade = unidade.id
  ids.processo = (await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo ficha ${carimbo}` } })).id
  const cursos = await prisma.course.findMany({ select: { id: true }, take: 2, orderBy: { id: 'asc' } })
  assert.equal(cursos.length, 2, 'a demo precisa de 2 cursos')
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  for (const c of cursos) {
    ids.ofertas.push((await prisma.courseOffering.create({ data: { courseId: c.id, unitId: unidade.id, modalityId: modalidade!.id, selectionProcessId: ids.processo, nome: `test:oferta ${c.id} ${carimbo}` } })).id)
  }
  ids.portal = (await prisma.enrollmentPortal.create({
    data: { nome: `test:portal ficha ${carimbo}`, slug, unitId: unidade.id, active: true, requirePayment: false, selectionProcessIds: [ids.processo], formConfig: {} },
  })).id
})

after(async () => {
  const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId: ids.portal }, select: { id: true, leadId: true } }).catch(() => [])
  const leadIds = [...new Set(regs.map((r) => r.leadId).filter((x): x is number => !!x))]
  const t = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e: any) { console.warn('[limpeza]', e?.message || e) } }
  await t(() => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: regs.map((r) => r.id) } } }))
  await t(() => prisma.processRegistration.deleteMany({ where: { selectionProcessId: ids.processo } }))
  await t(() => prisma.portalAccount.deleteMany({ where: { leadId: { in: leadIds } } }))
  await t(() => prisma.leadEvent.deleteMany({ where: { leadId: { in: leadIds } } }))
  await t(() => prisma.lead.deleteMany({ where: { id: { in: leadIds } } }))
  await t(() => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await t(() => prisma.courseOffering.deleteMany({ where: { id: { in: ids.ofertas } } }))
  await t(() => prisma.selectionProcess.deleteMany({ where: { id: ids.processo } }))
  await t(() => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('uma pessoa, uma ficha', () => {
  test('segundo curso com o mesmo CPF fica na mesma ficha, sem mexer na etapa', async () => {
    const tel = `5562${carimbo}11`
    const a = await enviar({ nome: 'test:Pessoa Um', email: `p1.${carimbo}@local.invalid`, whatsapp: tel, cpf: CPF, offeringId: ids.ofertas[0] })
    // Primeiro curso pago e a ficha numa etapa adiantada.
    await prisma.enrollmentRegistration.update({ where: { id: a.enrollmentId }, data: { status: 'paid', paymentStatus: 'paid' } })
    await prisma.lead.update({ where: { id: a.leadId }, data: { status: 'test_etapa_adiantada' } })

    const b = await enviar({ nome: 'test:Pessoa Um', email: `p1.${carimbo}@local.invalid`, whatsapp: tel, cpf: CPF, offeringId: ids.ofertas[1] })
    assert.notEqual(b.candidateCode, a.candidateCode, 'é outra inscrição')
    assert.equal(b.leadId, a.leadId, 'mas a mesma ficha')
    const fichas = await prisma.lead.count({ where: { id: { in: [a.leadId, b.leadId] } } })
    assert.equal(fichas, 1)
    const lead = await prisma.lead.findUnique({ where: { id: a.leadId }, select: { status: true } })
    assert.equal(lead?.status, 'test_etapa_adiantada', 'a ficha não volta para a etapa de entrada')
    assert.equal(await prisma.portalAccount.count({ where: { leadId: a.leadId } }), 1, 'uma conta do portal')
  })

  test('mesmo celular com OUTRO CPF é outra pessoa: ficha própria', async () => {
    const tel = `5562${carimbo}22`
    const a = await enviar({ nome: 'test:Mae', email: `m.${carimbo}@local.invalid`, whatsapp: tel, cpf: cpfValido('3' + String(Date.now()).slice(-8)), offeringId: ids.ofertas[0] })
    const b = await enviar({ nome: 'test:Filho', email: `f.${carimbo}@local.invalid`, whatsapp: tel, cpf: cpfValido('4' + String(Date.now()).slice(-8)), offeringId: ids.ofertas[0] })
    assert.notEqual(b.leadId, a.leadId)
  })
})
