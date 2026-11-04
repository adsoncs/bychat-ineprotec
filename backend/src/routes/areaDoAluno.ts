// routes/areaDoAluno.ts — "Meu Portal" (services/areaDoAluno). Só com a conta
// logada no portal (cookie); desligada por instituição, responde { ativa:false }
// e o portal segue como era.
import { FastifyInstance } from 'fastify'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { areaAtiva, codigosDaFatura, montarArea } from '../services/areaDoAluno.js'

export async function areaDoAlunoRoutes(app: FastifyInstance) {
  app.get('/api/public/portal/area', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!(await areaAtiva())) return { ativa: false }
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).send({ error: 'Entre no portal para ver sua área.' })
    const codigo = String((req.query as any)?.codigo || '').trim() || null
    return montarArea(conta.leadId, codigo)
  })

  app.post('/api/public/portal/area/fatura/codigos', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!(await areaAtiva())) return reply.code(404).send({ error: 'Indisponível' })
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).send({ error: 'Entre no portal de novo.' })
    const b = (req.body as any) || {}
    const r = await codigosDaFatura(conta.leadId, String(b.codigo || ''), String(b.chave || ''))
    if (!r) return reply.code(404).send({ error: 'Fatura não encontrada.' })
    if (!r.pix && !r.linha) return reply.code(502).send({ error: 'O código ainda não ficou pronto. Use "Pagar" para abrir a fatura.' })
    return r
  })
}
