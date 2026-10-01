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
  dadosDoContratoDaInscricao, modeloDoPortal, pdfDoContratoDaInscricao, envelopeDaInscricao, estadoDaAssinaturaDaInscricao,
  iniciarAssinaturaDaInscricao, aceitarContratoNoPortal, assinaturaEletronicaAtiva,
} from '../services/contratoDoPortal.js'
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

/**
 * O que impede assinar agora: etapa desligada no portal (contrato não se assina
 * por fora da jornada) ou dados da etapa do contrato ainda faltando (ex.:
 * responsável financeiro) — eles entram no contrato, então vêm antes.
 */
async function impedimentoParaAssinar(registrationId: number): Promise<string | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portal: { select: { jornadaEtapas: true } } } })
  const cfg = lerJornada(reg?.portal?.jornadaEtapas)
  const ligada = [...cfg.inscricao, ...(cfg.painel ?? [])].some((e) => e.chave === 'contrato' && e.ativo)
  if (!ligada) return 'Este portal não pede contrato nesta etapa.'
  const dc = await dadosDaEtapa(registrationId, 'contrato')
  if (dc && dc.faltando > 0) return 'Preencha os dados pedidos antes de assinar o contrato.'
  return null
}

/** Contrato em Word que vale para a inscrição (null = termo de aceite de sempre). */
async function contratoWordDaInscricao(registrationId: number) {
  const d = await dadosDoContratoDaInscricao(registrationId)
  const modelo = d ? await modeloDoPortal(d.portalId, d.courseId) : null
  if (!d || !modelo) return null
  // Provedor ANTES de iniciar: a tela decide o fluxo no clique (Autentique abre
  // o link numa nova aba; Clicksign assina no widget ou manda o convite).
  const { provedorAtivo } = await import('../services/assinaturaProvedor.js')
  const provedor = await provedorAtivo()
  const widgetClicksign = provedor === 'CLICKSIGN' && (await (await import('../services/clicksign.js')).getConfig()).widget
  return {
    modelo: { id: modelo.id, nome: modelo.nome },
    eletronica: await assinaturaEletronicaAtiva(),
    provedor,
    widget: widgetClicksign,
    menorSemResponsavel: d.menor && !d.responsavel,
    assinatura: await estadoDaAssinaturaDaInscricao(registrationId),
  }
}

