// routes/matriculaInterna.ts
//
// MATRÍCULA INTERNA (05/11/2026). A equipe da ineprotec usou o portal do candidato
// dentro do painel e pediu um ambiente de sistema interno: sem etapas em
// sequência, com todos os ajustes à mão e com a possibilidade de dispensar o que
// não se aplica. A tela é a própria página da inscrição, em abas.
//
// Nada de segunda regra de negócio: criar inscrição, gerar cobrança, valor
// personalizado e envio de documento continuam nas rotas públicas de sempre,
// chamadas com o token de atendimento `interno` (services/inscricaoAssistida).
// Assim o que nasce aqui é igual ao que nasce no portal, inclusive o que o aluno
// vê na tela dele. O que o token interno muda:
//   - sem a ordem das etapas (travas), o prazo do edital e a pausa do portal;
//   - campos obrigatórios podem ficar para depois (a etapa Cadastro segue pendente).
// Continua só do candidato: redação, assinatura eletrônica, senha, cartão.
// Só aqui: dispensas (com permissão e motivo), correção do cadastro, troca de curso.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { guardTela, avaliarTela } from '../lib/eduTelas.js'
import { alcanceDaRequisicao, podeOperarPortal } from '../lib/portalAccess.js'
import { signAtendimento, signCandidateToken, signMagicLink } from '../lib/candidateAuth.js'
import { canUserAccessLead } from '../lib/teamAccess.js'
import { isValidCpf, normalizeCpf } from '../lib/cpf.js'
import { CABECALHO_ATENDENTE, registrarEventoDaInscricao } from '../services/inscricaoAssistida.js'
import { dispensasDe, type Dispensas } from '../services/docCondicional.js'
import { logEvent, EVENT_TYPES } from '../services/leadHistory.js'
import type { JwtPayload } from '../lib/auth.js'

const DUAS_HORAS = 2 * 3600 * 1000
/** Pagamento não se dispensa: isenção é cupom de 100%, fora do gateway é pagamento manual. */
const ETAPAS_DISPENSAVEIS = ['cadastro', 'analise', 'documentos', 'contrato', 'prova']
const FECHADAS = ['cancelled', 'merged', 'expired']

const usuario = (req: FastifyRequest) => (req as any).user as JwtPayload

/** Só abrir a tela não muda nada: "atendida por" é de quem AGIU na inscrição. */
const conduziu = (registrationId: number, userId: number) =>
  prisma.enrollmentRegistration.update({ where: { id: registrationId }, data: { atendidoPorUserId: userId } }).catch(() => {})

async function nomeDe(u: JwtPayload): Promise<string> {
  const x = await prisma.user.findUnique({ where: { id: u.userId }, select: { name: true } })
  return x?.name || u.name || 'Atendente'
}

/** Quem pode operar: a permissão de criar no portal, o portal no alcance e, com lead, acesso a ele. */
async function barrar(req: FastifyRequest, portalId: number, leadId: number | null): Promise<{ status: number; erro: string } | null> {
  const u = usuario(req)
  const tela = await avaliarTela(u, 'POST', '/api/admin/enrollment-registrations')
  const pode = tela ? tela.permitido : ['ADMIN', 'SUPERADMIN'].includes(String(u.role))
  if (!pode) return { status: 403, erro: tela?.mensagem || 'Seu perfil não pode fazer matrículas no Portal de Matrículas.' }
  if (!podeOperarPortal(await alcanceDaRequisicao(req), portalId)) return { status: 403, erro: 'Você não opera este portal.' }
  if (leadId != null && !(await canUserAccessLead(u.userId, u.role as any, leadId))) return { status: 403, erro: 'Você não tem acesso a este lead.' }
  return null
}

const inscricaoSelect = {
  id: true, candidateCode: true, status: true, leadId: true, portalId: true, formData: true, paymentStatus: true, paymentPaidAt: true,
  processRegistrationId: true,
  portal: { select: { slug: true, formConfig: true } },
} as const

