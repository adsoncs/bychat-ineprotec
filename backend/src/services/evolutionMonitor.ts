// src/services/evolutionMonitor.ts
// Microserviço que monitora a saúde da Evolution API, instâncias e webhooks
// Roda a cada 2 minutos e armazena estado em memória para consulta rápida

import { prisma } from '../lib/prisma.js'

// ─── Types ──────────────────────────────────────────────

export interface EvolutionHealth {
  lastCheck: string
  api: {
    status: 'online' | 'offline' | 'error'
    url: string
    responseTimeMs: number
    version: string | null
    error: string | null
  }
  instances: {
    name: string
    instanceName: string
    dbActive: boolean
    connectionState: string
    phone: string | null
    profileName: string | null
    chatbotLinked: boolean
    chatbotName: string | null
    error: string | null
  }[]
  webhook: {
    status: 'ok' | 'misconfigured' | 'missing' | 'error'
    expected: string
    current: string | null
    events: string[]
    error: string | null
  }
  issues: {
    severity: 'critical' | 'warning' | 'info'
    message: string
    action: string | null  // action ID for auto-fix
  }[]
}

// ─── State ──────────────────────────────────────────────

let currentHealth: EvolutionHealth | null = null
let intervalHandle: ReturnType<typeof setInterval> | null = null

// ─── Helpers ────────────────────────────────────────────

function getEvoConfig() {
  return {
    url: process.env.EVOLUTION_API_URL || '',
    key: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || 'beyond-main',
    // Sem fallback de propósito: o valor que estava aqui era o domínio anterior
    // à migração, e um webhook apontado para ele manda as mensagens do cliente
    // para um endereço que pode não ser mais nosso.
    appUrl: process.env.APP_URL || null,
  }
}

