// src/routes/portalJornada.ts
//
// Etapas depois da inscrição (pagamento, documentos, contrato, prova) na ordem
// escolhida pelo portal — para a tela de inscrição (token do candidato) e para
// o portal logado (sessão). E o contrato lido e assinado ainda na inscrição.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { verifyCandidateToken, signCandidateToken } from '../lib/candidateAuth.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { etapasDaInscricao, contratoDaInscricao, assinarContratoDaInscricao, lerJornada } from '../services/portalJornada.js'
import {
  dadosEfetivos, camposDaEtapa, valoresAtuais, erroDoValor, aplicarNoCadastro, ETAPAS_DADOS, type EtapaDados,
  CATALOGO, ROTULO_ETAPA, SUGESTAO, lerPadraoInstituicao, gravarPadraoInstituicao, pendenciasParaMatricular,
} from '../services/dadosCadastro.js'

/** Campos da etapa com o valor atual e quantos obrigatórios faltam. */
async function dadosDaEtapa(registrationId: number, etapa: EtapaDados) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { id: true, leadId: true, formData: true, portal: { select: { jornadaEtapas: true } } },
  })
  if (!reg) return null
  const cfg = await dadosEfetivos(reg.portal)
  const campos = cfg ? camposDaEtapa(cfg, etapa) : []
  const valores = await valoresAtuais(reg, campos.map((c) => c.name))
  const faltando = campos.filter((c) => c.required && String(valores[c.name] ?? '').trim() === '').length
  return { reg, campos, valores, faltando }
}

/** Token da inscrição (Bearer) — o mesmo que o /register devolve. */
function sessaoDoCandidato(req: any, code: string): { enrollmentId: number; candidateCode: string } | null {
  const s = verifyCandidateToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  return s && s.candidateCode === code ? s : null
}

/** Quem está logado no portal: a inscrição mais recente dessa pessoa. */
async function inscricaoDaConta(req: any) {
  const conta = await contaDaRequisicao(req)
  if (!conta) return null
  return prisma.enrollmentRegistration.findFirst({
    where: { leadId: conta.leadId }, orderBy: { id: 'desc' }, select: { id: true, candidateCode: true },
  })
}

const ipDe = (req: any) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip

