// src/lib/integridadeRedacao.ts
//
// Integridade da redação online — a análise que sai junto com a nota da IA.
//
// Responde a uma pergunta que a nota não responde: "foi o candidato quem
// escreveu?". Três fontes independentes, porque nenhuma sozinha é confiável:
//
//   1. LINGUÍSTICA — um detector (Claude, prompt próprio, temperatura 0) estima
//      a probabilidade de o texto ter sido gerado por IA, calibrado para o
//      estilo de vestibular: os conectivos "Ademais", "Nesse sentido", "Em
//      suma" são ENSINADOS em cursinho e não podem, sozinhos, virar suspeita.
//      Somam-se métricas determinísticas (variação do tamanho das frases,
//      diversidade de vocabulário) e ARTEFATOS de texto copiado de chatbot
//      (markdown, caractere invisível, "Claro! Aqui está…") — esses quase não
//      têm falso positivo e puxam o percentual para cima.
//   2. COMPORTAMENTO — o editor do candidato mede como o texto nasceu: tempo
//      ativo, velocidade, trechos que aparecem de uma vez (sem colar), texto
//      colado, tempo fora da aba e a linha do tempo da escrita.
//   3. SIMILARIDADE — com as redações dos outros candidatos do processo e com
//      os textos motivadores do tema (cópia de texto motivador).
//
// A política (por processo) diz o limite de tolerância de 0 a 100% e o que
// fazer acima dele: só sinalizar, exigir revisão humana ou reprovar. Como em
// toda ferramenta do gênero, o resultado é INDÍCIO, não prova — por isso o
// padrão é exigir revisão humana, e a decisão do avaliador fica registrada.
//
// Nada daqui vai para o candidato.

import { getAnthropicKey, getAnthropicModel } from './aiKeys.js'
import { registrarUsoIA } from './consumo.js'

// ─── Política ───────────────────────────────────────────────────────────

export type AcaoIntegridade = 'sinalizar' | 'revisao' | 'reprovar'

export interface PoliticaIntegridade {
  /** Detecção de texto gerado por IA. */
  detectarIa: boolean
  /** Limite de tolerância (0–100). Igual ou acima = suspeita. */
  limiteIa: number
  /** Faixa de atenção abaixo do limite (pontos percentuais). */
  margemAtencao: number
  acaoIa: AcaoIntegridade
  /** Similaridade com outras redações do processo e com os textos motivadores. */
  verificarSimilaridade: boolean
  limiteSimilaridade: number
  acaoSimilaridade: AcaoIntegridade
  /** Comportamento de escrita (telemetria do editor). */
  analisarComportamento: boolean
  /** Máximo de texto colado/inserido de uma vez, em % do texto final. */
  limiteTextoInserido: number
  /** Saídas da aba toleradas; acima vira atenção. */
  maxSaidasAba: number
  acaoComportamento: AcaoIntegridade
  /** Desliga corretor ortográfico/autocompletar do navegador no editor. */
  bloquearCorretorNavegador: boolean
  /** Bloqueia também arrastar-e-soltar texto (o colar já tem opção própria). */
  bloquearArrastar: boolean
}

export const POLITICA_PADRAO: PoliticaIntegridade = {
  detectarIa: true,
  limiteIa: 70,
  margemAtencao: 20,
  acaoIa: 'revisao',
  verificarSimilaridade: true,
  limiteSimilaridade: 40,
  acaoSimilaridade: 'revisao',
  analisarComportamento: true,
  limiteTextoInserido: 30,
  maxSaidasAba: 5,
  acaoComportamento: 'sinalizar',
  bloquearCorretorNavegador: false,
  bloquearArrastar: true,
}

const ACOES: AcaoIntegridade[] = ['sinalizar', 'revisao', 'reprovar']
const pct = (v: unknown, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : d
}

