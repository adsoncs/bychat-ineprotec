// src/services/acaMatriz.ts
//
// Ciclo de vida da matriz curricular (Documento Mestre, RN-003 / RN-501).
//
// A regra que sustenta tudo: matriz com aluno vinculado é IMUTÁVEL. Mudança de
// grade vira nova versão, e o aluno migra apenas por adaptação curricular
// formal. Sem isso, alterar uma matriz reescreveria o passado de quem já cursou.

import { prisma } from '../lib/prisma.js'
import type { AcaMatrizStatus } from '@prisma/client'

export class MatrizImutavelError extends Error {
  constructor(matrizId: number, motivo: string) {
    super(`Matriz ${matrizId} não pode ser alterada: ${motivo}`)
    this.name = 'MatrizImutavelError'
  }
}

export interface ProblemaValidacao {
  tipo: 'ciclo_prerequisito' | 'ch_divergente' | 'componente_invalido' | 'sem_componentes'
  mensagem: string
  detalhe?: unknown
}

/** Matriz só aceita edição de componentes enquanto está em RASCUNHO. */
export async function garantirEditavel(matrizId: number): Promise<void> {
  const matriz = await prisma.acaMatriz.findUnique({ where: { id: matrizId }, select: { status: true } })
  if (!matriz) throw new Error(`Matriz ${matrizId} não encontrada`)
  if (matriz.status !== 'RASCUNHO') {
    const alunos = await prisma.acaVinculo.count({ where: { matrizId } })
    throw new MatrizImutavelError(
      matrizId,
      alunos > 0
        ? `está ${matriz.status} e tem ${alunos} aluno(s) vinculado(s) — crie uma nova versão`
        : `está ${matriz.status} — só matriz em RASCUNHO aceita edição`,
    )
  }
}

/**
 * Detecta ciclo no grafo de pré-requisitos (RN-501). Um ciclo trava o aluno para
 * sempre: A exige B, B exige A, nenhum dos dois pode ser cursado.
 * Busca em profundidade com marcação de cinza/preto.
 */
export function detectarCiclos(
  componentes: Array<{ id: number; nome: string }>,
  arestas: Array<{ componenteId: number; requisitoId: number }>,
): number[][] {
  const adj = new Map<number, number[]>()
  for (const a of arestas) {
    // aresta: requisito → componente (o requisito vem antes)
    adj.set(a.requisitoId, [...(adj.get(a.requisitoId) ?? []), a.componenteId])
  }
  const cor = new Map<number, 0 | 1 | 2>() // 0 branco, 1 cinza, 2 preto
  const pilha: number[] = []
  const ciclos: number[][] = []

  function visitar(no: number) {
    cor.set(no, 1)
    pilha.push(no)
    for (const viz of adj.get(no) ?? []) {
      const c = cor.get(viz) ?? 0
      if (c === 0) visitar(viz)
      else if (c === 1) {
        const i = pilha.indexOf(viz)
        ciclos.push(pilha.slice(i >= 0 ? i : 0).concat(viz))
      }
    }
    pilha.pop()
    cor.set(no, 2)
  }

  for (const c of componentes) if ((cor.get(c.id) ?? 0) === 0) visitar(c.id)
  return ciclos
}

/**
 * Valida a matriz para ativação: sem ciclos de pré-requisito, com componentes e
 * com a CH batendo com o declarado no PPC (quando declarado).
 */
export async function validar(matrizId: number): Promise<{ ok: boolean; problemas: ProblemaValidacao[] }> {
  const matriz = await prisma.acaMatriz.findUnique({
    where: { id: matrizId },
    include: { componentes: { include: { disciplina: { select: { nome: true, cargaHoraria: true } } } } },
  })
  if (!matriz) throw new Error(`Matriz ${matrizId} não encontrada`)

  const problemas: ProblemaValidacao[] = []
  if (matriz.componentes.length === 0) {
    problemas.push({ tipo: 'sem_componentes', mensagem: 'A matriz não tem nenhum componente curricular.' })
    return { ok: false, problemas }
  }

  // ── Ciclos de pré-requisito ──
  const ids = matriz.componentes.map((c) => c.id)
  const preReqs = await prisma.acaPreRequisito.findMany({
    where: { componenteId: { in: ids } },
    select: { componenteId: true, componenteRequeridoId: true },
  })
  const ciclos = detectarCiclos(
    matriz.componentes.map((c) => ({ id: c.id, nome: c.disciplina?.nome ?? String(c.id) })),
    preReqs.map((p) => ({ componenteId: p.componenteId, requisitoId: p.componenteRequeridoId })),
  )
  if (ciclos.length > 0) {
    const nomePor = new Map(matriz.componentes.map((c) => [c.id, c.disciplina?.nome ?? `#${c.id}`]))
    for (const ciclo of ciclos) {
      problemas.push({
        tipo: 'ciclo_prerequisito',
        mensagem: `Ciclo de pré-requisitos: ${ciclo.map((id) => nomePor.get(id) ?? id).join(' → ')}`,
        detalhe: ciclo,
      })
    }
  }

  // ── Carga horária por balde vs. o declarado ──
  const somaPorTipo = new Map<string, number>()
  for (const c of matriz.componentes) {
    const ch = c.chTotal ?? c.disciplina?.cargaHoraria ?? 0
    somaPorTipo.set(c.tipo, (somaPorTipo.get(c.tipo) ?? 0) + ch)
  }
  const esperado: Array<[string, number | null]> = [
    ['OBRIGATORIA', matriz.chObrigatoria],
    ['ELETIVA', matriz.chEletiva],
    ['OPTATIVA', matriz.chOptativa],
    ['ESTAGIO', matriz.chEstagio],
    ['TCC', matriz.chTcc],
    ['ATIVIDADE_COMPLEMENTAR', matriz.chComplementar],
    ['EXTENSAO', matriz.chExtensao],
  ]
  for (const [tipo, alvo] of esperado) {
    if (alvo == null) continue // não declarado no PPC = não confere
    const soma = somaPorTipo.get(tipo) ?? 0
    if (soma !== alvo) {
      problemas.push({
        tipo: 'ch_divergente',
        mensagem: `CH de ${tipo}: componentes somam ${soma}h, o PPC declara ${alvo}h`,
        detalhe: { tipo, soma, alvo },
      })
    }
  }

  // ── Componentes sem disciplina válida ──
  const semDisciplina = matriz.componentes.filter((c) => !c.disciplina)
  if (semDisciplina.length > 0) {
    problemas.push({
      tipo: 'componente_invalido',
      mensagem: `${semDisciplina.length} componente(s) sem disciplina válida no catálogo`,
      detalhe: semDisciplina.map((c) => c.id),
    })
  }

  return { ok: problemas.length === 0, problemas }
}

