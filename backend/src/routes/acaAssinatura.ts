// src/routes/acaAssinatura.ts
// Módulo Acadêmico · Assinatura de Contratos (aca_assinatura) — Autentique + modo SIMULADO.

import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import * as svc from '../services/acaAssinatura.js'
import { validarModelo, gerarPdfDoModelo } from '../services/contratoWord.js'
import { CAMPOS_CONTRATO, camposDesconhecidos, varsDeExemplo, dadosDoContratoDaInscricao } from '../services/contratoDoPortal.js'
import { getConfig, setConfig, verificarAssinaturaWebhook } from '../services/autentique.js'

const ENV_INCLUDE = { signatarios: { orderBy: { ordem: 'asc' as const } } }
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const listaDeIds = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [])

/**
 * Contratos assinados no Portal — Fase 5.
 *
 * Desde que a assinatura passou a acontecer no portal do aluno, um contrato pode
 * estar assinado sem que exista envelope de provedor externo. Esta tela é o
 * histórico da instituição: se ela listasse só envelopes, uma assinatura feita
 * pelo Portal simplesmente não apareceria em lugar nenhum do ERP.
 */
async function aceitesDoPortal(q: any) {
  // O filtro por status da tela é o do envelope; um aceite só entra na lista
  // quando ela não está filtrando por outro status que não "ASSINADO".
  if (q.status && q.status !== 'ASSINADO') return []
  const where: any = { aceiteEm: { not: null } }
  if (q.alunoId) where.matricula = { alunoId: Number(q.alunoId) }
  const rows = await prisma.acaContrato.findMany({
    where, orderBy: { aceiteEm: 'desc' }, take: 200,
    select: {
      id: true, aceiteEm: true, aceiteNome: true, aceiteIp: true, matriculaId: true,
      matricula: { select: { id: true, status: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } } },
    },
  })
  return rows.map((c) => ({
    contratoId: c.id,
    matriculaId: c.matriculaId,
    alunoNome: c.matricula?.aluno?.lead?.nome ?? null,
    ra: c.matricula?.aluno?.ra ?? null,
    assinadoEm: c.aceiteEm,
    assinadoPor: c.aceiteNome,
    ip: c.aceiteIp,
    matriculaStatus: c.matricula?.status ?? null,
  }))
}


/**
 * Modelos de contrato (Word/texto), campos, prévia e a configuração da
 * Autentique. São do PORTAL DE MATRÍCULAS — existem sem o ERP (quem só tem
 * Educacional + Portal contrata e assina na inscrição). O ERP, quando ativo,
 * lê e edita os MESMOS dados pela rota dele: são registradas duas vezes, cada
 * uma sob o prefixo e a permissão do seu módulo (moduleRegistry).
 */
