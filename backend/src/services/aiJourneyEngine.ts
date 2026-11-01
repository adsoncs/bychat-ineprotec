// src/services/aiJourneyEngine.ts
//
// Jornada 100% IA (mode='ai_journey'). A IA CONDUZ a conversa (livre, natural, sem
// roteiro fixo) e CHAMA FERRAMENTAS (tool use) para tudo que tem efeito de negócio:
// salvar dados, qualificar, mover etapa, listar horários, agendar. A lógica
// determinística roda no servidor — reusa exatamente o que o motor scripted/form usa
// (createLeadFromForm, evaluateQualification, resolveStageMove, moveLeadStage,
// getMeetingTypeSlots, createBooking). O prompt orquestra; ele NÃO simula as regras.
//
// Garantias: a IA nunca inventa horário (só os que `listar_horarios` devolveu) e nunca
// "diz que agendou" sem `agendar` retornar ok — o servidor é a fonte da verdade.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { registrarUsoIA } from '../lib/consumo.js'
import { iaPodeFalar } from './botTakeover.js'
import { lerModoComercial, decidirModoComercial, eNovoAtendimento, blocoDeQualificacao, type DecisaoComercial } from './journey/modoComercial.js'
import { matriculaPeloChatLigada, matriculaPorLink, EDU_TOOLS_MATRICULA, PROTOCOLO_SEM_MATRICULA, PROTOCOLO_MATRICULA_POR_LINK, semSecaoDeMatricula } from './journey/eduSdr.js'
import type { SendFn, SendInteractiveFn, ProviderType } from './chatbotFlow.js'
import type { OriginData } from './originDetection.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { createLeadFromForm, moveLeadStage } from './formFlow.js'
import { acharLeadDoContato, canalDaMensagem } from './contactIdentity.js'
import { applyAnswerToLead } from './scriptedChatbotFlow.js'
import { evaluateQualification, resolveStageMove } from './journey/journeyEngine.js'
import { getActiveMeetingType, getMeetingTypeSlots, createBooking } from './schedulingService.js'
import { buildChoices, choicesToText, splitChoiceLabel, type Choice } from '../lib/waInteractive.js'
import { escolherOperadorDaRota } from './teamRouting.js'
import { enviarParaEquipe } from './encaminharEquipe.js'
import { atendimentoHumanoAtivo, resumoParaEquipe } from './journey/validacaoContato.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel, getPrimaryProvider } from '../lib/aiKeys.js'
import { withSourceLabel } from '../lib/leadSourceLabel.js'
import { readImageForModel, transcribeInboundAudio, mediaPlaceholder, type InboundMedia } from './inboundMedia.js'
import { emitOutboundMessage } from './outboundEvents.js'
import { quebrarEmMensagens, intervaloDigitacao, estiloDaJornada } from './messageStyle.js'
import { eduSdrLigado, EDU_TOOLS, EDU_TOOL_NAMES, executarFerramentaEdu, protocoloEdu, resumoDoCatalogo, contextoDoLead, semTextoDeEspera, type EduState } from './journey/eduSdr.js'
import { textoDoSistema } from './modelosDoSistema.js'

const MAX_TOOL_ITERS = 6
// Padrão do histórico enviado ao modelo. O tenant pode subir em
// `ai.journey.history_limit` (ver configDaJornada) — conversa retomada dias
// depois precisa de mais contexto, mas cada mensagem a mais custa token em
// todo turno, então o padrão continua o de sempre.
const HISTORY_LIMIT = 24
const LLM_TIMEOUT_MS = 30000   // teto por chamada ao LLM (evita travar a conversa)
const TOOL_TIMEOUT_MS = 20000  // teto por execução de ferramenta (ex.: slots/Google)
const TURN_BUDGET_MS = 90000   // teto total do turno (libera o lock no pior caso)
// Consultor educacional (journey/eduSdr): a matrícula pede várias ferramentas no
// mesmo turno (situação → ficha → inscrição), e a conversa é longa.
const EDU_MAX_TOOL_ITERS = 10
const EDU_HISTORY_LIMIT = 40
// Mensagens em sequência ("tem estágio?" / "qual valor?" / "quanto tempo?")
// viram UMA resposta: espera este silêncio antes de responder, e só a última
// da rajada responde — com todas no histórico.
const EDU_JANELA_MS = 4000
const EDU_JANELA_MAX_MS = 12000

// ── Configuração da jornada por tenant (Settings `ai.journey.*`) ─────────────
//
// Recursos que nasceram num cliente (severiano, out/2026) e mudam o jeito de o
// bot conversar. Regra do produto: comportamento de UM cliente não vira código
// fixo — vira Setting, e o padrão (Setting ausente) é EXATAMENTE o motor de
// antes, para nenhum outro tenant (FABI/fabad incluída) mudar sem alguém ligar.
//
// Chaves (valor JSON: número, boolean ou string; "true"/"1" também valem):
//   ai.journey.human_pace_seconds  número  0     ritmo humano: espera N s de silêncio
//                                                (teto 3×N), responde a rajada de uma
//                                                vez, sem texto de espera, com tempo
//                                                de digitação antes de cada mensagem
//   ai.journey.history_limit       número  24    mensagens do histórico enviadas (máx. 60)
//   ai.journey.auto_custom_fields  bool    false salvar_dados cria campo personalizado
//                                                para dado sem chave no formulário
//   ai.journey.resume_after_done   bool    false atendimento encerrado é RETOMADO quando
//                                                a pessoa volta a escrever (com o desfecho
//                                                anterior no prompt), em vez de silenciar
//   ai.journey.handoff_contact     string  'form' 'nome_whatsapp' = para encaminhar basta
//                                                nome + WhatsApp (não cobra e-mail/cidade)
//   ai.journey.silence_after_handoff bool  false (desde 01/11/2026 é SEMPRE assim:
//                                                transferir_humano dá a última mensagem e
//                                                cala o bot até devolverem a conversa)
//   ai.journey.agenda_by_date      bool    false listar_horarios aceita data/período,
//                                                devolve "hoje"/"amanhã" e calendário de
//                                                14 dias, recusa data passada
//   ai.journey.max_slot_offers     número  2     ofertas de horário antes de passar a um
//                                                humano (0 = sem limite)
//   ai.journey.read_media          bool    false a IA vê a foto e ouve o áudio transcrito
//   ai.journey.no_menus            bool    false atendimento só em frases, sem [[OPTIONS]]
//   ai.journey.free_greeting       bool    false a saudação do chatbot é referência de tom,
//                                                reescrita a cada conversa (não copiada)
//   ai.journey.posture             bool    false bloco "Postura" (sem bajular, sem
//                                                concordar por concordar, sem "deixa eu
//                                                verificar", nunca inventar nome)
//   ai.journey.extended_dossier    bool    false ficha do lead ganha setor, atendente e
//                                                tamanho da conversa
export interface ConfigJornada {
  ritmoHumanoMs: number
  historico: number
  camposAutomaticos: boolean
  retomarAposEncerrar: boolean
  contatoMinimo: boolean
  calarAposTransferir: boolean
  agendaPorData: boolean
  maxOfertasAgenda: number
  lerMidia: boolean
  semMenus: boolean
  saudacaoLivre: boolean
  postura: boolean
  fichaAmpliada: boolean
}
/** Padrão = o motor de sempre. */
export const CONFIG_JORNADA_PADRAO: ConfigJornada = {
  ritmoHumanoMs: 0, historico: HISTORY_LIMIT, camposAutomaticos: false, retomarAposEncerrar: false,
  contatoMinimo: false, calarAposTransferir: false, agendaPorData: false, maxOfertasAgenda: 2,
  lerMidia: false, semMenus: false, saudacaoLivre: false, postura: false, fichaAmpliada: false,
}
const CONFIG_CACHE_MS = 60000
let configCache: { at: number; cfg: ConfigJornada } | null = null

function valorDaSetting(v: unknown): unknown {
  // Settings chegam como JSON cru: true, 5, "5", "\"true\"" — normaliza.
  if (typeof v === 'string') return v.replace(/^"+|"+$/g, '').trim()
  return v
}
function comoBool(v: unknown): boolean {
  const x = valorDaSetting(v)
  return x === true || x === 1 || x === 'true' || x === '1' || x === 'sim' || x === 'on'
}
function comoNumero(v: unknown): number | null {
  const x = valorDaSetting(v)
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

/** Lê os Settings `ai.journey.*` (uma consulta, cache de 60s). */
export async function configDaJornada(): Promise<ConfigJornada> {
  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) return configCache.cfg
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'ai.journey.' } }, select: { key: true, value: true } }).catch(() => [] as Array<{ key: string; value: unknown }>)
  const s = new Map(rows.map((r) => [r.key, r.value]))
  const pace = comoNumero(s.get('ai.journey.human_pace_seconds'))
  const hist = comoNumero(s.get('ai.journey.history_limit'))
  const ofertas = comoNumero(s.get('ai.journey.max_slot_offers'))
  const cfg: ConfigJornada = {
    ritmoHumanoMs: pace && pace > 0 ? Math.min(pace, 60) * 1000 : 0,
    historico: hist && hist > 0 ? Math.min(Math.round(hist), 60) : HISTORY_LIMIT,
    camposAutomaticos: comoBool(s.get('ai.journey.auto_custom_fields')),
    retomarAposEncerrar: comoBool(s.get('ai.journey.resume_after_done')),
    contatoMinimo: valorDaSetting(s.get('ai.journey.handoff_contact')) === 'nome_whatsapp',
    calarAposTransferir: comoBool(s.get('ai.journey.silence_after_handoff')),
    agendaPorData: comoBool(s.get('ai.journey.agenda_by_date')),
    maxOfertasAgenda: ofertas !== null && ofertas >= 0 ? Math.round(ofertas) : CONFIG_JORNADA_PADRAO.maxOfertasAgenda,
    lerMidia: comoBool(s.get('ai.journey.read_media')),
    semMenus: comoBool(s.get('ai.journey.no_menus')),
    saudacaoLivre: comoBool(s.get('ai.journey.free_greeting')),
    postura: comoBool(s.get('ai.journey.posture')),
    fichaAmpliada: comoBool(s.get('ai.journey.extended_dossier')),
  }
  configCache = { at: Date.now(), cfg }
  return cfg
}

// Ritmo humano: tempo de "digitar" antes de uma mensagem, proporcional a ela.
function typingDelayMs(body: string): number {
  return Math.min(6000, Math.max(1500, String(body || '').length * 30))
}

// fetch com timeout (AbortController) — nenhuma chamada externa pode pendurar o turno.
async function fetchWithTimeout(url: string, opts: any, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export // phase 'handoff' = o bot anunciou que um humano assume, mas a jornada NÃO morreu:
// se o lead continuar escrevendo e nenhum operador tiver entrado de fato (o que
// marcaria `_botPaused`), o bot segue atendendo em vez de deixar a pessoa no vácuo.
interface AiState {
  leadId: number | null
  /** Encaminhamentos a setor feitos pela IA (trava de pingue-pongue: >2 em 24h). */
  encaminhamentos?: Array<{ teamId: number | null; label: string; at: string }>
  phase: 'active' | 'done' | 'disqualified' | 'handoff'
  answers: Record<string, any>
  bookingId?: number | null
  /**
   * Quantas vezes já oferecemos agenda a este lead. Contar é papel do servidor:
   * pedir ao modelo que "escale depois de duas tentativas" é pedir que ele conte
   * sozinho ao longo da conversa, coisa que ele erra. Aqui vira número.
   */
  ofertasAgenda?: number
  /** ISO da retomada de um atendimento já encerrado (`ai.journey.resume_after_done`). */
  resumedAt?: string | null
  /** Consultor educacional: inscrição em foco, anexos usados (journey/eduSdr). */
  edu?: EduState
  /**
   * Destino provisório (opção de menu com `route.fallback`): para onde a
   * conversa vai se a pessoa parar de responder ou pedir uma pessoa antes de
   * escolher o setor. Ver services/inactivity.ts (reativação com IA).
   */
  fallbackRoute?: { teamId: number; funnelId: number | null; label?: string }
  /** Modo comercial decidido no começo do atendimento (journey/modoComercial). */
  comercial?: DecisaoComercial
}

/** Ofertas de horário antes de a conversa ir para um humano (regra do roteiro).
 *  Exportado porque o simulador precisa escalar no mesmo ponto. */
export const MAX_OFERTAS_AGENDA = 2

const locks = new Map<string, Promise<void>>()
// Rajada de mensagens (consultor educacional): quantas estão na fila por
// telefone e quando chegou a última.
const pendentes = new Map<string, number>()
const ultimaChegada = new Map<string, number>()

function stripTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

// mediaUrl de anexo é salvo relativo (`/media/...`) — a nota do lead precisa do
// link completo pra abrir fora do painel.
function absoluteUrl(url: string): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = String(process.env.APP_URL || '').replace(/\/+$/, '')
  return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url
}

// Slug canônico (snake_case, sem acento) para chave de campo personalizado.
export function slugifyKey(s: string): string {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

// Garante um CustomField ativo para `rawKey`; cria na hora quando a IA informa um
// dado que ainda não tem campo pré-cadastrado (para NÃO perder dado nenhum —
// ex.: 2º/3º filho, idade, ou qualquer dado imprevisto). Retorna a chave canônica.
// Só roda com `ai.journey.auto_custom_fields` ligado: criar campo no CRM é
// decisão do tenant, não do motor.
async function ensureCustomField(rawKey: string, label?: string): Promise<string | null> {
  const key = slugifyKey(rawKey)
  if (!key) return null
  const existing = await prisma.customField.findUnique({ where: { key } }).catch(() => null)
  if (existing) {
    if (!existing.active) await prisma.customField.update({ where: { key }, data: { active: true } }).catch(() => {})
    return key
  }
  const nice = ((label && String(label).trim()) || rawKey.replace(/_/g, ' ').trim() || key).slice(0, 191)
  const agg = await prisma.customField.aggregate({ _max: { position: true } }).catch(() => null)
  await prisma.customField.create({ data: {
    key, label: nice, type: 'text', group: 'custom',
    showInList: false, showInKanban: false, showInForm: false, active: true,
    position: ((agg?._max?.position ?? 0) as number) + 1,
  } }).catch(() => {})
  return key
}

// Mapeia o que a IA salvou num campo de seleção para o VALUE da opção (a qualificação
// usa o value, não o label). Casa por value exato ou por label (case/acento-insensível,
// contém em qualquer direção). Sem match → mantém como veio.
export function mapSelectValue(field: any, valor: string): string {
  if (field?.type !== 'select' || !Array.isArray(field.options) || !field.options.length) return valor
  const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const byVal = field.options.find((o: any) => String(o.value) === String(valor))
  if (byVal) return byVal.value
  const v = norm(valor)
  if (!v) return valor
  const byLabel = field.options.find((o: any) => {
    const l = norm(stripTags(o.label))
    return l && (l === v || v.includes(l) || l.includes(v))
  })
  return byLabel ? byLabel.value : valor
}

// Marcador de opções: [[OPTIONS: a | b | c]] ou, com rótulo para o botão da
// lista, [[OPTIONS Núcleos: a | b | c]].
const MARCADOR_OPCOES = /\[\[\s*OPTIONS(?:\s+([^:\]]{1,40}?))?\s*:(.+?)\]\]/gis

function lerOpcoes(lista: string): string[] {
  return lista.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 10)
}

// Extrai botões do marcador [[OPTIONS: a | b | c]] no fim do texto da IA.
export function extractOptions(raw: string): { text: string; options: string[] } {
  const m = new RegExp(MARCADOR_OPCOES.source, 'is').exec(raw || '')
  if (!m) return { text: (raw || '').trim(), options: [] }
  const options = lerOpcoes(m[2])
  const text = (raw || '').replace(m[0], '').trim()
  return { text, options }
}

export interface BlocoDeOpcoes { text: string; options: string[]; rotulo?: string }

/**
 * Divide a resposta da IA nos blocos que viram mensagens: cada marcador de
 * opções fecha um bloco com o texto que veio antes dele. Assim uma resposta
 * pode mandar mais de um menu (ex.: duas listas, porque a lista do WhatsApp
 * tem no máximo 10 itens). Texto depois do último marcador vira um bloco sem
 * opções. Sem marcador, é um bloco só — o comportamento de sempre.
 */
export function extrairBlocosDeOpcoes(raw: string): BlocoDeOpcoes[] {
  const texto = raw || ''
  const blocos: BlocoDeOpcoes[] = []
  let inicio = 0
  for (const m of texto.matchAll(MARCADOR_OPCOES)) {
    const rotulo = m[1]?.trim() || undefined
    const antes = texto.slice(inicio, m.index).trim()
    blocos.push({ text: antes || (rotulo ? `${rotulo}:` : 'Escolha uma opção:'), options: lerOpcoes(m[2]), ...(rotulo ? { rotulo } : {}) })
    inicio = (m.index ?? 0) + m[0].length
  }
  const resto = texto.slice(inicio).trim()
  if (resto || !blocos.length) blocos.push({ text: resto, options: [] })
  return blocos.filter((b) => b.text || b.options.length)
}

/**
 * O texto que está em `Lead.nome` serve para se dirigir a uma pessoa?
 *
 * Descarta o que claramente NÃO é nome — telefone formatado (é o que o sistema
 * grava quando a empresa não tem o contato na agenda), string só de dígitos,
 * emoji/símbolos, uma letra solta. Casos ambíguos ("DEUS É AMOR", "Studio Bella
 * Cabelos") passam por aqui e vão para o prompt com a ressalva de que podem não
 * ser um nome de pessoa: aí quem julga é a IA, que faz isso melhor que regex.
 */
export function pareceNomeDePessoa(nome: string | null | undefined): boolean {
  const bruto = String(nome ?? '').trim()
  if (!bruto) return false

  // Telefone: "(62) 99871-6285", "+5562998716285", "62998716285".
  const soDigitos = bruto.replace(/\D/g, '')
  if (soDigitos.length >= 8 && soDigitos.length >= bruto.replace(/\s/g, '').length - 4) return false

  // Sem emoji/símbolo, sobrou algo com letras?
  const limpo = bruto
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu, '')
    .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
    .trim()
  if (limpo.length < 2) return false
  if (!/\p{L}/u.test(limpo)) return false

  return true
}

