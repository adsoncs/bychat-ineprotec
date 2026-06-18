// src/routes/acaComunicacao.ts
// Módulo Acadêmico · P9 — Comunicação (config, log e disparos manuais).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getNotifConfig, setNotifConfig, varrerVencimentos, varrerInadimplencia, notificarNotasTurma } from '../services/acaComunicacao.js'

export async function acaComunicacaoRoutes(app: FastifyInstance) {
  // ── GET/PUT config ──
  app.get('/api/admin/aca/comunicacao/config', { preHandler: authMiddleware }, async () => ({ config: await getNotifConfig() }))
  app.put('/api/admin/aca/comunicacao/config', { preHandler: authMiddleware }, async (req) => ({ config: await setNotifConfig((req.body as any) || {}) }))

  // ── log de envios ──
  app.get('/api/admin/aca/comunicacao/log', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    if (q.tipo) where.tipo = String(q.tipo)
    const itens = await prisma.acaComunicacao.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
    return { itens }
  })

  // ── disparo manual: varrer vencimentos agora ──
  app.post('/api/admin/aca/comunicacao/vencimentos/run', { preHandler: authMiddleware }, async () => varrerVencimentos())

  // ── disparo manual: régua de cobrança (inadimplência) ──
  app.post('/api/admin/aca/comunicacao/inadimplencia/run', { preHandler: authMiddleware }, async () => varrerInadimplencia())

  // ── disparo manual: avisar notas publicadas de uma turma ──
  app.post('/api/admin/aca/comunicacao/notas/:turmaId', { preHandler: authMiddleware }, async (req) => notificarNotasTurma(Number((req.params as any).turmaId)))
}
