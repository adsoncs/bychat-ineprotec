// tests/contrato-clicksign.test.ts
//
// Contrato em Word da inscrição assinado na CLICKSIGN (API v3, Envelope) — o
// segundo provedor, escolhido por cliente (fabad, 01/10/2026). O que se prova:
//   • o envelope é montado na ordem da Clicksign (envelope → documento →
//     signatário → requisitos → ativar) e um clique duplo não cria dois;
//   • sem o Widget, o convite sai pelo WhatsApp do aluno (a API não dá link);
//     com o Widget, o aluno assina na página (id do signatário + host);
//   • o webhook só vale com HMAC certo (Content-Hmac: sha256=...);
//   • o aviso fecha o envelope pela API, guarda a via assinada AQUI (o link da
//     Clicksign expira em minutos) e grava o aceite na inscrição;
//   • cancelar fala com a Clicksign; envelope "por link" sem widget é barrado.
//
// ⚠️ TOCA O BANCO da demo. Tudo leva o prefixo `test:` e é apagado no fim. A
// Clicksign é um fetch falso: nada sai para o provedor.
//
//   cd backend && node --import tsx --test --test-force-exit tests/contrato-clicksign.test.ts

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.js'
import { iniciarAssinaturaDaInscricao, estadoDaAssinaturaDaInscricao } from '../src/services/contratoDoPortal.js'
import { processarWebhook, cancelar, criar, enviar } from '../src/services/acaAssinatura.js'
import { verificarAssinaturaWebhook } from '../src/services/clicksign.js'
import { lerPdfAssinado } from '../src/services/assinaturaProvedor.js'
import { uploadsPath } from '../src/lib/uploadsDir.js'

const DOCX = readFileSync(new URL('../assets/contratos/modelo-exemplo.docx', import.meta.url))
const SEGREDO = 'segredo-hmac-de-teste'
const ids = {
  unidade: 0, processo: 0, oferta: 0, outraOferta: 0, portal: 0, outroPortal: 0, lead: 0, reg: 0, preg: 0, reg2: 0, preg2: 0, lead2: 0,
  modeloPortal: 0, modeloCurso: 0, modeloSolto: 0, gatilho: 0, aluno: 0, periodo: 0, turma: 0, matricula: 0,
  cursoA: 0, cursoB: 0,
}
let carimbo = ''
const arquivos: string[] = []

// ── Clicksign falsa ──
type Chamada = { metodo: string; caminho: string; corpo: any }
const chamadas: Chamada[] = []
const estado = { fechado: false, assinantes: new Set<string>() }
let seq = 0
const fetchDeVerdade = globalThis.fetch
function clicksignFalsa() {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url)
    if (u.startsWith('https://clicksign-content-sandbox.example/')) {
      return new Response(Buffer.from('%PDF-1.4 via assinada'), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
    }
    if (!u.includes('sandbox.clicksign.com/api/v3')) return fetchDeVerdade(url, init)
    const caminho = u.split('/api/v3')[1]!.split('?')[0]!
    const metodo = String(init?.method || 'GET')
    const corpo = init?.body ? JSON.parse(String(init.body)) : null
    chamadas.push({ metodo, caminho, corpo })
    const j = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/vnd.api+json' } })
    let m: RegExpMatchArray | null
    if (metodo === 'POST' && caminho === '/envelopes') return j({ data: { id: `env-${carimbo}-${++seq}`, type: 'envelopes', attributes: { status: 'draft' } } }, 201)
    if (metodo === 'POST' && (m = caminho.match(/^\/envelopes\/([^/]+)\/documents$/))) return j({ data: { id: `doc-${m[1]}`, type: 'documents' } }, 201)
    if (metodo === 'POST' && (m = caminho.match(/^\/envelopes\/([^/]+)\/signers$/))) return j({ data: { id: `sig-${++seq}-${carimbo}`, type: 'signers', attributes: corpo.data.attributes } }, 201)
    if (metodo === 'POST' && caminho.endsWith('/requirements')) return j({ data: { id: `req-${++seq}`, type: 'requirements' } }, 201)
    if (metodo === 'POST' && caminho.endsWith('/notifications')) return j({ data: { id: `not-${++seq}` } }, 201)
    if (metodo === 'PATCH' && (m = caminho.match(/^\/envelopes\/([^/]+)$/))) return j({ data: { id: m[1], type: 'envelopes', attributes: corpo.data.attributes } })
    if (metodo === 'GET' && (m = caminho.match(/^\/envelopes\/([^/]+)\/documents\/([^/]+)\/events$/))) {
      return j({ data: [...estado.assinantes].map((sid) => ({ id: `ev-${sid}`, type: 'events', attributes: { name: 'sign', data: { signer: { key: sid, email: null } }, created: new Date().toISOString() } })) })
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/envelopes\/([^/]+)\/documents\/([^/]+)$/))) {
      return j({ data: { id: m[2], type: 'documents', attributes: { status: estado.fechado ? 'closed' : 'running' },
        links: { files: { original: 'https://clicksign-content-sandbox.example/original.pdf', ...(estado.fechado ? { signed: 'https://clicksign-content-sandbox.example/assinado.pdf' } : {}) } } } })
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/envelopes\/([^/]+)$/))) return j({ data: { id: m[1], type: 'envelopes', attributes: { status: estado.fechado ? 'closed' : 'running' } } })
    return j({ errors: [{ detail: `rota falsa sem resposta: ${metodo} ${caminho}` }] }, 404)
  }) as typeof fetch
}
const passos = () => chamadas.filter((c) => c.metodo !== 'GET').map((c) => `${c.metodo} ${c.caminho.replace(/env-[^/]+/, ':env').replace(/doc-[^/]+/, ':doc')}`)

