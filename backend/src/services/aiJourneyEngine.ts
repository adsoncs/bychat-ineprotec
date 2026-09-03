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
import type { SendFn, SendInteractiveFn, ProviderType } from './chatbotFlow.js'
import type { OriginData } from './originDetection.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { createLeadFromForm, moveLeadStage } from './formFlow.js'
import { applyAnswerToLead } from './scriptedChatbotFlow.js'
import { evaluateQualification, resolveStageMove } from './journey/journeyEngine.js'
import { getActiveMeetingType, getMeetingTypeSlots, createBooking } from './schedulingService.js'
import { buildChoices, choicesToText, type Choice } from '../lib/waInteractive.js'
import { pickOperatorForTeam } from './teamRouting.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel, getPrimaryProvider } from '../lib/aiKeys.js'

const MAX_TOOL_ITERS = 6
const HISTORY_LIMIT = 24
const LLM_TIMEOUT_MS = 30000   // teto por chamada ao LLM (evita travar a conversa)
const TOOL_TIMEOUT_MS = 20000  // teto por execução de ferramenta (ex.: slots/Google)
const TURN_BUDGET_MS = 90000   // teto total do turno (libera o lock no pior caso)

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
  phase: 'active' | 'done' | 'disqualified' | 'handoff'
  answers: Record<string, any>
  bookingId?: number | null
}

const locks = new Map<string, Promise<void>>()

