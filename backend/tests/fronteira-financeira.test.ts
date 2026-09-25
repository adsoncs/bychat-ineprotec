// tests/fronteira-financeira.test.ts
//
// Fase 6 da consolidação ERP × Portal: a fronteira entre o primeiro pagamento
// (Portal) e as demais parcelas (ERP).
//
// O que se prova: as mensalidades são cobradas **na mesma conta do Asaas que
// recebeu a entrada**. O ERP pegava a última conexão ativa criada e o Portal usa
// a conexão configurada no portal — com uma conexão só isso coincide por acaso,
// com duas o dinheiro entra em contas diferentes e a conciliação não fecha.
//
// ⚠️ TOCA O BANCO REAL. Tudo leva o prefixo `test:` e é apagado no fim. Nenhuma
// chamada sai para o Asaas: o teste só verifica QUAL conta seria usada.
//
//   cd backend && npm run test:fronteira

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { contaDaParcela, getAsaasConfig } from '../src/services/acaFinanceiro.js'
import { encryptToken } from '../src/services/cloudApi.js'

const CHAVE_PORTAL = '$aact_TESTE_PORTAL_DA_INSCRICAO'
const CHAVE_PADRAO = '$aact_TESTE_ULTIMA_CONEXAO_ATIVA'

let connPortal = 0, connPadrao = 0
let portalId = 0, leadId = 0, alunoId = 0, inscricaoId = 0, unidadeId = 0
let periodoId = 0, turmaId = 0, turma2Id = 0, matriculaId = 0, contratoId = 0
let parcelaLigada = 0, parcelaSolta = 0

