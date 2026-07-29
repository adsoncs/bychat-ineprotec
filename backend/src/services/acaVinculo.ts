// src/services/acaVinculo.ts
//
// Vínculo acadêmico: a relação aluno↔curso/matriz que carrega o RA e a situação.
// É a âncora que faltava — histórico, integralização e requisitos de formatura
// se calculam contra a MATRIZ deste vínculo, não contra o curso genérico
// (Documento Mestre, RN-004).
//
// Toda mudança de situação passa por `mover()`. Nenhuma situação muda por
// edição direta de campo (RN-006), e reversão só existe como
// contra-movimentação (RN-403) — nunca apagando o que aconteceu.

import { prisma } from '../lib/prisma.js'
import type { AcaVinculoSituacao } from '@prisma/client'

/**
 * Transições permitidas (§19.1 do Documento Mestre). Qualquer par fora desta
 * lista é rejeitado — é o que impede o histórico de contar uma história
 * impossível, como um aluno cancelado voltando a "formado" por engano.
 *
 * FALECIDO é alcançável de qualquer situação e não sai de lá.
 */
const TRANSICOES: Record<AcaVinculoSituacao, AcaVinculoSituacao[]> = {
  PRE_MATRICULADO: ['ATIVO', 'CANCELADO'],
  ATIVO:           ['TRANCADO', 'CANCELADO', 'TRANSFERIDO', 'EVADIDO', 'FORMADO'],
  TRANCADO:        ['ATIVO', 'CANCELADO', 'EVADIDO'],
  EVADIDO:         ['ATIVO'], // reingresso
  FORMADO:         ['DIPLOMADO'],
  DIPLOMADO:       [],
  TRANSFERIDO:     [],
  CANCELADO:       [],
  FALECIDO:        [],
}

export class TransicaoInvalidaError extends Error {
  constructor(de: AcaVinculoSituacao, para: AcaVinculoSituacao) {
    super(`Transição inválida: ${de} → ${para}`)
    this.name = 'TransicaoInvalidaError'
  }
}

export function transicaoPermitida(de: AcaVinculoSituacao, para: AcaVinculoSituacao): boolean {
  if (para === 'FALECIDO') return de !== 'FALECIDO'
  return (TRANSICOES[de] ?? []).includes(para)
}

/** Situações que o aluno pode alcançar a partir de onde está (para a UI). */
export function proximasSituacoes(de: AcaVinculoSituacao): AcaVinculoSituacao[] {
  const lista = [...(TRANSICOES[de] ?? [])]
  if (de !== 'FALECIDO') lista.push('FALECIDO')
  return lista
}

export interface MoverParams {
  vinculoId: number
  para: AcaVinculoSituacao
  motivo?: string | undefined
  observacao?: string | undefined
  dataEfeito?: Date | undefined
  documentoUrl?: string | undefined
  userId?: number | undefined
  userName?: string | undefined
  /** Movimentação que está sendo estornada por esta. */
  estornoDeId?: number | undefined
  metadata?: Record<string, unknown> | undefined
}

/**
 * Move o vínculo para outra situação, registrando a movimentação. A escrita é
 * transacional: ou a situação muda e fica registrada, ou nada acontece.
 */
export async function mover(p: MoverParams) {
  const vinculo = await prisma.acaVinculo.findUnique({
    where: { id: p.vinculoId },
    select: { id: true, situacao: true, dataConclusao: true },
  })
  if (!vinculo) throw new Error(`Vínculo ${p.vinculoId} não encontrado`)

  const de = vinculo.situacao
  if (de === p.para) return { vinculo, movimentacao: null, semEfeito: true as const }
  if (!transicaoPermitida(de, p.para)) throw new TransicaoInvalidaError(de, p.para)

  const dataEfeito = p.dataEfeito ?? new Date()

  return prisma.$transaction(async (tx) => {
    const movimentacao = await tx.acaVinculoMovimentacao.create({
      data: {
        vinculoId: p.vinculoId,
        de, para: p.para,
        motivo: p.motivo?.substring(0, 191) ?? null,
        observacao: p.observacao ?? null,
        dataEfeito,
        documentoUrl: p.documentoUrl ?? null,
        userId: p.userId ?? null,
        userName: p.userName?.substring(0, 100) ?? null,
        estornoDeId: p.estornoDeId ?? null,
        metadata: (p.metadata as any) ?? undefined,
      },
    })
    const atualizado = await tx.acaVinculo.update({
      where: { id: p.vinculoId },
      data: {
        situacao: p.para,
        // Conclusão fica registrada quando o aluno forma; falecimento marca o
        // vínculo como sensível para suspender cobrança e disparo automático.
        ...(p.para === 'FORMADO' && !vinculo.dataConclusao ? { dataConclusao: dataEfeito } : {}),
        ...(p.para === 'FALECIDO' ? { sensivel: true } : {}),
      },
    })
    return { vinculo: atualizado, movimentacao, semEfeito: false as const }
  })
}

