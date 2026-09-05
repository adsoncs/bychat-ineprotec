// src/services/responseTime.ts
//
// Tempo de resposta medido pelas MENSAGENS, não pelos cliques do operador.
//
// Por que existe: os indicadores de tempo da Supervisão saíam de dois campos
// que dependem de alguém clicar — `firstResponseAt` (que só é gravado quando o
// responsável conclui uma Atividade, e existia em 5% dos leads do beyond) e o
// par `conversationOpenedAt → conversationClosedAt` (dois cliques manuais, com
// 78% dos encerramentos feitos em faxina de lote). O resultado eram médias de
// 54 e 78 DIAS numa operação que responde em minutos.
//
// Aqui a fonte é o par que sempre existe: a mensagem do contato que abre um
// turno e a primeira resposta nossa depois dela. Isso vale para 100% das
// conversas, não depende de disciplina de ninguém e — o que mais importa nesta
// casa — enxerga a resposta feita pelo CELULAR, que nunca passa pelo painel.
//
// Três decisões que valem para todos os números daqui:
//   1. Mediana e p90, nunca média sozinha. No beyond a mediana é 8 min e a
//      média 7,4 h: a média descreve meia dúzia de esquecimentos, não o dia.
//   2. Relógio comercial. Mensagem que chega 22h e é respondida 9h não é uma
//      espera de 11 horas. A régua sai da jornada cadastrada (equipe → agente),
//      e só quando não há nenhuma cadastrada cai no padrão de 8h-18h.
//   3. Piso de amostra. Abaixo de MIN_AMOSTRA o chamador mostra "amostra
//      insuficiente" em vez de um número — foi uma conversa só que produziu o
//      "78d 17h" que o cliente viu.

import { prisma } from '../lib/prisma.js'

/** Abaixo disto o número não é publicável — a tela mostra a amostra em vez dele. */
export const MIN_AMOSTRA = 5

/** Meta de primeira resposta, em minutos ÚTEIS. Setting `supervision.first_response_target_min`. */
export const META_PADRAO_MIN = 15
const META_KEY = 'supervision.first_response_target_min'

/**
 * Encerramentos no mesmo minuto acima disto são faxina, não atendimento.
 *
 * O painel encerra em lote (POST /supervision/conversations/close aceita uma
 * lista), e ninguém "resolve" quatro conversas no mesmo minuto uma a uma. No
 * beyond isso é 124 dos 158 encerramentos — deixá-los na média de duração é o
 * que fazia uma conversa aberta em maio e varrida em agosto contar como
 * atendimento de 90 dias. Critério de tempo, não de flag: vale igual para o
 * histórico e para o que vier, sem migration nem campo novo.
 */
const LOTE_POR_MINUTO = 3

// ── Jornada de trabalho ───────────────────────────────────────────────────

/** Faixa de expediente já normalizada: minutos desde a meia-noite local. */
interface Faixa {
  weekday: number // 0=domingo
  inicio: number
  fim: number
}

export interface Relogio {
  faixas: Faixa[]
  timezone: string
  /** 'cadastrada' quando saiu de Equipe/Agente; 'padrao' quando ninguém cadastrou. */
  origem: 'cadastrada' | 'padrao'
  /** Rótulo curto para a tela dizer qual régua está usando. */
  label: string
  /**
   * Tamanho médio do dia de expediente, em minutos.
   *
   * A tela precisa disto para não mentir na hora de escrever o número: 7.043
   * minutos ÚTEIS não são "4d 21h" de calendário — são doze dias de expediente.
   * Formatar minuto útil com régua de dia corrido seria trocar um número
   * grosseiro por outro.
   */
  minutosPorDiaUtil: number
}

const PADRAO_TZ = 'America/Sao_Paulo'

