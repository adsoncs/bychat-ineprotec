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
    appUrl: process.env.APP_URL || 'https://bychat.ia.br',
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
  const expectedWebhookUrl = `${cfg.appUrl}/api/whatsapp/webhook`

  const health: EvolutionHealth = {
    lastCheck: new Date().toISOString(),
    api: { status: 'offline', url, responseTimeMs: 0, version: null, error: null },
    instances: [],
    webhook: { status: 'missing', expected: expectedWebhookUrl, current: null, events: [], error: null },
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

            if (webhookUrl === expectedWebhookUrl) {
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
  const expectedWebhookUrl = `${cfg.appUrl}/api/whatsapp/webhook`

  const [actionType, actionParam] = action.split(':')

  try {
    switch (actionType) {
      case 'fix-webhook': {
        await evoFetch(url, key, `/webhook/set/${actionParam}`, 'POST', {
          webhook: {
            url: expectedWebhookUrl,
            enabled: true,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'PRESENCE_UPDATE']
          }
        })
        return { ok: true, message: `Webhook da instância ${actionParam} corrigido para ${expectedWebhookUrl}` }
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

        await evoFetch(url, key, '/instance/create', 'POST', {
          instanceName: inst.instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: false,
          webhook: {
            url: expectedWebhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'PRESENCE_UPDATE']
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
