// src/services/acaQualificacao.ts
//
// Certificação intermediária de qualificação profissional (fase T2).
//
// Res. CNE/CP 1/2021, art. 49, §2º:
//
//   "Ao estudante que concluir a unidade curricular, etapa ou módulo de curso
//    técnico [...] com terminalidade que caracterize efetiva qualificação
//    profissional técnica [...] SERÁ conferido certificado de qualificação
//    profissional correspondente, no qual deve ser explicitado o título obtido
//    e a carga horária da formação."
//
// "Será conferido" é obrigação. Quem concluiu o módulo tem direito ao
// certificado mesmo que abandone o curso depois — e é justamente esse aluno que
// mais precisa dele, porque é o documento que ele leva para o mercado.
//
// Por isso a emissão NÃO exige a matrícula concluída (ao contrário de
// `emitirCertificado`, que é do curso todo). Ela exige apenas: o módulo declara
// um título de qualificação, e o aluno cumpriu os componentes daquele módulo.

import { prisma } from '../lib/prisma.js'
import { calcular } from './acaIntegralizacao.js'

export interface ModuloProgresso {
  moduloId: number
  numero: number
  nome: string
  tituloQualificacao: string | null
  codigoCbo: string | null
  /** Tem terminalidade: concluir gera direito a certificado. */
  temTerminalidade: boolean
  cargaHoraria: number
  componentes: number
  cumpridos: number
  pendentes: string[]
  concluido: boolean
  /** Documento já emitido para este módulo, se houver. */
  certificadoId: number | null
  certificadoNumero: string | null
}

/**
 * Progresso do aluno em cada módulo da matriz do vínculo.
 *
 * Reusa a integralização em vez de recalcular: se o "cumprido" daqui divergisse
 * do "cumprido" de lá, o aluno veria uma coisa no plano de estudos e outra na
 * certificação — e a divergência apareceria no pior momento.
 */
export async function progressoModulos(vinculoId: number): Promise<ModuloProgresso[]> {
  const vinculo = await prisma.acaVinculo.findUnique({
    where: { id: vinculoId },
    select: { id: true, matrizId: true, alunoId: true },
  })
  if (!vinculo?.matrizId) return []

  const modulos = await prisma.acaMatrizModulo.findMany({
    where: { matrizId: vinculo.matrizId },
    orderBy: { numero: 'asc' },
    include: { componentes: { select: { id: true, chTotal: true, disciplina: { select: { cargaHoraria: true } } } } },
  })
  if (modulos.length === 0) return []

  const integralizacao = await calcular(vinculoId)
  const statusPorComponente = new Map(integralizacao.componentes.map((c) => [c.componenteId, c]))

  // Certificados de qualificação já emitidos para este aluno.
  const emitidos = await prisma.acaDocumento.findMany({
    where: { alunoId: vinculo.alunoId, tipo: 'CERTIFICADO_QUALIFICACAO' },
    select: { id: true, numero: true, dadosJson: true },
  })
  const porModulo = new Map<number, { id: number; numero: string }>()
  for (const d of emitidos) {
    const mid = Number((d.dadosJson as any)?.modulo?.id)
    if (mid) porModulo.set(mid, { id: d.id, numero: d.numero })
  }

  return modulos.map((m) => {
    const comps = m.componentes
    const detalhes = comps.map((c) => statusPorComponente.get(c.id))
    const cumpridos = detalhes.filter((d) => d?.status === 'CUMPRIDO' || d?.status === 'APROVEITADO').length
    const pendentes = detalhes
      .filter((d) => d && d.status !== 'CUMPRIDO' && d.status !== 'APROVEITADO')
      .map((d) => d!.nome)
    const chSomada = comps.reduce((s, c) => s + (c.chTotal ?? c.disciplina?.cargaHoraria ?? 0), 0)
    const doc = porModulo.get(m.id)
    return {
      moduloId: m.id,
      numero: m.numero,
      nome: m.nome,
      tituloQualificacao: m.tituloQualificacao,
      codigoCbo: m.codigoCbo,
      temTerminalidade: !!m.tituloQualificacao,
      cargaHoraria: m.cargaHoraria ?? chSomada,
      componentes: comps.length,
      cumpridos,
      pendentes,
      // Módulo sem componente nenhum não está "concluído" — está vazio.
      concluido: comps.length > 0 && pendentes.length === 0,
      certificadoId: doc?.id ?? null,
      certificadoNumero: doc?.numero ?? null,
    }
  })
}

