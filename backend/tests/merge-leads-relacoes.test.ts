// tests/merge-leads-relacoes.test.ts
//
// Mesclar dois leads não pode apagar nada do lead absorvido.
//
// mergeLeads apaga o secundário no fim, e as relações com onDelete: Cascade
// iam junto: antes só mensagens, eventos e atividades eram movidos — notas,
// etiquetas, inscrição no processo seletivo, conta do portal e até o ALUNO do
// secundário sumiam, e a inscrição do portal ficava sem lead. O que se prova:
// tudo passa para o principal, conflitos de unicidade se resolvem sem perder o
// que importa, e dois alunos barram a mesclagem.
//
// ⚠️ TOCA O BANCO da demo. Tudo leva o prefixo `test:` e é apagado no fim.
//
//   cd backend && node --import tsx --test --test-force-exit tests/merge-leads-relacoes.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { mergeLeads } from '../src/services/dedup.js'

const ids = {
  keep: 0, merge: 0, extra1: 0, extra2: 0, tagComum: 0, tagSo: 0, unidade: 0, processo: 0, portal: 0,
  ofertaComum: 0, ofertaSo: 0, prKeep: 0, prMergeComum: 0, prMergeSo: 0, regMerge: 0, alunos: [] as number[],
}
let carimbo = ''

async function lead(nome: string) {
  return (await prisma.lead.create({ data: { nome: `test:${nome} ${carimbo}`, empresa: 'test:merge', whatsapp: '', email: '', formData: {}, scores: {} } })).id
}