/** Configuração gravada no processo → política completa e válida. */
export function lerPolitica(raw: unknown): PoliticaIntegridade {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const b = (k: keyof PoliticaIntegridade) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (POLITICA_PADRAO[k] as boolean))
  const a = (k: keyof PoliticaIntegridade) => (ACOES.includes(r[k] as AcaoIntegridade) ? (r[k] as AcaoIntegridade) : (POLITICA_PADRAO[k] as AcaoIntegridade))
  const saidas = Number(r.maxSaidasAba)
  return {
    detectarIa: b('detectarIa'),
    limiteIa: pct(r.limiteIa, POLITICA_PADRAO.limiteIa),
    margemAtencao: pct(r.margemAtencao, POLITICA_PADRAO.margemAtencao),
    acaoIa: a('acaoIa'),
    verificarSimilaridade: b('verificarSimilaridade'),
    limiteSimilaridade: pct(r.limiteSimilaridade, POLITICA_PADRAO.limiteSimilaridade),
    acaoSimilaridade: a('acaoSimilaridade'),
    analisarComportamento: b('analisarComportamento'),
    limiteTextoInserido: pct(r.limiteTextoInserido, POLITICA_PADRAO.limiteTextoInserido),
    maxSaidasAba: Number.isFinite(saidas) && saidas >= 0 ? Math.min(999, Math.round(saidas)) : POLITICA_PADRAO.maxSaidasAba,
    acaoComportamento: a('acaoComportamento'),
    bloquearCorretorNavegador: b('bloquearCorretorNavegador'),
    bloquearArrastar: b('bloquearArrastar'),
  }
}

// ─── Telemetria do editor ──────────────────────────────────────────────

/** O que o editor do candidato mede (acumulado no servidor por deltas). */
export interface Telemetria {
  teclas: number            // teclas que produzem texto ou apagam
  apagamentos: number       // backspace/delete — gente revisa, colagem não
  insercoesGrandes: number  // eventos que inseriram ≥ 25 caracteres sem colar
  caracteresInseridos: number // total desses eventos
  colagens: number          // tentativas de colar (bloqueadas ou não)
  caracteresColados: number // texto efetivamente colado (quando liberado)
  arrastes: number          // soltar texto arrastado
  msAtivo: number           // tempo digitando (intervalos < 5 s entre teclas)
  msFora: number            // tempo com a aba escondida
  saidas: number            // vezes que saiu da aba
  linhaDoTempo: Array<{ s: number; n: number }> // segundos desde o início → caracteres
}

const ZERO: Readonly<Telemetria> = Object.freeze({
  teclas: 0, apagamentos: 0, insercoesGrandes: 0, caracteresInseridos: 0, colagens: 0,
  caracteresColados: 0, arrastes: 0, msAtivo: 0, msFora: 0, saidas: 0, linhaDoTempo: [] as Array<{ s: number; n: number }>,
}) as Telemetria

const NUMERICOS = ['teclas', 'apagamentos', 'insercoesGrandes', 'caracteresInseridos', 'colagens', 'caracteresColados', 'arrastes', 'msAtivo', 'msFora', 'saidas'] as const

/**
 * Soma um delta enviado pelo editor ao acumulado. Deltas (e não totais): se o
 * candidato recarregar a página o contador do navegador volta a zero — com
 * totais, recarregar APAGAVA o histórico de colagens. Valores absurdos são
 * cortados (o corpo vem do navegador do candidato).
 */
export function somarTelemetria(atual: unknown, delta: unknown): Telemetria {
  const a = (atual && typeof atual === 'object' ? atual : {}) as Partial<Telemetria>
  // Cópia nova SEMPRE: espalhar o ZERO compartilharia o MESMO array de linha
  // do tempo entre todas as redações do processo (o push de uma aparecia na
  // outra — pego no teste de 14/10).
  const base: Telemetria = { ...ZERO, ...a, linhaDoTempo: Array.isArray(a.linhaDoTempo) ? [...a.linhaDoTempo] : [] }
  if (!delta || typeof delta !== 'object') return base
  const d = delta as Record<string, unknown>
  for (const k of NUMERICOS) {
    const v = Number(d[k])
    if (Number.isFinite(v) && v > 0) base[k] = (base[k] || 0) + Math.min(v, k.startsWith('ms') ? 6 * 3600_000 : 1_000_000)
  }
  if (Array.isArray(d.linhaDoTempo)) {
    for (const p of d.linhaDoTempo.slice(0, 50)) {
      const s = Number((p as any)?.s), n = Number((p as any)?.n)
      if (Number.isFinite(s) && Number.isFinite(n) && s >= 0 && n >= 0) base.linhaDoTempo.push({ s: Math.round(s), n: Math.round(n) })
    }
    base.linhaDoTempo = base.linhaDoTempo.slice(-600)
  }
  return base
}

