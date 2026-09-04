// src/services/alertHealth.ts
//
// A saúde do próprio sistema de alertas.
//
// Todo sistema de alerta que morre, morre da mesma forma: um tipo começa a
// avisar coisa que ninguém vai fazer nada a respeito, as pessoas aprendem a
// dispensar sem ler, e o hábito contamina os tipos que importavam. Quando
// alguém percebe, o sino inteiro já é decoração.
//
// Isto existe para que a decisão de desligar um tipo de alerta seja tomada com
// número, não com impressão. Duas medidas dizem quase tudo:
//
//   DESCARTE — a pessoa tirou da caixa e o problema continuou de pé. É a
//   confissão de que aquele aviso não gerou trabalho. Alto aqui = ruído.
//
//   NUNCA LIDO — nem abriu. Alto aqui não é ruído ainda, é irrelevância:
//   o alerta não fala de nada que a pessoa reconheça como problema dela.
//
// O contrário também informa: tipo com muita RESOLUÇÃO e pouco descarte é
// alerta que está pagando o próprio custo.
//
// Não há tela ainda de propósito. Construir painel antes de saber se os números
// convencem é o mesmo erro que este arquivo serve para detectar.

import { prisma } from '../lib/prisma.js'

/** Acima disto, o tipo provavelmente é ruído. */
const LIMITE_DESCARTE = 0.5
/** Acima disto, o tipo provavelmente não fala com quem recebe. */
const LIMITE_NAO_LIDO = 0.7
/** Abaixo disto, não há amostra para concluir nada. */
const AMOSTRA_MINIMA = 5

/**
 * Idade mínima para um alerta entrar no julgamento.
 *
 * Sem esta carência o painel mente na direção mais perigosa: alerta criado hoje
 * aparece com 100% de "nunca lido" — porque ninguém teve tempo de abrir — e o
 * veredicto sai "irrelevante". Alguém olharia o painel na primeira semana e
 * desligaria justamente os tipos que ainda não tiveram chance.
 *
 * Vinte e quatro horas é o piso: cobre quem só abre o painel no dia seguinte,
 * inclusive depois de um fim de semana curto.
 */
const CARENCIA_H = 24

/**
 * Todo tipo que algum produtor sabe abrir.
 *
 * Escrito à mão de propósito: a saúde tem de mostrar o tipo que NUNCA abriu
 * nada, que é justamente o caso em que a pessoa quer saber se está ligado e
 * quieto ou desligado. Uma lista derivada do banco só mostraria o que já
 * apareceu, escondendo exatamente o que se quer perguntar.
 */
export const TIPOS_CONHECIDOS: Array<{ kind: string; oque: string }> = [
  { kind: 'integration.token', oque: 'Token de integração vencido ou vencendo' },
  { kind: 'integration.error', oque: 'Integração recusou a credencial (Google, Meta)' },
  { kind: 'channel.down', oque: 'Linha de WhatsApp fora do ar' },
  { kind: 'meeting.no_outcome', oque: 'Reunião passou e ninguém disse se aconteceu' },
  { kind: 'meeting.bot_failed', oque: 'O bot não conseguiu gravar a reunião' },
  { kind: 'activity.overdue', oque: 'Atividade venceu e continua pendente' },
  { kind: 'negotiation.stalled', oque: 'Proposta parada sem movimento' },
  { kind: 'lead.stale', oque: 'Contato escreveu e não teve resposta' },
]

export interface SaudeDoTipo {
  kind: string
  /** Alertas novos demais para julgar (dentro da carência). */
  aguardando: number
  /** Condições de pé agora. */
  abertos: number
  /** Fecharam no período — o problema foi resolvido. */
  resolvidos: number
  /** Destinatários que tiraram da caixa. */
  descartes: number
  /** Destinatários que nunca abriram. */
  naoLidos: number
  /** Total de destinatários no período (a base das razões abaixo). */
  destinatarios: number
  /** descartes / destinatários. */
  taxaDescarte: number
  /** naoLidos / destinatários. */
  taxaNaoLido: number
  /** Horas entre aparecer e ser resolvido, mediana. */
  horasAteResolver: number | null
  /** Quantas voltas do relógio o alerta médio ficou de pé. */
  ocorrenciasMedia: number
  /** ruido | irrelevante | saudavel | sem_amostra */
  veredicto: 'ruido' | 'irrelevante' | 'saudavel' | 'sem_amostra'
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null
  const v = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio]! : (v[meio - 1]! + v[meio]!) / 2
}

/**
 * Placar por família de alerta.
 *
 * `dias` recorta o período de análise. Alertas de demonstração e de teste ficam
 * de fora: eles inflariam o descarte sem dizer nada sobre o produto.
 */
