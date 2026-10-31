// src/services/inactivity.ts
// Verifica leads com conversas inativas e executa ações configuráveis por chatbot
// IMPORTANTE: mensagens saem pelo canal onde o lead já conversa (Evolution ou
// Cloud API); sem histórico, pela instância vinculada ao chatbot. Nunca por um
// canal aleatório.

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { quebrarEmMensagens, intervaloDigitacao } from './messageStyle.js'

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

/**
 * Envia a mensagem de retomada pelo canal por onde o lead JÁ conversa.
 *
 * Antes daqui só saía Evolution: `resolveInstanceForChatbot` procura uma
 * WhatsAppInstance com aquele chatbotId, e um chatbot que atende pela Cloud API
 * simplesmente não tem uma — a retomada era silenciosamente descartada com um
 * aviso no log. Agora o canal vem do histórico do lead (getProviderForLead), e a
 * instância vinculada ao chatbot fica como caminho antigo, para quem não tem
 * histórico ainda.
 *
 * O texto passa pelas mesmas regras de escrita das outras mensagens do bot: cada
 * ideia em sua bolha, sem travessão e sem emoji.
 */
async function sendWhatsAppViaChatbotInstance(
  phone: string, text: string, chatbotId: number, leadId?: number,
  /** Reconferido depois de esperar a vez na linha: o lead pode ter respondido. */
  aindaInativo?: () => Promise<boolean>,
): Promise<boolean> {
  const partes = quebrarEmMensagens(text)
  if (!partes.length) return false
  const { esperarVez, reservarVez } = await import('./ritmoEnvio.js')

  if (leadId) {
    try {
      const { getProviderForLead } = await import('./whatsappProvider.js')
      const provider = await getProviderForLead({ id: leadId, whatsapp: phone })
      await esperarVez(provider as any)
      if (aindaInativo && !(await aindaInativo())) return false
      for (const [i, parte] of partes.entries()) {
        await provider.sendText(phone, parte)
        if (i < partes.length - 1) await new Promise((r) => setTimeout(r, intervaloDigitacao(partes[i + 1] as string)))
      }
      return true
    } catch (err) {
      console.warn(`[Inactivity] envio pelo canal do lead #${leadId} falhou, tentando a instância do chatbot:`, err)
    }
  }

  const conn = await resolveInstanceForChatbot(chatbotId)
  if (!conn) return false
  // Caminho antigo (chamada crua na Evolution): vai em uma mensagem só, com as
  // partes separadas por linha em branco.
  const textoUnico = partes.join('\n\n')
  const espera = await reservarVez(`evolution:${conn.instanceName}`, 'evolution')
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  if (aindaInativo && !(await aindaInativo())) return false

  try {
    const resp = await fetch(`${conn.url}/message/sendText/${conn.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: conn.key },
      body: JSON.stringify({ number: phone, text: textoUnico })
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

// Com o ritmo por linha uma varredura pode passar dos 2 min do intervalo; sem
// esta trava a seguinte pegaria os mesmos leads e mandaria o lembrete de novo.
let varrendo = false

async function checkInactiveLeads(): Promise<void> {
  if (varrendo) return
  varrendo = true
  try {
    // Busca todos os chatbots que têm inatividade habilitada
    const chatbots = await prisma.chatbot.findMany({
      where: { inactivityEnabled: true, active: true }
    })

    if (chatbots.length === 0) return

    const now = new Date()

    for (const bot of chatbots) {
      if (bot.inactivityAction === 'ai_reactivate') {
        await reativarComIa(bot, now).catch((e) => console.error(`[Inactivity] reativação com IA (bot ${bot.id}):`, e))
        continue
      }
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
          const sent = await sendWhatsAppViaChatbotInstance(lead.whatsapp, message, bot.id, lead.id, async () => {
            const atual = await prisma.lead.findUnique({ where: { id: lead.id }, select: { lastActivityAt: true, completed: true, outcome: true } })
            return !!atual && !atual.completed && !atual.outcome
              && !!atual.lastActivityAt && atual.lastActivityAt < inactiveThreshold
          })

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
  } finally {
    varrendo = false
  }
}

// ── Reativar com IA e transferir (ação 'ai_reactivate', Jornada IA) ─────────
// Conversa parada = a última mensagem é da IA e a pessoa não respondeu. Cada
// silêncio tem até `inactivityMaxRetries` reativações escritas pela IA, no ponto
// em que a conversa parou (aiJourneyEngine.reativarConversaComIa). Sem resposta
// depois da última, a conversa vai para uma pessoa: o destino provisório da
// primeira escolha (fallbackRoute) ou a equipe do lead, com o funil junto.
//   inactivityTimeoutMin    → espera antes da 1ª reativação
//   inactivityCloseAfterMin → espera entre as reativações e antes de transferir
// Só manda dentro das 24h do WhatsApp desde a última mensagem da pessoa (fora
// disso a Meta só aceita modelo aprovado) e só entre 8h e 21h (Brasília); a
// madrugada espera. Sem janela, transfere sem mandar nada.
const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000
const MARGEM_JANELA_MS = 10 * 60 * 1000

function horaDeBrasilia(d: Date): number {
  return Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(d))
}

/** `soLeadId`: só esse lead (teste do fluxo sem tocar nas conversas reais). */
export async function reativarComIa(bot: any, now: Date, soLeadId?: number): Promise<void> {
  if (bot.mode !== 'ai_journey' || !bot.formId) return
  const form = await prisma.form.findUnique({ where: { id: bot.formId } })
  if (!form) return
  const primeiraMs = (bot.inactivityTimeoutMin || 30) * 60 * 1000
  const intervaloMs = (bot.inactivityCloseAfterMin || 120) * 60 * 1000
  const maximo = Math.max(1, bot.inactivityMaxRetries ?? 2)
  const horaBoa = (() => { const h = horaDeBrasilia(now); return h >= 8 && h < 21 })()
  // Vale só para conversas que pararam DEPOIS de a reativação ser ligada: ligar
  // não pode disparar mensagem para todo mundo que ficou em silêncio no dia.
  const chave = `inatividade.ia.desde.${bot.id}`
  let desde = (await prisma.setting.findUnique({ where: { key: chave } }).catch(() => null))?.value as any
  if (!desde) {
    desde = now.toISOString()
    await prisma.setting.create({ data: { key: chave, value: desde, label: `Reativação com IA do chatbot ${bot.id}: vale para conversas paradas a partir de`, grp: 'chatbot' } }).catch(() => {})
  }
  const ligadaEm = new Date(String(desde))

  const leads = await prisma.lead.findMany({
    where: {
      chatbotId: bot.id, completed: false, outcome: null,
      ...(soLeadId ? { id: soLeadId } : {}),
      lastMessageAt: { gte: new Date(now.getTime() - JANELA_WHATSAPP_MS - intervaloMs), lt: new Date(now.getTime() - primeiraMs) },
    },
    select: { id: true, whatsapp: true, teamId: true, formData: true },
    orderBy: { lastMessageAt: 'asc' },
    take: 50,
  })

  const { readBotPause } = await import('./botTakeover.js')
  for (const lead of leads) {
    const fd: any = lead.formData || {}
    const state = fd._aiJourney
    if (!lead.whatsapp || !state || state.phase !== 'active' || readBotPause(fd)) continue

    const ultima = await prisma.message.findFirst({ where: { leadId: lead.id, isInternal: false }, orderBy: { id: 'desc' }, select: { id: true, fromMe: true, timestamp: true, senderName: true } })
    if (!ultima?.fromMe || ultima.senderName !== bot.name) continue // respondeu, ou quem falou por último foi uma pessoa da equipe
    if (new Date(ultima.timestamp) < ligadaEm && !fd._reativacao) continue
    const daPessoa = await prisma.message.findFirst({ where: { leadId: lead.id, isInternal: false, fromMe: false }, orderBy: { id: 'desc' }, select: { id: true, timestamp: true } })
    if (!daPessoa) continue

    // Um ciclo por silêncio: a pessoa respondeu depois da última reativação, zera.
    const reat = fd._reativacao && fd._reativacao.desde === daPessoa.id ? fd._reativacao : { desde: daPessoa.id, n: 0 }
    const espera = reat.n === 0 ? primeiraMs : intervaloMs
    if (now.getTime() - new Date(ultima.timestamp).getTime() < espera) continue

    const janelaAberta = now.getTime() - new Date(daPessoa.timestamp).getTime() < JANELA_WHATSAPP_MS - MARGEM_JANELA_MS
    if (reat.n < maximo && janelaAberta) {
      if (!horaBoa) continue
      const { reativarConversaComIa } = await import('./aiJourneyEngine.js')
      const enviou = await reativarConversaComIa(lead.id, bot, form, reat.n + 1, maximo).catch((e) => { console.warn(`[Inactivity] lead #${lead.id}:`, e?.message || e); return false })
      if (!enviou) continue
      const atual: any = (await prisma.lead.findUnique({ where: { id: lead.id }, select: { formData: true } }))?.formData || {}
      await prisma.lead.update({ where: { id: lead.id }, data: { inactiveNotifiedAt: now, formData: { ...atual, _reativacao: { desde: daPessoa.id, n: reat.n + 1, em: now.toISOString() } } } })
      logEvent({ leadId: lead.id, type: EVENT_TYPES.INACTIVITY_NOTIFIED, category: 'system', title: `Reativação ${reat.n + 1}/${maximo} enviada pela IA`, channel: 'whatsapp', source: 'inactivity_service', actorType: 'system', metadata: { tentativa: reat.n + 1, maximo, chatbotId: bot.id } })
      continue
    }

    // Sem resposta depois da última reativação (ou janela do WhatsApp fechada): uma pessoa assume.
    const destino = state.fallbackRoute?.teamId ? state.fallbackRoute : (lead.teamId ? { teamId: lead.teamId, funnelId: null } : null)
    let equipe = ''
    if (destino) {
      const { enviarParaEquipe } = await import('./encaminharEquipe.js')
      await enviarParaEquipe(lead.id, { teamId: destino.teamId, funnelId: destino.funnelId }, 'inactivity')
      equipe = (await prisma.team.findUnique({ where: { id: destino.teamId }, select: { name: true } }))?.name || ''
    }
    const atual: any = (await prisma.lead.findUnique({ where: { id: lead.id }, select: { formData: true } }))?.formData || {}
    await prisma.lead.update({ where: { id: lead.id }, data: { formData: { ...atual, _aiJourney: { ...(atual._aiJourney || state), phase: 'handoff' }, _reativacao: { ...reat, transferidoEm: now.toISOString() } } } })
    const motivo = janelaAberta ? `sem resposta depois de ${maximo} reativações` : 'sem resposta e fora da janela de 24h do WhatsApp'
    await prisma.message.create({ data: { leadId: lead.id, fromMe: true, isInternal: true, body: `🔔 ${bot.name}: ${motivo}. Conversa transferida${equipe ? ` para ${equipe}` : ''} para uma pessoa da equipe continuar.`, senderName: bot.name, timestamp: now } }).catch(() => {})
    logEvent({ leadId: lead.id, type: EVENT_TYPES.INACTIVITY_CLOSED, category: 'system', title: `Transferido para humano: ${motivo}`, channel: 'whatsapp', source: 'inactivity_service', actorType: 'system', metadata: { equipe, teamId: destino?.teamId ?? null, chatbotId: bot.id } })
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
