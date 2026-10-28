// src/services/etiquetaVendedor.ts
//
// Etiqueta do vendedor (Team.etiquetaVendedor, numa equipe comercial): cada
// lead leva uma etiqueta com o nome de quem o atende no time de vendas — o
// responsável, se for da equipe; senão a última pessoa da equipe que esteve com
// ele (Lead.ultimoComercialUserId). Fica no lead mesmo quando ele vai para
// Secretaria ou Financeiro, para todos verem quem é o vendedor, e é por ela que
// o vendedor continua vendo a inscrição no portal (lib/portalAccess.ts).
//
// O sistema põe e tira (routes/tags.ts recusa a mão); outra pessoa da equipe
// assumindo o lead troca a etiqueta. Nenhuma equipe marcada = nenhuma etiqueta
// de vendedor (as que existirem saem dos leads e ficam inativas).

import { prisma } from '../lib/prisma.js'

const COR = '#2563EB'

/** Vendedores com etiqueta: membros ativos de equipe comercial ativa marcada. */
async function vendedores(): Promise<Map<number, string>> {
  const membros = await prisma.teamMember.findMany({
    where: { team: { active: true, equipeComercial: true, etiquetaVendedor: true }, user: { active: true } },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  return new Map(membros.map((m) => [m.user.id, (m.user.name || m.user.email || `Usuário ${m.user.id}`).replace(/\s+/g, ' ').trim()]))
}

/** Garante a etiqueta de cada vendedor, com o nome do usuário. */
async function etiquetasDosVendedores(vend: Map<number, string>): Promise<void> {
  const existentes = await prisma.tag.findMany({ where: { vendedorUserId: { not: null } }, select: { id: true, name: true, active: true, vendedorUserId: true } })
  const porUsuario = new Map(existentes.map((t) => [t.vendedorUserId!, t]))
  for (const [userId, nome] of vend) {
    const t = porUsuario.get(userId)
    // Nome já usado por outra etiqueta: o sufixo evita a colisão do índice único.
    const livre = async (n: string) => !(await prisma.tag.findFirst({ where: { name: n, NOT: t ? { id: t.id } : undefined }, select: { id: true } }))
    const nomeFinal = (await livre(nome)) ? nome : `${nome} (vendedor)`
    if (!t) {
      await prisma.tag.create({ data: { name: nomeFinal, color: COR, description: 'Etiqueta automática do vendedor — o sistema põe e tira.', vendedorUserId: userId } })
    } else if (t.name !== nomeFinal || !t.active) {
      await prisma.tag.update({ where: { id: t.id }, data: { name: nomeFinal, active: true } })
    }
  }
  // Quem deixou de ser vendedor: a etiqueta fica inativa (some das listas de escolha).
  const sairam = existentes.filter((t) => !vend.has(t.vendedorUserId!) && t.active).map((t) => t.id)
  if (sairam.length) await prisma.tag.updateMany({ where: { id: { in: sairam } }, data: { active: false } })
}

// Uma sincronização por vez: duas criando a mesma etiqueta brigariam no índice único.
let fila: Promise<unknown> = Promise.resolve()

/**
 * Acerta a etiqueta do vendedor nos leads (todos, ou só os de `leadIds`).
 * Idempotente: pode rodar quantas vezes for — é o que a varredura periódica faz.
 */
export function sincronizarEtiquetaVendedor(leadIds?: number[]): Promise<{ postas: number; tiradas: number }> {
  const p = fila.then(() => sincronizar(leadIds))
  fila = p.catch(() => {})
  return p
}

async function sincronizar(leadIds?: number[]): Promise<{ postas: number; tiradas: number }> {
  const ids = leadIds?.filter((n) => Number.isInteger(n) && n > 0)
  if (ids && !ids.length) return { postas: 0, tiradas: 0 }
  const vend = await vendedores()
  if (!ids || (vend.size && await prisma.tag.count({ where: { vendedorUserId: { in: [...vend.keys()] }, active: true } }) < vend.size)) {
    await etiquetasDosVendedores(vend)
  }

  const filtroLead = ids ? `AND l.id IN (${ids.join(',')})` : ''
  const lista = [...vend.keys()]
  const emVend = lista.length ? lista.join(',') : 'NULL'
  // Vendedor do lead: o responsável, se for vendedor; senão o último comercial, se for.
  const vendedorDoLead = `CASE WHEN l.assignedUserId IN (${emVend}) THEN l.assignedUserId WHEN l.ultimoComercialUserId IN (${emVend}) THEN l.ultimoComercialUserId END`

  const tiradas = await prisma.$executeRawUnsafe(`
    DELETE lt FROM bychat_lead_tags lt
    JOIN bychat_tags t ON t.id = lt.tagId
    JOIN bychat_leads l ON l.id = lt.leadId
    WHERE t.vendedorUserId IS NOT NULL ${filtroLead}
      AND NOT ((${vendedorDoLead}) <=> t.vendedorUserId)`)
  const postas = lista.length ? await prisma.$executeRawUnsafe(`
    INSERT IGNORE INTO bychat_lead_tags (leadId, tagId, createdAt)
    SELECT l.id, t.id, NOW(3) FROM bychat_leads l
    JOIN bychat_tags t ON t.vendedorUserId = (${vendedorDoLead})
    WHERE l.isGroup = 0 ${filtroLead}`) : 0
  return { postas, tiradas }
}

/** Depois de gravar dono / último comercial: acerta só esses leads, sem travar quem chamou. */
export function sincronizarDepois(leadIds: number[]): void {
  if (!leadIds.length) return
  setImmediate(() => {
    sincronizarEtiquetaVendedor(leadIds).catch((e) => console.error('[etiqueta-vendedor]', e?.message || e))
  })
}
