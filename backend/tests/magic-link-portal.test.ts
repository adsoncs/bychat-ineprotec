// tests/magic-link-portal.test.ts
//
// O link que a secretaria gera e manda pelo WhatsApp.
//
// O que se prova aqui é o que estava quebrado sem ninguém ver: o link era
// gerado, tinha aparência de link bom, e abria um formulário em branco. A
// geração funcionava; a ponta que consome nunca existiu no portal novo.
//
// ⚠️ TOCA O BANCO REAL. Tudo leva o prefixo `test:` e é apagado no fim.
//
//   cd backend && npm run test:magiclink

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { signMagicLink, verifyMagicLink, verifyCandidateToken } from '../src/lib/candidateAuth.js'

let leadId = 0, portalId = 0, unidadeId = 0, inscricaoId = 0
let slug = ''

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

before(async () => {
  const carimbo = String(Date.now()).slice(-8)
  slug = `test-magic-${carimbo}`

  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade ${carimbo}` } })
  unidadeId = unidade.id
  const portal = await prisma.enrollmentPortal.create({
    data: {
      nome: `test:portal ${carimbo}`, slug, unitId: unidadeId, active: true,
      formMode: 'full', magicLinkTtlDays: 30, selectionProcessIds: [], formConfig: {},
    },
  })
  portalId = portal.id

  const lead = await prisma.lead.create({
    data: {
      nome: 'test:Candidata do Link', empresa: 'test:magiclink',
      email: `test.magic.${carimbo}@local.invalid`,
      whatsapp: `55629${carimbo}`, formData: {}, scores: {},
    },
  })
  leadId = lead.id

  const insc = await prisma.enrollmentRegistration.create({
    data: { portalId, leadId, candidateCode: `TST-${carimbo}`, formData: {}, status: 'pending' },
  })
  inscricaoId = insc.id
})

after(async () => {
  await tentar('inscrição', () => prisma.enrollmentRegistration.deleteMany({ where: { id: inscricaoId } }))
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { id: portalId } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: unidadeId } }))
  await tentar('lead', () => prisma.lead.deleteMany({ where: { id: leadId } }))
  await prisma.$disconnect()
})

describe('o token do link', () => {
  test('vale para o lead e o portal que o geraram', () => {
    const t = signMagicLink(leadId, slug, 30)
    const p = verifyMagicLink(t)
    assert.ok(p, 'o token recém-assinado precisa ser aceito')
    assert.equal(p!.leadId, leadId)
    assert.equal(p!.portalSlug, slug)
  })

  test('token adulterado é recusado', () => {
    const t = signMagicLink(leadId, slug, 30)
    const [corpo] = t.split('.')
    assert.equal(verifyMagicLink(`${corpo}.assinaturaFalsa`), null,
      'sem isto, qualquer um forjaria um link para a inscrição de outra pessoa')
  })

  test('token de outro portal não abre este', () => {
    const t = signMagicLink(leadId, 'outro-portal-qualquer', 30)
    const p = verifyMagicLink(t)
    assert.ok(p)
    assert.notEqual(p!.portalSlug, slug,
      'a rota compara o slug do token com o da URL antes de devolver qualquer coisa')
  })

  test('token vencido é recusado', () => {
    const t = signMagicLink(leadId, slug, -1) // venceu ontem
    assert.equal(verifyMagicLink(t), null)
  })

  test('lixo não derruba a verificação', () => {
    for (const entrada of ['', 'abc', 'a.b.c', 'null']) {
      assert.equal(verifyMagicLink(entrada), null, `entrada: ${entrada}`)
    }
  })
})

describe('o que a retomada devolve', () => {
  test('acha a inscrição do lead neste portal', async () => {
    const achada = await prisma.enrollmentRegistration.findFirst({
      where: { leadId, portalId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, candidateCode: true },
    })
    assert.ok(achada, 'é isto que faz a pessoa voltar ao ponto onde parou em vez de recomeçar')
    assert.equal(achada!.id, inscricaoId)
  })

  test('a inscrição mais recente vence, quando há mais de uma', async () => {
    const segunda = await prisma.enrollmentRegistration.create({
      data: {
        portalId, leadId, candidateCode: `TST2-${Date.now()}`, formData: {}, status: 'pending',
        createdAt: new Date(Date.now() + 60_000),
      },
    })
    const achada = await prisma.enrollmentRegistration.findFirst({
      where: { leadId, portalId }, orderBy: { createdAt: 'desc' }, select: { id: true },
    })
    assert.equal(achada!.id, segunda.id)
    await prisma.enrollmentRegistration.delete({ where: { id: segunda.id } })
  })

  test('o token de candidato devolvido abre a inscrição certa', async () => {
    const { signCandidateToken } = await import('../src/lib/candidateAuth.js')
    const ct = signCandidateToken(inscricaoId, `TST-x`)
    const p = verifyCandidateToken(ct)
    assert.ok(p, 'é este token que autoriza pagar e criar a senha')
    assert.equal(p!.enrollmentId, inscricaoId)
  })
})