function fmtWhen(d: Date, tz: string): string {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d) }
  catch { return d.toISOString() }
}

// ── Esquema das ferramentas (formato Anthropic; convertido p/ OpenAI on-the-fly) ──
const TOOLS = [
  {
    name: 'salvar_dados',
    description: 'Grava no lead as respostas coletadas. Chame sempre que o lead informar um dado (nome, e-mail, e os campos do formulário). Use as CHAVES exatas listadas em "Dados a coletar".',
    input_schema: {
      type: 'object',
      properties: {
        campos: {
          type: 'array',
          description: 'Lista de pares chave/valor a salvar.',
          items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' } }, required: ['chave', 'valor'] },
        },
      },
      required: ['campos'],
    },
  },
  {
    name: 'rotear_setor',
    description: 'Encaminha o lead, nos bastidores, para o SETOR/equipe responsável assim que você identificar o que ele procura. Chame UMA única vez, logo que a intenção ficar clara. Use exatamente uma das chaves listadas em "Setores disponíveis". É silencioso — não anuncie ao lead que houve encaminhamento.',
    input_schema: {
      type: 'object',
      properties: {
        setor: { type: 'string', description: 'Chave do setor (value da opção), exatamente como em "Setores disponíveis".' },
        resumo: { type: 'string', description: 'Uma frase com o que a pessoa precisa, com o que ela já informou (vai para a equipe numa nota interna, não para o lead). Obrigatório quando o setor não é destino provisório.' },
      },
      required: ['setor'],
    },
  },
  {
    name: 'avaliar_qualificacao',
    description: 'Avalia (de forma determinística, no servidor) se o lead está qualificado com base nas respostas já salvas. Chame depois de coletar os campos qualificadores. Retorna se está qualificado e a instrução do que fazer.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'listar_horarios',
    description: 'Retorna os horários REAIS disponíveis para agendar a reunião. Use SOMENTE estes horários ao oferecer ao lead — nunca invente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'agendar',
    description: 'Agenda a reunião no horário escolhido pelo lead. Recebe o horário no formato ISO exatamente como veio de listar_horarios (campo startAt). Cria o evento na agenda + link da reunião e dispara a confirmação. Só confirme o agendamento ao lead DEPOIS desta ferramenta retornar ok=true.',
    input_schema: {
      type: 'object',
      properties: { startAt: { type: 'string', description: 'Horário ISO escolhido (campo startAt de listar_horarios).' } },
      required: ['startAt'],
    },
  },
  {
    name: 'encerrar',
    description: 'Encerra a jornada quando não há mais o que fazer (lead desqualificado, ou concluído sem agendar). Informe se ficou qualificado.',
    input_schema: {
      type: 'object',
      properties: { qualificado: { type: 'boolean' }, motivo: { type: 'string' } },
      required: ['qualificado'],
    },
  },
  {
    name: 'transferir_humano',
    description: 'Transfere a conversa para um atendente humano (lead pediu, caso complexo, ou fora do escopo). A IA para de responder.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string' },
        pedido_do_lead: {
          type: 'boolean',
          description: 'true quando o lead PEDIU para falar com uma pessoa, demonstrou impaciência/insatisfação, ou pediu proposta/contrato. Nesses casos a transferência é imediata e você NÃO deve pedir mais nenhum dado antes.',
        },
        sensivel: {
          type: 'boolean',
          description: 'true em caso sensível: reclamação ou insatisfação com a empresa, ameaça de processo/Procon/denúncia, pedido de reembolso ou indenização, ou problema que você não tem autonomia para resolver. A transferência é imediata, fica registrada como insatisfação e você NÃO responde mais nesta conversa até a equipe devolver. Escreva em `motivo` o que a pessoa relatou, nas palavras dela.',
        },
      },
      required: [],
    },
  },
  {
    name: 'consultar_catalogo',
    description: 'Consulta o CATÁLOGO REAL do que a empresa vende (produtos, serviços, planos). Use SEMPRE que o lead perguntar sobre itens, preços, condições ou disponibilidade. Retorna apenas o que EXISTE no catálogo (nome, categoria, preço, disponibilidade). Você deve responder somente com o que esta ferramenta devolver — NUNCA invente itens, preços ou características.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Termo do que o lead procura, nas palavras dele. Opcional.' },
        categoria: { type: 'string', description: 'Filtrar por uma categoria exata do catálogo. Opcional.' },
      },
      required: [],
    },
  },
]

type ToolDef = { name: string; description: string; input_schema: any }

// Variantes de ferramenta ligadas por configuração (ver configDaJornada). A
// descrição de uma ferramenta é instrução para o modelo — mudar o que ela faz
// sem mudar o que ela diz deixaria o modelo usando a versão antiga.
const SALVAR_DADOS_AUTOMATICO: ToolDef = {
  name: 'salvar_dados',
  description: 'Grava no lead as respostas coletadas. Chame sempre que o lead informar um dado (nome, e-mail, e os campos do formulário). NENHUM dado informado pelo lead pode se perder. Prefira as CHAVES exatas listadas em "Dados a coletar". Se o lead informar um dado que NÃO tem chave listada (ex.: 2º/3º filho, idade, ou qualquer dado imprevisto), invente uma chave curta em snake_case (ex.: filho_2_nome, filho_2_idade) e envie também um "rotulo" legível (ex.: "Filho(a) 2 — Nome") — o sistema cria o campo automaticamente e salva. Nunca deixe de salvar um dado por falta de campo pré-cadastrado.',
  input_schema: {
    type: 'object',
    properties: {
      campos: {
        type: 'array',
        description: 'Lista de pares chave/valor a salvar.',
        items: { type: 'object', properties: { chave: { type: 'string' }, valor: { type: 'string' }, rotulo: { type: 'string', description: 'Rótulo legível do campo, usado só quando a chave ainda não existe (para criar o campo). Opcional.' } }, required: ['chave', 'valor'] },
      },
    },
    required: ['campos'],
  },
}
const LISTAR_HORARIOS_POR_DATA: ToolDef = {
  name: 'listar_horarios',
  description: 'Retorna os horários REAIS disponíveis para agendar a reunião, com a data de hoje e rótulos "hoje"/"amanhã". Use SOMENTE estes horários ao oferecer ao lead — nunca invente. Sem filtro, traz uma amostra dos próximos dias (manhã e tarde) e a lista dos demais dias com vaga; se a pessoa pedir um dia ou período específico, chame de novo com `data` e/ou `periodo`.',
  input_schema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Opcional. Dia pedido pela pessoa, AAAA-MM-DD ou DD/MM — use o "calendario" do resultado anterior para achar a data certa de "sexta", "semana que vem" etc. Devolve todos os horários livres desse dia.' },
      periodo: { type: 'string', enum: ['manha', 'tarde', 'noite'], description: 'Opcional. Só horários desse período (manhã < 12h, tarde 12h–18h, noite ≥ 18h).' },
    },
    required: [],
  },
}
function comVariantes(tools: ToolDef[], cfg: ConfigJornada): ToolDef[] {
  if (!cfg.camposAutomaticos && !cfg.agendaPorData) return tools
  return tools.map((t) => {
    if (t.name === 'salvar_dados' && cfg.camposAutomaticos) return SALVAR_DADOS_AUTOMATICO
    if (t.name === 'listar_horarios' && cfg.agendaPorData) return LISTAR_HORARIOS_POR_DATA
    return t
  })
}

// Consultor educacional: as ferramentas do portal + as genéricas que fazem
// sentido nele. Fica de fora o que é de outro tipo de jornada (setor, nota de
// qualificação, agenda, catálogo de produtos) — e `encerrar`, porque quem volta
// semana que vem para pagar ou mandar documento tem de ser atendido.
const EDU_BASE = new Set(['salvar_dados', 'transferir_humano'])
/** O formulário tem menu de departamentos (campo select com `route`)? */
export function temDepartamentos(form: any): boolean {
  return (form?.fields || []).some((f: any) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
}
// Modo qualificação (modo comercial com a equipe online): sem nada que inscreva,
// cobre, mande link ou agende — isso é da equipe. Tirar a ferramenta é o que
// garante; a instrução no prompt sozinha não bastaria.
const SO_DA_EQUIPE_COMERCIAL = new Set([...EDU_TOOLS_MATRICULA, 'pre_inscricao_curso_indisponivel', 'listar_horarios', 'agendar'])
export function ferramentasDaJornada(form: any, cfg: ConfigJornada = CONFIG_JORNADA_PADRAO, opts: { qualificacao?: boolean } = {}): ToolDef[] {
  const todas = ferramentasDaJornadaCompleta(form, cfg)
  return opts.qualificacao ? todas.filter((t) => !SO_DA_EQUIPE_COMERCIAL.has(t.name)) : todas
}
function ferramentasDaJornadaCompleta(form: any, cfg: ConfigJornada): ToolDef[] {
  if (!eduSdrLigado(form)) return comVariantes(TOOLS, cfg)
  // rotear_setor entra só quando há departamentos configurados: quem escreve
  // sobre boleto, histórico ou acesso à plataforma não é matrícula e tem de
  // chegar à equipe certa.
  const base = new Set(EDU_BASE)
  if (temDepartamentos(form)) base.add('rotear_setor')
  // Matrícula pelo chat desligada: sem as ferramentas que inscrevem, cobram,
  // anexam documento, assinam contrato ou mandam link do portal.
  const edu = matriculaPeloChatLigada(form) ? EDU_TOOLS : EDU_TOOLS.filter((t) => !EDU_TOOLS_MATRICULA.has(t.name))
  return [...comVariantes(TOOLS, cfg).filter((t) => base.has(t.name)), ...edu]
}

/** Instrução depois de rotear no modo educacional: aqui o encaminhamento É o
 *  atendimento (o bot não resolve boleto nem histórico), então a pessoa é
 *  avisada — ao contrário da triagem silenciosa das outras jornadas. */
export function instrucaoDepartamentoEdu(rotulo: string): string {
  // O rótulo da opção traz o escopo entre parênteses para a IA escolher; para
  // falar com a pessoa basta o nome do departamento.
  const setor = rotulo.replace(/\s*\(.*\)\s*$/, '').trim() || rotulo
  return `Assunto encaminhado para: ${setor} (a equipe já foi atribuída). Diga à pessoa, numa mensagem curta e acolhedora, que o assunto dela fica com a equipe de ${setor} e que a equipe continua o atendimento por aqui mesmo, neste WhatsApp, em horário comercial. Se ela já contou o problema, não peça para repetir; se ainda não contou, peça que descreva em uma mensagem para a equipe já pegar com tudo. NÃO tente resolver o assunto você mesmo e NÃO chame transferir_humano depois disto. Esta é a sua última mensagem nesta conversa: daqui em diante quem responde é a equipe.`
}

// ── Trilhas de entrada (rotas do mesmo bot) ─────────────────────────────────
//
// O chatbot é escolhido pela instância/conexão do WhatsApp: um número, um bot. Mas
// nem todo lead chega do mesmo jeito — quem vem de um formulário de anúncio NÃO
// escreveu primeiro: nós é que abrimos a conversa (HSM/fluxo). Se esse lead recebe a
// mesma abertura de quem mandou "oi", o bot se apresenta como se nada tivesse
// acontecido e a conversa começa torta.
//
// A trilha é marcada no LEAD (`formData._botRoute`) no momento em que ele nasce
// (routes/meta.ts marca 'meta_ads'), e aqui vira um bloco extra de instruções no
// system prompt, guardado num Setting (`chatbot.route_<trilha>`) para o cliente
// editar o texto sem tocar em código. Lead sem marcador, ou trilha sem Setting →
// nada muda: o prompt sai idêntico ao de sempre.
//
// De propósito NÃO usamos `lead.chatbotId` como seletor de trilha: esse campo é lido
// por workers.ts para resolver a instância Evolution de envio, e apontá-lo para um
// chatbot sem instância vinculada faria a mensagem sair pela instância errada.
const ROUTE_KEY_RE = /^[a-z0-9_]{1,40}$/

export function readBotRoute(formData: unknown): string | null {
  const fd = (formData || {}) as any
  const r = typeof fd._botRoute === 'string' ? fd._botRoute.trim() : ''
  return r && ROUTE_KEY_RE.test(r) ? r : null
}

/** Bloco de prompt da trilha do lead (null = lead sem trilha ou trilha sem texto). */
export async function getBotRouteBlock(formData: unknown): Promise<string | null> {
  const route = readBotRoute(formData)
  if (!route) return null
  const s = await prisma.setting.findUnique({ where: { key: `chatbot.route_${route}` } }).catch(() => null)
  const v: any = s?.value
  const txt = typeof v === 'string' ? v : (v && typeof v === 'object' ? String(v.prompt || '') : '')
  return txt.trim() || null
}

/**
 * Contexto de um atendimento que já tinha sido encerrado e a pessoa retomou
 * (`ai.journey.resume_after_done`). O histórico de mensagens sozinho não basta:
 * o que sustenta a continuidade é saber o DESFECHO (agendou? foi encaminhada?
 * ficou sem resposta?) e há quanto tempo isso foi. Sem isto o modelo tende a
 * reabrir o atendimento do começo.
 */
async function buildResumeContext(leadId: number, lead: any, resumedFrom: string): Promise<string> {
  const fmt = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d)
  const linhas: string[] = []

  const desfecho = resumedFrom === 'disqualified'
    ? 'o atendimento anterior terminou sem seguir para o agendamento'
    : resumedFrom === 'handoff'
      ? 'a conversa anterior foi entregue a um setor da equipe'
      : 'o atendimento anterior foi dado como concluído'
  linhas.push(`- Como parou: ${desfecho}.`)

  const booking = await prisma.booking.findFirst({
    where: { leadId, status: { not: 'cancelled' } }, orderBy: { startAt: 'desc' },
    select: { startAt: true, status: true },
  }).catch(() => null)
  if (booking) {
    const passou = booking.startAt.getTime() < Date.now()
    linhas.push(`- Reunião/visita ${passou ? 'que estava marcada para' : 'JÁ AGENDADA para'} ${fmt(booking.startAt)}${passou ? ' (data já passou)' : ''}. NÃO ofereça agendamento de novo sem antes falar sobre esta.`)
  } else {
    linhas.push('- Não existe reunião/visita agendada para esta pessoa.')
  }

  if (lead?.teamId) {
    const team = await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } }).catch(() => null)
    if (team?.name) linhas.push(`- A conversa está com o setor ${team.name}.`)
  }
  if (lead?.lastMessageAt) linhas.push(`- Última interação registrada: ${fmt(new Date(lead.lastMessageAt))}.`)

  return [
    'Esta pessoa JÁ conversou com a gente antes e o atendimento tinha sido encerrado — agora ela voltou a escrever. O histórico acima é a conversa real de vocês.',
    ...linhas,
    'Como agir: leia o histórico ANTES de responder e continue do ponto em que parou. NÃO recomece o atendimento, NÃO se apresente de novo, NÃO repita a saudação e JAMAIS refaça perguntas que ela já respondeu — reveja no histórico em vez de perguntar. Se ela trouxer assunto novo, siga por ele. Se você não tiver certeza do que ficou pendente, faça UMA pergunta específica sobre aquele ponto ("vocês chegaram a decidir sobre a visita de quinta?"), nunca uma pergunta genérica do tipo "como posso ajudar?".',
  ].join('\n')
}

// ── System prompt: prompt-mestre + dados a coletar (dos fields do form) + protocolo ──
const CUMPRIMENTO = /^(oi+|ol[aá]+|opa|e a[ií]|al[oô]|oi+e+|bom dia|boa tarde|boa noite|paz do senhor|a paz( do senhor)?|tudo bem|oi,? tudo bem)[\s!.?,;:)(\p{Extended_Pictographic}]*$/iu
/** A mensagem é só um cumprimento, sem assunto. */
export function soCumprimento(texto: string): boolean {
  return CUMPRIMENTO.test(String(texto || '').trim())
}
const AVISO_CUMPRIMENTO = '[aviso interno do sistema, não é a pessoa] A mensagem acima é só um cumprimento de quem já conversou com você. Não responda apenas "estou aqui" / "como posso ajudar?" e não repita o que já disse. Veja a situação ATUAL na ficha interna (etapa pendente, novidades, último assunto) e conduza o próximo passo concreto, com as opções em botões quando houver.'
// Mesmo aviso para quem atende sem menus (`ai.journey.no_menus`): pedir "botões"
// ali contradiria a regra do próprio prompt.
const AVISO_CUMPRIMENTO_SEM_MENUS = AVISO_CUMPRIMENTO.replace(', com as opções em botões quando houver.', '.')

/**
 * Mensagem INTERNA na conversa ao passar a pessoa para a equipe: o que ela pediu
 * e o que o sistema confirmou (vínculo, inscrições, outras fichas), para quem
 * assume não refazer as perguntas. Não é enviada ao contato.
 */
async function notaDeEncaminhamento(leadId: number, chatbot: any, destino: string, resumo?: unknown): Promise<void> {
  const fatos = await resumoParaEquipe(leadId).catch(() => [] as string[])
  const assunto = String(resumo ?? '').trim()
  const nome = chatbot?.name || 'Chatbot'
  const body = [`📋 ${nome} — resumo para o atendimento (${destino})`, assunto ? `Assunto: ${assunto.slice(0, 400)}` : '', ...fatos].filter(Boolean).join('\n')
  await prisma.message.create({ data: { leadId, fromMe: true, isInternal: true, body, senderName: nome, timestamp: new Date() } }).catch(() => {})
}