// Máscaras (LGPD): o suficiente para a pessoa reconhecer o próprio dado.
function mascararEmail(v: unknown): string | null {
  const e = String(v ?? '').trim()
  const [u, d] = e.split('@')
  if (!u || !d) return null
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(2, Math.min(6, u.length - 2)))}@${d}`
}
function mascararTelefone(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 8 ? `(**) *****-${d.slice(-4)}` : null
}
function mascararCpf(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : null
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
    // Mesclada em outra (duplicidade) não é a inscrição da pessoa.
    where: { leadId: conta.leadId, status: { not: 'merged' } }, orderBy: { id: 'desc' }, select: { id: true, candidateCode: true },
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

  // Admin: as etapas da inscrição como o candidato as vê — na tela de inscrição
  // e no portal logado — para a secretaria saber o que falta, na mesma ordem.
  app.get('/api/admin/enrollment-registrations/:id/etapas', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const [inscricao, painel] = await Promise.all([etapasDaInscricao(id, 'inscricao'), etapasDaInscricao(id, 'painel')])
    if (!inscricao) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    return { inscricao: inscricao.etapas, painel: painel?.etapas ?? [] }
  })

  // Na inscrição, logo depois do envio
  // Resumo da inscrição para o topo do portal do candidato — anonimizado aqui
  // no servidor (LGPD): o dado completo não chega ao navegador. Nome só com o
  // primeiro nome e a inicial; e-mail, WhatsApp e CPF mascarados. O valor é o
  // real da cobrança (cupom e desconto aplicados), não o de tabela.
  app.get('/api/public/registrations/:code/resumo', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const r = await prisma.enrollmentRegistration.findUnique({
      where: { id: s.enrollmentId },
      select: {
        candidateCode: true, status: true, createdAt: true, formData: true, paymentStatus: true, paymentAmount: true, paymentPlan: true,
        lead: { select: { nome: true, email: true, whatsapp: true } },
        portal: { select: { nome: true } },
        processRegistration: {
          select: {
            offering: { select: { nome: true, turno: true, course: { select: { nome: true } }, modality: { select: { nome: true } }, unit: { select: { nome: true } } } },
            selectionProcess: { select: { entryMode: { select: { name: true } } } },
          },
        },
      },
    })
    if (!r) return reply.code(404).send({ error: 'Inscrição não encontrada' })
    const fd = (r.formData ?? {}) as Record<string, any>
    const nome = String(r.lead?.nome ?? fd.nome ?? '').trim()
    const partes = nome.split(/\s+/).filter(Boolean)
    const plano = (r.paymentPlan ?? {}) as Record<string, any>
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
    const pago = r.paymentStatus === 'paid'
    return {
      candidato: {
        nome: partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : (partes[0] ?? ''),
        email: mascararEmail(r.lead?.email ?? fd.email),
        whatsapp: mascararTelefone(r.lead?.whatsapp ?? fd.whatsapp),
        cpf: mascararCpf(fd.cpf),
      },
      inscricao: {
        codigo: r.candidateCode, situacao: r.status, criadaEm: r.createdAt,
        portal: r.portal?.nome ?? null,
        curso: r.processRegistration?.offering?.course?.nome ?? null,
        oferta: r.processRegistration?.offering?.nome ?? null,
        modalidade: r.processRegistration?.offering?.modality?.nome ?? null,
        turno: r.processRegistration?.offering?.turno ?? null,
        unidade: r.processRegistration?.offering?.unit?.nome ?? null,
        polo: typeof fd.campusNome === 'string' && fd.campusNome.trim() ? fd.campusNome.trim() : null,
        ingresso: r.processRegistration?.selectionProcess?.entryMode?.name ?? null,
      },
      pagamento: plano.valorCobrado != null || plano.valorTabela != null ? {
        valorCheio: num(plano.valorCheio) ?? num(plano.valorTabela),
        cupom: plano.cupom ?? null,
        desconto: (num(plano.descontoCupom) ?? 0) + (num(plano.descontoAVista) ?? 0),
        valor: pago ? (num(r.paymentAmount) ?? num(plano.valorCobrado)) : num(plano.valorCobrado),
        meio: plano.meio ?? null,
        parcelas: num(plano.parcelas) ?? 1,
        pago,
      } : null,
    }
  })

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
    return { contrato: c, word: await contratoWordDaInscricao(s.enrollmentId) }
  })

  // PDF do contrato em Word: o do envelope, quando já existe (congelado), ou
  // gerado na hora com os dados atuais — é o que a pessoa lê antes de assinar.
  app.get('/api/public/registrations/:code/contrato/pdf', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const env = await envelopeDaInscricao(s.enrollmentId)
    let pdf: Buffer | null = null
    // Assinado: a via assinada do provedor (com a trilha das assinaturas). Se
    // não der para buscar, o documento que foi para assinatura.
    if (env?.status === 'ASSINADO' && env.arquivoAssinadoUrl) {
      const { lerPdfAssinado } = await import('../services/assinaturaProvedor.js')
      pdf = await lerPdfAssinado(env.arquivoAssinadoUrl)
    }
    if (!pdf && env?.arquivoBase64) pdf = Buffer.from(env.arquivoBase64, 'base64')
    // Sem envelope ainda: o contrato gerado agora, com os dados atuais.
    if (!pdf) pdf = (await pdfDoContratoDaInscricao(s.enrollmentId))?.pdf ?? null
    if (!pdf) return reply.code(404).send({ error: 'Não há contrato configurado para este curso.' })
    const nome = env?.status === 'ASSINADO' ? 'contrato-assinado.pdf' : 'contrato.pdf'
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${nome}"`)
      .header('Cache-Control', 'no-store').send(pdf)
  })

  // Assinatura eletrônica (Autentique): gera o envelope e devolve o link.
  app.post('/api/public/registrations/:code/contrato/iniciar', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const impedimento = await impedimentoParaAssinar(s.enrollmentId)
    if (impedimento) return reply.code(400).send({ error: impedimento })
    const r = await iniciarAssinaturaDaInscricao(s.enrollmentId)
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    return { assinatura: r.assinatura }
  })

  // Situação da assinatura (a tela consulta enquanto a pessoa assina na Autentique).
  app.get('/api/public/registrations/:code/contrato/status', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    return { assinatura: await estadoDaAssinaturaDaInscricao(s.enrollmentId, true) }
  })

  app.post('/api/public/registrations/:code/contrato/assinar', async (req, reply) => {
    const s = sessaoDoCandidato(req, (req.params as any).code)
    if (!s) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: s.enrollmentId }, select: { leadId: true, candidateCode: true } })
    const impedimento = await impedimentoParaAssinar(s.enrollmentId)
    if (impedimento) return reply.code(400).send({ error: impedimento })
    // Contrato em Word: com Autentique, a assinatura é lá (rota /iniciar); sem
    // ela, o aceite é aqui mesmo, mas sobre o PDF do contrato de verdade.
    const word = await contratoWordDaInscricao(s.enrollmentId)
    if (word) {
      if (word.eletronica) return reply.code(400).send({ error: 'Este contrato é assinado eletronicamente — use o botão "Assinar".' })
      const nome = String((req.body as any)?.nome || '').trim()
      if (nome.length < 5 || !nome.includes(' ')) return reply.code(400).send({ error: 'Escreva seu nome completo para assinar.' })
      const r = await aceitarContratoNoPortal(s.enrollmentId, nome)
      if (!r.ok) return reply.code(400).send({ error: r.erro })
      return { ok: true, jaAssinado: false }
    }
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
