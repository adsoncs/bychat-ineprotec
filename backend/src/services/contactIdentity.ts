// src/services/contactIdentity.ts
//
// Resolvedor ÚNICO de identidade de contato para mensagens recebidas (inbound),
// usado por Cloud API e Evolution. Substitui as 3 lógicas divergentes que
// fragmentavam o mesmo contato em vários leads.
//
// Ordem de resolução (forte → fraca):
//   1) waLid exato        — identidade forte do WhatsApp (quando veio @lid)
//   2) phoneKey canônico  — match EXATO do telefone normalizado (lib/phone.ts)
//   3) pushName (1º nome) — SÓ quando não há telefone (contato puro-LID), janela
//                           recente e lead ainda sem LID. Ponte best-effort.
// NÃO cria lead — apenas resolve. O caller decide criar (com os dados corretos).

import { prisma } from '../lib/prisma.js'
import { phoneKey, isLikelyLid } from '../lib/phone.js'

export interface InboundContact {
  phone?: string | null      // número bruto, qualquer formato
  waLid?: string | null      // JID @lid, se a mensagem veio assim
  pushName?: string | null
}

export interface ResolvedContact {
  lead: { id: number; whatsapp: string; waLid: string | null; phoneKey: string | null } | null
  matchedBy: 'walid' | 'phoneKey' | 'pushName' | null
  phoneKey: string | null    // chave canônica do telefone (ou null se puro-LID)
}

const SELECT = { id: true, whatsapp: true, waLid: true, phoneKey: true } as const

export async function resolveLeadForContact(c: InboundContact): Promise<ResolvedContact> {
  const pk = phoneKey(c.phone)
  const lid = c.waLid && isLikelyLid(c.waLid) ? c.waLid : null

  // 1) waLid exato
  if (lid) {
    const byLid = await prisma.lead.findFirst({ where: { waLid: lid }, orderBy: { createdAt: 'desc' }, select: SELECT })
    if (byLid) return { lead: byLid, matchedBy: 'walid', phoneKey: pk }
  }

  // 2) phoneKey canônico exato
  if (pk) {
    const byKey = await prisma.lead.findFirst({ where: { phoneKey: pk }, orderBy: { createdAt: 'desc' }, select: SELECT })
    if (byKey) return { lead: byKey, matchedBy: 'phoneKey', phoneKey: pk }
  }

  // 3) pushName — apenas para contato puro-LID (sem telefone resolvido)
  if (!pk && lid && c.pushName) {
    const first = c.pushName.trim().split(/\s+/)[0]
    if (first && first.length >= 3) {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      const byName = await prisma.lead.findFirst({
        where: { nome: { startsWith: first }, waLid: null, createdAt: { gte: cutoff } },
        orderBy: { createdAt: 'desc' },
        select: SELECT,
      })
      if (byName) return { lead: byName, matchedBy: 'pushName', phoneKey: pk }
    }
  }

  return { lead: null, matchedBy: null, phoneKey: pk }
}

// Após casar um lead, garante que ele carregue a identidade canônica (backfill
// preguiçoso de leads legados + grava o LID recém-descoberto). Idempotente.
export async function reconcileLeadIdentity(
  leadId: number,
  current: { whatsapp: string; waLid: string | null; phoneKey: string | null },
  incoming: { phone?: string | null; waLid?: string | null },
): Promise<void> {
  const data: Record<string, unknown> = {}
  const pk = phoneKey(incoming.phone) ?? phoneKey(current.whatsapp)
  if (pk && pk !== current.phoneKey) data.phoneKey = pk
  // Grava o LID se o lead ainda não tem e a mensagem trouxe um.
  if (incoming.waLid && isLikelyLid(incoming.waLid) && !current.waLid) data.waLid = incoming.waLid
  // Se o lead estava SEM telefone (puro-LID) e agora chegou um número real, adota.
  if ((!current.whatsapp || isLikelyLid(current.whatsapp)) && incoming.phone && phoneKey(incoming.phone)) {
    data.whatsapp = phoneKey(incoming.phone)
  }
  if (Object.keys(data).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data }).catch(() => {})
  }
}
