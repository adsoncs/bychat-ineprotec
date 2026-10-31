// src/services/leadStaleSweep.ts
//
// Lead parado: quem não dá sinal de vida há dias precisa sair da etapa inicial.
//
// O encerramento por inatividade (services/inactivity.ts) NÃO serve para isso:
// ele só varre leads com `chatbotId` preenchido — no beyond, 2 de 338 — porque
// nasceu para desligar conversa de chatbot. Lead que veio de formulário ou da
// Meta e foi atendido por gente nunca era varrido, então ficava parado em
// "Contatado" para sempre.
//
// Esta varredura é deliberadamente burra e silenciosa:
//   · NÃO envia mensagem nenhuma (não é retomada, é organização de funil);
//   · NÃO encerra a conversa nem marca o lead como concluído;
//   · NÃO decide a etapa de destino — só emite `lead.stale`, e quem decide o
//     que fazer é um fluxo no painel. As chaves de etapa mudam por tenant;
//     deixar isso no código seria fixar no motor o que é regra de negócio.
//
// Vigência: na primeira execução grava a data de início e passa a considerar
// apenas leads cuja última atividade seja POSTERIOR a ela. Sem isso, ligar o
// recurso moveria de uma vez todo o acervo parado — dezenas de leads mudando de
// etapa no mesmo minuto, sem ninguém entender por quê.

import { prisma } from '../lib/prisma.js'
import { eventBus } from '../lib/eventBus.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'

/** Dias sem atividade para o lead ser considerado parado. */
const DIAS_PARADO = 3
/** Intervalo entre varreduras. */
const INTERVALO_MS = 6 * 60 * 60 * 1000
/** Teto por rodada: evita uma enxurrada de eventos se algo escapar. */
const MAX_POR_RODADA = 100

const CHAVE_VIGENCIA = 'leadStale.vigenciaDesde'

let handle: ReturnType<typeof setInterval> | null = null

/** Data a partir da qual a varredura vale. Grava na primeira execução. */
async function vigenciaDesde(): Promise<Date> {
  const existente = await prisma.setting.findUnique({ where: { key: CHAVE_VIGENCIA } }).catch(() => null)
  if (existente?.value) {
    const d = new Date(String(existente.value).replace(/^"|"$/g, ''))
    if (!isNaN(d.getTime())) return d
  }
  const agora = new Date()
  await prisma.setting.upsert({
    where: { key: CHAVE_VIGENCIA },
    create: {
      key: CHAVE_VIGENCIA,
      value: agora.toISOString() as never,
      label: 'Lead parado: vigência da varredura',
      grp: 'system',
      fieldType: 'text',
    },
    update: { value: agora.toISOString() as never },
  }).catch(() => {})
  console.log(`[leadStale] vigência iniciada em ${agora.toISOString()} — o acervo parado antes disso não é movido`)
  return agora
}

/**
 * @param opts.somenteLeads restringe a varredura a estes leads. Existe para
 * TESTE: sem isso, exercitar a varredura num banco de produção alcança lead de
 * verdade — foi o que aconteceu na primeira execução do teste, que moveu 6 leads
 * reais para Nutrição (revertidos). Em produção o parâmetro nunca é passado.
 */
export async function varrerLeadsParados(opts?: { somenteLeads?: number[] }): Promise<{ avaliados: number; sinalizados: number }> {
  const vigencia = await vigenciaDesde()
  const limite = new Date(Date.now() - DIAS_PARADO * 86400000)

  const parados = await prisma.lead.findMany({
    where: {
      // Sem atividade há DIAS_PARADO, mas já dentro da vigência.
      lastActivityAt: { not: null, lt: limite, gte: vigencia },
      outcome: null,   // ciclo já encerrado (ganho/perdido) não se mexe
      isGroup: false,  // grupo de WhatsApp não é pessoa
      ...(opts?.somenteLeads?.length ? { id: { in: opts.somenteLeads } } : {}),
    },
    orderBy: { lastActivityAt: 'asc' },
    take: MAX_POR_RODADA,
    // A marca de "já sinalizei este" vai no formData (como _slotsOfferedAt e
    // _inactivityNotifyCount já fazem) em vez de uma coluna nova: uma migration
    // em 12 ambientes por um carimbo não se paga.
    select: { id: true, status: true, funnelId: true, chatbotId: true, lastActivityAt: true, formData: true },
  })
  if (!parados.length) return { avaliados: 0, sinalizados: 0 }

  // Quem tem reunião marcada no futuro não está parado — está esperando o dia.
  const comReuniao = new Set(
    (await prisma.booking.findMany({
      where: { leadId: { in: parados.map((l) => l.id) }, status: { notIn: ['cancelled', 'no_show', 'rescheduled'] }, startAt: { gt: new Date() } },
      select: { leadId: true },
    }).catch(() => [])).map((b) => b.leadId as number),
  )

  let sinalizados = 0
  for (const lead of parados) {
    if (comReuniao.has(lead.id)) continue
    const fd = (lead.formData || {}) as Record<string, unknown>
    if (fd._staleSignaledAt) continue // já sinalizado numa rodada anterior

    const dias = Math.floor((Date.now() - (lead.lastActivityAt as Date).getTime()) / 86400000)
    await prisma.lead.update({
      where: { id: lead.id },
      data: { formData: { ...fd, _staleSignaledAt: new Date().toISOString() } as never },
    }).catch(() => {})

    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.INACTIVITY_DETECTED,
      category: 'system',
      title: `Sem resposta há ${dias} dias`,
      source: 'lead_stale_sweep',
      actorType: 'system',
      metadata: { dias, etapa: lead.status },
    })

    eventBus.emitDomain({
      type: 'lead.stale',
      leadId: lead.id,
      chatbotId: lead.chatbotId ?? undefined,
      funnelId: lead.funnelId ?? undefined,
      payload: { dias, metadata: { dias, etapa: lead.status, source: 'lead_stale_sweep' } },
      timestamp: new Date(),
    })
    sinalizados++
  }

  if (sinalizados) console.log(`[leadStale] ${sinalizados} lead(s) parados há ${DIAS_PARADO}+ dias sinalizados`)
  return { avaliados: parados.length, sinalizados }
}

export function startLeadStaleSweep(): void {
  if (handle) return
  // Primeira passada alguns minutos depois do boot: não competir com a subida.
  setTimeout(() => { varrerLeadsParados().catch((e) => console.error('[leadStale]', e)) }, 5 * 60 * 1000).unref?.()
  handle = setInterval(() => { varrerLeadsParados().catch((e) => console.error('[leadStale]', e)) }, INTERVALO_MS)
  handle.unref?.()
  console.log(`[leadStale] varredura de lead parado ativa (a cada ${INTERVALO_MS / 3600000}h, ${DIAS_PARADO} dias sem atividade)`)
}
