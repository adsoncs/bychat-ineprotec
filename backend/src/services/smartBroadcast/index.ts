// src/services/smartBroadcast/index.ts
//
// Ciclo de vida da campanha. As rotas falam só com este arquivo.

import { prisma } from '../../lib/prisma.js'
import { planCampaign, type PlanSummary } from './planner.js'
import { DEFAULT_WINDOW, nextWindowStart, type WindowConfig } from './pacing.js'
import { hasPersonalization, type MessageBlock } from './variants.js'

export * from './pacing.js'
export * from './variants.js'
export * from './health.js'
export { planCampaign, buildRecipientsFromLeads, buildRecipientsFromRows, poolStatus, MAX_RECIPIENTS } from './planner.js'
export { startSmartBroadcastWorker, stopSmartBroadcastWorker } from './runner.js'
export { blockSender } from './guard.js'
export * from './suppression.js'
export * from './profiles.js'
export { assessRisk, type RiskReport } from './risk.js'
export { preferredHours } from './preferredTime.js'
export { registerReply } from './replies.js'

export interface StartResult {
  status: 'running' | 'scheduled'
  plan: PlanSummary
}

export interface StartChecks {
  /** Impedem o disparo: sem isto não há o que enviar, nem por onde. */
  errors: string[]
  /** Recomendações fortes. Aparecem na tela, mas quem decide é o operador. */
  warnings: string[]
}

/**
 * Checagens antes de disparar, separadas por quem manda na decisão.
 *
 * A versão anterior tratava tudo como erro e desabilitava o botão de iniciar —
 * inclusive a falta de uma variável no texto ou da base legal. São boas práticas
 * de verdade, mas viraram impedimento burocrático: o operador que sabe o que
 * está fazendo (lista pequena, aviso operacional, contato que pediu retorno)
 * ficava sem saída dentro do produto. Agora só bloqueia o que torna o envio
 * impossível; o resto é aviso, entra na nota de risco e fica registrado.
 */
export function checkForStart(campaign: any): StartChecks {
  const errors: string[] = []
  const warnings: string[] = []
  const blocks = (campaign.messageBlocks ?? []) as MessageBlock[]
  const withText = blocks.filter((b) => (b.variants ?? []).some((v) => String(v ?? '').trim()))
  const withMedia = blocks.filter((b) => String((b as any).mediaUrl ?? '').trim())
  // Só é impossível enviar quando não há NADA para mandar — uma campanha de
  // imagem sem legenda é legítima.
  if (!withText.length && !withMedia.length) errors.push('Escreva ao menos uma mensagem (ou anexe uma mídia)')
  if (!Array.isArray(campaign.senderInstances) || !campaign.senderInstances.length) {
    errors.push('Escolha ao menos um número de envio')
  }

  if (!hasPersonalization(blocks)) {
    warnings.push('Nenhuma variável no texto (ex.: {{primeiro_nome}}): mensagem idêntica para todo mundo é mais fácil de agrupar do outro lado')
  }
  const variantCount = (blocks[0]?.variants ?? []).filter((v) => String(v ?? '').trim()).length
  if (variantCount < 2) {
    warnings.push('Só uma redação do primeiro bloco — com 2 ou mais variações o disparo fica bem menos parecido com robô')
  }
  // LGPD: continua sendo o certo declarar, e fica registrado na campanha junto
  // de quem a iniciou. Deixou de impedir o disparo porque a responsabilidade é
  // de quem opera, não do botão.
  if (!campaign.legalBasis) {
    warnings.push('Base legal do contato não declarada (consentimento, execução de contrato ou legítimo interesse)')
  }
  return { errors, warnings }
}

/** Compatibilidade: só o que de fato impede o disparo. */
export function validateForStart(campaign: any): string[] {
  return checkForStart(campaign).errors
}

/** Inicia agora ou agenda. Em ambos os casos a agenda é calculada e persistida. */
export async function startCampaign(campaignId: number, scheduledAt?: Date | null): Promise<StartResult> {
  const campaign = await prisma.smartCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Campanha não encontrada')

  const errors = validateForStart(campaign)
  if (errors.length) throw new Error(errors.join(' · '))

  const window: WindowConfig = { ...DEFAULT_WINDOW, ...((campaign.windowConfig ?? {}) as Partial<WindowConfig>) }
  const scheduleFor = scheduledAt && scheduledAt.getTime() > Date.now() + 30_000 ? scheduledAt : null
  const startFrom = nextWindowStart(scheduleFor ?? new Date(), window)

  const plan = await planCampaign(campaignId, { startFrom })

  await prisma.smartCampaign.update({
    where: { id: campaignId },
    data: {
      status: scheduleFor ? 'scheduled' : 'running',
      scheduledAt: scheduleFor,
      startedAt: scheduleFor ? null : new Date(),
      riskState: 'ok',
      riskReason: null,
    },
  })
  return { status: scheduleFor ? 'scheduled' : 'running', plan }
}

