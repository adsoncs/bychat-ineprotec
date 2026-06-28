// src/routes/acaBi.ts
// Módulo Acadêmico · P10 — BI. Indicadores acadêmicos e financeiros agregados
// a partir das tabelas bychat_aca_*. Somente leitura. Filtro opcional por período.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const EVASAO = ['TRANCADO', 'EVADIDO', 'CANCELADO', 'TRANSFERIDO']

export async function acaBiRoutes(app: FastifyInstance) {
  app.get('/api/admin/aca/bi', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const periodoLetivoId = q.periodoLetivoId ? Number(q.periodoLetivoId) : null

    // Escopo de turmas (null = todas)
    let turmaIds: number[] | null = null
    if (periodoLetivoId) {
      const ts = await prisma.acaTurma.findMany({ where: { periodoLetivoId }, select: { id: true } })
      turmaIds = ts.map((t) => t.id)
    }
    const turmaWhere = turmaIds ? { turmaId: { in: turmaIds } } : {}

    // Matrículas no escopo (para alunos/contratos)
    const matsEscopo = await prisma.acaMatricula.findMany({ where: turmaWhere, select: { id: true, alunoId: true, status: true, listaEspera: true } })
    const matIds = matsEscopo.map((m) => m.id)
    const ativos = matsEscopo.filter((m) => m.status === 'MATRICULADO' && !m.listaEspera)

    // ── Acadêmico ──
    const turmasAtivas = await prisma.acaTurma.count({ where: { ...(turmaIds ? { id: { in: turmaIds } } : {}), ativo: true } })
    const turmasCap = await prisma.acaTurma.findMany({ where: turmaIds ? { id: { in: turmaIds } } : {}, select: { id: true, capacidade: true } })
    const ativosFull = await prisma.acaMatricula.findMany({ where: { ...turmaWhere, status: 'MATRICULADO', listaEspera: false }, select: { turmaId: true } })
    const contByTurma = new Map<number, number>()
    for (const a of ativosFull) contByTurma.set(a.turmaId, (contByTurma.get(a.turmaId) || 0) + 1)
    let capTotal = 0, ocupTotal = 0
    for (const t of turmasCap) { if (t.capacidade && t.capacidade > 0) { capTotal += t.capacidade; ocupTotal += Math.min(contByTurma.get(t.id) || 0, t.capacidade) } }
    const ocupacaoPct = capTotal > 0 ? Math.round((ocupTotal / capTotal) * 100) : 0

    const academico = {
      alunosAtivos: new Set(ativos.map((m) => m.alunoId)).size,
      matriculadosTotal: ativos.length,
      listaEspera: matsEscopo.filter((m) => m.listaEspera).length,
      turmasAtivas,
      ocupacaoPct, vagas: { capacidade: capTotal, ocupadas: ocupTotal },
      concluidos: matsEscopo.filter((m) => m.status === 'CONCLUIDO').length,
      evadidos: matsEscopo.filter((m) => EVASAO.includes(m.status)).length,
    }

    // Distribuição de situação + frequência média (a partir de AcaResultado no escopo)
    let resultadoWhere: any = {}
    if (turmaIds) {
      const diarios = await prisma.acaDiario.findMany({ where: { turmaId: { in: turmaIds } }, select: { id: true } })
      resultadoWhere = { diarioId: { in: diarios.map((d) => d.id) } }
    }
    const [situacaoGroups, freqAgg] = await Promise.all([
      prisma.acaResultado.groupBy({ by: ['situacao'], where: resultadoWhere, _count: { _all: true } }),
      prisma.acaResultado.aggregate({ where: resultadoWhere, _avg: { frequenciaPct: true } }),
    ])
    const situacao: Record<string, number> = {}
    for (const g of situacaoGroups) situacao[g.situacao] = g._count._all
    const desempenho = { situacao, frequenciaMedia: freqAgg._avg.frequenciaPct != null ? Math.round(freqAgg._avg.frequenciaPct) : null, totalAvaliados: Object.values(situacao).reduce((s, n) => s + n, 0) }

    // ── Financeiro (parcelas dos contratos no escopo) ──
    const contratos = await prisma.acaContrato.findMany({ where: matIds.length ? { matriculaId: { in: matIds } } : { id: -1 }, select: { id: true, valorTotalCentavos: true, status: true } })
    const contratoIds = contratos.map((c) => c.id)
    const parcelaWhere = contratoIds.length ? { contratoId: { in: contratoIds } } : { id: -1 }
    const [parcGroups, recebidoAgg, contratosAtivos] = await Promise.all([
      prisma.acaParcela.groupBy({ by: ['situacao'], where: parcelaWhere, _count: { _all: true }, _sum: { valorBrutoCentavos: true } }),
      prisma.acaParcela.aggregate({ where: { ...parcelaWhere, situacao: 'PAGA' }, _sum: { valorPagoCentavos: true } }),
      Promise.resolve(contratos.filter((c) => c.status === 'ATIVO').length),
    ])
    const porSituacao: Record<string, { count: number; valor: number }> = {}
    for (const g of parcGroups) porSituacao[g.situacao] = { count: g._count._all, valor: g._sum.valorBrutoCentavos || 0 }
    const val = (s: string) => porSituacao[s]?.valor || 0
    const aReceber = val('ABERTA') + val('VENCIDA')
    const recebido = recebidoAgg._sum.valorPagoCentavos || 0
    const inadimplencia = { valor: val('VENCIDA'), count: porSituacao['VENCIDA']?.count || 0 }
    const ticketMedio = contratos.length ? Math.round(contratos.reduce((s, c) => s + c.valorTotalCentavos, 0) / contratos.length) : 0

    const financeiro = { aReceber, recebido, inadimplencia, ticketMedio, contratosAtivos, porSituacao }

    return { periodoLetivoId, academico, desempenho, financeiro }
  })
}
