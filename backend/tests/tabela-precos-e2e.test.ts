// tests/tabela-precos-e2e.test.ts
//
// Tabela de preços da oferta, de ponta a ponta: o candidato vê no checkout o
// preço do site em cada meio, é cobrado por ele, e o contrato do ERP nasce com
// a mesma condição.
//
//   Pix à vista     → cobra R$ 2.508,00, contrato de 1 parcela QUITADO
//   Cartão 12x      → cobra 12 × R$ 229,90 no cartão, contrato QUITADO
//   Boleto 12x      → cobra a 1ª de 12 × R$ 249,90, contrato com 12, 1 paga
//
// ⚠️ TOCA O BANCO REAL e fala com o servidor da demo (HTTP). Tudo leva o
// prefixo `test:` e é apagado no fim. O provedor é o SIMULADO: nenhuma
// cobrança sai para gateway nenhum.
//
//   cd backend && node --import tsx --test --test-force-exit tests/tabela-precos-e2e.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { encryptToken } from '../src/services/cloudApi.js'
import { signCandidateToken } from '../src/lib/candidateAuth.js'
import { gerarContratoEParcelas } from '../src/services/acaFinanceiro.js'
import { contratoDaInscricao } from '../src/services/portalJornada.js'
import { BASE } from './apoio.js'

const TABELA = { aVista: 2508, cartao: { parcelas: 12, valorParcela: 229.9 }, boleto: { parcelas: 12, valorParcela: 249.9 } }

const ids = {
  conn: 0, unidade: 0, processo: 0, oferta: 0, portal: 0, periodo: 0, turma: 0,
  leads: [] as number[], alunos: [] as number[], inscricoes: [] as number[], processRegs: [] as number[],
  matriculas: [] as number[],
}
let carimbo = ''

async function novaInscricao(sufixo: string): Promise<{ id: number; code: string; token: string }> {
  const lead = await prisma.lead.create({
    data: {
      nome: `test:Tabela ${sufixo}`, empresa: 'test:tabela-precos',
      email: `test.tabela.${sufixo}.${carimbo}@local.invalid`,
      whatsapp: `55621${carimbo}${sufixo.length}`.slice(0, 13), formData: {}, scores: {},
    },
  })
  ids.leads.push(lead.id)
  const pr = await prisma.processRegistration.create({
    data: { leadId: lead.id, offeringId: ids.oferta, selectionProcessId: ids.processo },
  })
  ids.processRegs.push(pr.id)
  const code = `TTP-${sufixo}-${carimbo}`.slice(0, 30)
  const insc = await prisma.enrollmentRegistration.create({
    data: {
      portalId: ids.portal, leadId: lead.id, candidateCode: code,
      processRegistrationId: pr.id,
      formData: { nome: `test:Tabela ${sufixo}`, cpf: '52998224725', email: `test.tabela.${sufixo}.${carimbo}@local.invalid` },
    },
  })
  ids.inscricoes.push(insc.id)
  return { id: insc.id, code, token: signCandidateToken(insc.id, code) }
}

async function chamar(metodo: 'GET' | 'POST', caminho: string, token: string, corpo?: unknown) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await r.text()
  let json: any = null
  try { json = JSON.parse(texto) } catch { json = texto }
  return { status: r.status, json }
}

/** Matrícula no ERP ligada à inscrição, e o contrato gerado dela. */
async function contratoDe(inscricaoId: number, sufixo: string) {
  const insc = await prisma.enrollmentRegistration.findUnique({ where: { id: inscricaoId }, select: { leadId: true } })
  const aluno = await prisma.aluno.create({ data: { leadId: insc!.leadId!, cpf: `66${carimbo}${sufixo.length}`, ra: `t${sufixo}${carimbo}`.slice(0, 20), ativo: true } })
  ids.alunos.push(aluno.id)
  const mat = await prisma.acaMatricula.create({
    data: { alunoId: aluno.id, turmaId: ids.turma, status: 'PRE_MATRICULA' as any, origem: 'portal', enrollmentRegistrationId: inscricaoId },
  })
  ids.matriculas.push(mat.id)
  const r = await gerarContratoEParcelas(mat.id)
  assert.ok(!('skip' in r), 'contrato deveria ser criado')
  return prisma.acaContrato.findUnique({
    where: { matriculaId: mat.id },
    include: { parcelas: { orderBy: { nroParcela: 'asc' } } },
  })
}

