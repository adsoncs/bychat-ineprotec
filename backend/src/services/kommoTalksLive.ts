// src/services/kommoTalksLive.ts
//
// Mantém o histórico da Kommo vivo enquanto o time ainda atende por lá.
//
// A varredura de 25/08 trouxe o passado (105 mil mensagens); isto trata do
// presente. São dois caminhos deliberadamente redundantes:
//
//   1. WEBHOOK `add_message` — a Kommo avisa em segundos. É o caminho normal.
//   2. REDE DE SEGURANÇA — de tempos em tempos, `/api/v4/events` diz quais
//      conversas tiveram mensagem desde o último ciclo. Cobre webhook perdido,
//      janela de deploy, e o dia em que alguém desativar o hook na Kommo sem
//      avisar. Sem isso, um webhook que para de chegar é indistinguível de um
//      dia sem atendimento — silêncio parece sucesso.
//
// Os dois desembocam no mesmo `importarTalk`, que é idempotente por
// `externalId`: reprocessar uma conversa não duplica nada e só grava o que é
// novo. Por isso a redundância é barata.

import { importarTalk } from './kommoTalks.js'
import { getKommoChatsConfig, kommoFetch, type KommoConfig } from '../lib/kommoClient.js'
import { prisma } from '../lib/prisma.js'

/** De quanto em quanto tempo a rede de segurança roda. */
const CICLO_MIN = parseInt(process.env.KOMMO_TALKS_LIVE_MIN || '5', 10)
/**
 * Teto de quanto o ciclo olha para trás quando o cursor está velho (serviço
 * parado a noite toda, por exemplo). Sem teto, um cursor de semanas atrás
 * pediria dezenas de milhares de eventos de uma vez.
 */
const JANELA_MAX_H = 24
/**
 * O lead pode ainda não existir aqui: a conversa começa na Kommo no mesmo
 * minuto em que o lead é criado lá, e o sync de leads roda a cada 15 min. Em
 * vez de perder a conversa, ela espera o lead aparecer.
 */
const RETRY_MAX = 25
const CHAVE_CURSOR = 'kommo.talks_live_cursor'

/** Conversas sendo processadas agora — webhook e ciclo não se atropelam. */
const emVoo = new Set<number>()
/** talkId → tentativas já feitas, para a conversa cujo lead ainda não chegou. */
const aguardandoLead = new Map<number, number>()

async function lerCursor(): Promise<number | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: CHAVE_CURSOR } })
    const v = (row?.value as any)
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

async function gravarCursor(unix: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHAVE_CURSOR },
    create: {
      key: CHAVE_CURSOR,
      value: unix,
      label: 'Kommo — último evento de conversa processado',
      grp: 'kommo',
      fieldType: 'number',
    },
    update: { value: unix },
  })
}

/**
 * Importa uma conversa agora. Devolve o que aconteceu, para quem chamou poder
 * logar — o webhook não tem para quem responder além do log.
 */
export async function sincronizarTalk(
  talkId: number,
  cfg?: KommoConfig,
): Promise<'importado' | 'sem-lead' | 'nada' | 'erro'> {
  if (!Number.isFinite(talkId) || talkId <= 0) return 'nada'
  if (emVoo.has(talkId)) return 'nada'
  emVoo.add(talkId)
  try {
    const r = await importarTalk(talkId, { cfg })
    if (r.pulou === 'sem-lead') {
      const tentativas = (aguardandoLead.get(talkId) ?? 0) + 1
      if (tentativas <= RETRY_MAX) aguardandoLead.set(talkId, tentativas)
      else aguardandoLead.delete(talkId)
      return 'sem-lead'
    }
    aguardandoLead.delete(talkId)
    if (r.novas > 0) console.log(`[kommo-live] talk ${talkId}: +${r.novas} mensagem(ns) no lead ${r.leadId}`)
    return r.novas > 0 ? 'importado' : 'nada'
  } catch (e: any) {
    console.warn(`[kommo-live] talk ${talkId} falhou: ${e?.message || e}`)
    return 'erro'
  } finally {
    emVoo.delete(talkId)
  }
}

