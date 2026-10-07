// Painel Gerencial — página live + API (fechamento mensal, escopo ineprotec).
//
// Acesso por TOKEN (link compartilhável), como o painel original: nada de
// sessão do bychat. O token vem em `?token=` (ou header x-painel-token) e é
// conferido contra PAINEL_TOKEN do .env. A página embute o token da própria URL
// e chama a API no mesmo domínio.
//
// Período via resolvePeriod (from/to, range=7d/30d/90d, days) — o mesmo seletor
// "mês + data personalizada" das outras telas.
import { FastifyInstance } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePeriod } from '../lib/period.js'
import { painelComercial, painelMarketing } from '../services/painelGerencial.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PAGE = join(__dirname, '../../painel/index.html')

function tokenOk(req: any): boolean {
  const esperado = process.env.PAINEL_TOKEN || ''
  if (!esperado) return false
  const dado = String(req.query?.token || req.headers['x-painel-token'] || '')
  return dado.length > 0 && dado === esperado
}

export async function painelGerencialRoutes(app: FastifyInstance) {
  // Página (HTML). Não exige token para ABRIR (o JS exige token para os dados),
  // assim um link sem token mostra a tela pedindo o token em vez de 404.
  app.get('/painel', async (_req, reply) => {
    try {
      const html = await readFile(PAGE, 'utf8')
      reply.header('Content-Type', 'text/html; charset=utf-8')
      reply.header('Cache-Control', 'no-store')
      return reply.send(html)
    } catch {
      return reply.code(404).send('Painel não encontrado')
    }
  })

  // API comercial — gate por token.
  app.get('/api/painel/comercial', async (req, reply) => {
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    const q: any = req.query || {}
    const periodo = resolvePeriod(q, 30)
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : undefined
    return painelComercial(periodo, funnelId)
  })

  // API marketing — gate por token.
  app.get('/api/painel/marketing', async (req, reply) => {
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    const q: any = req.query || {}
    const periodo = resolvePeriod(q, 30)
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : undefined
    return painelMarketing(periodo, funnelId)
  })
}
