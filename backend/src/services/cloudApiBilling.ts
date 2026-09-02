// src/services/cloudApiBilling.ts
// Acompanhamento e custo dos disparos WhatsApp Cloud API (oficial Meta).
//
// A Cloud API, ao contrário da Evolution (não-oficial), pode cobrar por mensagem
// entregue conforme a CATEGORIA (marketing/utility/authentication). Mensagens de
// atendimento ("service", dentro da janela de 24h) são gratuitas desde nov/2024.
// A Meta informa categoria/cobrança no webhook de status (statuses[].pricing e
// .conversation) — capturamos isso aqui para o painel e o cálculo de custo.

import { prisma } from '../lib/prisma.js'

// Preços de referência (USD por mensagem entregue) — Brasil. São estimativas;
// o admin pode sobrescrever via Setting `cloudapi.pricing.<category>`.
const DEFAULT_PRICING_BR: Record<string, number> = {
  marketing: 0.0625,
  utility: 0.0080,
  authentication: 0.0315,
  service: 0,
  referral_conversion: 0,
}

export async function getPricingTable(): Promise<Record<string, number>> {
  const table = { ...DEFAULT_PRICING_BR }
  try {
    const settings = await prisma.setting.findMany({ where: { key: { startsWith: 'cloudapi.pricing.' } } })
    for (const s of settings) {
      const cat = s.key.replace('cloudapi.pricing.', '').toLowerCase()
      const val = parseFloat(String(s.value).replace(/"/g, ''))
      if (!Number.isNaN(val)) table[cat] = val
    }
  } catch { /* sem settings → defaults */ }
  return table
}

export function estimateCost(category: string | null, billable: boolean, table: Record<string, number>): number {
  if (!billable || !category) return 0
  return table[category.toLowerCase()] ?? 0
}

/** Registra um disparo outbound no envio (cria o log; webhook completa depois). */
export async function recordOutbound(opts: {
  wamid: string | null
  connectionId: number | null
  leadId: number | null
  templateName?: string | null
}): Promise<void> {
  if (!opts.wamid) return
  try {
    await prisma.cloudApiMessageLog.upsert({
      where: { wamid: opts.wamid },
      update: {
        cloudApiConnectionId: opts.connectionId ?? undefined,
        leadId: opts.leadId ?? undefined,
        templateName: opts.templateName ?? undefined,
      },
      create: {
        wamid: opts.wamid,
        cloudApiConnectionId: opts.connectionId,
        leadId: opts.leadId,
        templateName: opts.templateName ?? null,
        direction: 'outbound',
        status: 'sent',
      },
    })
  } catch { /* não bloqueia o envio se o log falhar */ }
}

/** Atualiza o log a partir do webhook de status (categoria/cobrança/status/erro). */
export async function applyStatusToLog(wamid: string, opts: {
  status?: string
  category?: string | null
  billable?: boolean
  pricingModel?: string | null
  errorCode?: string | null
  errorTitle?: string | null
}): Promise<void> {
  if (!wamid) return
  const data: any = {}
  if (opts.status) data.status = opts.status
  if (opts.category !== undefined) data.category = opts.category
  if (opts.billable !== undefined) data.billable = opts.billable
  if (opts.pricingModel !== undefined) data.pricingModel = opts.pricingModel
  if (opts.errorCode !== undefined) data.errorCode = opts.errorCode
  if (opts.errorTitle !== undefined) data.errorTitle = opts.errorTitle
  try {
    await prisma.cloudApiMessageLog.upsert({
      where: { wamid },
      update: data,
      create: {
        wamid,
        direction: 'outbound',
        status: opts.status || 'sent',
        category: opts.category ?? null,
        billable: opts.billable ?? false,
        pricingModel: opts.pricingModel ?? null,
        errorCode: opts.errorCode ?? null,
        errorTitle: opts.errorTitle ?? null,
      },
    })
  } catch { /* idem */ }
}

export interface DispatchReport {
  period: { from: string; to: string }
  totals: { sent: number; delivered: number; read: number; failed: number; billable: number; estimatedCostUsd: number }
  byCategory: Array<{ category: string; count: number; billable: number; estimatedCostUsd: number }>
  byConnection: Array<{ connectionId: number | null; count: number; sent: number; delivered: number; read: number; failed: number; billable: number; estimatedCostUsd: number }>
  // `connectionId`: por qual número saiu. O log sempre soube, mas a serialização
  // não devolvia — e a lista de recentes, vendo "todos os números", misturava os
  // envios sem dizer de quem era cada linha.
  recent: Array<{ wamid: string; status: string; category: string | null; billable: boolean; templateName: string | null; leadId: number | null; connectionId: number | null; createdAt: string }>
}

/** Relatório agregado de disparos para o painel. */
export async function buildDispatchReport(opts: { connectionId?: number | null; from: Date; to: Date }): Promise<DispatchReport> {
  const where: any = { createdAt: { gte: opts.from, lte: opts.to } }
  if (opts.connectionId) where.cloudApiConnectionId = opts.connectionId

  const [logs, table] = await Promise.all([
    prisma.cloudApiMessageLog.findMany({ where, orderBy: { createdAt: 'desc' } }),
    getPricingTable(),
  ])

  const totals = { sent: 0, delivered: 0, read: 0, failed: 0, billable: 0, estimatedCostUsd: 0 }
  const catMap = new Map<string, { count: number; billable: number; estimatedCostUsd: number }>()
  type ConnAgg = { connectionId: number | null; count: number; sent: number; delivered: number; read: number; failed: number; billable: number; estimatedCostUsd: number }
  const connMap = new Map<number | null, ConnAgg>()

  for (const l of logs) {
    if (l.status === 'sent') totals.sent++
    else if (l.status === 'delivered') totals.delivered++
    else if (l.status === 'read') totals.read++
    else if (l.status === 'failed') totals.failed++
    const cost = estimateCost(l.category, l.billable, table)
    if (l.billable) totals.billable++
    totals.estimatedCostUsd += cost
    const key = l.category || 'service'
    const c = catMap.get(key) || { count: 0, billable: 0, estimatedCostUsd: 0 }
    c.count++; if (l.billable) c.billable++; c.estimatedCostUsd += cost
    catMap.set(key, c)
    // Quebra por número/conexão (controle por número quando há mais de um)
    const cid = l.cloudApiConnectionId ?? null
    const ca = connMap.get(cid) || { connectionId: cid, count: 0, sent: 0, delivered: 0, read: 0, failed: 0, billable: 0, estimatedCostUsd: 0 }
    ca.count++
    if (l.status === 'sent') ca.sent++
    else if (l.status === 'delivered') ca.delivered++
    else if (l.status === 'read') ca.read++
    else if (l.status === 'failed') ca.failed++
    if (l.billable) ca.billable++
    ca.estimatedCostUsd += cost
    connMap.set(cid, ca)
  }
  totals.estimatedCostUsd = Math.round(totals.estimatedCostUsd * 1e6) / 1e6

  return {
    period: { from: opts.from.toISOString(), to: opts.to.toISOString() },
    totals,
    byCategory: [...catMap.entries()].map(([category, v]) => ({
      category, count: v.count, billable: v.billable,
      estimatedCostUsd: Math.round(v.estimatedCostUsd * 1e6) / 1e6,
    })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byConnection: [...connMap.values()].map(v => ({
      ...v, estimatedCostUsd: Math.round(v.estimatedCostUsd * 1e6) / 1e6,
    })).sort((a, b) => b.count - a.count),
    recent: logs.slice(0, 50).map(l => ({
      wamid: l.wamid, status: l.status, category: l.category, billable: l.billable,
      templateName: l.templateName, leadId: l.leadId,
      connectionId: l.cloudApiConnectionId ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  }
}
