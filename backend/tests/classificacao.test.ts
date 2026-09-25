// tests/classificacao.test.ts
//
// Fase 4 da consolidação ERP × Portal: o Portal vira o dono da classificação.
//
// O que se prova aqui é exatamente o que o ERP fazia errado e ninguém viu,
// porque nada disso aparece na tela — só na vida do candidato, semanas depois.
//
// ⚠️ TOCA O BANCO REAL. Tudo o que a suíte cria leva o prefixo `test:` e é
// apagado no fim, inclusive em caso de falha.
//
//   cd backend && npm run test:classificacao

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import {
  classificar,
  convocar,
  corteAplicavel,
  classificacaoPodeAlterarStatus,
} from '../src/services/portalClassificacao.js'

// ─────────── régua do corte (função pura, sem banco) ───────────

describe('qual nota de corte vale', () => {
  const proc = { notaCorte: 40, essayCutoff: 50, presencialCutoff: 60 }

  test('redação usa o corte da redação, não o geral', () => {
    const r = corteAplicavel('exam_online', proc, null)
    assert.equal(r.corte, 50, 'o ERP usava 40 aqui — reprovava e aprovava a régua errada')
  })

  test('prova presencial usa o corte da prova', () => {
    assert.equal(corteAplicavel('exam_presencial', proc, null).corte, 60)
  })

  test('ENEM usa o corte geral', () => {
    assert.equal(corteAplicavel('enem', proc, null).corte, 40)
  })

  test('a oferta sobrepõe o processo', () => {
    const oferta = { notaCorte: null, essayCutoff: 70, presencialCutoff: null }
    assert.equal(corteAplicavel('exam_online', proc, oferta).corte, 70,
      'Medicina não corta na mesma nota que Pedagogia — o override por oferta existe para isso')
  })

  test('sem corte do tipo, cai no geral', () => {
    const semRedacao = { notaCorte: 40, essayCutoff: null, presencialCutoff: null }
    assert.equal(corteAplicavel('exam_online', semRedacao, null).corte, 40)
  })

  test('avaliação documental não tem corte', () => {
    assert.equal(corteAplicavel('docs', proc, null).corte, null,
      'um corte aqui reprovaria gente por um número que ninguém pediu')
  })
})

describe('quem a classificação pode mexer', () => {
  test('mexe em quem ainda não passou da classificação', () => {
    assert.equal(classificacaoPodeAlterarStatus('inscrito'), true)
    assert.equal(classificacaoPodeAlterarStatus('pago_taxa'), true)
    assert.equal(classificacaoPodeAlterarStatus('classificado'), true)
  })

  test('não mexe em quem já foi convocado ou matriculado', () => {
    assert.equal(classificacaoPodeAlterarStatus('convocado'), false)
    assert.equal(classificacaoPodeAlterarStatus('matriculado'), false)
  })

  test('não ressuscita desistente', () => {
    assert.equal(classificacaoPodeAlterarStatus('desistente'), false)
  })
})

// ─────────── classificação de verdade, contra o banco ───────────

let unitId = 0, levelId = 0, modalityId = 0, modeId = 0, courseId = 0, offeringId = 0, processId = 0
const leads: number[] = []
const regs: Record<string, number> = {}

async function inscrever(chave: string, nome: string, nota: number | null, status: string) {
  const lead = await prisma.lead.create({
    data: {
      nome: `test:${nome}`, empresa: 'test:classificacao',
      email: `test.${chave}.${Date.now()}@local.invalid`,
      whatsapp: `55629${String(Date.now()).slice(-8)}`, formData: {}, scores: {},
    },
  })
  leads.push(lead.id)
  const r = await prisma.processRegistration.create({
    data: {
      leadId: lead.id, offeringId, selectionProcessId: processId, status,
      notaClassificacao: nota,
      // Ordem de chegada controlada: o desempate padrão é por ela.
      inscritoEm: new Date(Date.now() - leads.length * 60_000),
    },
  })
  regs[chave] = r.id
  return r.id
}

before(async () => {
  const carimbo = String(Date.now()).slice(-8)
  const unit = await prisma.educationalUnit.create({ data: { nome: `test:unidade ${carimbo}` } })
  unitId = unit.id
  const level = await prisma.educationalLevel.create({ data: { nome: `test:nivel ${carimbo}`, ordem: 99 } })
  levelId = level.id
  const modality = await prisma.modality.create({ data: { nome: `test:modalidade ${carimbo}` } })
  modalityId = modality.id
  const mode = await prisma.entryMode.create({
    data: { code: `test_${carimbo}`, name: `test:redação ${carimbo}`, evaluationType: 'exam_online' },
  })
  modeId = mode.id
  const course = await prisma.course.create({
    data: {
      nome: `test:curso ${carimbo}`,
      level: { connect: { id: levelId } },
      unit: { connect: { id: unitId } },
    },
  })
  courseId = course.id
  const offering = await prisma.courseOffering.create({
    data: {
      nome: `test:oferta ${carimbo}`,
      course: { connect: { id: courseId } },
      unit: { connect: { id: unitId } },
      modality: { connect: { id: modalityId } },
    },
  })
  offeringId = offering.id
  const proc = await prisma.selectionProcess.create({
    data: {
      nome: `test:processo ${carimbo}`, unitId, levelId, entryModeId: modeId,
      // Dois cortes concorrentes de propósito: o do processo (40) e o da
      // redação (50). Este processo é de redação, então vale 50.
      notaCorte: 40, essayCutoff: 50, status: 'aberto',
    },
  })
  processId = proc.id

  await inscrever('nota90', 'aprovado alto', 90, 'inscrito')
  await inscrever('nota70', 'aprovado médio', 70, 'inscrito')
  await inscrever('nota45', 'entre os dois cortes', 45, 'inscrito')
  await inscrever('semNota', 'ainda sem avaliação', null, 'inscrito')
  await inscrever('convocado', 'já convocado', 80, 'convocado')
  await inscrever('matriculado', 'já matriculado', 85, 'matriculado')
})