async function evoFetch(baseUrl: string, apiKey: string, path: string, method = 'GET', body?: any): Promise<any> {
  const opts: any = {
    method,
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    signal: AbortSignal.timeout(10000), // 10s timeout
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${baseUrl}${path}`, opts)
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

// ─── Webhook da instância ───────────────────────────────

/**
 * Eventos que o webhook PRECISA entregar — são exatamente os que
 * `routes/whatsapp.ts` trata. `PRESENCE_UPDATE` está aqui porque é o
 * "digitando…" que aparece na conversa.
 */
export const EVENTOS_WEBHOOK_NECESSARIOS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'PRESENCE_UPDATE',
] as const

/** URL/chave da Evolution — o Configurações (banco) vence o `.env`. */
async function resolverConfigEvolution(): Promise<{ url: string; key: string; appUrl: string | null }> {
  const cfg = getEvoConfig()
  const dbSettings = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } },
  })
  const dbCfg: Record<string, string> = {}
  dbSettings.forEach((r) => { dbCfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value).replace(/"/g, '') })
  return {
    url: dbCfg['whatsapp.evolution_url'] || cfg.url,
    key: dbCfg['whatsapp.evolution_key'] || cfg.key,
    appUrl: cfg.appUrl,
  }
}

/**
 * Aponta o webhook da instância para o endereço atual do painel SEM perder o que
 * já estava configurado.
 *
 * Antes havia duas listas FIXAS e divergentes no código: a rota
 * `/api/whatsapp/set-webhook` gravava 3 eventos (sem `PRESENCE_UPDATE` — usar o
 * botão tirava o "digitando…" de todo mundo) e o auto-fix daqui gravava 4.
 * Qualquer uma das duas apagava os extras da instância: `terram_n1` tinha
 * `SEND_MESSAGE`, `CONTACTS_UPDATE` e `CHATS_UPDATE`. A lista passa a ser a
 * UNIÃO do que já está lá com o que o código precisa, e o `headers` (onde vive o
 * token de `EVOLUTION_WEBHOOK_KEY`) é preservado — reescrevê-lo em branco faria
 * o webhook inteiro voltar 401.
 *
 * Não grava quando nada muda: a troca tem uma janela, curta mas real, em que a
 * Evolution ainda entrega no endereço anterior.
 */
export async function garantirWebhookDaInstancia(
  instanceName: string,
): Promise<{ ok: boolean; mudou: boolean; url: string | null; eventos: string[]; message: string }> {
  const { url, key, appUrl } = await resolverConfigEvolution()
  if (!url || !key) return { ok: false, mudou: false, url: null, eventos: [], message: 'Evolution API não configurada (URL ou chave ausente).' }
  // Sem APP_URL não dá para saber o endereço do painel, e chutar um domínio
  // (era o que o fallback antigo fazia, apontando para o domínio anterior à
  // migração) manda o WhatsApp para um endereço que pode não ser mais nosso.
  if (!appUrl) {
    return { ok: false, mudou: false, url: null, eventos: [], message: 'APP_URL não configurada no .env — sem ela não há como saber o endereço do painel.' }
  }

  const esperada = `${appUrl.replace(/\/$/, '')}/api/whatsapp/webhook`
  const atual = await evoFetch(url, key, `/webhook/find/${instanceName}`).catch(() => null)
  const urlAtual: string | null = atual?.url || atual?.webhook?.url || null
  const eventosAtuais: string[] = Array.isArray(atual?.events || atual?.webhook?.events)
    ? (atual.events || atual.webhook.events)
    : []
  const headersAtuais = atual?.headers ?? atual?.webhook?.headers ?? null

  const eventos = Array.from(new Set([...eventosAtuais, ...EVENTOS_WEBHOOK_NECESSARIOS]))
  const faltavaEvento = eventos.length !== eventosAtuais.length
  if (urlAtual === esperada && !faltavaEvento) {
    return { ok: true, mudou: false, url: esperada, eventos, message: 'Webhook já estava correto.' }
  }

  const gravou = await evoFetch(url, key, `/webhook/set/${instanceName}`, 'POST', {
    webhook: {
      url: esperada,
      enabled: true,
      webhookByEvents: false,
      webhookBase64: false,
      events: eventos,
      ...(headersAtuais ? { headers: headersAtuais } : {}),
    },
  })
  // `evoFetch` daqui devolve o corpo mesmo em erro — sem esta checagem, uma
  // instância que existe só no nosso banco (registro órfão, nunca criada na
  // Evolution) responderia 404 e nós reportaríamos sucesso.
  if (gravou?.status && Number(gravou.status) >= 400) {
    const detalhe = gravou?.response?.message?.[0] || gravou?.error || `HTTP ${gravou.status}`
    return { ok: false, mudou: false, url: null, eventos, message: `Evolution recusou: ${detalhe}` }
  }
  return {
    ok: true,
    mudou: true,
    url: esperada,
    eventos,
    message: `Webhook da instância ${instanceName} agora aponta para ${esperada}${faltavaEvento ? ` (eventos completados: ${eventos.join(', ')})` : ''}`,
  }
}

// ─── Core Check ─────────────────────────────────────────

async function runHealthCheck(): Promise<EvolutionHealth> {
  const cfg = getEvoConfig()

  // Also read from DB settings (they may override env)
  const dbSettings = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } }
  })
  const dbCfg: Record<string, string> = {}
  dbSettings.forEach(r => { dbCfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value).replace(/"/g, '') })

  const url = dbCfg['whatsapp.evolution_url'] || cfg.url
  const key = dbCfg['whatsapp.evolution_key'] || cfg.key
  // Sem APP_URL não existe endereço esperado: comparar contra "null/api/..."
  // marcaria TODA instância como mal configurada e ofereceria um "corrigir" que
  // apontaria o webhook para lugar nenhum.
  const expectedWebhookUrl = cfg.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}/api/whatsapp/webhook` : null

  const health: EvolutionHealth = {
    lastCheck: new Date().toISOString(),
    api: { status: 'offline', url, responseTimeMs: 0, version: null, error: null },
    instances: [],
    webhook: { status: 'missing', expected: expectedWebhookUrl ?? '', current: null, events: [], error: null },
    issues: [],
  }

  if (!url || !key) {
    health.api.error = 'Evolution API URL ou chave não configurada'
    health.issues.push({ severity: 'critical', message: 'Evolution API não configurada (URL ou API Key ausente)', action: null })
    return health
  }

  // 1. Check API availability
  const startTime = Date.now()
  try {
    const instances = await evoFetch(url, key, '/instance/fetchInstances')
    health.api.responseTimeMs = Date.now() - startTime
    health.api.status = 'online'

    // Try to get version
    try {
      const versionData = await evoFetch(url, key, '/instance/fetchInstances')
      // Evolution v2 doesn't have a dedicated version endpoint, check from response structure
      if (Array.isArray(versionData) && versionData.length > 0) {
        const sample = versionData[0]
        if (sample.integration) health.api.version = `v2 (${sample.integration})`
        else health.api.version = 'v2'
      }
    } catch {}

    // 2. Check instances
    const dbInstances = await prisma.whatsAppInstance.findMany()
    // Buscar nomes dos chatbots vinculados
    const chatbotIds = dbInstances.map(i => i.chatbotId).filter(Boolean) as number[]
    const chatbots = chatbotIds.length > 0
      ? await prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } })
      : []
    const chatbotMap = Object.fromEntries(chatbots.map(c => [c.id, c.name]))

    if (Array.isArray(instances)) {
      for (const dbInst of dbInstances) {
        const evoInst = instances.find((i: any) => i.name === dbInst.instanceName)

        const instStatus: EvolutionHealth['instances'][0] = {
          name: dbInst.name,
          instanceName: dbInst.instanceName,
          dbActive: dbInst.active,
          connectionState: 'unknown',
          phone: null,
          profileName: null,
          chatbotLinked: !!dbInst.chatbotId,
          chatbotName: dbInst.chatbotId ? chatbotMap[dbInst.chatbotId] || null : null,
          error: null,
        }

        if (evoInst) {
          instStatus.connectionState = evoInst.connectionStatus || 'unknown'
          instStatus.phone = evoInst.ownerJid?.split('@')[0] || evoInst.number || null
          instStatus.profileName = evoInst.profileName || null

          // Check connection issues
          if (evoInst.connectionStatus !== 'open' && dbInst.active) {
            health.issues.push({
              severity: 'critical',
              message: `Instância "${dbInst.name}" está ${evoInst.connectionStatus || 'desconectada'} mas marcada como ativa`,
              action: `reconnect:${dbInst.id}`,
            })
          }

          // Check webhook for this instance
          try {
            const webhookData = await evoFetch(url, key, `/webhook/find/${dbInst.instanceName}`)
            const webhookUrl = webhookData?.url || webhookData?.webhook?.url || null
            const events = webhookData?.events || webhookData?.webhook?.events || []

            if (!health.webhook.current) {
              health.webhook.current = webhookUrl
              health.webhook.events = Array.isArray(events) ? events : []
            }

            if (!expectedWebhookUrl) {
              // Sem APP_URL não há o que conferir — o alerta é sobre a config
              // que falta, não sobre a instância.
              health.webhook.status = 'error'
              health.webhook.error = 'APP_URL não configurada no .env'
            } else if (webhookUrl === expectedWebhookUrl) {
              health.webhook.status = 'ok'
            } else if (webhookUrl) {
              health.webhook.status = 'misconfigured'
              health.issues.push({
                severity: 'warning',
                message: `Webhook da instância "${dbInst.name}" aponta para ${webhookUrl} ao invés de ${expectedWebhookUrl}`,
                action: `fix-webhook:${dbInst.instanceName}`,
              })
            } else {
              health.webhook.status = 'missing'
              health.issues.push({
                severity: 'critical',
                message: `Webhook não configurado na instância "${dbInst.name}"`,
                action: `fix-webhook:${dbInst.instanceName}`,
              })
            }
          } catch (err: any) {
            health.webhook.error = err.message
          }
        } else {
          instStatus.connectionState = 'not_found'
          instStatus.error = 'Instância não encontrada na Evolution API'
          health.issues.push({
            severity: 'warning',
            message: `Instância "${dbInst.name}" (${dbInst.instanceName}) existe no banco mas não na Evolution API`,
            action: `recreate:${dbInst.id}`,
          })
        }

        // Check chatbot link
        if (!dbInst.chatbotId && dbInst.active) {
          health.issues.push({
            severity: 'info',
            message: `Instância "${dbInst.name}" sem chatbot vinculado — mensagens não terão automação`,
            action: null,
          })
        }

        health.instances.push(instStatus)
      }

      // Check for orphan instances in Evolution API (not in DB)
      for (const evoInst of instances) {
        const inDb = dbInstances.find(d => d.instanceName === evoInst.name)
        if (!inDb) {
          health.issues.push({
            severity: 'info',
            message: `Instância "${evoInst.name}" existe na Evolution API mas não está cadastrada no sistema`,
            action: null,
          })
        }
      }
    }

    // 3. Latency warning
    if (health.api.responseTimeMs > 5000) {
      health.issues.push({
        severity: 'warning',
        message: `Evolution API respondendo lentamente (${health.api.responseTimeMs}ms)`,
        action: null,
      })
    }

  } catch (err: any) {
    health.api.responseTimeMs = Date.now() - startTime
    health.api.status = err.name === 'TimeoutError' ? 'offline' : 'error'
    health.api.error = err.message
    health.issues.push({
      severity: 'critical',
      message: `Evolution API inacessível: ${err.message}`,
      action: null,
    })
  }

  return health
}