before(async () => {
  carimbo = String(Date.now()).slice(-6)
  process.env.ASSINATURA_PROVEDOR = 'CLICKSIGN'
  process.env.CLICKSIGN_ACCESS_TOKEN = 'test-token'
  process.env.CLICKSIGN_WEBHOOK_SECRET = SEGREDO
  process.env.CLICKSIGN_WIDGET = 'false'
  clicksignFalsa()

  const unidade = await prisma.educationalUnit.create({ data: { nome: `test:unidade ccs ${carimbo}` } })
  ids.unidade = unidade.id
  ids.processo = (await prisma.selectionProcess.create({ data: { unitId: unidade.id, nome: `test:processo ccs ${carimbo}` } })).id
  const cursos = await prisma.course.findMany({ select: { id: true }, take: 2, orderBy: { id: 'asc' } })
  ids.cursoA = cursos[0]!.id; ids.cursoB = cursos[1]!.id
  const modalidade = await prisma.modality.findFirst({ select: { id: true } })
  ids.oferta = (await prisma.courseOffering.create({ data: {
    courseId: ids.cursoA, unitId: unidade.id, modalityId: modalidade!.id, selectionProcessId: ids.processo, nome: `test:oferta ccs ${carimbo}`,
    tabelaPrecos: { aVista: 2700, cartao: { parcelas: 12, valorParcela: 250 }, boleto: { parcelas: 18, valorParcela: 180 } },
  } })).id
  const portal = (nome: string) => prisma.enrollmentPortal.create({
    data: {
      nome, slug: `test-ccs-${nome.length}-${carimbo}`, unitId: unidade.id, active: true, requirePayment: false, selectionProcessIds: [ids.processo], formConfig: {},
      jornadaEtapas: { inscricao: [{ chave: 'contrato', ativo: true, obrigatoria: true }] },
    },
  })
  ids.portal = (await portal(`test:portal ccs ${carimbo}`)).id
  ids.outroPortal = (await portal(`test:portal ccs outro ${carimbo}`)).id

  const lead = await prisma.lead.create({ data: { nome: 'test:Pedro Henrique Lima', empresa: 'test:ccs', whatsapp: '', email: `ccs.${carimbo}@local.invalid`, formData: {}, scores: {} } })
  ids.lead = lead.id
  ids.preg = (await prisma.processRegistration.create({ data: { leadId: lead.id, offeringId: ids.oferta, selectionProcessId: ids.processo } })).id
  ids.reg = (await prisma.enrollmentRegistration.create({ data: {
    portalId: ids.portal, leadId: lead.id, processRegistrationId: ids.preg, candidateCode: `TCS-${carimbo}`, status: 'pending',
    formData: { nome: 'test:Pedro Henrique Lima', cpf: '52998224725', email: `ccs.${carimbo}@local.invalid`, whatsapp: '5511987654321', nascimento: '10/05/1995', campusNome: 'Polo Teste' },
  } })).id

  const modelo = (nome: string, portalIds: number[], cursoIds: number[]) => prisma.acaContratoTemplate.create({
    data: { nome, corpoTexto: '', arquivoDocx: DOCX.toString('base64'), arquivoDocxNome: 'modelo.docx', portalIds, cursoIds, ordem: 900 },
  })
  ids.modeloPortal = (await modelo(`test:contrato do portal ${carimbo}`, [ids.portal], [])).id
  ids.modeloSolto = (await modelo(`test:contrato sem vínculo ${carimbo}`, [], [])).id
})

