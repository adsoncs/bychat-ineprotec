// src/services/funnelReportConfig.ts
//
// Configuração do Relatório de Funil: o que define MQL, SQL, RA, RR, Fechamento
// e Faturamento em cada funil.
//
// Por que existe: até aqui o mapeamento era HARDCODED com as chaves de um único
// cliente (`mql: ['QUALIFICACAO']`, `sql: ['QUALIFICADO']`…). Medido contra os
// funis reais, a chave QUALIFICADO não existe em nenhum deles — SQL era 0 em
// 100% dos casos, e MQL em 4 de 5 funis. O relatório exibia zeros que pareciam
// "não aconteceu" quando significavam "não sei medir".
//
// Três decisões de desenho que vêm disso:
//
//  1. A configuração é POR FUNIL. As etapas variam ("Matrículas" vai de
//     INTERESSADO a MATRICULADO, sem nenhuma etapa em comum com o padrão), então
//     um mapeamento global seria errado para a maioria.
//  2. KPI não configurado devolve `null`, não 0. Zero é uma afirmação sobre o
//     negócio; null é uma afirmação sobre a configuração. Confundir os dois foi
//     exatamente o defeito anterior.
//  3. A contagem padrão é por PASSAGEM na etapa (histórico de LeadEvent), não por
//     status atual. Medido: 18 leads passaram por REUNIAO e só 3 estão lá agora;
//     4 chegaram a FECHADO e o relatório contava 2.

import { prisma } from '../lib/prisma.js'

export const SETTING_KEY = 'funnel_report.config'

/** Papéis do funil que a configuração define. */
export const PAPEIS = ['mql', 'sql', 'ra', 'rr', 'fechamento', 'faturamento'] as const
export type Papel = (typeof PAPEIS)[number]

export const PAPEL_LABEL: Record<Papel, string> = {
  mql: 'MQL — Lead Qualificado por Marketing',
  sql: 'SQL — Lead Qualificado por Vendas',
  ra: 'RA — Reunião Agendada',
  rr: 'RR — Reunião Realizada',
  fechamento: 'Fechamento',
  faturamento: 'Faturamento',
}

// ── Tipos de definição ────────────────────────────────────────────
//
// Cada papel aponta para UMA fonte de dado. As fontes disponíveis foram
// levantadas do que o sistema realmente grava — nada aqui é aspiracional.

export type DefKpi =
  /** KPI desligado de propósito. Relatório mostra "—", não 0. */
  | { tipo: 'nenhum' }
  /** Lead alcançou (ou está em) uma destas etapas do funil. */
  | { tipo: 'etapa'; stageKeys: string[] }
  /** Respondeu valor POSITIVO num campo qualificador de formulário. */
  | { tipo: 'qualificacao'; fieldKeys: string[] }
  /** Campo personalizado com valor específico, ou apenas preenchido. */
  | { tipo: 'campo'; key: string; operador: 'igual' | 'preenchido' | 'diferente'; valores?: string[] }
  /** Score de IA ou de prioridade acima de um mínimo. */
  | { tipo: 'score'; campo: 'aiScore' | 'priorityScore'; min: number }
  /** Classificação do score de IA (hot/warm/cold). */
  | { tipo: 'score_label'; labels: string[] }
  /** Lead tem uma destas tags. */
  | { tipo: 'tag'; tagIds: number[] }
  /** Agendamento na agenda, por status do booking. */
  | { tipo: 'agendamento'; statuses: string[] }
  /** Proposta/negociação em determinado status ou resultado. */
  | { tipo: 'negociacao'; statuses?: string[]; resultado?: 'won' | 'lost' }
  /** Classificação manual de desfecho pelo operador. */
  | { tipo: 'outcome'; valor: 'won' | 'lost' }
  /** Venda detectada por IA na conversa. */
  | { tipo: 'venda_ia' }
  // ── Só faturamento (somam valor em vez de contar leads) ──
  /** Soma o valor final das negociações. */
  | { tipo: 'valor_negociacao'; statuses?: string[]; resultado?: 'won' | 'lost' }
  /** Soma o valor das vendas detectadas por IA. */
  | { tipo: 'valor_venda_ia' }
  /** Soma um campo personalizado numérico (ex.: ticket informado na proposta). */
  | { tipo: 'valor_campo'; key: string }

export interface ConfigFunil {
  mql: DefKpi
  sql: DefKpi
  ra: DefKpi
  rr: DefKpi
  fechamento: DefKpi
  faturamento: DefKpi
}

export interface FunnelReportConfig {
  /** Configuração por funil (chave = id do funil, em texto). */
  porFunil: Record<string, Partial<ConfigFunil>>
  /** 'todos' inclui leads orgânicos; 'pago' só os atribuídos a campanha. */
  escopo: 'todos' | 'pago'
  /**
   * 'passou' conta quem alcançou a etapa no período (LeadEvent). 'atual' conta
   * quem está nela ou além. Ver comentário do topo.
   */
  contagem: 'passou' | 'atual'
}

