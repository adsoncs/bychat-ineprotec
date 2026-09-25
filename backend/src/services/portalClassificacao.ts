// src/services/portalClassificacao.ts
//
// Dono único da classificação do processo seletivo (Fase 4 da consolidação
// ERP × Portal, 10/09/2026).
//
// Antes desta fase, três rotinas independentes gravavam `status` e
// `notaClassificacao` na MESMA linha de ProcessRegistration — a classificação
// por ENEM, o override humano do Portal e o `acaVestibular.classificar` do ERP —
// e nenhuma olhava o que a outra tinha decidido. Quem rodasse por último vencia.
//
// Quatro regras que este serviço garante e que faltavam no ERP:
//
//  1. **O corte depende do tipo de avaliação, e a oferta vence o processo.**
//     O ERP usava sempre `selectionProcess.notaCorte`, mesmo num processo de
//     redação que tem `essayCutoff` próprio — e ignorava o override por oferta,
//     que existe justamente porque Medicina não corta na mesma nota que
//     Pedagogia.
//  2. **Status nunca regride.** Quem já foi convocado ou matriculado não volta a
//     ser "classificado" só porque alguém reclassificou o processo. No ERP,
//     `convocado` entrava na lista de reclassificáveis e o loop gravava
//     `status: 'classificado'` em todo mundo aprovado.
//  3. **Sem nota não é reprovado — é pendente.** O ERP fazia
//     `notaClassificacao ?? 0` e reprovava em massa quem ainda não tinha sido
//     avaliado. Aqui, quem não tem nota fica de fora da classificação e é
//     contado à parte, para a tela poder dizer quantos faltam avaliar.
//  4. **Toda mudança de status vira log.** O ERP não escrevia uma linha sequer
//     em ProcessRegistrationStatusLog; uma reclassificação em massa não deixava
//     rastro de quem mudou o quê.
//
// A escrita é condicional (`updateMany` com o status antigo no `where`), pela
// mesma razão da Fase 1: entre ler e escrever, um webhook de pagamento ou outra
// aba do admin pode ter mexido na linha.

import { prisma } from '../lib/prisma.js'

/** Ordem do ciclo. Serve para saber o que é avanço e o que seria regressão. */
const ORDEM: Record<string, number> = {
  inscrito: 0,
  pago_taxa: 1,
  classificado: 2,
  convocado: 3,
  matriculado: 4,
}

/** Estados de onde não se sai por classificação — só por ato humano explícito. */
const TERMINAIS = new Set(['desistente', 'cancelado'])

export interface ResultadoClassificacao {
  /** Inscrições consideradas (fora as terminais). */
  total: number
  classificados: number
  reprovados: number
  /** Já estavam à frente no ciclo: nota e posição atualizam, status não. */
  preservados: number
  /** Ainda sem nota — não entram na ordenação e não são reprovados. */
  semNota: number
  corte: number | null
  criterioCorte: string
}

export interface ResultadoConvocacao {
  convocados: number
  /** Pedidas menos convocadas, quando não há classificados suficientes. */
  vagasOciosas: number
}

interface Cortes {
  notaCorte: number | null
  essayCutoff: number | null
  presencialCutoff: number | null
}

/**
 * O corte que vale para esta inscrição.
 *
 * A precedência já estava documentada no schema e só o caminho do ENEM a
 * respeitava: **a oferta sobrepõe o processo**, e cada tipo de avaliação tem o
 * seu campo. `notaCorte` é o corte geral e serve de última instância para os
 * tipos que não definiram o seu.
 */
