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

  // Mesma busca para o portal do aluno (inscrição e "Completar cadastro"), sem
  // login. Fica sob /api/public/portals/ porque o portal responde também por
  // domínio próprio (a Origin é externa). Limite por IP: 30 buscas por minuto,
  // mais que suficiente para quem digita o próprio CEP; o resto cai no limite
  // geral das rotas públicas.
  app.get('/api/public/portals/cep/:cep', async (req, reply) => {
    if (!dentroDoLimite(req.ip)) return reply.code(429).send({ error: 'Muitas buscas de CEP seguidas. Preencha o endereço à mão ou tente em 1 minuto.' })
    const r = await buscarCep((req.params as any).cep, req.log)
    if (!r) return reply.code(400).send({ error: 'CEP deve ter 8 dígitos.' })
    if (r.situacao === 'indisponivel') return reply.code(503).send({ error: 'Busca de CEP indisponível no momento. Preencha o endereço à mão.', situacao: r.situacao })
    reply.header('cache-control', 'public, max-age=86400')
    return r
  })
}

const LIMITE_POR_MINUTO = 30
const buscasPorIp = new Map<string, { n: number; ate: number }>()
function dentroDoLimite(ip: string): boolean {
  const agora = Date.now()
  const e = buscasPorIp.get(ip)
  if (!e || e.ate < agora) {
    if (buscasPorIp.size > 5000) for (const [k, v] of buscasPorIp) if (v.ate < agora) buscasPorIp.delete(k)
    buscasPorIp.set(ip, { n: 1, ate: agora + 60_000 })
    return true
  }
  e.n++
  return e.n <= LIMITE_POR_MINUTO
}