// Como o lead chegou até nós, por `originType` — em palavras que a IA pode usar
// na abertura. Sem isto ela não tinha como saber, e ou ficava genérica ou (pior)
// arriscava cravar um canal errado ("vi que veio pelo Google" pra quem veio de
// anúncio no Meta).
const ORIGEM_DESCRICAO: Partial<Record<string, string>> = {
  meta_ctwa: 'clicou num anúncio do Instagram/Facebook que abre direto o WhatsApp',
  meta_lead_ads: 'preencheu um formulário de um anúncio no Facebook/Instagram',
  google_ads: 'clicou num anúncio no Google',
  web_form: 'preencheu um formulário no nosso site',
  web_chat: 'começou a falar pelo chat do nosso site',
  organic: 'chegou pelo nosso site (busca, não veio de anúncio pago)',
  trackable_link: 'clicou num link que compartilhamos',
  instagram: 'chamou a gente direto pelo Instagram',
  telegram: 'chamou a gente direto pelo Telegram',
  enrollment_portal: 'já estava no nosso portal de matrículas',
}

/**
 * O que entra no prompt além do básico. Tudo opcional: sem `extras`, o prompt
 * sai idêntico ao de antes (é o que o simulador antigo e a reativação usam).
 */
export interface ExtrasDoPrompt {
  /** Configuração da jornada do tenant (padrão = CONFIG_JORNADA_PADRAO). */
  cfg?: ConfigJornada
  /** Bloco da trilha de entrada do lead (getBotRouteBlock). Substitui a saudação. */
  routeBlock?: string | null
  /** Contexto de retomada de atendimento encerrado. Tem precedência sobre a trilha. */
  resumeBlock?: string | null
  /** Modo qualificação do modo comercial: tira a matrícula do protocolo e vai no fim. */
  qualificacao?: string | null
}

export function buildSystemPrompt(chatbot: any, form: any, lead: any, state: AiState, catalogSummary: string, businessHours?: string | null, brandName?: string | null, contextoLead?: string | null, edu?: string | null, extras: ExtrasDoPrompt = {}): string {
  const fields: any[] = form?.fields || []
  const cfg = extras.cfg ?? CONFIG_JORNADA_PADRAO
  const { routeBlock, resumeBlock } = extras

  /**
   * Mesmas variáveis que o motor 'ai' já resolve (chatbotFlow): quem escreve o
   * roteiro não deve fixar no texto o nome da atendente nem o da marca — trocar
   * a persona passa a ser renomear o chatbot, sem reescrever prompt nenhum.
   */
  const interpolarMarca = (s: string): string => s
    .replace(/\{\{\s*attendant_name\s*\}\}/gi, chatbot?.name || 'Atendimento')
    .replace(/\{\{\s*brand_name\s*\}\}/gi, brandName || '')
  const collect = fields
    .filter((f) => f && f.type !== 'statement' && f.type !== 'scheduling')
    .map((f) => {
      const label = stripTags(f.label) || f.key
      const opts = f.type === 'select' && Array.isArray(f.options) && f.options.length
        ? ` — opções: ${f.options.map((o: any) => stripTags(o.label)).join(' | ')}` : ''
      const tags = [f.required ? 'obrigatório' : '', f.isQualifier ? 'qualificador' : ''].filter(Boolean).join(', ')
      return `- chave \`${f.key}\`: ${label}${opts}${tags ? ` (${tags})` : ''}`
    }).join('\n')

  // Setores de triagem: opções do menu (campo select) que carregam um `route`. Quando
  // existem, a IA encaminha o lead à equipe certa via a ferramenta rotear_setor.
  const routeField = fields.find((f) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
  // Opções com `route.fallback` não são setor: registram o destino provisório
  // da primeira escolha e a conversa segue. Ficam num bloco à parte para a IA
  // não as confundir com encaminhamento.
  const comRota = routeField ? routeField.options.filter((o: any) => o?.route) : []
  const provisorias = comRota.filter((o: any) => o.route.fallback)
  const setores = [
    ...comRota.filter((o: any) => !o.route.fallback).map((o: any) => `- \`${o.value}\`: ${stripTags(o.label)}`),
    ...(provisorias.length ? [
      '',
      'Destino provisório (NÃO é encaminhamento: chame rotear_setor com a chave assim que a pessoa fizer essa escolha, sem avisar nada e sem parar a conversa):',
      ...provisorias.map((o: any) => `- \`${o.value}\`: ${stripTags(o.label)}`),
    ] : []),
  ].join('\n')

  // Nomes-placeholder (lead criado sem nome real, ex.: canal web sem perfil) NÃO
  // contam como nome conhecido — senão a IA cumprimenta "Olá, Lead LP".
  const PLACEHOLDER_NAMES = new Set(['lead lp', 'lead', 'webchat'])
  const nomeBruto = lead?.nome && !PLACEHOLDER_NAMES.has(String(lead.nome).trim().toLowerCase()) ? String(lead.nome) : ''
  // O que está em `Lead.nome` nem sempre é o nome de uma PESSOA: quando a empresa
  // não tem o contato salvo na agenda, o sistema grava o telefone formatado, e o
  // que a pessoa escolheu no perfil do WhatsApp costuma ser apelido, nome de
  // empresa ou frase ("DEUS É AMOR", um emoji, uma letra só). Chamar o lead assim
  // é pior do que não usar nome nenhum.
  const nomeUsavel = pareceNomeDePessoa(nomeBruto)
  const realNome = nomeUsavel ? nomeBruto : ''
  // whatsapp sintético do canal web (webchat:<uid>) não é um telefone real.
  const realWhats = lead?.whatsapp && !String(lead.whatsapp).startsWith('webchat:') ? lead.whatsapp : ''
  const known = [
    realNome ? `nome: ${realNome}` : '',
    realWhats ? `whatsapp: ${realWhats}` : '',
    lead?.email ? `email: ${lead.email}` : '',
    // Origem/campanha ajudam a IA a distinguir contexto sem perguntar de novo —
    // ex.: veio de anúncio de vaga (RH) vs. formulário institucional (comercial).
    lead?.source ? `origem do lead: ${lead.source}${lead.campaignName ? ` (campanha: ${lead.campaignName})` : ''}` : '',
  ].filter(Boolean).join(' · ')
  // Campos personalizados já preenchidos antes desta conversa (import, outro
  // formulário, CRM externo) — contexto que a IA não tem como obter perguntando,
  // porque o próprio lead já respondeu isso em outro lugar.
  const customFieldsList = lead?.customFields && typeof lead.customFields === 'object'
    ? Object.entries(lead.customFields as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')
    : ''
  const already = Object.keys(state.answers || {})
  const hasSched = fields.some((f) => f?.type === 'scheduling')
  const origemDescricao = ORIGEM_DESCRICAO[lead?.originType as string] || ''

  // Contato exigido antes do hand-off: só o que o form pede de fato.
  const contatoObrigatorio = Array.from(new Set(
    fields.filter((f) => CONTACT_MAPTOS.includes(f?.mapTo)).map((f) => CONTACT_LABEL[f.mapTo] || f.mapTo),
  )).join(', ')

  const nm = realNome || state.answers?.nome || ''
  // Saudação configurada do chatbot: a IA conduz a abertura, mas DEVE abrir com
  // esta mensagem (no tom da marca). Só vale para a 1ª mensagem da conversa.
  const greeting = interpolarMarca((chatbot?.greetingMessage && String(chatbot.greetingMessage).trim()) || '')
  const schedIntro = (chatbot?.schedulingIntro && String(chatbot.schedulingIntro).trim())
    ? interpolarMarca(String(chatbot.schedulingIntro).replace(/\{\{\s*nome\s*\}\}/gi, nm || '{nome do lead}').replace(/\{\{\s*reuniao\s*\}\}/gi, 'reunião').trim())
    : ''

  const base = interpolarMarca((chatbot?.aiJourneyPrompt && String(chatbot.aiJourneyPrompt).trim()) || '') || [
    `Você é um(a) atendente comercial da nossa empresa, conversando por WhatsApp com um lead.`,
    `Seu objetivo: conduzir uma conversa natural e cordial para conhecer o lead, coletar os dados necessários, qualificá-lo e — se qualificado${hasSched ? ' — agendar uma reunião' : ''}.`,
    `Seja humano, objetivo e simpático. Faça UMA pergunta por vez. Não despeje todas as perguntas de uma vez.`,
  ].join('\n')

  return [
    base,
    `\n## Dados a coletar (use estas chaves ao chamar salvar_dados)\n${collect || '(nenhum)'}`,
    setores && edu ? `\n## Departamentos (use rotear_setor)\n${setores}\n\nQuando a pessoa trouxer um assunto que NÃO é conhecer cursos ou fazer/continuar a inscrição (ex.: aluno com dúvida de boleto, histórico, acesso à plataforma, estágio), identifique o departamento e chame **rotear_setor** com a chave certa — uma única vez. Na dúvida entre dois, pergunte uma coisa só para decidir. Se for algo que nenhum departamento cobre, use transferir_humano.` : '',
    setores && !edu && !cfg.contatoMinimo ? `\n## Setores disponíveis (use rotear_setor)\n${setores}\n\nQuando entender o que o lead procura, identifique o setor — mas só chame **rotear_setor** DEPOIS de já ter coletado e salvo os dados de contato (veja "Dados de contato"). Chame uma única vez; encaminha o lead à equipe certa nos bastidores — siga com naturalidade, sem anunciar o encaminhamento.` : '',
    // `ai.journey.handoff_contact = nome_whatsapp`: para encaminhar basta saber
    // QUEM é a pessoa. Quem escreve pedindo o financeiro já está no sistema e não
    // deve ser interrogado por e-mail/cidade só para ser atendido.
    setores && !edu && cfg.contatoMinimo ? `\n## Setores disponíveis (use rotear_setor)\n${setores}\n\nQuando entender o que o lead procura, identifique o setor — mas só chame **rotear_setor** DEPOIS de já ter os dados de contato mínimos (veja "Dados de contato"). Chame uma única vez. A escolha do setor deve ser confirmada com a pessoa antes: encaminhar errado faz o atendimento recomeçar do zero.` : '',
    // A lista sai dos campos de contato que o formulário REALMENTE coleta — é
    // exatamente o que a trava de transferir_humano exige (missingContactData).
    // Fixá-la em "nome, e-mail, WhatsApp e cidade" fazia a IA cobrar e-mail em
    // roteiros que decidiram não pedir e-mail, contrariando o próprio roteiro.
    contatoObrigatorio && !cfg.contatoMinimo
      ? `\n## Dados de contato (obrigatório antes de encaminhar para humano)\nAntes de chamar rotear_setor ou transferir_humano, você PRECISA ter coletado e salvo (via salvar_dados) os dados de contato do lead: ${contatoObrigatorio}. Peça apenas o que ainda não souber (veja "Já sabemos"/"Respostas já coletadas"), de forma natural e UMA pergunta por vez. Não encaminhe ao atendimento humano sem esses dados. NÃO peça nenhum dado de contato além destes.`
      : '',
    cfg.contatoMinimo
      ? `\n## Dados de contato antes de encaminhar para humano\nPara chamar rotear_setor ou transferir_humano basta saber QUEM é a pessoa: **nome e WhatsApp**. Se já souber os dois (veja "Já sabemos"/"Respostas já coletadas"), encaminhe na hora — não peça mais nada. Se faltar algum, peça só ele, de forma natural. NÃO exija e-mail nem cidade para encaminhar: quem procura um setor quer ser atendido, não preencher cadastro. Os demais dados são coletados no momento próprio da conversa (por exemplo, o e-mail ao confirmar um agendamento).`
      : '',
    known ? `\n## Já sabemos sobre o lead\n${known}` : '',
    customFieldsList ? `\n## Campos personalizados do lead (contexto adicional, já preenchidos antes desta conversa)\n${customFieldsList}` : '',
    origemDescricao ? `\n## Como este lead chegou até nós\n${origemDescricao}\n\nUse isso pra soar informado na abertura, SE fizer sentido natural mencionar. NUNCA cite um canal diferente deste (ex.: não diga "veio pelo Google" se a origem aqui for outra) — na dúvida, não mencione origem nenhuma.` : '',
    // Ficha do lead no CRM. Sem isto a IA trata quem já é atendido há semanas
    // como se fosse a primeira mensagem dele: repete perguntas já respondidas em
    // campo personalizado, reapresenta a empresa para quem já falou com um
    // consultor e reoferece reunião para quem já tem uma marcada.
    contextoLead ? `\n## Ficha deste lead no sistema (INTERNA — nunca leia isto para o lead)
${contextoLead}

Esta ficha é da EQUIPE, não do lead. Use para NÃO perguntar o que já se sabe e NÃO repetir assunto já tratado: confirme em vez de perguntar de novo ("vocês são de Goiânia, certo?"), e nunca reapresente a empresa para quem já conversou com o time.
REGRA ABSOLUTA: não cite, não repita, não resuma e não dê a entender o conteúdo desta ficha para o lead. Anotação interna, etiqueta e etapa do funil são avaliações da equipe sobre ele ("não retornou", "5 tentativas sem resposta") — dizer isso ao lead constrange e expõe a operação. Se ele perguntar o que temos registrado, responda apenas o que ELE mesmo informou nesta conversa.` : '',
    already.length ? `\n## Respostas já coletadas nesta conversa\n${already.map((k) => `- ${k}: ${state.answers[k]}`).join('\n')}` : '',
    // Retomada > trilha de entrada > saudação. Quem chegou por anúncio já recebeu
    // a mensagem da empresa antes de responder — repetir a saudação de quem mandou
    // "oi" faria o bot começar do zero uma conversa que já está em curso; e quem
    // já conversou não pode receber saudação de primeiro contato.
    resumeBlock
      ? `\n## Esta conversa é uma RETOMADA (LEIA ANTES DE RESPONDER)\n${resumeBlock}`
      : routeBlock
        ? `\n## Como esta conversa começou (LEIA ANTES DE RESPONDER)\n${interpolarMarca(routeBlock)}`
        : greeting && cfg.saudacaoLivre
          // `ai.journey.free_greeting`: a saudação vira referência de tom, não texto
          // fixo — a mesma frase pronta em toda conversa soa robô.
          ? `\n## Abertura da conversa\nSe esta for a SUA primeira mensagem (não há nenhuma mensagem sua antes no histórico), abra no espírito desta saudação — ela é referência de TOM e de conteúdo, não um texto para copiar. Escreva com as suas palavras, em uma ou duas frases curtas e objetivas, personalizando com o nome quando souber, e VARIE a formulação a cada conversa (nunca a mesma frase pronta duas vezes), mantendo sempre o mesmo tom de voz da marca. Não a repita nas mensagens seguintes:\n"${greeting}"`
          : greeting ? `\n## Abertura da conversa\nSe esta for a SUA primeira mensagem (não há nenhuma mensagem sua antes no histórico), ABRA com esta saudação, mantendo o sentido e o tom — você pode adaptá-la levemente e personalizar com o nome do lead quando souber. Não a repita nas mensagens seguintes:\n"${greeting}"` : '',
    // Consultor educacional: o protocolo dele (portal como fonte da verdade,
    // matrícula pelo chat) substitui o genérico de qualificar/agendar/encerrar.
    edu ? (extras.qualificacao ? semSecaoDeMatricula(edu) : matriculaPeloChatLigada(form) ? edu : semSecaoDeMatricula(edu) + (matriculaPorLink(form) ? PROTOCOLO_MATRICULA_POR_LINK : PROTOCOLO_SEM_MATRICULA)) : `\n## Como agir
- Na primeira mensagem, cumprimente com a saudação de abertura (acima) e já encaminhe a conversa. Depois, comece a coletar os dados que faltam, um por vez, de forma natural.
- Sempre que o lead responder um dado, chame **salvar_dados** com a(s) chave(s) corretas.
- Depois de coletar os campos qualificadores, chame **avaliar_qualificacao** e siga a instrução que ela retornar (o servidor decide a qualificação — não decida por conta própria).
- Se qualificado${hasSched ? ' e houver agendamento: chame **listar_horarios**, ofereça os horários ao lead, e ao ele escolher chame **agendar** com o startAt exato. Só diga que está agendado depois de agendar retornar ok=true.' : ': agradeça e finalize com **encerrar**.'}
- Se desqualificado: agradeça cordialmente, NÃO ofereça agendamento, e chame **encerrar**.
- Se o lead pedir um humano ou fugir do escopo, chame **transferir_humano**.`,
    !edu && catalogSummary ? `\n## Catálogo (FONTE DA VERDADE)
O catálogo tem estas categorias: ${catalogSummary}.
- SEMPRE que o lead perguntar sobre itens, preços, condições ou disponibilidade, chame a ferramenta **consultar_catalogo** e responda SOMENTE com o que ela retornar.
- REGRA ABSOLUTA: você só pode citar o nome/marca/preço de um item se ele tiver vindo de **consultar_catalogo** NESTA conversa. NUNCA mencione um item específico que não veio da ferramenta — nem como resposta, nem como sugestão ou alternativa. Nada de "temos o X" se X não veio da ferramenta.
- Se o que o lead pediu não existe: diga com sinceridade que não temos AQUILO. Para oferecer alternativas, chame **consultar_catalogo** de novo (ex.: pela categoria) e ofereça só o que ela retornar. Se não houver nada, diga que no momento não temos e ofereça falar com um atendente — SEM citar itens.
- Não despeje o catálogo inteiro sem o lead pedir.` : '',
    schedIntro ? `\n## Ao iniciar o agendamento\nQuando começar a etapa de agendamento (logo antes de chamar listar_horarios / oferecer os horários), ABRA com uma mensagem de boas-vindas ao agendamento no espírito desta — personalize com o nome do lead, mantenha objetiva e profissional, não copie ao pé da letra:\n"${schedIntro}"` : '',
    // Horário de atendimento humano (Cadastros › Atendimento) — FONTE DA VERDADE.
    // Sem isto o modelo especula ("pode ser que respondam ainda hoje") e a empresa
    // fica com uma promessa que não fez. Data/hora de agora vão junto para ele saber
    // se está dentro ou fora do expediente sem ter de adivinhar.
    businessHours ? `\n## Horário de atendimento da equipe (FONTE DA VERDADE)
O atendimento humano funciona: **${businessHours}**. Agora são ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (horário de Brasília).
- Quando perguntarem quando alguém responde, se ainda dá tempo hoje, ou qual o horário de atendimento, responda SOMENTE com base nesse horário. NUNCA especule ("pode ser que...", "talvez ainda hoje", "bem cedinho amanhã") nem prometa prazo de retorno que não esteja escrito aqui.
- Se a conversa está acontecendo FORA desse horário, diga com naturalidade que a equipe retorna no próximo período de atendimento e qual é ele (ex.: "o time atende a partir das 8h de amanhã").
- Este horário é o do atendimento humano. Não confunda com os horários de visita, que vêm de listar_horarios.` : `\n## Horário de atendimento da equipe
O horário de atendimento humano NÃO está cadastrado no sistema. Portanto: NUNCA afirme horário de funcionamento nem prometa prazo de retorno ("respondem ainda hoje", "amanhã cedo"). Diga apenas que a equipe vai retornar assim que possível.
Hoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} (horário de Brasília). Use esta data para qualquer conta de prazo; não deduza a data de outra fonte.`,
    // Postura (`ai.journey.posture`). Um modelo solto puxa para dois vícios que
    // queimam a empresa: bajular ("que pergunta excelente!") e concordar com o que
    // a pessoa disser só para agradar — inclusive com informação errada sobre a
    // empresa. As duas coisas soam falsas e criam expectativa que ninguém honra.
    cfg.postura ? `\n## Postura (como você se porta)
- Cordial e profissional, NUNCA bajulador. Nada de elogios gratuitos, superlativos ("maravilhoso", "perfeito", "incrível"), entusiasmo forçado ou puxa-saquismo. Simpatia se demonstra atendendo bem, não elogiando a pessoa.
- Não concorde por concordar. Se a pessoa afirmar algo errado, impreciso ou que você não pode confirmar, NÃO valide — corrija com educação ou diga com honestidade que não é bem assim / que não tem essa informação. Concordar com uma bobagem para agradar é pior do que discordar com respeito.
- Nunca prometa, garanta ou insinue algo que não esteja explicitamente autorizado neste prompt (valores, condições, prazos, resultados, exceções). Na dúvida, diga que não pode afirmar.
- Não force a barra: ofereça o próximo passo com clareza, mas se a pessoa disser não, respeite. Insistir depois de uma recusa clara afasta a pessoa.
- Cada mensagem tem que avançar o atendimento em direção ao objetivo. Nada de mensagem só para preencher espaço, nem de repetir com outras palavras o que você já disse.
- Nunca anuncie que vai fazer algo ("deixa eu verificar", "um momentinho", "já te falo") nem peça para a pessoa aguardar: as consultas são instantâneas do seu lado. Faça e traga o resultado na mesma resposta.
- Coerência: não se contradiga em relação ao que já foi dito nesta conversa nem invente informação que ninguém te deu.
- Se você não sabe o nome da pessoa, NUNCA invente, chute ou suponha um, e JAMAIS se dirija a ela por um nome que ela não tenha dito — errar o nome é pior do que não usar nome nenhum.` : '',
    `\n## Regras
${realNome
  ? `- O nome e o WhatsApp do lead JÁ são conhecidos (vêm do perfil do WhatsApp — veja "Já sabemos"/"Respostas já coletadas"). NÃO pergunte por eles; use o nome para personalizar a conversa.
- ATENÇÃO ao nome "${realNome}": ele veio do WhatsApp e nem sempre é o nome da pessoa. Pode ser nome de empresa ("Studio Bella"), apelido, frase ("DEUS É AMOR", "Vendas 2"), cargo ou algo sem sentido. Julgue antes de usar: se NÃO parece o primeiro nome de uma pessoa, não chame o lead assim em nenhuma mensagem e pergunte UMA vez, com naturalidade, como pode chamá-lo. Se ele não responder, siga sem nome. Se parecer nome de pessoa, use só o primeiro nome.`
  // Sem nome conhecido (canal web, ou WhatsApp sem perfil) a regra acima virava
  // mentira: o modelo lia "não pergunte", via o campo nome como obrigatório e
  // ficava preso pedindo o nome a cada turno, ignorando o que o lead respondia.
  : '- O nome do lead NÃO é conhecido. Você pode perguntá-lo UMA única vez, com naturalidade, no momento que fizer sentido. Se ele não responder ou mudar de assunto, SIGA o fluxo normalmente e não volte a perguntar: o nome é desejável, nunca obrigatório. Jamais repita a mesma pergunta duas vezes seguidas — se o lead respondeu outra coisa, atenda o que ele trouxe.'}
- NUNCA invente horários: use só os que listar_horarios devolveu.
- NUNCA afirme que agendou sem agendar ter retornado ok=true.
- Responda sempre em português do Brasil, com mensagens curtas (WhatsApp).${cfg.lerMidia ? `
- O cliente pode mandar foto, áudio ou arquivo. Foto você ESTÁ VENDO: diga o que ela mostra com naturalidade e siga o atendimento a partir dela (nunca peça para "descrever a imagem" nem finja que não recebeu). Áudio chega transcrito, marcado como "[áudio do cliente, transcrito]" — trate como se ele tivesse escrito, e não comente que era um áudio. Se vier um marcador dizendo que o arquivo não pôde ser aberto, avise com simplicidade e siga (ex.: "recebi aqui, mas não consegui abrir — me conta o que tem nele?"). NUNCA invente o conteúdo de um anexo que você não conseguiu ver.` : ''}
${cfg.semMenus
  // `ai.journey.no_menus`: atendimento 100% conversacional, sem botão nem lista.
  ? '- NUNCA apresente menus, listas de opções ou opções numeradas ("1) ... 2) ..."). Fale como um atendente humano: conduza a conversa em frases naturais e, quando precisar oferecer caminhos ou horários, escreva-os de forma corrida dentro da própria mensagem (ex.: "consigo te receber na terça de manhã ou na quinta à tarde, qual fica melhor?"). Não use o marcador [[OPTIONS]].'
  : '- Para ofertas com poucas opções fechadas (ex.: escolher um horário ou uma opção de select), TERMINE a mensagem com o marcador: [[OPTIONS: opção 1 | opção 2 | opção 3]] (máx. 10). O texto antes do marcador é a mensagem; as opções viram botões (até 3) ou lista (4 a 10). Botão tem no máximo 20 caracteres; item de lista, 24 no título — para explicar o item, escreva "Título — descrição" (a descrição aparece embaixo, até 72). Com mais de 10 opções, use dois marcadores seguidos, cada um com o seu texto antes e um rótulo curto: [[OPTIONS Núcleos: a | b]] e [[OPTIONS Setores: c | d]].'}`,
    // Modo comercial: no fim, para valer acima das seções de inscrição e preço.
    extras.qualificacao || '',
  ].filter(Boolean).join('\n')
}

// Dados de contato que devem estar salvos no CRM antes de encaminhar o lead a um
// humano. Genérico: olha os campos do form com mapTo de contato e checa o valor
// real no lead (ignora placeholders do canal web). Retorna os que faltam.
const CONTACT_MAPTOS = ['nome', 'whatsapp', 'email', 'cidade'] as const
const CONTACT_LABEL: Record<string, string> = { nome: 'nome', whatsapp: 'WhatsApp', email: 'e-mail', cidade: 'cidade' }
// Identificação mínima para ENCAMINHAR (`ai.journey.handoff_contact = nome_whatsapp`).
// Quem escreve pedindo o financeiro já está no sistema (o WhatsApp chegou junto
// com a mensagem) e não deve ser interrogado por e-mail/cidade só para ser atendido.
export const ROUTING_MAPTOS = ['nome', 'whatsapp'] as const
async function missingContactData(leadId: number, form: any, only?: readonly string[]): Promise<string[]> {
  const fields: any[] = form?.fields || []
  const alvo: readonly string[] = only ?? CONTACT_MAPTOS
  const wanted = fields.filter((f) => alvo.includes(f?.mapTo))
  if (!wanted.length) return []
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, email: true, whatsapp: true, cidade: true } })
  const PLACEHOLDER = new Set(['lead lp', 'lead', 'webchat'])
  const has = (mapTo: string): boolean => {
    if (mapTo === 'nome') return !!(lead?.nome && !PLACEHOLDER.has(String(lead.nome).trim().toLowerCase()))
    if (mapTo === 'whatsapp') return !!(lead?.whatsapp && !String(lead.whatsapp).startsWith('webchat:'))
    if (mapTo === 'email') return !!(lead?.email && String(lead.email).trim())
    if (mapTo === 'cidade') return !!(lead?.cidade && String(lead.cidade).trim())
    return true
  }
  const seen = new Set<string>()
  return wanted
    .filter((f) => !has(f.mapTo) && !seen.has(f.mapTo) && seen.add(f.mapTo))
    .map((f) => CONTACT_LABEL[f.mapTo] || f.mapTo)
}

