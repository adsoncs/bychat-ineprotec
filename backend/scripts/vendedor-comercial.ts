// scripts/vendedor-comercial.ts
//
// Depois de marcar as equipes comerciais (Configurações › Equipes), refaz o
// passado pelo histórico do lead:
//   1. Lead.ultimoComercialUserId — a última pessoa de equipe comercial que
//      esteve com o lead (trocas de responsável, inscrição, propostas e o
//      responsável atual);
//   2. leads GANHOS cujo vendedor não é da comercial — passam para a última
//      pessoa da comercial que esteve com o lead ATÉ o Ganho, e as propostas
//      ganhas que estão com alguém de fora da comercial vão junto (a comissão
//      é refeita; comissão paga não muda).
// Sem `--gravar` só LISTA o que faria.
//
// Uso:
//   cd backend && npx tsx --env-file=.env scripts/vendedor-comercial.ts            # confere
//   cd backend && npx tsx --env-file=.env scripts/vendedor-comercial.ts --gravar   # grava

import { prisma } from '../src/lib/prisma.js'
import { usuariosComerciais } from '../src/lib/equipeComercial.js'

const GRAVAR = process.argv.includes('--gravar')
type Ponto = { t: number; userId: number }

async function main() {
  const comerciais = await usuariosComerciais()
  if (!comerciais?.size) {
    console.log('Nenhuma equipe comercial marcada (ou sem membros) — nada a fazer.')
    return
  }
  const nomes = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const nome = (id: number | null) => (id == null ? '—' : nomes.get(id) ?? `#${id}`)

  // Linha do tempo de responsáveis por lead.
  const pontos = new Map<number, Ponto[]>()
  const add = (leadId: number | null, t: Date | null, userId: unknown) => {
    const u = Number(userId)
    if (leadId == null || !t || !Number.isInteger(u) || u <= 0) return
    const l = pontos.get(leadId) ?? []
    l.push({ t: t.getTime(), userId: u })
    pontos.set(leadId, l)
  }
  const eventos = await prisma.leadEvent.findMany({
    where: { type: { in: ['operator_assigned', 'OPERATOR_ASSIGNED'] as any } },
    select: { leadId: true, metadata: true, createdAt: true },
  })
  for (const e of eventos) {
    const m = (e.metadata ?? {}) as Record<string, unknown>
    // Quem saía estava com o lead até ali; quem entrou, dali em diante.
    add(e.leadId, new Date(e.createdAt.getTime() - 1), m.previousAssignedUserId ?? m.donoAnterior)
    add(e.leadId, e.createdAt, m.newAssignedUserId)
  }
  for (const r of await prisma.enrollmentRegistration.findMany({ where: { vendedorUserId: { not: null }, leadId: { not: null } }, select: { leadId: true, vendedorUserId: true, createdAt: true } })) {
    add(r.leadId, r.createdAt, r.vendedorUserId)
  }
  for (const n of await prisma.negotiation.findMany({ where: { responsavelUserId: { not: null } }, select: { leadId: true, responsavelUserId: true, createdAt: true } })) {
    add(n.leadId, n.createdAt, n.responsavelUserId)
  }

  const leads = await prisma.lead.findMany({
    where: { OR: [{ id: { in: [...pontos.keys()] } }, { assignedUserId: { in: [...comerciais] } }, { outcome: 'won' }] },
    select: { id: true, nome: true, assignedUserId: true, ultimoComercialUserId: true, outcome: true, outcomeAt: true, vendedorUserId: true },
  })
  const ultimoAte = (leadId: number, ate: number) => {
    const ps = (pontos.get(leadId) ?? []).filter((p) => p.t <= ate && comerciais.has(p.userId)).sort((a, b) => a.t - b.t)
    return ps.length ? ps[ps.length - 1]!.userId : null
  }

  let ultimos = 0
  const trocas: { id: number; nome: string; de: number | null; para: number }[] = []
  for (const l of leads) {
    // O responsável atual é o ponto mais recente da linha do tempo.
    if (l.assignedUserId != null) add(l.id, new Date(), l.assignedUserId)
    const ultimo = ultimoAte(l.id, Date.now() + 1)
    if (ultimo != null && ultimo !== l.ultimoComercialUserId) {
      ultimos++
      if (GRAVAR) await prisma.$executeRawUnsafe('UPDATE bychat_leads SET ultimoComercialUserId = ? WHERE id = ?', ultimo, l.id)
    }
    if (l.outcome !== 'won' || (l.vendedorUserId != null && comerciais.has(l.vendedorUserId))) continue
    // Até o Ganho (com folga de 1 min para o que foi gravado junto).
    const ate = (l.outcomeAt?.getTime() ?? Date.now()) + 60_000
    const sem = (pontos.get(l.id) ?? []).filter((p) => !(p.userId === l.assignedUserId && p.t > ate))
    pontos.set(l.id, sem)
    const vendedor = ultimoAte(l.id, ate)
    if (vendedor == null || vendedor === l.vendedorUserId) continue
    trocas.push({ id: l.id, nome: l.nome || 'sem nome', de: l.vendedorUserId, para: vendedor })
  }

  console.log(`Equipe comercial: ${[...comerciais].map((id) => nome(id)).join(', ')}`)
  console.log(`Última pessoa da comercial a preencher/atualizar: ${ultimos} leads`)
  console.log(`Ganhos com vendedor fora da comercial que passam para a comercial: ${trocas.length}`)
  for (const t of trocas) console.log(`  lead ${t.id} (${t.nome}): ${nome(t.de)} → ${nome(t.para)}`)

  if (GRAVAR && trocas.length) {
    const { onNegotiationChanged } = await import('../src/services/commissions.js')
    let propostas = 0
    for (const t of trocas) {
      await prisma.$executeRawUnsafe('UPDATE bychat_leads SET vendedorUserId = ? WHERE id = ?', t.para, t.id)
      const negs = await prisma.negotiation.findMany({
        where: { leadId: t.id, resultado: 'won', OR: [{ responsavelUserId: null }, { responsavelUserId: { notIn: [...comerciais] } }] },
        select: { id: true },
      })
      if (negs.length) await prisma.negotiation.updateMany({ where: { id: { in: negs.map((n) => n.id) } }, data: { responsavelUserId: t.para } })
      for (const n of negs) { propostas++; await onNegotiationChanged(n.id).catch((e) => console.warn('comissão', n.id, e?.message || e)) }
      await prisma.leadEvent.create({
        data: { leadId: t.id, type: 'vendedor_corrigido' as any, category: 'lifecycle' as any, title: `Vendedor: ${nome(t.de)} → ${nome(t.para)}`, description: 'Equipe comercial marcada: a venda volta para quem negociou.', actorType: 'system' as any, metadata: { de: t.de, para: t.para } as any },
      } as any).catch(() => {})
    }
    console.log(`Gravado: ${trocas.length} vendedores, ${propostas} propostas ganhas acertadas (comissão refeita).`)
  } else if (!GRAVAR) {
    console.log('(só conferência — rode com --gravar para gravar)')
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect().then(() => process.exit()))