// ─── Métricas determinísticas do texto ─────────────────────────────────

function frases(texto: string): string[] {
  return texto.replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ"“])/).map((s) => s.trim()).filter((s) => s.split(' ').length >= 3)
}
const palavrasDe = (t: string) => (t.toLowerCase().normalize('NFC').match(/[\p{L}\p{N}'-]+/gu) ?? [])

export interface MetricasTexto {
  frases: number
  mediaPalavrasPorFrase: number
  /** Coeficiente de variação do tamanho das frases ("burstiness"). Texto de
   *  gente oscila (0,45+); texto de modelo tende a ser uniforme (< 0,30). */
  variacaoFrases: number
  /** Diversidade de vocabulário (MATTR, janela de 50 palavras). */
  diversidadeLexical: number
  paragrafos: number
  artefatos: Array<{ tipo: string; descricao: string }>
}

const ARTEFATOS: Array<{ re: RegExp; tipo: string; descricao: string }> = [
  { re: /[​-‍⁠﻿]/, tipo: 'caractere_invisivel', descricao: 'Caracteres invisíveis (zero-width) — típicos de texto copiado de ferramentas de IA.' },
  { re: /\*\*[^*\n]+\*\*|^#{1,6}\s/m, tipo: 'markdown', descricao: 'Formatação markdown (**negrito**, # título) — não existe no editor da prova.' },
  { re: /^\s*(?:[-•*]|\d+[.)])\s+\S/m, tipo: 'lista', descricao: 'Itens em lista/tópicos — formato atípico para dissertação e comum em respostas de chatbot.' },
  { re: /\b(claro[!,]? aqui est[áa]|como (um )?modelo de linguagem|como (uma )?ia\b|espero ter ajudado|posso ajudar (em|com) algo mais|aqui está (uma|a) (redação|reda[çc][ãa]o)|segue (a|uma) reda[çc][ãa]o)/i, tipo: 'frase_de_chatbot', descricao: 'Frase típica de resposta de chatbot dentro do texto.' },
  { re: /\[(?:nome|cidade|tema|inserir)[^\]]*\]/i, tipo: 'marcador_modelo', descricao: 'Marcador de modelo não preenchido ([nome], [inserir…]).' },
  { re: /^\s*(t[íi]tulo|reda[çc][ãa]o)\s*:/im, tipo: 'rotulo', descricao: 'Rótulo "Título:"/"Redação:" — formato de resposta gerada.' },
]

export function metricasDoTexto(texto: string): MetricasTexto {
  const fs = frases(texto)
  const tam = fs.map((f) => f.split(' ').length)
  const media = tam.length ? tam.reduce((a, b) => a + b, 0) / tam.length : 0
  const dp = tam.length > 1 ? Math.sqrt(tam.reduce((a, b) => a + (b - media) ** 2, 0) / (tam.length - 1)) : 0
  const ps = palavrasDe(texto)
  const jan = 50
  let mattr = 0
  if (ps.length >= jan) {
    let soma = 0, n = 0
    for (let i = 0; i + jan <= ps.length; i += 5) { soma += new Set(ps.slice(i, i + jan)).size / jan; n++ }
    mattr = n ? soma / n : 0
  } else if (ps.length) mattr = new Set(ps).size / ps.length
  // Travessão longo e aspas curvas: o teclado comum não produz — mas o
  // autocorretor do celular produz aspas curvas, então só o travessão conta,
  // e apenas quando aparece várias vezes.
  const artefatos = ARTEFATOS.filter((a) => a.re.test(texto)).map(({ tipo, descricao }) => ({ tipo, descricao }))
  if ((texto.match(/—/g) ?? []).length >= 3) artefatos.push({ tipo: 'travessao', descricao: 'Uso repetido de travessão longo (—), que o teclado comum não digita e é marca frequente de texto de IA.' })
  return {
    frases: fs.length,
    mediaPalavrasPorFrase: Math.round(media * 10) / 10,
    variacaoFrases: media ? Math.round((dp / media) * 100) / 100 : 0,
    diversidadeLexical: Math.round(mattr * 100) / 100,
    paragrafos: texto.split(/\n\s*\n|\n/).filter((p) => p.trim().length > 0).length,
    artefatos,
  }
}

// ─── Similaridade ──────────────────────────────────────────────────────

function shingles(texto: string, k = 5): Set<string> {
  const ps = palavrasDe(texto)
  const out = new Set<string>()
  for (let i = 0; i + k <= ps.length; i++) out.add(ps.slice(i, i + k).join(' '))
  return out
}

/** Quanto do texto A está contido em B (0–100), por sequências de 5 palavras. */
export function contencao(a: string, b: string): number {
  const sa = shingles(a), sb = shingles(b)
  if (!sa.size || !sb.size) return 0
  let comum = 0
  for (const s of sa) if (sb.has(s)) comum++
  return Math.round((comum / sa.size) * 100)
}

export interface Similaridade {
  maiorComCandidato: number
  candidato: string | null
  comTextosMotivadores: number
  comparadas: number
}

export function similaridade(texto: string, outras: Array<{ codigo: string; texto: string }>, motivadores: string): Similaridade {
  let maior = 0, quem: string | null = null
  for (const o of outras) {
    const c = Math.max(contencao(texto, o.texto), contencao(o.texto, texto))
    if (c > maior) { maior = c; quem = o.codigo }
  }
  return { maiorComCandidato: maior, candidato: maior > 0 ? quem : null, comTextosMotivadores: motivadores ? contencao(texto, motivadores) : 0, comparadas: outras.length }
}

// ─── Comportamento ─────────────────────────────────────────────────────

export interface Comportamento {
  disponivel: boolean
  minutosAtivos: number
  caracteresPorMinuto: number
  textoInseridoPct: number   // % do texto final que entrou por colagem/inserção grande
  colagens: number
  saidasAba: number
  minutosFora: number
  apagamentosPorCem: number  // revisões a cada 100 caracteres
  maiorSaltoCaracteres: number // maior crescimento entre dois pontos da linha do tempo
  sinais: string[]
}

export function avaliarComportamento(t: Telemetria | null, totalCaracteres: number, legado: { colagens: number; saidas: number }, pol: PoliticaIntegridade): Comportamento {
  const colagens = Math.max(t?.colagens ?? 0, legado.colagens)
  const saidas = Math.max(t?.saidas ?? 0, legado.saidas)
  const disponivel = !!t && (t.teclas > 0 || t.linhaDoTempo.length > 0)
  const minAtivos = (t?.msAtivo ?? 0) / 60000
  const inserido = (t?.caracteresInseridos ?? 0) + (t?.caracteresColados ?? 0)
  const pctInserido = totalCaracteres ? Math.min(100, Math.round((inserido / totalCaracteres) * 100)) : 0
  let maiorSalto = 0
  const lt = t?.linhaDoTempo ?? []
  for (let i = 1; i < lt.length; i++) maiorSalto = Math.max(maiorSalto, lt[i]!.n - lt[i - 1]!.n)
  const cpm = minAtivos > 0.5 ? Math.round(totalCaracteres / minAtivos) : 0
  const sinais: string[] = []
  if (disponivel) {
    if (pctInserido >= pol.limiteTextoInserido) sinais.push(`${pctInserido}% do texto entrou de uma vez (colado ou inserido), acima do limite de ${pol.limiteTextoInserido}%.`)
    // Digitação humana sustentada raramente passa de ~350 caracteres/minuto.
    if (cpm > 450) sinais.push(`Velocidade de ${cpm} caracteres por minuto de digitação ativa — acima do ritmo humano sustentado.`)
    if (maiorSalto >= 400) sinais.push(`O texto cresceu ${maiorSalto} caracteres de uma só vez entre dois salvamentos.`)
    if (totalCaracteres > 800 && (t?.apagamentos ?? 0) < 5) sinais.push('Quase nenhuma correção durante a escrita (texto longo sem apagar), padrão de transcrição.')
    if (totalCaracteres > 0 && (t?.teclas ?? 0) < totalCaracteres * 0.5 && pctInserido < pol.limiteTextoInserido) sinais.push('Menos teclas digitadas do que o tamanho do texto — parte do texto não foi digitada no campo.')
  }
  if (saidas > pol.maxSaidasAba) sinais.push(`Saiu da aba ${saidas} vezes (tolerância: ${pol.maxSaidasAba}).`)
  if (colagens > 0) sinais.push(`${colagens} tentativa(s) de colar texto.`)
  return {
    disponivel,
    minutosAtivos: Math.round(minAtivos * 10) / 10,
    caracteresPorMinuto: cpm,
    textoInseridoPct: pctInserido,
    colagens,
    saidasAba: saidas,
    minutosFora: Math.round(((t?.msFora ?? 0) / 60000) * 10) / 10,
    apagamentosPorCem: totalCaracteres ? Math.round(((t?.apagamentos ?? 0) / totalCaracteres) * 1000) / 10 : 0,
    maiorSaltoCaracteres: maiorSalto,
    sinais,
  }
}

// ─── Detector linguístico (Claude) ─────────────────────────────────────

export interface DeteccaoIa {
  percentual: number
  confianca: number
  sinais: Array<{ tipo: string; descricao: string }>
  trechos: Array<{ texto: string; motivo: string }>
  resumo: string
}

const SYSTEM_DETECTOR = `Você é um perito em linguística forense especializado em identificar textos gerados por modelos de linguagem (ChatGPT, Gemini, Claude, Copilot e afins) em redações de vestibular escritas em português do Brasil.

Estime a probabilidade (0 a 100) de a redação ter sido GERADA ou SUBSTANCIALMENTE REESCRITA por IA.

Sinais que AUMENTAM a probabilidade:
- uniformidade: frases e parágrafos de tamanho e ritmo muito regulares, sem a oscilação natural de quem escreve sob pressão;
- prosa "polida demais" e genérica, sem marcas pessoais, com abstrações vagas ("é fundamental", "desempenha um papel crucial", "cenário multifacetado") e exemplos não específicos;
- estrutura simétrica perfeita (cada desenvolvimento com tópico + explicação + exemplo + fecho do mesmo tamanho);
- vocabulário sofisticado e correção gramatical impecável que destoam de deslizes típicos de candidato, ou erros "inseridos" que parecem artificiais;
- repertório citado de forma genérica e pouco ancorado ("segundo estudiosos", "dados recentes mostram");
- marcas de resposta de chatbot, formatação markdown, listas.

Sinais que DIMINUEM a probabilidade (texto humano):
- oscilação de ritmo, frases curtas e longas misturadas, períodos truncados;
- erros naturais de concordância, pontuação, ortografia e coesão, inconsistências de registro;
- argumentação idiossincrática, exemplos concretos e locais, opinião com voz própria.

ATENÇÃO — evite falso positivo: candidatos de vestibular são TREINADOS no modelo ENEM. Conectivos como "Ademais", "Outrossim", "Nesse sentido", "Dessa forma", "Em suma", "Diante do exposto", a citação de filósofos e a proposta de intervenção com agente/ação/meio/finalidade são ESPERADOS e, sozinhos, NÃO indicam IA. Texto curto, simples ou com muitos erros quase nunca é de IA. Na dúvida, reduza o percentual e a confiança.

Responda EXCLUSIVAMENTE em JSON válido, sem markdown:
{
  "percentual": 0-100,
  "confianca": 0.0-1.0,
  "sinais": [{ "tipo": "uniformidade|vocabulario|estrutura|generico|correcao|repertorio|chatbot|humano", "descricao": "frase curta" }],
  "trechos": [{ "texto": "trecho copiado LITERALMENTE da redação, até 200 caracteres", "motivo": "por que parece gerado" }],
  "resumo": "1-2 frases com a conclusão"
}
Inclua até 5 trechos, só os mais característicos, copiados exatamente como estão no texto. Inclua também sinais humanos encontrados (tipo "humano").`

function lerJson(s: string): any | null {
  const limpo = s.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(limpo) } catch { /* segue */ }
  const m = limpo.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* segue */ } }
  return null
}