export function corteAplicavel(
  evaluationType: string | null | undefined,
  processo: Cortes,
  oferta: Cortes | null,
): { corte: number | null; criterio: string } {
  const primeiro = (...vs: Array<number | null | undefined>) => {
    for (const v of vs) if (v !== null && v !== undefined) return Number(v)
    return null
  }
  const geral = primeiro(oferta?.notaCorte, processo.notaCorte)

  switch (evaluationType) {
    case 'exam_online': {
      const c = primeiro(oferta?.essayCutoff, processo.essayCutoff)
      return c !== null
        ? { corte: c, criterio: 'nota da redação' }
        : { corte: geral, criterio: 'nota de corte geral' }
    }
    case 'exam_presencial': {
      const c = primeiro(oferta?.presencialCutoff, processo.presencialCutoff)
      return c !== null
        ? { corte: c, criterio: 'nota da prova presencial' }
        : { corte: geral, criterio: 'nota de corte geral' }
    }
    case 'enem':
      return { corte: geral, criterio: 'média do ENEM' }
    default:
      // 'docs' e 'none' não classificam por nota: quem cumpre os documentos
      // entra. Um corte aqui reprovaria gente por um número que ninguém pediu.
      return { corte: null, criterio: 'sem corte (avaliação documental)' }
  }
}

/**
 * Uma avaliação pode mexer no status de quem está assim?
 *
 * Não, quando a pessoa já passou da classificação: convocar e matricular são
 * atos posteriores, e desfazê-los porque uma nota chegou depois tira a vaga de
 * alguém pelas costas. Nota e posição continuam sendo atualizadas — o que fica
 * congelado é o status. Sair daí é decisão humana, pelo cancelamento.
 */
export function classificacaoPodeAlterarStatus(status: string): boolean {
  if (TERMINAIS.has(status)) return false
  return (ORDEM[status] ?? 0) < ORDEM.convocado
}

/** Grava a mudança só se o status ainda for o que lemos, e registra o log. */
async function moverStatus(params: {
  id: number
  de: string
  para: string
  dados: Record<string, unknown>
  ator: string
  atorId?: number | null
  observacao: string
}): Promise<boolean> {
  const r = await prisma.processRegistration.updateMany({
    where: { id: params.id, status: params.de },
    data: { ...params.dados, status: params.para },
  })
  if (r.count === 0) return false
  await prisma.processRegistrationStatusLog
    .create({
      data: {
        registrationId: params.id,
        fromStatus: params.de,
        toStatus: params.para,
        actorId: params.atorId ?? null,
        actorName: params.ator,
        observacao: params.observacao,
      },
    })
    .catch(() => {})
  return true
}

/**
 * Classifica (ou reclassifica) um processo seletivo inteiro.
 *
 * `criterio` é o desempate: 'inscricao' usa a ordem de chegada — o padrão, e o
 * que a lei costuma exigir quando o edital não diz outra coisa.
 */