async function tentar(o: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e: any) { console.warn(`[limpeza] ${o}: ${e?.message || e}`) }
}

after(async () => {
  globalThis.fetch = fetchDeVerdade
  for (const k of ['ASSINATURA_PROVEDOR', 'CLICKSIGN_ACCESS_TOKEN', 'CLICKSIGN_WEBHOOK_SECRET', 'CLICKSIGN_WIDGET']) delete process.env[k]
  for (const f of arquivos) await tentar('arquivo', () => import('node:fs/promises').then((fs) => fs.unlink(f)))
  const envs = await prisma.acaAssinatura.findMany({ where: { OR: [{ registrationId: { in: [ids.reg, ids.reg2 || -1] } }, { alunoId: ids.aluno || -1 }] }, select: { id: true } })
  await tentar('ged', () => prisma.acaGedArquivo.deleteMany({ where: { alunoId: ids.aluno || -1 } }))
  await tentar('envelopes', () => prisma.acaAssinatura.deleteMany({ where: { id: { in: envs.map((e) => e.id) } } }))
  await tentar('gatilho', () => prisma.acaContratoGatilho.deleteMany({ where: { id: ids.gatilho || -1 } }))
  await tentar('modelos', () => prisma.acaContratoTemplate.deleteMany({ where: { id: { in: [ids.modeloPortal, ids.modeloCurso, ids.modeloSolto].filter(Boolean) } } }))
  await tentar('eventos mat.', () => prisma.acaMatriculaEvento.deleteMany({ where: { matriculaId: ids.matricula || -1 } }))
  await tentar('matrícula', () => prisma.acaMatricula.deleteMany({ where: { id: ids.matricula || -1 } }))
  await tentar('turma', () => prisma.acaTurma.deleteMany({ where: { id: ids.turma || -1 } }))
  await tentar('período', () => prisma.acaPeriodoLetivo.deleteMany({ where: { id: ids.periodo || -1 } }))
  await tentar('aluno', () => prisma.aluno.deleteMany({ where: { id: ids.aluno || -1 } }))
  await tentar('inscrição', () => prisma.enrollmentRegistration.deleteMany({ where: { id: { in: [ids.reg, ids.reg2 || -1] } } }))
  await tentar('inscr. processo', () => prisma.processRegistration.deleteMany({ where: { id: { in: [ids.preg, ids.preg2 || -1] } } }))
  await tentar('eventos', () => prisma.leadEvent.deleteMany({ where: { leadId: { in: [ids.lead, ids.lead2 || -1] } } }))
  await tentar('lead', () => prisma.lead.deleteMany({ where: { id: { in: [ids.lead, ids.lead2 || -1] } } }))
  await tentar('portais', () => prisma.enrollmentPortal.deleteMany({ where: { id: { in: [ids.portal, ids.outroPortal] } } }))
  await tentar('oferta', () => prisma.courseOffering.deleteMany({ where: { id: ids.oferta } }))
  await tentar('processo', () => prisma.selectionProcess.deleteMany({ where: { id: ids.processo } }))
  await tentar('unidade', () => prisma.educationalUnit.deleteMany({ where: { id: ids.unidade } }))
  await prisma.$disconnect()
})