export const CONFIG_PADRAO: FunnelReportConfig = { porFunil: {}, escopo: 'todos', contagem: 'passou' }

/** Papéis que somam dinheiro em vez de contar leads. */
const TIPOS_DE_VALOR = ['valor_negociacao', 'valor_venda_ia', 'valor_campo']
export const ehTipoDeValor = (d?: DefKpi | null): boolean => !!d && TIPOS_DE_VALOR.includes(d.tipo)

// ── Catálogo de fontes, para a tela de configuração ───────────────
//
// A tela consome daqui em vez de repetir a lista. Cada entrada diz onde o dado
// mora, porque a pergunta que o superadmin faz é "esse número vem de onde?".

export interface FonteDescricao {
  tipo: DefKpi['tipo']
  rotulo: string
  descricao: string
  /** Papéis em que esta fonte faz sentido. */
  papeis: Papel[]
  /** Parâmetros que a tela precisa pedir. */
  parametros: Array<'stageKeys' | 'fieldKeys' | 'campoKey' | 'operador' | 'valores' | 'scoreCampo' | 'min' | 'labels' | 'tagIds' | 'bookingStatuses' | 'negStatuses' | 'negResultado' | 'outcomeValor'>
}

const CONTAGEM: Papel[] = ['mql', 'sql', 'ra', 'rr', 'fechamento']
const VALOR: Papel[] = ['faturamento']

export const FONTES: FonteDescricao[] = [
  {
    tipo: 'etapa', rotulo: 'Etapa do funil', papeis: CONTAGEM,
    descricao: 'O lead alcançou uma das etapas escolhidas. Com a contagem por passagem, vale mesmo que ele já tenha saído dela (inclusive para perdido).',
    parametros: ['stageKeys'],
  },
  {
    tipo: 'qualificacao', rotulo: 'Resposta positiva na qualificação', papeis: CONTAGEM,
    descricao: 'O lead respondeu um dos valores positivos configurados num campo qualificador do formulário. É a pergunta de qualificação virando KPI.',
    parametros: ['fieldKeys'],
  },
  {
    tipo: 'campo', rotulo: 'Campo personalizado', papeis: CONTAGEM,
    descricao: 'Valor de um campo do lead: igual a algo, diferente de algo, ou apenas preenchido.',
    parametros: ['campoKey', 'operador', 'valores'],
  },
  {
    tipo: 'score', rotulo: 'Score mínimo', papeis: CONTAGEM,
    descricao: 'Score de IA (probabilidade de fechar) ou de prioridade acima de um mínimo.',
    parametros: ['scoreCampo', 'min'],
  },
  {
    tipo: 'score_label', rotulo: 'Classificação do score (hot/warm/cold)', papeis: CONTAGEM,
    descricao: 'Usa o rótulo que a IA atribuiu ao lead em vez do número.',
    parametros: ['labels'],
  },
  {
    tipo: 'tag', rotulo: 'Tag do lead', papeis: CONTAGEM,
    descricao: 'O lead recebeu uma das tags escolhidas. Útil quando a equipe marca manualmente.',
    parametros: ['tagIds'],
  },
  {
    tipo: 'agendamento', rotulo: 'Agendamento na agenda', papeis: ['ra', 'rr'],
    descricao: 'Status do compromisso na agenda. Agendada = scheduled/confirmed; realizada = completed. É o único jeito de RA e RR serem números diferentes.',
    parametros: ['bookingStatuses'],
  },
  {
    tipo: 'negociacao', rotulo: 'Proposta / negociação', papeis: CONTAGEM,
    descricao: 'O lead tem proposta em determinado status (enviada, em negociação, aceita) ou com resultado definido.',
    parametros: ['negStatuses', 'negResultado'],
  },
  {
    tipo: 'outcome', rotulo: 'Desfecho classificado pelo operador', papeis: CONTAGEM,
    descricao: 'Ganho ou perdido marcado manualmente no lead. É a mesma fonte que a Visão Geral usa para taxa de conversão.',
    parametros: ['outcomeValor'],
  },
  {
    tipo: 'venda_ia', rotulo: 'Venda detectada por IA', papeis: CONTAGEM,
    descricao: 'A IA identificou o fechamento na conversa do WhatsApp.',
    parametros: [],
  },
  {
    tipo: 'valor_negociacao', rotulo: 'Valor das negociações', papeis: VALOR,
    descricao: 'Soma o valor final das propostas. Recomendado: resultado "ganho". É o valor que a equipe efetivamente negociou.',
    parametros: ['negStatuses', 'negResultado'],
  },
  {
    tipo: 'valor_venda_ia', rotulo: 'Valor da venda detectada por IA', papeis: VALOR,
    descricao: 'Soma o valor que a IA extraiu da conversa. Depende da detecção de venda estar ativa e acertando o valor.',
    parametros: [],
  },
  {
    tipo: 'valor_campo', rotulo: 'Soma de um campo numérico', papeis: VALOR,
    descricao: 'Soma um campo personalizado do lead (ex.: ticket informado pelo operador).',
    parametros: ['campoKey'],
  },
  {
    tipo: 'nenhum', rotulo: 'Não medir', papeis: [...CONTAGEM, ...VALOR],
    descricao: 'Desliga o KPI. O relatório mostra "—" em vez de zero, deixando claro que não há medição em vez de afirmar que não houve resultado.',
    parametros: [],
  },
]