/**
 * Estorna uma movimentação: devolve o vínculo à situação anterior por meio de
 * uma nova movimentação que aponta para a estornada. O histórico mantém as duas.
 */
export async function estornar(movimentacaoId: number, ctx: { userId?: number; userName?: string; motivo?: string }) {
  const mov = await prisma.acaVinculoMovimentacao.findUnique({ where: { id: movimentacaoId } })
  if (!mov) throw new Error(`Movimentação ${movimentacaoId} não encontrada`)
  if (!mov.de) throw new Error('Movimentação inicial não pode ser estornada (não há situação anterior)')

  const vinculo = await prisma.acaVinculo.findUnique({ where: { id: mov.vinculoId }, select: { situacao: true } })
  if (!vinculo) throw new Error('Vínculo não encontrado')
  if (vinculo.situacao !== mov.para) {
    throw new Error(`Só a última movimentação pode ser estornada (situação atual: ${vinculo.situacao})`)
  }
  // O estorno não passa pela whitelist: ele desfaz um passo que já foi validado
  // na ida. Exigir a transição inversa impediria desfazer erros legítimos
  // (ex.: cancelamento lançado por engano, que não tem volta pela whitelist).
  return prisma.$transaction(async (tx) => {
    const nova = await tx.acaVinculoMovimentacao.create({
      data: {
        vinculoId: mov.vinculoId,
        de: mov.para, para: mov.de!,
        motivo: (ctx.motivo ?? `Estorno da movimentação #${mov.id}`).substring(0, 191),
        dataEfeito: new Date(),
        userId: ctx.userId ?? null,
        userName: ctx.userName?.substring(0, 100) ?? null,
        estornoDeId: mov.id,
      },
    })
    const atualizado = await tx.acaVinculo.update({
      where: { id: mov.vinculoId },
      data: {
        situacao: mov.de!,
        ...(mov.para === 'FORMADO' ? { dataConclusao: null } : {}),
        ...(mov.para === 'FALECIDO' ? { sensivel: false } : {}),
      },
    })
    return { vinculo: atualizado, movimentacao: nova }
  })
}

/**
 * Cria o vínculo do aluno no curso. Nasce em PRE_MATRICULADO e já registra a
 * movimentação inicial, para a linha do tempo começar no ato.
 */
export async function criar(dados: {
  alunoId: number
  courseId: number
  matrizId?: number | null
  unidadeId?: number | null
  ra?: string | null
  formaIngresso?: string | null
  turno?: any
  dataIngresso?: Date | null
  userId?: number | null
  userName?: string | null
}) {
  return prisma.$transaction(async (tx) => {
    const vinculo = await tx.acaVinculo.create({
      data: {
        alunoId: dados.alunoId,
        courseId: dados.courseId,
        matrizId: dados.matrizId ?? null,
        unidadeId: dados.unidadeId ?? null,
        ra: dados.ra ?? null,
        formaIngresso: dados.formaIngresso ?? null,
        turno: dados.turno ?? null,
        dataIngresso: dados.dataIngresso ?? new Date(),
        situacao: 'PRE_MATRICULADO',
      },
    })
    await tx.acaVinculoMovimentacao.create({
      data: {
        vinculoId: vinculo.id,
        de: null, para: 'PRE_MATRICULADO',
        motivo: 'Criação do vínculo',
        userId: dados.userId ?? null,
        userName: dados.userName?.substring(0, 100) ?? null,
      },
    })
    return vinculo
  })
}
