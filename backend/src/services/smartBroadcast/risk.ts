// src/services/smartBroadcast/risk.ts
//
// Nota de risco antes do disparo.
//
// Todos os sinais aqui já existiam espalhados — aquecimento do número, tamanho
// da lista, diversidade do texto, proporção de números inexistentes, quantos
// contatos já conversaram com a empresa. O que faltava era alguém somá-los e
// dizer, em uma frase, se vale apertar o botão.
//
// A nota não bloqueia nada por si: bloquear é papel da validação (que exige
// variável e variação) e do disjuntor (que corta durante o envio). Aqui o
// objetivo é que ninguém dispare 5.000 mensagens de um chip de três dias
// achando que está tudo bem.

import { prisma } from '../../lib/prisma.js'
import { resolvePool } from './senderPool.js'

export interface RiskFactor {
  key: string
  label: string
  /** Quanto tirou da nota (0 = não penalizou). */
  penalty: number
  detail: string
  severity: 'info' | 'warning' | 'danger'
}

export interface RiskReport {
  score: number                 // 0-100 (100 = tranquilo)
  level: 'baixo' | 'medio' | 'alto'
  headline: string
  factors: RiskFactor[]
}

export interface RiskInput {
  campaignId: number
  /** Vem do plano; evita recalcular a diversidade. */
  diversityRatio?: number
  notOnWhatsAppRatio?: number
  byAffinityRatio?: number
}

export async function assessRisk(input: RiskInput): Promise<RiskReport> {
  const campaign = await prisma.smartCampaign.findUnique({ where: { id: input.campaignId } })
  if (!campaign) throw new Error('Campanha não encontrada')

  const total = await prisma.smartCampaignRecipient.count({
    where: { campaignId: campaign.id, status: { in: ['pending', 'scheduled'] } },
  })
  const pool = await resolvePool(campaign.senderInstances)
  const factors: RiskFactor[] = []
  let score = 100

  // ── Aquecimento dos números ──
  const warming = pool.filter((p) => p.health.warmupDay <= 3)
  const capacity = pool.reduce((a, p) => a + p.health.dailyCap, 0)
  if (warming.length) {
    const penalty = warming.length === pool.length ? 25 : 12
    score -= penalty
    factors.push({
      key: 'warmup',
      label: 'Números ainda aquecendo',
      penalty,
      severity: warming.length === pool.length ? 'warning' : 'info',
      detail: `${warming.length} de ${pool.length} número(s) estão nos primeiros dias. O teto diário é baixo de propósito — a campanha vai demorar mais.`,
    })
  }

  // ── Volume x capacidade ──
  if (capacity > 0 && total > capacity * 10) {
    score -= 15
    factors.push({
      key: 'volume',
      label: 'Lista grande para a capacidade atual',
      penalty: 15,
      severity: 'warning',
      detail: `${total.toLocaleString('pt-BR')} destinatários para ${capacity}/dia somados: a campanha levaria mais de ${Math.ceil(total / capacity)} dias. Considere mais números ou uma lista menor.`,
    })
  }

  // ── Diversidade do texto ──
  const diversity = input.diversityRatio ?? 1
  if (diversity < 0.5) {
    const penalty = diversity < 0.2 ? 25 : 15
    score -= penalty
    factors.push({
      key: 'diversity',
      label: 'Mensagens muito parecidas entre si',
      penalty,
      severity: diversity < 0.2 ? 'danger' : 'warning',
      detail: `Só ${Math.round(diversity * 100)}% das mensagens sairiam diferentes. Texto repetido em massa é o padrão mais fácil de agrupar do outro lado.`,
    })
  }

  // ── Qualidade da lista ──
  const notFound = input.notOnWhatsAppRatio ?? 0
  if (notFound > 0.1) {
    const penalty = notFound > 0.25 ? 30 : 15
    score -= penalty
    factors.push({
      key: 'list_quality',
      label: 'Lista com números que não existem no WhatsApp',
      penalty,
      severity: notFound > 0.25 ? 'danger' : 'warning',
      detail: `${Math.round(notFound * 100)}% dos números não têm WhatsApp. Lista desatualizada é um dos sinais que mais derrubam chip.`,
    })
  }

  // ── Relacionamento prévio ──
  const affinity = input.byAffinityRatio ?? 0
  if (total >= 50 && affinity < 0.1 && !campaign.requireOptIn) {
    score -= 20
    factors.push({
      key: 'cold_list',
      label: 'Lista fria',
      penalty: 20,
      severity: 'warning',
      detail: `Só ${Math.round(affinity * 100)}% dos contatos já conversaram com algum dos seus números. Abordagem fria é a que mais gera denúncia — e denúncia é o que derruba o número.`,
    })
  }

  // ── Conformidade ──
  if (!campaign.legalBasis) {
    score -= 10
    factors.push({
      key: 'legal_basis',
      label: 'Sem base legal declarada',
      penalty: 10,
      severity: 'warning',
      detail: 'Declare por que esta lista pode ser contatada (consentimento, contrato ou legítimo interesse). É exigência da LGPD e fica registrado na campanha.',
    })
  }
  if (!campaign.optOutFooter) {
    score -= 8
    factors.push({
      key: 'opt_out',
      label: 'Sem rodapé de saída',
      penalty: 8,
      severity: 'info',
      detail: 'Uma linha com "responda SAIR" troca denúncia por opt-out. A denúncia custa o número; o opt-out custa um contato.',
    })
  }

  // ── Ritmo ──
  const pacing = (campaign.pacingConfig ?? {}) as { minDelayMs?: number }
  if ((pacing.minDelayMs ?? 40_000) < 20_000) {
    score -= 12
    factors.push({
      key: 'pacing',
      label: 'Ritmo acelerado',
      penalty: 12,
      severity: 'warning',
      detail: 'Intervalo mínimo abaixo de 20s. Só faz sentido em número antigo, com lista que pediu contato.',
    })
  }

  score = Math.max(0, Math.min(100, score))
  const level = score >= 75 ? 'baixo' : score >= 50 ? 'medio' : 'alto'
  const headline = level === 'baixo'
    ? 'Pode disparar: os sinais principais estão saudáveis.'
    : level === 'medio'
      ? 'Dá para disparar, mas há pontos que aumentam o risco do número.'
      : 'Risco alto de bloqueio. Corrija os pontos abaixo antes de disparar.'

  return { score, level, headline, factors }
}