before(async () => {
  const carimbo = String(Date.now()).slice(-8)

  // Duas conexões: a do portal e uma criada DEPOIS — que é a que o
  // comportamento antigo escolheria, por ser a de maior id.
  const cp = await prisma.paymentProviderConnection.create({
    data: { provider: 'asaas', name: `test:conta do portal ${carimbo}`, apiKey: encryptToken(CHAVE_PORTAL), environment: 'sandbox', active: true, webhookToken: `test-wh-portal-${carimbo}` },
  })
  connPortal = cp.id
  const cd = await prisma.paymentProviderConnection.create({
    data: { provider: 'asaas', name: `test:ultima ativa ${carimbo}`, apiKey: encryptToken(CHAVE_PADRAO), environment: 'sandbox', active: true, webhookToken: `test-wh-padrao-${carimbo}` },
  })
  connPadrao = cd.id

  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade ${carimbo}` } })
  unidadeId = unidade.id
  const portal = await prisma.enrollmentPortal.create({
    data: {
      nome: `test:portal ${carimbo}`, slug: `test-portal-${carimbo}`, unitId: unidadeId,
      active: true, requirePayment: true, paymentConnectionId: connPortal,
      selectionProcessIds: [], formConfig: {},
    },
  })
  portalId = portal.id

  const lead = await prisma.lead.create({
    data: {
      nome: 'test:Aluno da Fronteira', empresa: 'test:fronteira',
      email: `test.fronteira.${carimbo}@local.invalid`,
      whatsapp: `55629${carimbo}`, formData: {}, scores: {},
    },
  })
  leadId = lead.id
  const aluno = await prisma.aluno.create({ data: { leadId, cpf: `77${carimbo}`, ra: `f${carimbo}`, ativo: true } })
  alunoId = aluno.id

  const insc = await prisma.enrollmentRegistration.create({
    data: { portalId, leadId, candidateCode: `TST-${carimbo}`, formData: {}, paymentStatus: 'paid' },
  })
  inscricaoId = insc.id

  const periodo = await prisma.acaPeriodoLetivo.create({
    data: { codigo: `f${carimbo}`.slice(0, 20), descricao: `test:período ${carimbo}`, anoLetivo: 2026 },
  })
  periodoId = periodo.id
  const turma = await prisma.acaTurma.create({ data: { nome: `test:turma ${carimbo}`, periodoLetivoId: periodoId } })
  turmaId = turma.id

  const mat = await prisma.acaMatricula.create({
    data: { alunoId, turmaId, status: 'MATRICULADO', origem: 'portal', enrollmentRegistrationId: inscricaoId },
  })
  matriculaId = mat.id
  const contrato = await prisma.acaContrato.create({
    data: { matriculaId, valorTotalCentavos: 100000, status: 'ATIVO' },
  })
  contratoId = contrato.id

  const p1 = await prisma.acaParcela.create({
    data: { contratoId, nroParcela: 1, tipo: 'MENSALIDADE', valorBrutoCentavos: 50000, dataVencimento: new Date() },
  })
  parcelaLigada = p1.id

  // Uma segunda matrícula, sem vínculo com inscrição — o caso da secretaria.
  // Turma própria: o banco não deixa o mesmo aluno duas vezes na mesma turma.
  const turma2 = await prisma.acaTurma.create({ data: { nome: `test:turma secretaria ${carimbo}`, periodoLetivoId: periodoId } })
  turma2Id = turma2.id
  const mat2 = await prisma.acaMatricula.create({ data: { alunoId, turmaId: turma2Id, status: 'MATRICULADO' } })
  const contrato2 = await prisma.acaContrato.create({
    data: { matriculaId: mat2.id, valorTotalCentavos: 50000, status: 'ATIVO' },
  })
  const p2 = await prisma.acaParcela.create({
    data: { contratoId: contrato2.id, nroParcela: 1, tipo: 'MENSALIDADE', valorBrutoCentavos: 50000, dataVencimento: new Date() },
  })
  parcelaSolta = p2.id
  // guardados para a limpeza
  ;(globalThis as any).__mat2 = mat2.id
  ;(globalThis as any).__contrato2 = contrato2.id
})

// A limpeza não pode parar no primeiro erro.
//
// Aconteceu de verdade: uma execução quebrou no `before`, o `after` falhou num
// delete no meio da fila e parou — deixando **conexões Asaas de teste ativas**
// no banco. Como o padrão do ERP escolhe a conexão ativa de maior id, uma
// cobrança real teria saído por uma chave de mentira. Cada passo agora é
// independente, e as conexões (o resíduo perigoso) são apagadas por prefixo, não
// por id, para levar junto o que sobrou de execuções anteriores.
async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  const mat2 = (globalThis as any).__mat2 as number
  const contrato2 = (globalThis as any).__contrato2 as number
  await tentar('parcelas', () => prisma.acaParcela.deleteMany({ where: { contratoId: { in: [contratoId, contrato2] } } }))
  await tentar('contratos', () => prisma.acaContrato.deleteMany({ where: { id: { in: [contratoId, contrato2] } } }))
  await tentar('matrículas', () => prisma.acaMatricula.deleteMany({ where: { id: { in: [matriculaId, mat2] } } }))
  await tentar('turmas', () => prisma.acaTurma.deleteMany({ where: { id: { in: [turmaId, turma2Id] } } }))
  await tentar('período', () => prisma.acaPeriodoLetivo.deleteMany({ where: { id: periodoId } }))
  await tentar('inscrição', () => prisma.enrollmentRegistration.deleteMany({ where: { id: inscricaoId } }))
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { nome: { startsWith: 'test:portal ' } } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: unidadeId } }))
  await tentar('aluno', () => prisma.aluno.deleteMany({ where: { id: alunoId } }))
  await tentar('lead', () => prisma.lead.deleteMany({ where: { id: leadId } }))
  await tentar('conexões', () => prisma.paymentProviderConnection.deleteMany({ where: { name: { startsWith: 'test:' } } }))
  await prisma.$disconnect()
})

describe('quem recebeu a entrada recebe as mensalidades', () => {
  test('a parcela de matrícula vinda do portal cobra na conta do portal', async () => {
    const cfg = await contaDaParcela(parcelaLigada)
    assert.ok(cfg, 'precisa achar uma conta')
    assert.equal(cfg!.apiKey, CHAVE_PORTAL,
      'com a régua antiga viria a última conexão criada, e a mensalidade cairia em outra conta')
  })

  test('a régua antiga escolheria outra conta — é o defeito que isto corrige', async () => {
    const padrao = await getAsaasConfig()
    assert.equal(padrao!.apiKey, CHAVE_PADRAO)
    assert.notEqual(padrao!.apiKey, CHAVE_PORTAL)
  })

  test('matrícula feita na secretaria continua no padrão', async () => {
    const cfg = await contaDaParcela(parcelaSolta)
    assert.equal(cfg!.apiKey, CHAVE_PADRAO,
      'sem inscrição de origem não há conta de origem — o padrão é o certo aqui')
  })

  test('conexão do portal desativada não derruba a cobrança', async () => {
    await prisma.paymentProviderConnection.update({ where: { id: connPortal }, data: { active: false } })
    const cfg = await contaDaParcela(parcelaLigada)
    assert.equal(cfg!.apiKey, CHAVE_PADRAO,
      'quem já é aluno não pode ficar sem boleto porque a conexão da campanha foi desligada')
    await prisma.paymentProviderConnection.update({ where: { id: connPortal }, data: { active: true } })
  })

  test('parcela inexistente cai no padrão em vez de estourar', async () => {
    const cfg = await contaDaParcela(999999999)
    assert.ok(cfg, 'não pode lançar: quem chama é a rota de gerar cobrança')
  })
})
