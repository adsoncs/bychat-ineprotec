// tests/fila-do-dia.test.ts
//
// Fila do dia da Inadimplência (24/11/2026): o trabalho de cobrança de um dia,
// em 4 listas — vence hoje, venceu há 1 a 3 dias (sem contato), prometeu pagar
// hoje e acordo com parcela vencida — e o filtro por unidade (empresa).
//
// ⚠️ TOCA O BANCO da demo. Tudo leva o prefixo `test:` e é apagado no fim.
// Nenhuma cobrança vai para gateway (títulos sem provider).
//
//   cd backend && node --import tsx --test --test-force-exit tests/fila-do-dia.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { filaDoDia } from '../src/services/inadimplencia.js'
import { hojeBr } from '../src/services/pagamentoCombinado.js'

const ids = { unidade: 0, portal: 0, leads: [] as number[], regs: [] as number[], acordo: 0 }
const L: Record<string, number> = {}
let carimbo = ''
const dia = (delta: number) => new Date(Date.parse(`${hojeBr()}T12:00:00-03:00`) + delta * 86_400_000).toISOString().slice(0, 10)

async function pessoa(nome: string, titulos: Array<{ venc: number; acordo?: boolean }>) {
  const lead = await prisma.lead.create({ data: { nome: `test:${nome} ${carimbo}`, empresa: 'test:fila', whatsapp: '', email: `${nome}.${carimbo}@local.invalid`, formData: {}, scores: {} } })
  ids.leads.push(lead.id); L[nome] = lead.id
  const reg = await prisma.enrollmentRegistration.create({ data: { portalId: ids.portal, leadId: lead.id, candidateCode: `TFD-${nome}-${carimbo}`.slice(0, 30), status: 'paid', paymentStatus: 'paid', formData: { nome } } })
  ids.regs.push(reg.id)
  let acordoId: number | null = null
  if (titulos.some((t) => t.acordo)) {
    acordoId = (await prisma.enrollmentAcordo.create({ data: { registrationId: reg.id, leadId: lead.id, valorOriginalCentavos: 10000, valorTotalCentavos: 10000, numParcelas: 1, itens: [] } })).id
    ids.acordo = acordoId
  }
  let ordem = 1
  for (const t of titulos) {
    await prisma.enrollmentTitulo.create({ data: { registrationId: reg.id, origem: t.acordo ? 'acordo' : 'combinado', acordoId: t.acordo ? acordoId : null, ordem: ordem++, meio: 'boleto', valorCentavos: 10000, vencimento: dia(t.venc), status: 'aberta' } })
  }
  return lead.id
}

before(async () => {
  carimbo = String(Date.now()).slice(-6)
  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade fila ${carimbo}` } })
  ids.unidade = unidade.id
  ids.portal = (await prisma.enrollmentPortal.create({ data: { nome: `test:portal fila ${carimbo}`, slug: `test-fila-${carimbo}`, unitId: unidade.id, active: true, requirePayment: true, selectionProcessIds: [], formConfig: {} } })).id
  await pessoa('Hoje', [{ venc: 0 }])
  await pessoa('HojeFeito', [{ venc: 0 }])
  await pessoa('Recente', [{ venc: -2 }])
  await pessoa('RecenteProcurado', [{ venc: -2 }])
  await pessoa('Antigo', [{ venc: -20 }])
  await pessoa('Promessa', [{ venc: -10 }])
  await pessoa('Acordo', [{ venc: -5, acordo: true }])
  // Contato hoje: HojeFeito vai para o fim ("feito"); RecenteProcurado sai do 1º contato.
  await prisma.cobrancaContato.createMany({ data: [
    { leadId: L.HojeFeito!, canal: 'whatsapp', resultado: 'recado' },
    { leadId: L.RecenteProcurado!, canal: 'whatsapp', resultado: 'sem_resposta' },
    { leadId: L.Promessa!, canal: 'telefone', resultado: 'promessa_pagamento', promessaPara: hojeBr(), createdAt: new Date(Date.now() - 2 * 86_400_000) },
  ] })
})

after(async () => {
  const t = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e: any) { console.warn('[limpeza]', e?.message || e) } }
  await t(() => prisma.cobrancaContato.deleteMany({ where: { leadId: { in: ids.leads } } }))
  await t(() => prisma.enrollmentTitulo.deleteMany({ where: { registrationId: { in: ids.regs } } }))
  await t(() => prisma.enrollmentAcordo.deleteMany({ where: { registrationId: { in: ids.regs } } }))
  await t(() => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: ids.regs } } }))
  await t(() => prisma.leadEvent.deleteMany({ where: { leadId: { in: ids.leads } } }))
  await t(() => prisma.lead.deleteMany({ where: { id: { in: ids.leads } } }))
  await t(() => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await t(() => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('fila do dia', () => {
  const lista = async (id: string, unitId: number | null = ids.unidade) => {
    const f = await filaDoDia(unitId)
    return f.listas.find((l) => l.id === id)!.itens.filter((x) => ids.leads.includes(x.leadId))
  }
  test('vence hoje: os dois, quem já teve contato hoje no fim e marcado', async () => {
    const l = await lista('vence_hoje')
    assert.deepEqual(l.map((x) => x.leadId), [L.Hoje, L.HojeFeito])
    assert.equal(l[1]!.feitoHoje, true)
    assert.equal(l[0]!.feitoHoje, false)
  })
  test('venceu há 1 a 3 dias: só quem ainda não foi procurado', async () => {
    assert.deepEqual((await lista('venceu_recente')).map((x) => x.leadId), [L.Recente])
  })
  test('prometeu pagar hoje', async () => {
    assert.deepEqual((await lista('promessa_hoje')).map((x) => x.leadId), [L.Promessa])
  })
  test('acordo com parcela vencida (e o acordo não entra no 1º contato)', async () => {
    assert.deepEqual((await lista('acordo_atrasado')).map((x) => x.leadId), [L.Acordo])
    assert.ok(!(await lista('venceu_recente')).some((x) => x.leadId === L.Acordo))
  })
  test('atraso antigo sem promessa nem acordo não entra em nenhuma lista', async () => {
    const f = await filaDoDia(ids.unidade)
    assert.ok(!f.listas.some((l) => l.itens.some((x) => x.leadId === L.Antigo)))
  })
  test('filtro de unidade: outra unidade não vê ninguém daqui', async () => {
    const outra = await prisma.educationalUnit.findFirst({ where: { id: { not: ids.unidade } }, select: { id: true } })
    const f = await filaDoDia(outra!.id)
    assert.ok(!f.listas.some((l) => l.itens.some((x) => ids.leads.includes(x.leadId))))
    assert.equal((await lista('vence_hoje', null)).length, 2, 'em "Todas" aparecem')
  })
})