/** Seg-sex, 8h-18h. Só entra em cena quando NENHUMA jornada foi cadastrada. */
function relogioPadrao(): Relogio {
  const faixas: Faixa[] = []
  for (let d = 1; d <= 5; d++) faixas.push({ weekday: d, inicio: 8 * 60, fim: 18 * 60 })
  return {
    faixas, timezone: PADRAO_TZ, origem: 'padrao',
    label: 'seg a sex, 8h às 18h (padrão)',
    minutosPorDiaUtil: minutosPorDiaUtil(faixas),
  }
}

/** Média de minutos dos dias que têm expediente. Dia fechado não entra na média. */
function minutosPorDiaUtil(faixas: Faixa[]): number {
  const porDia = new Map<number, number>()
  for (const f of faixas) porDia.set(f.weekday, (porDia.get(f.weekday) ?? 0) + (f.fim - f.inicio))
  if (!porDia.size) return 24 * 60
  let total = 0
  for (const v of porDia.values()) total += v
  return Math.max(1, Math.round(total / porDia.size))
}

function hhmmParaMin(v: string): number {
  const [h, m] = String(v).split(':')
  const hh = parseInt(h ?? '0', 10)
  const mm = parseInt(m ?? '0', 10)
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0
  return Math.min(24 * 60, Math.max(0, hh * 60 + mm))
}

/**
 * Normaliza as linhas cadastradas em faixas. Janela que cruza a meia-noite
 * (22:00 → 02:00) vira duas: o resto do dia e a ponta do dia seguinte — do
 * contrário o intervalo sairia negativo e o dia inteiro seria descartado.
 */
function normalizar(linhas: Array<{ weekday: number; startTime: string; endTime: string }>): Faixa[] {
  const faixas: Faixa[] = []
  for (const l of linhas) {
    const ini = hhmmParaMin(l.startTime)
    const fim = hhmmParaMin(l.endTime)
    if (fim > ini) {
      faixas.push({ weekday: l.weekday, inicio: ini, fim })
    } else if (fim < ini) {
      faixas.push({ weekday: l.weekday, inicio: ini, fim: 24 * 60 })
      faixas.push({ weekday: (l.weekday + 1) % 7, inicio: 0, fim })
    }
    // ini === fim: linha sem duração, o dia não conta.
  }
  return faixas
}

/**
 * A régua da casa: a jornada cadastrada em Cadastros › Roteamento de Leads.
 *
 * Uma régua só para todo o painel, e não uma por conversa. Tempo de resposta é
 * indicador da OPERAÇÃO: se a régua mudasse junto com o dono do lead, a mesma
 * espera valeria números diferentes conforme quem estivesse com ela, e duas
 * transferências mudariam o passado. Equipe vem antes do agente porque é o
 * horário que a empresa combina com o cliente; o agente entra quando ninguém
 * cadastrou horário de equipe.
 */
export async function relogioDaCasa(): Promise<Relogio> {
  const doTime = await prisma.teamWorkingHour.findMany({
    select: { weekday: true, startTime: true, endTime: true, timezone: true },
  }).catch(() => [])
  if (doTime.length) {
    const faixas = normalizar(doTime)
    return {
      faixas,
      timezone: doTime[0]?.timezone || PADRAO_TZ,
      origem: 'cadastrada',
      label: 'jornada das equipes',
      minutosPorDiaUtil: minutosPorDiaUtil(faixas),
    }
  }

  const doAgente = await prisma.agentWorkingHour.findMany({
    select: { weekday: true, startTime: true, endTime: true, timezone: true },
  }).catch(() => [])
  if (doAgente.length) {
    const faixas = normalizar(doAgente)
    return {
      faixas,
      timezone: doAgente[0]?.timezone || PADRAO_TZ,
      origem: 'cadastrada',
      label: 'jornada dos agentes',
      minutosPorDiaUtil: minutosPorDiaUtil(faixas),
    }
  }

  return relogioPadrao()
}

/**
 * Deslocamento do fuso, em minutos, no instante dado.
 *
 * Recalculado a cada dia percorrido em vez de uma vez só: é o que mantém a
 * conta certa na virada do horário de verão de fusos que ainda o têm.
 */