async function inscricaoDa(req: FastifyRequest, reply: any) {
  const id = parseInt((req.params as any).id)
  if (!Number.isFinite(id)) { reply.code(400).send({ error: 'Inscrição inválida' }); return null }
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: inscricaoSelect })
  if (!reg) { reply.code(404).send({ error: 'Inscrição não encontrada' }); return null }
  const b = await barrar(req, reg.portalId, reg.leadId)
  if (b) { reply.code(b.status).send({ error: b.erro }); return null }
  return reg
}

export async function ofertasDoPortal(portalId: number) {
  const portal = await prisma.enrollmentPortal.findUnique({
    where: { id: portalId },
    select: { id: true, nome: true, slug: true, active: true, formMode: true, unitId: true, selectionProcessIds: true, allowedCampusIds: true, formConfig: true },
  })
  if (!portal) return null
  const { processosOferecidos, ofertaFixa } = await import('../services/portalModos.js')
  const processIds = await processosOferecidos(portal as any)
  const fixa = ofertaFixa(portal.formConfig)
  const permitidos = Array.isArray(portal.allowedCampusIds) && (portal.allowedCampusIds as any[]).length
    ? new Set((portal.allowedCampusIds as any[]).map(Number)) : null
  const ofertas = await prisma.courseOffering.findMany({
    where: { active: true, selectionProcessId: { in: processIds }, ...(fixa ? { id: fixa } : {}) },
    orderBy: [{ nome: 'asc' }],
    select: {
      id: true, nome: true, complemento: true, turno: true, selectionProcessId: true,
      course: { select: { nome: true } },
      selectionProcess: { select: { nome: true, entryMode: { select: { name: true } } } },
      campuses: { select: { campus: { select: { id: true, nome: true } } } },
    },
  })
  return {
    portal,
    ofertas: ofertas.map((o) => ({
      id: o.id, nome: o.nome, complemento: o.complemento, turno: o.turno, curso: o.course?.nome ?? null,
      processoId: o.selectionProcessId, ingresso: o.selectionProcess?.entryMode?.name ?? o.selectionProcess?.nome ?? null,
      polos: o.campuses.map((c) => c.campus).filter((c) => !permitidos || permitidos.has(c.id)),
    })),
  }
}

