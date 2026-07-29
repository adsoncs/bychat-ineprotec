// src/services/acaProva.ts
//
// Prova online do processo seletivo (T-203).
//
// Duas decisões que definem o comportamento:
//
// 1. O relógio começa quando o CANDIDATO inicia, não quando a janela abre.
//    Quem entra atrasado não ganha tempo extra nem perde a prova inteira.
// 2. O gabarito NUNCA vai para o navegador do candidato. A correção das
//    objetivas acontece no servidor, na entrega — enviar o gabarito junto com
//    as questões seria entregar a resposta.

import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

export function novoToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Estado da tentativa, já considerando a janela e o tempo esgotado. */
export async function estadoAplicacao(token: string) {
  const ap = await prisma.acaProvaAplicacao.findUnique({
    where: { token },
    include: { prova: { include: { itens: { include: { questao: true }, orderBy: { ordem: 'asc' } } } } },
  })
  if (!ap) return { erro: 'Prova não encontrada' as const }
  const prova = ap.prova
  const agora = new Date()

  if (!prova.publicada) return { erro: 'Prova ainda não publicada' as const }
  if (prova.inicioEm && agora < prova.inicioEm) return { erro: `A prova abre em ${prova.inicioEm.toLocaleString('pt-BR')}` as const }
  if (prova.fimEm && agora > prova.fimEm && !ap.entregueEm) return { erro: 'A janela de aplicação encerrou' as const }

  const limite = ap.iniciadaEm ? new Date(ap.iniciadaEm.getTime() + prova.duracaoMinutos * 60_000) : null
  const expirada = !!limite && agora > limite && !ap.entregueEm
  return {
    aplicacao: ap, prova, limite, expirada,
    segundosRestantes: limite ? Math.max(0, Math.floor((limite.getTime() - agora.getTime()) / 1000)) : prova.duracaoMinutos * 60,
  }
}

/** Questões SEM gabarito — é o que pode chegar ao candidato. */
export function questoesParaCandidato(itens: Array<{ questao: any; ordem: number; peso: number }>) {
  return itens.map((i) => ({
    questaoId: i.questao.id,
    ordem: i.ordem,
    area: i.questao.area,
    tipo: i.questao.tipo,
    enunciado: i.questao.enunciado,
    // `gabarito` e `peso` da questão ficam fora de propósito.
    alternativas: i.questao.tipo === 'OBJETIVA' ? i.questao.alternativas : null,
  }))
}

export async function iniciar(token: string) {
  const st = await estadoAplicacao(token)
  if ('erro' in st) throw new Error(st.erro)
  if (st.aplicacao.entregueEm) throw new Error('Esta prova já foi entregue')
  if (!st.aplicacao.iniciadaEm) {
    await prisma.acaProvaAplicacao.update({
      where: { id: st.aplicacao.id },
      data: { iniciadaEm: new Date(), status: 'EM_ANDAMENTO' },
    })
  }
  return estadoAplicacao(token)
}

export async function salvarResposta(token: string, questaoId: number, resposta: string) {
  const st = await estadoAplicacao(token)
  if ('erro' in st) throw new Error(st.erro)
  if (st.aplicacao.entregueEm) throw new Error('Prova já entregue')
  if (st.expirada) throw new Error('Tempo esgotado')
  const pertence = st.prova.itens.some((i) => i.questaoId === questaoId)
  if (!pertence) throw new Error('Questão não pertence a esta prova')

  return prisma.acaProvaResposta.upsert({
    where: { aplicacaoId_questaoId: { aplicacaoId: st.aplicacao.id, questaoId } },
    create: { aplicacaoId: st.aplicacao.id, questaoId, resposta },
    update: { resposta },
  })
}

/**
 * Entrega e corrige as objetivas no servidor. Dissertativas ficam pendentes de
 * correção humana, e a nota final só fecha quando todas forem corrigidas.
 */