after(async () => {
  const ids = Object.values(regs)
  await prisma.processRegistrationStatusLog.deleteMany({ where: { registrationId: { in: ids } } })
  await prisma.processRegistration.deleteMany({ where: { id: { in: ids } } })
  await prisma.selectionProcess.deleteMany({ where: { id: processId } })
  await prisma.courseOffering.deleteMany({ where: { id: offeringId } })
  await prisma.course.deleteMany({ where: { id: courseId } })
  await prisma.entryMode.deleteMany({ where: { id: modeId } })
  await prisma.modality.deleteMany({ where: { id: modalityId } })
  await prisma.educationalLevel.deleteMany({ where: { id: levelId } })
  await prisma.educationalUnit.deleteMany({ where: { id: unitId } })
  await prisma.lead.deleteMany({ where: { id: { in: leads } } })
  await prisma.$disconnect()
})

describe('classificar um processo de redação', () => {
  let resultado: Awaited<ReturnType<typeof classificar>>

  test('roda e usa o corte da redação', async () => {
    resultado = await classificar(processId, { ator: 'test:suite' })
    assert.equal(resultado.corte, 50, 'tem de usar essayCutoff (50), não notaCorte (40)')
  })

  test('quem está sem nota não é reprovado', async () => {
    const r = await prisma.processRegistration.findUnique({ where: { id: regs.semNota } })
    assert.equal(r?.status, 'inscrito', 'sem avaliação não é reprovação — era o que o ERP fazia')
    assert.equal(r?.posicaoClassificacao, null)
    assert.equal(resultado.semNota, 1)
  })

  test('45 reprova: está acima do corte geral e abaixo do da redação', async () => {
    const r = await prisma.processRegistration.findUnique({ where: { id: regs.nota45 } })
    assert.equal(r?.status, 'reprovado', 'com a régua errada (40) esta pessoa passaria')
  })

  test('a ordem é por nota', async () => {
    const alto = await prisma.processRegistration.findUnique({ where: { id: regs.nota90 } })
    const medio = await prisma.processRegistration.findUnique({ where: { id: regs.nota70 } })
    assert.ok((alto?.posicaoClassificacao ?? 99) < (medio?.posicaoClassificacao ?? 99))
  })

  test('quem já foi convocado NÃO volta a ser classificado', async () => {
    const r = await prisma.processRegistration.findUnique({ where: { id: regs.convocado } })
    assert.equal(r?.status, 'convocado', 'reclassificar não pode rebaixar quem já foi chamado')
    assert.ok(r?.posicaoClassificacao != null, 'mas a posição continua sendo atualizada')
  })

  test('matriculado também fica de pé', async () => {
    const r = await prisma.processRegistration.findUnique({ where: { id: regs.matriculado } })
    assert.equal(r?.status, 'matriculado')
  })

  test('cada mudança de situação virou histórico', async () => {
    const logs = await prisma.processRegistrationStatusLog.findMany({
      where: { registrationId: { in: Object.values(regs) } },
    })
    assert.ok(logs.length >= 3, `esperava pelo menos 3 logs, veio ${logs.length}`)
    assert.ok(logs.every((l) => (l.observacao ?? '').length > 0), 'todo log diz o porquê')
  })

  test('rodar de novo não duplica nem muda o resultado', async () => {
    const antes = await prisma.processRegistration.findMany({
      where: { selectionProcessId: processId },
      select: { id: true, status: true, posicaoClassificacao: true },
      orderBy: { id: 'asc' },
    })
    await classificar(processId, { ator: 'test:suite' })
    const depois = await prisma.processRegistration.findMany({
      where: { selectionProcessId: processId },
      select: { id: true, status: true, posicaoClassificacao: true },
      orderBy: { id: 'asc' },
    })
    assert.deepEqual(depois, antes, 'classificar é idempotente quando nada mudou')
  })
})

describe('convocar', () => {
  test('chama na ordem e só quem está classificado', async () => {
    const r = await convocar(processId, 1, { ator: 'test:suite' })
    assert.equal(r.convocados, 1)
    const primeiro = await prisma.processRegistration.findUnique({ where: { id: regs.nota90 } })
    assert.equal(primeiro?.status, 'convocado', 'o 1º da lista é o chamado')
    assert.ok(primeiro?.convocadoEm, 'e a data fica registrada')
  })

  test('não convoca duas vezes a mesma pessoa', async () => {
    const r = await convocar(processId, 1, { ator: 'test:suite' })
    assert.equal(r.convocados, 1)
    const segundo = await prisma.processRegistration.findUnique({ where: { id: regs.nota70 } })
    assert.equal(segundo?.status, 'convocado', 'passou para o próximo da fila')
  })

  test('avisa quando não há classificados para as vagas pedidas', async () => {
    const r = await convocar(processId, 5, { ator: 'test:suite' })
    assert.equal(r.convocados, 0)
    assert.equal(r.vagasOciosas, 5, 'a tela precisa dizer que a chamada não preencheu')
  })
})
