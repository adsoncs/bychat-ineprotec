// src/services/businessContext.ts
//
// "Contexto do Negócio" — dados do tenant (nome, ramo, oferta, ICP) que o
// cliente cadastra em Configurações > Inteligência. Alimenta o Lead Score
// preditivo por IA para que a análise entenda o negócio (ex.: beyond =
// agência de marketing; vantari = venda de cursos de pós-graduação).
//
// Persistido como Setting grp 'business'. O seed só GARANTE a existência
// das chaves (nunca sobrescreve valor digitado pelo cliente).

import { prisma } from '../lib/prisma.js'

export interface BusinessContextField {
  key: string
  label: string
  fieldType: 'text' | 'textarea'
  placeholder: string
}

/** Definição das chaves business.* (ordem = ordem no painel). */
export const BUSINESS_CONTEXT_FIELDS: BusinessContextField[] = [
  { key: 'business.company_name', label: 'Nome da empresa', fieldType: 'text', placeholder: 'Ex.: Agência Beyond' },
  { key: 'business.industry', label: 'Ramo / segmento de atuação', fieldType: 'text', placeholder: 'Ex.: Agência de marketing e publicidade' },
  { key: 'business.offer_description', label: 'O que vende (oferta principal)', fieldType: 'textarea', placeholder: 'Ex.: Gestão de tráfego pago, criação e estratégia de marketing para PMEs.' },
  { key: 'business.target_audience', label: 'Público-alvo / cliente ideal (ICP)', fieldType: 'textarea', placeholder: 'Ex.: PMEs de serviço com faturamento de R$50k–500k/mês que já investem em anúncios.' },
  { key: 'business.avg_ticket', label: 'Ticket médio', fieldType: 'text', placeholder: 'Ex.: R$ 3.500/mês' },
  { key: 'business.sales_cycle', label: 'Ciclo de venda típico', fieldType: 'text', placeholder: 'Ex.: 7 a 21 dias' },
  { key: 'business.good_lead_signals', label: 'Sinais de um BOM lead', fieldType: 'textarea', placeholder: 'Ex.: já investe em anúncios, tem urgência, decisor respondeu, orçamento compatível.' },
  { key: 'business.bad_lead_signals', label: 'Sinais de um lead RUIM', fieldType: 'textarea', placeholder: 'Ex.: busca serviço grátis, sem orçamento, fora do ICP, curioso/estudante.' },
]

const GROUP = 'business'

/** Garante que as chaves business.* existem (idempotente). NÃO sobrescreve
 * o valor — só mantém label/grp/fieldType atualizados. */
export async function seedBusinessContextSettings(): Promise<void> {
  for (const f of BUSINESS_CONTEXT_FIELDS) {
    await prisma.setting.upsert({
      where: { key: f.key },
      update: { label: f.label, grp: GROUP, fieldType: f.fieldType },
      create: { key: f.key, value: '', label: f.label, grp: GROUP, fieldType: f.fieldType },
    })
  }
}

function readStr(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.replace(/^"|"$/g, '').trim()
  return String(value).trim()
}

/** Lê o contexto do negócio como mapa key→valor. */
export async function loadBusinessContext(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { grp: GROUP } })
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = readStr(r.value)
  return out
}

/** Monta um bloco de texto estável (cacheável) descrevendo o negócio para
 * o prompt da IA. Retorna null se nada foi configurado. */
export async function buildBusinessContextBlock(): Promise<string | null> {
  const ctx = await loadBusinessContext()
  const lines: string[] = []
  for (const f of BUSINESS_CONTEXT_FIELDS) {
    const v = ctx[f.key]
    if (v) lines.push(`- ${f.label}: ${v}`)
  }
  if (lines.length === 0) return null
  return `CONTEXTO DO NEGÓCIO (use para entender se um lead tem fit com o que esta empresa vende):\n${lines.join('\n')}`
}
