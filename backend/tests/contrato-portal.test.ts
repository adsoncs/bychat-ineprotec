// tests/contrato-portal.test.ts
//
// Fase 5 da consolidação ERP × Portal: o contrato é assinado no Portal e a
// assinatura efetiva a matrícula.
//
// O que se prova aqui é o que quebra silenciosamente: contrato invisível para
// quem precisa assinar, assinatura contada duas vezes, e assinatura que grava o
// aceite mas não efetiva a matrícula.
//
// ⚠️ TOCA O BANCO REAL. Tudo leva o prefixo `test:` e é apagado no fim.
//
//   cd backend && npm run test:contrato

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { contratoDoAluno, assinarPeloPortal } from '../src/services/portalContrato.js'
import { contratoAtivoDoAluno } from '../src/services/acaContrato.js'

let leadId = 0, alunoId = 0, periodoId = 0, turmaId = 0, matriculaId = 0, contratoId = 0

before(async () => {
  const carimbo = String(Date.now()).slice(-8)

  const lead = await prisma.lead.create({
    data: {
      nome: 'test:Maria Aparecida Silva', empresa: 'test:contrato',
      email: `test.contrato.${carimbo}@local.invalid`,
      whatsapp: `55629${carimbo}`, formData: {}, scores: {},
    },
  })
  leadId = lead.id
  const aluno = await prisma.aluno.create({ data: { leadId, cpf: `88${carimbo}`, ra: `t${carimbo}`, ativo: true } })
  alunoId = aluno.id

  const periodo = await prisma.acaPeriodoLetivo.create({
    data: { codigo: `t${carimbo}`.slice(0, 20), descricao: `test:período ${carimbo}`, anoLetivo: 2026 },
  })
  periodoId = periodo.id
  const turma = await prisma.acaTurma.create({
    data: { nome: `test:turma ${carimbo}`, periodoLetivoId: periodoId },
  })
  turmaId = turma.id

  // A matrícula nasce INSCRITO: é o estado de quem pagou e ainda não assinou.
  const mat = await prisma.acaMatricula.create({
    data: { alunoId, turmaId, status: 'INSCRITO', dataMatricula: new Date() },
  })
  matriculaId = mat.id

  const contrato = await prisma.acaContrato.create({
    data: { matriculaId, valorTotalCentavos: 120000, status: 'ATIVO' },
  })
  contratoId = contrato.id
})

after(async () => {
  await prisma.acaContrato.deleteMany({ where: { id: contratoId } })
  await prisma.acaMatricula.deleteMany({ where: { id: matriculaId } })
  await prisma.acaTurma.deleteMany({ where: { id: turmaId } })
  await prisma.acaPeriodoLetivo.deleteMany({ where: { id: periodoId } })
  await prisma.aluno.deleteMany({ where: { id: alunoId } })
  await prisma.lead.deleteMany({ where: { id: leadId } })
  await prisma.$disconnect()
})

describe('o contrato aparece para quem precisa assinar', () => {
  test('matrícula INSCRITO enxerga o contrato', async () => {
    const c = await contratoDoAluno(alunoId)
    assert.ok(c, 'era exatamente isto que a circularidade escondia: exigir MATRICULADO para mostrar o contrato que matricula')
    assert.equal(c!.assinado, false)
    assert.equal(c!.matriculaId, matriculaId)
  })

  test('o contrato ativo do aluno também não exige MATRICULADO', async () => {
    const id = await contratoAtivoDoAluno(alunoId)
    assert.equal(id, contratoId)
  })

  test('vem com o termo e os valores para a pessoa ler antes de assinar', async () => {
    const c = await contratoDoAluno(alunoId)
    assert.ok((c!.termo ?? '').length > 20, 'sem termo não há o que assinar')
    assert.equal(c!.valorTotalCentavos, 120000)
  })
})

describe('assinar', () => {
  test('recusa nome incompleto', async () => {
    const r = await assinarPeloPortal({ alunoId, nome: 'Maria', ip: '127.0.0.1' })
    assert.equal(r.ok, false)
    assert.match((r as any).erro, /nome completo/i)
  })

  test('assina, registra e efetiva a matrícula', async () => {
    const r = await assinarPeloPortal({ alunoId, nome: 'Maria Aparecida Silva', ip: '203.0.113.7' })
    assert.equal(r.ok, true)
    assert.equal((r as any).jaAssinado, false)
    assert.equal((r as any).matriculaEfetivada, true, 'assinar o contrato é o que efetiva a matrícula')

    const mat = await prisma.acaMatricula.findUnique({ where: { id: matriculaId } })
    assert.equal(mat?.status, 'MATRICULADO')
  })

  test('guarda nome, IP e a cópia do termo assinado', async () => {
    const c = await prisma.acaContrato.findUnique({ where: { id: contratoId } })
    assert.ok(c?.aceiteEm, 'sem data o aceite não prova nada')
    assert.equal(c?.aceiteNome, 'Maria Aparecida Silva')
    assert.equal(c?.aceiteIp, '203.0.113.7')
    assert.ok((c?.aceiteTermo ?? '').length > 20, 'o termo é congelado: mudar o modelo depois não pode reescrever o que foi assinado')
  })

  test('assinar de novo não duplica nem dá erro', async () => {
    const r = await assinarPeloPortal({ alunoId, nome: 'Maria Aparecida Silva', ip: '203.0.113.7' })
    assert.equal(r.ok, true)
    assert.equal((r as any).jaAssinado, true, 'clicar duas vezes, ou voltar pelo histórico, é o caso comum')
  })

  test('o aceite original não foi sobrescrito pela segunda tentativa', async () => {
    const c = await prisma.acaContrato.findUnique({ where: { id: contratoId } })
    assert.equal(c?.aceiteIp, '203.0.113.7')
  })

  test('depois de assinado o contrato aparece como assinado', async () => {
    const c = await contratoDoAluno(alunoId)
    assert.equal(c!.assinado, true)
    assert.equal(c!.assinadoPor, 'Maria Aparecida Silva')
    assert.ok(c!.assinadoEm)
  })
})
