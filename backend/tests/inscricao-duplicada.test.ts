// tests/inscricao-duplicada.test.ts
//
// Duplicidade de inscrições no portal: identificar, mesclar, desfazer, manter
// separadas — e o envio que retoma a inscrição aberta em vez de criar outra.
//
// Caso real (ineprotec, 29/09): a mesma pessoa enviou o formulário três vezes
// e ficaram três inscrições, três leads, nada ligando uma à outra.
//
// ⚠️ TOCA O BANCO da demo e fala com o servidor dela. Tudo leva o prefixo
// `test:` e é apagado no fim. Nenhuma cobrança sai para gateway: o provedor das
// cobranças é o simulado, e o cancelamento no Asaas é provado com fetch falso.
//
//   cd backend && node --import tsx --test --test-force-exit tests/inscricao-duplicada.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { gruposDeDuplicidade, mesclarInscricoes, desfazerMescla, manterSeparadas } from '../src/services/inscricaoDuplicada.js'
import { cancelarCobrancaAsaas } from '../src/services/paymentAsaas.js'
import { BASE } from './apoio.js'

const CPF_X = '529.982.247-25'
const CPF_Y = '111.444.777-35'
const CPF_Z = '390.533.447-05'

const ids = { unidade: 0, processo: 0, oferta: 0, portal: 0, leads: [] as number[], regs: {} as Record<string, number> }
let carimbo = ''
let slug = ''

async function inscricao(nome: string, cpf: string, email: string, extra: Record<string, unknown> = {}) {
  const lead = await prisma.lead.create({ data: { nome: `test:${nome}`, empresa: 'test:dup', whatsapp: '', email, formData: {}, scores: {} } })
  ids.leads.push(lead.id)
  const r = await prisma.enrollmentRegistration.create({
    data: { portalId: ids.portal, leadId: lead.id, candidateCode: `TDP-${nome}-${carimbo}`.slice(0, 30), status: 'pending', formData: { nome, cpf, email }, ...extra },
  })
  ids.regs[nome] = r.id
  return r.id
}

before(async () => {
  carimbo = String(Date.now()).slice(-6)
  slug = `test-dup-${carimbo}`
  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade dup ${carimbo}` } })
  ids.unidade = unidade.id
  ids.processo = (await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo dup ${carimbo}` } })).id
  const curso = await prisma.course.findFirst({ select: { id: true } })
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  ids.oferta = (await prisma.courseOffering.create({ data: { courseId: curso!.id, unitId: unidade.id, modalityId: modalidade!.id, selectionProcessId: ids.processo, nome: `test:oferta dup ${carimbo}` } })).id
  ids.portal = (await prisma.enrollmentPortal.create({
    data: { nome: `test:portal dup ${carimbo}`, slug, unitId: unidade.id, active: true, requirePayment: true, paymentMode: 'transparent', selectionProcessIds: [ids.processo], formConfig: {} },
  })).id

  // A e B: mesmo CPF. C: outro CPF, mas o e-mail de B — entra no grupo pela
  // corrente. D: ninguém.
  await inscricao('A', CPF_X, `a.${carimbo}@local.invalid`)
  await inscricao('B', CPF_X, `b.${carimbo}@local.invalid`, { paymentStatus: 'paid', status: 'paid' })
  await inscricao('C', CPF_Y, `b.${carimbo}@local.invalid`)
  await inscricao('D', CPF_Z, `d.${carimbo}@local.invalid`)

  // A tem uma cobrança aberta (simulado) e dois documentos; B já tem RG.
  await prisma.enrollmentPaymentMethod.create({ data: { registrationId: ids.regs.A!, method: 'pix', provider: 'simulado', amount: 100, status: 'pending', externalId: `sim-${carimbo}` } })
  const doc = { fileUrl: '/uploads/test.pdf', fileName: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 1 }
  await prisma.enrollmentDocument.createMany({ data: [
    { registrationId: ids.regs.A!, typeCode: 'rg', label: 'RG (de A)', ...doc },
    { registrationId: ids.regs.A!, typeCode: 'historico', label: 'Histórico (de A)', ...doc },
    { registrationId: ids.regs.B!, typeCode: 'rg', label: 'RG (de B)', ...doc },
  ] })
})

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  const regs = (await prisma.enrollmentRegistration.findMany({ where: { portalId: ids.portal }, select: { id: true, leadId: true } }).catch(() => []))
  const regIds = regs.map((r) => r.id)
  const leadIds = [...new Set([...ids.leads, ...regs.map((r) => r.leadId).filter((x): x is number => !!x)])]
  await tentar('documentos', () => prisma.enrollmentDocument.deleteMany({ where: { registrationId: { in: regIds } } }))
  await tentar('pagamentos', () => prisma.enrollmentPaymentMethod.deleteMany({ where: { registrationId: { in: regIds } } }))
  await tentar('inscrições', () => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: regIds } } }))
  await tentar('inscr. processo', () => prisma.processRegistration.deleteMany({ where: { selectionProcessId: ids.processo } }))
  await tentar('contas', () => prisma.portalAccount.deleteMany({ where: { leadId: { in: leadIds } } }))
  await tentar('eventos', () => prisma.leadEvent.deleteMany({ where: { leadId: { in: leadIds } } }))
  await tentar('leads', () => prisma.lead.deleteMany({ where: { id: { in: leadIds } } }))
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { id: ids.portal } }))
  await tentar('oferta', () => prisma.courseOffering.deleteMany({ where: { id: ids.oferta } }))
  await tentar('processo', () => prisma.selectionProcess.deleteMany({ where: { id: ids.processo } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('identificar', () => {
  test('agrupa por CPF e e-mail, em corrente; quem não casa fica de fora', async () => {
    const grupos = await gruposDeDuplicidade(ids.portal)
    assert.equal(grupos.length, 1)
    const g = grupos[0]!
    assert.deepEqual(g.membros.map((m) => m.id).sort(), [ids.regs.A, ids.regs.B, ids.regs.C].sort())
    assert.deepEqual(g.porque.sort(), ['cpf', 'email'])
  })

  test('sugere manter a paga', async () => {
    const [g] = await gruposDeDuplicidade(ids.portal)
    assert.equal(g!.sugestaoPrincipalId, ids.regs.B)
  })
})

describe('mesclar', () => {
  test('não descarta a inscrição paga', async () => {
    const r = await mesclarInscricoes({ portalId: ids.portal, principalId: ids.regs.A!, outrasIds: [ids.regs.B!], operador: {} })
    assert.equal(r.ok, false)
    assert.match((r as any).erro, /pagamento confirmado/)
  })

  test('mescla na paga: cobrança cancelada, documentos que faltam vêm, leads unidos', async () => {
    const r = await mesclarInscricoes({ portalId: ids.portal, principalId: ids.regs.B!, outrasIds: [ids.regs.A!, ids.regs.C!], operador: { nome: 'test' } })
    assert.equal(r.ok, true, JSON.stringify(r))

    const a = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.regs.A! } })
    assert.equal(a!.status, 'merged')
    assert.equal(a!.mergedIntoId, ids.regs.B)
    assert.equal(a!.statusAntesDaMescla, 'pending')

    const cobranca = await prisma.enrollmentPaymentMethod.findFirst({ where: { registrationId: ids.regs.A! } })
    assert.equal(cobranca!.status, 'failed')

    // B já tinha RG: o de A fica em A. Histórico só A tinha: passa para B.
    const docsB = (await prisma.enrollmentDocument.findMany({ where: { registrationId: ids.regs.B! } })).map((d) => d.label).sort()
    assert.deepEqual(docsB, ['Histórico (de A)', 'RG (de B)'])

    // Os leads de A e C foram mesclados no de B, e as inscrições os seguem.
    const b = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.regs.B! } })
    const c = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.regs.C! } })
    assert.equal(a!.leadId, b!.leadId)
    assert.equal(c!.leadId, b!.leadId)

    assert.equal((await gruposDeDuplicidade(ids.portal)).length, 0, 'mesclada sai dos grupos')
  })

  test('desfazer volta o status e não reabre o aviso', async () => {
    const r = await desfazerMescla(ids.regs.C!, {})
    assert.equal(r.ok, true)
    const c = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.regs.C! } })
    assert.equal(c!.status, 'pending')
    assert.equal(c!.mergedIntoId, null)
    const grupos = await gruposDeDuplicidade(ids.portal)
    assert.ok(grupos.every((g) => g.ignorado || !g.membros.some((m) => m.id === ids.regs.C)))
  })

  test('manter separadas tira o aviso', async () => {
    await manterSeparadas(ids.portal, [ids.regs.B!, ids.regs.C!])
    const grupos = await gruposDeDuplicidade(ids.portal)
    assert.ok(grupos.every((g) => g.ignorado))
  })
})

