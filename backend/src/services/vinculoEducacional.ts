// src/services/vinculoEducacional.ts
//
// Fase 1 da integração Negociações/Metas/Comissões × Educacional (22/10/2026):
// a base de dados que liga as duas pontas, sem mudar fluxo nenhum.
//   - produto do Catálogo → curso (sugestão pelo nome; o admin confirma);
//   - proposta antiga → inscrição do mesmo lead, quando o curso bate;
//   - inscrição → vendedor (responsável da ficha no momento da inscrição).

import { prisma } from '../lib/prisma.js'

const PALAVRAS_VAZIAS = new Set(['curso', 'tecnico', 'tecnica', 'em', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'esp', 'especializacao', 'pos', 'graduacao', 'posgraduacao', 'ead', 'presencial', 'semipresencial', 'bacharelado', 'licenciatura', 'tecnologo', 'tecnologia', 'tec', 'lato', 'sensu', 'mba', 'extensao', 'universitaria'])
function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !PALAVRAS_VAZIAS.has(w)))
}

/** Curso mais parecido com o nome do produto (sobreposição de palavras), ou null se nenhum for convincente. */
export function sugerirCurso(nomeProduto: string, cursos: Array<{ id: number; nome: string }>): { id: number; nome: string; confianca: number } | null {
  const tp = tokens(nomeProduto)
  if (!tp.size) return null
  let melhor: { id: number; nome: string; confianca: number } | null = null
  for (const c of cursos) {
    const tc = tokens(c.nome)
    if (!tc.size) continue
    const comuns = [...tp].filter((w) => tc.has(w)).length
    const conf = comuns / Math.max(tp.size, tc.size)
    if (!melhor || conf > melhor.confianca) melhor = { id: c.id, nome: c.nome, confianca: Math.round(conf * 100) / 100 }
  }
  return melhor && melhor.confianca >= 0.6 ? melhor : null
}

/**
 * Proposta sem inscrição ligada → a inscrição do mesmo lead cujo curso é o do
 * item da proposta (produto com curso). Sem item ligado a curso, só quando o
 * lead tem UMA inscrição e UMA proposta. Ambíguo fica de fora.
 */
export async function vincularPropostasAntigas(opts: { gravar: boolean }) {
  const propostas = await prisma.negotiation.findMany({
    where: { registrationId: null },
    select: { id: true, leadId: true, titulo: true, items: { select: { productId: true } } },
  })
  const prodIds = [...new Set(propostas.flatMap((n) => n.items.map((i) => i.productId)).filter((x): x is number => !!x))]
  const prods = prodIds.length ? await prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, courseId: true } }) : []
  const cursoDoProduto = new Map(prods.map((p) => [p.id, p.courseId]))
  const leadIds = [...new Set(propostas.map((n) => n.leadId))]
  const regs = leadIds.length ? await prisma.enrollmentRegistration.findMany({
    where: { leadId: { in: leadIds }, mergedIntoId: null },
    select: { id: true, leadId: true, candidateCode: true, processRegistration: { select: { offeringId: true, offering: { select: { courseId: true } } } } },
  }) : []
  const regsDoLead = new Map<number, typeof regs>()
  for (const r of regs) (regsDoLead.get(r.leadId!) ?? regsDoLead.set(r.leadId!, []).get(r.leadId!)!).push(r)
  const propostasDoLead = new Map<number, number>()
  for (const n of propostas) propostasDoLead.set(n.leadId, (propostasDoLead.get(n.leadId) ?? 0) + 1)

  const ligacoes: Array<{ negotiationId: number; registrationId: number; offeringId: number | null; codigo: string; titulo: string; motivo: string }> = []
  let ambiguas = 0
  for (const n of propostas) {
    const rs = regsDoLead.get(n.leadId) ?? []
    if (!rs.length) continue
    const cursos = new Set(n.items.map((i) => (i.productId ? cursoDoProduto.get(i.productId) : null)).filter((x): x is number => !!x))
    let alvo: (typeof rs)[number] | null = null
    let motivo = ''
    if (cursos.size) {
      const certos = rs.filter((r) => r.processRegistration?.offering?.courseId && cursos.has(r.processRegistration.offering.courseId))
      if (certos.length === 1) { alvo = certos[0]!; motivo = 'curso do item = curso da inscrição' }
      else if (certos.length > 1) ambiguas++
    } else if (rs.length === 1 && propostasDoLead.get(n.leadId) === 1) {
      alvo = rs[0]!; motivo = 'única proposta e única inscrição do lead'
    }
    if (alvo) ligacoes.push({ negotiationId: n.id, registrationId: alvo.id, offeringId: alvo.processRegistration?.offeringId ?? null, codigo: alvo.candidateCode, titulo: n.titulo, motivo })
  }
  if (opts.gravar) {
    for (const l of ligacoes) {
      await prisma.negotiation.updateMany({ where: { id: l.negotiationId, registrationId: null }, data: { registrationId: l.registrationId, offeringId: l.offeringId } })
    }
  }
  return { gravado: opts.gravar, ligaveis: ligacoes.length, ambiguas, semInscricao: propostas.filter((n) => !(regsDoLead.get(n.leadId)?.length)).length, total: propostas.length, exemplos: ligacoes.slice(0, 20) }
}

/** Inscrições sem vendedor: o responsável ATUAL da ficha (o da época não foi guardado antes da Fase 1). */
export async function preencherVendedorDasInscricoes(): Promise<number> {
  const regs = await prisma.enrollmentRegistration.findMany({ where: { vendedorUserId: null, leadId: { not: null } }, select: { id: true, lead: { select: { assignedUserId: true } } } })
  let n = 0
  for (const r of regs) {
    if (!r.lead?.assignedUserId) continue
    await prisma.enrollmentRegistration.update({ where: { id: r.id }, data: { vendedorUserId: r.lead.assignedUserId } })
    n++
  }
  return n
}
