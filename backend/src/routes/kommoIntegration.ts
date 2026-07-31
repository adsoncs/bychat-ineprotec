// src/routes/kommoIntegration.ts
// Endpoints de configuração e controle da integração Kommo CRM.
//
//   GET  /api/admin/kommo/config   → estado atual (sem expor o token)
//   POST /api/admin/kommo/config   → salva subdomain/token/enabled (Settings)
//   POST /api/admin/kommo/test     → valida o token (GET /account na Kommo)
//
// A importação em si (Fases 1-4) roda via fila wf-kommo-sync — endpoints de
// disparo/status entram nas fases seguintes. Política: SUPERADMIN/ADMIN.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import {
  getKommoConfig,
  invalidateKommoConfigCache,
  kommoTestConnection,
  KommoAuthError,
} from '../lib/kommoClient.js'
import {
  listKommoBots,
  getImportedBots,
  planFromSource,
  importSalesbot,
} from '../services/kommoSalesbot.js'
import { triggerKommoSync } from '../services/kommoWorker.js'
import { getSyncState, getLastSyncAt } from '../services/kommoSync.js'
import { queues } from '../lib/queues.js'

async function upsertSetting(key: string, value: any, label: string, fieldType: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'kommo', fieldType },
    update: { value },
  })
}

export async function kommoIntegrationRoutes(app: FastifyInstance) {
  // ── GET config — nunca devolve o token, só se está presente ──
  app.get('/api/admin/kommo/config', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const cfg = await getKommoConfig(true)
    const lastSyncRow = await prisma.setting.findUnique({ where: { key: 'kommo.last_sync_at' } })
    const mappingCounts = await prisma.kommoMapping.groupBy({
      by: ['entityType'],
      _count: { _all: true },
    }).catch(() => [] as Array<{ entityType: string; _count: { _all: number } }>)

    return {
      subdomain: cfg.subdomain,
      enabled: cfg.enabled,
      hasToken: Boolean(cfg.token),
      lastSyncAt: lastSyncRow?.value ?? null,
      mappingCounts: Object.fromEntries(
        (mappingCounts as any[]).map((m) => [m.entityType, m._count._all]),
      ),
    }
  })

  // ── POST config — salva subdomain/token/enabled ──
  app.post<{ Body: { subdomain?: string; token?: string; enabled?: boolean } }>(
    '/api/admin/kommo/config',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const { subdomain, token, enabled } = req.body || {}

      if (subdomain !== undefined) {
        const clean = String(subdomain).trim().replace(/\.kommo\.com.*$/i, '')
        await upsertSetting('kommo.subdomain', clean, 'Subdomínio Kommo', 'text')
      }
      // Token só é gravado quando enviado não-vazio (evita sobrescrever com "").
      if (token !== undefined && String(token).trim() !== '') {
        await upsertSetting('kommo.token', String(token).trim(), 'Token Kommo (JWT)', 'password')
      }
      if (enabled !== undefined) {
        await upsertSetting('kommo.enabled', enabled ? 'true' : 'false', 'Integração Kommo ativa', 'boolean')
      }

      invalidateKommoConfigCache()
      const cfg = await getKommoConfig(true)
      return reply.send({ ok: true, subdomain: cfg.subdomain, enabled: cfg.enabled, hasToken: Boolean(cfg.token) })
    },
  )

  // ── POST test — valida o token contra /account ──
  app.post<{ Body: { subdomain?: string; token?: string } }>(
    '/api/admin/kommo/test',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const { subdomain, token } = req.body || {}
      // Permite testar credenciais avulsas (antes de salvar) ou as já salvas.
      let cfg = await getKommoConfig(true)
      if ((subdomain && String(subdomain).trim()) || (token && String(token).trim())) {
        cfg = {
          subdomain: subdomain ? String(subdomain).trim().replace(/\.kommo\.com.*$/i, '') : cfg.subdomain,
          token: token && String(token).trim() ? String(token).trim() : cfg.token,
          enabled: cfg.enabled,
        }
      }
      if (!cfg.subdomain || !cfg.token) {
        return reply.code(400).send({ ok: false, error: 'Informe subdomínio e token da Kommo' })
      }
      try {
        const account = await kommoTestConnection(cfg)
        return reply.send({ ok: true, account })
      } catch (err: any) {
        if (err instanceof KommoAuthError) {
          return reply.code(401).send({ ok: false, error: 'Token inválido ou expirado' })
        }
        return reply.code(502).send({ ok: false, error: err?.message || 'Falha ao conectar na Kommo' })
      }
    },
  )

  // ── POST sync — dispara importação (full) ou sincronização (incremental) ──
  app.post<{ Body: { mode?: 'full' | 'incremental' } }>(
    '/api/admin/kommo/sync',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const cfg = await getKommoConfig(true)
      if (!cfg.subdomain || !cfg.token) {
        return reply.code(400).send({ ok: false, error: 'Configure subdomínio e token antes de sincronizar' })
      }
      // Evita disparar um novo sync com outro em andamento.
      const state = await getSyncState()
      if (state?.running) {
        return reply.code(409).send({ ok: false, error: 'Já existe uma sincronização em andamento', state })
      }
      const mode = req.body?.mode === 'incremental' ? 'incremental' : 'full'
      await triggerKommoSync(mode)
      return reply.send({ ok: true, mode, message: mode === 'full' ? 'Importação completa iniciada' : 'Sincronização incremental iniciada' })
    },
  )

  // ── GET status — estado do sync + contagens + fila ──
  app.get('/api/admin/kommo/status', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const [state, lastSyncAt, counts, waiting, active] = await Promise.all([
      getSyncState(),
      getLastSyncAt(),
      prisma.kommoMapping.groupBy({ by: ['entityType'], _count: { _all: true } }).catch(() => [] as any[]),
      queues.kommoSync.getWaitingCount().catch(() => 0),
      queues.kommoSync.getActiveCount().catch(() => 0),
    ])
    return {
      state,
      lastSyncAt,
      lastSyncAtIso: lastSyncAt ? new Date(lastSyncAt * 1000).toISOString() : null,
      queue: { waiting, active },
      counts: Object.fromEntries((counts as any[]).map((m) => [m.entityType, m._count._all])),
    }
  })

  // ── GET bots — Salesbots da conta + o que já foi importado ──
  // A API pública da Kommo só devolve metadados do bot (id/nome/ativo); o roteiro
  // vem do "Ver código-fonte" do painel, colado no POST /bots/import.
  app.get('/api/admin/kommo/bots', { preHandler: [authMiddleware, adminOnly] }, async (_req, reply) => {
    const cfg = await getKommoConfig()
    if (!cfg.subdomain || !cfg.token) {
      return reply.code(400).send({ error: 'Configure subdomínio e token da Kommo antes de listar os bots' })
    }
    try {
      const [bots, imported] = await Promise.all([listKommoBots(cfg), getImportedBots()])
      const chatbotIds = [...imported.values()].map((v) => v.chatbotId)
      const chatbots = chatbotIds.length
        ? await prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true, active: true, formId: true } })
        : []
      const byId = new Map(chatbots.map((c) => [c.id, c]))
      return {
        bots: bots.map((b) => {
          const imp = imported.get(String(b.id))
          const chatbot = imp ? byId.get(imp.chatbotId) ?? null : null
          return {
            ...b,
            imported: Boolean(chatbot),
            chatbot,
            importedAt: (imp?.meta as any)?.importedAt ?? null,
            unsupported: (imp?.meta as any)?.unsupported ?? null,
          }
        }),
      }
    } catch (err: any) {
      if (err instanceof KommoAuthError) return reply.code(401).send({ error: err.message })
      return reply.code(502).send({ error: `Falha ao listar bots na Kommo: ${err?.message ?? err}` })
    }
  })

  // ── POST bots/preview — converte o código-fonte SEM gravar (revisão) ──
  app.post<{ Body: { source?: string } }>(
    '/api/admin/kommo/bots/preview',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const source = String(req.body?.source ?? '').trim()
      if (!source) return reply.code(400).send({ error: 'Cole o código-fonte do bot (JSON)' })
      try {
        return { plan: await planFromSource(source) }
      } catch (err: any) {
        return reply.code(400).send({ error: err?.message ?? 'Não foi possível ler o código-fonte' })
      }
    },
  )

  // ── POST bots/import — cria Form + Chatbot (inativo) a partir do código-fonte ──
  app.post<{
    Body: { kommoBotId?: number; name?: string; source?: string; channel?: string; funnelId?: number | null; stageKey?: string | null; defaultTeamId?: number | null }
  }>(
    '/api/admin/kommo/bots/import',
    { preHandler: [authMiddleware, adminOnly] },
    async (req, reply) => {
      const { kommoBotId, name, source, channel, funnelId, stageKey, defaultTeamId } = req.body || {}
      if (!kommoBotId || !Number.isFinite(Number(kommoBotId))) return reply.code(400).send({ error: 'Bot da Kommo não informado' })
      if (!name?.trim()) return reply.code(400).send({ error: 'Nome do chatbot é obrigatório' })
      if (!source?.trim()) return reply.code(400).send({ error: 'Cole o código-fonte do bot (JSON)' })
      try {
        const result = await importSalesbot({
          kommoBotId: Number(kommoBotId),
          name: name.trim(),
          source: source.trim(),
          channel,
          funnelId: funnelId ?? null,
          stageKey: stageKey ?? null,
          defaultTeamId: defaultTeamId ?? null,
        })
        return { ok: true, ...result }
      } catch (err: any) {
        return reply.code(400).send({ error: err?.message ?? 'Falha ao importar o bot' })
      }
    },
  )
}