/**
 * Ficha do lead para o prompt: o que o CRM já sabe sobre esta pessoa ANTES desta
 * conversa. Sem isto a IA começa do zero toda vez — pergunta a cidade que está
 * salva em campo personalizado, reapresenta a empresa para quem já falou com um
 * consultor na semana passada, oferece reunião para quem já tem uma marcada.
 *
 * Só entra o que estiver preenchido: linha vazia é ruído no prompt.
 */
export async function buildLeadContext(leadId: number, ampliada?: { state?: AiState | null; historico?: number } | null): Promise<string> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      status: true, cidade: true, segmento: true, empresa: true, customFields: true,
      originType: true, campaignName: true, createdAt: true, annotation: true,
      teamId: true, assignedUserId: true,
      funnel: { select: { name: true, stages: { select: { key: true, name: true } } } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  })
  if (!lead) return ''

  const linhas: string[] = []

  const etapa = lead.funnel?.stages.find((s) => s.key === lead.status)?.name || lead.status
  if (etapa) linhas.push(`- Etapa atual no funil: ${etapa}${lead.funnel?.name ? ` (${lead.funnel.name})` : ''}`)
  if (lead.empresa) linhas.push(`- Instituição/empresa: ${lead.empresa}`)
  if (lead.cidade) linhas.push(`- Cidade: ${lead.cidade}`)
  if (lead.segmento) linhas.push(`- Segmento: ${lead.segmento}`)
  if (lead.originType) linhas.push(`- Como chegou: ${lead.originType}${lead.campaignName ? ` · campanha "${lead.campaignName}"` : ''}`)

  // Campos personalizados já respondidos — a fonte mais comum de pergunta repetida.
  const cf = (lead.customFields || {}) as Record<string, unknown>
  const preenchidos = Object.entries(cf).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
  if (preenchidos.length) {
    const defs = await prisma.customField.findMany({ select: { key: true, label: true } }).catch(() => [] as any[])
    const rotulo = new Map(defs.map((d: any) => [d.key, d.label]))
    linhas.push(`- Respostas já registradas: ${preenchidos.map(([k, v]) => `${rotulo.get(k) || k} = ${String(v).slice(0, 80)}`).join(' · ')}`)
  }

  const tags = lead.tags.map((t) => t.tag.name)
  if (tags.length) linhas.push(`- Etiquetas: ${tags.join(', ')}`)
  if (lead.annotation) linhas.push(`- Anotação interna da equipe: ${lead.annotation.slice(0, 300)}`)

  // Reunião já marcada: reoferecer agenda para quem já agendou é o erro mais caro.
  const reuniao = await prisma.booking.findFirst({
    where: { leadId, status: { notIn: ['cancelled', 'no_show', 'rescheduled'] }, startAt: { gt: new Date() } },
    orderBy: { startAt: 'asc' },
    select: { startAt: true, timezone: true, operatorUserId: true },
  }).catch(() => null)
  if (reuniao) {
    let quem = ''
    if (reuniao.operatorUserId) {
      const u = await prisma.user.findUnique({ where: { id: reuniao.operatorUserId }, select: { displayName: true, name: true, email: true } }).catch(() => null)
      if (u) { const { nomeExibicao } = await import('./operatorIdentity.js'); quem = ` com ${nomeExibicao(u)}` }
    }
    linhas.push(`- JÁ TEM REUNIÃO MARCADA para ${fmtWhen(reuniao.startAt, reuniao.timezone || 'America/Sao_Paulo')}${quem}. NÃO ofereça agendamento de novo; se ele quiser mudar, trate como remarcação.`)
  }

  // Atendimento humano anterior: a pessoa já falou com alguém do time.
  const humano = await prisma.message.findFirst({
    where: { leadId, fromMe: true, isInternal: false, senderName: { notIn: ['Workflow'] } },
    orderBy: { id: 'desc' },
    select: { senderName: true, timestamp: true },
  }).catch(() => null)
  if (humano?.senderName) {
    linhas.push(`- Já houve conversa anterior nesta linha (última resposta nossa por "${humano.senderName}"). Continue de onde parou, sem se reapresentar.`)
  }

  // Ficha ampliada (`ai.journey.extended_dossier`, veio do severiano): quem
  // cuida do lead e o tamanho da conversa. O tamanho é o que separa "primeiro
  // contato" de "atendimento em andamento" quando o histórico enviado ao modelo
  // vem truncado — sem isso ele trata como novo quem conversa há semanas.
  if (ampliada) {
    if (lead.teamId) {
      const team = await prisma.team.findUnique({ where: { id: lead.teamId }, select: { name: true } }).catch(() => null)
      if (team?.name) linhas.push(`- Setor responsável: ${team.name}`)
    }
    if (lead.assignedUserId) {
      const u = await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { displayName: true, name: true, email: true } }).catch(() => null)
      if (u) { const { nomeExibicao } = await import('./operatorIdentity.js'); linhas.push(`- Atendente responsável na equipe: ${nomeExibicao(u)}`) }
    }
    const [total, primeira] = await Promise.all([
      prisma.message.count({ where: { leadId, isInternal: false } }).catch(() => 0),
      prisma.message.findFirst({ where: { leadId, isInternal: false }, orderBy: { id: 'asc' }, select: { timestamp: true } }).catch(() => null),
    ])
    const limite = ampliada.historico ?? HISTORY_LIMIT
    if (total > 1) {
      const desde = primeira?.timestamp ? `, desde ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(primeira.timestamp))}` : ''
      linhas.push(`- Já são ${total} mensagens trocadas${desde}.${total > limite ? ` Você recebeu as ${limite} últimas — houve conversa antes delas.` : ''}`)
    }
    if (ampliada.state?.phase === 'handoff') linhas.push('- Esta conversa já foi entregue a um setor da equipe em algum momento.')
  }

  return linhas.join('\n')
}

// Resumo do catálogo (categorias + contagem) para o system prompt. Vazio quando
// não há produtos cadastrados — aí a seção de catálogo nem aparece.
export async function getCatalogSummary(): Promise<string> {
  try {
    const rows = await prisma.product.groupBy({ by: ['categoria'], where: { active: true }, _count: { _all: true } })
    if (!rows.length) return ''
    return rows.map((r) => `${r.categoria} (${r._count._all})`).sort().join(', ')
  } catch { return '' }
}

/**
 * Horários para a IA oferecer (ferramenta listar_horarios). Compartilhado com o
 * simulador (chatbotPreview) para o teste oferecer exatamente o que o WhatsApp
 * ofereceria. Sem efeito colateral além de contar a oferta no `state`: quem
 * marca o lead e emite o evento é o motor real.
 *
 * Duas formas:
 *  - padrão: os 12 primeiros horários, como sempre;
 *  - `ai.journey.agenda_by_date` (veio do severiano): aceita `data` e `periodo`,
 *    devolve a data de hoje, "hoje"/"amanhã" e um calendário de 14 dias, e recusa
 *    data passada. Antes o modelo concluía que a agenda acabava no 12º horário
 *    ("os horários vão até terça") e errava o dia da semana (severiano, lead 900,
 *    13/10/2026); chegou a pedir 2025-10-17 em 13/10/2026.
 */