before(async () => {
  carimbo = String(Date.now()).slice(-7)
  const conn = await prisma.paymentProviderConnection.create({
    data: { provider: 'simulado', name: `test:simulado tabela ${carimbo}`, apiKey: encryptToken('simulado'), environment: 'sandbox', active: true, webhookToken: `test-wh-tabela-${carimbo}` },
  })
  ids.conn = conn.id
  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade tabela ${carimbo}` } })
  ids.unidade = unidade.id
  const processo = await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo tabela ${carimbo}` } })
  ids.processo = processo.id
  const curso = await prisma.course.findFirst({ select: { id: true } })
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  const oferta = await prisma.courseOffering.create({
    data: {
      courseId: curso!.id, unitId: unidade.id, modalityId: modalidade!.id, selectionProcessId: processo.id,
      nome: `test:oferta tabela ${carimbo}`, valorMensalidade: 229.9, tabelaPrecos: TABELA,
    },
  })
  ids.oferta = oferta.id
  // Plano do ERP DIFERENTE da tabela: prova que o contrato não sai dele.
  await prisma.acaPlanoPagamento.create({
    data: { courseOfferingId: oferta.id, nome: 'test:plano padrão', numParcelas: 10, valorParcelaCentavos: 99900, taxaMatriculaCentavos: 5000 },
  })
  const portal = await prisma.enrollmentPortal.create({
    data: {
      nome: `test:portal tabela ${carimbo}`, slug: `test-tabela-${carimbo}`, unitId: unidade.id,
      active: true, requirePayment: true, paymentMode: 'transparent', paymentScope: 'curso',
      paymentConnectionId: conn.id, selectionProcessIds: [processo.id], formConfig: {},
      // O portal como está no ineprotec: tudo 1x, sem desconto. A tabela manda.
      paymentMethodsConfig: {
        pix: { ativo: true, descontoPct: 5 },
        boleto: { ativo: true, parcelado: false, parcelasMax: 1 },
        cartao: { ativo: true, parcelasMax: 1, semJurosAte: 1, parcelaMinima: 5 },
      },
    },
  })
  ids.portal = portal.id
  const periodo = await prisma.acaPeriodoLetivo.create({ data: { codigo: `tp${carimbo}`, descricao: `test:período tabela ${carimbo}`, anoLetivo: 2026 } })
  ids.periodo = periodo.id
  const turma = await prisma.acaTurma.create({ data: { nome: `test:turma tabela ${carimbo}`, periodoLetivoId: periodo.id, courseOfferingId: oferta.id } })
  ids.turma = turma.id
})

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: ids.matriculas } }, select: { id: true } }).catch(() => [])
  const cids = contratos.map((c) => c.id)
  await tentar('parcelas', () => prisma.acaParcela.deleteMany({ where: { contratoId: { in: cids } } }))
  await tentar('contratos', () => prisma.acaContrato.deleteMany({ where: { id: { in: cids } } }))
  await tentar('eventos matrícula', () => prisma.acaMatriculaEvento.deleteMany({ where: { matriculaId: { in: ids.matriculas } } }))
  await tentar('matrículas', () => prisma.acaMatricula.deleteMany({ where: { id: { in: ids.matriculas } } }))
  await tentar('turma', () => prisma.acaTurma.deleteMany({ where: { id: ids.turma } }))
  await tentar('período', () => prisma.acaPeriodoLetivo.deleteMany({ where: { id: ids.periodo } }))
  await tentar('meios de pagamento', () => prisma.enrollmentPaymentMethod.deleteMany({ where: { registrationId: { in: ids.inscricoes } } }))
  await tentar('inscrições', () => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: ids.inscricoes } } }))
  await tentar('inscrições no processo', () => prisma.processRegistration.deleteMany({ where: { id: { in: ids.processRegs } } }))
  await tentar('alunos', () => prisma.aluno.deleteMany({ where: { id: { in: ids.alunos } } }))
  await tentar('eventos do lead', () => prisma.leadEvent.deleteMany({ where: { leadId: { in: ids.leads } } }))
  await tentar('leads', () => prisma.lead.deleteMany({ where: { id: { in: ids.leads } } }))
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { nome: { startsWith: 'test:portal tabela ' } } }))
  await tentar('planos', () => prisma.acaPlanoPagamento.deleteMany({ where: { courseOfferingId: ids.oferta } }))
  await tentar('oferta', () => prisma.courseOffering.deleteMany({ where: { id: ids.oferta } }))
  await tentar('processo', () => prisma.selectionProcess.deleteMany({ where: { id: ids.processo } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  // O resíduo perigoso: conexão ativa. Por prefixo, para levar sobras antigas.
  await tentar('conexões', () => prisma.paymentProviderConnection.deleteMany({ where: { name: { startsWith: 'test:simulado tabela' } } }))
  await prisma.$disconnect()
})

describe('o checkout mostra o preço do site em cada meio', () => {
  test('Pix à vista, boleto à vista ou 12x, cartão 12x sem juros', async () => {
    const i = await novaInscricao('opc')
    const r = await chamar('GET', `/public/registrations/${i.code}/payment-options`, i.token)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    const m = r.json.meios
    assert.equal(r.json.rotulo, 'Curso')
    assert.equal(r.json.valor, 2508)
    // O 5% do portal não entra por cima do à vista da tabela.
    assert.equal(m.pix.valor, 2508)
    assert.deepEqual(m.boleto.opcoes.map((o: any) => [o.parcelas, o.valorEntrada, o.valorParcela]), [[1, 2508, 0], [12, 249.9, 249.9]])
    assert.equal(m.cartao.opcoes.length, 12)
    const doze = m.cartao.opcoes[11]
    assert.deepEqual([doze.parcelas, doze.valorParcela, doze.valorTotal, doze.semJuros], [12, 229.9, 2758.8, true])
  })
})

describe('cobrança e contrato pela condição escolhida', () => {
  test('Pix: cobra o à vista e o contrato nasce quitado', async () => {
    const i = await novaInscricao('pix')
    const init = await chamar('POST', `/public/registrations/${i.code}/payment-init`, i.token, { method: 'pix' })
    assert.equal(init.status, 200, JSON.stringify(init.json))
    const insc = await prisma.enrollmentRegistration.findUnique({ where: { id: i.id }, select: { paymentAmount: true, paymentPlan: true } })
    assert.equal(Number(insc!.paymentAmount), 2508)
    assert.equal((insc!.paymentPlan as any).tabela.condicao, 'a_vista')

    const pago = await chamar('POST', `/public/registrations/${i.code}/simular-pagamento`, i.token, {})
    assert.equal(pago.status, 200, JSON.stringify(pago.json))
    const c = await contratoDe(i.id, 'pix')
    assert.equal(c!.valorTotalCentavos, 250800)
    assert.equal(c!.status, 'QUITADO')
    assert.equal(c!.parcelas.length, 1)

    const termo = await contratoDaInscricao(i.id)
    assert.equal(termo!.valorTotalCentavos, 250800)
    assert.equal(termo!.numParcelas, 1)
  })

  test('cartão 12x: cobra 12 × R$ 229,90 e o contrato nasce quitado', async () => {
    const i = await novaInscricao('car')
    const init = await chamar('POST', `/public/registrations/${i.code}/payment-init`, i.token, { method: 'credit_card', parcelas: 12, cardToken: 'tok_teste' })
    assert.equal(init.status, 200, JSON.stringify(init.json))
    const insc = await prisma.enrollmentRegistration.findUnique({ where: { id: i.id }, select: { paymentAmount: true, paymentPlan: true } })
    assert.equal(Number(insc!.paymentAmount), 2758.8)
    assert.deepEqual((insc!.paymentPlan as any).tabela, { condicao: 'cartao', parcelas: 12, valorParcela: 229.9, valorTotal: 2758.8 })

    await chamar('POST', `/public/registrations/${i.code}/simular-pagamento`, i.token, {})
    const c = await contratoDe(i.id, 'car')
    assert.equal(c!.valorTotalCentavos, 275880)
    assert.equal(c!.status, 'QUITADO')
  })

  test('boleto 12x: cobra a 1ª de R$ 249,90 e o contrato tem as 12', async () => {
    const i = await novaInscricao('bol')
    const init = await chamar('POST', `/public/registrations/${i.code}/payment-init`, i.token, { method: 'boleto', parcelas: 12 })
    assert.equal(init.status, 200, JSON.stringify(init.json))
    const insc = await prisma.enrollmentRegistration.findUnique({ where: { id: i.id }, select: { paymentAmount: true } })
    assert.equal(Number(insc!.paymentAmount), 249.9)

    await chamar('POST', `/public/registrations/${i.code}/simular-pagamento`, i.token, {})
    const c = await contratoDe(i.id, 'bol')
    assert.equal(c!.valorTotalCentavos, 299880)
    assert.equal(c!.status, 'ATIVO')
    assert.equal(c!.parcelas.length, 12)
    assert.ok(c!.parcelas.every((p) => p.valorBrutoCentavos === 24990))
    assert.equal(c!.parcelas.filter((p) => p.situacao === 'PAGA').length, 1)
  })

  test('boleto pedindo 5x numa tabela de 12x: vale a condição anunciada (12x)', async () => {
    const i = await novaInscricao('b5x')
    const init = await chamar('POST', `/public/registrations/${i.code}/payment-init`, i.token, { method: 'boleto', parcelas: 5 })
    assert.equal(init.status, 200, JSON.stringify(init.json))
    const insc = await prisma.enrollmentRegistration.findUnique({ where: { id: i.id }, select: { paymentAmount: true, paymentPlan: true } })
    assert.equal(Number(insc!.paymentAmount), 249.9)
    assert.equal((insc!.paymentPlan as any).tabela.parcelas, 12)
  })
})
