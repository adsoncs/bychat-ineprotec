// Busca de endereço pelo CEP para os formulários do painel (ver lib/cep.ts).
import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { buscarCep } from '../lib/cep.js'

export async function cepRoutes(app: FastifyInstance) {
  app.get('/api/cep/:cep', { preHandler: authMiddleware }, async (req, reply) => {
    const r = await buscarCep((req.params as any).cep, req.log)
    if (!r) return reply.code(400).send({ error: 'CEP deve ter 8 dígitos.' })
    if (r.situacao === 'indisponivel') return reply.code(503).send({ error: 'Busca de CEP indisponível no momento. Preencha o endereço à mão.', situacao: r.situacao })
    reply.header('cache-control', 'private, max-age=86400')
    return r
  })
}
