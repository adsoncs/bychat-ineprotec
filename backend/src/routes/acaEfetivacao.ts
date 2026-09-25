// src/routes/acaEfetivacao.ts
// Módulo Acadêmico · rotas da ponte Portal de Matrículas → ERP.
// Vive no overlay (é ERP): tenant sem módulo acadêmico não tem estas rotas.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { efetivarInscricao } from '../services/acaEfetivacao.js'
import { funilDeMatriculas } from '../services/acaFunilMatriculas.js'
import { relatorioDeConversao } from '../services/acaRelatorioConversao.js'

export async function acaEfetivacaoRoutes(app: FastifyInstance) {
  // ── POST /inscricoes-portal/:id/efetivar — candidato do portal vira aluno ──
  app.post('/api/admin/aca/inscricoes-portal/:id/efetivar', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const b = (req.body as any) || {}
    try {
      const r = await efetivarInscricao(id, {
        turmaId: b.turmaId ? Number(b.turmaId) : null,
        forcarEspera: b.forcarEspera === true,
        origem: b.origem,
      })
      return reply.code(r.jaExistia ? 200 : 201).send({ ok: true, ...r })
    } catch (e: any) {
      // As mensagens do serviço são feitas para a secretaria ler e agir
      // (abrir turma, escolher curso), então vão inteiras para a tela.
      return reply.code(409).send({ error: e?.message || 'Não foi possível efetivar a matrícula.' })
    }
  })


  // ── GET /funil-matriculas — painel único da secretaria ──
  // Uma tela para "quem está parado e no quê", em vez de cruzar inscrição,
  // documento, contrato e matrícula em quatro lugares.
  app.get('/api/admin/aca/funil-matriculas', { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    return funilDeMatriculas({
      etapa: q.etapa || undefined,
      portalId: q.portalId ? Number(q.portalId) : undefined,
      busca: q.busca || undefined,
      limite: q.limite ? Number(q.limite) : undefined,
    })
  })

  // ── POST /efetivar-lote — efetiva várias inscrições de uma vez ──
  // A secretaria trabalha por turma: uma a uma vira trabalho de digitação.
  app.post('/api/admin/aca/inscricoes-portal/efetivar-lote', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : []
    if (!ids.length) return reply.code(400).send({ error: 'Informe ao menos uma inscrição.' })
    if (ids.length > 100) return reply.code(400).send({ error: 'Máximo de 100 inscrições por vez.' })

    const ok: any[] = []
    const falhas: Array<{ id: number; erro: string }> = []
    for (const id of ids) {
      try {
        ok.push({ id, ...(await efetivarInscricao(id, { forcarEspera: b.forcarEspera === true })) })
      } catch (e: any) {
        // Uma falha não interrompe o lote — a secretaria vê o que passou e o
        // que não, com o motivo de cada recusa.
        falhas.push({ id, erro: e?.message || 'falha desconhecida' })
      }
    }
    return { efetivadas: ok.length, falhas, itens: ok }
  })


  // ── GET /conversao-matriculas — de cada 100 inscrições, quantas matriculam ──
  app.get('/api/admin/aca/conversao-matriculas', { preHandler: authMiddleware }, async (req) => {
    const q = (req.query as any) || {}
    return relatorioDeConversao({
      ...(q.desde ? { desde: new Date(String(q.desde)) } : {}),
      ...(q.ate ? { ate: new Date(String(q.ate)) } : {}),
      ...(q.portalId ? { portalId: Number(q.portalId) } : {}),
    })
  })

  // ── GET /inscricoes-portal — fila de quem já pode virar aluno ──
  // Quem terminou a inscrição e ainda não tem matrícula no ERP.
  app.get('/api/admin/aca/inscricoes-portal', { preHandler: authMiddleware }, async (req) => {
    const status = String((req.query as any)?.status || '').trim()
    const regs = await prisma.enrollmentRegistration.findMany({
      where: status ? { status } : { status: { notIn: ['enrolled', 'cancelled', 'expired', 'rejected'] } },
      orderBy: { id: 'desc' },
      take: 100,
      select: {
        id: true, candidateCode: true, status: true, createdAt: true,
        paymentStatus: true, paymentPaidAt: true,
        lead: { select: { id: true, nome: true, email: true, whatsapp: true } },
        portal: { select: { nome: true, slug: true } },
        processRegistration: {
          select: { offering: { select: { id: true, nome: true, turno: true } } },
        },
        documents: { select: { id: true, status: true } },
      },
    })

    const leadIds = regs.map((r) => r.lead?.id).filter((x): x is number => !!x)
    const alunos = leadIds.length
      ? await prisma.aluno.findMany({ where: { leadId: { in: leadIds } }, select: { id: true, leadId: true, ra: true } })
      : []
    const porLead = new Map(alunos.map((a) => [a.leadId, a]))

    return {
      inscricoes: regs.map((r) => {
        const aluno = r.lead ? porLead.get(r.lead.id) : undefined
        const docs = r.documents
        return {
          id: r.id,
          codigo: r.candidateCode,
          status: r.status,
          criadaEm: r.createdAt,
          candidato: r.lead ? { nome: r.lead.nome, email: r.lead.email, whatsapp: r.lead.whatsapp } : null,
          portal: r.portal?.nome ?? null,
          oferta: r.processRegistration?.offering ?? null,
          pagamento: { status: r.paymentStatus, pagoEm: r.paymentPaidAt },
          documentos: {
            enviados: docs.length,
            aprovados: docs.filter((d) => d.status === 'approved').length,
            pendentes: docs.filter((d) => d.status !== 'approved').length,
          },
          aluno: aluno ? { id: aluno.id, ra: aluno.ra } : null,
        }
      }),
    }
  })
}
