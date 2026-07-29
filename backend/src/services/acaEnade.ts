// src/services/acaEnade.ts
//
// Regularidade no ENADE e a trava da colação de grau (RN-1104).
//
// O ENADE é componente curricular obrigatório: aluno irregular NÃO cola grau.
// A dispensa existe (o edital prevê hipóteses), mas precisa estar documentada —
// por isso liberar exige motivo e documento, não um clique. Sem essa trava, a
// IES emite diploma que depois não se sustenta em auditoria do MEC.

import { prisma } from '../lib/prisma.js'

export type SituacaoEnade = 'PENDENTE' | 'INSCRITO' | 'PARTICIPOU' | 'DISPENSADO' | 'IRREGULAR'

/** Situações que liberam a colação. */
const REGULARES: SituacaoEnade[] = ['PARTICIPOU', 'DISPENSADO']

export interface VerificacaoEnade {
  regular: boolean
  motivo: string
  registros: Array<{ ano: number; condicao: string; situacao: string }>
}

/**
 * O aluno está regular para colar grau?
 *
 * Sem nenhum registro, o resultado é IRREGULAR por omissão — e isso é
 * proposital: a ausência de informação não pode virar liberação automática,
 * senão a trava não trava nada.
 */
export async function verificarRegularidade(alunoId: number): Promise<VerificacaoEnade> {
  const registros = await prisma.acaEnadeRegularidade.findMany({
    where: { alunoId },
    orderBy: { ano: 'desc' },
    select: { ano: true, condicao: true, situacao: true },
  })
  if (registros.length === 0) {
    return {
      regular: false,
      motivo: 'Sem registro de participação no ENADE — a regularidade precisa ser informada antes da colação.',
      registros: [],
    }
  }
  const pendentes = registros.filter((r) => !REGULARES.includes(r.situacao as SituacaoEnade))
  if (pendentes.length > 0) {
    const lista = pendentes.map((p) => `${p.ano} (${p.condicao.toLowerCase()}: ${p.situacao.toLowerCase()})`).join(', ')
    return { regular: false, motivo: `Pendência no ENADE: ${lista}.`, registros }
  }
  return { regular: true, motivo: 'Regular no ENADE.', registros }
}

/** Registra ou atualiza a condição do aluno num ciclo. */
export async function registrar(params: {
  alunoId: number
  ano: number
  condicao: 'INGRESSANTE' | 'CONCLUINTE'
  situacao: SituacaoEnade
  dispensaMotivo?: string | null
  documentoUrl?: string | null
  observacao?: string | null
  registradoPor?: number | null
}) {
  // Dispensa sem documentação é o caminho fácil para burlar a trava.
  if (params.situacao === 'DISPENSADO' && !params.dispensaMotivo?.trim()) {
    throw new Error('Dispensa do ENADE exige motivo documentado.')
  }
  const dados = {
    situacao: params.situacao,
    dispensaMotivo: params.dispensaMotivo ?? null,
    documentoUrl: params.documentoUrl ?? null,
    observacao: params.observacao ?? null,
    registradoPor: params.registradoPor ?? null,
  }
  return prisma.acaEnadeRegularidade.upsert({
    where: { alunoId_ano_condicao: { alunoId: params.alunoId, ano: params.ano, condicao: params.condicao } },
    create: { alunoId: params.alunoId, ano: params.ano, condicao: params.condicao, ...dados },
    update: dados,
  })
}

/**
 * Painel de regularidade: quem está travado para colar grau.
 * Cruza os concluintes com os registros do ENADE.
 */
export async function painelRegularidade() {
  const concluintes = await prisma.acaVinculo.findMany({
    where: { situacao: { in: ['FORMADO', 'ATIVO'] } },
    select: { id: true, alunoId: true, situacao: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
  })
  const out: Array<{ vinculoId: number; alunoId: number; nome: string; ra: string | null; situacaoVinculo: string; regular: boolean; motivo: string }> = []
  for (const v of concluintes) {
    const r = await verificarRegularidade(v.alunoId)
    out.push({
      vinculoId: v.id, alunoId: v.alunoId,
      nome: v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`,
      ra: v.aluno?.ra ?? null,
      situacaoVinculo: v.situacao,
      regular: r.regular, motivo: r.motivo,
    })
  }
  return out
}
