// routes/atualizarFatura.ts — "Atualizar fatura vencida" (services/atualizarFatura).
//   Equipe:  GET  /api/admin/enrollment-registrations/:id/faturas
//            POST /api/admin/enrollment-registrations/:id/faturas/atualizar  { chave, vencimento }
//   Financeiro do portal (mesmas rotas, permissão da tela edu_financeiro_portal):
//            GET  /api/admin/educational/portal-financeiro/:id/faturas
//            POST /api/admin/educational/portal-financeiro/:id/faturas/atualizar
//   Aluno:   POST /api/public/portal/area/fatura/atualizar                  { codigo, chave }  (Meu Portal, cookie)
//            POST /api/public/registrations/:code/fatura/atualizar          { chave }          (tela de pagamento, token)
// O aluno só atualiza a vencida e só para hoje; a equipe escolhe a data.
import { FastifyInstance } from 'fastify'
import { guardTela } from '../lib/eduTelas.js'
import type { JwtPayload } from '../lib/auth.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { verifyCandidateToken } from '../lib/candidateAuth.js'
import { atualizarFaturaVencida, mensagemDaFaturaAtualizada } from '../services/atualizarFatura.js'
import { areaAtiva, faturasDaInscricao, inscricaoParaFaturas, inscricoesDaConta } from '../services/areaDoAluno.js'
import { hojeBr } from '../services/pagamentoCombinado.js'

const CHAVE = /^(titulo:\d+|reg:\d+|asaas:[A-Za-z0-9_]+)$/

export async function atualizarFaturaRoutes(app: FastifyInstance) {
  // Mesmo serviço nas duas telas da equipe; o guardTela decide a permissão
  // pela URL (inscrição = Portal de Matrículas; Financeiro = Financeiro do portal).
  for (const base of ['/api/admin/enrollment-registrations', '/api/admin/educational/portal-financeiro']) {
    app.get(`${base}/:id/faturas`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const r = await inscricaoParaFaturas(Number((req.params as any).id))
      if (!r) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
      const { faturas, aviso } = await faturasDaInscricao(r)
      return { faturas, aviso, hoje: hojeBr() }
    })

    app.post(`${base}/:id/faturas/atualizar`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const id = Number((req.params as any).id)
      const b = (req.body as any) || {}
      const chave = String(b.chave || '')
      if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
      const user = (req as any).user as JwtPayload
      const r = await atualizarFaturaVencida({ registrationId: id, chave, vencimento: b.vencimento ? String(b.vencimento) : null, ator: { tipo: 'atendente', userId: user?.userId ?? null, nome: (user as any)?.name ?? null, req } })
      if (!r.ok) return reply.code(r.status).send({ error: r.erro })
      return { ...r, mensagem: await mensagemDaFaturaAtualizada(id, r) }
    })
  }

  app.post('/api/public/portal/area/fatura/atualizar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!(await areaAtiva())) return reply.code(404).send({ error: 'Indisponível' })
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).send({ error: 'Entre no portal de novo.' })
    const b = (req.body as any) || {}
    const chave = String(b.chave || '')
    if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
    const reg = (await inscricoesDaConta(conta.leadId)).find((x) => x.candidateCode === String(b.codigo || ''))
    if (!reg || !reg.portal?.areaDoAluno) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
    // Só o que a própria área mostra como atualizável.
    const { faturas } = await faturasDaInscricao(reg)
    if (!faturas.some((f) => f.chave === chave && f.podeAtualizar)) return reply.code(409).send({ error: 'Esta fatura não pode ser atualizada. Fale com a secretaria.' })
    const r = await atualizarFaturaVencida({ registrationId: reg.id, chave, ator: { tipo: 'candidato', req } })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return r
  })

  app.post('/api/public/registrations/:code/fatura/atualizar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const code = String((req.params as any).code || '')
    const sess = verifyCandidateToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    if (!sess || sess.candidateCode !== code) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const chave = String(((req.body as any) || {}).chave || '')
    if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
    const reg = await inscricaoParaFaturas(sess.enrollmentId)
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
    const { faturas } = await faturasDaInscricao(reg)
    if (!faturas.some((f) => f.chave === chave && f.podeAtualizar)) return reply.code(409).send({ error: 'Esta fatura não pode ser atualizada. Fale com a secretaria.' })
    const r = await atualizarFaturaVencida({ registrationId: reg.id, chave, ator: { tipo: 'candidato', req } })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return r
  })
}
