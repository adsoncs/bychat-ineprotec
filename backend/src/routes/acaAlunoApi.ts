// src/routes/acaAlunoApi.ts
// API JSON do portal do aluno — consumida pela aplicação (portal-app).
// As páginas SSR continuam existindo e atendem os links já enviados.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { verifyPortalToken } from '../lib/acaPortalToken.js'
import { painelDoAluno } from '../services/acaPainelAluno.js'
import { contratoDoAluno, assinarPeloPortal } from '../services/portalContrato.js'
import { criarCobrancaParcela } from '../services/acaFinanceiro.js'

/** Sessão em cookie primeiro; token na URL continua valendo para links antigos. */
async function alunoDaRequisicao(req: any): Promise<number | null> {
  const conta = await contaDaRequisicao(req)
  if (conta) {
    const a = await prisma.aluno.findUnique({ where: { leadId: conta.leadId }, select: { id: true } })
    if (a) return a.id
  }
  const p = verifyPortalToken((req.query?.t as string) || '', 'aca-aluno')
  return p?.id ?? null
}

export async function acaAlunoApiRoutes(app: FastifyInstance) {
  app.get('/api/public/aca/aluno/painel', async (req, reply) => {
    const alunoId = await alunoDaRequisicao(req)
    if (!alunoId) return reply.code(401).send({ error: 'Entre no portal para ver seus dados.' })
    const painel = await painelDoAluno(alunoId)
    if (!painel) return reply.code(404).send({ error: 'Aluno não encontrado.' })
    return painel
  })

  // ── Contrato de matrícula (Fase 5) ──
  // O candidato assina aqui, no portal onde já está logado, e a assinatura
  // efetiva a matrícula. Antes só existia no SSR do ERP e no provedor externo.

  app.get('/api/public/aca/aluno/contrato', async (req, reply) => {
    const alunoId = await alunoDaRequisicao(req)
    if (!alunoId) return reply.code(401).send({ error: 'Entre no portal para ver seu contrato.' })
    const contrato = await contratoDoAluno(alunoId)
    if (!contrato) return reply.code(404).send({ error: 'Nenhum contrato disponível ainda.' })
    return { contrato }
  })

  app.post('/api/public/aca/aluno/contrato/assinar', async (req, reply) => {
    const alunoId = await alunoDaRequisicao(req)
    if (!alunoId) return reply.code(401).send({ error: 'Entre no portal para assinar.' })
    const body = (req.body as any) || {}
    // O IP entra no registro do aceite; atrás de proxy o real vem no cabeçalho.
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    const r = await assinarPeloPortal({
      alunoId,
      nome: String(body.nome || ''),
      ip,
      userAgent: (req.headers['user-agent'] as string) || null,
    })
    if (!r.ok) return reply.code(400).send({ error: r.erro })
    return r
  })

  // ── Gerar a cobrança de uma parcela (Fase 6) ──
  //
  // A página SSR antiga já fazia isso; a aplicação nova só sabia copiar o PIX de
  // uma cobrança que já existisse. Como a cobrança é criada sob demanda, o aluno
  // via a parcela em aberto e nenhuma forma de pagar — e a tela ainda prometia
  // um aviso por WhatsApp que ninguém envia.
  app.post('/api/public/aca/aluno/parcelas/:id/cobranca', async (req, reply) => {
    const alunoId = await alunoDaRequisicao(req)
    if (!alunoId) return reply.code(401).send({ error: 'Entre no portal para gerar a cobrança.' })
    const parcelaId = Number((req.params as any).id)
    if (!Number.isFinite(parcelaId)) return reply.code(400).send({ error: 'Parcela inválida.' })

    const parcela = await prisma.acaParcela.findUnique({
      where: { id: parcelaId },
      select: {
        id: true, situacao: true, asaasChargeId: true, linhaDigitavel: true, pixCopiaCola: true,
        contrato: { select: { matricula: { select: { alunoId: true } } } },
      },
    })
    // A parcela tem de ser desta pessoa. Sem isto, trocar o id na URL geraria
    // cobrança no nome de outro aluno.
    if (!parcela || parcela.contrato.matricula.alunoId !== alunoId) {
      return reply.code(404).send({ error: 'Parcela não encontrada.' })
    }
    if (parcela.situacao !== 'ABERTA') {
      return reply.code(400).send({ error: 'Esta parcela não está em aberto.' })
    }
    if (parcela.asaasChargeId) {
      return { ok: true, jaExistia: true, linhaDigitavel: parcela.linhaDigitavel, pix: parcela.pixCopiaCola }
    }

    const r = await criarCobrancaParcela(parcelaId)
    if (!r.ok) {
      req.log.warn(`[aluno] falha ao gerar cobrança da parcela ${parcelaId}: ${r.error}`)
      // O erro do gateway não serve para o aluno: ele não pode fazer nada com
      // "customer inválido". Diz o que dá para fazer.
      return reply.code(502).send({ error: 'Não conseguimos gerar o boleto agora. Tente de novo em alguns minutos ou fale com a secretaria.' })
    }
    const atual = await prisma.acaParcela.findUnique({
      where: { id: parcelaId },
      select: { linhaDigitavel: true, pixCopiaCola: true },
    })
    return { ok: true, jaExistia: false, linhaDigitavel: atual?.linhaDigitavel ?? null, pix: atual?.pixCopiaCola ?? null }
  })
}
