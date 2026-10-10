// src/routes/volumetria.ts
//
// Volumetria — só o DONO do produto (lib/dono.ts). O superadmin é do cliente
// e não pode ver custo real nem margem. Sem permissão por papel: módulo nativo.

import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { exigirDono } from '../lib/dono.js'
import { competenciaAtual, volumetriaDoMes } from '../services/volumetria.js'
import { prisma } from '../lib/prisma.js'

export async function volumetriaRoutes(app: FastifyInstance) {
  const soDono = { preHandler: [authMiddleware, exigirDono] }

  app.get('/api/dono/volumetria', soDono, async (req, reply) => {
    const competencia = String((req.query as any)?.competencia ?? competenciaAtual())
    try {
      const volumetria = await volumetriaDoMes(competencia)
      // A cobrança calculada pela loja (se já calculou este mês).
      const cobranca = (await prisma.setting.findUnique({ where: { key: `consumo.cobranca.${competencia}` } }))?.value ?? null
      return { ...volumetria, cobranca }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
}
