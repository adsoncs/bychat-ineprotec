// Números do Educacional, num lugar só.
//
// Estas contas nasceram dentro do switch de POST /api/admin/widget-data, que é
// gateado pelo módulo 'dashboard'. A Tela Inicial nativa precisa dos MESMOS
// números por outra porta (ela abre para qualquer papel a quem o admin a
// atribuir), e copiar o cálculo garantiria divergência: um dia alguém corrige a
// conversão num lado e o outro fica mentindo.
//
// ⚠️ Dois universos convivem aqui, e não é engano:
//   • `EnrollmentRegistration` — inscrições dos PORTAIS de matrícula. É o que
//     alimenta os KPIs do período (inscrições, pagas, receita, conversão).
//   • `ProcessRegistration` — inscrições em PROCESSO SELETIVO. É o que alimenta
//     o hero ("N matrículas · N inscritos · conversão global").
// A tela do módulo Educacional sempre mostrou os dois juntos; manter isso é
// deliberado, para o painel da Tela Inicial bater com o que o cliente já vê.

import { prisma } from '../lib/prisma.js'

export interface RecortePeriodo {
  dateFrom?: string
  dateTo?: string
  prevFrom?: string
  prevTo?: string
  groupBy?: 'day' | 'week' | 'month'
  limit?: number
}

/** Janela imediatamente anterior, do mesmo tamanho — é o que dá o Δ%. */
export function periodoAnterior(cfg: RecortePeriodo): { gte: Date; lte: Date } | null {
  if (cfg?.prevFrom && cfg?.prevTo) {
    return {
      gte: new Date(cfg.prevFrom + 'T00:00:00.000Z'),
      lte: new Date(cfg.prevTo + 'T23:59:59.999Z'),
    }
  }
  if (!cfg?.dateFrom || !cfg?.dateTo) return null
  const de = new Date(cfg.dateFrom + 'T00:00:00.000Z')
  const ate = new Date(cfg.dateTo + 'T23:59:59.999Z')
  const span = ate.getTime() - de.getTime()
  if (!Number.isFinite(span) || span <= 0) return null
  return { gte: new Date(de.getTime() - span - 1), lte: new Date(de.getTime() - 1) }
}

function filtroDeData(cfg: RecortePeriodo): { gte?: Date; lte?: Date } | null {
  const f: any = {}
  if (cfg?.dateFrom) f.gte = new Date(cfg.dateFrom + 'T00:00:00.000Z')
  if (cfg?.dateTo) f.lte = new Date(cfg.dateTo + 'T23:59:59.999Z')
  return Object.keys(f).length ? f : null
}

export async function inscricoesTotal(cfg: RecortePeriodo) {
  const data = filtroDeData(cfg)
  const where: any = data ? { createdAt: data } : {}
  const total = await prisma.enrollmentRegistration.count({ where })
  const anterior = periodoAnterior(cfg)
  if (!anterior) return { value: total }
  const prev = await prisma.enrollmentRegistration.count({ where: { createdAt: anterior } })
  return { value: total, prev }
}

export async function inscricoesPagas(cfg: RecortePeriodo) {
  const data = filtroDeData(cfg)
  const wherePagas: any = { paymentStatus: 'paid' }
  const whereTotal: any = {}
  if (data) { wherePagas.createdAt = data; whereTotal.createdAt = data }
  const [pagas, total] = await Promise.all([
    prisma.enrollmentRegistration.count({ where: wherePagas }),
    prisma.enrollmentRegistration.count({ where: whereTotal }),
  ])
  const anterior = periodoAnterior(cfg)
  if (!anterior) return { value: pagas, paid: pagas, total }
  const prev = await prisma.enrollmentRegistration.count({
    where: { paymentStatus: 'paid', createdAt: anterior },
  })
  return { value: pagas, paid: pagas, total, prev }
}