export async function horariosParaIa(form: any, input: any, state: AiState, cfg: ConfigJornada): Promise<{ resposta: Record<string, any>; slug: string | null; oferecidos: number }> {
  const fields: any[] = form?.fields || []
  const schedField = fields.find((f) => f?.type === 'scheduling')
  const slug: string | null = schedField?.meetingSlug || null
  if (!slug) return { resposta: { ok: false, erro: 'Agendamento não configurado neste formulário.' }, slug: null, oferecidos: 0 }
  const mt = await getActiveMeetingType(slug)
  if (!mt) return { resposta: { ok: false, erro: 'Tipo de reunião indisponível.' }, slug, oferecidos: 0 }

  const out: Array<{ startAt: string; label: string }> = []
  let extra: Record<string, any> = {}
  let filtrou = false

  if (!cfg.agendaPorData) {
    const days = await getMeetingTypeSlots(mt, {}).catch(() => [] as any[])
    for (const day of (days as any[])) {
      for (const sl of (day.slots || [])) {
        if (out.length >= 12) break
        const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
        out.push({ startAt: sl.startAt, label: `${WD[day.weekday] || ''} ${dd} ${sl.label}`.trim() })
      }
      if (out.length >= 12) break
    }
    if (!out.length) return { resposta: { ok: false, erro: 'Sem horários disponíveis no momento.' }, slug, oferecidos: 0 }
  } else {
    const tz = mt.timezone || 'America/Sao_Paulo'
    const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    const hojeStr = ymd(new Date())
    const amanhaStr = ymd(new Date(Date.now() + 86400000))
    const hojeExtenso = new Date().toLocaleString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    // Data pedida: aceita AAAA-MM-DD ou DD/MM (sem ano = próxima ocorrência).
    const dataPedida = (() => {
      const raw = String(input?.data || '').trim()
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      let mmdd = m ? `${m[2]}-${m[3]}` : null
      if (!m) { const b = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/); if (b) mmdd = `${b[2]!.padStart(2, '0')}-${b[1]!.padStart(2, '0')}` }
      if (!mmdd) return null
      if (m) return raw
      const ano = Number(hojeStr.slice(0, 4))
      return `${ano}-${mmdd}` >= hojeStr ? `${ano}-${mmdd}` : `${ano + 1}-${mmdd}`
    })()
    const periodo = ['manha', 'tarde', 'noite'].includes(String(input?.periodo)) ? String(input.periodo) : null
    filtrou = !!(dataPedida || periodo)
    const hora = (label: string) => parseInt(String(label).slice(0, 2), 10)
    const noPeriodo = (label: string) => !periodo
      || (periodo === 'manha' && hora(label) < 12)
      || (periodo === 'tarde' && hora(label) >= 12 && hora(label) < 18)
      || (periodo === 'noite' && hora(label) >= 18)
    const rotuloDia = (day: any) => {
      const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
      const rel = day.date === hojeStr ? ' (hoje)' : day.date === amanhaStr ? ' (amanhã)' : ''
      return `${WD[day.weekday] || ''} ${dd}${rel}`.trim()
    }
    // Mini-calendário das próximas duas semanas: o modelo erra a conta de
    // "sexta da semana que vem"; com a tabela ele só consulta.
    const calendario: string[] = []
    for (let i = 0; i < 14; i++) {
      const iso = ymd(new Date(Date.now() + i * 86400000))
      const wd = new Date(`${iso}T12:00:00Z`).getUTCDay()
      calendario.push(`${WD[wd]} ${iso.slice(8, 10)}/${iso.slice(5, 7)} = ${iso}${i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : ''}`)
    }
    const hojeInfo = { hoje: `${hojeExtenso} (${hojeStr})`, calendario, minimoAntecedenciaHoras: Math.round((mt.minNoticeMin || 0) / 60), ...(dataPedida ? { diaConsultado: dataPedida } : {}) }
    if (dataPedida && dataPedida < hojeStr) {
      return { resposta: { ok: false, ...hojeInfo, erro: `A data ${dataPedida} já passou.`,
        instrucao: 'Você calculou a data errada. Ache o dia pedido no "calendario" acima e chame listar_horarios de novo com a data certa.' }, slug, oferecidos: 0 }
    }
    // O corte "horários visíveis por dia" do tipo de reunião é da página pública;
    // aplicado aqui, antes do filtro de período, ele deixava só as manhãs e a IA
    // dizia que não havia tarde. A amostra abaixo já limita o que é oferecido.
    const days = ((await getMeetingTypeSlots({ ...mt, visibleSlotsPerDay: null }, dataPedida ? { from: dataPedida, to: dataPedida } : {}).catch(() => [] as any[])) as any[])
      .map((d) => ({ ...d, slots: (d.slots || []).filter((sl: any) => noPeriodo(sl.label)) }))
      .filter((d) => d.slots.length)
    // Sem dia pedido: amostra dos 5 primeiros dias com vaga (até 3 de manhã e
    // 3 de tarde/noite por dia) + o resumo dos demais, para ninguém concluir
    // que a agenda acaba onde a amostra acaba.
    const AMOSTRA_DIAS = 5
    for (const day of (dataPedida ? days : days.slice(0, AMOSTRA_DIAS))) {
      const manha = day.slots.filter((sl: any) => hora(sl.label) < 12)
      const resto = day.slots.filter((sl: any) => hora(sl.label) >= 12)
      const escolhidos = dataPedida ? day.slots : [...manha.slice(0, 3), ...resto.slice(0, 3)]
      for (const sl of escolhidos) out.push({ startAt: sl.startAt, label: `${rotuloDia(day)} ${sl.label}` })
    }
    const outrosDias = dataPedida ? [] : days.slice(AMOSTRA_DIAS).map((d) => `${rotuloDia(d)}: ${d.slots.length} horário(s)`)
    if (!out.length) {
      return { resposta: { ok: false, ...hojeInfo,
        erro: filtrou ? 'Sem horários livres nesse dia/período.' : 'Sem horários disponíveis no momento.',
        instrucao: filtrou ? 'Diga com simplicidade que esse dia/período não tem horário livre (sem inventar motivo; se for hoje, a visita precisa ser marcada com pelo menos minimoAntecedenciaHoras de antecedência) e chame listar_horarios sem filtro para oferecer a alternativa mais próxima.' : undefined }, slug, oferecidos: 0 }
    }
    extra = { ...hojeInfo, ...(outrosDias.length ? { outrosDiasComVaga: outrosDias } : {}),
      instrucao: 'Use "hoje" para saber o dia da semana — nunca deduza a data. Ofereça 2 ou 3 opções por vez, citando o dia como no rótulo (e "hoje"/"amanhã" quando houver). Se a pessoa pedir um dia ou período que não está na amostra, chame listar_horarios com data/periodo.' }
  }

  // Terceira ida à agenda = as ofertas do roteiro já foram recusadas. Não
  // oferece de novo: manda para o humano, que é a Saída B. Limite em
  // `ai.journey.max_slot_offers` (0 = sem limite). Consulta filtrada por dia ou
  // período é a pessoa refinando o pedido ("e na sexta?"), não recusando —
  // não conta como nova oferta.
  const max = cfg.maxOfertasAgenda
  if (max > 0 && !filtrou) {
    state.ofertasAgenda = (state.ofertasAgenda ?? 0) + 1
    if (state.ofertasAgenda > max) {
      const qtd = max === 2 ? 'duas' : String(max)
      return { resposta: {
        ok: false,
        erro: `O lead já recebeu ${max} ofertas de horário e não fechou nenhuma.`,
        instrucao: `NÃO ofereça mais horários. Chame transferir_humano agora, com pedido_do_lead=false e o motivo "não fechou horário após ${qtd} ofertas".`,
      }, slug, oferecidos: 0 }
    }
  }
  return { resposta: { ok: true, ...extra, horarios: out }, slug, oferecidos: out.length }
}