export function offsetMin(t: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const parte of fmt.formatToParts(t)) p[parte.type] = parte.value
  const comoUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  )
  return Math.round((comoUTC - t.getTime()) / 60_000)
}

/**
 * Minutos de expediente entre dois instantes.
 *
 * Percorre dia a dia somando a interseção com as faixas daquele dia da semana.
 * O teto de 400 voltas existe porque este cálculo roda sobre dado de produção:
 * um par com data corrompida não pode travar a requisição do painel.
 */
export function minutosUteis(ini: Date, fim: Date, relogio: Relogio): number {
  if (!(ini instanceof Date) || !(fim instanceof Date)) return 0
  const t0 = ini.getTime()
  const t1 = fim.getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0
  if (!relogio.faixas.length) return Math.round((t1 - t0) / 60_000)

  let total = 0
  let cursor = t0
  let voltas = 0
  while (cursor < t1 && voltas++ < 400) {
    const off = offsetMin(new Date(cursor), relogio.timezone) * 60_000
    const local = new Date(cursor + off)
    const weekday = local.getUTCDay()
    const diaLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())

    for (const f of relogio.faixas) {
      if (f.weekday !== weekday) continue
      const abre = diaLocal + f.inicio * 60_000 - off
      const fecha = diaLocal + f.fim * 60_000 - off
      const de = Math.max(cursor, abre)
      const ate = Math.min(t1, fecha)
      if (ate > de) total += ate - de
    }

    cursor = diaLocal + 24 * 3_600_000 - off
  }
  return Math.round(total / 60_000)
}

// ── Estatística ───────────────────────────────────────────────────────────

export interface Resumo {
  mediana: number | null
  p90: number | null
  media: number | null
  amostra: number
  /** true quando a amostra é pequena demais para publicar o número. */
  insuficiente: boolean
}

function percentil(ordenados: number[], q: number): number | null {
  if (!ordenados.length) return null
  const i = Math.min(ordenados.length - 1, Math.floor(ordenados.length * q))
  return ordenados[i] ?? null
}

export function resumir(valores: number[]): Resumo {
  const ord = valores.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
  if (!ord.length) return { mediana: null, p90: null, media: null, amostra: 0, insuficiente: true }
  return {
    mediana: percentil(ord, 0.5),
    p90: percentil(ord, 0.9),
    media: Math.round(ord.reduce((s, n) => s + n, 0) / ord.length),
    amostra: ord.length,
    insuficiente: ord.length < MIN_AMOSTRA,
  }
}

// ── Turnos: a mensagem do contato e a nossa resposta ──────────────────────

interface TurnoBruto {
  leadId: number
  pergunta: Date
  resposta: Date | null
}

/**
 * Todo turno aberto pelo contato no período, com a primeira resposta nossa.
 *
 * "Turno" é a mensagem do contato cuja anterior naquela conversa é nossa (ou
 * que não tem anterior): duas perguntas seguidas do mesmo contato são UMA
 * espera, não duas. Mensagem interna (nota do operador) fica de fora — ela não
 * chega ao contato e não pode contar como resposta.
 *
 * A resposta é buscada além do fim do período de propósito: um turno das 17h55
 * respondido às 18h05 é uma resposta de 10 minutos, não um "sem resposta".
 */
async function turnosDoPeriodo(leadIds: number[], de: Date, ate: Date): Promise<TurnoBruto[]> {
  if (!leadIds.length) return []
  const ids = leadIds.join(',')
  const rows = await prisma.$queryRawUnsafe<Array<{ leadId: number; pergunta: Date; resposta: Date | null }>>(
    `WITH m AS (
       SELECT leadId, fromMe, timestamp,
              LAG(fromMe) OVER (PARTITION BY leadId ORDER BY timestamp, id) AS anterior,
              MIN(CASE WHEN fromMe = 1 THEN timestamp END) OVER (
                PARTITION BY leadId ORDER BY timestamp, id
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
              ) AS proxima_saida
       FROM bychat_messages
       WHERE leadId IN (${ids})
         AND isInternal = 0
         AND timestamp >= ?
     )
     SELECT leadId, timestamp AS pergunta, proxima_saida AS resposta
     FROM m
     WHERE fromMe = 0
       AND (anterior IS NULL OR anterior = 1)
       AND timestamp >= ? AND timestamp <= ?`,
    de, de, ate,
  ).catch(() => [])
  return (rows || []).map((r) => ({
    leadId: Number(r.leadId),
    pergunta: new Date(r.pergunta),
    resposta: r.resposta ? new Date(r.resposta) : null,
  }))
}

