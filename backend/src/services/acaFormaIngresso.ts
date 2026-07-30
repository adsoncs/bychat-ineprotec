// src/services/acaFormaIngresso.ts
//
// Formas de ingresso do Censo da Educação Superior e critérios de classificação.
//
// Por que este arquivo existe: `AcaVinculo.formaIngresso` era texto livre, e os
// valores sugeridos no schema (`portador_diploma`, `reingresso`,
// `seletivo_continuo`) NÃO existem no Censo. Declarar forma que o INEP não
// aceita inviabiliza a importação do módulo Aluno.
//
// A régua vale para pós e especialização, não só graduação:
// Res. CNE/CES nº 1/2018, art. 6º — "Os cursos de especialização serão
// registrados no Censo da Educação Superior e no Cadastro de Instituições e
// Cursos do Sistema e-MEC". Para o técnico o regulador é o SISTEC, que não pede
// forma de ingresso — nele a forma serve à gestão interna da escola.
//
// Duas premissas que costumam aparecer erradas em ERP acadêmico:
//
//  1. "Transferência interna" NÃO é forma de ingresso. É situação do vínculo de
//     ORIGEM (TRANSFERIDO_INTERNO) somada ao campo curso de origem no vínculo de
//     DESTINO. Por isso não há entrada para ela aqui.
//  2. "Portador de diploma" não é forma própria — é SELECAO_SIMPLIFICADA
//     classificada por análise de diploma de nível superior.
//
// Fonte: Manual do Censo da Educação Superior, módulo Aluno.

/** Uma das 10 formas que o Censo aceita. Lista fechada — nada fora daqui. */
export type FormaIngressoCodigo =
  | 'VESTIBULAR'
  | 'ENEM'
  | 'AVALIACAO_SERIADA'
  | 'SELECAO_SIMPLIFICADA'
  | 'TRANSFERENCIA_EXOFFICIO'
  | 'PECG'
  | 'DECISAO_JUDICIAL'
  | 'EGRESSO_BI_LI'
  | 'PROGRAMA_ESPECIAL'
  | 'VAGA_REMANESCENTE'

export type CriterioClassificacaoCodigo =
  | 'PROVA_PROPRIA'
  | 'REDACAO_ONLINE'
  | 'NOTA_ENEM'
  | 'MEDIA_HISTORICO'
  | 'ANALISE_CURRICULO'
  | 'ANALISE_DIPLOMA'
  | 'ENTREVISTA'
  | 'ORDEM_INSCRICAO'
  | 'SORTEIO'
  | 'SEM_CLASSIFICACAO'

export interface FormaIngresso {
  codigo: FormaIngressoCodigo
  rotulo: string
  /** O que a norma/manual diz — aparece como ajuda na tela, não é decoração. */
  descricao: string
  /** Critérios de classificação coerentes com a forma. Vazio = qualquer um. */
  criteriosSugeridos: CriterioClassificacaoCodigo[]
  /** Exige informar o curso de origem no vínculo. */
  exigeCursoOrigem?: boolean
  /** Exige documento comprobatório do ato (judicial, ex-officio). */
  exigeAmparo?: boolean
  /** Restrita a instituições/situações específicas — a tela avisa. */
  restricao?: string
}