export const BASE_CONTRATOS_PORTAL = '/api/admin/enrollment-portals/contratos'
function rotasDosModelos(app: FastifyInstance, base: string) {
  // ── Config (sem expor tokens) ──
  // Um provedor escolhido por cliente (Autentique, Clicksign ou só o aceite no
  // portal); cada um com a sua credencial. `modo` segue na resposta para a tela
  // antiga do ERP, que só conhece SIMULADO|AUTENTIQUE.
  const configPublica = async () => {
    const c = await getConfig()
    const { getWebhookSecret } = await import('../services/autentique.js')
    const cs = await import('../services/clicksign.js')
    const { provedorEscolhido, provedorAtivo } = await import('../services/assinaturaProvedor.js')
    const k = await cs.getConfig()
    return {
      provedor: await provedorEscolhido(), provedorAtivo: await provedorAtivo(),
      modo: c.modo, sandbox: c.sandbox, tokenConfigurado: !!c.token, webhookSecretConfigurado: !!(await getWebhookSecret()),
      clicksign: { sandbox: k.sandbox, widget: k.widget, tokenConfigurado: !!k.token, webhookSecretConfigurado: !!k.webhookSecret },
    }
  }
  app.get(`${base}/config`, { preHandler: authMiddleware }, async () => configPublica())
  app.put(`${base}/config`, { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (b.provedor === undefined) {
      // Tela antiga (só Autentique): mesmo comportamento de antes.
      await setConfig({ modo: b.modo, token: b.token, sandbox: b.sandbox, webhookSecret: b.webhookSecret })
    } else {
      const { setProvedor } = await import('../services/assinaturaProvedor.js')
      try { await setProvedor(String(b.provedor)) } catch (e: any) { return reply.code(400).send({ error: e.message }) }
      if (b.autentique) await setConfig({ token: b.autentique.token, sandbox: b.autentique.sandbox, webhookSecret: b.autentique.webhookSecret, modo: b.provedor === 'AUTENTIQUE' ? 'AUTENTIQUE' : 'SIMULADO' })
      if (b.clicksign) {
        const cs = await import('../services/clicksign.js')
        await cs.setConfig({ token: b.clicksign.token, sandbox: b.clicksign.sandbox, webhookSecret: b.clicksign.webhookSecret, widget: b.clicksign.widget })
      }
    }
    return configPublica()
  })
  // Testa a credencial da Clicksign sem criar nada (lista 1 envelope).
  app.post(`${base}/config/testar-clicksign`, { preHandler: authMiddleware }, async () => {
    const cs = await import('../services/clicksign.js')
    return cs.ping(await cs.getConfig())
  })

  app.get(`${base}/variaveis`, { preHandler: authMiddleware }, async () => ({ variaveis: svc.VARIAVEIS_DISPONIVEIS }))

  // ── Templates de contrato (por tipo de negócio) ──
  // O .docx (base64) não vai na lista: pesa, e a tela só precisa saber que existe.
  const semArquivo = ({ arquivoDocx, ...t }: any) => ({ ...t, temWord: !!arquivoDocx })
  app.get(`${base}/templates`, { preHandler: authMiddleware }, async () =>
    ({ templates: (await prisma.acaContratoTemplate.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })).map(semArquivo) }))
  app.post(`${base}/templates`, { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    // Modelo em Word pode nascer sem texto: o arquivo sobe logo depois.
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const t = await prisma.acaContratoTemplate.create({ data: {
      nome: String(b.nome).slice(0, 191), tipoNegocio: b.tipoNegocio || 'OUTRO', descricao: b.descricao || null,
      corpoTexto: String(b.corpoTexto ?? ''), config: b.config ?? null, signatariosPadrao: b.signatariosPadrao ?? null,
      ativo: b.ativo !== false, ordem: Number(b.ordem) || 0,
      portalIds: listaDeIds(b.portalIds), cursoIds: listaDeIds(b.cursoIds),
    } })
    return reply.code(201).send({ template: semArquivo(t) })
  })
  app.put(`${base}/templates/:id`, { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}; const data: any = {}
    for (const k of ['nome', 'tipoNegocio', 'descricao', 'corpoTexto']) if (k in b) data[k] = b[k]
    if ('config' in b) data.config = b.config ?? null
    if ('signatariosPadrao' in b) data.signatariosPadrao = b.signatariosPadrao ?? null
    if ('ativo' in b) data.ativo = !!b.ativo
    if ('ordem' in b) data.ordem = Number(b.ordem) || 0
    if ('portalIds' in b) data.portalIds = listaDeIds(b.portalIds)
    if ('cursoIds' in b) data.cursoIds = listaDeIds(b.cursoIds)
    return { template: semArquivo(await prisma.acaContratoTemplate.update({ where: { id: Number((req.params as any).id) }, data })) }
  })

  // ── Contrato em Word (.docx com {{campos}}) ──
  app.get(`${base}/campos-word`, { preHandler: authMiddleware }, async () => ({ campos: CAMPOS_CONTRATO }))

  // Onde o modelo vale: portais e cursos, para os seletores da tela.
  app.get(`${base}/opcoes-vinculo`, { preHandler: authMiddleware }, async () => ({
    portais: await prisma.enrollmentPortal.findMany({ select: { id: true, nome: true, slug: true }, orderBy: { nome: 'asc' } }),
    cursos: await prisma.course.findMany({ where: { active: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
  }))

  // Modelo de exemplo com todos os campos — ponto de partida para o jurídico.
  app.get(`${base}/modelo-exemplo.docx`, { preHandler: authMiddleware }, async (_req, reply) => {
    const { readFile } = await import('node:fs/promises')
    const buf = await readFile(new URL('../../assets/contratos/modelo-exemplo.docx', import.meta.url))
    return reply.header('Content-Type', DOCX).header('Content-Disposition', 'attachment; filename="modelo-de-contrato.docx"').send(buf)
  })

  app.put(`${base}/templates/:id/word`, { preHandler: authMiddleware, bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const b = (req.body as any) || {}
    const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]+,/, ''), 'base64')
    if (!buf.length) return reply.code(400).send({ error: 'Envie o arquivo .docx.' })
    if (buf.length > 12 * 1024 * 1024) return reply.code(400).send({ error: 'Arquivo acima de 12 MB — reduza as imagens do Word.' })
    const v = validarModelo(buf)
    if (!v.ok) return reply.code(400).send({ error: v.erro })
    const t = await prisma.acaContratoTemplate.update({
      where: { id: Number((req.params as any).id) },
      data: { arquivoDocx: buf.toString('base64'), arquivoDocxNome: String(b.nome || 'contrato.docx').slice(0, 191), camposDocx: v.campos },
    })
    return { template: semArquivo(t), campos: v.campos, desconhecidos: camposDesconhecidos(v.campos) }
  })
  app.delete(`${base}/templates/:id/word`, { preHandler: authMiddleware }, async (req) => {
    const t = await prisma.acaContratoTemplate.update({
      where: { id: Number((req.params as any).id) }, data: { arquivoDocx: null, arquivoDocxNome: null, camposDocx: Prisma.DbNull },
    })
    return { template: semArquivo(t) }
  })
  app.get(`${base}/templates/:id/word`, { preHandler: authMiddleware }, async (req, reply) => {
    const t = await prisma.acaContratoTemplate.findUnique({ where: { id: Number((req.params as any).id) }, select: { arquivoDocx: true, arquivoDocxNome: true } })
    if (!t?.arquivoDocx) return reply.code(404).send({ error: 'Este modelo não tem arquivo Word.' })
    const nome = (t.arquivoDocxNome || 'contrato.docx').replace(/[^\w.\- ]+/g, '_')
    return reply.header('Content-Type', DOCX).header('Content-Disposition', `attachment; filename="${nome}"`).send(Buffer.from(t.arquivoDocx, 'base64'))
  })

  // Pré-visualização em PDF: com dados de exemplo, ou de uma inscrição real
  // (código da inscrição) — os campos sem valor voltam no cabeçalho.
  app.post(`${base}/templates/:id/previa`, { preHandler: authMiddleware }, async (req, reply) => {
    const t = await prisma.acaContratoTemplate.findUnique({ where: { id: Number((req.params as any).id) }, select: { arquivoDocx: true } })
    if (!t?.arquivoDocx) return reply.code(404).send({ error: 'Suba o arquivo Word antes de pré-visualizar.' })
    const codigo = String((req.body as any)?.inscricao || '').trim()
    let vars = varsDeExemplo()
    if (codigo) {
      const reg = await prisma.enrollmentRegistration.findFirst({ where: { OR: [{ candidateCode: codigo }, ...(/^\d+$/.test(codigo) ? [{ id: Number(codigo) }] : [])] }, select: { id: true } })
      const d = reg ? await dadosDoContratoDaInscricao(reg.id) : null
      if (!d) return reply.code(404).send({ error: 'Inscrição não encontrada ou sem curso escolhido.' })
      vars = d.vars
    }
    try {
      const { pdf, faltando } = await gerarPdfDoModelo(Buffer.from(t.arquivoDocx, 'base64'), vars)
      return reply.header('Content-Type', 'application/pdf').header('X-Campos-Faltando', encodeURIComponent(faltando.join(','))).send(pdf)
    } catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao gerar o PDF' }) }
  })
  app.delete(`${base}/templates/:id`, { preHandler: authMiddleware }, async (req) => {
    await prisma.acaContratoTemplate.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

}

/**
 * Contratos das inscrições, no Portal de Matrículas (sem depender do ERP):
 * quem assinou, em que pé está a assinatura e o PDF.
 */
function rotasDosContratosDasInscricoes(app: FastifyInstance) {
  const base = BASE_CONTRATOS_PORTAL

  // Lista: envelopes das inscrições + aceites do termo simples (sem envelope).
  app.get(`${base}/inscricoes`, { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    const portalId = Number(q.portalId) || undefined
    const envs = await prisma.acaAssinatura.findMany({
      where: { registrationId: { not: null }, status: { not: 'CANCELADO' } },
      orderBy: { id: 'desc' }, take: 500,
      select: { id: true, titulo: true, status: true, provider: true, registrationId: true, enviadoEm: true, finalizadoEm: true, arquivoAssinadoUrl: true,
        signatarios: { select: { status: true } } },
    })
    const regIds = [...new Set(envs.map((e) => e.registrationId!))]
    const comAceite = await prisma.enrollmentRegistration.findMany({
      where: { NOT: [{ contratoAceite: { equals: Prisma.DbNull } }, { id: { in: regIds.length ? regIds : [-1] } }], ...(portalId ? { portalId } : {}) },
      select: { id: true }, take: 500, orderBy: { id: 'desc' },
    }).catch(() => [])
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { id: { in: [...regIds, ...comAceite.map((r) => r.id)] }, ...(portalId ? { portalId } : {}) },
      select: { id: true, candidateCode: true, portalId: true, contratoAceite: true, lead: { select: { nome: true } }, portal: { select: { nome: true } },
        processRegistration: { select: { offering: { select: { nome: true } } } } },
    })
    const porId = new Map(regs.map((r) => [r.id, r]))
    const linha = (r: (typeof regs)[number]) => ({
      registrationId: r.id, candidateCode: r.candidateCode, portalId: r.portalId, portalNome: r.portal?.nome ?? null,
      nome: r.lead?.nome ?? null, curso: r.processRegistration?.offering?.nome ?? null,
    })
    const itens = [
      ...envs.filter((e) => porId.has(e.registrationId!)).map((e) => ({
        ...linha(porId.get(e.registrationId!)!), envelopeId: e.id, titulo: e.titulo, status: e.status, provedor: e.provider,
        assinados: e.signatarios.filter((s) => s.status === 'ASSINADO').length, total: e.signatarios.length,
        enviadoEm: e.enviadoEm, assinadoEm: e.finalizadoEm,
      })),
      ...regs.filter((r) => !regIds.includes(r.id) && (r.contratoAceite as any)?.em).map((r) => ({
        ...linha(r), envelopeId: null, titulo: 'Termo de aceite', status: 'ASSINADO', provedor: 'TERMO',
        assinados: 1, total: 1, enviadoEm: null, assinadoEm: (r.contratoAceite as any).em,
      })),
    ]
    return { contratos: itens }
  })

  // Contrato de uma inscrição (card no detalhe da inscrição).
  app.get(`${base}/inscricao/:regId`, { preHandler: authMiddleware }, async (req) => {
    const regId = Number((req.params as any).regId)
    const { estadoDaAssinaturaDaInscricao, dadosDoContratoDaInscricao, modeloDoPortal, assinaturaEletronicaAtiva } = await import('../services/contratoDoPortal.js')
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: regId }, select: { contratoAceite: true } })
    const d = await dadosDoContratoDaInscricao(regId).catch(() => null)
    const modelo = d ? await modeloDoPortal(d.portalId, d.courseId) : null
    const aceite = (reg?.contratoAceite ?? null) as any
    return {
      modelo: modelo ? { id: modelo.id, nome: modelo.nome } : null,
      eletronica: await assinaturaEletronicaAtiva(),
      assinatura: await estadoDaAssinaturaDaInscricao(regId),
      aceite: aceite?.em ? { em: aceite.em, nome: aceite.nome ?? null, via: aceite.via ?? 'TERMO', ip: aceite.ip || null } : null,
    }
  })

  app.post(`${base}/inscricao/:regId/sincronizar`, { preHandler: authMiddleware }, async (req) => {
    const { estadoDaAssinaturaDaInscricao } = await import('../services/contratoDoPortal.js')
    return { assinatura: await estadoDaAssinaturaDaInscricao(Number((req.params as any).regId), true) }
  })

  // PDF: o assinado (do provedor, ou a cópia guardada aqui) quando existe; senão o que foi para assinatura.
  app.get(`${base}/envelope/:id/pdf`, { preHandler: authMiddleware }, async (req, reply) => {
    const env = await prisma.acaAssinatura.findUnique({ where: { id: Number((req.params as any).id) }, select: { id: true, registrationId: true, titulo: true, arquivoAssinadoUrl: true } })
    if (!env?.registrationId) return reply.code(404).send({ error: 'Contrato não encontrado' })
    let pdf: Buffer | null = null
    if (env.arquivoAssinadoUrl) {
      const { lerPdfAssinado } = await import('../services/assinaturaProvedor.js')
      pdf = await lerPdfAssinado(env.arquivoAssinadoUrl)
    }
    if (!pdf) pdf = (await svc.gerarPdf(env.id)).buffer
    const nome = `contrato-${env.registrationId}.pdf`
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${nome}"`).send(pdf)
  })
}