/** Um turno já medido: a pergunta, a resposta e os minutos úteis entre elas. */
export interface TurnoMedido {
  leadId: number
  pergunta: Date
  resposta: Date | null
  /** Minutos úteis até a resposta; null quando ninguém respondeu. */
  minutos: number | null
}

/**
 * Mede todos os turnos do período de uma vez.
 *
 * Uma varredura só, porque os três recortes da tela (resumo, série por dia e
 * comparativo por operador) são agregações do MESMO conjunto. Consultar três
 * vezes o mesmo par de mensagens seria triplicar o custo para chegar aos
 * mesmos números.
 */
export async function medirTurnos(
  leadIds: number[], de: Date, ate: Date, relogio: Relogio,
): Promise<TurnoMedido[]> {
  const turnos = await turnosDoPeriodo(leadIds, de, ate)
  return turnos.map((t) => ({
    ...t,
    minutos: t.resposta && t.resposta >= t.pergunta ? minutosUteis(t.pergunta, t.resposta, relogio) : null,
  }))
}

/** Resumo de um conjunto já medido — sem tocar no banco. */
export function resumirTurnos(turnos: TurnoMedido[], metaMin: number, relogio: Relogio): MetricasDeResposta {
  const minutos = turnos.map((t) => t.minutos).filter((n): n is number => n !== null)
  const dentro = minutos.filter((m) => m <= metaMin).length
  return {
    resposta: resumir(minutos),
    dentroDaMeta: dentro,
    dentroDaMetaPct: minutos.length ? Math.round((dentro / minutos.length) * 100) : null,
    metaMin,
    semResposta: turnos.length - minutos.length,
    turnos: turnos.length,
    relogio: {
      origem: relogio.origem,
      label: relogio.label,
      minutosPorDiaUtil: relogio.minutosPorDiaUtil,
    },
  }
}

/** Um ponto da série diária. Dia com amostra abaixo do piso não publica número. */
export interface PontoDoDia {
  dia: string
  mediana: number | null
  p90: number | null
  amostra: number
  insuficiente: boolean
}

/**
 * Tempo de resposta dia a dia, no fuso da casa.
 *
 * O agregado de sete dias engole o dia ruim: no beyond a mediana do período era
 * de minutos e havia uma segunda-feira com 3h37 de mediana e p90 de 36h. É a
 * série que faz essa pergunta aparecer na reunião.
 */
export function serieDiaria(turnos: TurnoMedido[], relogio: Relogio): PontoDoDia[] {
  const porDia = new Map<string, number[]>()
  for (const t of turnos) {
    if (t.minutos === null) continue
    const off = offsetMin(t.pergunta, relogio.timezone) * 60_000
    const dia = new Date(t.pergunta.getTime() + off).toISOString().slice(0, 10)
    const lista = porDia.get(dia) ?? []
    lista.push(t.minutos)
    porDia.set(dia, lista)
  }
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, valores]) => {
      const r = resumir(valores)
      return {
        dia,
        mediana: r.insuficiente ? null : r.mediana,
        p90: r.insuficiente ? null : r.p90,
        amostra: r.amostra,
        insuficiente: r.insuficiente,
      }
    })
}

export interface LinhaDeOperador {
  id: number | null
  nome: string
  fila: number
  mediana: number | null
  p90: number | null
  metaPct: number | null
  semResposta: number
  amostra: number
  insuficiente: boolean
}