// ── Executor das ferramentas (chamadas pela IA → funções determinísticas reais) ──
async function executeTool(
  name: string, input: any, ctx: { leadId: number; phone: string; form: any; chatbot: any; state: AiState; promoteFunnelId: number | null; promoteStageKey: string | null; app: FastifyInstance; cfg?: ConfigJornada },
): Promise<string> {
  const { leadId, phone, form, state, promoteFunnelId, app, chatbot } = ctx
  const cfg = ctx.cfg ?? CONFIG_JORNADA_PADRAO
  // Contato exigido para encaminhar: o do formulário (padrão) ou só nome+WhatsApp.
  const contatoParaEncaminhar = cfg.contatoMinimo ? ROUTING_MAPTOS : undefined
  const fields: any[] = form?.fields || []
  const settings: any = form?.settings || {}
  if (EDU_TOOL_NAMES.has(name) && eduSdrLigado(form)) {
    if (EDU_TOOLS_MATRICULA.has(name) && !matriculaPeloChatLigada(form)) {
      return JSON.stringify({ ok: false, erro: 'Matrícula pelo chat desligada', instrucao: matriculaPorLink(form)
        ? 'Não faça a matrícula por aqui: mande o link público de inscrição indicado nas instruções da instituição e oriente a pessoa a se inscrever.'
        : 'Não faça a matrícula por aqui: encaminhe para o departamento de matrículas (rotear_setor) ou transferir_humano.' })
    }
    return executarFerramentaEdu(name, input, { app, leadId, state, dryRun: false })
  }
  try {
    if (name === 'salvar_dados') {
      const campos: Array<{ chave: string; valor: string; rotulo?: string }> = Array.isArray(input?.campos) ? input.campos : []
      const salvos: string[] = []
      // `field.validate: 'email'` é opt-in por campo do form — hoje só o
      // formato de e-mail é checado, mas o mecanismo é genérico pra outros
      // validadores no futuro. Sem isto, um "email_candidato" incompleto
      // (ex.: "fernanda" sem @) ia direto pra nota do RH sem ninguém perceber.
      const invalidos: string[] = []
      for (const c of campos) {
        const field = fields.find((f) => f?.key === c.chave)
        if (!field) {
          // `ai.journey.auto_custom_fields`: chave sem campo no formulário vira um
          // CustomField e é gravada — nenhum dado que a pessoa contou se perde
          // (ex.: 2º/3º filho, idade). Desligado, segue ignorando como sempre.
          if (!cfg.camposAutomaticos || !c?.chave || c.valor == null || String(c.valor).trim() === '') continue
          const key = await ensureCustomField(String(c.chave), c.rotulo)
          if (!key) continue
          state.answers[key] = String(c.valor)
          await applyAnswerToLead(leadId, { key, type: 'text' }, state.answers).catch(() => {})
          salvos.push(key)
          continue
        }
        const valor = String(c.valor ?? '').trim()
        if (field.validate === 'email' && valor && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
          invalidos.push(c.chave)
          continue
        }
        // Campos de seleção: a IA costuma mandar o LABEL que o lead falou, mas a
        // qualificação determinística compara com o VALUE da opção. Mapeia para o value.
        state.answers[c.chave] = mapSelectValue(field, c.valor)
        await applyAnswerToLead(leadId, field, state.answers).catch(() => {})
        salvos.push(c.chave)
      }
      if (invalidos.length) {
        return JSON.stringify({ ok: salvos.length > 0, salvos, invalidos, instrucao: `O(s) campo(s) ${invalidos.join(', ')} não parece(m) válido(s) — peça de novo com naturalidade (ex.: "esse e-mail parece incompleto, pode conferir?").` })
      }
      return JSON.stringify({ ok: true, salvos })
    }

    if (name === 'rotear_setor') {
      const routeField = fields.find((f: any) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
      if (!routeField) return JSON.stringify({ ok: false, erro: 'Sem roteamento por setor configurado.' })
      const value = mapSelectValue(routeField, String(input?.setor || ''))
      const opt = routeField.options.find((o: any) => String(o.value) === String(value))
      // Destino provisório (`route.fallback`): a primeira escolha da pessoa já
      // diz para que equipe/funil ela vai se a conversa parar (ex.: aluno →
      // Secretaria). Move o lead, guarda o destino e a conversa SEGUE — não é
      // encaminhamento, não pede contato e não liga a fase de handoff.
      if (opt?.route?.fallback && opt.route.teamId != null) {
        // Uma pessoa da equipe está atendendo (falou nas últimas 24h): a escolha
        // do menu não tira a conversa dela — fica na equipe em que está.
        const humano = await atendimentoHumanoAtivo(leadId)
        if (humano) {
          const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { teamId: true, funnelId: true } }).catch(() => null)
          if (atual?.teamId) state.fallbackRoute = { teamId: atual.teamId, funnelId: atual.funnelId ?? null, label: stripTags(opt.label) }
          return JSON.stringify({ ok: true, provisorio: true, instrucao: `${humano.nome} da equipe está atendendo esta pessoa (falou nas últimas 24h). A conversa continua com essa pessoa: siga o roteiro normalmente, sem dizer que encaminhou.` })
        }
        const r = await enviarParaEquipe(leadId, { teamId: opt.route.teamId, funnelId: opt.route.funnelId, stageKey: opt.route.stageKey, userIds: opt.route.userIds }, 'chatbot')
        state.fallbackRoute = { teamId: opt.route.teamId, funnelId: r?.funnelId ?? opt.route.funnelId ?? null, label: stripTags(opt.label) }
        logEvent({ leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle', title: `Jornada IA: destino provisório ${stripTags(opt.label)}`, channel: 'whatsapp', source: 'chatbot', actorType: 'system' })
        return JSON.stringify({ ok: true, provisorio: true, instrucao: 'Destino provisório registrado nos bastidores. NÃO diga que encaminhou nem fale de setor: siga a conversa normalmente, com o próximo passo do roteiro.' })
      }
      // Trava: só encaminha ao setor (atendimento humano) depois de coletar e
      // salvar os dados de contato do lead no CRM.
      const missing = await missingContactData(leadId, form, contatoParaEncaminhar)
      if (missing.length) {
        return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos',
          instrucao: `Antes de encaminhar o lead para o atendimento humano, peça e salve estes dados (chame salvar_dados): ${missing.join(', ')}. Faça isso de forma natural, uma pergunta por vez. Só depois chame rotear_setor novamente.` })
      }
      // Reusa o roteamento por opção de menu do form (option.route): move funil/etapa
      // e (re)atribui a equipe/operador. Lê o menu de triagem (campo select cujas
      // opções têm `route`) dinamicamente — genérico, não hardcoded por tenant.
      if (!opt?.route) return JSON.stringify({ ok: false, erro: 'Setor não reconhecido.', instrucao: 'Continue a conversa normalmente e tente identificar melhor o que o lead procura.' })
      // Persiste a escolha p/ a qualificação determinística usar o value da opção.
      state.answers[routeField.key] = opt.value
      await applyAnswerToLead(leadId, routeField, state.answers).catch(() => {})
      const route = opt.route
      // Trava de vaivém: o mesmo setor de novo não reencaminha (nem sorteia outra
      // pessoa); um terceiro setor diferente em 24h não muda — a equipe do
      // último setor recebe e decide, em vez de a pessoa rodar entre setores.
      const recentes = (state.encaminhamentos || []).filter((e) => Date.now() - new Date(e.at).getTime() < 24 * 3600_000)
      const ultimo = recentes[recentes.length - 1]
      if (ultimo && route.teamId != null && ultimo.teamId === route.teamId) {
        return JSON.stringify({ ok: true, ja_encaminhado: true, setor: ultimo.label, instrucao: `Esta pessoa já está com ${ultimo.label}. NÃO encaminhe de novo: diga, se fizer sentido, que a equipe de ${ultimo.label} continua por aqui, e siga ajudando no que puder.` })
      }
      if (recentes.length >= 2) {
        logEvent({ leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle', title: `Jornada IA: 3º setor em 24h bloqueado (${stripTags(opt.label)}) — fica com ${ultimo!.label}`, channel: 'whatsapp', source: 'chatbot', actorType: 'system' })
        return JSON.stringify({ ok: false, bloqueado: true, instrucao: `Esta pessoa já foi encaminhada a ${recentes.length} setores nas últimas 24h (${recentes.map((e) => e.label).join(', ')}). NÃO mude de setor de novo: chame transferir_humano com o motivo "${stripTags(opt.label)}: " + o assunto, e diga que a equipe da FABAD continua por aqui e direciona o assunto para quem cuida.` })
      }
      // Equipe e funil juntos (o funil da equipe quando a rota não diz). Mudou de
      // equipe, o rodízio dela escolhe o responsável — ver encaminharEquipe.ts.
      if (route.teamId != null) {
        await enviarParaEquipe(leadId, { teamId: route.teamId, funnelId: route.funnelId, stageKey: route.stageKey, userIds: route.userIds }, 'chatbot')
      } else if (route.funnelId != null && route.stageKey) {
        await moveLeadStage(leadId, route.funnelId, route.stageKey, 'chatbot', { forwardOnly: false }).catch(() => {})
      }
      // Setores como RH (candidatura/currículo) não precisam de handoff humano
      // imediato — precisam é de um REGISTRO completo do que foi coletado.
      // `route.saveNote: true` grava uma nota no lead com todas as respostas já
      // salvas (salvar_dados) e o anexo mais recente do contato (o currículo),
      // sem encaminhar nada por WhatsApp — era assim no fluxo scripted antigo,
      // que mandava pro celular do RH; aqui o RH lê a nota no próprio painel.
      if (route.saveNote) {
        const dadosTexto = fields
          .filter((f: any) => f && f.key !== routeField.key && state.answers[f.key] !== undefined && state.answers[f.key] !== null && String(state.answers[f.key]).trim())
          .map((f: any) => `${stripTags(f.label) || f.key}: ${state.answers[f.key]}`)
          .join('\n')
        // Até 3 anexos das últimas 2h (não só o mais recente): candidato pode
        // mandar currículo + carta de apresentação em mensagens separadas, e
        // pegar só o último jogava a primeira fora sem ninguém perceber. A
        // janela de 2h evita puxar um anexo de uma conversa antiga e não
        // relacionada, num lead que já conversou sobre outro assunto antes.
        const anexos = await prisma.message.findMany({
          where: {
            leadId, fromMe: false, mediaType: { in: ['document', 'image'] },
            timestamp: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
          },
          orderBy: { timestamp: 'desc' },
          take: 3,
          select: { mediaUrl: true, mediaName: true },
        })
        const anexoTexto = anexos.length
          ? '\n' + anexos.map((a) => `Arquivo: ${absoluteUrl(a.mediaUrl || '')}${a.mediaName ? ` (${a.mediaName})` : ''}`).join('\n')
          : '\nArquivo: não enviado.'
        const noteContent = `${stripTags(opt.label) || route.stageKey} — recebido via chatbot\n${dadosTexto}${anexoTexto}`
        await prisma.leadNote.create({
          data: { leadId, userId: null, userName: chatbot?.name || 'Chatbot', content: noteContent },
        }).catch(() => {})
        // Mensagem interna na PRÓPRIA conversa: sem isto, quem abre Conversas
        // não vê nenhum sinal de que a candidatura foi processada — só quem
        // for direto na aba de Notas do lead. Mesmo princípio do fluxo
        // scripted antigo (que também deixava um rastro na conversa).
        await prisma.message.create({
          data: {
            leadId, fromMe: true, isInternal: true,
            body: `📝 ${stripTags(opt.label) || route.stageKey} registrado (nota criada, sem atendimento humano imediato)\n\n${noteContent}`,
            senderName: chatbot?.name || 'Chatbot', timestamp: new Date(),
          },
        }).catch(() => {})
      }
      logEvent({ leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle', title: `Jornada IA: encaminhado para ${stripTags(opt.label) || route.stageKey}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead', metadata: { teamId: route.teamId, funnelId: route.funnelId, stageKey: route.stageKey } })
      // Nome do setor sem a explicação entre parênteses (que é para a IA).
      const nomeDoSetor = (stripTags(opt.label) || String(route.stageKey || '')).replace(/\s*\(.*$/s, '').trim()
      state.encaminhamentos = [...recentes, { teamId: route.teamId ?? null, label: nomeDoSetor, at: new Date().toISOString() }]
      if (!route.saveNote) await notaDeEncaminhamento(leadId, chatbot, nomeDoSetor, input?.resumo)
      if (eduSdrLigado(form)) {
        state.phase = 'handoff'
        // A conversa agora é do departamento: a IA dá o aviso e cala (iaPodeFalar).
        const { pauseBotForHandoff } = await import('./botTakeover.js')
        await pauseBotForHandoff(leadId, nomeDoSetor).catch(() => {})
        return JSON.stringify({ ok: true, setor: stripTags(opt.label), instrucao: instrucaoDepartamentoEdu(stripTags(opt.label)) })
      }
      return JSON.stringify({ ok: true, setor: stripTags(opt.label), instrucao: 'Lead encaminhado ao setor certo nos bastidores. NÃO mencione "setor" nem "encaminhamento" — apenas siga ajudando o lead com naturalidade.' })
    }

    if (name === 'avaliar_qualificacao') {
      const q = evaluateQualification(fields, state.answers, settings)
      if (q?.finish) {
        const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: true })
        if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })
        state.phase = 'disqualified'
        logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: 'Jornada IA: lead desqualificado', channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
        return JSON.stringify({ qualificado: false, motivo: stripTags(q.message) || 'não atende aos critérios', instrucao: 'Agradeça cordialmente e encerre. NÃO ofereça agendamento. Depois chame encerrar(qualificado=false).' })
      }
      // Qualificado (ou outcome positivo): move adiante se houver etapa.
      if (q) {
        const mv = resolveStageMove(q, { promoteFunnelId, formFunnelId: form.funnelId ?? null, isFinish: false })
        if (mv) await moveLeadStage(leadId, mv.funnelId, mv.stageKey, 'chatbot', { forwardOnly: mv.forwardOnly })
      }
      const hasSched = fields.some((f) => f?.type === 'scheduling')
      return JSON.stringify({ qualificado: true, instrucao: hasSched ? 'Lead qualificado. Ofereça agendar: chame listar_horarios e proponha um horário.' : 'Lead qualificado. Agradeça e finalize com encerrar(qualificado=true).' })
    }

    if (name === 'listar_horarios') {
      // Montagem e contagem de ofertas: horariosParaIa (mesma do simulador).
      const { resposta, slug, oferecidos } = await horariosParaIa(form, input, state, cfg)
      if (!resposta.ok) return JSON.stringify(resposta)

      // Marca que a pessoa CHEGOU a ver horários: é o sinal de intenção mais forte
      // da jornada e o público exato de uma recuperação ("viu horários e não marcou").
        const at = new Date().toISOString()
        prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
          .then((l) => prisma.lead.update({
            where: { id: leadId },
            data: { formData: { ...((l?.formData || {}) as object), _slotsOfferedAt: at } },
          }))
          .catch(() => {})
        logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_STARTED, category: 'lifecycle', title: 'Jornada IA: horários de visita oferecidos', channel: 'whatsapp', source: 'chatbot', actorType: 'system' })
        import('../lib/eventBus.js').then(({ eventBus }) => eventBus.emitDomain({
          type: 'lead.slots_offered',
          leadId,
          chatbotId: ctx.chatbot?.id,
          funnelId: promoteFunnelId ?? form.funnelId ?? undefined,
          payload: { meetingSlug: slug, offered: oferecidos },
          timestamp: new Date(),
        })).catch(() => {})
      return JSON.stringify(resposta)
    }

    if (name === 'agendar') {
      const schedField = fields.find((f) => f?.type === 'scheduling')
      const slug = schedField?.meetingSlug
      if (!slug) return JSON.stringify({ ok: false, erro: 'Agendamento não configurado.' })
      const mt = await getActiveMeetingType(slug)
      if (!mt) return JSON.stringify({ ok: false, erro: 'Tipo de reunião indisponível.' })
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, email: true } })
      const result = await createBooking(mt, {
        name: lead?.nome || state.answers.nome || 'Lead', email: lead?.email || state.answers.email || null,
        phone, startAt: String(input?.startAt || ''), answers: state.answers, timezone: mt.timezone, visitorId: null, utm: null,
        funnelOverride: promoteFunnelId ?? null,
      } as any).catch((e) => { app.log.error(`[aiJourney] booking: ${e}`); return { ok: false, error: 'Erro ao agendar' } as any })
      if (!result.ok) return JSON.stringify({ ok: false, erro: result.error, instrucao: 'Horário indisponível. Chame listar_horarios de novo e ofereça outro.' })
      state.phase = 'done'
      state.bookingId = result.booking?.id ?? null
      const when = result.booking?.startAt ? fmtWhen(new Date(result.booking.startAt), mt.timezone) : ''

      // Quem vai atender sai do sistema, nunca do prompt: no rodízio por equipe o
      // operador só é escolhido dentro do createBooking. Sem dono definido (caiu na
      // fila da equipe), devolve o nome do SETOR — e a IA fala de forma genérica,
      // em vez de inventar um nome de consultor.
      const operadorId = (result.booking as any)?.operatorUserId ?? null
      const timeId = (result.booking as any)?.teamId ?? null
      let consultor: string | null = null
      if (operadorId) {
        const u = await prisma.user.findUnique({ where: { id: operadorId }, select: { displayName: true, name: true, email: true } }).catch(() => null)
        if (u) { const { nomeExibicao } = await import('./operatorIdentity.js'); consultor = nomeExibicao(u) }
      }
      let setor: string | null = null
      if (!consultor && timeId) {
        setor = (await prisma.team.findUnique({ where: { id: timeId }, select: { name: true } }).catch(() => null))?.name ?? null
      }

      return JSON.stringify({
        ok: true, quando: when, consultor, setor,
        instrucao: `Horário reservado.${consultor ? ` Quem vai conduzir a reunião é ${consultor} — use ESTE nome ao confirmar, exatamente como veio aqui.` : ' Ainda não há um consultor definido para este horário: fale em "um dos nossos consultores", NUNCA invente um nome.'} O sistema JÁ enviou ao lead, logo em seguida, uma mensagem com o link da reunião e o botão "Confirmar reunião". Diga UMA frase curta e calorosa pedindo para ele CONFIRMAR a presença tocando no botão "Confirmar reunião" acima. NÃO diga que já está confirmado nem inclua link — a confirmação só acontece quando ele toca no botão.`,
      })
    }

    if (name === 'encerrar') {
      state.phase = input?.qualificado === false ? 'disqualified' : 'done'
      return JSON.stringify({ ok: true })
    }

    if (name === 'transferir_humano') {
      // Mesma trava: captura os dados de contato antes de passar para o humano.
      // MAS quem pediu um humano (ou perdeu a paciência, ou pediu proposta) não
      // pode ser interrogado antes de ser atendido: aí a transferência é
      // imediata e o dado que faltar o operador pega na conversa.
      const sensivel = input?.sensivel === true
      const missing = input?.pedido_do_lead || sensivel ? [] : await missingContactData(leadId, form, contatoParaEncaminhar)
      if (missing.length) {
        return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos',
          instrucao: `Antes de transferir para um atendente, peça e salve estes dados (chame salvar_dados): ${missing.join(', ')}. Uma pergunta por vez. Só depois chame transferir_humano novamente.` })
      }
      // Caso sensível: a IA sai da conversa (mesmo que já estivesse em handoff) e
      // só a equipe responde — até alguém devolver a conversa ao bot.
      if (sensivel) {
        const nome = chatbot?.name || 'Chatbot'
        const relato = String(input?.motivo ?? '').trim().slice(0, 600) || 'não descrito'
        state.phase = 'handoff'
        if (state.fallbackRoute?.teamId && !(state.encaminhamentos || []).length) {
          await enviarParaEquipe(leadId, { teamId: state.fallbackRoute.teamId, funnelId: state.fallbackRoute.funnelId }, 'chatbot')
        }
        await notaDeEncaminhamento(leadId, chatbot, 'caso sensível — insatisfação', relato)
        await prisma.leadNote.create({ data: { leadId, userId: null, userName: nome, content: `⚠️ Insatisfação registrada pela IA\n${relato}\n\nA IA saiu desta conversa; só a equipe responde. Para o bot voltar, use Resolver ou devolva a conversa ao bot.` } }).catch(() => {})
        const { pauseBotForHuman } = await import('./botTakeover.js')
        await pauseBotForHuman(leadId, { userId: null, userName: `${nome} (caso sensível)` }, { sensivel: true }).catch(() => {})
        logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: `Jornada IA: caso sensível passado à equipe — ${relato.slice(0, 80)}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
        return JSON.stringify({ ok: true, sensivel: true, instrucao: 'Responda UMA única mensagem curta: acolha sem julgar ("entendo o quanto isso te preocupa"), diga que uma pessoa da equipe vai assumir o atendimento por aqui e encerre. NÃO concorde com acusações nem dê razão contra a instituição, NÃO avalie o mérito, NÃO sugira outros canais, órgãos ou medidas, NÃO prometa prazo. Depois disso você não responde mais nesta conversa.' })
      }
      // Já avisou antes e o lead continuou falando: não repete o aviso nem trata como
      // nova transferência — o operador entra quando entrar (aí `_botPaused` cala o bot).
      if (state.phase === 'handoff') {
        return JSON.stringify({ ok: true, ja_transferido: true,
          instrucao: 'Você já avisou que alguém do time vai continuar. NÃO repita o aviso e não diga que vai transferir de novo: siga atendendo a pessoa normalmente enquanto o time não entra.' })
      }
      state.phase = 'handoff'
      // Modo qualificação: quem quer estudar vai para a equipe comercial (rodízio dela).
      const equipeComercial = state.comercial?.modo === 'qualifica' ? lerModoComercial(chatbot?.modoComercial)?.teamId ?? null : null
      // Antes de um setor definido, a pessoa vai para o destino provisório da
      // primeira escolha (ex.: aluno → Secretaria), com equipe e funil juntos.
      // Depois de um setor definido, a pessoa já está nele: não volta ao provisório.
      if (equipeComercial && !(state.encaminhamentos || []).length) {
        await enviarParaEquipe(leadId, { teamId: equipeComercial, funnelId: null }, 'chatbot')
      } else if (state.fallbackRoute?.teamId && !(state.encaminhamentos || []).length) {
        await enviarParaEquipe(leadId, { teamId: state.fallbackRoute.teamId, funnelId: state.fallbackRoute.funnelId }, 'chatbot')
      }
      await notaDeEncaminhamento(leadId, chatbot, 'atendimento humano', input?.motivo)
      logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: `Jornada IA: transferido p/ humano${input?.motivo ? ' — ' + String(input.motivo).slice(0, 80) : ''}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
      // A conversa passa a ser da equipe: o bot dá esta última mensagem e cala
      // até alguém devolver a conversa ao bot (sem auto-resume). A despedida
      // ainda sai porque a pausa é da própria IA neste turno (iaPodeFalar).
      // Era opcional (`ai.journey.silence_after_handoff`); desde 01/11/2026 é
      // sempre: a IA nunca fala com quem está com a equipe.
      {
        const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { teamId: true } }).catch(() => null)
        const setor = atual?.teamId ? (await prisma.team.findUnique({ where: { id: atual.teamId }, select: { name: true } }).catch(() => null))?.name ?? null : null
        const { pauseBotForHandoff } = await import('./botTakeover.js')
        await pauseBotForHandoff(leadId, setor).catch(() => {})
        return JSON.stringify({ ok: true, encerrado: true,
          instrucao: 'Escreva UMA última mensagem: confirme com carinho que o time responsável vai continuar o atendimento daqui e se despeça. Esta é a sua última fala nesta conversa — não faça novas perguntas nem prometa prazo.' })
      }
    }

    if (name === 'consultar_catalogo') {
      const busca = String(input?.busca || '').trim()
      const categoria = String(input?.categoria || '').trim()
      const where: any = { active: true }
      if (categoria) where.categoria = { contains: categoria }
      if (busca) where.OR = [{ nome: { contains: busca } }, { descricao: { contains: busca } }, { marca: { contains: busca } }, { categoria: { contains: busca } }]
      const rows = await prisma.product.findMany({ where, orderBy: [{ disponivel: 'desc' }, { nome: 'asc' }], take: 15 })
      const produtos = rows.map((p) => ({
        nome: p.nome, categoria: p.categoria, marca: p.marca || undefined,
        preco: p.preco != null ? Number(p.preco) : undefined,
        disponivel: p.disponivel, estoque: p.estoque ?? undefined,
        descricao: p.descricao || undefined,
      }))
      return JSON.stringify({
        ok: true, total: produtos.length, produtos,
        instrucao: produtos.length
          ? 'Ofereça SOMENTE estes produtos. Cite nome, preço e disponibilidade EXATOS. Não invente nada além do que está aqui.'
          : 'Nenhum produto encontrado. Diga que não temos ESSE item. NÃO sugira nenhum modelo específico que não tenha vindo desta ferramenta. Para oferecer alternativa, chame consultar_catalogo de novo pela categoria; se ainda assim vazio, ofereça falar com um vendedor — sem citar modelos.',
      })
    }

    return JSON.stringify({ ok: false, erro: 'ferramenta desconhecida' })
  } catch (e: any) {
    app.log.warn(`[aiJourney] tool ${name} erro: ${e?.message || e}`)
    return JSON.stringify({ ok: false, erro: 'falha ao executar a ação' })
  }
}

// ── Chamadas ao LLM com tool use (Anthropic primário; OpenAI fallback) ──
export type LlmMsg = { role: 'user' | 'assistant'; content: any }

/**
 * Turno do cliente quando veio mídia junto (`ai.journey.read_media`). Imagem vira
 * bloco de visão (o modelo LÊ a foto — boletim, comprovante, print de conversa);
 * áudio sem transcrição é transcrito aqui; o resto vira um marcador honesto. O
 * texto sempre acompanha, para o modelo saber o que a pessoa escreveu junto.
 */
async function buildUserTurnContent(text: string, media?: InboundMedia | null): Promise<any> {
  const t = (text || '').trim()
  if (!media || !media.url) return t || '(sem texto)'

  if (media.type === 'image' || media.type === 'sticker') {
    const img = await readImageForModel(media.url, media.mime)
    if (img) {
      return [
        { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
        { type: 'text', text: t || 'O cliente enviou esta imagem, sem escrever nada junto. Olhe o que ela mostra e siga o atendimento a partir dela.' },
      ]
    }
    return `${mediaPlaceholder(media)}${t ? ` Legenda: ${t}` : ''} (não foi possível abrir o arquivo — peça com naturalidade que a pessoa reenvie ou descreva)`
  }

  if (media.type === 'audio') {
    // Áudio não tem legenda no WhatsApp: se veio texto junto, ELE é a transcrição
    // — o webhook já transcreve na entrada. Tratar como anexo aqui faria o bot
    // dizer que não conseguiu ouvir uma mensagem que ele acabou de receber por
    // escrito. Sem texto, tentamos transcrever aqui.
    if (t) return `[áudio do cliente, transcrito] ${t}`
    const transcript = await transcribeInboundAudio(media.url)
    if (transcript) return `[áudio do cliente, transcrito] ${transcript}`
    return mediaPlaceholder(media)
  }

  return t ? `${mediaPlaceholder(media)} Junto com: ${t}` : mediaPlaceholder(media)
}
// `text` no turno de ferramentas = o que o modelo escreveu JUNTO da chamada
// (saudação, acolhimento). Antes era descartado, e o lead recebia só a mensagem
// seguinte — que começava no meio do assunto, porque o modelo já considerava a
// abertura como dita. Ver o envio nos loops abaixo.
type LlmTurn = { kind: 'text'; text: string } | { kind: 'tools'; calls: Array<{ id: string; name: string; input: any }>; assistant: any; text: string }

async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return s ? String(s.value).replace(/^"|"$/g, '') : null
}

async function anthropicTurn(system: string, messages: LlmMsg[], tools: ToolDef[]): Promise<LlmTurn> {
  // Chave/modelo via Settings (Configurações > APIs) → fallback env. NÃO ler
  // process.env direto: o admin configura as chaves pela UI (bychat_settings).
  const apiKey = await getAnthropicKey()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')
  const model = (await getSetting('ai.journey_model')) || await getAnthropicModel()
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 1500,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) } : {}),
      messages,
    }),
  }, LLM_TIMEOUT_MS)
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  registrarUsoIA('jornada_ia', 'anthropic', data)
  const content = data.content || []
  const calls = content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
  const text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
  if (calls.length) return { kind: 'tools', calls, assistant: content, text }
  return { kind: 'text', text }
}

async function openaiTurn(system: string, messages: LlmMsg[], tools: ToolDef[]): Promise<LlmTurn> {
  const apiKey = await getOpenAiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')
  const model = (await getSetting('ai.journey_model_openai')) || await getOpenAiModel()
  // Converte mensagens (formato Anthropic interno) → formato OpenAI.
  const oaMsgs: any[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (typeof m.content === 'string') { oaMsgs.push({ role: m.role, content: m.content }); continue }
    if (m.role === 'assistant') {
      const text = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      const toolCalls = m.content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }))
      oaMsgs.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
    } else {
      const results = m.content.filter((b: any) => b.type === 'tool_result')
      if (results.length) for (const r of results) oaMsgs.push({ role: 'tool', tool_call_id: r.tool_use_id, content: r.content })
      else if (m.content.some((b: any) => b.type === 'image')) {
        // Turno com foto (`ai.journey.read_media`): o bloco da Anthropic vira o da
        // OpenAI, senão a imagem sumiria justamente no provider de fallback.
        oaMsgs.push({ role: 'user', content: m.content.map((b: any) => b.type === 'image'
          ? { type: 'image_url', image_url: { url: `data:${b.source?.media_type};base64,${b.source?.data}` } }
          : { type: 'text', text: b.text || '' }) })
      }
      else oaMsgs.push({ role: 'user', content: m.content.map((b: any) => b.text || '').join('') })
    }
  }
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 1500, messages: oaMsgs,
      ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
    }),
  }, LLM_TIMEOUT_MS)
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  registrarUsoIA('jornada_ia', 'openai', data)
  const msg = data.choices?.[0]?.message || {}
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    const calls = msg.tool_calls.map((c: any) => ({ id: c.id, name: c.function?.name, input: safeJson(c.function?.arguments) }))
    // Representa o turno do assistant no formato interno (Anthropic) p/ continuar o loop.
    const assistant = [
      ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
      ...calls.map((c: any) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
    ]
    return { kind: 'tools', calls, assistant, text: (msg.content || '').trim() }
  }
  return { kind: 'text', text: (msg.content || '').trim() }
}