describe('assinatura na Clicksign (sem widget)', () => {
  test('monta o envelope na ordem da Clicksign — e dois cliques geram um só', async () => {
    const [a, b] = await Promise.all([iniciarAssinaturaDaInscricao(ids.reg), iniciarAssinaturaDaInscricao(ids.reg)])
    assert.ok([a, b].some((x) => x.ok), JSON.stringify([a, b]))
    assert.deepEqual(passos(), [
      'POST /envelopes', 'POST /envelopes/:env/documents', 'POST /envelopes/:env/signers',
      'POST /envelopes/:env/requirements', 'POST /envelopes/:env/requirements', 'PATCH /envelopes/:env',
    ])
    assert.equal(await prisma.acaAssinatura.count({ where: { registrationId: ids.reg, status: { not: 'CANCELADO' } } }), 1)
    const pdf = chamadas.find((c) => c.caminho.endsWith('/documents'))!.corpo.data.attributes.content_base64
    assert.ok(String(pdf).startsWith('data:application/pdf;base64,JVBER'), 'o PDF do Word vai em base64 com o prefixo de data URI')
    assert.equal(chamadas.find((c) => c.metodo === 'PATCH')!.corpo.data.attributes.status, 'running')
  })

  test('sem link na API: o convite vai pelo WhatsApp do aluno, e o token também', async () => {
    const sg = chamadas.find((c) => c.caminho.endsWith('/signers'))!.corpo.data.attributes
    assert.equal(sg.communicate_events.signature_request, 'whatsapp')
    assert.equal(sg.phone_number, '11987654321', 'sem o 55: a Clicksign quer 10–11 dígitos')
    // Igual à Autentique: CPF só é cobrado na assinatura quando o modelo exige.
    assert.equal(sg.has_documentation, false)
    assert.equal(sg.documentation, undefined)
    const reqs = chamadas.filter((c) => c.caminho.endsWith('/requirements')).map((c) => c.corpo.data.attributes)
    assert.deepEqual(reqs, [{ action: 'agree', role: 'sign' }, { action: 'provide_evidence', auth: 'whatsapp' }])
    const env = await prisma.acaAssinatura.findFirst({ where: { registrationId: ids.reg }, include: { signatarios: true } })
    assert.equal(env?.provider, 'CLICKSIGN')
    assert.match(env!.pastaExternaId!, /^env-/)
    assert.match(env!.documentoExternoId!, /^doc-env-/)
    assert.equal(env!.signatarios[0]!.deliveryMethod, 'WHATSAPP')
    assert.equal(env!.signatarios[0]!.linkAssinatura, null)
    const e = await estadoDaAssinaturaDaInscricao(ids.reg)
    assert.equal(e?.widget, null)
    assert.equal(e?.signatarios[0]?.canal, 'WHATSAPP')
  })

  test('webhook só vale com o HMAC certo', async () => {
    const corpo = Buffer.from(JSON.stringify({ event: { name: 'sign' } }))
    const hmac = crypto.createHmac('sha256', SEGREDO).update(corpo).digest('hex')
    assert.equal(await verificarAssinaturaWebhook(corpo, `sha256=${hmac}`), 'ok')
    assert.equal(await verificarAssinaturaWebhook(corpo, `sha256=${'0'.repeat(64)}`), 'invalida')
    assert.equal(await verificarAssinaturaWebhook(corpo, undefined), 'invalida')
  })

  test('aviso de fechamento: confirma na API, guarda a via assinada aqui e grava o aceite', async () => {
    const env = await prisma.acaAssinatura.findFirst({ where: { registrationId: ids.reg }, include: { signatarios: true } })
    estado.assinantes.add(env!.signatarios[0]!.publicId!)
    estado.fechado = true
    // Formato do aviso da Clicksign: o documento vem por `document.key`.
    await processarWebhook({ event: { name: 'auto_close', data: {} }, document: { key: env!.documentoExternoId, status: 'closed' } })
    const fim = await prisma.acaAssinatura.findUnique({ where: { id: env!.id }, include: { signatarios: true } })
    assert.equal(fim?.status, 'ASSINADO')
    assert.equal(fim?.signatarios[0]?.status, 'ASSINADO')
    assert.match(fim!.arquivoAssinadoUrl!, /^\/uploads\/contratos\/assinado-\d+-[0-9a-f]{24}\.pdf$/, 'link da Clicksign expira: a via fica no sistema, com nome não adivinhável')
    arquivos.push(uploadsPath(fim!.arquivoAssinadoUrl!.slice('/uploads/'.length)))
    const pdf = await lerPdfAssinado(fim!.arquivoAssinadoUrl)
    assert.equal(pdf?.subarray(0, 4).toString(), '%PDF')
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: ids.reg }, select: { contratoAceite: true } })
    const aceite = reg?.contratoAceite as any
    assert.equal(aceite?.via, 'CLICKSIGN')
    assert.match(aceite.termo, /na Clicksign/)
  })
})

