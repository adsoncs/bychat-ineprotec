// src/services/leadArea.ts
//
// Classifica a ÁREA de interesse de um lead educacional (nível, tipo, curso e
// modalidade) a partir do texto disponível — respostas de formulário, nome do
// concurso/processo seletivo, nome da campanha.
//
// Princípio: **só afirma o que está escrito**. Sem evidência, devolve null e o
// lead fica explicitamente "não identificado" — é melhor do que rotear alguém
// para o departamento errado. Em especial, MODALIDADE (presencial/EAD) quase
// nunca aparece nos formulários do Meta; nesse caso fica null de propósito.
//
// Onde é usado:
//  - routes/meta.ts (createLeadFromMeta): respostas do formulário de Lead Ads
//  - services/crmEduSync.ts: nome do concurso (ex.: "EAD VESTIBULAR - 2026/33")

export type NivelEnsino = 'Pós-graduação' | 'Graduação' | 'Técnico' | 'Stricto sensu'
export type TipoCurso = 'MBA' | 'Especialização' | 'Mestrado' | 'Doutorado' | 'Bacharelado/Licenciatura' | 'Técnico'
export type Modalidade = 'Presencial' | 'EAD' | 'Semipresencial'

export interface AreaClassificada {
  nivel: NivelEnsino | null
  tipo: TipoCurso | null
  curso: string | null
  modalidade: Modalidade | null
  /** De onde veio a conclusão — para auditar sem ter que adivinhar depois. */
  evidencia: string | null
}

/** Converte o formato do Meta ("mba_em_gestão_de_negócios") em texto legível. */
export function humanizar(valor: string): string {
  return valor
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase())
}

const SEM_RESPOSTA = /^(ainda[_ ]estou[_ ]em[_ ]d[úu]vida|n[ãa]o[_ ]sei|outro|outros|nenhum)/i

/**
 * Perguntas sobre o PERFIL do candidato (escolaridade, orçamento, horário de
 * contato) — falam do que ele já é/tem, não do que quer cursar. Precisam ficar
 * de fora, senão "já concluiu uma graduação?" vira "quer Graduação".
 */
const PERGUNTA_DE_PERFIL = /concluiu|conclus[ãa]o|j[áa][_ ]?(tem|possui)|disponibilidade|investimento|hor[áa]rio|contato|telefone|whatsapp|email|renda|idade|nascimento/i

function detectarModalidade(t: string): Modalidade | null {
  if (/\bsemipresencial\b/i.test(t)) return 'Semipresencial'
  if (/\bead\b|dist[âa]ncia|online|on-line/i.test(t)) return 'EAD'
  if (/\bpresencial\b/i.test(t)) return 'Presencial'
  return null
}

function detectarTipo(t: string): { tipo: TipoCurso; nivel: NivelEnsino } | null {
  if (/\bmba\b/i.test(t)) return { tipo: 'MBA', nivel: 'Pós-graduação' }
  if (/doutorado/i.test(t)) return { tipo: 'Doutorado', nivel: 'Stricto sensu' }
  if (/mestrado/i.test(t)) return { tipo: 'Mestrado', nivel: 'Stricto sensu' }
  if (/especializa[çc][ãa]o|p[óo]s[- ]?gradua[çc][ãa]o|\bp[óo]s\b/i.test(t)) return { tipo: 'Especialização', nivel: 'Pós-graduação' }
  if (/t[ée]cnico/i.test(t)) return { tipo: 'Técnico', nivel: 'Técnico' }
  if (/vestibular|gradua[çc][ãa]o|enem|transfer[êe]ncia|portador de diploma|bacharelado|licenciatura/i.test(t)) {
    return { tipo: 'Bacharelado/Licenciatura', nivel: 'Graduação' }
  }
  return null
}

/**
 * Classifica a partir de pedaços de texto, do mais específico para o mais
 * genérico. `curso` sai do primeiro trecho que descreva um curso de verdade —
 * respostas do tipo "ainda estou em dúvida" não valem como curso, mas ainda
 * assim indicam o nível quando a pergunta é sobre MBA.
 */