/**
 * Descobre, por `/events`, quais conversas tiveram mensagem desde o cursor.
 *
 * O evento não traz o texto — `value_after` é só `{id, origin, talk_id}` — mas
 * é exatamente o que se precisa aqui: o id da conversa a reimportar.
 */
async function talksComMensagemDesde(desde: number, cfg: KommoConfig): Promise<{ ids: number[]; ultimo: number }> {
  const ids = new Set<number>()
  let ultimo = desde
  const tipos = 'filter[type][]=incoming_chat_message&filter[type][]=outgoing_chat_message'
  for (let page = 1; page <= 8; page++) {
    const d = await kommoFetch(`/events?${tipos}&filter[created_at][from]=${desde}&limit=250&page=${page}`, cfg)
    const eventos = d?._embedded?.events ?? []
    for (const ev of eventos) {
      // `value_after` é uma LISTA de envelopes: [{ message: { id, origin,
      // talk_id } }]. Ler `.talk_id` na raiz devolve undefined em todo evento —
      // e o ciclo passa a relatar "0 conversas com movimento" para sempre, que
      // é indistinguível de um dia sem atendimento.
      const bruto = ev?.value_after
      const itens = Array.isArray(bruto) ? bruto : bruto ? [bruto] : []
      for (const item of itens) {
        const tid = Number((item as any)?.message?.talk_id ?? (item as any)?.talk_id)
        if (Number.isFinite(tid) && tid > 0) ids.add(tid)
      }
      const t = Number(ev?.created_at)
      if (Number.isFinite(t) && t > ultimo) ultimo = t
    }
    if (!d?._links?.next) break
  }
  return { ids: Array.from(ids), ultimo }
}

/** Um ciclo da rede de segurança. Exportado para dar para rodar à mão. */
export async function cicloTalksLive(): Promise<{ conversas: number; importadas: number; pendentes: number }> {
  const cfg = await getKommoChatsConfig()
  const agora = Math.floor(Date.now() / 1000)
  const cursor = await lerCursor()
  const piso = agora - JANELA_MAX_H * 3600
  const desde = Math.max(cursor ?? agora - CICLO_MIN * 60 * 3, piso)

  const { ids, ultimo } = await talksComMensagemDesde(desde, cfg)

  // As que estão esperando o lead entram no mesmo ciclo: o sync de leads roda a
  // cada 15 min, então em algum ciclo o destino aparece.
  for (const id of aguardandoLead.keys()) if (!ids.includes(id)) ids.push(id)

  let importadas = 0
  for (const id of ids) {
    const r = await sincronizarTalk(id, cfg)
    if (r === 'importado') importadas++
  }

  // O cursor só anda até o último evento visto. Avançar para "agora" perderia
  // o que chegou entre a consulta e este ponto.
  if (ultimo > (cursor ?? 0)) await gravarCursor(ultimo)

  if (ids.length) {
    console.log(`[kommo-live] ciclo: ${ids.length} conversa(s) com movimento · ${importadas} com mensagem nova · ${aguardandoLead.size} esperando lead`)
  }
  return { conversas: ids.length, importadas, pendentes: aguardandoLead.size }
}

/** Liga a rede de segurança. O webhook continua sendo o caminho rápido. */
export function startKommoTalksLive(): void {
  const tick = async () => {
    try {
      const cfg = await getKommoChatsConfig()
      // Sem o token de escopo de chats não adianta tentar: seria um 403 a cada
      // ciclo, para sempre.
      if (!cfg.subdomain || !cfg.token) return
      await cicloTalksLive()
    } catch (err: any) {
      console.warn('[kommo-live] ciclo falhou:', err?.message || err)
    }
  }
  setInterval(tick, CICLO_MIN * 60_000)
  // Um ciclo logo no start recupera o que passou enquanto o serviço estava fora.
  setTimeout(tick, 20_000)
  console.log(`[kommo-live] rede de segurança ativa (a cada ${CICLO_MIN} min)`)
}