export async function pauseCampaign(id: number): Promise<void> {
  await prisma.smartCampaign.update({ where: { id }, data: { status: 'paused' } })
}

/**
 * Retomar SEMPRE replaneja o que falta. Os horários antigos ficaram no passado
 * enquanto a campanha esteve parada; despejar tudo de uma vez ao voltar seria o
 * oposto do que o módulo existe para fazer.
 */
export async function resumeCampaign(id: number): Promise<PlanSummary> {
  const campaign = await prisma.smartCampaign.findUnique({ where: { id } })
  if (!campaign) throw new Error('Campanha não encontrada')
  await prisma.smartCampaignRecipient.updateMany({
    where: { campaignId: id, status: { in: ['scheduled', 'sending'] } },
    data: { status: 'pending', plannedAt: null },
  })
  const plan = await planCampaign(id, { startFrom: new Date(), skipNumberCheck: true })
  await prisma.smartCampaign.update({
    where: { id },
    data: { status: 'running', riskState: 'ok', riskReason: null, startedAt: campaign.startedAt ?? new Date() },
  })
  return plan
}

export async function cancelCampaign(id: number): Promise<void> {
  await prisma.smartCampaign.update({ where: { id }, data: { status: 'canceled', completedAt: new Date() } })
  await prisma.smartCampaignRecipient.updateMany({
    where: { campaignId: id, status: { in: ['pending', 'scheduled', 'sending'] } },
    data: { status: 'skipped', skipReason: 'canceled' },
  })
}

/**
 * Desempenho por VARIAÇÃO de texto. O A/B aqui não é firula de marketing: se uma
 * redação responde 8% e outra 1%, a diferença aparece no risco do número —
 * mensagem que ninguém responde é mensagem que o WhatsApp trata como spam.
 */
export async function variantPerformance(campaignId: number) {
  const campaign = await prisma.smartCampaign.findUnique({ where: { id: campaignId } })
  if (!campaign) throw new Error('Campanha não encontrada')
  const blocks = ((campaign.messageBlocks ?? []) as unknown) as MessageBlock[]
  const texts = (blocks[0]?.variants ?? []).filter((v) => String(v ?? '').trim())

  const rows = await prisma.smartCampaignRecipient.groupBy({
    by: ['variantIndex', 'status'],
    where: { campaignId },
    _count: true,
  })

  const byVariant = new Map<number, { sent: number; replied: number; failed: number }>()
  for (const r of rows) {
    const cur = byVariant.get(r.variantIndex) ?? { sent: 0, replied: 0, failed: 0 }
    if (['sent', 'delivered', 'read', 'replied'].includes(r.status)) cur.sent += r._count
    if (r.status === 'replied') cur.replied += r._count
    if (r.status === 'failed') cur.failed += r._count
    byVariant.set(r.variantIndex, cur)
  }

  return {
    variants: texts.map((text, i) => {
      const s = byVariant.get(i) ?? { sent: 0, replied: 0, failed: 0 }
      return {
        index: i,
        text: text.slice(0, 240),
        sent: s.sent,
        replied: s.replied,
        failed: s.failed,
        replyRate: s.sent ? Math.round((s.replied / s.sent) * 1000) / 10 : 0,
      }
    }),
  }
}

/** Métricas da campanha, incluindo o que só faz sentido aqui: taxa de resposta. */
export async function campaignMetrics(campaignId: number) {
  const grouped = await prisma.smartCampaignRecipient.groupBy({
    by: ['status'], where: { campaignId }, _count: true,
  })
  const counts: Record<string, number> = {
    pending: 0, scheduled: 0, sending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0,
  }
  for (const g of grouped) counts[g.status] = g._count
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const reached = counts.sent + counts.delivered + counts.read + counts.replied
  const done = reached + counts.failed + counts.skipped

  const skipGrouped = await prisma.smartCampaignRecipient.groupBy({
    by: ['skipReason'], where: { campaignId, skipReason: { not: null } }, _count: true,
  })
  const skips: Record<string, number> = {}
  for (const g of skipGrouped) if (g.skipReason) skips[g.skipReason] = g._count

  const next = await prisma.smartCampaignRecipient.findFirst({
    where: { campaignId, status: 'scheduled' },
    orderBy: { plannedAt: 'asc' },
    select: { plannedAt: true },
  })

  return {
    counts,
    skips,
    total,
    progress: total ? Math.round((done / total) * 100) : 0,
    // Taxa de resposta é o termômetro real: mede se as pessoas QUEREM a mensagem.
    replyRate: reached ? Math.round((counts.replied / reached) * 1000) / 10 : 0,
    nextSendAt: next?.plannedAt ?? null,
  }
}
