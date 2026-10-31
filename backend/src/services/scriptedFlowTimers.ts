// src/services/scriptedFlowTimers.ts
//
// Timers do fluxo de ATENDIMENTO do chatbot scripted (scriptedConfig.supportFlow):
//
//   • Aviso de fila — lead em waiting_agent há N min sem operador assumir, dentro
//     do horário comercial → mensagem de espera (1x por handoff).
//   • Timeout do CSAT — pesquisa enviada há N min sem nota → agradece e encerra.
//
// Mesmo padrão dos demais pollers do server.ts (setInterval). O "cancelamento" é
// implícito: cada tick reavalia a condição contra o estado atual — se o contato
// respondeu ou o operador assumiu, a fase mudou e nada é enviado.
// A inatividade (aviso 10min + encerramento) fica no inactivity.ts, que já roda.

import { prisma } from '../lib/prisma.js'
import { logEvent } from './leadHistory.js'
import {
  getSupportCfg, supportMsg, sendBotMessage, firstName, closeCsatTimeout, saveScriptState,
} from './scriptedSupportFlow.js'
import { getBusinessHoursConfig, isWithinBusinessHours } from './businessHours.js'
import { avisarEquipe, limitesDaFila, precisaAvisar, TETO_POR_VOLTA } from './alertaFilaEquipe.js'

let intervalHandle: ReturnType<typeof setInterval> | null = null

async function tick(): Promise<void> {
  try {
    const bots = (await prisma.chatbot.findMany({ where: { active: true, mode: 'scripted' } }))
      .map((bot) => ({ bot, cfg: getSupportCfg(bot) }))
      .filter((x) => x.cfg) as Array<{ bot: any; cfg: NonNullable<ReturnType<typeof getSupportCfg>> }>
    if (!bots.length) return

    const now = Date.now()
    const bh = await getBusinessHoursConfig().catch(() => null)
    // Teto de avisos à equipe nesta volta — ver alertaFilaEquipe.ts.
    const limites = await limitesDaFila()
    let avisosNestaVolta = 0

    for (const { bot, cfg } of bots) {
      // Conversas recentes deste chatbot; a fase é filtrada em JS (volume baixo).
      const leads = await prisma.lead.findMany({
        where: { chatbotId: bot.id, lastMessageAt: { gte: new Date(now - 48 * 3600_000) } },
        orderBy: { lastMessageAt: 'desc' },
        take: 200,
      })

      for (const lead of leads) {
        const state: any = ((lead.formData as any) || {})._script
        if (!state) continue

        // ── Aviso de fila (1x por handoff, só em horário comercial) ──
        if (
          state.phase === 'waiting_agent' && !state.queueWarnedAt && state.handoffAt &&
          lead.assignedUserId == null && lead.whatsapp &&
          now - new Date(state.handoffAt).getTime() >= cfg.queueWarnMinutes * 60_000 &&
          (!cfg.useBusinessHours || !bh || isWithinBusinessHours(bh))
        ) {
          const sent = await sendBotMessage(lead.id, lead.whatsapp, supportMsg(bot, 'queueWait', { nome: firstName(lead.nome) }), bot)
          if (sent) {
            state.queueWarnedAt = new Date().toISOString()
            await saveScriptState(lead.id, state)
            logEvent({
              leadId: lead.id, type: 'queue_wait_notice' as any, category: 'system',
              title: 'Aviso de espera na fila enviado', channel: 'whatsapp', source: 'chatbot', actorType: 'system',
              metadata: { queueWarnMinutes: cfg.queueWarnMinutes, chatbotId: bot.id },
            })
          }
          continue
        }

        // ── Aviso à EQUIPE: tem gente esperando e ninguém assumiu ──
        // Roda depois do aviso ao cliente e é independente dele: o cliente ouve
        // "já estamos te atendendo" mesmo quando ninguém foi avisado, e era
        // exatamente assim que a fila parava sem ninguém perceber.
        if (
          state.phase === 'waiting_agent' && lead.assignedUserId == null &&
          avisosNestaVolta < TETO_POR_VOLTA &&
          precisaAvisar(state, now, limites) &&
          (!cfg.useBusinessHours || !bh || isWithinBusinessHours(bh))
        ) {
          if (await avisarEquipe(lead, state, now)) {
            avisosNestaVolta++
            state.teamAlertedAt = new Date().toISOString()
            state.teamAlertedCount = Number(state.teamAlertedCount || 0) + 1
            await saveScriptState(lead.id, state)
          }
        }

        // ── Timeout do CSAT ──
        if (
          state.phase === 'csat' && state.csatAskedAt &&
          now - new Date(state.csatAskedAt).getTime() >= cfg.csat.timeoutMin * 60_000
        ) {
          await closeCsatTimeout(lead, bot, state)
        }
      }
    }
  } catch (err) {
    console.error('[ScriptedFlowTimers] tick failed:', err)
  }
}

export function startScriptedFlowTimers(): void {
  setTimeout(async () => {
    await tick()
    intervalHandle = setInterval(tick, 60_000)
    console.log('[ScriptedFlowTimers] started — fila/CSAT a cada 60s (config por chatbot)')
  }, 30_000)
}

export function stopScriptedFlowTimers(): void {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}
