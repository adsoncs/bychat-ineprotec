// src/routes/acaFinanceiro.ts
// Módulo Acadêmico · P5 — Financeiro (rotas). Parcelas da matrícula, geração de
// cobrança no Asaas (reuso), baixa manual e webhook idempotente do Asaas.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { criarCobrancaParcela, darBaixaManual, processarWebhookAsaas, gerarContratoEParcelas } from '../services/acaFinanceiro.js'
import crypto from 'crypto'

export async function acaFinanceiroRoutes(app: FastifyInstance) {
  // ── GET /matriculas/:id/financeiro — contrato + parcelas ──
  app.get('/api/admin/aca/matriculas/:id/financeiro', { preHandler: authMiddleware }, async (req) => {
    const matriculaId = Number((req.params as any).id)
    const contrato = await prisma.acaContrato.findUnique({
      where: { matriculaId },
      include: { parcelas: { orderBy: { nroParcela: 'asc' } } },
    })
    return { contrato }
  })

  // ── POST /matriculas/:id/financeiro/gerar — gera contrato+parcelas (idempotente) ──
  app.post('/api/admin/aca/matriculas/:id/financeiro/gerar', { preHandler: authMiddleware }, async (req, reply) => {
    const matriculaId = Number((req.params as any).id)
    try { return await gerarContratoEParcelas(matriculaId) }
    catch (e: any) { return reply.code(400).send({ error: e.message }) }
  })

  // ── POST /parcelas/:id/cobranca — emite boleto/PIX no Asaas ──
  app.post('/api/admin/aca/parcelas/:id/cobranca', { preHandler: authMiddleware }, async (req, reply) => {
    const r = await criarCobrancaParcela(Number((req.params as any).id))
    if (!r.ok) return reply.code(400).send({ error: r.error })
    return r
  })

  // ── POST /parcelas/:id/baixa — baixa manual ──
  app.post('/api/admin/aca/parcelas/:id/baixa', { preHandler: authMiddleware }, async (req, reply) => {
    try { await darBaixaManual(Number((req.params as any).id)); return { ok: true } }
    catch (e: any) { return reply.code(400).send({ error: e.message }) }
  })

  // ── Webhook Asaas (público; sob prefixo bypassado pelo gate) — IDEMPOTENTE ──
  app.post('/api/payment-webhook/aca-asaas', async (req, reply) => {
    // Com token de autenticação configurado em alguma conexão Asaas, o aviso
    // precisa trazê-lo (header asaas-access-token). Sem nenhum configurado, o
    // aviso segue aceito — e mesmo assim a baixa só acontece se a API do Asaas
    // confirmar o pagamento (processarWebhookAsaas).
    const segredos = (await prisma.paymentProviderConnection.findMany({
      where: { provider: 'asaas', active: true, webhookSecret: { not: null } },
      select: { webhookSecret: true },
    })).map((c) => String(c.webhookSecret || '').trim()).filter(Boolean)
    if (segredos.length) {
      const veio = Buffer.from(String(req.headers['asaas-access-token'] || ''))
      const confere = segredos.some((s) => {
        const b = Buffer.from(s)
        return b.length === veio.length && crypto.timingSafeEqual(b, veio)
      })
      if (!confere) return reply.code(401).send({ error: 'Token de autenticação inválido' })
    }
    try {
      const r = await processarWebhookAsaas(req.body as any)
      return reply.code(200).send(r)
    } catch (e: any) {
      // Responde 200 mesmo em erro lógico para o Asaas não reenfileirar infinito;
      // o erro fica registrado em AcaIntegracaoEvento.
      return reply.code(200).send({ ok: false, error: e.message })
    }
  })
}
