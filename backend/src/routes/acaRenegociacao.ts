// src/routes/acaRenegociacao.ts
// Módulo Acadêmico · Fin-3 — Renegociação / Acordos.
// Agrupa parcelas vencidas (com encargos) em um ACORDO: entrada + N parcelas
// novas (tipo ACORDO), quitando as originais (situação RENEGOCIADA).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { getEncargosConfig, calcularEncargos } from '../services/acaEncargos.js'

/** Vencimento mensal: primeiro vencimento + i meses (preserva o dia). */
function venc(primeiro: Date, i: number): Date {
  const d = new Date(primeiro)
  d.setMonth(d.getMonth() + i)
  return d
}

async function carregarParcelas(ids: number[]) {
  return prisma.acaParcela.findMany({
    where: { id: { in: ids } },
    select: { id: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true, contratoId: true, contrato: { select: { matricula: { select: { alunoId: true } } } } },
  })
}

export async function acaRenegociacaoRoutes(app: FastifyInstance) {
  // ── Simular: total das parcelas escolhidas já com encargos ──
  app.post('/api/admin/aca/financeiro/renegociar/simular', { preHandler: authMiddleware }, async (req, reply) => {
    const ids = ((req.body as any)?.parcelaIds || []).map(Number)
    if (!ids.length) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })
    const cfg = await getEncargosConfig()
    const parcelas = await carregarParcelas(ids)
    const elegiveis = parcelas.filter((p) => p.situacao === 'ABERTA' || p.situacao === 'VENCIDA')
    let valorOriginal = 0, encargos = 0
    for (const p of elegiveis) { const e = calcularEncargos(p, cfg); valorOriginal += e.original; encargos += e.multa + e.juros }
    return { qtd: elegiveis.length, valorOriginal, encargos, total: valorOriginal + encargos }
  })

  // ── Renegociar: cria o acordo e as novas parcelas ──
  app.post('/api/admin/aca/financeiro/renegociar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const ids = (b.parcelaIds || []).map(Number)
    const numParcelas = Math.max(1, Number(b.numParcelas) || 1)
    const entrada = Math.max(0, Math.round(Number(b.entrada) || 0)) // centavos
    const primeiroVencimento = b.primeiroVencimento ? new Date(b.primeiroVencimento) : venc(new Date(), 1)
    if (!ids.length) return reply.code(400).send({ error: 'Selecione ao menos uma parcela.' })

    const cfg = await getEncargosConfig()
    const parcelas = await carregarParcelas(ids)
    const elegiveis = parcelas.filter((p) => p.situacao === 'ABERTA' || p.situacao === 'VENCIDA')
    if (!elegiveis.length) return reply.code(400).send({ error: 'Nenhuma parcela elegível (apenas em aberto/vencidas).' })
    const alunoIds = new Set(elegiveis.map((p) => p.contrato.matricula.alunoId))
    if (alunoIds.size > 1) return reply.code(400).send({ error: 'Selecione parcelas de um único aluno.' })
    const contratoId = elegiveis[0].contratoId
    const alunoId = elegiveis[0].contrato.matricula.alunoId

    let valorOriginal = 0, encargos = 0
    for (const p of elegiveis) { const e = calcularEncargos(p, cfg); valorOriginal += e.original; encargos += e.multa + e.juros }
    const total = valorOriginal + encargos
    if (entrada >= total) return reply.code(400).send({ error: 'A entrada deve ser menor que o total renegociado.' })
    const restante = total - entrada
    const valorParcela = Math.round(restante / numParcelas)

    // acordo
    const acordo = await prisma.acaAcordo.create({ data: {
      alunoId, contratoId, valorOriginalCentavos: valorOriginal, valorEncargosCentavos: encargos,
      valorTotalCentavos: total, entradaCentavos: entrada, numParcelas, valorParcelaCentavos: valorParcela,
      observacao: b.observacao ? String(b.observacao).slice(0, 1000) : null,
    } })

    // quita as originais
    await prisma.acaParcela.updateMany({ where: { id: { in: elegiveis.map((p) => p.id) } }, data: { situacao: 'RENEGOCIADA', acordoId: acordo.id } })

    // numeração das novas parcelas continua a do contrato
    const maxNro = (await prisma.acaParcela.aggregate({ where: { contratoId }, _max: { nroParcela: true } }))._max.nroParcela || 0
    let nro = maxNro + 1
    let criadas = 0
    if (entrada > 0) {
      await prisma.acaParcela.create({ data: { contratoId, acordoId: acordo.id, nroParcela: nro++, tipo: 'ACORDO', valorBrutoCentavos: entrada, dataVencimento: new Date(), situacao: 'ABERTA' } })
      criadas++
    }
    // ajusta a última parcela p/ fechar centavos
    const valores = Array.from({ length: numParcelas }, () => valorParcela)
    const somaParc = valorParcela * numParcelas
    if (somaParc !== restante) valores[numParcelas - 1] += restante - somaParc
    for (let i = 0; i < numParcelas; i++) {
      await prisma.acaParcela.create({ data: { contratoId, acordoId: acordo.id, nroParcela: nro++, tipo: 'ACORDO', valorBrutoCentavos: valores[i], dataVencimento: venc(primeiroVencimento, i), situacao: 'ABERTA' } })
      criadas++
    }
    return reply.code(201).send({ acordo, parcelasCriadas: criadas, originaisRenegociadas: elegiveis.length })
  })

  // ── Lista de acordos do aluno ──
  app.get('/api/admin/aca/financeiro/acordos', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.alunoId) where.alunoId = Number(q.alunoId)
    const acordos = await prisma.acaAcordo.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
    return { acordos }
  })
}
