// src/services/acaAvaliacao.ts
//
// Motor de avaliação configurável (M08 / RF-801).
//
// Antes disto, a apuração usava cinco parâmetros GLOBAIS em Setting
// (aca.media_aprovacao, aca.frequencia_minima…). Como cada IES tem seu
// regimento, todo cliente novo virava customização de código. Agora o regimento
// é dado: componentes de nota, fórmula, escala, exame e frequência mínima,
// resolvidos em cascata do mais específico para o mais geral.
//
// A fórmula é avaliada por um interpretador próprio (shunting-yard). NÃO se usa
// `eval` nem `new Function`: a expressão vem de campo editável na interface, e
// executar string do usuário no servidor seria execução remota de código.

import { prisma } from '../lib/prisma.js'
import type { AcaEsquemaAvaliacao, AcaEsquemaComponente } from '@prisma/client'

export type EsquemaCompleto = AcaEsquemaAvaliacao & { componentes: AcaEsquemaComponente[] }

// ─────────────────────────────────────────────────────────────
// Avaliador de expressões (subconjunto seguro)
//
// Aceita: números, variáveis (letras/dígitos/_), + - * / ( ) e o unário -.
// Qualquer outro caractere é recusado antes de avaliar.
// ─────────────────────────────────────────────────────────────

type Token = { t: 'num'; v: number } | { t: 'var'; v: string } | { t: 'op'; v: string } | { t: 'par'; v: '(' | ')' }

export class FormulaInvalidaError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FormulaInvalidaError' }
}

function tokenizar(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]!
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9.]/.test(c)) {
      let n = ''
      while (i < expr.length && /[0-9.]/.test(expr[i]!)) n += expr[i++]
      const v = Number(n)
      if (!Number.isFinite(v)) throw new FormulaInvalidaError(`Número inválido: "${n}"`)
      tokens.push({ t: 'num', v })
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = ''
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i]!)) s += expr[i++]
      tokens.push({ t: 'var', v: s.toUpperCase() })
      continue
    }
    if ('+-*/'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue }
    if (c === '(' || c === ')') { tokens.push({ t: 'par', v: c }); i++; continue }
    throw new FormulaInvalidaError(`Caractere não permitido na fórmula: "${c}"`)
  }
  return tokens
}

const PRECEDENCIA: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

/** Converte para notação polonesa reversa (shunting-yard). */
function paraRPN(tokens: Token[]): Token[] {
  const saida: Token[] = []
  const pilha: Token[] = []
  let anterior: Token | null = null
  for (const tk of tokens) {
    if (tk.t === 'num' || tk.t === 'var') { saida.push(tk); anterior = tk; continue }
    if (tk.t === 'op') {
      // Unário: "-N1" ou "(-3)" → 0 - N1
      const unario = tk.v === '-' && (anterior === null || (anterior.t === 'op') || (anterior.t === 'par' && anterior.v === '('))
      if (unario) saida.push({ t: 'num', v: 0 })
      while (pilha.length) {
        const topo = pilha[pilha.length - 1]!
        if (topo.t === 'op' && PRECEDENCIA[topo.v]! >= PRECEDENCIA[tk.v]!) saida.push(pilha.pop()!)
        else break
      }
      pilha.push(tk); anterior = tk; continue
    }
    if (tk.v === '(') { pilha.push(tk); anterior = tk; continue }
    // ')'
    let achouAbre = false
    while (pilha.length) {
      const topo = pilha.pop()!
      if (topo.t === 'par' && topo.v === '(') { achouAbre = true; break }
      saida.push(topo)
    }
    if (!achouAbre) throw new FormulaInvalidaError('Parênteses desbalanceados')
    anterior = tk
  }
  while (pilha.length) {
    const topo = pilha.pop()!
    if (topo.t === 'par') throw new FormulaInvalidaError('Parênteses desbalanceados')
    saida.push(topo)
  }
  return saida
}

/**
 * Avalia a expressão com as variáveis dadas. Variável ausente vira erro — é
 * melhor falhar do que fechar uma média com nota faltando valendo zero.
 */