export async function portalJornadaRoutes(app: FastifyInstance) {
  // ── Admin: dados pedidos em cada etapa (padrão da instituição) ──
  // O ajuste por portal vai no PATCH do portal, em jornadaEtapas.dados.
  app.get('/api/admin/educacional/dados-etapas', { preHandler: authMiddleware }, async () => ({
    catalogo: CATALOGO.map(({ destino, ...d }) => d),
    etapas: ETAPAS_DADOS.map((k) => ({ chave: k, rotulo: ROTULO_ETAPA[k] })),
    padrao: await lerPadraoInstituicao(),
    sugestao: SUGESTAO,
  }))

  app.put('/api/admin/educacional/dados-etapas', { preHandler: adminOnly }, async (req) => ({
    ok: true, padrao: await gravarPadraoInstituicao((req.body as any)?.padrao),
  }))

  // O que falta para esta inscrição virar matrícula (a secretaria vê antes de efetivar).
  app.get('/api/admin/aca/inscricoes-portal/:id/pendencias', { preHandler: authMiddleware }, async (req) => ({
    faltam: await pendenciasParaMatricular(Number((req.params as any).id)),
  }))

  // Na inscrição, logo depois do envio
  app.get('/api/public/registrations/:code/jornada', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const onde = (req.query as any)?.onde === 'painel' ? 'painel' : 'inscricao'
    const j = await etapasDaInscricao(s.enrollmentId, onde)
    if (!j) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    return j
  })

  // No portal logado: as etapas na ordem do painel, e um token da inscrição
  // para as telas de pagamento, contrato e redação funcionarem ali também.
  app.get('/api/public/portal/jornada', async (req, reply) => {
    const reg = await inscricaoDaConta(req)
    if (!reg) return reply.code(401).send({ error: 'Entre no portal para ver sua inscrição.' })
    const j = await etapasDaInscricao(reg.id, 'painel')
    if (!j) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    reply.header('cache-control', 'no-store')
    return { ...j, inscricao: { id: reg.id, candidateCode: reg.candidateCode }, token: signCandidateToken(reg.id, reg.candidateCode) }
  })

  // Dados pedidos numa etapa (Educacional › Dados por etapa). O candidato vê o
  // que já informou — no formulário ou pela secretaria — e completa o resto.
  app.get('/api/public/registrations/:code/dados', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const etapa = String((req.query as any)?.etapa || 'cadastro') as EtapaDados
    if (!ETAPAS_DADOS.includes(etapa) || etapa === 'inscricao') return reply.code(400).send({ error: 'Etapa inválida' })
    const d = await dadosDaEtapa(s.enrollmentId, etapa)
    if (!d) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    reply.header('cache-control', 'no-store')
    return { etapa, campos: d.campos, valores: d.valores, faltando: d.faltando }
  })

  app.post('/api/public/registrations/:code/dados', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const b = (req.body as any) || {}
    const etapa = String(b.etapa || 'cadastro') as EtapaDados
    if (!ETAPAS_DADOS.includes(etapa) || etapa === 'inscricao') return reply.code(400).send({ error: 'Etapa inválida' })
    const d = await dadosDaEtapa(s.enrollmentId, etapa)
    if (!d) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const recebidos = (b.valores && typeof b.valores === 'object') ? b.valores as Record<string, unknown> : {}
    // Só entra o que a etapa pede; o resto do corpo é ignorado.
    const novos: Record<string, string> = {}
    const erros: Record<string, string> = {}
    for (const c of d.campos) {
      const v = c.name in recebidos ? String(recebidos[c.name] ?? '').trim().slice(0, 300) : String(d.valores[c.name] ?? '')
      const e = erroDoValor(c, v)
      if (e) erros[c.name] = e
      else if (c.name in recebidos) novos[c.name] = v
    }
    if (Object.keys(erros).length) return reply.code(400).send({ error: Object.values(erros)[0], erros })
    const form = { ...((d.reg.formData as Record<string, any>) || {}), ...novos }
    await prisma.enrollmentRegistration.update({ where: { id: d.reg.id }, data: { formData: form } })
    // Já é aluno? O cadastro do ERP recebe na hora — não espera outra efetivação.
    await aplicarNoCadastro(d.reg.leadId, form)
    return { ok: true }
  })

  // Contrato na inscrição
  app.get('/api/public/registrations/:code/contrato', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const c = await contratoDaInscricao(s.enrollmentId)
    if (!c) return reply.code(404).send({ error: 'Escolha o curso na inscrição para gerar o contrato.' })
    return { contrato: c }
  })

  app.post('/api/public/registrations/:code/contrato/assinar', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    // A etapa precisa estar ligada no portal: contrato não se assina por fora da jornada.
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: s.enrollmentId }, select: { leadId: true, candidateCode: true, portal: { select: { jornadaEtapas: true } } } })
    const cfg = lerJornada(reg?.portal?.jornadaEtapas)
    const ligada = [...cfg.inscricao, ...(cfg.painel ?? [])].some((e) => e.chave === 'contrato' && e.ativo)
    if (!ligada) return reply.code(400).send({ error: 'Este portal não pede contrato nesta etapa.' })
    // Dados pedidos na etapa do contrato (ex.: responsável financeiro) vêm antes da assinatura.
    const dc = await dadosDaEtapa(s.enrollmentId, 'contrato')
    if (dc && dc.faltando > 0) return reply.code(400).send({ error: 'Preencha os dados pedidos antes de assinar o contrato.' })
    const r = await assinarContratoDaInscricao({
      registrationId: s.enrollmentId, nome: String((req.body as any)?.nome || ''), ip: ipDe(req),
      userAgent: (req.headers['user-agent'] as string) || null,
    })
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    if (!r.jaAssinado && reg?.leadId) {
      const { logEvent } = await import('../services/leadHistory.js')
      logEvent({
        leadId: reg.leadId, type: 'contract_signed', category: 'lifecycle', channel: 'portal', source: 'portal',
        title: `Contrato assinado na inscrição — ${reg.candidateCode}`, actorType: 'lead',
        metadata: { registrationId: s.enrollmentId, ip: ipDe(req) },
      })
    }
    return r
  })
}