export async function matriculaInternaRoutes(app: FastifyInstance) {
  // Portal, curso, forma de ingresso e polo para o formulário e para a troca de curso.
  app.get('/api/admin/matricula-interna/catalogo', { preHandler: guardTela('login') }, async (req, reply) => {
    const portalId = parseInt((req.query as any).portalId)
    if (!Number.isFinite(portalId)) return reply.code(400).send({ error: 'Escolha o portal.' })
    const b = await barrar(req, portalId, null)
    if (b) return reply.code(b.status).send({ error: b.erro })
    const c = await ofertasDoPortal(portalId)
    if (!c) return reply.code(404).send({ error: 'Portal não encontrado' })
    return { ofertas: c.ofertas }
  })

  // Nova matrícula: passa pela mesma rota de inscrição do portal.
  app.post('/api/admin/matricula-interna', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const b0 = (req.body as any) || {}
    const portalId = parseInt(b0.portalId)
    let leadId = b0.leadId != null && b0.leadId !== '' ? parseInt(b0.leadId) : null
    if (!Number.isFinite(portalId)) return reply.code(400).send({ error: 'Escolha o portal.' })
    if (leadId != null && !Number.isFinite(leadId)) return reply.code(400).send({ error: 'Lead inválido.' })
    // Sem ficha escolhida: quem o agente digitou já tem ficha? A matrícula vai
    // para ela (antes nascia uma segunda, marcada como duplicada). "É outra
    // pessoa" (fichaSeparada) mantém a ficha nova.
    const fichaSeparada = b0.fichaSeparada === true
    let fichaUsada: { id: number; nome: string | null; por: string } | null = null
    if (leadId == null && !fichaSeparada) {
      const { fichaParaMatricula } = await import('../services/fichaDaMatricula.js')
      const f = await fichaParaMatricula({ nome: b0.nome, whatsapp: b0.whatsapp, email: b0.email, cpf: b0.cpf }, { userId: u.userId, role: String(u.role) })
      if (f.tipo === 'ficha') { leadId = f.lead.id; fichaUsada = { id: f.lead.id, nome: f.lead.nome, por: f.por } }
    }
    const barrado = await barrar(req, portalId, leadId)
    if (barrado) return reply.code(barrado.status).send({ error: barrado.erro })

    const portal = await prisma.enrollmentPortal.findUnique({ where: { id: portalId }, select: { id: true, slug: true, active: true, formMode: true } })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })
    if (!portal.active) return reply.code(400).send({ error: 'Este portal está desativado.' })
    if (portal.formMode === 'interest') return reply.code(400).send({ error: 'Este portal só captura interesse: não tem inscrição completa.' })

    if (leadId != null) {
      const ja = await prisma.enrollmentRegistration.findFirst({
        where: { leadId, portalId, status: { notIn: ['merged', 'cancelled'] } }, orderBy: { id: 'desc' }, select: { id: true, candidateCode: true },
      })
      if (ja) return { ok: true, existente: true, id: ja.id, candidateCode: ja.candidateCode, fichaUsada }
    }

    const nome = await nomeDe(u)
    const token = signAtendimento({ userId: u.userId, nome, portalSlug: portal.slug, leadId, interno: true }, 1)
    const offeringId = Number(b0.offeringId)
    if (!Number.isFinite(offeringId) || offeringId <= 0) return reply.code(400).send({ error: 'Escolha o curso.' })
    const r = await app.inject({
      method: 'POST',
      url: `/api/public/portals/${portal.slug}/register`,
      remoteAddress: req.ip,
      headers: { 'content-type': 'application/json', [CABECALHO_ATENDENTE]: token, 'user-agent': String(req.headers['user-agent'] || '') },
      payload: {
        ...(leadId != null ? { continueToken: token } : {}),
        ...(fichaSeparada ? { fichaSeparada: true } : {}),
        formData: {
          nome: String(b0.nome || '').trim(), email: String(b0.email || '').trim(), whatsapp: String(b0.whatsapp || '').trim(), cpf: String(b0.cpf || '').trim(),
          offeringId, ...(b0.campusId ? { campusId: Number(b0.campusId) } : {}), lgpdConsent: b0.lgpdConsent === true,
        },
      },
    })
    const d: any = r.json()
    if (r.statusCode >= 400) return reply.code(r.statusCode).send({ error: d?.error || 'Não foi possível criar a matrícula.' })
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { candidateCode: d.candidateCode }, select: { id: true, candidateCode: true } })
    if (!reg) return reply.code(500).send({ error: 'A inscrição foi enviada, mas não foi encontrada. Procure na lista do portal.' })
    if (fichaUsada) {
      logEvent({
        leadId: fichaUsada.id, type: EVENT_TYPES.ANNOTATION_SAVED, category: 'operator',
        title: `Matrícula ${reg.candidateCode} feita nesta ficha`,
        description: `A equipe digitou os dados sem abrir pela ficha; ${fichaUsada.por === 'whatsapp' ? 'mesmo WhatsApp' : fichaUsada.por === 'cpf' ? 'mesmo CPF' : 'mesmo e-mail'}, então a matrícula ficou aqui em vez de criar outra ficha.`,
        actorType: 'operator', userId: u.userId, userName: nome,
      })
    }
    return reply.code(201).send({ ok: true, existente: false, id: reg.id, candidateCode: reg.candidateCode, fichaUsada })
  })

  // Antes de salvar a nova matrícula: em qual ficha ela vai cair (sem escrever nada).
  app.get('/api/admin/matricula-interna/ficha', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const q = (req.query as any) || {}
    const portalId = parseInt(q.portalId)
    if (!Number.isFinite(portalId)) return reply.code(400).send({ error: 'Escolha o portal.' })
    const b = await barrar(req, portalId, null)
    if (b) return reply.code(b.status).send({ error: b.erro })
    const { fichaParaMatricula } = await import('../services/fichaDaMatricula.js')
    reply.header('cache-control', 'no-store')
    return fichaParaMatricula({ nome: q.nome, whatsapp: q.whatsapp, email: q.email, cpf: q.cpf }, { userId: u.userId, role: String(u.role) })
  })

  // Sessão da tela: os tokens que as abas usam nas rotas públicas. Curta, só em memória.
  app.get('/api/admin/matricula-interna/:id/sessao', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const nome = await nomeDe(u)
    reply.header('cache-control', 'no-store')
    return {
      candidateCode: reg.candidateCode,
      slug: reg.portal!.slug,
      candidateToken: signCandidateToken(reg.id, reg.candidateCode, DUAS_HORAS),
      atendenteToken: signAtendimento({ userId: u.userId, nome, portalSlug: reg.portal!.slug, leadId: reg.leadId, interno: true }, 2),
      expiraEm: Date.now() + DUAS_HORAS,
    }
  })

  // Link que abre direto na etapa Contrato, para o aluno ler e assinar ou aceitar.
  // Só gera: quem decide como entregar é o agente (copiar ou Conversas).
  app.post('/api/admin/matricula-interna/:id/contrato/link', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    if (FECHADAS.includes(reg.status)) return reply.code(409).send({ error: 'Inscrição cancelada, expirada ou mesclada.' })
    if (!reg.leadId) return reply.code(409).send({ error: 'A inscrição não tem ficha de lead.' })
    const { etapasDaInscricao } = await import('../services/portalJornada.js')
    const j = await etapasDaInscricao(reg.id, 'inscricao')
    const painel = j?.etapas.find((e) => e.chave === 'contrato') ? null : await etapasDaInscricao(reg.id, 'painel')
    const etapa = j?.etapas.find((e) => e.chave === 'contrato') ?? painel?.etapas.find((e) => e.chave === 'contrato')
    if (!etapa) return reply.code(409).send({ error: 'Esta inscrição não tem etapa de contrato.' })
    if (etapa.situacao === 'feito') return reply.code(409).send({ error: etapa.dispensada ? 'O contrato está dispensado nesta inscrição.' : 'O contrato já está assinado.' })
    const portal = await prisma.enrollmentPortal.findUnique({ where: { id: reg.portalId }, select: { slug: true, customDomain: true, magicLinkTtlDays: true } })
    if (!portal) return reply.code(404).send({ error: 'Portal não encontrado' })
    const dominio = portal.customDomain ? `https://${portal.customDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : null
    if (!dominio && !process.env.APP_URL) return reply.code(500).send({ error: 'APP_URL não configurada no .env.' })
    const base = dominio ? `${dominio}/` : `${process.env.APP_URL!.replace(/\/$/, '')}/portal/${portal.slug}`
    const dias = portal.magicLinkTtlDays || 7
    const t = signMagicLink(reg.leadId, portal.slug, dias)
    const via = (req.body as any)?.via === 'conversas' ? 'conversas' : 'copiar'
    await registrarEventoDaInscricao({
      registrationId: reg.id, etapa: 'contrato', acao: 'link_contrato', ator: 'atendente', userId: u.userId, userName: await nomeDe(u), req,
      dados: { via, validadeDias: dias },
    })
    const lead = await prisma.lead.findUnique({ where: { id: reg.leadId }, select: { id: true, nome: true, whatsapp: true } })
    reply.header('cache-control', 'no-store')
    return {
      url: `${base}?t=${encodeURIComponent(t)}#etapa-contrato`,
      validadeDias: dias,
      lead,
      // O agente não espera a fila, mas o aluno sim: o link abriria na etapa anterior.
      travadaPara: etapa.bloqueada?.motivo ?? null,
    }
  })

  // A equipe inicia a assinatura eletrônica, para o link existir sem o aluno entrar
  // no portal. Quem assina continua sendo o aluno.
  app.post('/api/admin/matricula-interna/:id/contrato/iniciar', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    if (FECHADAS.includes(reg.status)) return reply.code(409).send({ error: 'Inscrição cancelada, expirada ou mesclada.' })
    const { impedimentoParaAssinar } = await import('./portalJornada.js')
    const impedimento = await impedimentoParaAssinar(reg.id, 'inscricao', true)
    if (impedimento) return reply.code(400).send({ error: impedimento === 'Preencha os dados pedidos antes de assinar o contrato.' ? 'Faltam dados pedidos pelo contrato: preencha na aba Cadastro.' : impedimento })
    const { iniciarAssinaturaDaInscricao } = await import('../services/contratoDoPortal.js')
    const r = await iniciarAssinaturaDaInscricao(reg.id)
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    await registrarEventoDaInscricao({ registrationId: reg.id, etapa: 'contrato', acao: 'assinatura_iniciada', ator: 'atendente', userId: u.userId, userName: await nomeDe(u), req })
    return { ok: true }
  })

  // Dispensar (POST) ou devolver (DELETE) uma etapa ou um documento.
  // Permissão própria, "Dispensar etapas e documentos" (lib/eduTelas), e sempre com motivo.
  async function dispensar(req: FastifyRequest, reply: any, remover: boolean) {
    const u = usuario(req)
    const tela = await avaliarTela(u, 'POST', `/api/admin/matricula-interna/${(req.params as any).id}/dispensa`)
    const pode = tela ? tela.permitido : ['ADMIN', 'SUPERADMIN'].includes(String(u.role))
    if (!pode) return reply.code(403).send({ error: 'Seu perfil não pode dispensar etapas ou documentos (permissão "Dispensar etapas e documentos").' })
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    if (FECHADAS.includes(reg.status)) return reply.code(409).send({ error: 'Inscrição cancelada, expirada ou mesclada.' })
    const b = remover ? (req.query as any) : ((req.body as any) || {})
    const tipo = b.tipo === 'documento' ? 'documento' : b.tipo === 'etapa' ? 'etapa' : null
    const chave = String(b.chave || '').trim().slice(0, 40)
    if (!tipo || !chave) return reply.code(400).send({ error: 'Diga o que dispensar.' })
    if (tipo === 'etapa' && !ETAPAS_DISPENSAVEIS.includes(chave)) {
      return reply.code(400).send({ error: 'Esta etapa não pode ser dispensada. Para isentar o pagamento, use um cupom de 100%; recebido fora do gateway, "Registrar pagamento manual".' })
    }
    const motivo = String(b.motivo || '').trim().slice(0, 300)
    if (!remover && motivo.length < 5) return reply.code(400).send({ error: 'Informe o motivo da dispensa.' })

    const form = ((reg.formData as Record<string, any>) || {})
    const atual: Dispensas = dispensasDe(form)
    const grupo = tipo === 'documento' ? atual.documentos : atual.etapas
    if (remover) delete grupo[chave]
    else grupo[chave] = { motivo, por: await nomeDe(u), porId: u.userId, em: new Date().toISOString() }
    const { _dispensas: _antes, ...resto } = form
    const novo = (Object.keys(atual.documentos).length || Object.keys(atual.etapas).length) ? { ...resto, _dispensas: atual } : resto
    await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { formData: novo as any } })
    await conduziu(reg.id, u.userId)

    const acao = tipo === 'documento'
      ? (remover ? 'documento_dispensa_removida' : 'documento_dispensado')
      : (remover ? 'etapa_dispensa_removida' : 'etapa_dispensada')
    await registrarEventoDaInscricao({
      registrationId: reg.id, etapa: tipo === 'documento' ? 'documentos' : chave, acao, ator: 'atendente',
      userId: u.userId, userName: await nomeDe(u), req, dados: { chave, ...(motivo ? { motivo } : {}) },
    })
    ;(await import('../services/funilDaJornada.js')).sincronizarFunil(reg.id)
    return { ok: true }
  }
  // Alterar forma de pagamento: permissão própria (lib/eduTelas).
  const troca = () => import('../services/trocaPagamento.js')
  app.get('/api/admin/matricula-interna/:id/troca', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    reply.header('cache-control', 'no-store')
    return (await troca()).estadoDaTroca(reg.id)
  })
  app.post('/api/admin/matricula-interna/:id/troca', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const u = usuario(req)
    const r = await (await troca()).criarTroca(reg.id, req.body, { userId: u.userId, nome: await nomeDe(u) })
    return r.ok ? r : reply.code(r.status).send({ error: r.erro })
  })
  app.post('/api/admin/matricula-interna/:id/troca/:trocaId/cancelar', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const u = usuario(req)
    const t = await prisma.enrollmentTroca.findFirst({ where: { id: Number((req.params as any).trocaId), registrationId: reg.id } })
    if (!t) return reply.code(404).send({ error: 'Troca não encontrada.' })
    const r = await (await troca()).encerrarTrocaPendente(t.id, 'CANCELADA', String((req.body as any)?.motivo ?? 'Cancelada pelo agente'), { userId: u.userId, nome: await nomeDe(u) })
    return r.ok ? r : reply.code(r.status).send({ error: r.erro })
  })

  // Pagamento combinado: permissão "Valor personalizado" (lib/eduTelas).
  const combinado = () => import('../services/pagamentoCombinado.js')
  const operador = async (req: FastifyRequest) => { const u = usuario(req); return { userId: u.userId, nome: await nomeDe(u) } }
  const responder = (reply: any, r: any) => (r.ok ? r : reply.code(r.status).send({ error: r.erro }))
  app.get('/api/admin/matricula-interna/:id/combinado', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const c = await combinado()
    const conn = await prisma.enrollmentPortal.findUnique({ where: { id: reg.portalId }, select: { paymentConnection: { select: { provider: true, active: true } } } })
    reply.header('cache-control', 'no-store')
    const lead = reg.leadId ? await prisma.lead.findUnique({ where: { id: reg.leadId }, select: { id: true, nome: true, whatsapp: true } }) : null
    return { combinado: await c.resumoDoCombinado(reg.id), aceita: c.conexaoAceitaCombinado(conn?.paymentConnection ?? null), simulado: conn?.paymentConnection?.provider === 'simulado', lead }
  })
  app.post('/api/admin/matricula-interna/:id/combinado', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    return responder(reply, await (await combinado()).criarCombinado(reg.id, req.body, await operador(req)))
  })
  app.delete('/api/admin/matricula-interna/:id/combinado', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    return responder(reply, await (await combinado()).desfazerCombinado(reg.id, await operador(req)))
  })
  app.post('/api/admin/matricula-interna/:id/combinado/:tituloId/gerar', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const t = await prisma.enrollmentTitulo.findFirst({ where: { id: Number((req.params as any).tituloId), registrationId: reg.id } })
    if (!t) return reply.code(404).send({ error: 'Pagamento não encontrado.' })
    const r = await (await combinado()).gerarCobrancaDoTitulo(t.id)
    return r.ok ? { ok: true } : reply.code(502).send({ error: r.erro })
  })
  // Só com a conexão simulada: é o "pagar" do ambiente de teste.
  app.post('/api/admin/matricula-interna/:id/combinado/:tituloId/simular', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const t = await prisma.enrollmentTitulo.findFirst({ where: { id: Number((req.params as any).tituloId), registrationId: reg.id, provider: 'simulado' } })
    if (!t) return reply.code(404).send({ error: 'Só cobrança simulada pode ser paga por aqui.' })
    const op = await operador(req)
    await (await combinado()).registrarPagamentoDoTitulo(t.id, { fonte: 'simulado', ator: 'atendente', userId: op.userId, userName: op.nome })
    return { ok: true }
  })

  app.post('/api/admin/matricula-interna/:id/dispensa', { preHandler: guardTela('login') }, (req, reply) => dispensar(req, reply, false))
  app.delete('/api/admin/matricula-interna/:id/dispensa', { preHandler: guardTela('login') }, (req, reply) => dispensar(req, reply, true))

  // Corrigir qualquer dado do cadastro, sem as regras de obrigatório da tela do candidato.
  app.put('/api/admin/matricula-interna/:id/cadastro', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const valores = (req.body as any)?.valores
    if (!valores || typeof valores !== 'object') return reply.code(400).send({ error: 'Nada a salvar.' })
    const novos: Record<string, string> = {}
    for (const [k, v] of Object.entries(valores)) {
      // Chave técnica não se edita por aqui (dispensas, curso, senha).
      if (k.startsWith('_') || ['offeringId', 'campusId', 'campusNome', 'senha', 'password', 'lgpdConsent'].includes(k)) continue
      novos[k] = String(v ?? '').trim().slice(0, 500)
    }
    // Todo campo de CPF do cadastro (aluno e responsável financeiro), não só o do aluno.
    const { POR_CHAVE } = await import('../services/dadosCadastro.js')
    for (const [k, v] of Object.entries(novos)) {
      if (!v || (k !== 'cpf' && POR_CHAVE.get(k)?.tipo !== 'cpf')) continue
      if (!isValidCpf(normalizeCpf(v))) {
        const rotulo = POR_CHAVE.get(k)?.rotulo ?? 'CPF'
        return reply.code(400).send({ error: `${rotulo} não confere. Verifique os números digitados.`, campo: k })
      }
    }
    const form = (reg.formData as Record<string, any>) || {}
    const mudou = Object.keys(novos).filter((k) => String(form[k] ?? '') !== novos[k])
    if (!mudou.length) return { ok: true, mudou: [] }
    const novoForm = { ...form, ...novos }
    await prisma.enrollmentRegistration.update({ where: { id: reg.id }, data: { formData: novoForm } })
    await conduziu(reg.id, u.userId)

    // Ficha do lead: nome e e-mail acompanham. WhatsApp é a identidade da conversa
    // (um número, uma conversa): só preenche se estiver vazio.
    if (reg.leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: reg.leadId }, select: { whatsapp: true } })
      const dadosLead: Record<string, string> = {}
      if (mudou.includes('nome') && novos.nome) dadosLead.nome = novos.nome
      if (mudou.includes('email') && novos.email) dadosLead.email = novos.email
      if (mudou.includes('whatsapp') && novos.whatsapp && !lead?.whatsapp) dadosLead.whatsapp = novos.whatsapp
      if (Object.keys(dadosLead).length) await prisma.lead.update({ where: { id: reg.leadId }, data: dadosLead }).catch(() => {})
    }
    const { aplicarNoCadastro, espelharInscricaoNoLead } = await import('../services/dadosCadastro.js')
    await aplicarNoCadastro(reg.leadId, novoForm).catch((e: any) => req.log.warn(`[matricula-interna] ERP: ${e.message}`))
    await espelharInscricaoNoLead({ leadId: reg.leadId, formData: novoForm }, reg.portal?.formConfig).catch((e: any) => req.log.warn(`[matricula-interna] lead: ${e.message}`))
    const nome = await nomeDe(u)
    await registrarEventoDaInscricao({
      registrationId: reg.id, etapa: 'cadastro', acao: 'dados_corrigidos', ator: 'atendente', userId: u.userId, userName: nome, req,
      dados: { campos: mudou, antes: Object.fromEntries(mudou.map((k) => [k, k === 'cpf' ? '(oculto)' : (form[k] ?? null)])) },
    })
    ;(await import('../services/funilDaJornada.js')).sincronizarFunil(reg.id)
    return { ok: true, mudou }
  })

  // Trocar curso, forma de ingresso ou polo. Antes do pagamento: as parcelas e o
  // contrato nascem do curso. O preço muda, então cobrança aberta e condição combinada caem.
  // ── Transferência de curso (pago ou não): crédito, documentos e contrato novo ──
  const transf = () => import('../services/transferenciaCurso.js')
  app.get('/api/admin/matricula-interna/:id/transferencia', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    return { historico: await (await transf()).transferenciasDa(reg.id) }
  })
  app.post('/api/admin/matricula-interna/:id/transferencia/previa', { preHandler: guardTela('admin') }, async (req, reply) => {
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const b = (req.body as any) || {}
    const alvo = { portalId: Number(b.portalId), offeringId: Number(b.offeringId), campusId: b.campusId ? Number(b.campusId) : null, planoId: b.planoId ? Number(b.planoId) : null, precoPor: b.precoPor ? String(b.precoPor) : null }
    if (!Number.isFinite(alvo.portalId) || !Number.isFinite(alvo.offeringId)) return reply.code(400).send({ error: 'Escolha o portal e o curso.' })
    const barrado = await barrar(req, alvo.portalId, reg.leadId)
    if (barrado) return reply.code(barrado.status).send({ error: barrado.erro })
    const r = await (await transf()).previaDaTransferencia(reg.id, alvo)
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    reply.header('cache-control', 'no-store')
    return r
  })
  app.post('/api/admin/matricula-interna/:id/transferencia', { preHandler: guardTela('admin') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    const b = (req.body as any) || {}
    const barrado = await barrar(req, Number(b.portalId), reg.leadId)
    if (barrado) return reply.code(barrado.status).send({ error: barrado.erro })
    const r = await (await transf()).transferirCurso(reg.id, b, { userId: u.userId, nome: await nomeDe(u) })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return r
  })

  app.put('/api/admin/matricula-interna/:id/curso', { preHandler: guardTela('login') }, async (req, reply) => {
    const u = usuario(req)
    const reg = await inscricaoDa(req, reply)
    if (!reg) return
    if (FECHADAS.includes(reg.status)) return reply.code(409).send({ error: 'Inscrição cancelada, expirada ou mesclada.' })
    if (reg.paymentStatus === 'paid' || reg.paymentPaidAt) return reply.code(409).send({ error: 'O pagamento já foi feito: o curso não pode mais ser trocado por aqui.' })
    if (!reg.leadId) return reply.code(409).send({ error: 'A inscrição não tem ficha de lead.' })
    const b = (req.body as any) || {}
    const offeringId = Number(b.offeringId)
    const motivo = String(b.motivo || '').trim().slice(0, 300)
    if (motivo.length < 5) return reply.code(400).send({ error: 'Informe o motivo da troca.' })
    const c = await ofertasDoPortal(reg.portalId)
    const oferta = c?.ofertas.find((o) => o.id === offeringId)
    if (!oferta || !oferta.processoId) return reply.code(400).send({ error: 'Curso inválido para este portal.' })
    const polo = oferta.polos.length === 1 ? oferta.polos[0]! : oferta.polos.find((p) => p.id === Number(b.campusId))
    if (oferta.polos.length > 1 && !polo) return reply.code(400).send({ error: 'Escolha o polo.' })

    const pr = await prisma.processRegistration.upsert({
      where: { leadId_offeringId: { leadId: reg.leadId, offeringId } },
      update: { status: 'inscrito' },
      create: { leadId: reg.leadId, offeringId, selectionProcessId: oferta.processoId, status: 'inscrito' },
    })
    if (pr.id !== reg.processRegistrationId) {
      const outra = await prisma.enrollmentRegistration.findFirst({ where: { processRegistrationId: pr.id, id: { not: reg.id } }, select: { candidateCode: true } })
      if (outra) return reply.code(409).send({ error: `Esta pessoa já tem a inscrição ${outra.candidateCode} neste curso.` })
    }
    const { cancelarCobrancasAbertas } = await import('../services/inscricaoDuplicada.js')
    const avisos = await cancelarCobrancasAbertas(reg.id, 'Curso alterado na matrícula interna').catch((e: any) => [String(e?.message || e)])
    const form = (reg.formData as Record<string, any>) || {}
    const antes = { offeringId: form.offeringId ?? null, campusNome: form.campusNome ?? null }
    await prisma.enrollmentRegistration.update({
      where: { id: reg.id },
      data: {
        atendidoPorUserId: u.userId,
        processRegistrationId: pr.id,
        condicaoNegociada: null as any,
        paymentPlan: null as any,
        formData: { ...form, offeringId, campusId: polo?.id ?? null, campusNome: polo?.nome ?? null },
      },
    })
    const nome = await nomeDe(u)
    await registrarEventoDaInscricao({
      registrationId: reg.id, etapa: 'inscricao', acao: 'curso_alterado', ator: 'atendente', userId: u.userId, userName: nome, req,
      dados: { motivo, antes, depois: { offeringId, oferta: oferta.nome, campusNome: polo?.nome ?? null } },
    })
    logEvent({
      leadId: reg.leadId, type: EVENT_TYPES.ANNOTATION_SAVED, category: 'operator',
      title: `Inscrição ${reg.candidateCode}: curso alterado para ${oferta.nome}`, description: motivo,
      actorType: 'operator', userId: u.userId, userName: nome,
    })
    ;(await import('../services/funilDaJornada.js')).sincronizarFunil(reg.id)
    return { ok: true, avisos }
  })
}