export async function detectarIa(texto: string, tema: string): Promise<DeteccaoIa & { custoUsd: number }> {
  const apiKey = await getAnthropicKey()
  if (!apiKey) throw new Error('Chave Anthropic não configurada.')
  const model = await getAnthropicModel()
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature: 0,
      system: SYSTEM_DETECTOR,
      messages: [{ role: 'user', content: [{ type: 'text', text: `## Tema proposto\n${tema || '(não informado)'}\n\n## Redação\n${texto}\n\nAnalise e responda apenas com o JSON.` }] }],
    }),
  })
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data: any = await resp.json()
  registrarUsoIA('deteccao_ia_redacao', 'anthropic', data)
  const j = lerJson(data.content?.[0]?.text || '')
  if (!j || typeof j !== 'object') throw new Error('Resposta do detector fora do formato')
  const custoUsd = ((data.usage?.input_tokens || 0) / 1e6) * 3 + ((data.usage?.output_tokens || 0) / 1e6) * 15
  // Trecho que não está no texto não serve para destacar: fica fora.
  const trechos = (Array.isArray(j.trechos) ? j.trechos : [])
    .filter((t: any) => typeof t?.texto === 'string' && t.texto.length >= 12 && texto.includes(t.texto.trim()))
    .slice(0, 5)
    .map((t: any) => ({ texto: String(t.texto).trim(), motivo: String(t.motivo || '').slice(0, 300) }))
  return {
    percentual: pct(j.percentual, 0),
    confianca: Math.max(0, Math.min(1, Number(j.confianca) || 0)),
    sinais: (Array.isArray(j.sinais) ? j.sinais : []).slice(0, 10).map((s: any) => ({ tipo: String(s?.tipo || ''), descricao: String(s?.descricao || '').slice(0, 300) })),
    trechos,
    resumo: String(j.resumo || '').slice(0, 600),
    custoUsd,
  }
}