before(async () => {
  carimbo = String(Date.now()).slice(-7)
  ids.keep = await lead('Principal')
  ids.merge = await lead('Secundário')
  ids.tagComum = (await prisma.tag.create({ data: { name: `test:comum ${carimbo}`, color: '#000' } })).id
  ids.tagSo = (await prisma.tag.create({ data: { name: `test:so ${carimbo}`, color: '#000' } })).id
  await prisma.leadTag.createMany({ data: [
    { leadId: ids.keep, tagId: ids.tagComum },
    { leadId: ids.merge, tagId: ids.tagComum },
    { leadId: ids.merge, tagId: ids.tagSo },
  ] })
  await prisma.leadNote.create({ data: { leadId: ids.merge, content: 'test:nota do secundário' } })

  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade merge ${carimbo}` } })
  ids.unidade = unidade.id
  ids.processo = (await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo merge ${carimbo}` } })).id
  const curso = await prisma.course.findFirst({ select: { id: true } })
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  const base = { courseId: curso!.id, unitId: unidade.id, modalityId: modalidade!.id, selectionProcessId: ids.processo }
  ids.ofertaComum = (await prisma.courseOffering.create({ data: { ...base, nome: `test:oferta comum ${carimbo}` } })).id
  ids.ofertaSo = (await prisma.courseOffering.create({ data: { ...base, nome: `test:oferta só ${carimbo}` } })).id
  ids.prKeep = (await prisma.processRegistration.create({ data: { leadId: ids.keep, offeringId: ids.ofertaComum, selectionProcessId: ids.processo } })).id
  ids.prMergeComum = (await prisma.processRegistration.create({ data: { leadId: ids.merge, offeringId: ids.ofertaComum, selectionProcessId: ids.processo } })).id
  ids.prMergeSo = (await prisma.processRegistration.create({ data: { leadId: ids.merge, offeringId: ids.ofertaSo, selectionProcessId: ids.processo } })).id
  ids.portal = (await prisma.enrollmentPortal.create({ data: { nome: `test:portal merge ${carimbo}`, slug: `test-merge-${carimbo}`, unitId: unidade.id, selectionProcessIds: [ids.processo], formConfig: {} } })).id
  ids.regMerge = (await prisma.enrollmentRegistration.create({ data: { portalId: ids.portal, leadId: ids.merge, candidateCode: `TMG-${carimbo}`, processRegistrationId: ids.prMergeComum, formData: {} } })).id
  await prisma.portalAccount.create({ data: { leadId: ids.merge, senhaHash: 'test:hash' } })
  ids.alunos.push((await prisma.aluno.create({ data: { leadId: ids.merge, cpf: `55${carimbo}0`, ra: `tm${carimbo}`, ativo: true } })).id)
})

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  const leads = [ids.keep, ids.merge, ids.extra1, ids.extra2].filter(Boolean)
  await tentar('inscrições', () => prisma.enrollmentRegistration.deleteMany({ where: { candidateCode: { startsWith: 'TMG-' } } }))
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await tentar('alunos', () => prisma.aluno.deleteMany({ where: { id: { in: ids.alunos } } }))
  await tentar('contas', () => prisma.portalAccount.deleteMany({ where: { leadId: { in: leads } } }))
  await tentar('inscr. processo', () => prisma.processRegistration.deleteMany({ where: { selectionProcessId: ids.processo } }))
  await tentar('ofertas', () => prisma.courseOffering.deleteMany({ where: { id: { in: [ids.ofertaComum, ids.ofertaSo] } } }))
  await tentar('processo', () => prisma.selectionProcess.deleteMany({ where: { id: ids.processo } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await tentar('leads', () => prisma.lead.deleteMany({ where: { id: { in: leads } } }))
  await tentar('tags', () => prisma.tag.deleteMany({ where: { id: { in: [ids.tagComum, ids.tagSo] } } }))
  await prisma.$disconnect()
})

describe('mesclar não apaga o que era do secundário', () => {
  test('tudo passa para o principal', async () => {
    await mergeLeads({ keepId: ids.keep, mergeId: ids.merge })
    assert.equal(await prisma.lead.count({ where: { id: ids.merge } }), 0, 'o secundário é absorvido')

    // Inscrição do portal: não fica sem lead, e aponta para a inscrição no
    // processo do principal (mesmo curso).
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.regMerge } })
    assert.equal(reg!.leadId, ids.keep)
    assert.equal(reg!.processRegistrationId, ids.prKeep)

    // Curso que só o secundário tinha: continua existindo, agora no principal.
    const so = await prisma.processRegistration.findUnique({ where: { id: ids.prMergeSo } })
    assert.equal(so?.leadId, ids.keep)

    assert.equal((await prisma.aluno.findUnique({ where: { id: ids.alunos[0] } }))?.leadId, ids.keep, 'aluno preservado')
    assert.equal((await prisma.portalAccount.findUnique({ where: { leadId: ids.keep } }))?.senhaHash, 'test:hash', 'conta do portal preservada')
    assert.equal(await prisma.leadNote.count({ where: { leadId: ids.keep, content: 'test:nota do secundário' } }), 1, 'nota preservada')
    const tags = (await prisma.leadTag.findMany({ where: { leadId: ids.keep } })).map((t) => t.tagId).sort()
    assert.deepEqual(tags, [ids.tagComum, ids.tagSo].sort(), 'etiquetas unidas, sem repetir')
  })

  test('dois alunos barram a mesclagem, e nada muda', async () => {
    ids.extra1 = await lead('Aluno A')
    ids.extra2 = await lead('Aluno B')
    ids.alunos.push((await prisma.aluno.create({ data: { leadId: ids.extra1, cpf: `66${carimbo}1`, ra: `ta${carimbo}`, ativo: true } })).id)
    ids.alunos.push((await prisma.aluno.create({ data: { leadId: ids.extra2, cpf: `66${carimbo}2`, ra: `tb${carimbo}`, ativo: true } })).id)
    await assert.rejects(() => mergeLeads({ keepId: ids.extra1, mergeId: ids.extra2 }), /Unifique os alunos no ERP/)
    assert.equal(await prisma.lead.count({ where: { id: ids.extra2 } }), 1)
  })
})
