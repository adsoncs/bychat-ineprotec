// routes/inadimplencia.ts — tela "Inadimplência e acordos" (services/inadimplencia).
// Só para quem vê todos os portais: a dívida é da instituição, como no Financeiro.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { guardTela } from '../lib/eduTelas.js'
import { alcanceDaRequisicao } from '../lib/portalAccess.js'
import type { JwtPayload } from '../lib/auth.js'
import * as I from '../services/inadimplencia.js'
import { getEncargosConfig, setEncargosConfig } from '../services/acaEncargos.js'

const BASE = '/api/admin/inadimplencia'

async function operador(req: FastifyRequest) {
  const u = (req as any).user as JwtPayload
  const x = await prisma.user.findUnique({ where: { id: u.userId }, select: { name: true } })
  return { userId: u.userId, nome: x?.name || u.name || 'Atendente' }
}

export async function inadimplenciaRoutes(app: FastifyInstance) {
  const guarda = [guardTela('admin'), async (req: any, reply: any) => {
    if (!(await alcanceDaRequisicao(req)).todos) return reply.code(403).send({ error: 'Esta tela é de quem vê todos os portais.' })
  }]
  const resposta = (reply: any, r: any) => (r.ok ? r : reply.code(r.status).send({ error: r.erro }))

  app.get(`${BASE}/resumo`, { preHandler: guarda }, () => I.resumo())
  // Rota própria: a do Financeiro do acadêmico não existe onde o ERP está desligado.
  app.get(`${BASE}/regras`, { preHandler: guarda }, async () => ({ config: await getEncargosConfig() }))
  app.put(`${BASE}/regras`, { preHandler: guarda }, async (req) => {
    const b = (req.body ?? {}) as any
    return { config: await setEncargosConfig({ multaPct: b.multaPct, jurosMesPct: b.jurosMesPct, carenciaDias: b.carenciaDias }) }
  })
  app.get(`${BASE}/devedores`, { preHandler: guarda }, async (req) => ({ devedores: await I.listarDevedores(req.query as any) }))
  app.get(`${BASE}/devedores.csv`, { preHandler: guarda }, async (req, reply) => {
    const csv = I.csvDosDevedores(await I.listarDevedores(req.query as any))
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="inadimplencia.csv"').send(csv)
  })
  app.get(`${BASE}/devedores/:leadId`, { preHandler: guarda }, async (req, reply) => {
    const d = await I.detalheDoDevedor(Number((req.params as any).leadId))
    return d ?? reply.code(404).send({ error: 'Lead não encontrado.' })
  })
  app.post(`${BASE}/contatos`, { preHandler: guarda }, async (req, reply) => resposta(reply, await I.registrarContato(req.body, await operador(req))))
  app.get(`${BASE}/acordos`, { preHandler: guarda }, async (req) => ({ acordos: await I.listarAcordos((req.query as any).status) }))
  app.post(`${BASE}/acordos/simular`, { preHandler: guarda }, async (req, reply) => {
    const r = await I.simularAcordo(req.body)
    return 'erro' in r ? reply.code(400).send({ error: r.erro }) : r
  })
  app.post(`${BASE}/acordos`, { preHandler: guarda }, async (req, reply) => resposta(reply, await I.efetivarAcordo(req.body, await operador(req))))
  app.post(`${BASE}/acordos/:id/cancelar`, { preHandler: guarda }, async (req, reply) =>
    resposta(reply, await I.cancelarAcordo(Number((req.params as any).id), String((req.body as any)?.motivo ?? ''), await operador(req))))
  app.post(`${BASE}/titulos/:id/segunda-via`, { preHandler: guarda }, async (req, reply) =>
    resposta(reply, await I.segundaVia(Number((req.params as any).id), String((req.body as any)?.vencimento ?? ''), await operador(req))))
  app.post(`${BASE}/conferir/:id`, { preHandler: guarda }, async (req, reply) =>
    resposta(reply, await I.marcarConferido(Number((req.params as any).id), String((req.body as any)?.nota ?? ''), await operador(req))))
  app.post(`${BASE}/baixa`, { preHandler: guarda }, async (req, reply) =>
    resposta(reply, await I.baixaManual(String((req.body as any)?.chave ?? ''), String((req.body as any)?.nota ?? ''), await operador(req))))
}