// ─── Auto-fix Actions ───────────────────────────────────

export async function executeFixAction(action: string): Promise<{ ok: boolean; message: string }> {
  const cfg = getEvoConfig()
  const dbSettings = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } }
  })
  const dbCfg: Record<string, string> = {}
  dbSettings.forEach(r => { dbCfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value).replace(/"/g, '') })
  const url = dbCfg['whatsapp.evolution_url'] || cfg.url
  const key = dbCfg['whatsapp.evolution_key'] || cfg.key
  const expectedWebhookUrl = cfg.appUrl ? `${cfg.appUrl.replace(/\/$/, '')}/api/whatsapp/webhook` : null

  const [actionType, actionParam] = action.split(':')

  try {
    switch (actionType) {
      case 'fix-webhook': {
        // Preserva eventos extras e headers da instância — ver garantirWebhookDaInstancia.
        const r = await garantirWebhookDaInstancia(actionParam)
        return { ok: r.ok, message: r.message }
      }

      case 'reconnect': {
        const inst = await prisma.whatsAppInstance.findUnique({ where: { id: Number(actionParam) } })
        if (!inst) return { ok: false, message: 'Instância não encontrada' }

        await evoFetch(url, key, `/instance/restart/${inst.instanceName}`, 'PUT')
        return { ok: true, message: `Instância ${inst.name} reiniciada. Reconecte via QR Code se necessário.` }
      }

      case 'recreate': {
        const inst = await prisma.whatsAppInstance.findUnique({ where: { id: Number(actionParam) } })
        if (!inst) return { ok: false, message: 'Instância não encontrada' }
        // Instância nova sem endereço de webhook nasce muda: recebe no WhatsApp
        // e nada chega ao painel. Melhor não criar do que criar surda.
        if (!expectedWebhookUrl) return { ok: false, message: 'APP_URL não configurada no .env — sem ela a instância nasceria sem webhook.' }

        await evoFetch(url, key, '/instance/create', 'POST', {
          instanceName: inst.instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: false,
          webhook: {
            url: expectedWebhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: [...EVENTOS_WEBHOOK_NECESSARIOS]
          }
        })
        return { ok: true, message: `Instância ${inst.name} recriada na Evolution API. Conecte via QR Code.` }
      }

      default:
        return { ok: false, message: `Ação desconhecida: ${actionType}` }
    }
  } catch (err: any) {
    return { ok: false, message: `Erro: ${err.message}` }
  }
}

// ─── Public API ─────────────────────────────────────────

export function getLastHealth(): EvolutionHealth | null {
  return currentHealth
}

export async function forceCheck(): Promise<EvolutionHealth> {
  currentHealth = await runHealthCheck()
  return currentHealth
}

// ─── Startup ────────────────────────────────────────────

export function startEvolutionMonitor(): void {
  // First check after 15s
  setTimeout(async () => {
    currentHealth = await runHealthCheck()
    const issues = currentHealth.issues.filter(i => i.severity === 'critical')
    if (issues.length > 0) {
      console.warn(`[EvolutionMonitor] ${issues.length} problema(s) crítico(s) detectado(s):`)
      issues.forEach(i => console.warn(`  - ${i.message}`))
    } else {
      console.log(`[EvolutionMonitor] API ${currentHealth.api.status} (${currentHealth.api.responseTimeMs}ms), ${currentHealth.instances.length} instância(s)`)
    }

    // Then every 2 minutes
    intervalHandle = setInterval(async () => {
      try {
        currentHealth = await runHealthCheck()
      } catch (err) {
        console.error('[EvolutionMonitor] Check failed:', err)
      }
    }, 2 * 60 * 1000)

    console.log('[EvolutionMonitor] Monitor iniciado — verificando a cada 2min')
  }, 15000)
}

export function stopEvolutionMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