/**
 * Carga contra desempenho, por operador.
 *
 * A distribuição antiga mostrava só quantas conversas cada um tem, o que não
 * distingue "lento" de "sobrecarregado" — no beyond um operador tem 85% da
 * fila E a melhor mediana da casa. O piso de amostra vale por pessoa: com
 * cinco atendimentos no período, a linha não publica mediana.
 */
export function porOperador(
  turnos: TurnoMedido[],
  donoDoLead: Map<number, number | null>,
  nomes: Map<number, string>,
  filaPorUsuario: Map<number | null, number>,
  metaMin: number,
): LinhaDeOperador[] {
  const acc = new Map<number | null, { minutos: number[]; sem: number }>()
  const pega = (k: number | null) => {
    let v = acc.get(k)
    if (!v) { v = { minutos: [], sem: 0 }; acc.set(k, v) }
    return v
  }
  for (const t of turnos) {
    const dono = donoDoLead.get(t.leadId) ?? null
    const v = pega(dono)
    if (t.minutos === null) v.sem++
    else v.minutos.push(t.minutos)
  }
  // Quem tem fila mas nenhum turno no período também aparece: fila parada sem
  // nenhum atendimento é justamente o que a gestão precisa ver.
  for (const k of filaPorUsuario.keys()) pega(k)

  return [...acc.entries()]
    .map(([id, v]) => {
      const r = resumir(v.minutos)
      const dentro = v.minutos.filter((m) => m <= metaMin).length
      return {
        id,
        nome: id === null ? 'Sem responsável' : (nomes.get(id) ?? `#${id}`),
        fila: filaPorUsuario.get(id) ?? 0,
        mediana: r.insuficiente ? null : r.mediana,
        p90: r.insuficiente ? null : r.p90,
        metaPct: r.insuficiente || !v.minutos.length ? null : Math.round((dentro / v.minutos.length) * 100),
        semResposta: v.sem,
        amostra: r.amostra,
        insuficiente: r.insuficiente,
      }
    })
    .sort((a, b) => b.fila - a.fila || b.amostra - a.amostra)
}

export interface MetricasDeResposta {
  /** Tempo até a primeira resposta, em minutos úteis. */
  resposta: Resumo
  /** Turnos do período respondidos dentro da meta. */
  dentroDaMeta: number
  dentroDaMetaPct: number | null
  metaMin: number
  /** Turnos do período que seguem sem nenhuma resposta. */
  semResposta: number
  turnos: number
  relogio: { origem: Relogio['origem']; label: string; minutosPorDiaUtil: number }
}

/** Meta de resposta configurada, com o padrão combinado (15 min úteis). */
export async function metaDeResposta(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: META_KEY } }).catch(() => null)
  const n = parseInt(String(row?.value ?? ''), 10)
  return Number.isFinite(n) && n > 0 ? n : META_PADRAO_MIN
}

export async function metricasDeResposta(
  leadIds: number[],
  de: Date,
  ate: Date,
  opts: { relogio: Relogio; metaMin: number },
): Promise<MetricasDeResposta> {
  const turnos = await medirTurnos(leadIds, de, ate, opts.relogio)
  return resumirTurnos(turnos, opts.metaMin, opts.relogio)
}

// ── Cobertura: quando o cliente fala e quando a gente responde ────────────

export interface HoraDoDia {
  hora: number
  entrada: number
  saida: number
}

/**
 * Mensagens por hora do dia, no fuso da casa.
 *
 * ⚠️ A coluna `timestamp` guarda UTC. Agrupar por `HOUR(timestamp)` puro põe o
 * pico do cliente três horas adiante — no beyond apareceria às 18h quando ele é
 * às 15h, e o gráfico existe justamente para decidir escala de horário. O
 * deslocamento é aplicado na consulta, com o offset do fuso calculado aqui
 * (`CONVERT_TZ` depende das tabelas de fuso do MySQL, que nem toda instalação
 * carrega).
 */