export function avaliarFormula(expr: string, variaveis: Record<string, number>): number {
  const rpn = paraRPN(tokenizar(expr))
  const pilha: number[] = []
  const vars: Record<string, number> = {}
  for (const [k, v] of Object.entries(variaveis)) vars[k.toUpperCase()] = v

  for (const tk of rpn) {
    if (tk.t === 'num') { pilha.push(tk.v); continue }
    if (tk.t === 'var') {
      const v = vars[tk.v]
      if (v === undefined) throw new FormulaInvalidaError(`Variável "${tk.v}" não tem valor`)
      pilha.push(v); continue
    }
    if (tk.t === 'op') {
      const b = pilha.pop(), a = pilha.pop()
      if (a === undefined || b === undefined) throw new FormulaInvalidaError('Expressão malformada')
      if (tk.v === '+') pilha.push(a + b)
      else if (tk.v === '-') pilha.push(a - b)
      else if (tk.v === '*') pilha.push(a * b)
      else {
        if (b === 0) throw new FormulaInvalidaError('Divisão por zero na fórmula')
        pilha.push(a / b)
      }
      continue
    }
    throw new FormulaInvalidaError('Expressão malformada')
  }
  if (pilha.length !== 1) throw new FormulaInvalidaError('Expressão malformada')
  return pilha[0]!
}

/** Confere a fórmula contra as siglas disponíveis, sem executar de verdade. */
export function validarFormula(expr: string, siglas: string[]): { ok: boolean; erro?: string } {
  try {
    const fake: Record<string, number> = {}
    for (const s of siglas) fake[s.toUpperCase()] = 1
    // MP/EX aparecem na fórmula final; damos valor para a validação passar.
    fake.MP = 1; fake.EX = 1
    avaliarFormula(expr, fake)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, erro: e?.message || 'Fórmula inválida' }
  }
}

// ─────────────────────────────────────────────────────────────
// Resolução do esquema (herança em cascata)
// ─────────────────────────────────────────────────────────────

/**
 * Esquema efetivo para uma disciplina: DISCIPLINA → MATRIZ → CURSO →
 * INSTITUCIONAL, o primeiro que existir. É o que permite a IES definir uma
 * regra geral e abrir exceção só onde precisa.
 */
