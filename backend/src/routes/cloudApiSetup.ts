// src/routes/cloudApiSetup.ts
// Rotas para setup do WhatsApp Cloud API: Embedded Signup, conexao, templates HSM

import { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { prisma } from '../lib/prisma.js'
import { setChannelTeams } from '../services/channelTeams.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { getMetaAppId, getMetaAppSecret, getMetaWaConfigId, metaFetch, META_GRAPH_URL } from '../lib/meta.js'
import {
  cloudApiFetch,
  encryptToken,
  decryptToken,
  createTemplate as apiCreateTemplate,
  deleteTemplate as apiDeleteTemplate,
  getPhoneNumbers,
  getWabaInfo,
  subscribeWebhook,
  getBusinessProfile,
} from '../services/cloudApi.js'
// Ciclo de vida centralizado (sync + detecção de mudança + notificação).
import { syncTemplatesFromMeta, isSendableStatus } from '../services/cloudApiTemplates.js'
import { requestSync } from '../services/cloudApiCoexistence.js'

// ─── Routes ─────────────────────────────────────────────

export async function cloudApiSetupRoutes(app: FastifyInstance) {

  // ══════════════════════════════════════════════════════
  //  CONFIG — App ID e Config ID para o JS SDK (frontend)
  // ══════════════════════════════════════════════════════

  // GET /api/cloud-api/config — Retorna dados para o Embedded Signup popup
  app.get('/api/cloud-api/config', { preHandler: authMiddleware }, async () => {
    try {
      const appId = await getMetaAppId()
      const configId = await getMetaWaConfigId()
      return { appId, configId: configId || null }
    } catch {
      return { appId: null, configId: null }
    }
  })

  // ══════════════════════════════════════════════════════
  //  EMBEDDED SIGNUP — Recebe token do frontend
  // ══════════════════════════════════════════════════════

  // POST /api/cloud-api/embedded-signup — Processa callback do Embedded Signup
  app.post('/api/cloud-api/embedded-signup', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const body = req.body as any
      let accessToken: string = body.accessToken
      const wabaId: string = body.wabaId
      const phoneNumberId: string = body.phoneNumberId

      if (!wabaId) return reply.code(400).send({ error: 'wabaId obrigatorio' })
      if (!phoneNumberId) return reply.code(400).send({ error: 'phoneNumberId obrigatorio' })

      // Se veio "code" (BISU flow), trocar por access_token server-side
      if (!accessToken && body.code) {
        try {
          const appId = await getMetaAppId()
          const appSecret = await getMetaAppSecret()
          if (!appSecret) return reply.code(500).send({ error: 'META_APP_SECRET nao configurado' })
          const url = `${META_GRAPH_URL}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(body.code)}`
          const r = await fetch(url)
          const codeResp: any = await r.json()
          if (!r.ok || !codeResp.access_token) {
            throw new Error(codeResp.error?.message || `HTTP ${r.status}`)
          }
          accessToken = codeResp.access_token
        } catch (exErr: any) {
          return reply.code(400).send({ error: `Falha ao trocar code por token: ${exErr.message}` })
        }
      }

      if (!accessToken) return reply.code(400).send({ error: 'accessToken ou code obrigatorio' })

      app.log.info(`[CloudAPI] Embedded Signup: wabaId=${wabaId}, phoneNumberId=${phoneNumberId}`)

      // 1. Validar WABA
      let wabaInfo: any = {}
      try {
        wabaInfo = await cloudApiFetch(`/${wabaId}?fields=name,currency,timezone_id,account_review_status,business_verification_status,ownership_type`, accessToken)
      } catch (err: any) {
        return reply.code(400).send({ error: `WABA invalido ou sem permissao: ${err.message}` })
      }

      // 2. Obter info do telefone
      let phoneInfo: any = {}
      try {
        // `is_on_biz_app` diz se o número segue ativo no app WhatsApp Business do
        // celular (COEXISTÊNCIA). É a fonte da verdade — o sinal que vem do
        // Embedded Signup é só a intenção do usuário na tela da Meta.
        phoneInfo = await cloudApiFetch(`/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name,platform_type,throughput,status,is_on_biz_app`, accessToken)
      } catch (err: any) {
        return reply.code(400).send({ error: `Phone Number invalido: ${err.message}` })
      }

      // 3. Obter System User Token de longa duracao
      // Para apps tipo Business, o token do Embedded Signup pode ja ser permanente
      // Tentamos trocar por um System User Token
      let finalToken = accessToken
      let tokenType = 'user'

      try {
        const appId = await getMetaAppId()
        const appSecret = await getMetaAppSecret()
        if (appSecret) {
          // Debug token para verificar tipo
          const debugResp = await metaFetch(`/debug_token?input_token=${accessToken}`, `${appId}|${appSecret}`)
          const debugData = debugResp.data || debugResp

          if (debugData.type === 'SYSTEM') {
            // Ja é um System User Token
            tokenType = 'system_user'
            app.log.info('[CloudAPI] Token ja é System User Token (permanente)')
          } else {
            // Trocar por token de longa duracao
            try {
              const llResp = await metaFetch(
                `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`,
                accessToken
              )
              if (llResp.access_token) {
                finalToken = llResp.access_token
                tokenType = 'long_lived'
                app.log.info('[CloudAPI] Token trocado por long-lived (60 dias)')
              }
            } catch (llErr: any) {
              app.log.warn(`[CloudAPI] Troca por long-lived falhou: ${llErr.message}`)
            }
          }
        }
      } catch (debugErr: any) {
        app.log.warn(`[CloudAPI] Token debug falhou: ${debugErr.message}`)
      }

      // 4. Criptografar token
      const encryptedToken = encryptToken(finalToken)

      // 5. Gerar verify token para webhook
      const verifyToken = randomBytes(16).toString('hex')

      // 6. Salvar conexao
      // Coexistência = número ativo nos DOIS lados. Confia no que a Meta
      // responde; o flag do Embedded Signup entra só como fallback quando o
      // campo ainda não reflete o onboarding recém-concluído.
      const isCoexistence = phoneInfo.is_on_biz_app === true || body.coexistence === true
      if (isCoexistence) {
        app.log.info(`[CloudAPI] Número ${phoneInfo.display_phone_number || phoneNumberId} conectado em COEXISTÊNCIA (segue ativo no app do celular)`)
      }
      const existing = await prisma.cloudApiConnection.findUnique({ where: { wabaId } })
      const connection = await prisma.cloudApiConnection.upsert({
        where: { wabaId },
        update: {
          phoneNumberId,
          displayPhone: phoneInfo.display_phone_number || null,
          systemUserToken: encryptedToken,
          verifyToken,
          displayName: wabaInfo.name || phoneInfo.verified_name || null,
          qualityRating: phoneInfo.quality_rating || null,
          active: true,
          metadata: {
            tokenType,
            wabaStatus: wabaInfo.account_review_status,
            businessVerification: wabaInfo.business_verification_status,
            ownershipType: wabaInfo.ownership_type,
            platformType: phoneInfo.platform_type,
            coexistence: isCoexistence,
            isOnBizApp: phoneInfo.is_on_biz_app ?? null,
            connectedAt: existing ? undefined : new Date().toISOString(),
            reconnectedAt: new Date().toISOString(),
          },
        },
        create: {
          wabaId,
          phoneNumberId,
          displayPhone: phoneInfo.display_phone_number || null,
          systemUserToken: encryptedToken,
          verifyToken,
          displayName: wabaInfo.name || phoneInfo.verified_name || null,
          qualityRating: phoneInfo.quality_rating || null,
          active: true,
          metadata: {
            tokenType,
            wabaStatus: wabaInfo.account_review_status,
            businessVerification: wabaInfo.business_verification_status,
            ownershipType: wabaInfo.ownership_type,
            platformType: phoneInfo.platform_type,
            coexistence: isCoexistence,
            isOnBizApp: phoneInfo.is_on_biz_app ?? null,
            connectedAt: new Date().toISOString(),
          },
        },
      })

      // 7. Subscribir webhook
      let webhookSubscribed = false
      try {
        webhookSubscribed = await subscribeWebhook(wabaId, finalToken)
      } catch (subErr: any) {
        app.log.warn(`[CloudAPI] Webhook subscription failed: ${subErr.message}`)
      }

      // 8. Sincronizar templates existentes
      let templateCount = 0
      try {
        templateCount = await syncTemplatesFromMeta(wabaId, finalToken)
      } catch (tmplErr: any) {
        app.log.warn(`[CloudAPI] Template sync failed: ${tmplErr.message}`)
      }

      const webhookUrl = `${process.env.APP_URL || 'https://bychat.ia.br'}/api/cloud-api/webhook`

      return {
        ok: true,
        connection: {
          id: connection.id,
          wabaId: connection.wabaId,
          phoneNumberId: connection.phoneNumberId,
          displayPhone: connection.displayPhone,
          displayName: connection.displayName,
          coexistence: isCoexistence,
        },
        tokenType,
        webhookUrl,
        webhookSubscribed,
        verifyToken,
        templatesSynced: templateCount,
      }
    } catch (err: any) {
      app.log.error(`[CloudAPI] Embedded Signup error: ${err.message}`)
      return reply.code(500).send({ error: err.message })
    }
  })

  // ══════════════════════════════════════════════════════
  //  CONNECTION — Status e gerenciamento
  // ══════════════════════════════════════════════════════

  // GET /api/cloud-api/connection — Status da conexao Cloud API
  app.get('/api/cloud-api/connection', { preHandler: authMiddleware }, async () => {
    const connections = await prisma.cloudApiConnection.findMany({
      orderBy: { createdAt: 'desc' },
      // Setores donos (vários) — a UI mostra todos e o envio usa a lista.
      include: { teams: { select: { teamId: true, team: { select: { name: true } } }, orderBy: { id: 'asc' } } },
    })

    const results = await Promise.all(connections.map(async (conn) => {
      let tokenStatus = 'unknown'
      let tokenError = ''
      let businessProfile: any = null

      try {
        const token = decryptToken(conn.systemUserToken)
        // Testar token fazendo chamada simples
        await cloudApiFetch(`/${conn.phoneNumberId}?fields=id`, token)
        tokenStatus = 'valid'

        // Obter business profile
        try {
          businessProfile = await getBusinessProfile(conn.phoneNumberId, token)
        } catch {}
      } catch (err: any) {
        tokenStatus = 'expired'
        tokenError = err.message
      }

      const meta = (conn.metadata || {}) as any
      return {
        id: conn.id,
        wabaId: conn.wabaId,
        phoneNumberId: conn.phoneNumberId,
        displayPhone: conn.displayPhone,
        displayName: conn.displayName,
        qualityRating: conn.qualityRating,
        messagingLimit: conn.messagingLimit,
        chatbotId: conn.chatbotId,
        defaultTeamId: conn.defaultTeamId,
        teamIds: (conn as any).teams?.map((t: any) => t.teamId) ?? [],
        teamNames: (conn as any).teams?.map((t: any) => t.team?.name).filter(Boolean) ?? [],
        ownerUserId: conn.ownerUserId,
        funnelId: conn.funnelId,
        stageKey: conn.stageKey,
        active: conn.active,
        tokenStatus,
        tokenError,
        tokenType: meta.tokenType || 'unknown',
        // Coexistência: o número segue atendendo pelo app do celular. Muda o que
        // o operador pode esperar (limite de 20 msg/s, sem grupos) — por isso
        // aparece na tela, não só no metadata.
        coexistence: meta.coexistence === true,
        businessProfile,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      }
    }))

    return { connections: results }
  })

  // POST /api/cloud-api/connection/:id/refresh-mode — Reconsulta o modo na Meta
  //
  // O modo pode mudar SEM passar por aqui: o dono conecta/desconecta o número no
  // app do celular quando quiser, e a coexistência também se desativa sozinha se
  // o app ficar 14 dias sem ser aberto. Sem uma releitura sob demanda, a tela
  // continuaria afirmando algo que deixou de ser verdade.
  app.post('/api/cloud-api/connection/:id/refresh-mode', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as any
    const conn = await prisma.cloudApiConnection.findUnique({ where: { id: Number(id) } })
    if (!conn) return reply.code(404).send({ error: 'Conexão não encontrada' })
    try {
      const token = decryptToken(conn.systemUserToken)
      const info: any = await cloudApiFetch(`/${conn.phoneNumberId}?fields=is_on_biz_app,platform_type,throughput,display_phone_number`, token)
      const meta = (conn.metadata || {}) as any
      await prisma.cloudApiConnection.update({
        where: { id: conn.id },
        data: {
          metadata: {
            ...meta,
            coexistence: info.is_on_biz_app === true,
            isOnBizApp: info.is_on_biz_app ?? null,
            platformType: info.platform_type ?? meta.platformType ?? null,
            modeCheckedAt: new Date().toISOString(),
          },
        },
      })
      return {
        ok: true,
        coexistence: info.is_on_biz_app === true,
        platformType: info.platform_type ?? null,
        throughput: info.throughput ?? null,
      }
    } catch (err: any) {
      return reply.code(400).send({ error: `Não foi possível consultar a Meta: ${err.message}` })
    }
  })

  // POST /api/cloud-api/connection/:id/sync-app-data — Importa contatos e histórico
  //
  // Só faz sentido em número de coexistência. É assíncrono: a Meta responde só o
  // aceite e manda os dados depois pelos webhooks `history`/`smb_app_state_sync`
  // — pode levar até 24h e chega em blocos.
  app.post('/api/cloud-api/connection/:id/sync-app-data', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const conn = await prisma.cloudApiConnection.findUnique({ where: { id: Number(id) } })
    if (!conn) return reply.code(404).send({ error: 'Conexão não encontrada' })
    const meta = (conn.metadata || {}) as any
    if (meta.coexistence !== true) {
      return reply.code(400).send({ error: 'Só números em coexistência têm dados do app para importar.' })
    }
    try {
      const token = decryptToken(conn.systemUserToken)
      const contacts = await requestSync(conn.phoneNumberId, token, 'smb_app_state_sync')
      const history = await requestSync(conn.phoneNumberId, token, 'history')
      await prisma.cloudApiConnection.update({
        where: { id: conn.id },
        data: { metadata: { ...meta, syncRequestedAt: new Date().toISOString() } },
      })
      return { ok: true, contactsRequestId: contacts.requestId, historyRequestId: history.requestId }
    } catch (err: any) {
      return reply.code(400).send({ error: `Meta recusou a sincronização: ${err.message}` })
    }
  })

  // PUT /api/cloud-api/connection/:id — Atualizar conexao
  // (chatbotId, active, defaultTeamId, ownerUserId — paridade com a instância Evolution)
  app.put('/api/cloud-api/connection/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const { chatbotId, active, defaultTeamId, ownerUserId, funnelId, stageKey } = req.body as any
    // `teamIds` = setores donos (vários). `defaultTeamId` segue aceito para
    // quem manda um setor só.
    const teamIds: number[] | undefined = Array.isArray((req.body as any)?.teamIds)
      ? (req.body as any).teamIds.map(Number).filter(Boolean)
      : (defaultTeamId !== undefined ? (defaultTeamId ? [Number(defaultTeamId)] : []) : undefined)
    const data: any = {}
    if (chatbotId !== undefined) data.chatbotId = chatbotId || null
    if (active !== undefined) data.active = active

    // Funil dos leads do chatbot (validar funil + etapa). Vazio = não promove.
    if (funnelId !== undefined || stageKey !== undefined) {
      const fid = funnelId ? Number(funnelId) : null
      let skey: string | null = stageKey ? String(stageKey) : null
      if (fid) {
        const f = await prisma.funnel.findUnique({ where: { id: fid }, select: { id: true } })
        if (!f) return reply.code(400).send({ error: 'Funil não encontrado' })
        if (skey) {
          const s = await prisma.stage.findFirst({ where: { funnelId: fid, key: skey, active: true }, select: { key: true } })
          if (!s) skey = null // etapa inválida → 1ª etapa (resolvida no fluxo)
        }
      } else { skey = null }
      data.funnelId = fid
      data.stageKey = skey
    }

    // Setor padrão e agente dedicado são mutuamente exclusivos (mesma regra da
    // Reforma F2 nas instâncias Evolution). Trocar para um zera o outro.
    if (defaultTeamId !== undefined || ownerUserId !== undefined) {
      const team = defaultTeamId ? Number(defaultTeamId) : null
      const owner = ownerUserId ? Number(ownerUserId) : null
      if (teamIds?.length && owner) {
        return reply.code(400).send({ error: 'A conexão pode ter apenas um tipo de dono: setores OU agente, não ambos.' })
      }
      if (owner) {
        const u = await prisma.user.findUnique({ where: { id: owner }, select: { active: true, role: true } })
        if (!u) return reply.code(400).send({ error: 'Agente destino não encontrado' })
        if (!u.active) return reply.code(400).send({ error: 'Agente destino inativo' })
        if (u.role === 'VIEWER') return reply.code(400).send({ error: 'VIEWER não pode ser dono da conexão' })
      }
      data.ownerUserId = owner
    }

    const conn = await prisma.cloudApiConnection.update({
      where: { id: parseInt(id) },
      data,
    })
    // Última palavra: sincroniza `defaultTeamId` (um setor → preenchido, vários
    // → nulo) e limpa o agente quando há setores.
    if (teamIds !== undefined) await setChannelTeams('cloud', conn.id, teamIds)
    else if (data.ownerUserId) await setChannelTeams('cloud', conn.id, [])
    void logUserAudit({
      action: 'cloudapi.updated',
      targetType: 'cloud_api',
      targetLabel: conn.displayName || conn.phoneNumberId,
      changes: { fields: Object.keys(data) },
      ...auditActor(req),
    })
    return { ok: true, connection: conn }
  })

  // DELETE /api/cloud-api/connection/:id — Desconectar Cloud API
  app.delete('/api/cloud-api/connection/:id', { preHandler: adminOnly }, async (req, reply) => {
    const { id } = req.params as any
    const existing = await prisma.cloudApiConnection.findUnique({
      where: { id: parseInt(id) },
      select: { displayName: true, phoneNumberId: true, wabaId: true },
    })
    await prisma.cloudApiConnection.delete({ where: { id: parseInt(id) } })
    void logUserAudit({
      action: 'cloudapi.disconnected',
      targetType: 'cloud_api',
      targetLabel: existing?.displayName || existing?.phoneNumberId || `Conexão #${id}`,
      changes: { wabaId: existing?.wabaId, phoneNumberId: existing?.phoneNumberId },
      ...auditActor(req),
    })
    return { ok: true }
  })

  // POST /api/cloud-api/connection/:id/test — Testar envio de mensagem
  app.post('/api/cloud-api/connection/:id/test', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const { phone, message } = req.body as any

      if (!phone) return reply.code(400).send({ error: 'phone obrigatorio' })

      const conn = await prisma.cloudApiConnection.findUnique({ where: { id: parseInt(id) } })
      if (!conn) return reply.code(404).send({ error: 'Conexao nao encontrada' })

      const token = decryptToken(conn.systemUserToken)
      const { sendTextMessage } = await import('../services/cloudApi.js')
      const { getBranding } = await import('../lib/branding.js')
      const brand = await getBranding()
      const result = await sendTextMessage(conn.phoneNumberId, token, phone, message || `Teste de conexao Cloud API - ${brand.brandName}`)

      return { ok: true, messageId: result.messageId }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ══════════════════════════════════════════════════════
  //  TEMPLATES HSM — Sincronizar, listar, criar, deletar
  // ══════════════════════════════════════════════════════

  // GET /api/cloud-api/templates — Listar templates do banco
  app.get('/api/cloud-api/templates', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.wabaId) where.wabaId = q.wabaId
    if (q.status) where.status = q.status
    if (q.category) where.category = q.category

    const templates = await prisma.cloudApiTemplate.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    return { templates }
  })

  // GET /api/cloud-api/dispatch-report — Painel de acompanhamento de disparos
  // (status, categorias, custo estimado) + qualidade/limite por número.
  app.get('/api/cloud-api/dispatch-report', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const to = q.to ? new Date(q.to) : new Date()
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
    const connectionId = q.connectionId ? parseInt(q.connectionId) : null

    const { buildDispatchReport, getPricingTable } = await import('../services/cloudApiBilling.js')
    const [report, pricing, connections] = await Promise.all([
      buildDispatchReport({ connectionId, from, to }),
      getPricingTable(),
      prisma.cloudApiConnection.findMany({
        where: { active: true },
        select: { id: true, displayPhone: true, displayName: true, qualityRating: true, messagingLimit: true },
      }),
    ])
    return { report, pricing, connections }
  })

  // POST /api/cloud-api/templates/sync — Re-sincronizar templates do Meta
  app.post('/api/cloud-api/templates/sync', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao Cloud API ativa' })

      const token = decryptToken(conn.systemUserToken)
      const count = await syncTemplatesFromMeta(conn.wabaId, token)

      return { ok: true, synced: count }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/cloud-api/templates — Criar template no Meta + local
  // Suporte completo v22.0: HEADER (text/image/video/document), BODY (variaveis),
  // FOOTER, BUTTONS (quick_reply, url, phone_number, copy_code, flow),
  // LIMITED_TIME_OFFER, CAROUSEL
  app.post('/api/cloud-api/templates', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const body = req.body as any

      if (!body.name || !body.language || !body.category) {
        return reply.code(400).send({ error: 'name, language e category obrigatorios' })
      }

      // Validar nome (Meta: lowercase, underscore, max 512)
      const name = body.name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 512)

      // Montar componentes no formato Meta
      const components: any[] = []

      // HEADER (opcional)
      if (body.header) {
        const h = body.header
        if (h.format === 'TEXT' && h.text) {
          components.push({ type: 'HEADER', format: 'TEXT', text: h.text, example: h.example ? { header_text: [h.example] } : undefined })
        } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(h.format) && h.handle) {
          components.push({ type: 'HEADER', format: h.format, example: { header_handle: [h.handle] } })
        } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(h.format)) {
          components.push({ type: 'HEADER', format: h.format })
        }
      }

      // BODY (obrigatório)
      if (body.bodyText) {
        const bodyComp: any = { type: 'BODY', text: body.bodyText }
        // Extrair variáveis {{1}}, {{2}}, etc
        const varMatches = body.bodyText.match(/\{\{\d+\}\}/g)
        if (varMatches && body.bodyExamples && body.bodyExamples.length > 0) {
          bodyComp.example = { body_text: [body.bodyExamples] }
        }
        components.push(bodyComp)
      } else if (body.components) {
        // Aceitar formato raw também (retrocompatibilidade)
      }

      // FOOTER (opcional)
      if (body.footer) {
        components.push({ type: 'FOOTER', text: body.footer })
      }

      // BUTTONS (opcional)
      if (body.buttons && body.buttons.length > 0) {
        const buttons: any[] = []
        for (const btn of body.buttons) {
          if (btn.type === 'QUICK_REPLY') {
            buttons.push({ type: 'QUICK_REPLY', text: btn.text })
          } else if (btn.type === 'URL') {
            const urlBtn: any = { type: 'URL', text: btn.text, url: btn.url }
            if (btn.url?.includes('{{1}}')) {
              urlBtn.example = [btn.urlExample || 'https://example.com']
            }
            buttons.push(urlBtn)
          } else if (btn.type === 'PHONE_NUMBER') {
            buttons.push({ type: 'PHONE_NUMBER', text: btn.text, phone_number: btn.phoneNumber })
          } else if (btn.type === 'COPY_CODE') {
            buttons.push({ type: 'COPY_CODE', example: btn.codeExample || 'PROMO2026' })
          } else if (btn.type === 'FLOW') {
            buttons.push({ type: 'FLOW', text: btn.text, flow_id: btn.flowId, navigate_screen: btn.screen })
          }
        }
        if (buttons.length > 0) {
          components.push({ type: 'BUTTONS', buttons })
        }
      }

      // LIMITED_TIME_OFFER (opcional, para MARKETING)
      if (body.limitedTimeOffer) {
        components.push({
          type: 'LIMITED_TIME_OFFER',
          limited_time_offer: {
            text: body.limitedTimeOffer.text || '',
            has_expiration: body.limitedTimeOffer.hasExpiration !== false,
          }
        })
      }

      // Usar components raw se enviados diretamente (fallback para formato avançado)
      const finalComponents = components.length > 0 ? components : body.components
      if (!finalComponents || finalComponents.length === 0) {
        return reply.code(400).send({ error: 'Template precisa de pelo menos um componente (body)' })
      }

      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao Cloud API ativa' })

      const token = decryptToken(conn.systemUserToken)

      // Payload final para Meta
      const templatePayload: any = {
        name,
        language: body.language,
        category: body.category, // MARKETING, UTILITY, AUTHENTICATION
        components: finalComponents,
      }

      // allow_category_change (Meta pode reclassificar)
      if (body.allowCategoryChange !== false) {
        templatePayload.allow_category_change = true
      }

      // Criar no Meta
      const result = await apiCreateTemplate(conn.wabaId, token, templatePayload)

      // Salvar localmente
      const template = await prisma.cloudApiTemplate.create({
        data: {
          wabaId: conn.wabaId,
          metaTemplateId: result.id || '',
          name,
          language: body.language,
          category: body.category,
          status: result.status || 'PENDING',
          components: finalComponents,
        }
      })

      return { ok: true, template, metaResponse: result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // PUT /api/cloud-api/templates/:id — Editar template existente no Meta
  app.put('/api/cloud-api/templates/:id', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const body = req.body as any

      const template = await prisma.cloudApiTemplate.findUnique({ where: { id: parseInt(id) } })
      if (!template) return reply.code(404).send({ error: 'Template nao encontrado' })

      const conn = await prisma.cloudApiConnection.findFirst({
        where: { active: true, wabaId: template.wabaId }
      })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao ativa' })

      const token = decryptToken(conn.systemUserToken)

      // Meta permite editar templates APPROVED e REJECTED (cria nova versao)
      const updatePayload: any = { components: body.components }
      if (body.category) updatePayload.category = body.category

      const { cloudApiFetch } = await import('../services/cloudApi.js')
      const result = await cloudApiFetch(
        `/${template.metaTemplateId}`,
        token,
        'POST',
        updatePayload
      )

      // Atualizar local
      await prisma.cloudApiTemplate.update({
        where: { id: parseInt(id) },
        data: {
          components: body.components,
          status: result.status || 'PENDING',
          category: body.category || template.category,
          lastSyncAt: new Date(),
        }
      })

      return { ok: true, result }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // DELETE /api/cloud-api/templates/:id — Deletar template
  app.delete('/api/cloud-api/templates/:id', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const { id } = req.params as any
      const template = await prisma.cloudApiTemplate.findUnique({ where: { id: parseInt(id) } })
      if (!template) return reply.code(404).send({ error: 'Template nao encontrado' })

      const conn = await prisma.cloudApiConnection.findFirst({
        where: { active: true, wabaId: template.wabaId }
      })

      if (conn) {
        try {
          const token = decryptToken(conn.systemUserToken)
          await apiDeleteTemplate(conn.wabaId, token, template.name)
        } catch (metaErr: any) {
          app.log.warn(`[CloudAPI] Delete template from Meta failed: ${metaErr.message}`)
        }
      }

      await prisma.cloudApiTemplate.delete({ where: { id: parseInt(id) } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/cloud-api/templates/upload-media — Upload de mídia para header de template
  app.post('/api/cloud-api/templates/upload-media', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao Cloud API ativa' })

      const token = decryptToken(conn.systemUserToken)
      const data = await req.file()
      if (!data) return reply.code(400).send({ error: 'Arquivo obrigatório' })

      const buffer = await data.toBuffer()
      const mimeType = data.mimetype

      // Step 1: Criar sessão de upload
      const sessionResp = await fetch(`https://graph.facebook.com/v22.0/${conn.wabaId}/uploads`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file_length: buffer.length,
          file_type: mimeType,
          messaging_product: 'whatsapp',
        })
      })
      const session = await sessionResp.json() as any
      if (!session.id) {
        return reply.code(500).send({ error: 'Falha ao criar sessão de upload', details: session })
      }

      // Step 2: Upload do arquivo
      const uploadResp = await fetch(`https://graph.facebook.com/v22.0/${session.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `OAuth ${token}`,
          'Content-Type': mimeType,
          'file_offset': '0',
        },
        body: buffer as any,
      })
      const uploadResult = await uploadResp.json() as any

      if (uploadResult.h) {
        return { ok: true, handle: uploadResult.h }
      }

      return reply.code(500).send({ error: 'Upload falhou', details: uploadResult })
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/cloud-api/send-template — Enviar template HSM para um numero
  app.post('/api/cloud-api/send-template', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { phone, templateId, components } = req.body as any

      if (!phone || !templateId) {
        return reply.code(400).send({ error: 'phone e templateId obrigatorios' })
      }

      const template = await prisma.cloudApiTemplate.findUnique({ where: { id: parseInt(templateId) } })
      if (!template) return reply.code(404).send({ error: 'Template nao encontrado' })
      if (!isSendableStatus(template.status)) {
        return reply.code(400).send({ error: `Template com status ${template.status} (precisa ser APPROVED)` })
      }

      const conn = await prisma.cloudApiConnection.findFirst({
        where: { active: true, wabaId: template.wabaId }
      })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao ativa para este WABA' })

      const token = decryptToken(conn.systemUserToken)
      const { sendTemplateMessage } = await import('../services/cloudApi.js')

      const result = await sendTemplateMessage(
        conn.phoneNumberId,
        token,
        phone,
        template.name,
        template.language,
        components
      )

      return { ok: true, messageId: result.messageId }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /api/cloud-api/send-interactive — Enviar mensagem interativa
  app.post('/api/cloud-api/send-interactive', { preHandler: authMiddleware }, async (req, reply) => {
    try {
      const { phone, interactive } = req.body as any

      if (!phone || !interactive) {
        return reply.code(400).send({ error: 'phone e interactive obrigatorios' })
      }

      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexao Cloud API ativa' })

      const token = decryptToken(conn.systemUserToken)
      const { sendInteractiveMessage } = await import('../services/cloudApi.js')

      const result = await sendInteractiveMessage(conn.phoneNumberId, token, phone, interactive)

      return { ok: true, messageId: result.messageId }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ── WhatsApp Flows (F3) ───────────────────────────────────────────────────
  // GET — lista os Flows criados (com nome do form de origem e status).
  app.get('/api/cloud-api/flows', { preHandler: adminOnly }, async () => {
    const flows = await prisma.cloudApiFlow.findMany({ orderBy: { id: 'desc' } })
    const formIds = Array.from(new Set(flows.map((f) => f.formId).filter(Boolean))) as number[]
    const forms = formIds.length ? await prisma.form.findMany({ where: { id: { in: formIds } }, select: { id: true, name: true } }) : []
    const formMap = new Map(forms.map((f) => [f.id, f.name]))
    return {
      flows: flows.map((f) => ({
        id: f.id, formId: f.formId, formName: f.formId ? (formMap.get(f.formId) || null) : null,
        name: f.name, status: f.status, metaFlowId: f.metaFlowId, lastError: f.lastError, createdAt: f.createdAt,
      })),
    }
  })

  // POST — gera o Flow JSON a partir de um form e publica na Meta (ação do admin).
  app.post('/api/cloud-api/flows', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const { formId, name } = req.body as any
      if (!formId) return reply.code(400).send({ error: 'formId obrigatório' })
      const form = await prisma.form.findUnique({ where: { id: Number(formId) } })
      if (!form) return reply.code(404).send({ error: 'Formulário não encontrado' })
      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexão Cloud API ativa' })

      const { buildFlowJson, createAndPublishFlow } = await import('../services/whatsappFlows.js')
      const { json, screenId } = buildFlowJson(form)
      // children[0] é o Form; seus filhos = inputs + Footer. Precisa de ≥1 input.
      const inputCount = (json.screens?.[0]?.layout?.children?.[0]?.children?.length || 0) - 1
      if (inputCount < 1) return reply.code(400).send({ error: 'O formulário não tem campos de entrada para o Flow.' })

      const flowName = String(name || `Flow — ${form.name}`).slice(0, 200)
      const row = await prisma.cloudApiFlow.create({
        data: { connectionId: conn.id, formId: form.id, name: flowName, status: 'draft', flowJson: json as any, screenId },
      })
      try {
        const { metaFlowId } = await createAndPublishFlow(conn, flowName, json)
        const updated = await prisma.cloudApiFlow.update({ where: { id: row.id }, data: { metaFlowId, status: 'published', lastError: null } })
        return { ok: true, flow: updated }
      } catch (e: any) {
        await prisma.cloudApiFlow.update({ where: { id: row.id }, data: { status: 'error', lastError: String(e?.message || e).slice(0, 2000) } })
        return reply.code(502).send({ error: `Falha ao publicar o Flow na Meta: ${e?.message || e}` })
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // DELETE — remove o registro local (não despublica da Meta).
  app.delete('/api/cloud-api/flows/:id', { preHandler: adminOnly }, async (req) => {
    const id = Number((req.params as any).id)
    await prisma.cloudApiFlow.delete({ where: { id } }).catch(() => {})
    return { ok: true }
  })

  // ── Editor visual do Flow (config por form, desacoplada do formulário) ────
  const stripTags = (s: any) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  // GET — config do Flow do form (existente OU derivada do form).
  app.get('/api/cloud-api/flows/by-form/:formId', { preHandler: adminOnly }, async (req, reply) => {
    const formId = Number((req.params as any).formId)
    const form = await prisma.form.findUnique({ where: { id: formId } })
    if (!form) return reply.code(404).send({ error: 'Formulário não encontrado' })
    const row = await prisma.cloudApiFlow.findFirst({ where: { formId }, orderBy: { id: 'desc' } })
    const { flowInputFields } = await import('../services/whatsappFlows.js')
    const cfg = (row?.fieldConfig as any[]) || []
    const cfgByKey = new Map(cfg.map((c: any) => [String(c.key), c]))
    const fields = flowInputFields(form).map((f: any) => {
      const o: any = cfgByKey.get(String(f.key)) || {}
      const formLabel = stripTags(f.label) || f.key
      return {
        key: f.key, type: f.type, formLabel,
        label: o.label ?? formLabel, include: o.include ?? true, required: o.required ?? !!f.required,
        hasOptions: f.type === 'select' && Array.isArray(f.options) && f.options.length > 0,
      }
    })
    const welcome = stripTags((form.settings as any)?.conversational?.welcomeText)
    return {
      formId, formName: form.name,
      metaFlowId: row?.metaFlowId || null, status: row?.status || null, lastError: row?.lastError || null,
      cta: row?.cta || 'Preencher',
      bodyText: row?.bodyText ?? (welcome || 'Para começar, toque no botão e preencha rapidamente:'),
      screenTitle: row?.screenTitle ?? form.name,
      fields,
    }
  })

  // PUT — salva a config (não publica; mensagem/CTA valem na hora no envio).
  app.put('/api/cloud-api/flows/by-form/:formId', { preHandler: adminOnly }, async (req, reply) => {
    const formId = Number((req.params as any).formId)
    const form = await prisma.form.findUnique({ where: { id: formId }, select: { id: true, name: true } })
    if (!form) return reply.code(404).send({ error: 'Formulário não encontrado' })
    const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
    if (!conn) return reply.code(400).send({ error: 'Nenhuma conexão Cloud API ativa' })
    const b = (req.body as any) || {}
    const cta = b.cta != null ? String(b.cta).slice(0, 40) : null
    const bodyText = b.bodyText != null ? String(b.bodyText).slice(0, 1024) : null
    const screenTitle = b.screenTitle != null ? String(b.screenTitle).slice(0, 60) : null
    const fieldConfig = Array.isArray(b.fieldConfig)
      ? b.fieldConfig.map((c: any) => ({ key: String(c.key), label: c.label != null ? String(c.label).slice(0, 80) : undefined, include: c.include !== false, required: !!c.required }))
      : null
    const existing = await prisma.cloudApiFlow.findFirst({ where: { formId }, orderBy: { id: 'desc' } })
    const row = existing
      ? await prisma.cloudApiFlow.update({ where: { id: existing.id }, data: { cta, bodyText, screenTitle, fieldConfig: fieldConfig as any } })
      : await prisma.cloudApiFlow.create({ data: { connectionId: conn.id, formId, name: `Flow — ${form.name}`, status: 'draft', flowJson: {} as any, cta, bodyText, screenTitle, fieldConfig: fieldConfig as any } })
    return { ok: true, id: row.id }
  })

  // POST — publica/republica o Flow na Meta a partir da config salva.
  app.post('/api/cloud-api/flows/by-form/:formId/publish', { preHandler: adminOnly }, async (req, reply) => {
    try {
      const formId = Number((req.params as any).formId)
      const form = await prisma.form.findUnique({ where: { id: formId } })
      if (!form) return reply.code(404).send({ error: 'Formulário não encontrado' })
      const conn = await prisma.cloudApiConnection.findFirst({ where: { active: true } })
      if (!conn) return reply.code(400).send({ error: 'Nenhuma conexão Cloud API ativa' })
      const row = await prisma.cloudApiFlow.findFirst({ where: { formId }, orderBy: { id: 'desc' } })

      const { buildFlowJson, createAndPublishFlow } = await import('../services/whatsappFlows.js')
      const { json, screenId } = buildFlowJson(form, {
        title: row?.screenTitle || undefined, cta: row?.cta || undefined, fieldConfig: (row?.fieldConfig as any[]) || undefined,
      })
      const inputTypes = new Set(['TextInput', 'TextArea', 'Dropdown'])
      const inputCount = ((json.screens?.[0]?.layout?.children?.[0]?.children) || []).filter((c: any) => inputTypes.has(c.type)).length
      if (inputCount < 1) return reply.code(400).send({ error: 'O formulário não tem nenhum campo ativo para o Flow.' })

      const flowName = `Flow — ${form.name}`.slice(0, 200)
      const ensured = row
        ? await prisma.cloudApiFlow.update({ where: { id: row.id }, data: { flowJson: json as any, screenId, name: flowName } })
        : await prisma.cloudApiFlow.create({ data: { connectionId: conn.id, formId, name: flowName, status: 'draft', flowJson: json as any, screenId } })
      try {
        const { metaFlowId } = await createAndPublishFlow(conn, flowName, json, ensured.metaFlowId || null)
        await prisma.cloudApiFlow.update({ where: { id: ensured.id }, data: { metaFlowId, status: 'published', lastError: null } })
        return { ok: true, metaFlowId }
      } catch (e: any) {
        await prisma.cloudApiFlow.update({ where: { id: ensured.id }, data: { status: 'error', lastError: String(e?.message || e).slice(0, 2000) } })
        return reply.code(502).send({ error: `Falha ao publicar o Flow na Meta: ${e?.message || e}` })
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })
}

// O helper syncTemplatesFromMeta foi movido para services/cloudApiTemplates.ts
// (agora também detecta mudança de status, grava motivo/qualidade e notifica).
