// src/services/metaResultados.ts
//
// "Resultado" de cada campanha/conjunto/anúncio como o Gerenciador de Anúncios
// mostra. Sem isto o relatório não bate com a Meta (fabad, 17/11/2026):
//
// 1. A Meta devolve vários tipos de ação SOBREPOSTOS para o mesmo evento (o
//    lead do formulário instantâneo também dispara o pixel; `lead` soma os
//    dois). Vale o PRIMEIRO tipo que existir na ordem de prioridade — nunca
//    somar, nunca pegar o maior.
// 2. O resultado depende do que o conjunto persegue: destino de mensagem
//    (WhatsApp/Messenger/Direct) = conversa, sobre qualquer outra regra;
//    senão o optimization_goal; conversão do site = o evento do
//    promoted_object (conversão personalizada ou evento padrão do pixel).
//
// O objetivo de cada conjunto é lido na coleta da madrugada (sync-meta) e
// guardado na Setting `meta.objetivos`; o relatório só lê o que está gravado.

import { prisma } from '../lib/prisma.js'

export type TipoResultado = 'lead' | 'conversa' | 'pixel' | 'outro'
export interface ObjetivoMeta { tipo: TipoResultado; alvo: string | null }
export interface ObjetivosMeta {
  atualizadoEm: string | null
  campanhas: Record<string, ObjetivoMeta>
  conjuntos: Record<string, ObjetivoMeta>
}

const CHAVE = 'meta.objetivos'

const DESTINOS_MENSAGEM = new Set(['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT', 'MESSAGING_APPS'])
const TIPO_POR_OTIMIZACAO: Record<string, TipoResultado> = {
  LEAD_GENERATION: 'lead', QUALITY_LEAD: 'lead',
  QUALITY_CALL: 'conversa', CONVERSATIONS: 'conversa', REPLIES: 'conversa',
  OFFSITE_CONVERSIONS: 'pixel', VALUE: 'pixel',
}
const EVENTO_DO_PIXEL: Record<string, string> = {
  LEAD: 'lead', SCHEDULE: 'schedule', CONTACT: 'contact',
  COMPLETE_REGISTRATION: 'complete_registration', SUBMIT_APPLICATION: 'submit_application',
  SUBSCRIBE: 'subscribe', PURCHASE: 'purchase',
}

/** Campos pedidos à Meta em /act_X/adsets. */
export const CAMPOS_DO_CONJUNTO = 'id,campaign_id,optimization_goal,destination_type,promoted_object'

export function objetivoDoConjunto(a: { optimization_goal?: string; destination_type?: string; promoted_object?: any }): ObjetivoMeta {
  if (a.destination_type && DESTINOS_MENSAGEM.has(a.destination_type)) return { tipo: 'conversa', alvo: null }
  const tipo = TIPO_POR_OTIMIZACAO[a.optimization_goal || ''] || 'outro'
  const po = a.promoted_object || {}
  let alvo: string | null = null
  if (po.custom_conversion_id) alvo = `offsite_conversion.custom.${po.custom_conversion_id}`
  else if (po.custom_event_type && EVENTO_DO_PIXEL[po.custom_event_type]) alvo = `offsite_conversion.fb_pixel_${EVENTO_DO_PIXEL[po.custom_event_type]}`
  return { tipo, alvo }
}

/** Objetivo da campanha: o que mais aparece entre os conjuntos dela. */
export function objetivoDaCampanha(dos: ObjetivoMeta[]): ObjetivoMeta | null {
  if (!dos.length) return null
  const conta = new Map<string, { o: ObjetivoMeta; n: number }>()
  for (const o of dos) {
    const k = `${o.tipo}|${o.alvo ?? ''}`
    const atual = conta.get(k)
    if (atual) atual.n++
    else conta.set(k, { o, n: 1 })
  }
  return [...conta.values()].sort((x, y) => y.n - x.n)[0].o
}

function n(actions: unknown, chave: string): number {
  if (!actions || typeof actions !== 'object') return 0
  const v = Number((actions as Record<string, unknown>)[chave])
  return Number.isFinite(v) ? v : 0
}

/** Leads na ordem de prioridade: o primeiro tipo que existir. */
export function leadsDaMeta(actions: unknown): number {
  return n(actions, 'onsite_conversion.lead_grouped') || n(actions, 'offsite_conversion.fb_pixel_lead') || n(actions, 'lead')
}

export function conversasDaMeta(actions: unknown): number {
  return n(actions, 'onsite_conversion.messaging_conversation_started_7d')
}

/**
 * Sem objetivo gravado (campanha apagada antes da 1ª leitura dos conjuntos):
 * formulário agrupado presente = lead; só conversa = conversa; senão lead.
 */
function objetivoPresumido(actions: unknown): ObjetivoMeta {
  if (n(actions, 'onsite_conversion.lead_grouped')) return { tipo: 'lead', alvo: null }
  if (conversasDaMeta(actions)) return { tipo: 'conversa', alvo: null }
  return { tipo: 'lead', alvo: null }
}

export function resultadoDaMeta(actions: unknown, obj: ObjetivoMeta | null | undefined): { tipo: TipoResultado; valor: number } {
  const o = obj ?? objetivoPresumido(actions)
  if (o.tipo === 'conversa') return { tipo: 'conversa', valor: conversasDaMeta(actions) }
  if (o.tipo === 'lead') return { tipo: 'lead', valor: leadsDaMeta(actions) }
  if (o.tipo === 'pixel') return { tipo: 'pixel', valor: o.alvo ? n(actions, o.alvo) : n(actions, 'offsite_conversion.fb_pixel_lead') }
  return { tipo: 'outro', valor: 0 }
}

export async function lerObjetivos(): Promise<ObjetivosMeta> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? null
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  return {
    atualizadoEm: v?.atualizadoEm ?? null,
    campanhas: v?.campanhas && typeof v.campanhas === 'object' ? v.campanhas : {},
    conjuntos: v?.conjuntos && typeof v.conjuntos === 'object' ? v.conjuntos : {},
  }
}

/**
 * Grava os objetivos lidos agora por cima dos antigos (campanha que sumiu da
 * listagem continua com o objetivo que tinha — o histórico dela segue certo).
 */
export async function gravarObjetivos(conjuntos: Array<{ id: string; campaign_id: string } & Parameters<typeof objetivoDoConjunto>[0]>): Promise<number> {
  const atual = await lerObjetivos()
  const porCampanha = new Map<string, ObjetivoMeta[]>()
  for (const c of conjuntos) {
    if (!c.id || !c.campaign_id) continue
    const o = objetivoDoConjunto(c)
    atual.conjuntos[c.id] = o
    porCampanha.set(c.campaign_id, [...(porCampanha.get(c.campaign_id) ?? []), o])
  }
  for (const [cid, os] of porCampanha) {
    const o = objetivoDaCampanha(os)
    if (o) atual.campanhas[cid] = o
  }
  const value = { atualizadoEm: new Date().toISOString(), campanhas: atual.campanhas, conjuntos: atual.conjuntos }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: value as any, label: 'Meta: resultado de cada campanha/conjunto (lido na coleta)', grp: 'meta', fieldType: 'json' },
    update: { value: value as any },
  })
  return porCampanha.size
}

/** Ontem no fuso de Brasília (YYYY-MM-DD): o dia corrente ainda muda e não entra. */
export function ontemNoBrasil(agora = new Date()): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
  const d = new Date(hoje + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
