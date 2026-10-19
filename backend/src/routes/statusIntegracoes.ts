// src/routes/statusIntegracoes.ts
//
// Barra de status das integrações (topbar + faixa fixa). Quem vê e quem
// configura é decidido pelo módulo `status_integracoes` em Permissões:
//   Ver    → enxerga a barra (nasce para todos os papéis);
//   Editar → configura os itens, vê o detalhe técnico e o botão de resolver.
//
// O gate do módulo (modulePermissionHook, prefixo /api/status-integracoes)
// barra quem não tem Ver; Editar é conferido aqui, porque o GET da barra é o
// mesmo para os dois e só a resposta muda.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { resolvePermissions } from '../lib/permissions.js'
import {
  instantaneo, verificarAgora, lerConfig, salvarConfig, INTERVALO_MIN, type Instantaneo, type ConfigBarra,
} from '../services/statusIntegracoes.js'

const MODULO = 'status_integracoes'

async function podeConfigurar(req: FastifyRequest): Promise<boolean> {
  const u = (req as any).user as { userId: number; role: string } | undefined
  if (!u) return false
  if (u.role === 'SUPERADMIN') return true
  const perms = await resolvePermissions(u.userId, u.role).catch(() => ({} as Record<string, any>))
  return !!(perms as any)[MODULO]?.canEdit
}

/** O que a barra desenha: só o que está configurado, ligado e lido. */
export function paraABarra(snap: Instantaneo, config: ConfigBarra, gestao: boolean) {
  const itens = config.ativo
    ? snap.itens
      .filter((i) => i.configurado && i.mostrar && i.leitura)
      .map((i) => ({
        id: i.id,
        rotulo: i.rotulo,
        estado: i.leitura!.estado,
        motivo: i.leitura!.motivo,
        desde: i.leitura!.desde,
        avisoFixo: i.avisoFixo,
        // Detalhe técnico e botão de resolver: só para quem configura. Quem
        // atende vê o motivo em linguagem simples e sabe a quem avisar.
        detalhe: gestao ? (i.leitura!.detalhe ?? null) : null,
        acao: gestao ? i.acao : null,
      }))
    : []
  return {
    ativo: config.ativo,
    verificadoEm: snap.verificadoEm,
    intervaloMin: INTERVALO_MIN,
    podeConfigurar: gestao,
    faixa: config.faixaPara === 'todos' || gestao,
    itens,
  }
}

export async function statusIntegracoesRoutes(app: FastifyInstance) {
  app.get('/api/status-integracoes', { preHandler: [authMiddleware] }, async (req) => {
    const [snap, config, gestao] = await Promise.all([instantaneo(), lerConfig(), podeConfigurar(req)])
    return paraABarra(snap, config, gestao)
  })

  // Tela de configuração: todos os itens, inclusive os não configurados.
  app.get('/api/status-integracoes/config', { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!(await podeConfigurar(req))) return reply.code(403).send({ error: 'Sem permissão para configurar a barra de status' })
    const [snap, config] = await Promise.all([instantaneo(), lerConfig()])
    return {
      ativo: config.ativo,
      faixaPara: config.faixaPara,
      verificadoEm: snap.verificadoEm,
      intervaloMin: INTERVALO_MIN,
      itens: snap.itens.map((i) => ({
        id: i.id,
        rotulo: i.rotulo,
        configurado: i.configurado,
        mostrar: i.mostrar,
        avisoFixo: i.avisoFixo,
        acao: i.acao,
        estado: i.leitura?.estado ?? null,
        motivo: i.leitura?.motivo ?? null,
        detalhe: i.leitura?.detalhe ?? null,
        desde: i.leitura?.desde ?? null,
      })),
    }
  })

  app.put('/api/status-integracoes/config', { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!(await podeConfigurar(req))) return reply.code(403).send({ error: 'Sem permissão para configurar a barra de status' })
    const body = (req.body ?? {}) as Partial<ConfigBarra>
    const config = await salvarConfig({
      ativo: body.ativo,
      faixaPara: body.faixaPara,
      itens: body.itens && typeof body.itens === 'object' ? body.itens : undefined,
    })
    return { ok: true, config }
  })

  app.post('/api/status-integracoes/verificar', { preHandler: [authMiddleware] }, async (req, reply) => {
    if (!(await podeConfigurar(req))) return reply.code(403).send({ error: 'Sem permissão para verificar agora' })
    const [snap, config] = await Promise.all([verificarAgora(), lerConfig()])
    return paraABarra(snap, config, true)
  })
}