export async function resolverEsquema(ctx: {
  disciplinaId?: number | null
  matrizId?: number | null
  courseId?: number | null
}): Promise<EsquemaCompleto | null> {
  const tentativas: Array<{ escopo: any; escopoId: number | null }> = []
  if (ctx.disciplinaId) tentativas.push({ escopo: 'DISCIPLINA', escopoId: ctx.disciplinaId })
  if (ctx.matrizId) tentativas.push({ escopo: 'MATRIZ', escopoId: ctx.matrizId })
  if (ctx.courseId) tentativas.push({ escopo: 'CURSO', escopoId: ctx.courseId })
  tentativas.push({ escopo: 'INSTITUCIONAL', escopoId: null })

  for (const t of tentativas) {
    const esquema = await prisma.acaEsquemaAvaliacao.findFirst({
      where: { escopo: t.escopo, escopoId: t.escopoId, ativo: true },
      include: { componentes: { orderBy: { ordem: 'asc' } } },
    })
    if (esquema) return esquema
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Cálculo
// ─────────────────────────────────────────────────────────────

export function arredondar(valor: number, casas: number, regra: string): number {
  const f = Math.pow(10, casas)
  if (regra === 'CIMA') return Math.ceil(valor * f) / f
  if (regra === 'BAIXO') return Math.floor(valor * f) / f
  return Math.round(valor * f) / f
}

export interface ResultadoCalculo {
  media: number | null
  mediaFinal: number | null
  situacao: 'APROVADO' | 'EXAME' | 'REPROVADO_NOTA' | 'REPROVADO_FREQUENCIA' | 'REPROVADO_NOTA_FREQUENCIA' | 'EM_ANDAMENTO'
  /** Por que deu isso — a secretaria precisa explicar ao aluno. */
  explicacao: string
  faltamNotas: string[]
}

/**
 * Calcula média e situação de um aluno numa disciplina.
 * `notas` são as notas por sigla do componente; `notaExame` é opcional.
 */
export function calcular(
  esquema: EsquemaCompleto,
  notas: Record<string, number | null | undefined>,
  frequenciaPct: number,
  notaExame?: number | null,
): ResultadoCalculo {
  const reprovadoFreq = frequenciaPct < esquema.frequenciaMinima

  // Componentes obrigatórios sem nota impedem o fechamento.
  const faltamNotas = esquema.componentes
    .filter((c) => c.obrigatorio && (notas[c.sigla] === null || notas[c.sigla] === undefined))
    .map((c) => c.sigla)

  if (faltamNotas.length > 0) {
    return {
      media: null, mediaFinal: null,
      situacao: reprovadoFreq ? 'REPROVADO_FREQUENCIA' : 'EM_ANDAMENTO',
      explicacao: reprovadoFreq
        ? `Frequência ${frequenciaPct}% abaixo do mínimo de ${esquema.frequenciaMinima}%.`
        : `Aguardando lançamento de: ${faltamNotas.join(', ')}.`,
      faltamNotas,
    }
  }

  // Média parcial: fórmula quando houver, senão ponderada pelos pesos.
  const vars: Record<string, number> = {}
  for (const c of esquema.componentes) vars[c.sigla] = Number(notas[c.sigla] ?? 0)

  let media: number
  if (esquema.formulaMedia && esquema.formulaMedia.trim()) {
    media = avaliarFormula(esquema.formulaMedia, vars)
  } else {
    const somaPesos = esquema.componentes.reduce((s, c) => s + c.peso, 0)
    media = somaPesos > 0
      ? esquema.componentes.reduce((s, c) => s + Number(notas[c.sigla] ?? 0) * c.peso, 0) / somaPesos
      : 0
  }
  media = arredondar(media, esquema.casasDecimais, esquema.arredondamento)

  // Nota eliminatória: qualquer componente abaixo do piso reprova direto.
  if (esquema.notaEliminatoria != null) {
    const abaixo = esquema.componentes.filter((c) => Number(notas[c.sigla] ?? 0) < esquema.notaEliminatoria!)
    if (abaixo.length > 0) {
      return {
        media, mediaFinal: media,
        situacao: reprovadoFreq ? 'REPROVADO_NOTA_FREQUENCIA' : 'REPROVADO_NOTA',
        explicacao: `Nota abaixo da mínima eliminatória (${esquema.notaEliminatoria}) em: ${abaixo.map((c) => c.sigla).join(', ')}.`,
        faltamNotas: [],
      }
    }
  }

  // Exame final: a nota do exame entra pela fórmula final.
  if (notaExame != null && esquema.exameHabilitado) {
    const finalCalc = esquema.formulaFinal && esquema.formulaFinal.trim()
      ? avaliarFormula(esquema.formulaFinal, { ...vars, MP: media, EX: notaExame })
      : (media + notaExame) / 2
    const mediaFinal = arredondar(finalCalc, esquema.casasDecimais, esquema.arredondamento)
    const piso = esquema.mediaFinalAprovacao ?? esquema.mediaAprovacao
    const aprovado = mediaFinal >= piso
    return {
      media, mediaFinal,
      situacao: reprovadoFreq
        ? (aprovado ? 'REPROVADO_FREQUENCIA' : 'REPROVADO_NOTA_FREQUENCIA')
        : (aprovado ? 'APROVADO' : 'REPROVADO_NOTA'),
      explicacao: reprovadoFreq
        ? `Frequência ${frequenciaPct}% abaixo do mínimo de ${esquema.frequenciaMinima}%.`
        : `Média final ${mediaFinal} ${aprovado ? '≥' : '<'} ${piso} (após exame).`,
      faltamNotas: [],
    }
  }

  const aprovadoDireto = media >= esquema.mediaAprovacao
  const vaiParaExame = !aprovadoDireto && esquema.exameHabilitado
    && esquema.exameMinimo != null && media >= esquema.exameMinimo

  if (reprovadoFreq) {
    return {
      media, mediaFinal: media,
      situacao: aprovadoDireto ? 'REPROVADO_FREQUENCIA' : 'REPROVADO_NOTA_FREQUENCIA',
      explicacao: `Frequência ${frequenciaPct}% abaixo do mínimo de ${esquema.frequenciaMinima}%.`,
      faltamNotas: [],
    }
  }
  if (aprovadoDireto) {
    return { media, mediaFinal: media, situacao: 'APROVADO', explicacao: `Média ${media} ≥ ${esquema.mediaAprovacao}.`, faltamNotas: [] }
  }
  if (vaiParaExame) {
    return { media, mediaFinal: null, situacao: 'EXAME', explicacao: `Média ${media} na faixa de exame (${esquema.exameMinimo} a ${esquema.mediaAprovacao}).`, faltamNotas: [] }
  }
  return { media, mediaFinal: media, situacao: 'REPROVADO_NOTA', explicacao: `Média ${media} < ${esquema.mediaAprovacao}.`, faltamNotas: [] }
}

/** Piso legal do ensino superior — a IES pode exigir mais, nunca menos. */
export const FREQUENCIA_MINIMA_LEGAL = 75