// ── Sugestão automática ───────────────────────────────────────────

/**
 * Propõe uma configuração para um funil a partir das etapas que ele REALMENTE
 * tem. Serve de ponto de partida na tela — o superadmin ajusta e salva.
 *
 * Não grava nada: sugestão que se aplica sozinha viraria o mesmo hardcode de
 * antes, só mais difícil de enxergar.
 */
export function sugerirConfig(stages: Array<{ key: string; position: number }>): ConfigFunil {
  const chaves = stages.map((s) => s.key)
  const achar = (...alvos: string[]) => chaves.filter((k) => alvos.some((a) => k.includes(a)))

  const mqlKeys = achar('QUALIFICA', 'INTERESSADO', 'CONTATADO')
  const sqlKeys = achar('QUALIFICADO', 'NUTRIR', 'INSCRITO', 'PROPOSTA', 'NEGOCIACAO')
  const raKeys = achar('REUNIAO', 'VISITA')
  const fechKeys = achar('FECHADO', 'MATRICULADO', 'GANHO')

  return {
    mql: mqlKeys.length ? { tipo: 'etapa', stageKeys: [mqlKeys[0]!] } : { tipo: 'nenhum' },
    sql: sqlKeys.length ? { tipo: 'etapa', stageKeys: [sqlKeys[0]!] } : { tipo: 'nenhum' },
    // Agenda antes de etapa: é o que distingue agendada de realizada.
    ra: { tipo: 'agendamento', statuses: ['scheduled', 'confirmed', 'completed'] },
    rr: { tipo: 'agendamento', statuses: ['completed'] },
    // Desfecho antes de etapa: é a fonte que a Visão Geral usa, e não depende de
    // o operador arrastar o card até a última coluna.
    fechamento: fechKeys.length ? { tipo: 'outcome', valor: 'won' } : { tipo: 'outcome', valor: 'won' },
    faturamento: { tipo: 'valor_negociacao', resultado: 'won' },
  }
}

// ── Persistência ──────────────────────────────────────────────────

function normalizarConfig(bruto: unknown): FunnelReportConfig {
  const v = (bruto ?? {}) as any
  const escopo = v.escopo === 'pago' ? 'pago' : 'todos'
  const contagem = v.contagem === 'atual' ? 'atual' : 'passou'
  const porFunil: Record<string, Partial<ConfigFunil>> = {}
  if (v.porFunil && typeof v.porFunil === 'object') {
    for (const [fid, cfg] of Object.entries(v.porFunil as Record<string, any>)) {
      if (!/^\d+$/.test(fid) || !cfg || typeof cfg !== 'object') continue
      const limpo: Partial<ConfigFunil> = {}
      for (const p of PAPEIS) {
        const d = (cfg as any)[p]
        if (d && typeof d === 'object' && typeof d.tipo === 'string') limpo[p] = d as DefKpi
      }
      porFunil[fid] = limpo
    }
  }
  return { porFunil, escopo, contagem }
}

export async function lerConfig(): Promise<FunnelReportConfig> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null)
  if (!row) return { ...CONFIG_PADRAO }
  return normalizarConfig(row.value)
}

export async function salvarConfig(cfg: FunnelReportConfig): Promise<FunnelReportConfig> {
  const limpo = normalizarConfig(cfg)
  // upsert, não updateMany: chave nova não existe ainda e updateMany seria no-op
  // silencioso (já queimou esse tempo antes neste projeto).
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: limpo as any },
    create: {
      key: SETTING_KEY, value: limpo as any,
      label: 'Relatório de Funil — definição de MQL/SQL/RA/RR/Fechamento/Faturamento',
      grp: 'funnel_report', fieldType: 'json',
    },
  })
  return limpo
}

/** Config efetiva de um funil: o que foi salvo, sem preencher lacuna com palpite. */
export function configDoFunil(cfg: FunnelReportConfig, funnelId: number | null): Partial<ConfigFunil> {
  if (funnelId === null) return {}
  return cfg.porFunil[String(funnelId)] ?? {}
}