function safeJson(s: any): any { try { return JSON.parse(s || '{}') } catch { return {} } }

export async function llmTurn(system: string, messages: LlmMsg[], tools: ToolDef[] = TOOLS): Promise<LlmTurn> {
  const primary = await getPrimaryProvider()
  const { noteLlmFailure, noteLlmSuccess } = await import('./aiProviderHealth.js')
  try {
    const r = primary === 'openai' ? await openaiTurn(system, messages, tools) : await anthropicTurn(system, messages, tools)
    await noteLlmSuccess()
    return r
  } catch (e) {
    // Fallback para o outro provider.
    try {
      const r = primary === 'openai' ? await anthropicTurn(system, messages, tools) : await openaiTurn(system, messages, tools)
      await noteLlmSuccess()
      return r
    } catch (e2) {
      // Os DOIS provedores recusaram. Se a recusa é de crédito/credencial, quem
      // fica sabendo é a gestão (sino), não o contato — ver aiProviderHealth.ts.
      // A classificação viaja no próprio erro para o motor decidir se responde.
      const kind = await noteLlmFailure(e, primary).catch(() => 'transient' as const)
      const kind2 = kind === 'credential' ? kind : await noteLlmFailure(e2, primary === 'openai' ? 'anthropic' : 'openai').catch(() => 'transient' as const)
      ;(e as any).llmFailure = kind2
      throw e
    }
  }
}

// ── Entrada (chamada pelo webhook quando chatbot.mode === 'ai_journey') ──
export async function processAiJourneyMessage(
  phone: string, text: string, app: FastifyInstance, messageId: string | undefined,
  sendFn: SendFn, provider: ProviderType, originData: OriginData | null | undefined,
  chatbotId: number | null | undefined, instanceName: string | null | undefined,
  chatbot: any, form: any,
  sendInteractiveFn?: SendInteractiveFn | null,
  promoteFunnelId?: number | null, promoteStageKey?: string | null,
  contactName?: string | null,
  // Mídia recebida junto (foto, áudio, documento). Sempre é gravada na conversa
  // com o anexo; o modelo só a vê com `ai.journey.read_media` ligado.
  media?: InboundMedia | null,
  // Conexão Cloud API por onde a mensagem entrou. A janela de 24h da Meta é
  // POR NÚMERO e quem consulta o estado dela filtra por esta coluna: gravar
  // `provider: 'cloud_api'` sem dizer QUAL conexão faz a janela parecer
  // fechada com o contato acabando de escrever.
  cloudApiConnectionId?: number | null,
): Promise<void> {
  // Rajada vale para o consultor educacional e, com ritmo humano ligado
  // (`ai.journey.human_pace_seconds`), para qualquer jornada.
  // Mídia sem texto com a leitura desligada não entra na conta: ela não gera
  // resposta, e contá-la faria a mensagem de texto anterior ceder a vez a quem
  // não vai responder — a pessoa ficaria sem resposta nenhuma.
  const cfgEntrada = await configDaJornada()
  const semResposta = !String(text || '').trim() && !!media && !cfgEntrada.lerMidia
  const rajada = !semResposta && (eduSdrLigado(form) || cfgEntrada.ritmoHumanoMs > 0)
  if (rajada) {
    pendentes.set(phone, (pendentes.get(phone) ?? 0) + 1)
    ultimaChegada.set(phone, Date.now())
  }
  const prev = locks.get(phone) ?? Promise.resolve()
  const run = prev.then(() =>
    _process(phone, text, app, messageId, sendFn, provider, originData, chatbotId, instanceName, chatbot, form, sendInteractiveFn, promoteFunnelId, promoteStageKey, contactName, media, cloudApiConnectionId)
      .catch((e) => app.log.error(`[aiJourney] erro: ${e?.stack || e}`))
      .finally(() => {
        if (!rajada) return
        const n = (pendentes.get(phone) ?? 1) - 1
        if (n > 0) pendentes.set(phone, n); else { pendentes.delete(phone); ultimaChegada.delete(phone) }
      }),
  )
  locks.set(phone, run.then(() => undefined))
  await run
}

