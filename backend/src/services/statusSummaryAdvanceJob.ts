// src/services/statusSummaryAdvanceJob.ts
// Escada automática do módulo Resumo.
//
// No Rubeus o consultor tem que LEMBRAR de trocar AT-020 → AT-021 quando a
// atividade de 5 dias vence sem resposta. Aqui o sistema faz: atividade venceu,
// o lead não deu sinal, sobe o degrau — gera a próxima cobrança com o próximo
// prazo e registra tudo. O consultor só entra quando o lead responde.
//
// Só age em resumos com `autoAdvanceOnDue = true` e `nextSummaryCode` definido:
// nada avança sozinho sem alguém ter configurado explicitamente.

import { prisma } from '../lib/prisma.js'
import { applyStatusSummary } from './statusSummaryEngine.js'

const TICK_MS = 15 * 60 * 1000 // 15 min — a granularidade útil é de dias, não de minutos
const MAX_PER_TICK = 200

let _timer: ReturnType<typeof setInterval> | null = null

/**
 * O lead "deu sinal" desde que o resumo foi aplicado?
 * Qualquer mensagem recebida (fromMe = false) posterior conta como interação —
 * é o mesmo critério de "parou de responder" que o processo comercial usa.
 */
async function leadRespondedSince(leadId: number, since: Date): Promise<boolean> {
  const msg = await prisma.message.findFirst({
    where: { leadId, fromMe: false, createdAt: { gt: since } },
    select: { id: true },
  })
  return msg != null
}

export async function runAdvanceSweep(): Promise<{ advanced: number; skipped: number }> {
  const now = new Date()
  let advanced = 0
  let skipped = 0

  // Leads cujo resumo atual é uma escada automática.
  const candidates = await prisma.lead.findMany({
    where: {
      statusSummaryId: { not: null },
      outcome: null, // ganho/perdido não sobe degrau
      statusSummary: {
        active: true,
        autoAdvanceOnDue: true,
        nextSummaryCode: { not: null },
      },
    },
    select: {
      id: true,
      statusSummaryAt: true,
      statusSummary: { select: { id: true, code: true, nextSummaryCode: true } },
    },
    take: MAX_PER_TICK,
    orderBy: { statusSummaryAt: 'asc' },
  })

  for (const lead of candidates) {
    const summary = lead.statusSummary
    if (!summary?.nextSummaryCode) continue

    // Só avança quando TODAS as atividades geradas por este resumo já venceram e
    // continuam pendentes. Se alguma foi concluída, o operador está trabalhando o
    // lead — não é o motor que decide o próximo passo.
    const open = await prisma.activity.findMany({
      where: {
        leadId: lead.id,
        status: 'pending',
        metadata: { path: '$.summaryId', equals: summary.id },
      },
      select: { id: true, scheduledAt: true },
    })

    if (open.length === 0) { skipped++; continue }
    const allDue = open.every((a) => a.scheduledAt <= now)
    if (!allDue) { skipped++; continue }

    const since = lead.statusSummaryAt ?? new Date(0)
    if (await leadRespondedSince(lead.id, since)) { skipped++; continue }

    // Um resumo que exige objeção não pode ser aplicado pelo cron sem uma: o
    // lead viraria Perdido sem motivo registrado e o relatório de objeções
    // ganharia um buraco justamente nas perdas automáticas. Sem objeção padrão
    // configurada, o lead fica onde está esperando decisão humana.
    const target = await prisma.statusSummary.findFirst({
      where: { code: summary.nextSummaryCode, active: true },
      select: { code: true, requireLossReason: true, defaultLossReasonId: true },
    })
    if (target?.requireLossReason && !target.defaultLossReasonId) {
      console.warn(
        `[status-summary-advance] lead ${lead.id}: ${target.code} exige objeção e não tem objeção padrão — ` +
        'avanço automático suspenso, precisa de decisão humana.',
      )
      skipped++
      continue
    }

    try {
      await applyStatusSummary({
        leadId: lead.id,
        code: summary.nextSummaryCode,
        source: 'auto_advance',
        note: `Avanço automático: ${summary.code} venceu sem resposta do lead`,
        // Sem operador na frente — as travas de painel não se aplicam.
        skipGuards: true,
      })
      advanced++
    } catch (e) {
      // Resumo de destino ausente/inativo no catálogo: não trava a varredura,
      // mas precisa aparecer no log pra alguém corrigir a configuração.
      console.error(
        `[status-summary-advance] lead ${lead.id}: falha ao aplicar ${summary.nextSummaryCode}:`,
        (e as Error).message,
      )
      skipped++
    }
  }

  return { advanced, skipped }
}

export function startStatusSummaryAdvanceJob(): void {
  if (_timer) return
  const tick = async () => {
    try {
      const { advanced } = await runAdvanceSweep()
      if (advanced > 0) console.log(`[status-summary-advance] ${advanced} leads avançaram de resumo`)
    } catch (e) {
      console.error('[status-summary-advance] erro na varredura:', (e as Error).message)
    }
  }
  // Atraso inicial pra não competir com o boot do servidor.
  setTimeout(() => {
    void tick()
    _timer = setInterval(() => void tick(), TICK_MS)
  }, 3 * 60 * 1000)
}