function stripTags(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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

// Extrai botões do marcador [[OPTIONS: a | b | c]] no fim do texto da IA.
export function extractOptions(raw: string): { text: string; options: string[] } {
  const m = /\[\[\s*OPTIONS:(.+?)\]\]/is.exec(raw || '')
  if (!m) return { text: (raw || '').trim(), options: [] }
  const options = m[1].split('|').map((s) => s.trim()).filter(Boolean).slice(0, 10)
  const text = (raw || '').replace(m[0], '').trim()
  return { text, options }
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
      properties: { setor: { type: 'string', description: 'Chave do setor (value da opção), exatamente como em "Setores disponíveis".' } },
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
    input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: [] },
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

// ── System prompt: prompt-mestre + dados a coletar (dos fields do form) + protocolo ──
export function buildSystemPrompt(chatbot: any, form: any, lead: any, state: AiState, catalogSummary: string, businessHours?: string | null): string {
  const fields: any[] = form?.fields || []
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
  const setores = routeField
    ? routeField.options.filter((o: any) => o?.route).map((o: any) => `- \`${o.value}\`: ${stripTags(o.label)}`).join('\n')
    : ''

  // Nomes-placeholder (lead criado sem nome real, ex.: canal web sem perfil) NÃO
  // contam como nome conhecido — senão a IA cumprimenta "Olá, Lead LP".
  const PLACEHOLDER_NAMES = new Set(['lead lp', 'lead', 'webchat'])
  const realNome = lead?.nome && !PLACEHOLDER_NAMES.has(String(lead.nome).trim().toLowerCase()) ? lead.nome : ''
  // whatsapp sintético do canal web (webchat:<uid>) não é um telefone real.
  const realWhats = lead?.whatsapp && !String(lead.whatsapp).startsWith('webchat:') ? lead.whatsapp : ''
  const known = [
    realNome ? `nome: ${realNome}` : '',
    realWhats ? `whatsapp: ${realWhats}` : '',
    lead?.email ? `email: ${lead.email}` : '',
  ].filter(Boolean).join(' · ')
  const already = Object.keys(state.answers || {})
  const hasSched = fields.some((f) => f?.type === 'scheduling')

  const nm = realNome || state.answers?.nome || ''
  // Saudação configurada do chatbot: a IA conduz a abertura, mas DEVE abrir com
  // esta mensagem (no tom da marca). Só vale para a 1ª mensagem da conversa.
  const greeting = (chatbot?.greetingMessage && String(chatbot.greetingMessage).trim()) || ''
  const schedIntro = (chatbot?.schedulingIntro && String(chatbot.schedulingIntro).trim())
    ? String(chatbot.schedulingIntro).replace(/\{\{\s*nome\s*\}\}/gi, nm || '{nome do lead}').replace(/\{\{\s*reuniao\s*\}\}/gi, 'reunião').trim()
    : ''

  const base = (chatbot?.aiJourneyPrompt && String(chatbot.aiJourneyPrompt).trim()) || [
    `Você é um(a) atendente comercial da nossa empresa, conversando por WhatsApp com um lead.`,
    `Seu objetivo: conduzir uma conversa natural e cordial para conhecer o lead, coletar os dados necessários, qualificá-lo e — se qualificado${hasSched ? ' — agendar uma reunião' : ''}.`,
    `Seja humano, objetivo e simpático. Faça UMA pergunta por vez. Não despeje todas as perguntas de uma vez.`,
  ].join('\n')

  return [
    base,
    `\n## Dados a coletar (use estas chaves ao chamar salvar_dados)\n${collect || '(nenhum)'}`,
    setores ? `\n## Setores disponíveis (use rotear_setor)\n${setores}\n\nQuando entender o que o lead procura, identifique o setor — mas só chame **rotear_setor** DEPOIS de já ter coletado e salvo os dados de contato (veja "Dados de contato"). Chame uma única vez; encaminha o lead à equipe certa nos bastidores — siga com naturalidade, sem anunciar o encaminhamento.` : '',
    `\n## Dados de contato (obrigatório antes de encaminhar para humano)\nAntes de chamar rotear_setor ou transferir_humano, você PRECISA ter coletado e salvo (via salvar_dados) os dados de contato do lead: nome, e-mail, WhatsApp e cidade. Peça apenas o que ainda não souber (veja "Já sabemos"/"Respostas já coletadas"), de forma natural e UMA pergunta por vez. Não encaminhe ao atendimento humano sem esses dados.`,
    known ? `\n## Já sabemos sobre o lead\n${known}` : '',
    already.length ? `\n## Respostas já coletadas nesta conversa\n${already.map((k) => `- ${k}: ${state.answers[k]}`).join('\n')}` : '',
    greeting ? `\n## Abertura da conversa\nSe esta for a SUA primeira mensagem (não há nenhuma mensagem sua antes no histórico), ABRA com esta saudação, mantendo o sentido e o tom — você pode adaptá-la levemente e personalizar com o nome do lead quando souber. Não a repita nas mensagens seguintes:\n"${greeting}"` : '',
    `\n## Como agir
- Na primeira mensagem, cumprimente com a saudação de abertura (acima) e já encaminhe a conversa. Depois, comece a coletar os dados que faltam, um por vez, de forma natural.
- Sempre que o lead responder um dado, chame **salvar_dados** com a(s) chave(s) corretas.
- Depois de coletar os campos qualificadores, chame **avaliar_qualificacao** e siga a instrução que ela retornar (o servidor decide a qualificação — não decida por conta própria).
- Se qualificado${hasSched ? ' e houver agendamento: chame **listar_horarios**, ofereça os horários ao lead, e ao ele escolher chame **agendar** com o startAt exato. Só diga que está agendado depois de agendar retornar ok=true.' : ': agradeça e finalize com **encerrar**.'}
- Se desqualificado: agradeça cordialmente, NÃO ofereça agendamento, e chame **encerrar**.
- Se o lead pedir um humano ou fugir do escopo, chame **transferir_humano**.`,
    catalogSummary ? `\n## Catálogo (FONTE DA VERDADE)
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
O horário de atendimento humano NÃO está cadastrado no sistema. Portanto: NUNCA afirme horário de funcionamento nem prometa prazo de retorno ("respondem ainda hoje", "amanhã cedo"). Diga apenas que a equipe vai retornar assim que possível.`,
    `\n## Regras
- O nome e o WhatsApp do lead JÁ são conhecidos (vêm do perfil do WhatsApp — veja "Já sabemos"/"Respostas já coletadas"). NÃO pergunte por eles; use o nome para personalizar a conversa.
- NUNCA invente horários: use só os que listar_horarios devolveu.
- NUNCA afirme que agendou sem agendar ter retornado ok=true.
- Responda sempre em português do Brasil, com mensagens curtas (WhatsApp).
- Para ofertas com poucas opções fechadas (ex.: escolher um horário ou uma opção de select), TERMINE a mensagem com o marcador: [[OPTIONS: opção 1 | opção 2 | opção 3]] (máx. 10). O texto antes do marcador é a mensagem; as opções viram botões.`,
  ].filter(Boolean).join('\n')
}

// Dados de contato que devem estar salvos no CRM antes de encaminhar o lead a um
// humano. Genérico: olha os campos do form com mapTo de contato e checa o valor
// real no lead (ignora placeholders do canal web). Retorna os que faltam.
const CONTACT_MAPTOS = ['nome', 'whatsapp', 'email', 'cidade'] as const
const CONTACT_LABEL: Record<string, string> = { nome: 'nome', whatsapp: 'WhatsApp', email: 'e-mail', cidade: 'cidade' }
async function missingContactData(leadId: number, form: any): Promise<string[]> {
  const fields: any[] = form?.fields || []
  const wanted = fields.filter((f) => CONTACT_MAPTOS.includes(f?.mapTo))
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

// Resumo do catálogo (categorias + contagem) para o system prompt. Vazio quando
// não há produtos cadastrados — aí a seção de catálogo nem aparece.
export async function getCatalogSummary(): Promise<string> {
  try {
    const rows = await prisma.product.groupBy({ by: ['categoria'], where: { active: true }, _count: { _all: true } })
    if (!rows.length) return ''
    return rows.map((r) => `${r.categoria} (${r._count._all})`).sort().join(', ')
  } catch { return '' }
}

// ── Executor das ferramentas (chamadas pela IA → funções determinísticas reais) ──
async function executeTool(
  name: string, input: any, ctx: { leadId: number; phone: string; form: any; chatbot: any; state: AiState; promoteFunnelId: number | null; promoteStageKey: string | null; app: FastifyInstance },
): Promise<string> {
  const { leadId, phone, form, state, promoteFunnelId, app } = ctx
  const fields: any[] = form?.fields || []
  const settings: any = form?.settings || {}
  try {
    if (name === 'salvar_dados') {
      const campos: Array<{ chave: string; valor: string }> = Array.isArray(input?.campos) ? input.campos : []
      const salvos: string[] = []
      for (const c of campos) {
        const field = fields.find((f) => f?.key === c.chave)
        if (!field) continue
        // Campos de seleção: a IA costuma mandar o LABEL que o lead falou, mas a
        // qualificação determinística compara com o VALUE da opção. Mapeia para o value.
        state.answers[c.chave] = mapSelectValue(field, c.valor)
        await applyAnswerToLead(leadId, field, state.answers).catch(() => {})
        salvos.push(c.chave)
      }
      return JSON.stringify({ ok: true, salvos })
    }

    if (name === 'rotear_setor') {
      // Trava: só encaminha ao setor (atendimento humano) depois de coletar e
      // salvar os dados de contato do lead no CRM.
      const missing = await missingContactData(leadId, form)
      if (missing.length) {
        return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos',
          instrucao: `Antes de encaminhar o lead para o atendimento humano, peça e salve estes dados (chame salvar_dados): ${missing.join(', ')}. Faça isso de forma natural, uma pergunta por vez. Só depois chame rotear_setor novamente.` })
      }
      // Reusa o roteamento por opção de menu do form (option.route): move funil/etapa
      // e (re)atribui a equipe/operador. Lê o menu de triagem (campo select cujas
      // opções têm `route`) dinamicamente — genérico, não hardcoded por tenant.
      const routeField = fields.find((f: any) => f?.type === 'select' && Array.isArray(f.options) && f.options.some((o: any) => o?.route))
      if (!routeField) return JSON.stringify({ ok: false, erro: 'Sem roteamento por setor configurado.' })
      const value = mapSelectValue(routeField, String(input?.setor || ''))
      const opt = routeField.options.find((o: any) => String(o.value) === String(value))
      if (!opt?.route) return JSON.stringify({ ok: false, erro: 'Setor não reconhecido.', instrucao: 'Continue a conversa normalmente e tente identificar melhor o que o lead procura.' })
      // Persiste a escolha p/ a qualificação determinística usar o value da opção.
      state.answers[routeField.key] = opt.value
      await applyAnswerToLead(leadId, routeField, state.answers).catch(() => {})
      const route = opt.route
      if (route.funnelId != null && route.stageKey) {
        await moveLeadStage(leadId, route.funnelId, route.stageKey, 'chatbot', { forwardOnly: false }).catch(() => {})
      }
      if (route.teamId != null) {
        const userId = await pickOperatorForTeam(route.teamId).catch(() => null)
        await prisma.lead.update({ where: { id: leadId }, data: { teamId: route.teamId, assignedUserId: userId, assignedAt: new Date() } }).catch(() => {})
      }
      logEvent({ leadId, type: EVENT_TYPES.ROUTING_RULE_MATCHED, category: 'lifecycle', title: `Jornada IA: encaminhado para ${stripTags(opt.label) || route.stageKey}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead', metadata: { teamId: route.teamId, funnelId: route.funnelId, stageKey: route.stageKey } })
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
      const schedField = fields.find((f) => f?.type === 'scheduling')
      const slug = schedField?.meetingSlug
      if (!slug) return JSON.stringify({ ok: false, erro: 'Agendamento não configurado neste formulário.' })
      const mt = await getActiveMeetingType(slug)
      if (!mt) return JSON.stringify({ ok: false, erro: 'Tipo de reunião indisponível.' })
      const days = await getMeetingTypeSlots(mt, {}).catch(() => [] as any[])
      const out: Array<{ startAt: string; label: string }> = []
      for (const day of (days as any[])) {
        for (const sl of (day.slots || [])) {
          if (out.length >= 12) break
          const dd = String(day.date).slice(8, 10) + '/' + String(day.date).slice(5, 7)
          out.push({ startAt: sl.startAt, label: `${WD[day.weekday] || ''} ${dd} ${sl.label}`.trim() })
        }
        if (out.length >= 12) break
      }
      if (!out.length) return JSON.stringify({ ok: false, erro: 'Sem horários disponíveis no momento.' })

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
          payload: { meetingSlug: slug, offered: out.length },
          timestamp: new Date(),
        })).catch(() => {})
      return JSON.stringify({ ok: true, horarios: out })
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
      return JSON.stringify({ ok: true, quando: when, instrucao: 'Horário reservado. O sistema JÁ enviou ao lead, logo em seguida, uma mensagem com o link da reunião e o botão "Confirmar reunião". Diga UMA frase curta e calorosa pedindo para ele CONFIRMAR a presença tocando no botão "Confirmar reunião" acima. NÃO diga que já está confirmado nem inclua link — a confirmação só acontece quando ele toca no botão.' })
    }

    if (name === 'encerrar') {
      state.phase = input?.qualificado === false ? 'disqualified' : 'done'
      return JSON.stringify({ ok: true })
    }

    if (name === 'transferir_humano') {
      // Mesma trava: captura os dados de contato antes de passar para o humano.
      const missing = await missingContactData(leadId, form)
      if (missing.length) {
        return JSON.stringify({ ok: false, erro: 'Dados de contato incompletos',
          instrucao: `Antes de transferir para um atendente, peça e salve estes dados (chame salvar_dados): ${missing.join(', ')}. Uma pergunta por vez. Só depois chame transferir_humano novamente.` })
      }
      // Já avisou antes e o lead continuou falando: não repete o aviso nem trata como
      // nova transferência — o operador entra quando entrar (aí `_botPaused` cala o bot).
      if (state.phase === 'handoff') {
        return JSON.stringify({ ok: true, ja_transferido: true,
          instrucao: 'Você já avisou que alguém do time vai continuar. NÃO repita o aviso e não diga que vai transferir de novo: siga atendendo a pessoa normalmente enquanto o time não entra.' })
      }
      state.phase = 'handoff'
      logEvent({ leadId, type: EVENT_TYPES.DIAGNOSIS_COMPLETED, category: 'lifecycle', title: `Jornada IA: transferido p/ humano${input?.motivo ? ' — ' + String(input.motivo).slice(0, 80) : ''}`, channel: 'whatsapp', source: 'chatbot', actorType: 'lead' })
      return JSON.stringify({ ok: true, instrucao: 'Avise que vai chamar um atendente e finalize.' })
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
// `text` no turno de ferramentas = o que o modelo escreveu JUNTO da chamada
// (saudação, acolhimento). Antes era descartado, e o lead recebia só a mensagem
// seguinte — que começava no meio do assunto, porque o modelo já considerava a
// abertura como dita. Ver o envio nos loops abaixo.
type LlmTurn = { kind: 'text'; text: string } | { kind: 'tools'; calls: Array<{ id: string; name: string; input: any }>; assistant: any; text: string }

async function getSetting(key: string): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null)
  return s ? String(s.value).replace(/^"|"$/g, '') : null
}

async function anthropicTurn(system: string, messages: LlmMsg[]): Promise<LlmTurn> {
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
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages,
    }),
  }, LLM_TIMEOUT_MS)
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  const content = data.content || []
  const calls = content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, name: b.name, input: b.input }))
  const text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
  if (calls.length) return { kind: 'tools', calls, assistant: content, text }
  return { kind: 'text', text }
}

async function openaiTurn(system: string, messages: LlmMsg[]): Promise<LlmTurn> {
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
      else oaMsgs.push({ role: 'user', content: m.content.map((b: any) => b.text || '').join('') })
    }
  }
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, max_tokens: 1500, messages: oaMsgs,
      tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
  }, LLM_TIMEOUT_MS)
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
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

export async function llmTurn(system: string, messages: LlmMsg[]): Promise<LlmTurn> {
  const primary = await getPrimaryProvider()
  try {
    return primary === 'openai' ? await openaiTurn(system, messages) : await anthropicTurn(system, messages)
  } catch (e) {
    // Fallback para o outro provider.
    try { return primary === 'openai' ? await anthropicTurn(system, messages) : await openaiTurn(system, messages) }
    catch { throw e }
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
  // Conexão Cloud API por onde a mensagem entrou. A janela de 24h da Meta é
  // POR NÚMERO e quem consulta o estado dela filtra por esta coluna: gravar
  // `provider: 'cloud_api'` sem dizer QUAL conexão faz a janela parecer
  // fechada com o contato acabando de escrever.
  cloudApiConnectionId?: number | null,
): Promise<void> {
  const prev = locks.get(phone) ?? Promise.resolve()
  const run = prev.then(() =>
    _process(phone, text, app, messageId, sendFn, provider, originData, chatbotId, instanceName, chatbot, form, sendInteractiveFn, promoteFunnelId, promoteStageKey, contactName, cloudApiConnectionId)
      .catch((e) => app.log.error(`[aiJourney] erro: ${e?.stack || e}`)),
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
  cloudApiConnectionId?: number | null,
): Promise<void> {
  if (!form || !Array.isArray(form.fields)) { app.log.warn('[aiJourney] form sem fields'); return }
  const attendantName = chatbot?.name || 'Atendimento'

  if (messageId) {
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
  }
  const saveIncoming = async (leadId: number, body: string) => {
    await prisma.message.create({ data: {
      leadId, fromMe: false, body, mediaType: 'text', provider,
      ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
      ...(provider === 'cloud_api' && cloudApiConnectionId ? { cloudApiConnectionId } : {}),
      senderName: body ? body.slice(0, 60) : phone, externalId: messageId || null, timestamp: new Date(),
    } }).catch((e) => app.log.warn(`[aiJourney] save in: ${e}`))
    await prisma.lead.update({ where: { id: leadId }, data: { unreadMessages: { increment: 1 }, lastMessageAt: new Date() } }).catch(() => {})
  }
  const send = async (leadId: number, body: string, options: string[]) => {
    if (provider === 'cloud_api' && sendInteractiveFn && options.length) {
      const choices: Choice[] = options.map((o, i) => ({ id: `opt_${i}`, title: o.slice(0, 24) }))
      try {
        const r = await sendInteractiveFn(phone, buildChoices(body, choices))
        await saveOutgoing(leadId, choicesToText(body, choices), r.messageId)
        return
      } catch (e: any) { app.log.warn(`[aiJourney] interactive fallback: ${e?.message || e}`) }
    }
    const full = options.length ? `${body}\n\n${options.map((o, i) => `${i + 1}) ${o}`).join('\n')}` : body
    const r = await sendFn(phone, full)
    await saveOutgoing(leadId, full, r.messageId)
  }

  // ── Lead + estado ──
  let lead = await prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' } })
  const fd: any = (lead?.formData as any) || {}
  let state: AiState | null = fd._aiJourney || null

  const cname = (contactName || '').trim()
  if (!lead || !state) {
    let leadId = lead?.id ?? null
    if (!leadId) {
      const body = { ctwaClid: originData?.ctwaClid ?? null, originType: originData?.originType ?? null, utmSource: originData?.utmSource ?? null, gclid: originData?.gclid ?? null }
      // Nome do perfil do WhatsApp já vem na Cloud API → nasce no lead (sem a IA perguntar).
      const created = await createLeadFromForm(form, form.fields, cname ? { nome: cname } : {}, body, instanceName || '', null,
        promoteFunnelId ? { funnelId: promoteFunnelId, stageKey: promoteStageKey ?? null } : undefined, {
        channel: 'whatsapp', leadSource: 'whatsapp', chatbotId: chatbotId ?? null,
        routing: { source: 'whatsapp', chatbotId: chatbotId ?? null, instanceName: instanceName ?? null },
        forceWhatsapp: phone, qualificationSource: 'form',
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
    if (!lead?.whatsapp) { await prisma.lead.update({ where: { id: leadId }, data: { whatsapp: phone } }).catch(() => {}); if (lead) lead.whatsapp = phone }
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

  // Conversa encerrada → não reabre o roteiro (pós-atendimento humano).
  if (lead?.completed || state.phase === 'done' || state.phase === 'disqualified') {
    await saveIncoming(leadId, text)
    if (chatbot?.postChatAi) {
      const { postJourneyAiReply } = await import('./chatbotFlow.js')
      await postJourneyAiReply({ lead, text, phone, sendFn, provider, instanceName, chatbot, app, cloudApiConnectionId }).catch((e: any) => app.log.warn(`[aiJourney] postChatAi: ${e?.message || e}`))
    }
    return
  }

  await saveIncoming(leadId, text)

  // ── Histórico p/ o LLM (mensagens anteriores do lead) ──
  const hist = await prisma.message.findMany({
    where: { leadId, isInternal: false }, orderBy: { id: 'desc' }, take: HISTORY_LIMIT,
    select: { fromMe: true, body: true },
  })
  const messages: LlmMsg[] = hist.reverse()
    .filter((m) => (m.body || '').trim())
    .map((m) => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }))
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: text })
  }

  const catalogSummary = await getCatalogSummary()
  // Horário de atendimento humano (Cadastros › Atendimento) — o bot precisa dele
  // para responder "quando vocês respondem?" com o que a empresa cadastrou.
  const bhText = await (await import('./businessHours.js')).getConfiguredBusinessHours().catch(() => null)
  const system = buildSystemPrompt(chatbot, form, lead, state, catalogSummary, bhText)

  // ── Loop de orquestração: IA pede ação → servidor executa → devolve → repete ──
  // Tudo com teto de tempo: nenhuma chamada (LLM ou ferramenta) pode pendurar o turno
  // e congelar a conversa (o lock por telefone). O lead SEMPRE recebe uma resposta.
  const startedAt = Date.now()
  let replied = false
  let failed = false
  for (let i = 0; i < MAX_TOOL_ITERS; i++) {
    if (Date.now() - startedAt > TURN_BUDGET_MS) { app.log.warn('[aiJourney] orçamento do turno esgotado'); failed = true; break }
    let turn: LlmTurn
    try { turn = await llmTurn(system, messages) }
    catch (e: any) { app.log.error(`[aiJourney] LLM: ${e?.message || e}`); failed = true; break }

    if (turn.kind === 'text') {
      const { text: out, options } = extractOptions(turn.text)
      if (out) { await send(leadId, out, options).catch(() => {}); replied = true }
      else failed = true
      break
    }
    // Texto escrito JUNTO da chamada de ferramenta: entrega ao lead antes de executar
    // as ferramentas. Sem isso o modelo "acha" que já cumprimentou (o bloco está no
    // histórico que ele recebe de volta) e a mensagem seguinte começa no meio do assunto.
    if (turn.text.trim()) {
      const { text: pre, options: preOpts } = extractOptions(turn.text)
      if (pre) { await send(leadId, pre, preOpts).catch(() => {}); replied = true }
    }

    // tool_use: executa as ferramentas pedidas (cada uma com timeout) e devolve os resultados.
    messages.push({ role: 'assistant', content: turn.assistant })
    const results: any[] = []
    for (const call of turn.calls) {
      const out = await Promise.race([
        executeTool(call.name, call.input, { leadId, phone, form, chatbot, state, promoteFunnelId: promoteFunnelId ?? null, promoteStageKey: promoteStageKey ?? null, app }),
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
      await send(leadId, 'Obrigado pelas suas respostas! No momento não seguimos com o agendamento, mas qualquer novidade a nossa equipe entra em contato. 😊', []).catch(() => {})
    } else if (failed) {
      app.log.warn('[aiJourney] sem resposta final — enviando fallback')
      await send(leadId, 'Tive uma instabilidade aqui 😕 Pode repetir a sua última mensagem, por favor?', []).catch(() => {})
    } else {
      app.log.warn('[aiJourney] loop sem resposta final (limite de iterações)')
      await send(leadId, 'Deixa eu verificar isso e já te respondo. 🙂', []).catch(() => {})
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
