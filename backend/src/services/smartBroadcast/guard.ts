// src/services/smartBroadcast/guard.ts
//
// Disjuntor. A campanha inteira existe sobre um pressuposto frágil — o número
// continuar conectado e não ser sinalizado. Quando esse pressuposto quebra, a
// diferença entre perder 30 mensagens e perder o chip é o tempo de reação.
//
// Sinais vigiados, em ordem de gravidade:
//   1. Sessão derrubada (401/403 do Baileys) → número BLOQUEADO, sem volta
//      automática: só com novo QR ou outro chip.
//   2. Falhas em sequência → pausa temporária, porque quase sempre é a Evolution
//      recusando o envio (número já restrito).
//   3. Muitos "não existe no WhatsApp" → a lista é ruim, e lista ruim queima
//      número; vale parar antes do estrago.
//   4. Envio alto sem NENHUMA resposta → ou a mensagem não interessa a ninguém,
//      ou já não está sendo entregue. Nos dois casos, continuar piora.
//
// Toda ação do disjuntor é registrada e visível na tela — pausa silenciosa faria
// o operador achar que o sistema travou.

import { prisma } from '../../lib/prisma.js'
import { dayStart, refreshScore } from './health.js'

/** Falhas seguidas do mesmo número antes da pausa temporária. */
const FAIL_STREAK_LIMIT = 5
const FAIL_PAUSE_MS = 45 * 60_000
/** Proporção de destinatários inexistentes que condena a lista. */
const NOT_FOUND_RATE_LIMIT = 0.25
const NOT_FOUND_MIN_SAMPLE = 20
/** Envios sem nenhuma resposta que disparam revisão humana. */
const NO_REPLY_STREAK = 150

/** Falhas consecutivas por instância (em memória: reiniciar o backend zera, e tudo bem). */
const failStreak = new Map<number, number>()

export async function noteSendOk(instanceId: number): Promise<void> {
  failStreak.set(instanceId, 0)
}

/** Registra falha e, no limite, tira o número de circulação por um tempo. */
export async function noteSendFailure(instanceId: number, error: string): Promise<boolean> {
  const streak = (failStreak.get(instanceId) ?? 0) + 1
  failStreak.set(instanceId, streak)
  if (streak < FAIL_STREAK_LIMIT) return false
  await pauseSender(instanceId, `${streak} falhas seguidas — última: ${error.slice(0, 120)}`, FAIL_PAUSE_MS)
  failStreak.set(instanceId, 0)
  return true
}

/** Pausa temporária (disjuntor). O número volta sozinho quando `pausedUntil` passa. */
export async function pauseSender(instanceId: number, reason: string, forMs: number): Promise<void> {
  const day = dayStart()
  await prisma.smartSenderHealth.updateMany({
    where: { instanceId, day },
    data: { state: 'paused', pausedUntil: new Date(Date.now() + forMs), pauseReason: reason.slice(0, 191) },
  })
  console.warn(`[smartBroadcast] número ${instanceId} pausado por ${Math.round(forMs / 60000)}min: ${reason}`)
}

/**
 * Bloqueio definitivo — sessão invalidada pelo WhatsApp. Sem volta automática:
 * o número só retorna depois de intervenção humana (novo QR/outro chip), e as
 * campanhas que dependiam dele são pausadas na hora.
 */
export async function blockSender(instanceName: string, reason: string): Promise<void> {
  const inst = await prisma.whatsAppInstance.findFirst({ where: { instanceName }, select: { id: true } })
  if (!inst) return
  const day = dayStart()
  await prisma.smartSenderHealth.updateMany({
    where: { instanceId: inst.id, day },
    data: { state: 'blocked', pausedUntil: null, pauseReason: reason.slice(0, 191), score: 0 },
  })
  // Toda campanha em andamento que usava este número entra em pausa: seguir com
  // os outros números escondendo a perda é exatamente o que não se quer aqui.
  const running = await prisma.smartCampaign.findMany({ where: { status: 'running' } })
  for (const c of running) {
    const pool = Array.isArray(c.senderInstances) ? (c.senderInstances as any[]) : []
    if (!pool.some((p) => p?.instanceName === instanceName)) continue
    await prisma.smartCampaign.update({
      where: { id: c.id },
      data: {
        status: 'paused',
        riskState: 'halted',
        riskReason: `Número ${instanceName} bloqueado: ${reason}`.slice(0, 191),
      },
    })
    console.error(`[smartBroadcast] campanha ${c.id} pausada — número ${instanceName} bloqueado`)
  }
}

/**
 * Avaliação por campanha, chamada a cada envio concluído. Devolve o estado de
 * risco; `halted` significa que a campanha foi pausada e precisa de decisão
 * humana para voltar.
 */
export async function evaluateCampaign(campaignId: number): Promise<'ok' | 'watch' | 'halted'> {
  const agg = await prisma.smartCampaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: true,
  })
  const counts: Record<string, number> = {}
  for (const g of agg) counts[g.status] = g._count
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0) + (counts.replied ?? 0)
  const replied = counts.replied ?? 0
  const failed = counts.failed ?? 0

  const notFound = await prisma.smartCampaignRecipient.count({
    where: { campaignId, skipReason: 'not_on_whatsapp' },
  })
  const processed = sent + failed + notFound

  // Lista ruim: proporção alta de números que sequer existem no WhatsApp.
  if (processed >= NOT_FOUND_MIN_SAMPLE && notFound / processed > NOT_FOUND_RATE_LIMIT) {
    await halt(campaignId, `${Math.round((notFound / processed) * 100)}% dos números não existem no WhatsApp — lista precisa de revisão`)
    return 'halted'
  }

  // Muito envio e nenhuma resposta: ou não interessa, ou não está chegando.
  if (sent >= NO_REPLY_STREAK && replied === 0) {
    await halt(campaignId, `${sent} mensagens enviadas sem nenhuma resposta — revise a mensagem e a lista antes de continuar`)
    return 'halted'
  }

  if (sent >= 30 && failed / Math.max(1, sent) > 0.15) {
    await prisma.smartCampaign.update({
      where: { id: campaignId },
      data: { riskState: 'watch', riskReason: 'Taxa de falha acima de 15%' },
    })
    return 'watch'
  }

  return 'ok'
}

async function halt(campaignId: number, reason: string): Promise<void> {
  await prisma.smartCampaign.updateMany({
    where: { id: campaignId, status: 'running' },
    data: { status: 'paused', riskState: 'halted', riskReason: reason.slice(0, 191) },
  })
  console.warn(`[smartBroadcast] campanha ${campaignId} interrompida: ${reason}`)
}

/** Recalcula scores de todos os números usados hoje — alimenta o rodízio. */
export async function refreshAllScores(): Promise<void> {
  const day = dayStart()
  const rows = await prisma.smartSenderHealth.findMany({ where: { day }, select: { instanceId: true } })
  for (const r of rows) await refreshScore(r.instanceId).catch(() => {})
}
