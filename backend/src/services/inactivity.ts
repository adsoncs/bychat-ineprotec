// src/services/inactivity.ts
// Verifica leads com conversas inativas e executa ações configuráveis por chatbot
// IMPORTANTE: mensagens SOMENTE são enviadas pela instância vinculada ao chatbot

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

let intervalHandle: ReturnType<typeof setInterval> | null = null

/**
 * Resolve a instância WhatsApp vinculada a um chatbot.
 * Retorna null se não houver instância vinculada — NUNCA usa fallback.
 */
async function resolveInstanceForChatbot(chatbotId: number): Promise<{ url: string; key: string; instanceName: string } | null> {
  // Buscar instância vinculada ao chatbot
  const instance = await prisma.whatsAppInstance.findFirst({
    where: { chatbotId, active: true }
  })

  if (!instance) {
    console.warn(`[Inactivity] Chatbot #${chatbotId} não tem instância WhatsApp vinculada — mensagem NÃO será enviada`)
    return null
  }

  // Buscar credenciais da Evolution API
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } }
  })
  const cfg: Record<string, string> = {}
  rows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value) })

  const url = cfg['whatsapp.evolution_url'] || process.env.EVOLUTION_API_URL
  const key = cfg['whatsapp.evolution_key'] || process.env.EVOLUTION_API_KEY

  if (!url || !key) {
    console.warn('[Inactivity] Evolution API não configurada')
    return null
  }

  return { url, key, instanceName: instance.instanceName }
}

async function sendWhatsAppViaChatbotInstance(phone: string, text: string, chatbotId: number): Promise<boolean> {
  const conn = await resolveInstanceForChatbot(chatbotId)
  if (!conn) return false

  try {
    const resp = await fetch(`${conn.url}/message/sendText/${conn.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: conn.key },
      body: JSON.stringify({ number: phone, text })
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      console.error(`[Inactivity] Evolution API error (${resp.status}): ${errText.substring(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[Inactivity] Failed to send WhatsApp to ${phone} via ${conn.instanceName}:`, err)
    return false
  }
}

async function checkInactiveLeads(): Promise<void> {
  try {
    // Busca todos os chatbots que têm inatividade habilitada
    const chatbots = await prisma.chatbot.findMany({
      where: { inactivityEnabled: true, active: true }
    })

    if (chatbots.length === 0) return

    const now = new Date()

    for (const bot of chatbots) {
      const timeoutMin = bot.inactivityTimeoutMin || 60
      const action = bot.inactivityAction || 'notify'
      const message = bot.inactivityMessage || ''
      const maxRetries = bot.inactivityMaxRetries ?? 2
      const closeAfterMin = bot.inactivityCloseAfterMin || 1440

      const inactiveThreshold = new Date(now.getTime() - timeoutMin * 60 * 1000)
      const closeThreshold = new Date(now.getTime() - closeAfterMin * 60 * 1000)

      // Find leads for this chatbot that are in-progress and inactive.
      // Fase 23: ignora leads já classificados (Ganho/Perdido) — ciclo de vida encerrado.
      const inactiveLeads = await prisma.lead.findMany({
        where: {
          chatbotId: bot.id,
          completed: false,
          outcome: null,
          lastActivityAt: { not: null, lt: inactiveThreshold }
        },
        orderBy: { lastActivityAt: 'asc' },
        take: 50
      })

      for (const lead of inactiveLeads) {
        const formData = (lead.formData || {}) as any
        const source = formData._source

        // Count how many inactivity notifications were already sent
        const notifyCount = formData._inactivityNotifyCount || 0

        // Check if should auto-close (past close threshold)
        if (lead.lastActivityAt && lead.lastActivityAt < closeThreshold) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              completed: true,
              formData: { ...formData, _closedReason: 'inactivity', _closedAt: now.toISOString() }
            }
          })
          logEvent({
            leadId: lead.id,
            type: EVENT_TYPES.INACTIVITY_CLOSED,
            category: 'system',
            title: 'Lead fechado por inatividade',
            channel: source || 'system',
            source: 'inactivity_service',
            actorType: 'system',
            description: `Lead fechado automaticamente após ${closeAfterMin}min sem atividade (chatbot: ${bot.name})`,
            metadata: { closeAfterMin, lastActivityAt: lead.lastActivityAt?.toISOString(), chatbotId: bot.id },
          })
          console.log(`[Inactivity] Auto-closed lead #${lead.id} (${lead.whatsapp || lead.nome}) after ${closeAfterMin}min inactivity (bot: ${bot.name})`)
          continue
        }

        // Skip if already notified max times
        if (notifyCount >= maxRetries) continue

        // Skip if recently notified (don't spam — wait at least timeout again)
        if (lead.inactiveNotifiedAt) {
          const sinceNotify = now.getTime() - new Date(lead.inactiveNotifiedAt).getTime()
          if (sinceNotify < timeoutMin * 60 * 1000) continue
        }

        // Send re-engagement message — ONLY via the instance linked to this chatbot
        if ((action === 'notify' || action === 'notify_then_close') && message && source === 'whatsapp' && lead.whatsapp) {
          const sent = await sendWhatsAppViaChatbotInstance(lead.whatsapp, message, bot.id)

          if (!sent) {
            console.warn(`[Inactivity] Skipping lead #${lead.id} — no instance linked to chatbot #${bot.id} (${bot.name})`)
            continue
          }

          // Update notification tracking
          const chatMessages: any[] = formData._chatMessages || []
          chatMessages.push({ role: 'assistant', content: message, _type: 'inactivity_reminder' })

          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              inactiveNotifiedAt: now,
              formData: {
                ...formData,
                _chatMessages: chatMessages,
                _inactivityNotifyCount: notifyCount + 1
              }
            }
          })

          logEvent({
            leadId: lead.id,
            type: EVENT_TYPES.INACTIVITY_NOTIFIED,
            category: 'system',
            title: `Notificação de inatividade #${notifyCount + 1} enviada`,
            channel: 'whatsapp',
            source: 'inactivity_service',
            actorType: 'system',
            description: `Re-engajamento enviado para ${lead.whatsapp} (tentativa ${notifyCount + 1}/${maxRetries}, chatbot: ${bot.name})`,
            metadata: { attempt: notifyCount + 1, maxRetries, timeoutMin, chatbotId: bot.id },
          })
          console.log(`[Inactivity] Sent re-engagement #${notifyCount + 1} to lead #${lead.id} (${lead.whatsapp}) [bot: ${bot.name}]`)
        }
      }
    }
  } catch (err) {
    console.error('[Inactivity] Check failed:', err)
  }
}

export function startInactivityChecker(): void {
  // Initial delay of 30s to let server fully start
  setTimeout(async () => {
    // Run once immediately
    await checkInactiveLeads()

    // Run every 2 minutes (each chatbot has seu próprio timeout config)
    const intervalMs = 2 * 60 * 1000
    intervalHandle = setInterval(checkInactiveLeads, intervalMs)
    console.log(`[Inactivity] Checker started — running every 2min (per-chatbot config)`)
  }, 30000)
}

export function stopInactivityChecker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('[Inactivity] Checker stopped')
  }
}