export async function receitaDoPeriodo(cfg: RecortePeriodo) {
  const data = filtroDeData(cfg)
  const where: any = { paymentStatus: 'paid' }
  if (data) where.createdAt = data
  const soma = await prisma.enrollmentRegistration.aggregate({ where, _sum: { paymentAmount: true } })
  const value = Number(soma._sum.paymentAmount || 0)
  const anterior = periodoAnterior(cfg)
  if (!anterior) return { value, format: 'currency' as const }
  const antes = await prisma.enrollmentRegistration.aggregate({
    where: { paymentStatus: 'paid', createdAt: anterior },
    _sum: { paymentAmount: true },
  })
  return { value, format: 'currency' as const, prev: Number(antes._sum.paymentAmount || 0) }
}

export async function taxaDeConversao(cfg: RecortePeriodo) {
  const data = filtroDeData(cfg)
  const where: any = data ? { createdAt: data } : {}
  const [total, pagas] = await Promise.all([
    prisma.enrollmentRegistration.count({ where }),
    prisma.enrollmentRegistration.count({ where: { ...where, paymentStatus: 'paid' } }),
  ])
  return { value: total > 0 ? Math.round((pagas / total) * 100) : 0, paid: pagas, total }
}

export async function inscricoesPorDia(cfg: RecortePeriodo) {
  const groupBy = cfg?.groupBy || 'day'
  const padrao = groupBy === 'week' ? 90 : groupBy === 'month' ? 365 : 30
  const data = filtroDeData(cfg)
  const janela = data ?? { gte: new Date(Date.now() - padrao * 86400000) }

  const regs = await prisma.enrollmentRegistration.findMany({
    where: { createdAt: janela },
    select: { createdAt: true, paymentStatus: true },
    orderBy: { createdAt: 'asc' },
  })

  const baldes: Record<string, { total: number; paid: number }> = {}
  for (const r of regs) {
    let chave: string
    if (groupBy === 'week') {
      const d = new Date(r.createdAt)
      const dia = d.getDay()
      const diff = d.getDate() - dia + (dia === 0 ? -6 : 1)
      chave = new Date(d.setDate(diff)).toISOString().split('T')[0]
    } else if (groupBy === 'month') {
      chave = r.createdAt.toISOString().substring(0, 7)
    } else {
      chave = r.createdAt.toISOString().split('T')[0]
    }
    if (!baldes[chave]) baldes[chave] = { total: 0, paid: 0 }
    baldes[chave].total++
    if (r.paymentStatus === 'paid') baldes[chave].paid++
  }

  return {
    data: Object.entries(baldes)
      .sort()
      .map(([label, v]) => ({ label, value: v.total, paid: v.paid })),
  }
}

export async function inscricoesPorPortal(cfg: RecortePeriodo) {
  const data = filtroDeData(cfg)
  const where: any = data ? { createdAt: data } : {}
  const contagens = await prisma.enrollmentRegistration.groupBy({
    by: ['portalId'],
    where,
    _count: { _all: true },
  })
  const portais = await prisma.enrollmentPortal.findMany({
    where: { id: { in: contagens.map((c) => c.portalId) } },
    select: { id: true, nome: true },
  })
  const nomePorId = new Map(portais.map((p) => [p.id, p.nome]))
  return {
    data: contagens
      .map((c) => ({
        label: nomePorId.get(c.portalId) || `Portal #${c.portalId}`,
        value: c._count._all,
        key: String(c.portalId),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, cfg?.limit || 10),
  }
}

/**
 * Cabeçalho do painel: retrato de agora, sem recorte de período — é o estado da
 * operação acadêmica, não o desempenho da janela escolhida.
 */
export async function panoramaAcademico() {
  const [cursos, ofertas, processos, inscricoes, matriculados] = await Promise.all([
    prisma.course.count({ where: { active: true } }),
    prisma.courseOffering.count({ where: { active: true } }),
    prisma.selectionProcess.count({ where: { active: true } }),
    prisma.processRegistration.count(),
    prisma.processRegistration.count({ where: { status: 'matriculado' } }),
  ])
  return {
    totalCourses: cursos,
    totalOfferings: ofertas,
    totalProcesses: processos,
    totalRegistrations: inscricoes,
    matriculados,
    conversionRate: inscricoes > 0 ? Math.round((matriculados / inscricoes) * 100) : 0,
  }
}
