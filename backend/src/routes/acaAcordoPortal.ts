// src/routes/acaAcordoPortal.ts
//
// Negociação de dívida no autoatendimento (T-906) + a política que a limita.
//
// O aluno/responsável simula e fecha o acordo sozinho, dentro da alçada que a
// IES configurou. O termo é aceito eletronicamente e as evidências (nome,
// documento, IP, user-agent, horário) ficam gravadas no acordo — é o que
// sustenta a negociação depois, já que ninguém assina papel aqui.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { verifyPortalToken as verifyToken } from '../lib/acaPortalToken.js'
import { getPolitica, salvarPolitica, parcelasNegociaveis, simular, efetivar } from '../services/acaAcordo.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'

const tokOf = (req: any): string => String((req.query as any)?.t || '')
const ipOf = (req: any): string => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0]!.trim()

export async function acaAcordoPortalRoutes(app: FastifyInstance) {
  // ── Política (admin) ──
  app.get('/api/admin/aca/acordo/politica', { preHandler: authMiddleware }, async () => ({ politica: await getPolitica() }))

  app.put('/api/admin/aca/acordo/politica', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    const politica = await salvarPolitica(b)
    const actor = auditActor(req)
    // Abrir negociação no portal delega alçada a quem deve — precisa de trilha.
    void logUserAudit({
      action: 'aca.acordo.politica', targetType: 'config', targetUserId: null,
      targetLabel: 'Política de acordo no portal', changes: politica as any, ...actor,
    })
    return { politica }
  })

  /** Parcelas negociáveis de um aluno (admin). */
  app.get('/api/admin/aca/acordo/negociaveis', { preHandler: authMiddleware }, async (req, reply) => {
    const alunoId = Number((req.query as any)?.alunoId)
    if (!alunoId) return reply.code(400).send({ error: 'alunoId é obrigatório' })
    return { parcelas: await parcelasNegociaveis(alunoId) }
  })

  // ── Portal: aluno e responsável usam o MESMO fluxo ──
  // O responsável negocia a dívida do aluno que ele responde; o token diz quem é.
  async function alunoDoToken(req: any): Promise<{ alunoId: number; quem: 'PORTAL_ALUNO' | 'PORTAL_RESPONSAVEL'; nome: string | null } | null> {
    const t = tokOf(req)
    const aluno = verifyToken(t, 'aca-aluno')
    if (aluno) {
      const a = await prisma.aluno.findUnique({ where: { id: aluno.id }, select: { cpf: true, lead: { select: { nome: true } } } })
      return { alunoId: aluno.id, quem: 'PORTAL_ALUNO', nome: a?.lead?.nome ?? null }
    }
    const resp = verifyToken(t, 'aca-responsavel')
    if (resp) {
      const r = await prisma.acaResponsavel.findUnique({ where: { id: resp.id }, select: { alunoId: true, nome: true } })
      if (r) return { alunoId: r.alunoId, quem: 'PORTAL_RESPONSAVEL', nome: r.nome }
    }
    return null
  }

  app.get('/api/public/aca/acordo/opcoes', async (req, reply) => {
    const ctx = await alunoDoToken(req)
    if (!ctx) return reply.code(403).send({ error: 'token inválido' })
    const politica = await getPolitica()
    if (!politica.portalHabilitado) {
      return reply.code(403).send({ error: 'A negociação online não está disponível. Fale com a secretaria.' })
    }
    const parcelas = await parcelasNegociaveis(ctx.alunoId, politica)
    return { politica, parcelas, quem: ctx.quem }
  })

  app.post('/api/public/aca/acordo/simular', async (req, reply) => {
    const ctx = await alunoDoToken(req)
    if (!ctx) return reply.code(403).send({ error: 'token inválido' })
    const b = (req.body as any) || {}
    const ids = (b.parcelaIds || []).map(Number).filter(Boolean)
    if (ids.length === 0) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })
    // Só parcelas do próprio aluno — o token não pode virar chave para a dívida alheia.
    const doAluno = await parcelasNegociaveis(ctx.alunoId)
    const permitidos = new Set(doAluno.map((p) => p.id))
    if (ids.some((id: number) => !permitidos.has(id))) return reply.code(403).send({ error: 'Parcela não pertence a este aluno.' })
    try {
      return { simulacao: await simular({ parcelaIds: ids, numParcelas: Number(b.numParcelas) || 1, entradaCentavos: Number(b.entradaCentavos) || 0, canalPortal: true }) }
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Não foi possível simular' })
    }
  })

  app.post('/api/public/aca/acordo/aceitar', async (req, reply) => {
    const ctx = await alunoDoToken(req)
    if (!ctx) return reply.code(403).send({ error: 'token inválido' })
    const b = (req.body as any) || {}
    const ids = (b.parcelaIds || []).map(Number).filter(Boolean)
    if (ids.length === 0) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })
    if (b.aceite !== true && b.aceite !== 'true' && b.aceite !== 'on') {
      return reply.code(400).send({ error: 'É preciso aceitar os termos do acordo.' })
    }
    const doAluno = await parcelasNegociaveis(ctx.alunoId)
    const permitidos = new Set(doAluno.map((p) => p.id))
    if (ids.some((id: number) => !permitidos.has(id))) return reply.code(403).send({ error: 'Parcela não pertence a este aluno.' })

    try {
      const r = await efetivar({
        parcelaIds: ids,
        numParcelas: Number(b.numParcelas) || 1,
        entradaCentavos: Number(b.entradaCentavos) || 0,
        origem: ctx.quem,
        canalPortal: true,
        observacao: `Acordo fechado no portal por ${ctx.nome ?? 'titular do acesso'}.`,
        aceite: {
          nome: b.aceiteNome || ctx.nome,
          documento: b.aceiteDocumento || null,
          ip: ipOf(req),
          userAgent: String(req.headers['user-agent'] || '').substring(0, 500),
        },
      })
      return reply.code(201).send({ ok: true, acordoId: r.acordo.id, parcelasCriadas: r.parcelasCriadas })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message || 'Não foi possível fechar o acordo' })
    }
  })
}