/** Transições de status da matriz. EXTINTA e ATIVA não voltam para RASCUNHO. */
const TRANSICOES_MATRIZ: Record<AcaMatrizStatus, AcaMatrizStatus[]> = {
  RASCUNHO: ['ATIVA'],
  ATIVA:    ['SUSPENSA', 'EXTINTA'],
  SUSPENSA: ['ATIVA', 'EXTINTA'],
  EXTINTA:  [],
}

/**
 * Ativa a matriz — só passa se a validação estrutural estiver limpa. É aqui que
 * a matriz deixa de ser editável.
 */
export async function ativar(matrizId: number, ctx: { userId?: number }) {
  const matriz = await prisma.acaMatriz.findUnique({ where: { id: matrizId }, select: { status: true } })
  if (!matriz) throw new Error(`Matriz ${matrizId} não encontrada`)
  if (matriz.status !== 'RASCUNHO') throw new Error(`Só matriz em RASCUNHO pode ser ativada (está ${matriz.status})`)

  const { ok, problemas } = await validar(matrizId)
  if (!ok) {
    const err: any = new Error('Matriz não passou na validação estrutural')
    err.problemas = problemas
    throw err
  }
  return prisma.acaMatriz.update({
    where: { id: matrizId },
    data: { status: 'ATIVA', ativo: true, publicadaEm: new Date(), publicadaPor: ctx.userId ?? null },
  })
}

export async function mudarStatus(matrizId: number, para: AcaMatrizStatus) {
  const matriz = await prisma.acaMatriz.findUnique({ where: { id: matrizId }, select: { status: true } })
  if (!matriz) throw new Error(`Matriz ${matrizId} não encontrada`)
  if (!(TRANSICOES_MATRIZ[matriz.status] ?? []).includes(para)) {
    throw new Error(`Transição de matriz inválida: ${matriz.status} → ${para}`)
  }
  return prisma.acaMatriz.update({
    where: { id: matrizId },
    // SUSPENSA/EXTINTA não recebem ingressantes — `ativo` reflete isso para o
    // código antigo que ainda filtra por ele.
    data: { status: para, ativo: para === 'ATIVA' },
  })
}

/**
 * Clona a matriz como nova versão em RASCUNHO, com todos os componentes e
 * pré-requisitos. É o caminho legítimo para "alterar" uma matriz já ativa.
 */
export async function clonar(matrizId: number, novaVersao: string) {
  const origem = await prisma.acaMatriz.findUnique({
    where: { id: matrizId },
    include: { componentes: true },
  })
  if (!origem) throw new Error(`Matriz ${matrizId} não encontrada`)

  return prisma.$transaction(async (tx) => {
    const nova = await tx.acaMatriz.create({
      data: {
        courseId: origem.courseId,
        versao: novaVersao.substring(0, 40),
        nome: origem.nome,
        status: 'RASCUNHO',
        ativo: false,
        chObrigatoria: origem.chObrigatoria, chEletiva: origem.chEletiva, chOptativa: origem.chOptativa,
        chEstagio: origem.chEstagio, chTcc: origem.chTcc, chComplementar: origem.chComplementar,
        chExtensao: origem.chExtensao,
      },
    })
    // De→para dos componentes, para reapontar os pré-requisitos na cópia.
    const mapa = new Map<number, number>()
    for (const c of origem.componentes) {
      const novo = await tx.acaComponente.create({
        data: {
          matrizId: nova.id, disciplinaId: c.disciplinaId, fase: c.fase, obrigatoria: c.obrigatoria,
          tipo: c.tipo, chTotal: c.chTotal, chTeorica: c.chTeorica, chPratica: c.chPratica,
          chExtensao: c.chExtensao, grupoEletiva: c.grupoEletiva, ordem: c.ordem,
        },
      })
      mapa.set(c.id, novo.id)
    }
    const preReqs = await tx.acaPreRequisito.findMany({ where: { componenteId: { in: [...mapa.keys()] } } })
    for (const p of preReqs) {
      const compNovo = mapa.get(p.componenteId)
      const reqNovo = mapa.get(p.componenteRequeridoId)
      if (compNovo && reqNovo) {
        await tx.acaPreRequisito.create({ data: { componenteId: compNovo, componenteRequeridoId: reqNovo } })
      }
    }
    return nova
  })
}