export async function entregar(token: string, porTempo = false) {
  const st = await estadoAplicacao(token)
  if ('erro' in st) throw new Error(st.erro)
  if (st.aplicacao.entregueEm) throw new Error('Prova já entregue')

  const respostas = await prisma.acaProvaResposta.findMany({ where: { aplicacaoId: st.aplicacao.id } })
  const porQuestao = new Map(respostas.map((r) => [r.questaoId, r]))

  let pontosObjetiva = 0, pesoObjetiva = 0
  let temDissertativa = false

  for (const item of st.prova.itens) {
    const q = item.questao
    const r = porQuestao.get(q.id)
    if (q.tipo === 'OBJETIVA') {
      pesoObjetiva += item.peso
      const acertou = !!r?.resposta && !!q.gabarito && r.resposta.trim().toLowerCase() === q.gabarito.trim().toLowerCase()
      if (acertou) pontosObjetiva += item.peso
      if (r) await prisma.acaProvaResposta.update({ where: { id: r.id }, data: { correta: acertou } })
    } else {
      temDissertativa = true
    }
  }

  const notaObjetiva = pesoObjetiva > 0 ? Number(((pontosObjetiva / pesoObjetiva) * st.prova.notaMaxima).toFixed(2)) : 0
  return prisma.acaProvaAplicacao.update({
    where: { id: st.aplicacao.id },
    data: {
      entregueEm: new Date(),
      status: temDissertativa ? 'ENTREGUE' : 'CORRIGIDA',
      notaObjetiva,
      // Sem dissertativa, a nota final já sai fechada.
      notaFinal: temDissertativa ? null : notaObjetiva,
      observacao: porTempo ? 'Entrega automática por esgotamento do tempo.' : null,
    },
  })
}

/**
 * Correção de dissertativa: nota única + parecer em texto.
 *
 * NÃO é a rubrica que o documento pede (RF-203) — rubrica seria um conjunto de
 * critérios com peso próprio, cada um pontuado em separado, somando a nota. Aqui
 * o corretor atribui uma nota só e justifica por escrito.
 */
export async function corrigirDissertativa(params: {
  aplicacaoId: number
  questaoId: number
  nota: number
  parecer?: string | null
  corretorId?: number | null
}) {
  const resp = await prisma.acaProvaResposta.upsert({
    where: { aplicacaoId_questaoId: { aplicacaoId: params.aplicacaoId, questaoId: params.questaoId } },
    create: { aplicacaoId: params.aplicacaoId, questaoId: params.questaoId, notaManual: params.nota, parecer: params.parecer ?? null, corrigidaPor: params.corretorId ?? null, corrigidaEm: new Date() },
    update: { notaManual: params.nota, parecer: params.parecer ?? null, corrigidaPor: params.corretorId ?? null, corrigidaEm: new Date() },
  })
  await recalcularNota(params.aplicacaoId)
  return resp
}

/** Fecha a nota quando não há mais dissertativa pendente. */
export async function recalcularNota(aplicacaoId: number) {
  const ap = await prisma.acaProvaAplicacao.findUnique({
    where: { id: aplicacaoId },
    include: { prova: { include: { itens: { include: { questao: true } } } }, respostas: true },
  })
  if (!ap) return null
  const dissertativas = ap.prova.itens.filter((i) => i.questao.tipo !== 'OBJETIVA')
  const pesoTotal = ap.prova.itens.reduce((s, i) => s + i.peso, 0)
  if (pesoTotal === 0) return ap

  const pendentes = dissertativas.filter((i) => {
    const r = ap.respostas.find((x) => x.questaoId === i.questaoId)
    return !r || r.notaManual == null
  })

  const pesoDissert = dissertativas.reduce((s, i) => s + i.peso, 0)
  const pontosDissert = dissertativas.reduce((s, i) => {
    const r = ap.respostas.find((x) => x.questaoId === i.questaoId)
    // notaManual é 0..10 e vira proporção do peso do item.
    return s + (r?.notaManual != null ? (r.notaManual / 10) * i.peso : 0)
  }, 0)
  const notaDissertativa = pesoDissert > 0 ? Number(((pontosDissert / pesoDissert) * ap.prova.notaMaxima).toFixed(2)) : null

  // A nota final pondera objetiva e dissertativa pelos pesos dos itens.
  const pesoObj = pesoTotal - pesoDissert
  const notaFinal = pendentes.length > 0
    ? null
    : Number(((((ap.notaObjetiva ?? 0) * pesoObj) + ((notaDissertativa ?? 0) * pesoDissert)) / pesoTotal).toFixed(2))

  return prisma.acaProvaAplicacao.update({
    where: { id: aplicacaoId },
    data: { notaDissertativa, notaFinal, status: pendentes.length > 0 ? 'ENTREGUE' : 'CORRIGIDA' },
  })
}