export async function coberturaPorHora(
  leadIds: number[], de: Date, ate: Date, relogio: Relogio,
): Promise<HoraDoDia[]> {
  if (!leadIds.length) return []
  const ids = leadIds.join(',')
  const off = offsetMin(ate, relogio.timezone)
  const rows = await prisma.$queryRawUnsafe<Array<{ hora: number; entrada: bigint; saida: bigint }>>(
    `SELECT HOUR(DATE_ADD(timestamp, INTERVAL ${off} MINUTE)) AS hora,
            COALESCE(SUM(fromMe = 0), 0) AS entrada,
            COALESCE(SUM(fromMe = 1), 0) AS saida
       FROM bychat_messages
      WHERE leadId IN (${ids}) AND isInternal = 0
        AND timestamp >= ? AND timestamp <= ?
      GROUP BY hora ORDER BY hora`,
    de, ate,
  ).catch(() => [])
  const mapa = new Map((rows || []).map((r) => [Number(r.hora), r]))
  return Array.from({ length: 24 }, (_, h) => ({
    hora: h,
    entrada: Number(mapa.get(h)?.entrada ?? 0),
    saida: Number(mapa.get(h)?.saida ?? 0),
  }))
}

/** As faixas de expediente por dia da semana, para o gráfico marcar o horário. */
export function faixasDoRelogio(relogio: Relogio): Array<{ weekday: number; inicio: number; fim: number }> {
  return relogio.faixas.map((f) => ({ weekday: f.weekday, inicio: f.inicio, fim: f.fim }))
}

// ── Duração do atendimento, sem a faxina ──────────────────────────────────

export interface DuracaoDeAtendimento {
  duracao: Resumo
  /** Encerramentos do período que entraram na conta. */
  encerradas: number
  /** Encerramentos em lote — contados à parte e fora de qualquer média. */
  emLote: number
}

/**
 * Duração dos atendimentos encerrados no período, em minutos úteis,
 * EXCLUINDO a faxina em lote.
 *
 * O KPI antigo somava tudo e dividia pela contagem; com 78% dos encerramentos
 * feitos em lote, ele media a agenda de quem limpa a fila, não o atendimento.
 * Aqui o lote é identificado pelo minuto (mais de LOTE_POR_MINUTO no mesmo) e
 * sai da média — mas continua sendo mostrado como número próprio, porque saber
 * quanto da fila é fechada no atacado também é informação de gestão.
 */
export async function duracaoDeAtendimento(
  leadIds: number[],
  de: Date,
  ate: Date,
  relogio: Relogio,
): Promise<DuracaoDeAtendimento> {
  if (!leadIds.length) return { duracao: resumir([]), encerradas: 0, emLote: 0 }
  const ids = leadIds.join(',')
  const rows = await prisma.$queryRawUnsafe<Array<{
    aberta: Date | null; fechada: Date; no_minuto: bigint
  }>>(
    `SELECT l.conversationOpenedAt AS aberta, l.conversationClosedAt AS fechada,
            COUNT(*) OVER (PARTITION BY DATE_FORMAT(l.conversationClosedAt, '%Y-%m-%d %H:%i')) AS no_minuto
       FROM bychat_leads l
      WHERE l.id IN (${ids})
        AND l.conversationClosedAt IS NOT NULL
        AND l.conversationClosedAt >= ? AND l.conversationClosedAt <= ?`,
    de, ate,
  ).catch(() => [])

  const lote = (rows || []).filter((r) => Number(r.no_minuto) > LOTE_POR_MINUTO)
  const individuais = (rows || []).filter((r) => Number(r.no_minuto) <= LOTE_POR_MINUTO && r.aberta)
  const minutos = individuais
    .map((r) => minutosUteis(new Date(r.aberta as Date), new Date(r.fechada), relogio))
    .filter((n) => n >= 0)

  return { duracao: resumir(minutos), encerradas: individuais.length, emLote: lote.length }
}