export async function saudeDosAlertas(dias = 30): Promise<SaudeDoTipo[]> {
  const desde = new Date(Date.now() - dias * 86400_000)

  const alertas = await prisma.alert.findMany({
    where: {
      firstSeenAt: { gte: desde, lte: new Date(Date.now() - CARENCIA_H * 3600_000) },
      kind: { notIn: ['demo', 'teste'] },
    },
    select: {
      kind: true, status: true, firstSeenAt: true, resolvedAt: true, occurrences: true,
      recipients: { select: { readAt: true, dismissedAt: true } },
    },
  })

  // Os que ainda estão na carência entram só como contagem: dizem "espere" em
  // vez de deixar o tipo sumir do painel sem explicação.
  const novos = await prisma.alert.groupBy({
    by: ['kind'],
    where: {
      firstSeenAt: { gt: new Date(Date.now() - CARENCIA_H * 3600_000) },
      kind: { notIn: ['demo', 'teste'] },
    },
    _count: true,
  })
  const aguardandoPorKind = new Map(novos.map((n) => [n.kind, n._count]))

  const porKind = new Map<string, typeof alertas>()
  for (const a of alertas) {
    const lista = porKind.get(a.kind) || []
    lista.push(a)
    porKind.set(a.kind, lista)
  }

  const saida: SaudeDoTipo[] = []
  for (const [kind, lista] of porKind) {
    let descartes = 0
    let naoLidos = 0
    let destinatarios = 0
    const horas: number[] = []

    for (const a of lista) {
      for (const r of a.recipients) {
        destinatarios++
        if (r.dismissedAt) descartes++
        if (!r.readAt) naoLidos++
      }
      if (a.resolvedAt) {
        horas.push((a.resolvedAt.getTime() - a.firstSeenAt.getTime()) / 3600_000)
      }
    }

    const abertos = lista.filter((a) => a.status === 'open').length
    const resolvidos = lista.filter((a) => a.status === 'resolved').length
    const taxaDescarte = destinatarios ? descartes / destinatarios : 0
    const taxaNaoLido = destinatarios ? naoLidos / destinatarios : 0

    // A ordem do julgamento importa: descarte vem primeiro porque é o sinal mais
    // forte — a pessoa VIU e decidiu que não ia fazer nada. Não ter lido pode
    // ser só uma semana corrida.
    let veredicto: SaudeDoTipo['veredicto'] = 'saudavel'
    if (destinatarios < AMOSTRA_MINIMA) veredicto = 'sem_amostra'
    else if (taxaDescarte > LIMITE_DESCARTE) veredicto = 'ruido'
    else if (taxaNaoLido > LIMITE_NAO_LIDO) veredicto = 'irrelevante'

    saida.push({
      kind, aguardando: aguardandoPorKind.get(kind) || 0,
      abertos, resolvidos, descartes, naoLidos, destinatarios,
      taxaDescarte: Number(taxaDescarte.toFixed(3)),
      taxaNaoLido: Number(taxaNaoLido.toFixed(3)),
      horasAteResolver: mediana(horas) !== null ? Number(mediana(horas)!.toFixed(1)) : null,
      ocorrenciasMedia: Number((lista.reduce((s, a) => s + a.occurrences, 0) / lista.length).toFixed(1)),
      veredicto,
    })
  }

  // Tipo que só produziu alerta dentro da carência não pode desaparecer do
  // painel: quem olha precisa ver que ele está rodando e que a leitura vem.
  for (const [kind, n] of aguardandoPorKind) {
    if (porKind.has(kind)) continue
    saida.push({
      kind, aguardando: n, abertos: n, resolvidos: 0, descartes: 0, naoLidos: 0,
      destinatarios: 0, taxaDescarte: 0, taxaNaoLido: 0, horasAteResolver: null,
      ocorrenciasMedia: 0, veredicto: 'sem_amostra',
    })
  }

  // Pior primeiro: o que precisa de decisão fica no topo.
  const peso = { ruido: 0, irrelevante: 1, saudavel: 2, sem_amostra: 3 }
  return saida.sort((a, b) => peso[a.veredicto] - peso[b.veredicto] || b.destinatarios - a.destinatarios)
}

/** Uma frase por tipo, para quem só quer saber o que fazer. */
export function recomendacao(s: SaudeDoTipo): string {
  switch (s.veredicto) {
    case 'ruido':
      return `${Math.round(s.taxaDescarte * 100)}% descartado sem resolver — considere desligar ou apertar o limiar`
    case 'irrelevante':
      return `${Math.round(s.taxaNaoLido * 100)}% nunca aberto — o texto ou o destinatário está errado`
    case 'sem_amostra':
      return s.aguardando > 0
        ? `${s.aguardando} alerta(s) ainda dentro das ${CARENCIA_H}h de carência — volte amanhã`
        : 'poucos casos para concluir'
    default:
      return s.horasAteResolver !== null
        ? `resolvido em ~${s.horasAteResolver}h na mediana`
        : 'em uso, nada resolvido ainda'
  }
}
