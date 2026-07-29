// src/routes/acaInteligencia.ts
//
// Fase 5 — score de evasão (T-1203), produção docente (T-607) e dashboards por
// persona (T-1201/T-1202). São três leituras do mesmo acervo de dados, cada uma
// respondendo à pergunta de um papel: direção, coordenação e secretaria.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { calcularRisco, painelRisco } from '../services/acaEvasao.js'
import { consolidar, paraCsv } from '../services/acaProducaoDocente.js'

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function acaInteligenciaRoutes(app: FastifyInstance) {
  // ─────────── Evasão ───────────

  app.get('/api/admin/aca/evasao/painel', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    return painelRisco({
      ...(num(q?.courseId) ? { courseId: Number(q.courseId) } : {}),
      ...(q?.scoreMinimo ? { faixaMinima: Number(q.scoreMinimo) } : {}),
    })
  })

  app.get('/api/admin/aca/evasao/vinculo/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = num((req.params as any).id)
    if (!id) return reply.code(400).send({ error: 'id inválido' })
    const risco = await calcularRisco(id)
    if (!risco) return reply.code(404).send({ error: 'Vínculo não encontrado' })
    return risco
  })

  // ─────────── Produção docente ───────────

  app.get('/api/admin/aca/producao-docente', { preHandler: authMiddleware }, async (req, reply) => {
    const competencia = String((req.query as any)?.competencia || '')
      || new Date().toISOString().slice(0, 7)
    try {
      return await consolidar(competencia)
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  app.get('/api/admin/aca/producao-docente/csv', { preHandler: authMiddleware }, async (req, reply) => {
    const competencia = String((req.query as any)?.competencia || '') || new Date().toISOString().slice(0, 7)
    try {
      const dados = await consolidar(competencia)
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="producao-docente-${competencia}.csv"`)
        .send(paraCsv(dados))
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message })
    }
  })

  // ─────────── Dashboards por persona ───────────

  /**
   * Direção: o painel executivo. Alunos ativos, evasão em risco, inadimplência
   * e receita — os quatro números que definem se o semestre fecha.
   */
  app.get('/api/admin/aca/bi/direcao', { preHandler: authMiddleware }, async () => {
    const hoje = new Date()
    const [ativos, formados, evadidos, trancados, risco, parcelas] = await Promise.all([
      prisma.acaVinculo.count({ where: { situacao: 'ATIVO' } }),
      prisma.acaVinculo.count({ where: { situacao: { in: ['FORMADO', 'DIPLOMADO'] } } }),
      prisma.acaVinculo.count({ where: { situacao: 'EVADIDO' } }),
      prisma.acaVinculo.count({ where: { situacao: 'TRANCADO' } }),
      painelRisco({ faixaMinima: 50 }),
      prisma.acaParcela.groupBy({ by: ['situacao'], _count: { _all: true }, _sum: { valorBrutoCentavos: true } }),
    ])
    const porSituacao = Object.fromEntries(parcelas.map((p) => [p.situacao, { qtd: p._count._all, centavos: p._sum.valorBrutoCentavos ?? 0 }]))
    const vencido = porSituacao.VENCIDA?.centavos ?? 0
    const recebido = porSituacao.PAGA?.centavos ?? 0
    const aberto = porSituacao.ABERTA?.centavos ?? 0
    return {
      alunos: { ativos, formados, evadidos, trancados, total: ativos + formados + evadidos + trancados },
      // Evasão só é útil como número se vier com quem ligar.
      risco: { emRisco: risco.total, porFaixa: risco.porFaixa, prioridade: risco.linhas.slice(0, 10) },
      financeiro: {
        recebidoCentavos: recebido, aVencerCentavos: aberto, vencidoCentavos: vencido,
        inadimplenciaPct: recebido + vencido > 0 ? Math.round((vencido / (recebido + vencido)) * 100) : 0,
      },
      geradoEm: hoje,
    }
  })

  /**
   * Coordenação: desempenho por disciplina e alunos em risco do curso — a visão
   * de quem precisa agir sobre a turma, não sobre a instituição.
   */
  app.get('/api/admin/aca/bi/coordenacao', { preHandler: authMiddleware }, async (req) => {
    const courseId = num((req.query as any)?.courseId)
    const diarios = await prisma.acaDiario.findMany({ select: { id: true, disciplinaId: true, turmaId: true } })
    const resultados = await prisma.acaResultado.findMany({ select: { diarioId: true, situacao: true, mediaFinal: true, frequenciaPct: true } })
    const disciplinas = await prisma.acaDisciplina.findMany({ select: { id: true, nome: true } })
    const nomeDisc = new Map(disciplinas.map((d) => [d.id, d.nome]))
    const discPorDiario = new Map(diarios.map((d) => [d.id, d.disciplinaId]))

    const agrupado = new Map<number, { total: number; reprovados: number; somaMedia: number; comMedia: number; somaFreq: number }>()
    for (const r of resultados) {
      const discId = discPorDiario.get(r.diarioId)
      if (discId == null) continue
      const acc = agrupado.get(discId) ?? { total: 0, reprovados: 0, somaMedia: 0, comMedia: 0, somaFreq: 0 }
      acc.total++
      if (r.situacao.startsWith('REPROVADO')) acc.reprovados++
      if (r.mediaFinal != null) { acc.somaMedia += r.mediaFinal; acc.comMedia++ }
      acc.somaFreq += r.frequenciaPct
      agrupado.set(discId, acc)
    }
    const disciplinasResumo = [...agrupado.entries()].map(([id, a]) => ({
      disciplinaId: id, nome: nomeDisc.get(id) ?? `#${id}`,
      alunos: a.total,
      reprovacaoPct: a.total ? Math.round((a.reprovados / a.total) * 100) : 0,
      mediaTurma: a.comMedia ? Number((a.somaMedia / a.comMedia).toFixed(1)) : null,
      frequenciaMedia: a.total ? Math.round(a.somaFreq / a.total) : 100,
    })).sort((x, y) => y.reprovacaoPct - x.reprovacaoPct)

    const risco = await painelRisco({ ...(courseId ? { courseId } : {}), faixaMinima: 25 })
    return { disciplinas: disciplinasResumo, alunosEmRisco: risco.linhas.slice(0, 20), porFaixa: risco.porFaixa }
  })

  /**
   * Secretaria: a fila do dia — requerimentos no prazo, diários em aberto,
   * documentos a conferir e acervo pendente de classificação.
   */
  app.get('/api/admin/aca/bi/secretaria', { preHandler: authMiddleware }, async () => {
    const agora = new Date()
    const [requerimentos, diarios, fechados, docsPendentes, acervoSemClassificacao, regimesPendentes] = await Promise.all([
      prisma.acaRequerimento.findMany({ select: { id: true, status: true, createdAt: true, prazoEm: true } }).catch(() => [] as any[]),
      prisma.acaDiario.count(),
      prisma.acaResultado.groupBy({ by: ['diarioId'], _count: { _all: true } }).then((r) => r.length).catch(() => 0),
      prisma.acaGedArquivo.count({ where: { status: 'RECEBIDO' } }),
      prisma.acaGedArquivo.count({ where: { classificacao: null } }),
      prisma.acaRegimeEspecial.count({ where: { status: 'SOLICITADO' } }).catch(() => 0),
    ])
    const abertos = requerimentos.filter((r: any) => !['DEFERIDO', 'INDEFERIDO', 'CANCELADO', 'CONCLUIDO'].includes(String(r.status)))
    const atrasados = abertos.filter((r: any) => r.prazoEm && new Date(r.prazoEm) < agora)
    return {
      requerimentos: { abertos: abertos.length, atrasados: atrasados.length, total: requerimentos.length },
      diarios: { total: diarios, fechados, pendentes: Math.max(0, diarios - fechados) },
      documentos: { aConferir: docsPendentes, acervoSemClassificacao },
      regimesEspeciais: { aguardandoAnalise: regimesPendentes },
    }
  })
}
