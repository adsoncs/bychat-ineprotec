// src/routes/crmEduIntegration.ts
// Configuração e controle da integração CRM Educacional (Wakeme).
//
//   GET  /api/admin/crmedu/config → estado atual (nunca devolve a senha)
//   POST /api/admin/crmedu/config → salva base_url/username/password/enabled
//   POST /api/admin/crmedu/test   → autentica e lê uma janela curta
//   POST /api/admin/crmedu/sync   → dispara a importação (assíncrona)
//   GET  /api/admin/crmedu/status → progresso da importação em curso
//
// A integração é de MÃO ÚNICA: só traz dados do CRM para o bychat.
// Política: SUPERADMIN/ADMIN.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import {
  getCrmEduConfig, resetCrmEduCache, buscarLeadsSemInscricao, CrmEduAuthError,
} from '../lib/crmEduClient.js'
import { sincronizar, progressoAtual, INICIO_PADRAO } from '../services/crmEduSync.js'

async function salvarSetting(key: string, value: string, label: string, fieldType: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'crmedu', fieldType },
    update: { value },
  })
}

function diasAtras(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function crmEduIntegrationRoutes(app: FastifyInstance) {
  app.get('/api/admin/crmedu/config', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const cfg = await getCrmEduConfig(true)
    const total = await prisma.crmEduMapping.count({ where: { entityType: 'lead' } }).catch(() => 0)
    const ultimo = await prisma.crmEduMapping.findFirst({
      where: { entityType: 'lead' }, orderBy: { syncedAt: 'desc' }, select: { syncedAt: true },
    }).catch(() => null)
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['crmedu.last_sync_at', 'crmedu.last_deep_at'] } },
      select: { key: true, value: true },
    })
    const s = new Map(rows.map((r) => [r.key, typeof r.value === 'string' ? r.value.replace(/^"|"$/g, '') : r.value]))
    return {
      baseUrl: cfg.baseUrl,
      username: cfg.username,
      senhaConfigurada: !!cfg.password, // a senha em si nunca sai daqui
      enabled: cfg.enabled,
      leadsImportados: total,
      ultimaSincronizacao: ultimo?.syncedAt ?? null,
      ultimaVerificacao: s.get('crmedu.last_sync_at') ?? null,
      ultimaPassadaProfunda: s.get('crmedu.last_deep_at') ?? null,
      pollMinutos: 10,
      inicioPadrao: INICIO_PADRAO,
    }
  })

  app.post('/api/admin/crmedu/config', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = req.body as any
    if (b.baseUrl !== undefined) {
      const url = String(b.baseUrl).trim().replace(/\/+$/, '')
      if (url && !/^https?:\/\//i.test(url)) {
        return reply.code(400).send({ error: 'baseUrl precisa começar com https://' })
      }
      await salvarSetting('crmedu.base_url', url, 'URL do CRM Educacional', 'text')
    }
    if (b.username !== undefined) await salvarSetting('crmedu.username', String(b.username).trim(), 'Usuário de integração', 'text')
    if (b.password) await salvarSetting('crmedu.password', String(b.password), 'Senha', 'password')
    if (b.enabled !== undefined) await salvarSetting('crmedu.enabled', b.enabled ? 'true' : 'false', 'Integração ativa', 'boolean')
    resetCrmEduCache()
    return { ok: true }
  })

  // Teste de conexão: autentica e lê 2 dias — barato e prova a ponta a ponta.
  app.post('/api/admin/crmedu/test', { preHandler: [authMiddleware, adminOnly] }, async (_req, reply) => {
    try {
      const leads = await buscarLeadsSemInscricao(diasAtras(2), diasAtras(0))
      const comTelefone = leads.filter((l) => l.TelefoneCelular || l.TelefoneComercial).length
      const comEmail = leads.filter((l) => l.Email).length
      return {
        ok: true,
        leadsNaJanela: leads.length,
        comTelefone,
        comEmail,
        amostra: leads.slice(0, 3).map((l) => ({
          nome: l.NomeCompleto || l.Nome, email: l.Email, telefone: l.TelefoneCelular, criadoEm: l.DataCriacao,
        })),
      }
    } catch (e: any) {
      const auth = e instanceof CrmEduAuthError
      return reply.code(auth ? 401 : 502).send({ ok: false, error: e?.message || 'Falha ao conectar' })
    }
  })

  // Dispara a importação. Roda em background: uma varredura completa leva
  // minutos e não cabe no ciclo de request.
  app.post('/api/admin/crmedu/sync', { preHandler: [authMiddleware, adminOnly] }, async (req, reply) => {
    const b = (req.body ?? {}) as any
    const emCurso = progressoAtual()
    if (emCurso && !emCurso.concluidoEm) {
      return reply.code(409).send({ error: 'Já existe uma sincronização em andamento', progresso: emCurso })
    }
    const opts = {
      de: b.de || INICIO_PADRAO,
      ate: b.ate || undefined,
      janelaDias: b.janelaDias ? Number(b.janelaDias) : 15,
      simular: !!b.simular,
      forcar: !!b.forcar,
      funnelId: b.funnelId ? Number(b.funnelId) : null,
      teamId: b.teamId ? Number(b.teamId) : null,
    }
    sincronizar(opts).catch((e) => console.error('[crmEduSync] falhou:', e?.message || e))
    return { ok: true, iniciado: true, opcoes: opts }
  })

  app.get('/api/admin/crmedu/status', { preHandler: [authMiddleware, adminOnly] }, async () => {
    const p = progressoAtual()
    if (!p) return { emAndamento: false, progresso: null }
    return {
      emAndamento: !p.concluidoEm,
      progresso: p,
      percentual: p.janelas ? Math.round((p.janelaAtual / p.janelas) * 100) : 0,
    }
  })
}