export const FORMAS_INGRESSO: FormaIngresso[] = [
  {
    codigo: 'VESTIBULAR',
    rotulo: 'Vestibular',
    descricao:
      'Candidato avaliado por provas em processo seletivo único, sobre conteúdos do ensino médio.',
    criteriosSugeridos: ['PROVA_PROPRIA', 'REDACAO_ONLINE'],
  },
  {
    codigo: 'ENEM',
    rotulo: 'Enem',
    descricao: 'Ingresso pela nota do Exame Nacional do Ensino Médio.',
    criteriosSugeridos: ['NOTA_ENEM'],
  },
  {
    codigo: 'AVALIACAO_SERIADA',
    rotulo: 'Avaliação seriada',
    descricao:
      'Candidato avaliado em etapas ao longo do ensino médio (processo seriado, tipo PAS/PSS).',
    criteriosSugeridos: ['PROVA_PROPRIA'],
  },
  {
    codigo: 'SELECAO_SIMPLIFICADA',
    rotulo: 'Seleção simplificada',
    descricao:
      'Processos distintos de vestibular, Enem e avaliação seriada, para vagas novas. '
      + 'Pode ocorrer por provas, entrevistas, análise de currículo, histórico escolar ou de '
      + 'diploma de nível superior. É a forma usada por pós-graduação, especialização e pelo '
      + 'técnico quando não há prova.',
    criteriosSugeridos: [
      'ANALISE_CURRICULO', 'ANALISE_DIPLOMA', 'MEDIA_HISTORICO',
      'ENTREVISTA', 'PROVA_PROPRIA', 'ORDEM_INSCRICAO', 'SORTEIO',
    ],
  },
  {
    codigo: 'TRANSFERENCIA_EXOFFICIO',
    rotulo: 'Transferência ex-officio',
    descricao:
      'Servidor público federal (ou dependente) removido no interesse da administração — '
      + 'aceitação obrigatória pela instituição. Aplica-se também a refugiados.',
    criteriosSugeridos: ['SEM_CLASSIFICACAO'],
    exigeCursoOrigem: true,
    exigeAmparo: true,
  },
  {
    codigo: 'PECG',
    rotulo: 'Convênio PEC-G',
    descricao:
      'Programa de Estudantes-Convênio de Graduação (acordo internacional). '
      + 'Quem muda de curso mantém a condição de PEC-G.',
    criteriosSugeridos: ['SEM_CLASSIFICACAO'],
    restricao: 'Exige adesão da instituição ao PEC-G (MRE/MEC).',
  },
  {
    codigo: 'DECISAO_JUDICIAL',
    rotulo: 'Decisão judicial',
    descricao: 'Vínculo criado por determinação judicial.',
    criteriosSugeridos: ['SEM_CLASSIFICACAO'],
    exigeAmparo: true,
  },
  {
    codigo: 'EGRESSO_BI_LI',
    rotulo: 'Egresso de BI/LI',
    descricao:
      'Egresso de Bacharelado ou Licenciatura Interdisciplinar que ingressa na etapa seguinte.',
    criteriosSugeridos: ['SEM_CLASSIFICACAO'],
    restricao: 'Só se aplica a instituição que oferta curso interdisciplinar.',
  },
  {
    codigo: 'PROGRAMA_ESPECIAL',
    rotulo: 'Vagas de programas especiais',
    descricao: 'Ingresso por programa especial de acesso mantido pela instituição ou pelo poder público.',
    criteriosSugeridos: [],
  },
  {
    codigo: 'VAGA_REMANESCENTE',
    rotulo: 'Vagas remanescentes',
    descricao:
      'Vagas de anos anteriores nunca ocupadas ou liberadas. Cobre também o candidato que já '
      + 'teve vínculo na instituição e realiza novo ingresso (reingresso).',
    criteriosSugeridos: ['ANALISE_CURRICULO', 'MEDIA_HISTORICO', 'ORDEM_INSCRICAO', 'SEM_CLASSIFICACAO'],
    exigeCursoOrigem: false,
  },
]

export interface CriterioClassificacao {
  codigo: CriterioClassificacaoCodigo
  rotulo: string
  descricao: string
  /** Gera nota/posição de classificação. false = não há ranking. */
  classifica: boolean
  /** evaluationType do EntryMode coerente com este critério. */
  avaliacaoEsperada: 'none' | 'docs' | 'enem' | 'exam_online' | 'exam_presencial'
}

