// tests/curso-do-link.test.ts
//
// Link direto para um curso no portal: /portal/<portal>/<curso>.
//
// É o botão "Matricule-se" da página do curso no site. O que se prova: o
// portal abre só com aquele curso (e a etapa de escolha some), um link errado
// ou de outro portal cai na lista de sempre — nunca numa tela de erro —, os
// caminhos que o portal já usa não podem virar endereço de curso, e o servidor
// recusa uma inscrição em outro curso que não o do link.
//
// ⚠️ A parte HTTP TOCA O BANCO da demo e fala com o servidor dela. Tudo leva o
// prefixo `test:` e é apagado no fim.
//
//   cd backend && node --import tsx --test --test-force-exit tests/curso-do-link.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma.js'
import { normalizarSlugCurso, validarSlugCurso, cursoPedido, SLUGS_RESERVADOS } from '../src/services/cursoDoLink.js'
import { BASE } from './apoio.js'

const RAIZ = BASE.replace(/\/api$/, '')

describe('endereço do curso', () => {
  test('normaliza acento, espaço e caixa', () => {
    assert.equal(normalizarSlugCurso('Técnico em Agrimensura'), 'tecnico-em-agrimensura')
    assert.equal(normalizarSlugCurso('  NR 10 – Trabalho '), 'nr-10-trabalho')
    assert.equal(normalizarSlugCurso('TEC-AGRI'), 'tec-agri')
  })

  test('recusa os caminhos que o portal já usa', () => {
    for (const r of ['contrato', 'documentos', 'aluno', 'Contrato']) {
      assert.ok('erro' in validarSlugCurso(r), `${r} deveria ser recusado`)
    }
    assert.ok(SLUGS_RESERVADOS.has('aca'))
  })

  test('vazio apaga, curto demais é recusado', () => {
    assert.deepEqual(validarSlugCurso(''), { slug: null })
    assert.deepEqual(validarSlugCurso(null), { slug: null })
    assert.ok('erro' in validarSlugCurso('a'))
  })

  test('o caminho vence o ?curso=, e reservado não conta como pedido', () => {
    assert.equal(cursoPedido('cipa', 'nr-10'), 'cipa')
    assert.equal(cursoPedido(undefined, 'NR-10'), 'nr-10')
    assert.equal(cursoPedido('documentos', null), null)
  })
})

const ids = { unidade: 0, processo: 0, outroProcesso: 0, portal: 0, ofertaA: 0, ofertaB: 0, ofertaOutra: 0 }
let carimbo = ''
let slugPortal = ''

before(async () => {
  carimbo = String(Date.now()).slice(-7)
  slugPortal = `test-link-${carimbo}`
  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade link ${carimbo}` } })
  ids.unidade = unidade.id
  const processo = await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo link ${carimbo}` } })
  ids.processo = processo.id
  const outro = await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo outro ${carimbo}` } })
  ids.outroProcesso = outro.id
  const curso = await prisma.course.findFirst({ select: { id: true } })
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  const base = { courseId: curso!.id, unitId: unidade.id, modalityId: modalidade!.id }
  ids.ofertaA = (await prisma.courseOffering.create({ data: { ...base, selectionProcessId: processo.id, nome: `test:Curso A ${carimbo}`, slug: `test-a-${carimbo}` } })).id
  ids.ofertaB = (await prisma.courseOffering.create({ data: { ...base, selectionProcessId: processo.id, nome: `test:Curso B ${carimbo}`, slug: `test-b-${carimbo}` } })).id
  // Curso de OUTRO portal: o link dele não pode abrir neste.
  ids.ofertaOutra = (await prisma.courseOffering.create({ data: { ...base, selectionProcessId: outro.id, nome: `test:Curso de fora ${carimbo}`, slug: `test-fora-${carimbo}` } })).id
  const portal = await prisma.enrollmentPortal.create({
    data: {
      nome: `test:portal link ${carimbo}`, slug: slugPortal, unitId: unidade.id, active: true,
      selectionProcessIds: [processo.id], formConfig: {}, metaTitle: 'Matrícula Teste',
    },
  })
  ids.portal = portal.id
})

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  await tentar('portal', () => prisma.enrollmentPortal.deleteMany({ where: { nome: { startsWith: 'test:portal link ' } } }))
  await tentar('ofertas', () => prisma.courseOffering.deleteMany({ where: { id: { in: [ids.ofertaA, ids.ofertaB, ids.ofertaOutra] } } }))
  await tentar('processos', () => prisma.selectionProcess.deleteMany({ where: { id: { in: [ids.processo, ids.outroProcesso] } } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

const dados = async (q = '') => (await fetch(`${BASE}/public/portals/${slugPortal}${q}`)).json() as Promise<any>

describe('o portal aberto pelo link', () => {
  test('sem curso: a lista inteira do portal', async () => {
    const d = await dados()
    assert.equal(d.offerings.length, 2)
    assert.equal(d.cursoDoLink, null)
  })

  test('com o curso: só ele, e o portal sabe que veio do link', async () => {
    const d = await dados(`?curso=test-a-${carimbo}`)
    assert.deepEqual(d.offerings.map((o: any) => o.id), [ids.ofertaA])
    assert.equal(d.cursoDoLink.offeringId, ids.ofertaA)
  })

  test('curso de outro portal: lista de sempre, sem erro', async () => {
    const d = await dados(`?curso=test-fora-${carimbo}`)
    assert.equal(d.offerings.length, 2)
    assert.equal(d.cursoDoLink, null)
  })

  test('curso que não existe: lista de sempre, sem erro', async () => {
    const d = await dados('?curso=nao-existe-nada')
    assert.equal(d.offerings.length, 2)
  })

  test('a página /portal/<portal>/<curso> abre, com o curso no título', async () => {
    const r = await fetch(`${RAIZ}/portal/${slugPortal}/test-a-${carimbo}`)
    assert.equal(r.status, 200)
    const html = await r.text()
    assert.match(html, new RegExp(`<title>test:Curso A ${carimbo} — Matrícula Teste</title>`))
    assert.match(html, new RegExp(`/portal/${slugPortal}/test-a-${carimbo}"`))
  })

  test('caminho reservado não vira curso', async () => {
    const r = await fetch(`${RAIZ}/portal/${slugPortal}/contrato`)
    assert.equal(r.status, 404)
  })

  test('o envio recusa um curso diferente do link', async () => {
    const r = await fetch(`${BASE}/public/portals/${slugPortal}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        curso: `test-a-${carimbo}`,
        formData: { nome: 'test:Link', email: `test.link.${carimbo}@local.invalid`, offeringId: ids.ofertaB, lgpdConsent: true },
      }),
    })
    assert.equal(r.status, 400)
    assert.match((await r.json() as any).error, /curso deste link/)
  })
})