/** Numeração compartilhada com os demais documentos oficiais (AAAA/NNNN). */
async function proximoNumero(): Promise<string> {
  const ano = new Date().getFullYear()
  const ultimo = await prisma.acaDocumento.findFirst({
    where: { numero: { startsWith: `${ano}/` } },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const seq = ultimo ? Number(ultimo.numero.split('/')[1] ?? 0) + 1 : 1
  return `${ano}/${String(seq).padStart(4, '0')}`
}

/**
 * Emite o certificado de qualificação profissional de um módulo concluído.
 *
 * Não exige matrícula concluída de propósito — ver o cabeçalho do arquivo.
 */
export async function emitirCertificadoQualificacao(
  vinculoId: number,
  moduloId: number,
  userId: number | null = null,
) {
  const vinculo = await prisma.acaVinculo.findUnique({
    where: { id: vinculoId },
    select: {
      id: true, alunoId: true, courseId: true, ra: true,
      aluno: { select: { cpf: true, dataNascimento: true, lead: { select: { nome: true } } } },
    },
  })
  if (!vinculo) throw new Error('Vínculo não encontrado')

  const modulos = await progressoModulos(vinculoId)
  const modulo = modulos.find((m) => m.moduloId === moduloId)
  if (!modulo) throw new Error('Módulo não pertence à matriz deste aluno')

  if (!modulo.temTerminalidade) {
    throw new Error(
      `O módulo "${modulo.nome}" não declara título de qualificação. `
      + 'Certificado de qualificação só existe para etapa com terminalidade (Res. CNE/CP 1/2021, art. 15, II).',
    )
  }
  if (!modulo.concluido) {
    throw new Error(
      `Faltam componentes no módulo "${modulo.nome}": ${modulo.pendentes.join(', ')}.`,
    )
  }
  if (modulo.certificadoId) {
    throw new Error(`Já existe certificado (${modulo.certificadoNumero}) para este módulo.`)
  }

  const curso = await prisma.course.findUnique({
    where: { id: vinculo.courseId },
    select: { nome: true, eixoTecnologico: true, perfilConclusao: true, grau: true },
  })

  const dados = {
    aluno: {
      nome: vinculo.aluno?.lead?.nome ?? `Aluno #${vinculo.alunoId}`,
      cpf: vinculo.aluno?.cpf ?? null,
      ra: vinculo.ra,
      nascimento: vinculo.aluno?.dataNascimento ?? null,
    },
    curso: curso?.nome ?? '—',
    eixoTecnologico: curso?.eixoTecnologico ?? null,
    perfilConclusao: curso?.perfilConclusao ?? null,
    modulo: {
      id: modulo.moduloId,
      numero: modulo.numero,
      nome: modulo.nome,
      titulo: modulo.tituloQualificacao,
      codigoCbo: modulo.codigoCbo,
      cargaHoraria: modulo.cargaHoraria,
    },
    baseLegal: 'Resolução CNE/CP nº 1/2021, art. 49, § 2º',
    emitidoEm: new Date(),
  }

  const numero = await proximoNumero()
  return prisma.acaDocumento.create({
    data: {
      numero, tipo: 'CERTIFICADO_QUALIFICACAO', alunoId: vinculo.alunoId,
      titulo: `Certificado de Qualificação — ${modulo.tituloQualificacao} — ${dados.aluno.nome}`,
      dadosJson: dados as any, emitidoPorUserId: userId,
    },
  })
}

/**
 * Quem já tem direito a certificado e ainda não recebeu.
 *
 * É a lista que a secretaria precisa: o direito nasce quando o módulo fecha, não
 * quando o aluno pede — e a maioria não sabe que tem direito.
 */
export async function qualificacoesAEmitir(courseId?: number) {
  const vinculos = await prisma.acaVinculo.findMany({
    where: {
      matrizId: { not: null },
      ...(courseId ? { courseId } : {}),
      // Inclui quem evadiu ou trancou: o direito não desaparece com a saída.
      situacao: { in: ['ATIVO', 'INTEGRALIZANDO', 'TRANCADO', 'EVADIDO', 'FORMADO', 'DIPLOMADO'] },
    },
    select: { id: true, alunoId: true, situacao: true, aluno: { select: { ra: true, lead: { select: { nome: true } } } } },
  })

  const out: Array<{
    vinculoId: number; nome: string; ra: string | null; situacao: string
    moduloId: number; modulo: string; titulo: string; cargaHoraria: number
  }> = []

  for (const v of vinculos) {
    const modulos = await progressoModulos(v.id).catch(() => [])
    for (const m of modulos) {
      if (m.temTerminalidade && m.concluido && !m.certificadoId) {
        out.push({
          vinculoId: v.id,
          nome: v.aluno?.lead?.nome ?? `Aluno #${v.alunoId}`,
          ra: v.aluno?.ra ?? null,
          situacao: String(v.situacao),
          moduloId: m.moduloId,
          modulo: m.nome,
          titulo: m.tituloQualificacao!,
          cargaHoraria: m.cargaHoraria,
        })
      }
    }
  }
  return out
}
