// Painel Gerencial — página live + API (fechamento mensal). Módulo
// `painel_gerencial`: desligado, a página e a API respondem 404; ligado e sem
// `painel_gerencial.config`, a API responde que não está configurado.
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
import { painelComercial, painelMarketing, painelVersao, empresaDe, carregarConfigPainel } from '../services/painelGerencial.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

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
    if (!(await isModuleEnabled('painel_gerencial'))) return reply.code(404).send('Não encontrado')
    try {
      const html = await readFile(PAGE, 'utf8')
      reply.header('Content-Type', 'text/html; charset=utf-8')
      reply.header('Cache-Control', 'no-store')
      return reply.send(html)
    } catch {
      return reply.code(404).send('Painel não encontrado')
    }
  })

  // Configuração pública da página (nome e empresas) — gate por token.
  app.get('/api/painel/config', async (req, reply) => {
    if (!(await isModuleEnabled('painel_gerencial'))) return reply.code(404).send({ error: 'Não encontrado' })
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    const cfg = await carregarConfigPainel()
    if (!cfg) return reply.code(409).send({ error: 'Painel não configurado (painel_gerencial.config)' })
    return { titulo: cfg.titulo, empresas: Object.entries(cfg.empresas).map(([key, e]) => ({ key, nome: e.nome })) }
  })

  // API comercial — gate por token.
  app.get('/api/painel/comercial', async (req, reply) => {
    if (!(await isModuleEnabled('painel_gerencial'))) return reply.code(404).send({ error: 'Não encontrado' })
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    if (!(await carregarConfigPainel())) return reply.code(409).send({ error: 'Painel não configurado (painel_gerencial.config)' })
    const q: any = req.query || {}
    const periodo = resolvePeriod(q, 30)
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : undefined
    return painelComercial(periodo, funnelId, empresaDe(q.empresa))
  })

  // API marketing — gate por token.
  app.get('/api/painel/marketing', async (req, reply) => {
    if (!(await isModuleEnabled('painel_gerencial'))) return reply.code(404).send({ error: 'Não encontrado' })
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    if (!(await carregarConfigPainel())) return reply.code(409).send({ error: 'Painel não configurado (painel_gerencial.config)' })
    const q: any = req.query || {}
    const periodo = resolvePeriod(q, 30)
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : undefined
    return painelMarketing(periodo, funnelId, empresaDe(q.empresa))
  })

  // Versão dos dados — a página faz polling barato aqui e só recarrega os
  // números quando algo mudou no sistema (lead novo/editado, card movido).
  app.get('/api/painel/versao', async (req, reply) => {
    if (!(await isModuleEnabled('painel_gerencial'))) return reply.code(404).send({ error: 'Não encontrado' })
    if (!tokenOk(req)) return reply.code(401).send({ error: 'token inválido' })
    if (!(await carregarConfigPainel())) return reply.code(409).send({ error: 'Painel não configurado (painel_gerencial.config)' })
    const q: any = req.query || {}
    const funnelId = Number(q.funnelId) > 0 ? Number(q.funnelId) : undefined
    reply.header('Cache-Control', 'no-store')
    return { v: await painelVersao(funnelId, empresaDe(q.empresa)) }
  })
}