export async function acaAssinaturaRoutes(app: FastifyInstance) {
  rotasDosModelos(app, BASE_CONTRATOS_PORTAL)
  rotasDosModelos(app, '/api/admin/aca/assinatura')
  rotasDosContratosDasInscricoes(app)


  // ── Lista ──
  app.get('/api/admin/aca/assinatura', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const rows = await prisma.acaAssinatura.findMany({
      where, orderBy: { id: 'desc' }, take: 200,
      include: { signatarios: { select: { id: true, status: true } } },
    })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId).filter(Boolean))] as number[]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    return {
      envelopes: rows.map((r) => ({
        id: r.id, titulo: r.titulo, status: r.status, provider: r.provider, enviadoEm: r.enviadoEm, finalizadoEm: r.finalizadoEm,
        alunoNome: r.alunoId ? aMap.get(r.alunoId)?.lead.nome ?? null : null,
        ra: r.alunoId ? aMap.get(r.alunoId)?.ra ?? null : null,
        totalSignatarios: r.signatarios.length, assinados: r.signatarios.filter((s) => s.status === 'ASSINADO').length,
      })),
      aceites: await aceitesDoPortal(q),
    }
  })

  // ── Detalhe ──
  app.get('/api/admin/aca/assinatura/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const env = await prisma.acaAssinatura.findUnique({ where: { id: Number((req.params as any).id) }, include: ENV_INCLUDE })
    if (!env) return reply.code(404).send({ error: 'Envelope não encontrado' })
    return { envelope: env }
  })

  // ── Criar (escrito / upload / inline) ──
  app.post('/api/admin/aca/assinatura', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.titulo) return reply.code(400).send({ error: 'título obrigatório' })
    const env = await svc.criar({
      alunoId: b.alunoId ? Number(b.alunoId) : null, matriculaId: b.matriculaId ? Number(b.matriculaId) : null,
      contratoId: b.contratoId ? Number(b.contratoId) : null, titulo: String(b.titulo),
      origem: b.origem, templateId: b.templateId ? Number(b.templateId) : null, tipoNegocio: b.tipoNegocio || null,
      corpoTexto: b.corpoTexto || null, arquivoBase64: b.arquivoBase64 || null, arquivoNome: b.arquivoNome || null,
      deadlineEm: b.deadlineEm || null, reminder: b.reminder || null, sortable: !!b.sortable, refusable: b.refusable !== false, mensagem: b.mensagem || null,
      signatarios: Array.isArray(b.signatarios) ? b.signatarios : undefined,
    })
    return reply.code(201).send({ envelope: env })
  })

  // ── Criar a partir de um template ──
  app.post('/api/admin/aca/assinatura/de-template', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.templateId) return reply.code(400).send({ error: 'templateId obrigatório' })
    try {
      const env = await svc.criarDeTemplate(Number(b.templateId), { alunoId: b.alunoId ? Number(b.alunoId) : null, matriculaId: b.matriculaId ? Number(b.matriculaId) : null, contratoId: b.contratoId ? Number(b.contratoId) : null, titulo: b.titulo })
      return reply.code(201).send({ envelope: env })
    } catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })


  // ── Enviar / Sincronizar / Simular / Cancelar ──
  app.post('/api/admin/aca/assinatura/:id/enviar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.enviar(Number((req.params as any).id)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao enviar' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/sincronizar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.sincronizar(Number((req.params as any).id)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha ao sincronizar' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/simular/:sid', { preHandler: authMiddleware }, async (req, reply) => {
    try { return { envelope: await svc.simularAssinatura(Number((req.params as any).id), Number((req.params as any).sid)) } }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })
  app.post('/api/admin/aca/assinatura/:id/cancelar', { preHandler: authMiddleware }, async (req) =>
    ({ envelope: await svc.cancelar(Number((req.params as any).id)) }))
  app.post('/api/admin/aca/assinatura/:id/reenviar', { preHandler: authMiddleware }, async (req, reply) => {
    try { return await svc.reenviar(Number((req.params as any).id)) }
    catch (e: any) { return reply.code(400).send({ error: e?.message || 'Falha' }) }
  })

  // ── Gatilhos (disparo automático por evento) ──
  app.get('/api/admin/aca/assinatura/gatilhos', { preHandler: authMiddleware }, async () => {
    const gs = await prisma.acaContratoGatilho.findMany({ orderBy: { id: 'desc' } })
    const tids = [...new Set(gs.map((g) => g.templateId).filter((x): x is number => x != null))]
    const ts = tids.length ? await prisma.acaContratoTemplate.findMany({ where: { id: { in: tids } }, select: { id: true, nome: true } }) : []
    const tMap = new Map(ts.map((t) => [t.id, t.nome]))
    return { gatilhos: gs.map((g) => ({ ...g, templateNome: g.templateId != null ? tMap.get(g.templateId) ?? null : null })) }
  })
  app.post('/api/admin/aca/assinatura/gatilhos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.evento || (!b.templateId && !b.autoPorTipo)) return reply.code(400).send({ error: 'nome, evento e template (ou "por tipo") obrigatórios' })
    const g = await prisma.acaContratoGatilho.create({ data: {
      nome: String(b.nome).slice(0, 191), evento: b.evento, autoPorTipo: !!b.autoPorTipo,
      templateId: b.autoPorTipo ? null : (b.templateId ? Number(b.templateId) : null),
      filtroTipoNegocio: b.filtroTipoNegocio || null, autoEnviar: !!b.autoEnviar, ativo: b.ativo !== false,
    } })
    return reply.code(201).send({ gatilho: g })
  })
  app.put('/api/admin/aca/assinatura/gatilhos/:id', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}; const data: any = {}
    for (const k of ['nome', 'evento', 'filtroTipoNegocio']) if (k in b) data[k] = b[k] || null
    if ('autoPorTipo' in b) data.autoPorTipo = !!b.autoPorTipo
    if ('templateId' in b) data.templateId = b.templateId ? Number(b.templateId) : null
    if ('autoEnviar' in b) data.autoEnviar = !!b.autoEnviar
    if ('ativo' in b) data.ativo = !!b.ativo
    return { gatilho: await prisma.acaContratoGatilho.update({ where: { id: Number((req.params as any).id) }, data }) }
  })
  app.delete('/api/admin/aca/assinatura/gatilhos/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaContratoGatilho.delete({ where: { id: Number((req.params as any).id) } }).catch(() => {})
    return { ok: true }
  })

  // ── PDF do contrato (preview/gerado) ──
  app.get('/api/admin/aca/assinatura/:id/pdf', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { buffer, titulo } = await svc.gerarPdf(Number((req.params as any).id))
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${titulo.replace(/[^\w.-]/g, '_')}.pdf"`)
      return reply.send(buffer)
    } catch (e: any) { return reply.code(404).send({ error: e?.message || 'PDF indisponível' }) }
  })

  // ── Webhook público da Clicksign (sem auth; HMAC em Content-Hmac) ──
  // Mesmo modelo da Autentique: o aviso só diz "mudou algo neste documento" —
  // o status é sempre reconsultado na API. Resposta 200 sempre: a Clicksign
  // trata qualquer outra coisa como falha e reenvia.
  app.post('/api/webhooks/clicksign', async (req, reply) => {
    try {
      const cs = await import('../services/clicksign.js')
      const v = await cs.verificarAssinaturaWebhook((req as any).rawBody, (req.headers['content-hmac'] as string) || undefined)
      if (v === 'invalida') { req.log?.warn?.('clicksign webhook: HMAC inválido'); return reply.code(200).send({ ok: true, ignored: 'signature' }) }
      const r = await svc.processarWebhook(req.body)
      return reply.code(200).send(r)
    } catch { return reply.code(200).send({ ok: true }) }
  })

  // ── Webhook público da Autentique (sem auth) ──
  app.post('/api/webhooks/autentique', async (req, reply) => {
    try {
      const sig = (req.headers['x-autentique-signature'] as string) || undefined
      const v = await verificarAssinaturaWebhook((req as any).rawBody, sig)
      if (v === 'invalida') { req.log?.warn?.('autentique webhook: assinatura inválida'); return reply.code(200).send({ ok: true, ignored: 'signature' }) }
      const r = await svc.processarWebhook(req.body)
      return reply.code(200).send(r)
    } catch { return reply.code(200).send({ ok: true }) }
  })
}
