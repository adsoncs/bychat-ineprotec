// src/services/vendedorDoLead.ts
//
// Quem VENDEU o lead (Lead.vendedorUserId), gravado no momento do Ganho.
//
// Sem equipe comercial marcada: quem está com o lead no Ganho (ou, sem
// responsável, quem marcou o Ganho).
// Com equipe comercial (Team.equipeComercial): quem está com o lead, se for da
// comercial; senão a última pessoa da comercial que esteve com ele
// (Lead.ultimoComercialUserId) — o lead pode ter ido para Financeiro ou
// Secretaria ainda em negociação, e a venda continua de quem negociou.

import { prisma } from '../lib/prisma.js'
import { usuariosComerciais } from '../lib/equipeComercial.js'

interface LeadDoGanho {
  assignedUserId: number | null
  ultimoComercialUserId: number | null
  outcomeBy: number | null
}

export function escolherVendedor(l: LeadDoGanho, comerciais: Set<number> | null): number | null {
  if (comerciais) {
    if (l.assignedUserId != null && comerciais.has(l.assignedUserId)) return l.assignedUserId
    if (l.ultimoComercialUserId != null) return l.ultimoComercialUserId
  }
  return l.assignedUserId ?? l.outcomeBy ?? null
}

/** Grava o vendedor dos leads que ACABARAM de virar Ganho e acerta as propostas ganhas deles. */
export async function gravarVendedorNoGanho(leadIds: number[]): Promise<void> {
  if (!leadIds.length) return
  const comerciais = await usuariosComerciais()
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, outcome: 'won' },
    select: { id: true, assignedUserId: true, ultimoComercialUserId: true, outcomeBy: true },
  })
  for (const l of leads) {
    const vendedor = escolherVendedor(l, comerciais)
    // SQL direto: um update de Lead passaria de novo pelos middlewares.
    await prisma.$executeRawUnsafe('UPDATE bychat_leads SET vendedorUserId = ?, vendedorEm = NOW(3) WHERE id = ?', vendedor, l.id)
    // Proposta ganha que ficou com alguém de fora da comercial (ou sem ninguém)
    // passa para o vendedor — é por ela que a comissão é paga.
    if (!comerciais || vendedor == null || !comerciais.has(vendedor)) continue
    const negs = await prisma.negotiation.findMany({
      where: { leadId: l.id, resultado: 'won', OR: [{ responsavelUserId: null }, { responsavelUserId: { notIn: [...comerciais] } }] },
      select: { id: true },
    })
    if (!negs.length) continue
    await prisma.negotiation.updateMany({ where: { id: { in: negs.map((n) => n.id) } }, data: { responsavelUserId: vendedor } })
    const { onNegotiationChanged } = await import('./commissions.js')
    for (const n of negs) await onNegotiationChanged(n.id).catch((e) => console.warn('[vendedor] comissão:', e?.message || e))
  }
}