export async function classificar(
  selectionProcessId: number,
  opts: { criterio?: string; ator?: string; atorId?: number | null } = {},
): Promise<ResultadoClassificacao> {
  const proc = await prisma.selectionProcess.findUnique({
    where: { id: selectionProcessId },
    select: {
      id: true,
      nome: true,
      notaCorte: true,
      essayCutoff: true,
      presencialCutoff: true,
      entryMode: { select: { evaluationType: true } },
    },
  })
  if (!proc) throw new Error('Processo seletivo não encontrado')

  const regs = await prisma.processRegistration.findMany({
    where: { selectionProcessId },
    select: {
      id: true,
      status: true,
      inscritoEm: true,
      notaClassificacao: true,
      posicaoClassificacao: true,
      offering: {
        select: { notaCorte: true, essayCutoff: true, presencialCutoff: true },
      },
    },
  })

  const evType = proc.entryMode?.evaluationType ?? null
  const ator = opts.ator || 'Sistema'
  // O critério do corte é do processo; o valor pode variar por oferta.
  const { criterio: criterioCorte, corte: corteDoProcesso } = corteAplicavel(evType, proc, null)

  const ativos = regs.filter((r) => !TERMINAIS.has(r.status))
  // Sem nota não é reprovado: é gente que ainda não foi avaliada. Reprovar aqui
  // foi o que transformou "clicar em Classificar" numa reprovação em massa.
  const comNota = ativos.filter((r) => r.notaClassificacao !== null)
  const semNota = ativos.length - comNota.length

  const desempateEm = opts.criterio === 'nota' ? 'nota' : 'inscricao'
  comNota.sort((a, b) => {
    const na = a.notaClassificacao ?? 0
    const nb = b.notaClassificacao ?? 0
    if (nb !== na) return nb - na
    if (desempateEm === 'inscricao') return a.inscritoEm.getTime() - b.inscritoEm.getTime()
    return a.id - b.id
  })

  let posicao = 0
  let classificados = 0
  let reprovados = 0
  let preservados = 0

  for (const r of comNota) {
    const { corte } = corteAplicavel(evType, proc, r.offering)
    const nota = r.notaClassificacao ?? 0
    const reprovado = corte !== null && nota < corte

    if (reprovado) {
      // Quem já avançou no ciclo não é reprovado por reclassificação. Tirar a
      // vaga de quem já foi convocado ou matriculado é decisão humana, com
      // motivo — existe o cancelamento para isso.
      if ((ORDEM[r.status] ?? 0) >= ORDEM.convocado) {
        preservados++
        await prisma.processRegistration.update({
          where: { id: r.id },
          data: { posicaoClassificacao: null },
        })
        continue
      }
      reprovados++
      if (r.status !== 'reprovado') {
        await moverStatus({
          id: r.id, de: r.status, para: 'reprovado',
          dados: { posicaoClassificacao: null, classificadoEm: new Date() },
          ator, atorId: opts.atorId,
          observacao: `Reprovado na classificação: ${nota} abaixo do corte ${corte} (${criterioCorte}).`,
        })
      } else {
        await prisma.processRegistration.update({
          where: { id: r.id },
          data: { posicaoClassificacao: null },
        })
      }
      continue
    }

    posicao++
    classificados++

    // Já está à frente no ciclo: atualiza a posição, mantém o status.
    if ((ORDEM[r.status] ?? 0) > ORDEM.classificado) {
      preservados++
      await prisma.processRegistration.update({
        where: { id: r.id },
        data: { posicaoClassificacao: posicao },
      })
      continue
    }

    if (r.status === 'classificado') {
      await prisma.processRegistration.update({
        where: { id: r.id },
        data: { posicaoClassificacao: posicao },
      })
      continue
    }

    await moverStatus({
      id: r.id, de: r.status, para: 'classificado',
      dados: { posicaoClassificacao: posicao, classificadoEm: new Date() },
      ator, atorId: opts.atorId,
      observacao:
        corte !== null
          ? `Classificado em ${posicao}º com ${nota} (corte ${corte}, ${criterioCorte}).`
          : `Classificado em ${posicao}º com ${nota} (sem corte definido).`,
    })
  }

  return {
    total: ativos.length,
    classificados,
    reprovados,
    preservados,
    semNota,
    corte: corteDoProcesso,
    criterioCorte,
  }
}

/**
 * Convoca as próximas `qtdVagas` posições ainda não convocadas.
 *
 * Convocar é chamar para matrícula: só entra quem está classificado, na ordem
 * da posição, e quem já foi convocado não conta de novo.
 */
export async function convocar(
  selectionProcessId: number,
  qtdVagas: number,
  opts: { ator?: string; atorId?: number | null } = {},
): Promise<ResultadoConvocacao> {
  const vagas = Math.max(0, Math.floor(Number(qtdVagas) || 0))
  if (vagas === 0) return { convocados: 0, vagasOciosas: 0 }

  const elegiveis = await prisma.processRegistration.findMany({
    where: { selectionProcessId, status: 'classificado', posicaoClassificacao: { not: null } },
    orderBy: { posicaoClassificacao: 'asc' },
    take: vagas,
    select: { id: true, posicaoClassificacao: true },
  })

  const agora = new Date()
  let convocados = 0
  for (const e of elegiveis) {
    const ok = await moverStatus({
      id: e.id, de: 'classificado', para: 'convocado',
      dados: { convocadoEm: agora },
      ator: opts.ator || 'Sistema', atorId: opts.atorId,
      observacao: `Convocado na chamada (${e.posicaoClassificacao}ª posição).`,
    })
    if (ok) convocados++
  }

  return { convocados, vagasOciosas: vagas - convocados }
}