export const CRITERIOS_CLASSIFICACAO: CriterioClassificacao[] = [
  {
    codigo: 'PROVA_PROPRIA', rotulo: 'Prova própria', classifica: true,
    descricao: 'Prova aplicada pela instituição, presencial ou online. Classifica por nota.',
    avaliacaoEsperada: 'exam_presencial',
  },
  {
    codigo: 'REDACAO_ONLINE', rotulo: 'Redação online', classifica: true,
    descricao: 'Redação digital com correção (humana ou assistida por IA). Classifica por nota.',
    avaliacaoEsperada: 'exam_online',
  },
  {
    codigo: 'NOTA_ENEM', rotulo: 'Nota do Enem', classifica: true,
    descricao: 'Usa a nota do Enem informada pelo candidato, com nota de corte.',
    avaliacaoEsperada: 'enem',
  },
  {
    codigo: 'MEDIA_HISTORICO', rotulo: 'Média do histórico escolar', classifica: true,
    descricao: 'Classifica pela média das notas do histórico do ensino médio (ou da graduação, na pós).',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'ANALISE_CURRICULO', rotulo: 'Análise de currículo', classifica: true,
    descricao: 'Banca pontua currículo/experiência profissional. Típico de especialização.',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'ANALISE_DIPLOMA', rotulo: 'Análise de diploma', classifica: false,
    descricao:
      'Verifica apenas se o candidato possui o diploma exigido (graduação, para lato sensu). '
      + 'Não gera ranking — é requisito de elegibilidade.',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'ENTREVISTA', rotulo: 'Entrevista', classifica: true,
    descricao: 'Entrevista com banca, registrada com parecer e nota.',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'ORDEM_INSCRICAO', rotulo: 'Ordem de inscrição', classifica: true,
    descricao:
      'Classifica por ordem de chegada, até esgotar as vagas. Comum no técnico e em fluxo contínuo.',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'SORTEIO', rotulo: 'Sorteio', classifica: true,
    descricao: 'Classifica por sorteio entre os inscritos habilitados.',
    avaliacaoEsperada: 'docs',
  },
  {
    codigo: 'SEM_CLASSIFICACAO', rotulo: 'Sem classificação', classifica: false,
    descricao:
      'Não há disputa por vaga — o direito ao ingresso decorre do amparo (ex-officio, judicial, '
      + 'convênio) ou de análise apenas de elegibilidade.',
    avaliacaoEsperada: 'none',
  },
]

const MAPA_FORMAS = new Map(FORMAS_INGRESSO.map((f) => [f.codigo, f]))
const MAPA_CRITERIOS = new Map(CRITERIOS_CLASSIFICACAO.map((c) => [c.codigo, c]))

export const acharForma = (codigo?: string | null): FormaIngresso | null =>
  (codigo ? MAPA_FORMAS.get(codigo.toUpperCase() as FormaIngressoCodigo) ?? null : null)

export const acharCriterio = (codigo?: string | null): CriterioClassificacao | null =>
  (codigo ? MAPA_CRITERIOS.get(codigo.toUpperCase() as CriterioClassificacaoCodigo) ?? null : null)

/** Rótulo para tela/relatório. Devolve o código cru se for legado desconhecido. */
export function rotuloForma(codigo?: string | null): string {
  if (!codigo) return '—'
  return acharForma(codigo)?.rotulo ?? codigo
}

export function rotuloCriterio(codigo?: string | null): string {
  if (!codigo) return '—'
  return acharCriterio(codigo)?.rotulo ?? codigo
}

/**
 * Valida a forma antes de gravar no vínculo. Lança com a mensagem que a tela
 * mostra — inclusive o caso da transferência interna, que é o erro mais comum.
 */
export function validarForma(codigo: string): FormaIngressoCodigo {
  const cod = String(codigo || '').trim().toUpperCase()
  const forma = MAPA_FORMAS.get(cod as FormaIngressoCodigo)
  if (forma) return forma.codigo

  if (cod.includes('INTERNA') || cod === 'TRANSFERENCIA_INTERNA') {
    throw new Error(
      'Transferência interna não é forma de ingresso no Censo. Registre a mudança pela '
      + 'movimentação do vínculo de origem (situação "Transferido internamente") e informe o '
      + 'curso de origem no vínculo de destino.',
    )
  }
  if (cod.includes('DIPLOMA') || cod === 'PORTADOR_DIPLOMA') {
    throw new Error(
      'Portador de diploma não é forma própria no Censo. Use "Seleção simplificada" com '
      + 'critério de classificação "Análise de diploma".',
    )
  }
  if (cod.includes('REINGRESS')) {
    throw new Error(
      'Reingresso não é forma própria no Censo. Use "Vagas remanescentes", que cobre quem já '
      + 'teve vínculo na instituição.',
    )
  }
  throw new Error(
    `Forma de ingresso "${codigo}" não é aceita pelo Censo. Use uma de: `
    + FORMAS_INGRESSO.map((f) => f.codigo).join(', '),
  )
}