describe('assinatura na Clicksign (com widget)', () => {
  test('o aluno assina na página: sem convite, com o id do signatário e o host certo', async () => {
    process.env.CLICKSIGN_WIDGET = 'true'
    try {
      const lead = await prisma.lead.create({ data: { nome: 'test:Ana Clara Menezes', empresa: 'test:ccs', whatsapp: '', email: `ccs2.${carimbo}@local.invalid`, formData: {}, scores: {} } })
      ids.lead2 = lead.id
      ids.preg2 = (await prisma.processRegistration.create({ data: { leadId: lead.id, offeringId: ids.oferta, selectionProcessId: ids.processo } })).id
      ids.reg2 = (await prisma.enrollmentRegistration.create({ data: {
        portalId: ids.portal, leadId: lead.id, processRegistrationId: ids.preg2, candidateCode: `TCY-${carimbo}`, status: 'pending',
        formData: { nome: 'test:Ana Clara Menezes', cpf: '11144477735', email: `ccs2.${carimbo}@local.invalid`, nascimento: '01/02/1990' },
      } })).id
      const antes = chamadas.length
      const r = await iniciarAssinaturaDaInscricao(ids.reg2)
      assert.equal(r.ok, true, JSON.stringify(r))
      const sg = chamadas.slice(antes).find((c) => c.caminho.endsWith('/signers'))!.corpo.data.attributes
      assert.equal(sg.communicate_events.signature_request, 'none', 'com widget a Clicksign não manda convite')
      const a = (r as any).assinatura
      assert.equal(a.widget?.endpoint, 'https://sandbox.clicksign.com')
      const aluno = a.signatarios.find((s: any) => s.papel === 'ALUNO')
      assert.match(aluno.widgetId, /^sig-/)
      assert.equal(aluno.canal, 'LINK')
    } finally {
      process.env.CLICKSIGN_WIDGET = 'false'
    }
  })

  test('cancelar o envelope cancela na Clicksign', async () => {
    const env = await prisma.acaAssinatura.findFirst({ where: { registrationId: ids.reg2 } })
    await cancelar(env!.id)
    const p = chamadas.filter((c) => c.metodo === 'PATCH' && c.caminho === `/envelopes/${env!.pastaExternaId}`).pop()
    assert.equal(p?.corpo.data.attributes.status, 'canceled')
    assert.equal((await prisma.acaAssinatura.findUnique({ where: { id: env!.id } }))?.status, 'CANCELADO')
  })

  test('sem widget, signatário "por link" é barrado antes de gastar um envelope', async () => {
    const env = await criar({ titulo: 'test:por link', origem: 'ESCRITO', corpoTexto: 'Contrato de teste.', registrationId: ids.reg2,
      signatarios: [{ nome: 'test:Fulano de Tal', papel: 'ALUNO', deliveryMethod: 'LINK' }] } as any)
    const antes = chamadas.length
    await assert.rejects(() => enviar(env.id), /não gera link de assinatura/)
    assert.equal(chamadas.length, antes, 'nenhuma chamada à Clicksign')
  })
})