// ─── Combinação e veredito ─────────────────────────────────────────────

export type StatusIntegridade = 'ok' | 'atencao' | 'suspeita' | 'indisponivel'

export interface ResultadoIntegridade {
  versao: 1
  analisadoEm: string
  /** Percentual final de autoria por IA (o que vai para a lista e para o limite). */
  percentualIa: number | null
  /** De onde veio o percentual: o detector e o ajuste pelos artefatos. */
  composicao: { detector: number | null; artefatos: number; minimoPorArtefato: number | null }
  confianca: number | null
  deteccao: Omit<DeteccaoIa, 'percentual'> | null
  metricas: MetricasTexto
  similaridade: Similaridade | null
  comportamento: Comportamento | null
  status: StatusIntegridade
  motivos: Array<{ fonte: 'ia' | 'similaridade' | 'comportamento'; nivel: 'atencao' | 'suspeita'; texto: string; acao: AcaoIntegridade }>
  /** Ação mais forte entre os motivos de suspeita — a que o corretor aplica. */
  acao: AcaoIntegridade | null
  politica: PoliticaIntegridade
  erro?: string
  custoUsd: number
}

const PESO_ACAO: Record<AcaoIntegridade, number> = { sinalizar: 1, revisao: 2, reprovar: 3 }

/** Junta as fontes e aplica a política. Pura: dá para recalcular sem IA. */
export function combinar(input: {
  politica: PoliticaIntegridade
  deteccao: DeteccaoIa | null
  metricas: MetricasTexto
  similaridade: Similaridade | null
  comportamento: Comportamento | null
  erro?: string
  custoUsd?: number
}): ResultadoIntegridade {
  const { politica: pol, deteccao, metricas, similaridade: sim, comportamento: comp } = input
  // Artefato de chatbot quase não tem falso positivo: estabelece um piso.
  const fortes = metricas.artefatos.filter((a) => ['caractere_invisivel', 'frase_de_chatbot', 'marcador_modelo', 'markdown'].includes(a.tipo)).length
  const piso = fortes >= 2 ? 95 : fortes === 1 ? 85 : metricas.artefatos.length ? 0 : null
  let percentual: number | null = null
  if (pol.detectarIa) {
    const base = deteccao?.percentual ?? null
    if (base != null || piso) percentual = Math.max(base ?? 0, piso ?? 0)
    // Texto uniforme demais e de vocabulário pouco variado reforça um detector
    // que já desconfiava — nunca cria suspeita sozinho.
    if (percentual != null && base != null && base >= 40 && metricas.frases >= 8 && metricas.variacaoFrases > 0 && metricas.variacaoFrases < 0.3) {
      percentual = Math.min(100, percentual + 5)
    }
  }

  const motivos: ResultadoIntegridade['motivos'] = []
  if (pol.detectarIa && percentual != null) {
    if (percentual >= pol.limiteIa) motivos.push({ fonte: 'ia', nivel: 'suspeita', acao: pol.acaoIa, texto: `Autoria por IA estimada em ${percentual}% — igual ou acima do limite de tolerância de ${pol.limiteIa}%.` })
    else if (percentual >= Math.max(0, pol.limiteIa - pol.margemAtencao)) motivos.push({ fonte: 'ia', nivel: 'atencao', acao: 'sinalizar', texto: `Autoria por IA estimada em ${percentual}% — perto do limite de ${pol.limiteIa}%.` })
  }
  if (pol.verificarSimilaridade && sim) {
    const maior = Math.max(sim.maiorComCandidato, sim.comTextosMotivadores)
    const de = sim.maiorComCandidato >= sim.comTextosMotivadores ? `a redação do candidato ${sim.candidato}` : 'os textos motivadores do tema'
    if (maior >= pol.limiteSimilaridade) motivos.push({ fonte: 'similaridade', nivel: 'suspeita', acao: pol.acaoSimilaridade, texto: `${maior}% do texto coincide com ${de} (limite: ${pol.limiteSimilaridade}%).` })
    else if (maior >= pol.limiteSimilaridade / 2 && maior >= 15) motivos.push({ fonte: 'similaridade', nivel: 'atencao', acao: 'sinalizar', texto: `${maior}% do texto coincide com ${de}.` })
  }
  if (pol.analisarComportamento && comp && comp.sinais.length) {
    const grave = comp.disponivel && (comp.textoInseridoPct >= pol.limiteTextoInserido || comp.maiorSaltoCaracteres >= 400 || comp.caracteresPorMinuto > 450)
    motivos.push({ fonte: 'comportamento', nivel: grave ? 'suspeita' : 'atencao', acao: grave ? pol.acaoComportamento : 'sinalizar', texto: comp.sinais.join(' ') })
  }

  const suspeitas = motivos.filter((m) => m.nivel === 'suspeita')
  const status: StatusIntegridade = suspeitas.length ? 'suspeita'
    : motivos.length ? 'atencao'
      : (pol.detectarIa && percentual == null && input.erro) ? 'indisponivel'
        : 'ok'
  const acao = suspeitas.length ? suspeitas.map((m) => m.acao).sort((a, b) => PESO_ACAO[b] - PESO_ACAO[a])[0]! : null

  return {
    versao: 1,
    analisadoEm: new Date().toISOString(),
    percentualIa: percentual,
    composicao: { detector: deteccao?.percentual ?? null, artefatos: metricas.artefatos.length, minimoPorArtefato: piso },
    confianca: deteccao?.confianca ?? null,
    deteccao: deteccao ? { confianca: deteccao.confianca, sinais: deteccao.sinais, trechos: deteccao.trechos, resumo: deteccao.resumo } : null,
    metricas,
    similaridade: sim,
    comportamento: comp,
    status,
    motivos,
    acao,
    politica: pol,
    ...(input.erro ? { erro: input.erro } : {}),
    custoUsd: input.custoUsd ?? 0,
  }
}
