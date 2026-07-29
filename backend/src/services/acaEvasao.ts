// src/services/acaEvasao.ts
//
// Score de risco de evasão (T-1203).
//
// O diferencial não é prever evasão — todo concorrente promete isso a partir de
// nota e falta. É que aqui existe um sinal que os outros não têm: o aluno
// responde no WhatsApp? Silêncio prolongado de quem antes conversava costuma
// anteceder o abandono, e esse dado é nativo do ByChat.
//
// O modelo é explicável de propósito. Um score de caixa-preta não sustenta uma
// ligação de retenção: o coordenador precisa saber POR QUE ligar e o que dizer.
// Cada fator devolve pontos e o motivo em português.

import { prisma } from '../lib/prisma.js'

export interface FatorRisco {
  fator: string
  pontos: number
  detalhe: string
}

export interface RiscoEvasao {
  vinculoId: number
  alunoId: number
  nome: string
  ra: string | null
  score: number // 0-100
  faixa: 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO'
  fatores: FatorRisco[]
  /** O que a retenção deve fazer com este aluno. */
  acaoSugerida: string
}

const PESOS = {
  frequencia: 30,   // maior preditor isolado no ensino superior
  desempenho: 20,
  financeiro: 20,
  engajamento: 20,  // exclusivo ByChat
  portal: 10,
}

function faixaDe(score: number): RiscoEvasao['faixa'] {
  if (score >= 75) return 'CRITICO'
  if (score >= 50) return 'ALTO'
  if (score >= 25) return 'MEDIO'
  return 'BAIXO'
}

function acaoDe(faixa: RiscoEvasao['faixa'], fatores: FatorRisco[]): string {
  const principal = [...fatores].sort((a, b) => b.pontos - a.pontos)[0]
  if (faixa === 'BAIXO') return 'Acompanhamento de rotina.'
  const base = faixa === 'CRITICO'
    ? 'Contato imediato da retenção (ligação no mesmo dia).'
    : faixa === 'ALTO'
      ? 'Contato da retenção em até 48h.'
      : 'Mensagem de acompanhamento pelo WhatsApp.'
  if (!principal) return base
  const porFator: Record<string, string> = {
    frequencia: 'Abordar as faltas antes que estoure o limite de 25%.',
    desempenho: 'Oferecer monitoria/reforço nas disciplinas com nota baixa.',
    financeiro: 'Oferecer negociação — a dívida costuma ser o motivo real da desistência.',
    engajamento: 'Reabrir conversa: o aluno parou de responder.',
    portal: 'Verificar se o aluno consegue acessar o portal.',
  }
  return `${base} ${porFator[principal.fator] ?? ''}`.trim()
}

/**
 * Calcula o risco de um vínculo. Cada fator só pontua quando há dado — aluno
 * sem histórico não é penalizado por ausência de informação.
 */