async function _process(
  phone: string, text: string, app: FastifyInstance, messageId: string | undefined,
  sendFn: SendFn, provider: ProviderType, originData: OriginData | null | undefined,
  chatbotId: number | null | undefined, instanceName: string | null | undefined,
  chatbot: any, form: any, sendInteractiveFn: SendInteractiveFn | null | undefined,
  promoteFunnelId: number | null | undefined, promoteStageKey: string | null | undefined,
  contactName?: string | null,
  media?: InboundMedia | null,
  cloudApiConnectionId?: number | null,
): Promise<void> {
  if (!form || !Array.isArray(form.fields)) { app.log.warn('[aiJourney] form sem fields'); return }
  const attendantName = chatbot?.name || 'Atendimento'
  const cfg = await configDaJornada()
  // Trava absoluta (botTakeover.iaPodeFalar): conferida antes de CADA mensagem.
  const turnoDesde = new Date()
  let calada = false
  const podeFalar = async (leadId: number) => {
    if (calada) return false
    if (await iaPodeFalar(leadId, turnoDesde)) return true
    calada = true
    app.log.info(`[aiJourney] lead ${leadId}: conversa com a equipe — resposta da IA descartada`)
    return false
  }

  // Mídia que o webhook já persistiu (foto sem legenda) chega aqui com o mesmo
  // externalId — a checagem abaixo acharia "duplicata" e o bot nunca responderia.
  // A idempotência contra reentrega do webhook, nesse caso, é feita antes, no
  // próprio webhook.
  if (messageId && !media?.saved) {
    const dup = await prisma.message.findFirst({ where: { externalId: messageId, fromMe: false }, select: { id: true } })
    if (dup) return
  }

  const saveOutgoing = async (leadId: number, body: string, extId: string | null) => {
    await prisma.message.create({ data: {
      leadId, fromMe: true, body, mediaType: 'text', provider,
      ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
      ...(provider === 'cloud_api' && cloudApiConnectionId ? { cloudApiConnectionId } : {}),
      senderName: attendantName, isInternal: false, externalId: extId, ack: extId ? 1 : 0, timestamp: new Date(),
    } }).catch((e) => app.log.warn(`[aiJourney] save out: ${e}`))
    await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } }).catch(() => {})
    emitOutboundMessage({ leadId, source: 'ai_journey', channel: 'whatsapp', chatbotId: chatbotId ?? null })
  }
  const saveIncoming = async (leadId: number, body: string) => {
    // Já gravada pelo webhook (mídia sem legenda) — gravar de novo duplicaria a
    // mensagem na tela de Conversas.
    if (media?.saved) return
    // Mídia com legenda / áudio transcrito: o anexo vai junto. Antes gravava só
    // o texto como 'text' e a foto sumia da conversa (o webhook deixa a gravação
    // para este ponto justamente para não duplicar).
    await prisma.message.create({ data: {
      // Sem texto, o corpo segue o padrão dos webhooks ("[image]") para a tela de
      // Conversas tratar igual às demais mídias.
      leadId, fromMe: false, body: body || (media ? `[${media.type}]` : ''), mediaType: media?.type || 'text',
      ...(media?.url ? { mediaUrl: media.url, mediaName: media.name || null } : {}), provider,
      ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
      ...(provider === 'cloud_api' && cloudApiConnectionId ? { cloudApiConnectionId } : {}),
      senderName: body ? body.slice(0, 60) : phone, externalId: messageId || null, timestamp: new Date(),
    } }).catch((e) => app.log.warn(`[aiJourney] save in: ${e}`))
    await prisma.lead.update({ where: { id: leadId }, data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date() } }).catch(() => {})
  }
  const estilo = estiloDaJornada(form)
  const send = async (leadId: number, body: string, options: string[], rotulo?: string) => {
    // Um turno da IA vira a sequência de mensagens que uma pessoa mandaria: cada
    // ideia na sua bolha, sem travessão e sem emoji (services/messageStyle.ts).
    // As opções/botões acompanham SEMPRE a última mensagem — é ela que faz a
    // pergunta que as opções respondem.
    const partes = quebrarEmMensagens(body, estilo)
    if (!partes.length) return
    const ultima = partes[partes.length - 1] as string
    const anteriores = partes.slice(0, -1)
    // Ritmo humano (`ai.journey.human_pace_seconds`): o tempo de "digitar" a
    // primeira mensagem do bloco; as seguintes já esperam intervaloDigitacao.
    if (!eduSdrLigado(form) && cfg.ritmoHumanoMs > 0) await new Promise((r) => setTimeout(r, typingDelayMs(partes[0] as string)))

    for (const [i, parte] of anteriores.entries()) {
      if (!(await podeFalar(leadId))) return
      const r = await sendFn(phone, parte)
      await saveOutgoing(leadId, parte, r.messageId)
      const proxima = anteriores[i + 1] ?? ultima
      await new Promise((resolve) => setTimeout(resolve, intervaloDigitacao(proxima)))
    }

    if (!(await podeFalar(leadId))) return
    if (provider === 'cloud_api' && sendInteractiveFn && options.length) {
      const choices: Choice[] = options.map((o, i) => ({ id: `opt_${i}`, ...splitChoiceLabel(o) }))
      try {
        const r = await sendInteractiveFn(phone, buildChoices(ultima, choices, rotulo ? { button: rotulo, sectionTitle: rotulo } : undefined))
        await saveOutgoing(leadId, choicesToText(ultima, choices), r.messageId)
        return
      } catch (e: any) { app.log.warn(`[aiJourney] interactive fallback: ${e?.message || e}`) }
    }
    const full = options.length ? `${ultima}\n\n${options.map((o, i) => `${i + 1}) ${o}`).join('\n')}` : ultima
    const r = await sendFn(phone, full)
    await saveOutgoing(leadId, full, r.messageId)
  }

  // ── Lead + estado ──
  // acharLeadDoContato casa por phoneKey canônico, depois igualdade crua e por
  // fim waLid — a busca ingênua `where: { whatsapp: phone }` não achava o lead
  // de quem chegou só com LID (whatsapp fica vazio de propósito nesse caso) e
  // reabria a jornada do zero a cada mensagem. Ver services/contactIdentity.ts.
  // Só a conversa DESTE número da empresa — ver contactIdentity → CanalDoContato.
  const canal = canalDaMensagem(provider, instanceName, cloudApiConnectionId)
  let lead = await acharLeadDoContato(phone, { canal })

  // Só mídia, sem texto, com a leitura de mídia DESLIGADA: não há o que a IA
  // responder (ela não vê a foto) — como sempre, o bot não responde. A mensagem
  // só é gravada (com o anexo) se ainda não foi e o contato já tem ficha; sem
  // ficha, segue como antes: quem cria o lead é a primeira mensagem de texto.
  if (!String(text || '').trim() && media && !cfg.lerMidia) {
    if (lead && !media.saved) await saveIncoming(lead.id, '')
    return
  }

  const fd: any = (lead?.formData as any) || {}
  let state: AiState | null = fd._aiJourney || null

  const cname = (contactName || '').trim()
  let estadoNovo = false
  if (!lead || !state) {
    estadoNovo = true
    let leadId = lead?.id ?? null
    if (!leadId) {
      const body = { ctwaClid: originData?.ctwaClid ?? null, originType: originData?.originType ?? null, utmSource: originData?.utmSource ?? null, gclid: originData?.gclid ?? null }
      // Nome do perfil do WhatsApp já vem na Cloud API → nasce no lead (sem a IA perguntar).
      const created = await createLeadFromForm(form, form.fields, cname ? { nome: cname } : {}, body, instanceName || '', null,
        promoteFunnelId ? { funnelId: promoteFunnelId, stageKey: promoteStageKey ?? null } : undefined, {
        channel: 'whatsapp', leadSource: 'whatsapp', chatbotId: chatbotId ?? null,
        routing: { source: 'whatsapp', chatbotId: chatbotId ?? null, instanceName: instanceName ?? null },
        forceWhatsapp: phone, qualificationSource: 'form', canal,
      })
      leadId = created?.leadId ?? null
    } else if (promoteFunnelId ?? form.funnelId) {
      // Lead já existe sem estado → promove para o funil/etapa da conexão (forwardOnly).
      await moveLeadStage(leadId, promoteFunnelId ?? form.funnelId ?? null, promoteStageKey ?? form.stageKey ?? 'NOVO', 'chatbot', { forwardOnly: true }).catch(() => {})
    }
    if (!leadId) { app.log.warn('[aiJourney] não criou lead'); return }
    state = { leadId, phase: 'active', answers: {} }
    // Nome (do perfil WhatsApp) e WhatsApp (número) já são conhecidos: semeia no estado
    // pra a IA NÃO perguntar, e garante no lead (mapTo nome/whatsapp do form).
    const fieldKeyOf = (mapTo: string): string | null => (form.fields.find((f: any) => f?.mapTo === mapTo)?.key) || null
    const nomeKey = fieldKeyOf('nome'); const waKey = fieldKeyOf('whatsapp')
    if (nomeKey && cname) state.answers[nomeKey] = cname
    if (waKey) state.answers[waKey] = phone
    lead = await prisma.lead.findUnique({ where: { id: leadId } })
    if (cname && (!lead?.nome || lead.nome === 'Lead LP')) {
      await prisma.lead.update({ where: { id: leadId }, data: { nome: cname } }).catch(() => {})
      if (lead) lead.nome = cname
    }
    // Sem backfill cru de `whatsapp` aqui: createLeadFromForm já gravou a
    // identidade certa via identidadeDoContato — telefone de verdade na coluna
    // `whatsapp`, LID em `waLid`. Escrever `phone` cru de novo reintroduzia o
    // LID na coluna de telefone sempre que o lead nascia só-LID (caso do "Lead
    // LP" com número de 15 dígitos sem DDI válido, severiano 14/09/2026).
    logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_STARTED, category: 'lifecycle', title: `Jornada IA iniciada: ${chatbot?.name || form.name}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
  }

  const leadId = state.leadId!

  // Takeover humano: um operador já respondeu a este lead pelo painel. A mensagem
  // do cliente continua sendo gravada (aparece nas Conversas), mas a IA NÃO
  // responde — em definitivo, até devolverem a conversa ao bot. Ver botTakeover.ts.
  {
    const { readBotPause, autoResumeIfStale } = await import('./botTakeover.js')
    // Antes de calar o bot, checa se o atendimento humano esfriou (config por tenant):
    // se ninguém da equipe respondeu há horas, a conversa volta ao bot em vez de morrer.
    const resumed = await autoResumeIfStale(leadId).catch(() => false)
    if (resumed) app.log.info(`[aiJourney] lead ${leadId}: atendimento humano esfriou — bot reassumiu`)
    const fresh = resumed ? null : await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }).catch(() => null)
    const paused = readBotPause(fresh?.formData)
    if (paused) {
      await saveIncoming(leadId, text)
      app.log.info(`[aiJourney] lead ${leadId}: bot pausado (humano assumiu em ${paused.at}) — sem resposta automática`)
      return
    }
  }
  // Conversa já entregue à equipe (fase 'handoff'): é dela. A IA não fala até
  // alguém devolver a conversa ao bot (que reabre a fase).
  if (state.phase === 'handoff') {
    await saveIncoming(leadId, text)
    app.log.info(`[aiJourney] lead ${leadId}: conversa entregue à equipe — sem resposta automática`)
    return
  }

  // Conversa encerrada → não reabre o roteiro (pós-atendimento humano).
  // Com `ai.journey.resume_after_done` (veio do severiano) a jornada é RETOMADA:
  // o estado (respostas, agendamento, desfecho) é preservado e entra no prompt
  // como contexto, e a fase volta a 'active' — antes, quando o bot voltava a
  // atender, recomeçava do zero, repetindo saudação e perguntas já respondidas.
  // Tenant com IA de pós-atendimento (postChatAi) mantém o comportamento dela —
  // é uma escolha explícita de produto e vale mesmo com a retomada ligada.
  let resumedFrom: string | null = null
  if (lead?.completed || state.phase === 'done' || state.phase === 'disqualified') {
    if (chatbot?.postChatAi || !cfg.retomarAposEncerrar) {
      await saveIncoming(leadId, text)
      if (chatbot?.postChatAi) {
        const { postJourneyAiReply } = await import('./chatbotFlow.js')
        await postJourneyAiReply({ lead, text, phone, sendFn, provider, instanceName, chatbot, app, cloudApiConnectionId }).catch((e: any) => app.log.warn(`[aiJourney] postChatAi: ${e?.message || e}`))
      }
      return
    }
    resumedFrom = state.phase === 'active' ? 'completed' : state.phase
    state.phase = 'active'
    if (!state.resumedAt) app.log.info(`[aiJourney] lead ${leadId}: atendimento retomado (estava "${resumedFrom}") — segue do ponto anterior`)
    state.resumedAt = new Date().toISOString()
  }

  await saveIncoming(leadId, text)

  // Modo comercial (journey/modoComercial): decidido no começo do atendimento e
  // mantido até ele acabar — conversa iniciada termina como começou.
  const cfgComercial = lerModoComercial(chatbot?.modoComercial)
  if (cfgComercial) {
    const novo = estadoNovo || !!resumedFrom || await eNovoAtendimento(leadId)
    if (novo || !state.comercial) {
      state.comercial = novo
        ? await decidirModoComercial(cfgComercial)
        : { modo: 'completo', em: new Date().toISOString(), motivo: 'atendimento já em andamento' }
      app.log.info(`[aiJourney] lead ${leadId}: modo comercial = ${state.comercial.modo} (${state.comercial.motivo})`)
    }
  }
  const qualificando = !!cfgComercial && state.comercial?.modo === 'qualifica'

  const edu = eduSdrLigado(form)
  // Ritmo humano (`ai.journey.human_pace_seconds`): a mesma espera da rajada do
  // consultor, com a janela configurada (N s de silêncio, teto 3×N). O consultor
  // educacional mantém a janela dele.
  const paceMs = edu ? 0 : cfg.ritmoHumanoMs
  if (edu || paceMs > 0) {
    // Espera a pessoa terminar de escrever. Se outra mensagem dela já está na
    // fila, esta fica só gravada: a última da rajada responde a todas.
    const janela = edu ? EDU_JANELA_MS : paceMs
    const janelaMax = edu ? EDU_JANELA_MAX_MS : paceMs * 3
    const inicio = Date.now()
    while (Date.now() - (ultimaChegada.get(phone) ?? 0) < janela && Date.now() - inicio < janelaMax) {
      await new Promise((r) => setTimeout(r, 500))
    }
    if ((pendentes.get(phone) ?? 1) > 1) {
      await prisma.lead.update({ where: { id: leadId }, data: { formData: { ...(((await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } }))?.formData as any) || {}), _aiJourney: state } } }).catch(() => {})
      return
    }
  }

  // ── Histórico p/ o LLM (mensagens anteriores do lead) ──
  const hist = await prisma.message.findMany({
    where: { leadId, isInternal: false }, orderBy: { id: 'desc' }, take: edu ? EDU_HISTORY_LIMIT : cfg.historico,
    select: { fromMe: true, body: true },
  })
  const messages: LlmMsg[] = hist.reverse()
    .filter((m) => (m.body || '').trim())
    .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }))
  if (media && cfg.lerMidia) {
    // Turno atual com mídia: o conteúdo deixa de ser só texto (a foto vai como
    // bloco de imagem, o áudio como transcrição). O último turno do histórico é
    // esta mesma mensagem — substituí-lo evita mandá-la duas vezes ao modelo.
    const userContent = await buildUserTurnContent(text, media)
    if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content = userContent
    else messages.push({ role: 'user', content: userContent })
  } else if (!messages.length || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: text })
  }
  // Só um "oi" de quem já conversou: o modelo tende a devolver "estou aqui, como
  // posso ajudar?" (o padrão da conversa vence a instrução). O aviso o leva a
  // retomar pela situação ATUAL da ficha, com o próximo passo.
  if (soCumprimento(text) && messages.some((m) => m.role === 'assistant')) {
    const ultima = messages[messages.length - 1]
    if (typeof ultima.content === 'string') ultima.content = `${ultima.content}\n\n${cfg.semMenus ? AVISO_CUMPRIMENTO_SEM_MENUS : AVISO_CUMPRIMENTO}`
  }

  const catalogSummary = await getCatalogSummary()
  // Horário de atendimento humano (Cadastros › Atendimento) — o bot precisa dele
  // para responder "quando vocês respondem?" com o que a empresa cadastrou.
  const bhText = await (await import('./businessHours.js')).getConfiguredBusinessHours().catch(() => null)
  const { getBranding } = await import('../lib/branding.js')
  const marca = await getBranding().catch(() => null)
  // Consultor educacional: a ficha do lead vai DENTRO do protocolo dele
  // (contextoDoLead, que inclui inscrições e etapas) — não duplica a genérica.
  const eduBloco = edu
    ? protocoloEdu(await resumoDoCatalogo(app).catch(() => ''), await contextoDoLead(leadId).catch(() => ''), false)
    : null
  const contextoLead = edu ? null : await buildLeadContext(leadId, cfg.fichaAmpliada ? { state, historico: cfg.historico } : null).catch(() => '')
  // Trilha de entrada do lead (ex.: veio de anúncio e recebeu a mensagem primeiro).
  const routeBlock = await getBotRouteBlock(lead?.formData).catch(() => null)
  // Atendimento retomado: o desfecho anterior vira contexto explícito, senão o
  // modelo recomeça a jornada do zero.
  const resumeBlock = resumedFrom ? await buildResumeContext(leadId, lead, resumedFrom).catch(() => null) : null
  const nomeEquipeComercial = qualificando && cfgComercial?.teamId
    ? (await prisma.team.findUnique({ where: { id: cfgComercial.teamId }, select: { name: true } }).catch(() => null))?.name ?? null
    : null
  const qualificacao = qualificando ? blocoDeQualificacao(state.comercial?.perguntas ?? [], nomeEquipeComercial) : null
  const system = buildSystemPrompt(chatbot, form, lead ? await withSourceLabel(lead) : lead, state, catalogSummary, bhText, marca?.brandName ?? null, contextoLead, eduBloco, { cfg, routeBlock, resumeBlock, qualificacao })
  const tools = ferramentasDaJornada(form, cfg, { qualificacao: qualificando })
  const maxIters = edu ? EDU_MAX_TOOL_ITERS : MAX_TOOL_ITERS

  // ── Loop de orquestração: IA pede ação → servidor executa → devolve → repete ──
  // Tudo com teto de tempo: nenhuma chamada (LLM ou ferramenta) pode pendurar o turno
  // e congelar a conversa (o lock por telefone). O lead SEMPRE recebe uma resposta.
  const startedAt = Date.now()
  let replied = false
  let failed = false
  // Falha da NOSSA infraestrutura (crédito, cota, credencial). Não vira mensagem
  // para o contato: a frase de desculpa pede que ele repita, ele repete, e a
  // falha se repete junto — cinco dias disso no severiano renderam 66 mensagens
  // de erro e nenhuma resposta de verdade. Ver services/aiProviderHealth.ts.
  let indisponivel = false
  // Uma cobrança por turno quando a IA promete encaminhar sem chamar rotear_setor.
  let cobrouEncaminhamento = false
  for (let i = 0; i < maxIters; i++) {
    if (Date.now() - startedAt > TURN_BUDGET_MS) { app.log.warn('[aiJourney] orçamento do turno esgotado'); failed = true; break }
    let turn: LlmTurn
    try { turn = await llmTurn(system, messages, tools) }
    catch (e: any) {
      app.log.error(`[aiJourney] LLM: ${e?.message || e}`)
      failed = true
      indisponivel = e?.llmFailure === 'credential'
      break
    }

    if (turn.kind === 'text') {
      if (edu && !cobrouEncaminhamento && prometeuEncaminharSemRotear(turn.text, form, state)) {
        cobrouEncaminhamento = true
        messages.push({ role: 'assistant', content: turn.text })
        messages.push({ role: 'user', content: LEMBRETE_ROTEAR })
        continue
      }
      // Um bloco por menu: a resposta pode trazer mais de um (ex.: duas listas).
      const blocos = extrairBlocosDeOpcoes(turn.text)
      for (const [i, b] of blocos.entries()) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, intervaloDigitacao(b.text)))
        await send(leadId, b.text, b.options, b.rotulo).catch(() => {})
      }
      if (blocos.length) replied = true
      else failed = true
      break
    }
    // Texto escrito JUNTO da chamada de ferramenta: entrega ao lead antes de executar
    // as ferramentas. Sem isso o modelo "acha" que já cumprimentou (o bloco está no
    // histórico que ele recebe de volta) e a mensagem seguinte começa no meio do assunto.
    // Com ritmo humano ligado vale a regra do consultor: o texto de espera não vai
    // ao lead nem fica no histórico, e a resposta final sai inteira numa mensagem.
    const umaResposta = edu || paceMs > 0
    if (turn.text.trim() && !umaResposta) {
      const { text: pre, options: preOpts } = extractOptions(turn.text)
      if (pre) { await send(leadId, pre, preOpts).catch(() => {}); replied = true }
    }

    // tool_use: executa as ferramentas pedidas (cada uma com timeout) e devolve os resultados.
    messages.push({ role: 'assistant', content: umaResposta ? semTextoDeEspera(turn.assistant) : turn.assistant })
    const results: any[] = []
    for (const call of turn.calls) {
      const out = await Promise.race([
        executeTool(call.name, call.input, { leadId, phone, form, chatbot, state, promoteFunnelId: promoteFunnelId ?? null, promoteStageKey: promoteStageKey ?? null, app, cfg }),
        new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ ok: false, erro: 'tempo esgotado na ação' })), TOOL_TIMEOUT_MS)),
      ])
      results.push({ type: 'tool_result', tool_use_id: call.id, content: out })
    }
    messages.push({ role: 'user', content: results })
  }
  // Fallback garantido: se o turno terminou sem resposta, o lead ainda recebe algo coerente.
  if (!replied) {
    const fp: string = state.phase
    if (fp === 'disqualified') {
      app.log.warn('[aiJourney] desqualificado sem resposta — encerrando cordialmente')
      const t = await textoDoSistema('chatbot_ia_desqualificado')
      if (t) await send(leadId, t, []).catch(() => {})
    } else if (indisponivel) {
      // Silêncio deliberado: a mensagem do lead já está gravada e a conversa
      // aparece nas Conversas para o time atender. A gestão foi avisada pelo
      // sino (alerta `integration.error`), que é quem pode resolver.
      app.log.error(`[aiJourney] lead ${leadId}: IA indisponível (crédito/credencial) — bot em silêncio, conversa entregue ao atendimento humano`)
    } else if (failed) {
      app.log.warn('[aiJourney] sem resposta final — enviando fallback')
      const t = await textoDoSistema('chatbot_ia_instabilidade')
      if (t) await send(leadId, t, []).catch(() => {})
    } else {
      app.log.warn('[aiJourney] loop sem resposta final (limite de iterações)')
      const t = await textoDoSistema('chatbot_ia_verificando')
      if (t) await send(leadId, t, []).catch(() => {})
    }
  }

  // ── Persiste estado em lead.formData._aiJourney (+ answers no topo) ──
  const cur = await prisma.lead.findUnique({ where: { id: leadId }, select: { formData: true } })
  const base: any = (cur?.formData as any) || {}
  const finalPhase: string = state.phase // executeTool pode tê-la mutado p/ done/disqualified
  await prisma.lead.update({ where: { id: leadId }, data: {
    formData: { ...base, ...state.answers, _source: 'whatsapp', _aiJourney: state },
    ...(finalPhase === 'done' || finalPhase === 'disqualified' ? { completed: true } : {}),
  } }).catch((e) => app.log.warn(`[aiJourney] persist: ${e}`))
}

// Guarda do encaminhamento (jornada educacional com departamentos). O modelo às
// vezes ANUNCIA "vou encaminhar você para o setor X" e encerra o turno sem chamar
// rotear_setor: a pessoa lê que foi encaminhada e o lead fica parado, sem equipe
// nem funil. O motor detecta a promessa no texto final e devolve uma vez ao
// modelo, que chama a ferramenta (ou reescreve sem prometer). Vale também no
// simulador, para o teste mostrar o que acontece no WhatsApp.
const PROMESSA_ENCAMINHAR = /\b(vou|j[áa]|irei|vamos|estou)\s+(te\s+|lhe\s+)?(encaminh|direcion|transferi)\w*|\b(encaminh|direcion)\w*\s+(voc[êe]|vc|seu|sua|o seu|a sua|o assunto)(?![a-zà-ú])/i
export const LEMBRETE_ROTEAR = '[aviso interno do sistema, não é a pessoa] Você escreveu que vai encaminhar/direcionar, mas não chamou rotear_setor, então nada foi encaminhado. Se o departamento já está claro e é UM só, chame rotear_setor AGORA e só depois escreva a resposta. Se mais de um departamento ainda é possível (ex.: curso, pós ou componente não informado), NÃO escolha por conta própria: reescreva a resposta perguntando só o que falta para decidir, sem prometer encaminhamento.'
export function prometeuEncaminharSemRotear(texto: string, form: any, state: any): boolean {
  const fields = Array.isArray(form?.fields) ? form.fields : []
  const routeField = fields.find((f: any) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
  if (!routeField) return false
  if (state?.answers?.[routeField.key] != null) return false
  // Mensagem com menu de opções está PERGUNTANDO para onde ir ("selecione uma
  // das opções para direcionarmos seu atendimento"), não prometendo encaminhar.
  if (new RegExp(MARCADOR_OPCOES.source, 'is').test(String(texto || ''))) return false
  return PROMESSA_ENCAMINHAR.test(String(texto || ''))
}

// ── Reativação de conversa parada ───────────────────────────────────────────
// Chamada pelo verificador de inatividade (services/inactivity.ts) quando o
// chatbot tem a ação "Reativar com IA e transferir". A IA escreve a retomada com
// o prompt da própria jornada e o histórico: o texto sabe em que ponto a pessoa
// parou (menu, dado da inscrição, documento) e o tom vem das instruções da
// instituição (seção "Reativação", quando houver). Sai pelo canal da conversa,
// com os botões quando a mensagem traz menu, e fica gravada no Conversas.
export async function reativarConversaComIa(leadId: number, chatbot: any, form: any, tentativa: number, total: number): Promise<boolean> {
  const lead: any = await prisma.lead.findUnique({ where: { id: leadId } })
  const state: AiState | null = (lead?.formData as any)?._aiJourney || null
  if (!lead?.whatsapp || !state) return false
  const edu = eduSdrLigado(form)
  const cfg = await configDaJornada()

  const hist = await prisma.message.findMany({
    where: { leadId, isInternal: false }, orderBy: { id: 'desc' }, take: edu ? EDU_HISTORY_LIMIT : cfg.historico,
    select: { id: true, fromMe: true, body: true, provider: true, evolutionInstance: true, cloudApiConnectionId: true },
  })
  const ultima = hist[0]
  if (!ultima?.fromMe) return false // a pessoa respondeu: não é conversa parada
  const messages: LlmMsg[] = hist.slice().reverse()
    .filter((m) => (m.body || '').trim())
    .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }))
  const ultimaVez = tentativa >= total
  messages.push({ role: 'user', content: `[aviso interno do sistema, não é a pessoa] A pessoa não respondeu à sua última mensagem. Escreva a reativação ${tentativa} de ${total}, seguindo a seção "Reativação" das suas instruções, se houver. Regras: no máximo 2 mensagens curtas; sutil e amigável, sem cobrança, pressão ou culpa; chame pelo primeiro nome, se souber; retome exatamente o ponto em que a conversa parou (se a sua última mensagem tinha menu de opções, mande o mesmo menu de novo com o marcador); não repita a mensagem anterior palavra por palavra; não diga que a mensagem é automática nem quanto tempo passou; não chame ferramentas.${ultimaVez ? ' É a última tentativa: diga com leveza que, se preferir, a equipe pode continuar com ela por aqui mesmo.' : ''}` })

  const { getBranding } = await import('../lib/branding.js')
  const marca = await getBranding().catch(() => null)
  const eduBloco = edu ? protocoloEdu('', await contextoDoLead(leadId).catch(() => ''), false) : null
  const contextoLead = edu ? null : await buildLeadContext(leadId, cfg.fichaAmpliada ? { state, historico: cfg.historico } : null).catch(() => '')
  const system = buildSystemPrompt(chatbot, form, await withSourceLabel(lead), state, '', null, marca?.brandName ?? null, contextoLead, eduBloco, { cfg })
  const turn = await llmTurn(system, messages, []).catch(() => null)
  if (!turn || turn.kind !== 'text' || !turn.text.trim()) return false

  // A pessoa pode ter respondido enquanto a IA escrevia.
  const depois = await prisma.message.findFirst({ where: { leadId, isInternal: false, id: { gt: ultima.id } }, select: { id: true } })
  if (depois) return false
  // Trava absoluta: conversa com a equipe não recebe reativação da IA.
  if (!(await iaPodeFalar(leadId))) return false

  const { getProviderForLead } = await import('./whatsappProvider.js')
  const provider = await getProviderForLead({ id: leadId, whatsapp: lead.whatsapp })
  const estilo = estiloDaJornada(form)
  const gravar = async (body: string, extId: string | null) => {
    await prisma.message.create({ data: {
      leadId, fromMe: true, body, mediaType: 'text', provider: ultima.provider || provider.providerName,
      ...(ultima.evolutionInstance ? { evolutionInstance: ultima.evolutionInstance } : {}),
      ...(ultima.cloudApiConnectionId ? { cloudApiConnectionId: ultima.cloudApiConnectionId } : {}),
      senderName: chatbot?.name || 'Atendimento', isInternal: false, externalId: extId, ack: extId ? 1 : 0, timestamp: new Date(),
    } }).catch(() => {})
  }
  let enviou = false
  for (const bloco of extrairBlocosDeOpcoes(turn.text)) {
    const partes = quebrarEmMensagens(bloco.text, estilo)
    if (!partes.length) continue
    const fim = partes.pop() as string
    for (const parte of partes) {
      if (!(await iaPodeFalar(leadId))) return enviou
      const r = await provider.sendText(lead.whatsapp, parte)
      await gravar(parte, r?.messageId ?? null); enviou = true
      await new Promise((resolve) => setTimeout(resolve, intervaloDigitacao(fim)))
    }
    if (!(await iaPodeFalar(leadId))) return enviou
    const choices: Choice[] = bloco.options.map((o, i) => ({ id: `opt_${i}`, ...splitChoiceLabel(o) }))
    const interativo = provider.providerName === 'cloud_api' && choices.length
      ? buildChoices(fim, choices, bloco.rotulo ? { button: bloco.rotulo, sectionTitle: bloco.rotulo } : undefined)
      : null
    if (interativo) {
      const r = await provider.sendInteractive(lead.whatsapp, interativo)
      await gravar(choicesToText(fim, choices), r?.messageId ?? null)
    } else {
      const texto = choices.length ? `${fim}\n\n${choices.map((c, i) => `${i + 1}) ${c.title}`).join('\n')}` : fim
      const r = await provider.sendText(lead.whatsapp, texto)
      await gravar(texto, r?.messageId ?? null)
    }
    enviou = true
  }
  if (enviou) await prisma.lead.update({ where: { id: leadId }, data: { lastMessageAt: new Date() } }).catch(() => {})
  return enviou
}