/**
 * Leva o resultado de uma avaliação para a inscrição do processo seletivo.
 *
 * Até a Fase 4 só o ENEM fazia isso: a redação e a prova presencial gravavam
 * nota e veredito na própria submissão e paravam ali. O resultado é que a
 * classificação não tinha o que ordenar — 54 dos 67 candidatos do Vestibular
 * 2026/1 estavam sem `notaClassificacao` porque a nota da redação nunca subia.
 *
 * Aqui a nota sempre chega. O status só muda para quem ainda não passou da
 * classificação, e a mudança vira log com a origem da nota.
 */
export async function aplicarNotaDeAvaliacao(params: {
  /** Id da inscrição do Portal (EnrollmentRegistration). */
  enrollmentRegistrationId: number
  nota: number | null
  aprovado: boolean | null
  origem: string
  ator?: string
  atorId?: number | null
}): Promise<{ aplicado: boolean; motivo?: string }> {
  try {
    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: params.enrollmentRegistrationId },
      select: { processRegistrationId: true },
    })
    if (!reg?.processRegistrationId) return { aplicado: false, motivo: 'inscrição sem processo seletivo' }

    const pr = await prisma.processRegistration.findUnique({
      where: { id: reg.processRegistrationId },
      select: { id: true, status: true },
    })
    if (!pr) return { aplicado: false, motivo: 'inscrição do processo não encontrada' }

    const dados: Record<string, unknown> = {}
    if (params.nota !== null && Number.isFinite(params.nota)) dados.notaClassificacao = params.nota

    const podeMexer = classificacaoPodeAlterarStatus(pr.status)
    const alvo = params.aprovado === true ? 'classificado' : params.aprovado === false ? 'reprovado' : null

    if (alvo && podeMexer && alvo !== pr.status) {
      if (alvo === 'classificado') dados.classificadoEm = new Date()
      const ok = await moverStatus({
        id: pr.id, de: pr.status, para: alvo, dados,
        ator: params.ator || 'Sistema',
        atorId: params.atorId,
        observacao: `${params.origem}: ${params.nota ?? '—'} → ${alvo}.`,
      })
      return ok ? { aplicado: true } : { aplicado: false, motivo: 'a inscrição mudou durante a gravação' }
    }

    if (Object.keys(dados).length > 0) {
      await prisma.processRegistration.update({ where: { id: pr.id }, data: dados })
    }
    // Reprovar quem já está convocado ou matriculado seria tirar a vaga pelas
    // costas; fica o registro de que a nota chegou e a situação foi mantida.
    if (alvo === 'reprovado' && !podeMexer) {
      await prisma.processRegistrationStatusLog
        .create({
          data: {
            registrationId: pr.id, fromStatus: pr.status, toStatus: pr.status,
            actorId: params.atorId ?? null, actorName: params.ator || 'Sistema',
            observacao: `${params.origem}: ${params.nota ?? '—'} ficaria abaixo do corte, mas a inscrição já está em "${pr.status}" — nota atualizada, situação mantida.`,
          },
        })
        .catch(() => {})
    }
    return { aplicado: true }
  } catch (e: any) {
    // Falha aqui não pode derrubar a correção de uma redação que já foi salva.
    console.warn('[portalClassificacao] falha ao aplicar nota:', e?.message || e)
    return { aplicado: false, motivo: 'erro' }
  }
}