export async function calcularRisco(vinculoId: number): Promise<RiscoEvasao | null> {
  const vinculo = await prisma.acaVinculo.findUnique({
    where: { id: vinculoId },
    select: {
      id: true, alunoId: true, situacao: true,
      aluno: { select: { ra: true, leadId: true, lead: { select: { nome: true } } } },
    },
  })
  if (!vinculo) return null

  const fatores: FatorRisco[] = []
  const alunoId = vinculo.alunoId

  // ── 1. Frequência ──
  const matriculas = await prisma.acaMatricula.findMany({ where: { alunoId }, select: { id: true } })
  const matIds = matriculas.map((m) => m.id)
  if (matIds.length > 0) {
    const freqs = await prisma.acaFrequencia.findMany({
      where: { matriculaId: { in: matIds } },
      select: { presente: true },
    })
    if (freqs.length >= 4) {
      const faltas = freqs.filter((f) => !f.presente).length
      const pctFalta = (faltas / freqs.length) * 100
      // 25% de falta = reprovação automática; o risco cresce até lá.
      const pontos = Math.round(Math.min(1, pctFalta / 25) * PESOS.frequencia)
      if (pontos > 0) {
        fatores.push({
          fator: 'frequencia', pontos,
          detalhe: `${pctFalta.toFixed(0)}% de faltas (limite legal: 25%)`,
        })
      }
    }
  }

  // ── 2. Desempenho ──
  if (matIds.length > 0) {
    const resultados = await prisma.acaResultado.findMany({
      where: { matriculaId: { in: matIds } },
      select: { situacao: true, mediaFinal: true },
    })
    if (resultados.length > 0) {
      const reprovadas = resultados.filter((r) => r.situacao.startsWith('REPROVADO')).length
      const pctReprov = (reprovadas / resultados.length) * 100
      const pontos = Math.round(Math.min(1, pctReprov / 50) * PESOS.desempenho)
      if (pontos > 0) {
        fatores.push({
          fator: 'desempenho', pontos,
          detalhe: `${reprovadas} de ${resultados.length} disciplina(s) reprovada(s)`,
        })
      }
    }
  }

  // ── 3. Financeiro ──
  const contratos = await prisma.acaContrato.findMany({ where: { matricula: { alunoId } }, select: { id: true } })
  if (contratos.length > 0) {
    const vencidas = await prisma.acaParcela.findMany({
      where: { contratoId: { in: contratos.map((c) => c.id) }, situacao: 'VENCIDA' },
      select: { dataVencimento: true },
      orderBy: { dataVencimento: 'asc' },
    })
    if (vencidas.length > 0) {
      const maisAntiga = vencidas[0]!.dataVencimento
      const dias = Math.floor((Date.now() - maisAntiga.getTime()) / 86400_000)
      // 90 dias de atraso é o ponto em que a inadimplência vira desistência.
      const pontos = Math.round(Math.min(1, dias / 90) * PESOS.financeiro)
      if (pontos > 0) {
        fatores.push({
          fator: 'financeiro', pontos,
          detalhe: `${vencidas.length} parcela(s) vencida(s), a mais antiga há ${dias} dias`,
        })
      }
    }
  }

  // ── 4. Engajamento conversacional (exclusivo ByChat) ──
  const leadId = vinculo.aluno?.leadId
  if (leadId) {
    const ultimaResposta = await prisma.message.findFirst({
      where: { leadId, fromMe: false },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const enviadasRecentes = await prisma.message.count({
      where: { leadId, fromMe: true, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    })
    if (ultimaResposta) {
      const dias = Math.floor((Date.now() - ultimaResposta.createdAt.getTime()) / 86400_000)
      // Silêncio só conta como sinal quando a instituição falou e não houve resposta.
      if (dias > 14 && enviadasRecentes > 0) {
        const pontos = Math.round(Math.min(1, dias / 60) * PESOS.engajamento)
        fatores.push({
          fator: 'engajamento', pontos,
          detalhe: `sem responder há ${dias} dias, com ${enviadasRecentes} mensagem(ns) enviada(s) no período`,
        })
      }
    } else if (enviadasRecentes >= 3) {
      fatores.push({
        fator: 'engajamento', pontos: PESOS.engajamento,
        detalhe: `nunca respondeu (${enviadasRecentes} tentativas em 30 dias)`,
      })
    }
  }

  // ── 5. Acesso ao portal ──
  const ultimoAcesso = await prisma.acaAcessoLog.findFirst({
    where: { alunoId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (ultimoAcesso) {
    const dias = Math.floor((Date.now() - ultimoAcesso.createdAt.getTime()) / 86400_000)
    if (dias > 30) {
      const pontos = Math.round(Math.min(1, dias / 90) * PESOS.portal)
      fatores.push({ fator: 'portal', pontos, detalhe: `sem acesso registrado há ${dias} dias` })
    }
  }

  const score = Math.min(100, fatores.reduce((s, f) => s + f.pontos, 0))
  const faixa = faixaDe(score)
  return {
    vinculoId: vinculo.id, alunoId,
    nome: vinculo.aluno?.lead?.nome ?? `Aluno #${alunoId}`,
    ra: vinculo.aluno?.ra ?? null,
    score, faixa, fatores,
    acaoSugerida: acaoDe(faixa, fatores),
  }
}

/** Lista priorizada — é o playbook de retenção do dia. */
export async function painelRisco(opcoes: { courseId?: number; faixaMinima?: number } = {}) {
  const vinculos = await prisma.acaVinculo.findMany({
    where: { situacao: 'ATIVO', ...(opcoes.courseId ? { courseId: opcoes.courseId } : {}) },
    select: { id: true },
  })
  const linhas: RiscoEvasao[] = []
  for (const v of vinculos) {
    const r = await calcularRisco(v.id)
    if (r && r.score >= (opcoes.faixaMinima ?? 0)) linhas.push(r)
  }
  linhas.sort((a, b) => b.score - a.score)
  return {
    linhas,
    total: linhas.length,
    porFaixa: {
      CRITICO: linhas.filter((l) => l.faixa === 'CRITICO').length,
      ALTO: linhas.filter((l) => l.faixa === 'ALTO').length,
      MEDIO: linhas.filter((l) => l.faixa === 'MEDIO').length,
      BAIXO: linhas.filter((l) => l.faixa === 'BAIXO').length,
    },
  }
}