describe('cancelamento no Asaas', () => {
  test('DELETE na cobrança; a que já não existe conta como cancelada', async () => {
    const original = globalThis.fetch
    const chamadas: string[] = []
    let status = 200
    globalThis.fetch = (async (url: any, init: any) => {
      chamadas.push(`${init?.method} ${url}`)
      return new Response(JSON.stringify(status === 200 ? { deleted: true } : { errors: [{ description: 'não encontrada' }] }), { status })
    }) as any
    try {
      assert.deepEqual(await cancelarCobrancaAsaas({ apiKey: 'x', environment: 'sandbox' }, 'pay_123'), { ok: true })
      assert.match(chamadas[0]!, /^DELETE .*\/payments\/pay_123$/)
      status = 404
      assert.deepEqual(await cancelarCobrancaAsaas({ apiKey: 'x', environment: 'sandbox' }, 'pay_456'), { ok: true })
      status = 400
      assert.equal((await cancelarCobrancaAsaas({ apiKey: 'x', environment: 'sandbox' }, 'pay_789')).ok, false)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('envio: a mesma pessoa retoma a inscrição aberta', () => {
  test('dois envios com o mesmo CPF: uma inscrição, mesmo código', async () => {
    const enviar = async (email: string) => {
      const r = await fetch(`${BASE}/public/portals/${slug}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formData: { nome: 'test:Reenvio', email, cpf: '153.509.460-56', offeringId: ids.oferta, lgpdConsent: true } }),
      })
      const j = await r.json() as any
      assert.ok([200, 201].includes(r.status), JSON.stringify(j))
      return j.candidateCode as string
    }
    const primeiro = await enviar(`r1.${carimbo}@local.invalid`)
    const segundo = await enviar(`r2.${carimbo}@local.invalid`)
    assert.equal(segundo, primeiro)
    const doCpf = (await prisma.enrollmentRegistration.findMany({ where: { portalId: ids.portal } }))
      .filter((r) => String((r.formData as any)?.cpf) === '153.509.460-56')
    assert.equal(doCpf.length, 1)
    assert.equal((doCpf[0]!.formData as any).email, `r2.${carimbo}@local.invalid`, 'os dados do último envio valem')
  })
})