/**
 * Coerência entre forma, critério e dados do vínculo. Devolve avisos em vez de
 * lançar: bloquear a matrícula por incoerência de classificação puniria a
 * secretaria por um dado de conformidade que ela pode corrigir depois.
 */
export function avisosDeIngresso(dados: {
  formaIngresso?: string | null
  criterioClassificacao?: string | null
  cursoOrigemId?: number | null
  amparoUrl?: string | null
}): string[] {
  const avisos: string[] = []
  const forma = acharForma(dados.formaIngresso)
  if (!forma) {
    if (dados.formaIngresso) avisos.push(`Forma "${dados.formaIngresso}" não consta no Censo.`)
    return avisos
  }
  const criterio = acharCriterio(dados.criterioClassificacao)
  if (criterio && forma.criteriosSugeridos.length && !forma.criteriosSugeridos.includes(criterio.codigo)) {
    avisos.push(
      `Critério "${criterio.rotulo}" é incomum para ${forma.rotulo}. `
      + `Esperado: ${forma.criteriosSugeridos.map((c) => rotuloCriterio(c)).join(', ')}.`,
    )
  }
  if (forma.exigeCursoOrigem && !dados.cursoOrigemId) {
    avisos.push(`${forma.rotulo} exige informar o curso de origem.`)
  }
  if (forma.exigeAmparo && !dados.amparoUrl) {
    avisos.push(`${forma.rotulo} exige o documento que ampara o ingresso (ofício ou decisão).`)
  }
  if (forma.restricao) avisos.push(forma.restricao)
  return avisos
}

/**
 * Forma do Censo a partir do modo de ingresso do processo seletivo. É aqui que a
 * escolha comercial da escola vira dado regulatório.
 *
 * Quando o modo não declara `censoForma`, deduz pelo evaluationType — melhor
 * palpite fundamentado do que gravar nulo, mas o painel de conformidade aponta
 * o modo para a escola declarar explicitamente.
 */
export function formaDoModo(modo: {
  censoForma?: string | null
  evaluationType?: string | null
  code?: string | null
}): { forma: FormaIngressoCodigo; deduzida: boolean } {
  const declarada = acharForma(modo.censoForma)
  if (declarada) return { forma: declarada.codigo, deduzida: false }

  const ev = modo.evaluationType ?? ''
  if (ev === 'enem') return { forma: 'ENEM', deduzida: true }
  // Prova própria só é "vestibular" quando o processo é único sobre o ensino
  // médio; num técnico ou numa pós, prova própria é seleção simplificada. Sem
  // saber o nível aqui, a opção conservadora é a mais abrangente.
  return { forma: 'SELECAO_SIMPLIFICADA', deduzida: true }
}

export const criterioDoModo = (modo: {
  criterioClassificacao?: string | null
  evaluationType?: string | null
  requiresClassification?: boolean | null
}): CriterioClassificacaoCodigo => {
  const declarado = acharCriterio(modo.criterioClassificacao)
  if (declarado) return declarado.codigo
  if (modo.evaluationType === 'enem') return 'NOTA_ENEM'
  if (modo.evaluationType === 'exam_online') return 'REDACAO_ONLINE'
  if (modo.evaluationType === 'exam_presencial') return 'PROVA_PROPRIA'
  return modo.requiresClassification ? 'MEDIA_HISTORICO' : 'SEM_CLASSIFICACAO'
}