export interface EntradaArea {
  texto: string | null | undefined
  origem: string
  /**
   * Texto que dá contexto sem ser o valor em si — tipicamente o enunciado da
   * pergunta. "Qual MBA tem mais a ver com seu momento?" define que a resposta
   * é um MBA mesmo quando ela não repete a sigla ("gerenciamento de projetos…",
   * 82 leads na unialfa).
   */
  contexto?: string | null
  /**
   * Descreve um processo seletivo (ex.: "EAD VESTIBULAR - 2026/33"), não um
   * curso. Serve para nível/modalidade, mas não vira `curso`.
   */
  ehProcesso?: boolean
}

export function classificarArea(entradas: EntradaArea[]): AreaClassificada {
  const r: AreaClassificada = { nivel: null, tipo: null, curso: null, modalidade: null, evidencia: null }

  for (const e of entradas) {
    if (!e.texto) continue
    const legivel = humanizar(String(e.texto))
    if (!legivel) continue

    if (!r.modalidade) r.modalidade = detectarModalidade(`${legivel} ${e.contexto ?? ''}`)

    // o valor manda; o enunciado da pergunta entra como reforço
    const t = detectarTipo(legivel) ?? (e.contexto ? detectarTipo(e.contexto) : null)
    if (t && !r.tipo) {
      r.tipo = t.tipo
      r.nivel = t.nivel
      r.evidencia = e.origem
    }
    // "ainda estou em dúvida" indica o nível pela pergunta, mas não é um curso;
    // nome de processo seletivo também não é.
    if (!r.curso && !e.ehProcesso && !SEM_RESPOSTA.test(String(e.texto)) && detectarTipo(legivel)) {
      r.curso = legivel
    }
  }
  return r
}

/**
 * Monta as chaves `area_*` que vão para customFields. Devolve objeto vazio
 * quando não houve evidência nenhuma — assim a tela distingue "não temos o
 * dado" de "temos e é isto".
 */
export function areaParaCustomFields(a: AreaClassificada): Record<string, string> {
  const cf: Record<string, string> = {}
  if (a.nivel) cf.area_nivel = a.nivel
  if (a.tipo) cf.area_tipo = a.tipo
  if (a.curso) cf.area_curso = a.curso.substring(0, 191)
  if (a.modalidade) cf.area_modalidade = a.modalidade
  if (a.evidencia) cf.area_evidencia = a.evidencia
  return cf
}

/**
 * Atalho para leads de Lead Ads: varre as respostas do formulário procurando as
 * que falam de curso/interesse, e usa a campanha como último recurso.
 */
export function classificarPorFormularioMeta(
  respostas: Record<string, unknown>,
  campanha?: string | null,
): AreaClassificada {
  const entradas: EntradaArea[] = []
  for (const [chave, valor] of Object.entries(respostas || {})) {
    if (typeof valor !== 'string' || !valor) continue
    // Perguntas de PERFIL não dizem o que a pessoa quer cursar. "Você já
    // concluiu uma graduação?" → "sim, sou graduado(a)" seria lido como
    // interesse em Graduação, quando significa o oposto: já tem graduação e
    // portanto busca pós. Sem este filtro, 4.271 leads da unialfa caíam nesse
    // falso positivo.
    if (PERGUNTA_DE_PERFIL.test(chave)) continue
    // perguntas que descrevem o curso pretendido; a própria chave vira contexto
    if (/curso|mba|p[óo]s|gradua|especializa|t[ée]cnico|modalidade|interesse/i.test(chave)) {
      entradas.push({ texto: valor, origem: `formulário: ${chave}`, contexto: humanizar(chave) })
    }
  }
  if (campanha) entradas.push({ texto: campanha, origem: 'campanha' })
  return classificarArea(entradas)
}

/** Classifica pelo nome do processo seletivo do CRM (ex.: "EAD VESTIBULAR - 2026/33"). */
export function classificarPorConcurso(nomeConcurso: string | null | undefined): AreaClassificada {
  return classificarArea([{ texto: nomeConcurso, origem: 'concurso', ehProcesso: true }])
}
