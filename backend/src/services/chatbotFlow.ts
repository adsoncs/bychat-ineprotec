// src/services/chatbotFlow.ts
// Fluxo de chatbot de diagnostico — extraido de whatsapp.ts
// Funciona com qualquer provider (Evolution API ou Cloud API Oficial)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { semFichaEmDobro, chaveDoContato } from './contactIdentity.js'
import { getBranding } from '../lib/branding.js'
import { notifyNewLead } from './notify.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { onChatbotComplete, getScoringConfig } from './scoring.js'
import { generateUid } from './dedup.js'
import { saveLeadOrigin, type OriginData } from './originDetection.js'
import { resolveDefaultTeamId, resolveRoutingFromContext } from './teamRouting.js'
import { buildChoices, choicesToText, type Choice } from '../lib/waInteractive.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel } from '../lib/aiKeys.js'
import { linhaDoLink } from '../lib/appUrl.js'

// Protocolo de opções clicáveis: injetado no system prompt só quando o canal é
// Cloud API (botões nativos). O modelo termina a mensagem com [[OPTIONS: a | b | c]]
// quando a resposta é uma escolha entre poucas alternativas fixas.
const OPTIONS_PROTOCOL = `

## Opções clicáveis (WhatsApp)
Quando a sua pergunta tiver como resposta uma escolha entre poucas alternativas fixas (no máximo 10), ofereça-as como opções clicáveis. Para isso, termine a mensagem com UMA única linha exatamente neste formato:
[[OPTIONS: Texto 1 | Texto 2 | Texto 3]]
Regras: no máximo 10 opções; cada opção com no máximo 20 caracteres; use só quando as alternativas forem realmente fixas (ex.: Sim/Não, faixas de orçamento, categorias). NUNCA use para perguntas abertas (nome, e-mail, telefone). Escreva a pergunta normalmente acima do marcador e não repita as opções no corpo do texto.`

// Extrai o marcador [[OPTIONS: ...]] da resposta da IA. Retorna o texto limpo
// (sem o marcador) e as opções como Choice[]. Sem marcador → choices vazio.
function parseAiOptions(raw: string): { text: string; choices: Choice[] } {
  const m = /\[\[\s*OPTIONS:(.+?)\]\]/is.exec(raw || '')
  if (!m) return { text: (raw || '').trim(), choices: [] }
  const text = (raw || '').replace(m[0], '').trim()
  const parts = String(m[1]).split('|').map((s) => s.trim()).filter(Boolean).slice(0, 10)
  const choices: Choice[] = parts.map((title, i) => ({ id: `opt_${i}`, title }))
  return { text, choices }
}

// ─── Types ──────────────────────────────────────────────

export type SendFn = (phone: string, text: string) => Promise<{ messageId: string | null }>
// Envio de mensagem interativa nativa (botões/lista). Injetado só na Cloud API;
// na Evolution é undefined → motor cai no texto numerado.
export type SendInteractiveFn = (phone: string, interactive: any) => Promise<{ messageId: string | null }>
export type ProviderType = 'evolution' | 'cloud_api'

// ─── Constants ──────────────────────────────────────────

function buildChatSystemPrompt(brandName: string): string {
  return `Você é a IA assistente da ${brandName}. Você está conduzindo um diagnóstico gratuito por WhatsApp.

REGRA PRINCIPAL: FAÇA APENAS UMA PERGUNTA POR MENSAGEM. Nunca faça duas ou mais perguntas na mesma mensagem. Espere a resposta antes de perguntar a próxima. Isso é extremamente importante.

REGRAS DE COMPORTAMENTO:
- Sempre responda em português do Brasil
- Seja calorosa mas profissional, sem ser excessivamente informal
- UMA PERGUNTA POR VEZ — isso é inegociável
- Ao receber a resposta, confirme brevemente (1 frase curta) e faça a próxima pergunta
- Se o usuário der múltiplas informações numa só resposta, aceite todas e pule para a próxima pergunta pendente
- Use emojis com moderação (1 por mensagem no máximo)
- Se a resposta for vaga, peça gentilmente para ser mais específico
- Mantenha respostas curtas (2-3 frases no máximo)
- IMPORTANTE: Formate suas respostas de forma simples, sem markdown complexo. Use apenas *negrito* quando necessário.

SEQUÊNCIA EXATA DE PERGUNTAS (siga esta ordem rigorosamente, uma por vez):

1. Cumprimento + pergunte o NOME da pessoa
2. Nome da EMPRESA
3. E-MAIL para envio do diagnóstico
4. SEGMENTO da empresa (dê as opções: Varejo/E-commerce, Serviços B2B, Serviços B2C, Saúde e Bem-estar, Educação, Imóveis, Tecnologia/SaaS, Alimentação, Indústria, Outro)
5. CIDADE/Estado
6. TAMANHO da empresa (Só você/autônomo, Micro até 10 pessoas, Pequena 11-30, Média 30+)
7. TEMPO de mercado (Menos de 1 ano, 1 a 3 anos, 3 a 7 anos, Mais de 7 anos)
8. Qual o MAIOR DESAFIO da empresa hoje? (texto livre)
9. Como define o MOMENTO da empresa? (Crescendo mas desestruturado, Estagnada, Faturamento em queda, Em início)
10. Qual a META principal para os próximos 3-6 meses?
11. Onde sente MAIS DIFICULDADE? (pode citar vários: Marketing, Vendas, Posicionamento, Processo, Tecnologia, Dados, Equipe, Financeiro)
12. INVESTE em marketing? (Tráfego pago, Orgânico, Os dois, Não investe)
13. Quais CANAIS usa? (Instagram, Google Ads, Meta Ads, YouTube, TikTok, E-mail, WhatsApp, Indicação)
14. O que JÁ TROUXE RESULTADO em marketing?
15. O que NÃO FUNCIONOU?
16. Tem DIFICULDADE em gerar leads qualificados? (Grande dificuldade, Um pouco, Não mas não converto, Não está bem)
17. Possui SITE ou landing page? (Sim bem estruturado, Sim mas fraco, Em construção, Não possui)
18. Produz CRIATIVOS e conteúdo com frequência? (Sim consistente, Esporadicamente, Raramente, Não)
19. Qual o principal PRODUTO/SERVIÇO?
20. Qual o DIFERENCIAL percebido pelo mercado?
21. O mercado ENTENDE seu diferencial? (Sim claramente, Parcialmente, Não há confusão, Não sei)
22. Tem PROVA SOCIAL (cases, depoimentos)? (Muitos e fortes, Poucos/fracos, Construindo, Não tenho)
23. Como avalia a FORÇA DA OFERTA principal? (Muito forte, Boa mas pode melhorar, Fraca/confusa, Reformulando)
24. Existe UPSELL ou produto complementar? (Sim estruturado, Sim informal, Não mas quero, Não)
25. Como os leads são ATENDIDOS hoje? (texto livre)
26. Possui TIME COMERCIAL? (Sim estruturado, Sim informal, Sou eu mesmo, Não)
27. Possui FUNIL de vendas definido? (Sim documentado, Sim informal, Parcialmente, Não)
28. Sente que PERDE VENDAS por falta de processo? (Sim muito, Às vezes, Raramente, Não)
29. Usa CRM? (Sim ativo, Sim pouco usado, Planilha apenas, Nada)
30. ACOMPANHA os números do negócio? (Sim tenho controle, Sim básico, Pouco, Não)
31. Quais MÉTRICAS acompanha? (Faturamento, CAC, CPL, Taxa de conversão, Ticket médio, Churn, ROAS/ROI, Nenhum)
32. Sente FALTA DE CLAREZA nos dados? (Sim muito, Um pouco, Não tenho clareza, Não uso dados)
33. Quais FERRAMENTAS usa? (Planilhas, Dashboards, CRM, ERP, Automações, Nenhuma)
34. Algum PROBLEMA OPERACIONAL que poderia ser resolvido com tecnologia?
35. Consegue PRODUZIR VÍDEOS e conteúdo? (Sim com frequência, Sim com dificuldade, Raramente, Não)
36. Tem pessoa interna para APOIAR MARKETING? (Sim dedicado, Sim parcialmente, Faço tudo eu, Não)
37. Tem CAPACIDADE para atender mais demanda? (Sim fácil, Sim com esforço, No limite, Não)
38. ORÇAMENTO disponível para crescimento? (Tenho orçamento, Limitado, Precisa provar ROI, Sem orçamento)
39. Qual FAIXA DE INVESTIMENTO mensal em marketing? (Sem orçamento, Até R$1.000, R$1.000-2.500, R$2.500-5.000, R$5.000-10.000, R$10.000-20.000, Acima de R$20.000)

Após a pergunta 39, agradeça e diga que o diagnóstico está sendo gerado e que em instantes ele receberá o resultado.

IMPORTANTE:
- Se o usuário responder várias coisas de uma vez, aceite e pule para a próxima pergunta pendente
- Campos com * são obrigatórios — se o usuário pular, insista gentilmente
- Adapte linguagem natural para os valores internos`
}

const EXTRACTION_PROMPT = `Analise a conversa abaixo e extraia os dados estruturados do diagnóstico. Retorne APENAS JSON válido (sem markdown, sem backticks).

CAMPOS E VALORES POSSÍVEIS:

Etapa 0: nome (string), empresa (string), whatsapp (string), email (string), segmento (Varejo/E-commerce|Serviços B2B|Serviços B2C|Saúde e Bem-estar|Educação|Imóveis|Tecnologia/SaaS|Alimentação|Indústria|Outro), cidade (string), tamanho (solopreneur|micro|pequena|media), tempo (menos1|1a3|3a7|mais7)

Etapa 1: desafio (string), momento (crescendo|estagnada|caindo|inicio), meta (string), dificuldades (array de: marketing|vendas|posicionamento|processo|tecnologia|dados|equipe|financeiro)

Etapa 2: investe_mkt (sim-pago|sim-organico|sim-ambos|nao), canais (array de: instagram|google|meta|youtube|tiktok|email|whatsapp|indicacao), resultado_positivo (string), resultado_negativo (string), dificuldade_leads (sim-muito|sim-pouco|nao-mas|nao), tem_site (sim-bom|sim-fraco|construindo|nao), tem_criativos (sim-consistente|sim-esporadico|raramente|nao)

Etapa 3: produto (string), diferencial (string), mercado_entende (sim|parcialmente|nao|nao-sei), prova_social (sim-forte|sim-fraca|construindo|nao), forca_oferta (muito-forte|boa|fraca|reformulando), upsell (sim-estruturado|sim-informal|nao-mas-quero|nao)

Etapa 4: atendimento (string), time_comercial (sim-estruturado|sim-informal|apenas-eu|nao), funil (sim-documentado|sim-informal|parcial|nao), perde_vendas (sim-muito|sim-pouco|raramente|nao), usa_crm (sim-ativo|sim-pouco|planilha|nada)

Etapa 5: acompanha_numeros (sim-bem|sim-basico|pouco|nao), numeros_conhece (array de: faturamento|cac|cpl|conversao|ticket|churn|roas|nenhum), falta_clareza (sim-muito|sim-pouco|nao|nao-uso), usa_ferramentas (array de: planilha|dashboard|crm|erp|automacao|nenhuma), problemas_op (string)

Etapa 6: produz_video (sim-frequencia|sim-dificuldade|raramente|nao), apoio_interno (sim-dedicado|sim-parcial|tudo-eu|nao), capacidade (sim-facilidade|sim-esforco|no-limite|nao), orcamento (disponivel|limitado|precisa-roi|nao-tem), faixa_investimento (0|1|2|3|4|5|6)

REGRAS:
- Só inclua campos que foram CLARAMENTE mencionados na conversa
- Use EXATAMENTE os valores internos listados acima
- Para campos de texto livre, extraia o que o usuário disse
- Para arrays, inclua todos os itens mencionados
- currentStep: número da etapa atual (0-6) baseado nos campos já preenchidos
- completed: true APENAS se TODOS os campos obrigatórios de TODAS as 7 etapas foram preenchidos

Retorne exatamente este formato:
{"formData":{...campos extraídos...},"currentStep":N,"completed":false}`

// ─── AI Helpers ─────────────────────────────────────────

async function callAnthropicChat(systemPrompt: string, messages: Array<{role: string, content: string}>): Promise<string> {
  // Chave via Configurações › APIs (fallback .env) — ver lib/aiKeys.
  const apiKey = await getAnthropicKey()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: await getAnthropicModel(),
      max_tokens: 800,
      system: systemPrompt,
      messages
    })
  })

  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`)
  const data = await response.json() as any
  return data.content?.[0]?.text || ''
}

async function callOpenAIChat(systemPrompt: string, messages: Array<{role: string, content: string}>): Promise<string> {
  // Chave via Configurações › APIs (fallback .env) — ver lib/aiKeys.
  const apiKey = await getOpenAiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: await getOpenAiModel(),
      max_tokens: 800,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
    })
  })

  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`)
  const data = await response.json() as any
  return data.choices?.[0]?.message?.content || ''
}

export async function chatWithAI(systemPrompt: string, messages: Array<{role: string, content: string}>): Promise<string> {
  try {
    return await callAnthropicChat(systemPrompt, messages)
  } catch (errA) {
    console.warn(`Anthropic chat falhou (${errA}), tentando OpenAI...`)
    return await callOpenAIChat(systemPrompt, messages)
  }
}

async function extractDataWithAI(conversation: Array<{role: string, content: string}>, customPrompt?: string): Promise<any> {
  const prompt = customPrompt || EXTRACTION_PROMPT
  const convoText = conversation.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join('\n')
  const extractionMessages = [{ role: 'user', content: `CONVERSA:\n${convoText}\n\nExtraia os dados estruturados.` }]

  let txt = ''
  try {
    txt = await callAnthropicChat(prompt, extractionMessages as any)
  } catch (errA) {
    console.warn(`Anthropic extraction falhou (${errA}), tentando OpenAI...`)
    txt = await callOpenAIChat(prompt, extractionMessages as any)
  }

  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

// ─── Atendimento por IA pós-jornada (scripted concluído/desqualificado) ──
// O lead já terminou o roteiro e voltou a falar; a IA responde com o contexto do
// desfecho (sem recomeçar o formulário). Histórico próprio em formData._postChat.
export async function postJourneyAiReply(params: {
  lead: any; text: string; phone: string; sendFn: SendFn; provider: ProviderType;
  instanceName?: string | null; chatbot: any; app: FastifyInstance;
}): Promise<void> {
  const { lead, text, phone, sendFn, provider, instanceName, chatbot, app } = params
  try {
    const brand = await getBranding()
    const nome = lead?.nome || ''
    // Desfecho do roteiro → contexto para a IA.
    let outcome = 'já concluiu o atendimento inicial pelo formulário'
    const booking = await prisma.booking.findFirst({ where: { leadId: lead.id, status: 'scheduled' }, orderBy: { startAt: 'desc' }, select: { startAt: true } }).catch(() => null)
    const sc: any = (lead.formData as any)?._script
    if (booking) {
      const d = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(booking.startAt)
      outcome = `já agendou uma reunião com a equipe para ${d}`
    } else if (sc?.phase === 'disqualified') {
      outcome = 'concluiu o formulário, mas não seguiu para o agendamento (perfil fora do critério atual)'
    }
    const base = (chatbot?.postChatPrompt && String(chatbot.postChatPrompt).trim())
      || chatbot?.systemPrompt || `Você é um atendente da ${brand.brandName}.`
    const systemPrompt = String(base)
      .replace(/\{\{attendant_name\}\}/g, chatbot?.name || 'Atendimento')
      .replace(/\{\{brand_name\}\}/g, brand.brandName)
      + `\n\n## Contexto desta conversa\nVocê está no WhatsApp com ${nome || 'o lead'}, que ${outcome}. NÃO recomece o formulário nem repita perguntas de cadastro/qualificação. Reconheça o que ele já fez, seja cordial e objetivo, e ajude com dúvidas dentro do contexto da empresa e dos serviços. Se ele quiser remarcar, cancelar ou falar com um humano, oriente com gentileza.`

    const fd: any = (lead.formData as any) || {}
    const history: Array<{ role: string; content: string }> = Array.isArray(fd._postChat) ? fd._postChat : []
    history.push({ role: 'user', content: text })
    const reply = (await chatWithAI(systemPrompt, history.slice(-20))) || 'Certo! Como posso ajudar?'
    history.push({ role: 'assistant', content: reply })

    const r = await sendFn(phone, reply)
    await prisma.message.create({ data: {
      leadId: lead.id, fromMe: true, body: reply, mediaType: 'text', provider,
      ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
      senderName: chatbot?.name || 'IA', isInternal: false, externalId: r.messageId, ack: r.messageId ? 1 : 0, timestamp: new Date(),
    } }).catch(() => {})
    await prisma.lead.update({ where: { id: lead.id }, data: { formData: { ...fd, _postChat: history.slice(-20) }, lastMessageAt: new Date() } }).catch(() => {})
  } catch (e: any) {
    app.log.warn(`[postChatAi] ${e?.message || e}`)
  }
}

// ─── Main Chatbot Flow ──────────────────────────────────

/**
 * Processa mensagem do chatbot de diagnostico.
 * Funciona com qualquer provider (Evolution API ou Cloud API).
 *
 * @param phone - Numero do WhatsApp (formato internacional sem +)
 * @param text - Texto da mensagem recebida
 * @param app - Instancia Fastify (para logging)
 * @param messageId - ID externo da mensagem (para tracking)
 * @param sendFn - Funcao para enviar resposta (injetada pelo provider)
 * @param provider - Tipo do provider ('evolution' | 'cloud_api')
 */
/**
 * Resolve o nome do atendente conectado na instância WhatsApp.
 * Busca via Evolution API o profileName da instância vinculada ao chatbot.
 */
async function getAttendantName(chatbotId: number | null): Promise<string> {
  if (!chatbotId) return ''
  try {
    const instance = await prisma.whatsAppInstance.findFirst({ where: { chatbotId, active: true } })
    if (!instance) return ''

    const settingRows = await prisma.setting.findMany({
      where: { key: { in: ['whatsapp.evolution_url', 'whatsapp.evolution_key'] } }
    })
    const cfg: Record<string, string> = {}
    settingRows.forEach(r => { cfg[r.key] = typeof r.value === 'string' ? r.value : String(r.value).replace(/"/g, '') })

    const url = cfg['whatsapp.evolution_url'] || process.env.EVOLUTION_API_URL
    const key = cfg['whatsapp.evolution_key'] || process.env.EVOLUTION_API_KEY
    if (!url || !key) return ''

    const instances = await fetch(`${url}/instance/fetchInstances`, {
      headers: { 'Content-Type': 'application/json', apikey: key },
      signal: AbortSignal.timeout(5000)
    }).then(r => r.json())

    const inst = Array.isArray(instances) ? instances.find((i: any) => i.name === instance.instanceName) : null
    if (!inst) return ''

    const ownerPhone = inst.ownerJid?.split('@')[0] || ''
    if (!ownerPhone) return inst.profileName || ''

    const profile = await fetch(`${url}/chat/fetchProfile/${instance.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ number: ownerPhone }),
      signal: AbortSignal.timeout(5000)
    }).then(r => r.json()).catch(() => null)

    return profile?.name || inst.profileName || ''
  } catch {
    return ''
  }
}

// Gate de ativação do chatbot por palavra-chave. Retorna true se o bot DEVE rodar.
// - triggerMode 'always' (ou sem palavras) → sempre roda (comportamento atual).
// - 'keyword' → só inicia se a mensagem (lead em "cold start") CONTÉM uma das palavras;
//   lead já dentro de um fluxo ativo continua sempre (não re-filtra no meio).
// Quando retorna false, o webhook trata como "sem chatbot" → atendimento humano.
export async function chatbotTriggerAllows(chatbotId: number | null | undefined, phone: string, msgText: string): Promise<boolean> {
  if (!chatbotId) return false
  // Takeover humano: se um operador já respondeu a este lead pelo painel, o bot
  // NUNCA responde (pausa definitiva até devolverem pelas Conversas). Precede
  // o filtro de palavra-chave. Ver services/botTakeover.ts.
  const paused = await prisma.lead.findFirst({
    where: { whatsapp: phone }, orderBy: { createdAt: 'desc' }, select: { formData: true },
  }).catch(() => null)
  if (paused) {
    const { readBotPause } = await import('./botTakeover.js')
    if (readBotPause(paused.formData)) return false
  }
  const cb = await prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { triggerMode: true, triggerKeywords: true } }).catch(() => null)
  if (!cb || cb.triggerMode !== 'keyword') return true
  const kws = (Array.isArray(cb.triggerKeywords) ? cb.triggerKeywords : []).map((k: any) => String(k || '')).filter(Boolean)
  if (!kws.length) return true
  // Lead já em fluxo ativo → não bloqueia (continua a conversa em andamento).
  const lead = await prisma.lead.findFirst({ where: { whatsapp: phone }, orderBy: { createdAt: 'desc' }, select: { completed: true, formData: true } }).catch(() => null)
  const fd: any = lead?.formData || {}
  const aiActive = fd._aiJourney && fd._aiJourney.phase === 'active'
  const scrActive = fd._script && fd._script.phase && !['done', 'disqualified'].includes(fd._script.phase)
  if (!lead?.completed && (aiActive || scrActive)) return true
  // Cold start → exige conter uma palavra-chave (case/acento-insensível).
  const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const t = norm(msgText)
  return kws.some((k) => t.includes(norm(k)))
}

export async function processChatbotMessage(
  phone: string,
  text: string,
  app: FastifyInstance,
  messageId: string | undefined,
  sendFn: SendFn,
  provider: ProviderType,
  originData?: OriginData | null,
  chatbotId?: number | null,
  instanceName?: string | null,
  // Fase 2: botões no motor de IA. sendInteractiveFn só vem na Cloud API; o clique
  // volta como o texto do botão (vira a próxima mensagem do usuário), então não
  // precisamos do id aqui — apenas renderizar as opções como botões na saída.
  sendInteractiveFn?: SendInteractiveFn | null,
  _interactiveReplyId?: string | null,
  // Funil dos leads desta conexão/instância (só com chatbot). Quando setado, o lead
  // do chatbot de IA nasce promovido a este funil/etapa; senão continua cru.
  promoteFunnelId?: number | null,
  promoteStageKey?: string | null,
): Promise<void> {
  // Lista de bloqueio: o motor do chatbot também é chamado por caminhos que não
  // passam pelo webhook (preview, reprocessamento, fila). Barrar aqui garante que
  // o bot não responda nem crie lead para contato bloqueado, com rastro no log.
  {
    const { rejectInboundMessage } = await import('./leadBlocklist.js')
    if (await rejectInboundMessage({ whatsapp: phone }, 'chatbot', text).catch(() => null)) return
  }

  // Carregar chatbot do banco se disponível
  let chatbot: any = null
  if (chatbotId) {
    chatbot = await prisma.chatbot.findUnique({ where: { id: chatbotId } })
  }

  // Resolver nome do atendente conectado
  const attendantName = await getAttendantName(chatbotId || null)

  // Determinar prompts: do chatbot do banco ou hardcoded
  const brand = await getBranding()
  let systemPrompt = chatbot?.systemPrompt
    ? chatbot.systemPrompt.replace(/\{\{attendant_name\}\}/g, attendantName).replace(/\{\{brand_name\}\}/g, brand.brandName)
    : buildChatSystemPrompt(brand.brandName)
  // Botões só na Cloud API → só aí instruímos o modelo a oferecer opções clicáveis.
  const canInteractive = provider === 'cloud_api' && !!sendInteractiveFn
  if (canInteractive) systemPrompt += OPTIONS_PROTOCOL
  const extractionPrompt = chatbot?.extractionPrompt || EXTRACTION_PROMPT
  const greetingMsg = chatbot?.greetingMessage
    ? chatbot.greetingMessage.replace(/\{\{attendant_name\}\}/g, attendantName).replace(/\{\{brand_name\}\}/g, brand.brandName)
    : null

  // Busca ou cria lead pelo número de WhatsApp
  let lead = await prisma.lead.findFirst({
    where: {
      whatsapp: phone,
      completed: false
    },
    orderBy: { createdAt: 'desc' }
  })

  const isNew = !lead

  if (!lead) {
    // Criação com exclusividade para este contato: duas mensagens chegando
    // juntas passavam as duas pela busca acima e criavam duas fichas. A tarefa
    // começa procurando de novo — é isso que faz a segunda aproveitar o que a
    // primeira criou.
    const resultado = await semFichaEmDobro(chaveDoContato(phone, instanceName ?? null), async () => {
    const jaExiste = await prisma.lead.findFirst({
      where: { whatsapp: phone, completed: false },
      orderBy: { createdAt: 'desc' },
    })
    // Outra mensagem do mesmo contato ganhou a corrida e já criou a ficha (e já
    // mandou a saudação): esta segue o fluxo normal em vez de saudar de novo.
    if (jaExiste) return { lead: jaExiste, saudou: false }
    // Cria novo lead
    const firstMessage = greetingMsg || `Olá! 👋 Eu sou a assistente virtual da ${brand.brandName}.

Estou aqui para fazer um *diagnóstico gratuito* do seu negócio — o nosso *Raio-X de Growth*.

Em poucos minutos de conversa, vou entender o momento da sua empresa e gerar um relatório completo com scores, pontos fortes e uma recomendação personalizada.

Para começar, qual é o seu *nome*?`

    // Reforma F2: instância dedicada a um agente (ownerUserId) tem prioridade
    // sobre cascata por setor. resolveRoutingFromContext já cobre isso quando
    // motor V2 está ligado. Se V2 off, cai no resolveDefaultTeamId clássico.
    let routedTeamId: number | null = null
    let routedUserId: number | null = null
    const routing = await resolveRoutingFromContext({
      source: 'whatsapp',
      chatbotId: chatbotId ?? null,
      instanceName: instanceName ?? null,
    })
    routedTeamId = routing.teamId
    routedUserId = routing.userId
    if (!routedTeamId && !routedUserId) {
      // Fallback adicional pra tenants com V2 off — preserva comportamento legado.
      routedTeamId = await resolveDefaultTeamId({ chatbotId, instanceName: instanceName ?? null })
    }
    const { deriveLeadOrigin } = await import('../lib/leadOrigin.js')
    // Se originDetection já achou (trackable_link/meta_ctwa/google_ads), usa
    // direto; senão deriva do canal (whatsapp por padrão neste fluxo).
    const originType = (originData?.originType as any) || deriveLeadOrigin({
      source: 'whatsapp',
      channel: 'whatsapp',
      utmSource: originData?.utmSource ?? null,
      ctwaClid: originData?.ctwaClid ?? null,
      gclid: originData?.gclid ?? null,
      trackableLinkId: originData?.trackableLinkId ?? null,
    })
    // Promoção opcional ao funil da conexão/instância (só com chatbot). Sem ele, o
    // lead nasce cru (qualifiedAt null, sem funil) — promover manual via /qualify.
    let promote: any = {}
    if (promoteFunnelId) {
      let stageKey: string | null = promoteStageKey || null
      const se = stageKey ? await prisma.stage.findFirst({ where: { funnelId: promoteFunnelId, key: stageKey, active: true }, select: { key: true } }) : null
      if (!se) {
        const fs = await prisma.stage.findFirst({ where: { funnelId: promoteFunnelId, active: true }, orderBy: { position: 'asc' }, select: { key: true } })
        stageKey = fs?.key || stageKey || 'NOVO'
      }
      promote = { funnelId: promoteFunnelId, status: stageKey, qualifiedAt: new Date(), qualificationSource: 'chatbot' }
    }
    const novo = await prisma.lead.create({
      data: {
        uid: await generateUid(),
        nome: '',
        empresa: '',
        whatsapp: phone,
        email: '',
        formData: {
          _chatMessages: [{ role: 'assistant', content: firstMessage }],
          _source: 'whatsapp'
        },
        scores: {},
        lastStep: 0,
        completed: false,
        lastActivityAt: new Date(),
        source: 'whatsapp',
        originType,
        chatbotId: chatbotId || undefined,
        teamId: routedTeamId,
        assignedUserId: routedUserId,
        assignedAt: routedUserId ? new Date() : null,
        ...promote,
      }
    })

    // Save origin data if detected
    if (originData) {
      saveLeadOrigin(novo.id, originData).catch(e => app.log.warn(`Origin save error: ${e}`))
    }

    logEvent({
      leadId: novo.id,
      type: EVENT_TYPES.LEAD_CREATED,
      category: 'lifecycle',
      title: 'Lead criado via WhatsApp',
      channel: 'whatsapp',
      source: 'webhook',
      actorType: 'lead',
      description: `Novo lead iniciou conversa pelo WhatsApp (${phone})`,
      metadata: { phone, source: 'whatsapp', provider, originType: originData?.originType || 'organic' },
    })

    logEvent({
      leadId: novo.id,
      type: EVENT_TYPES.DIAGNOSIS_STARTED,
      category: 'lifecycle',
      title: 'Diagnóstico iniciado via WhatsApp',
      channel: 'whatsapp',
      source: 'chatbot',
      actorType: 'lead',
    })

    // Envia mensagem de boas-vindas
    const greetResult = await sendFn(phone, firstMessage)
    const greetMsgId = greetResult.messageId

    // Save greeting to Message table
    try {
      await prisma.message.create({
        data: {
          leadId: novo.id,
          fromMe: true,
          body: firstMessage,
          mediaType: 'text',
          provider,
          ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
          senderName: attendantName || 'Beyond AI',
          isInternal: false,
          externalId: greetMsgId,
          ack: greetMsgId ? 1 : 0,
          timestamp: new Date()
        }
      })
      await prisma.lead.update({
        where: { id: novo.id },
        data: { lastMessageAt: new Date() }
      })
    } catch (msgErr) {
      app.log.warn(`Failed to save greeting message: ${msgErr}`)
    }

    return { lead: novo, saudou: true }
    })

    // Saudação enviada = a conversa começou agora; nada mais a fazer com esta
    // mensagem. Se outra requisição criou a ficha antes, seguimos com ela.
    if (resultado.saudou) return
    lead = resultado.lead
  }

  // Lead existente — continua conversa
  const formData = (lead.formData || {}) as any
  const chatMessages: Array<{role: string, content: string}> = formData._chatMessages || []

  // Adiciona mensagem do usuário
  chatMessages.push({ role: 'user', content: text })

  // Gera resposta da IA
  const aiMessages = chatMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  const aiResponseRaw = await chatWithAI(systemPrompt, aiMessages)
  // Separa o texto das opções clicáveis (marcador [[OPTIONS:...]]). O histórico
  // guarda o texto LIMPO (sem o marcador) para não poluir os próximos turnos.
  const { text: aiResponse, choices: aiChoices } = parseAiOptions(aiResponseRaw)
  chatMessages.push({ role: 'assistant', content: aiResponse })

  // Extrai dados estruturados
  let extracted: any = { formData: {}, currentStep: lead.lastStep, completed: false }
  try {
    extracted = await extractDataWithAI(chatMessages, extractionPrompt)
  } catch (extractErr) {
    app.log.warn(`Data extraction failed: ${extractErr}`)
  }

  const extractedFormData = extracted.formData || {}
  const currentStep = extracted.currentStep ?? lead.lastStep
  const isCompleted = extracted.completed === true

  // Merge dados extraídos
  const updatedFormData = {
    ...formData,
    ...extractedFormData,
    _chatMessages: chatMessages,
    _source: 'whatsapp'
  }

  const updateData: any = {
    formData: updatedFormData,
    lastStep: currentStep,
    lastActivityAt: new Date()
  }

  if (extractedFormData.nome) updateData.nome = extractedFormData.nome
  if (extractedFormData.empresa) updateData.empresa = extractedFormData.empresa
  if (extractedFormData.email) updateData.email = extractedFormData.email
  if (extractedFormData.segmento) updateData.segmento = extractedFormData.segmento
  if (extractedFormData.cidade) updateData.cidade = extractedFormData.cidade
  updateData.whatsapp = phone

  // Salvar campos personalizados extraídos
  const standardFields = new Set(['nome', 'empresa', 'email', 'segmento', 'cidade', 'whatsapp', 'tamanho', 'tempo', '_chatMessages', '_source', 'currentStep', 'completed'])
  const customFieldUpdates: Record<string, any> = {}
  for (const [key, value] of Object.entries(extractedFormData)) {
    if (!standardFields.has(key) && value !== undefined && value !== null && value !== '') {
      customFieldUpdates[key] = value
    }
  }
  if (Object.keys(customFieldUpdates).length > 0) {
    const existingCustom = (lead.customFields || {}) as Record<string, any>
    updateData.customFields = { ...existingCustom, ...customFieldUpdates }
  }

  if (isCompleted) {
    try {
      // Salva formData antes de processar
      await prisma.lead.update({ where: { id: lead.id }, data: updateData })

      // Usa o serviço genérico de scoring
      const result = await onChatbotComplete(lead.id, extractedFormData, lead.chatbotId)
      const scores = result.scores
      const config = await getScoringConfig(lead.chatbotId)

      // Save incoming message to Message table (completed path)
      try {
        await prisma.message.create({
          data: {
            leadId: lead.id,
            fromMe: false,
            body: text,
            mediaType: 'text',
            provider,
            ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
            senderName: lead.nome || phone,
            externalId: messageId || null,
            timestamp: new Date()
          }
        })
      } catch (msgErr) {
        app.log.warn(`Failed to save incoming msg (completed): ${msgErr}`)
      }

      // Envia resposta da IA (com opções clicáveis quando houver e o canal permitir).
      const compInteractive = (aiChoices.length && canInteractive) ? buildChoices(aiResponse, aiChoices) : null
      const compOutBody = aiChoices.length ? choicesToText(aiResponse, aiChoices) : aiResponse
      let compAiResult: { messageId: string | null }
      if (compInteractive) {
        try {
          compAiResult = await sendInteractiveFn!(phone, compInteractive)
        } catch (e: any) {
          app.log.warn(`[chatbotFlow] interactive (completed) falhou, fallback texto: ${e?.message || e}`)
          compAiResult = await sendFn(phone, compOutBody)
        }
      } else {
        compAiResult = await sendFn(phone, compOutBody)
      }
      const compAiMsgId = compAiResult.messageId

      // Save AI response to Message table (completed path)
      try {
        await prisma.message.create({
          data: {
            leadId: lead.id,
            fromMe: true,
            body: compOutBody,
            mediaType: 'text',
            provider,
            ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
            senderName: attendantName || 'Beyond AI',
            isInternal: false,
            externalId: compAiMsgId,
            ack: compAiMsgId ? 1 : 0,
            timestamp: new Date()
          }
        })
      } catch (msgErr) {
        app.log.warn(`Failed to save AI response (completed): ${msgErr}`)
      }

      // Update unread + lastMessageAt (completed path)
      try {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            unreadMessages: { increment: 1 },
            lastMessageAt: new Date()
          }
        })
      } catch (updErr) {
        app.log.warn(`Failed to update unread (completed): ${updErr}`)
      }

      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.DIAGNOSIS_COMPLETED,
        category: 'lifecycle',
        title: 'Diagnóstico completo via WhatsApp',
        channel: 'whatsapp',
        source: 'chatbot',
        actorType: 'lead',
        description: `Score: ${scores.geral}/100, Maturidade: ${result.maturity.label}`,
        metadata: { scores, maturidade: result.maturity.label, phone, provider },
      })

      // Envia resultado resumido via WhatsApp (genérico - usa pilares do config)
      const pillarLines = config.pillars
        .map((p: any) => `• ${p.name}: ${scores[p.key] || 0}/100`)
        .join('\n')

      const analysis = result.analysis
      const resultMsg = `📊 *Resultado da sua análise*

*Score Geral:* ${scores.geral}/100
*Classificação:* ${result.maturity.label}

📈 *Scores por pilar:*
${pillarLines}

${analysis?.visaoGeral ? `\n📋 *Visão Geral:*\n${analysis.visaoGeral}` : ''}

${analysis?.prioridade ? `\n🎯 *Prioridade #1:*\n${analysis.prioridade}` : ''}

---
Quer conversar sobre o seu resultado? Estamos à disposição! 💬
${linhaDoLink('🔗 Acesse o resultado completo:', '/')}`

      // Envia o resultado padrão de scoring. Cenários como envio de link de
      // matrícula pré-preenchido foram movidos pra Fluxos (Workflow) — assim
      // mantemos chatbot e módulo educacional desacoplados.
      setTimeout(async () => {
        try { await sendFn(phone, resultMsg) } catch (e) { app.log.error(`Result msg failed: ${e}`) }
      }, 3000)

      // Notifica admin
      try {
        const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } })
        if (updatedLead) await notifyNewLead(updatedLead)
      } catch (notifErr) {
        app.log.warn(`Notification failed: ${notifErr}`)
      }

      return
    } catch (completionErr) {
      app.log.error(`Completion processing error: ${completionErr}`)
      updateData.completed = false
    }
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: updateData
  })

  // Log progresso se mudou de etapa
  if (currentStep > lead.lastStep) {
    logEvent({
      leadId: lead.id,
      type: EVENT_TYPES.DIAGNOSIS_PROGRESS,
      category: 'lifecycle',
      title: `WhatsApp: diagnóstico avançou para etapa ${currentStep}`,
      channel: 'whatsapp',
      source: 'chatbot',
      actorType: 'lead',
      oldValue: String(lead.lastStep),
      newValue: String(currentStep),
    })
  }

  // Save incoming message to Message table
  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: false,
        body: text,
        mediaType: 'text',
        provider,
        ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
        senderName: lead.nome || phone,
        externalId: messageId || null,
        timestamp: new Date()
      }
    })
  } catch (msgErr) {
    app.log.warn(`Failed to save incoming message: ${msgErr}`)
  }

  // Envia resposta da IA via WhatsApp. Se a IA ofereceu opções e o canal é Cloud
  // API, manda como botões/lista nativos; senão (ou se falhar) cai no texto. O log
  // sempre guarda a versão textual (operador vê o conteúdo igual).
  const interactive = (aiChoices.length && canInteractive) ? buildChoices(aiResponse, aiChoices) : null
  const outBody = aiChoices.length ? choicesToText(aiResponse, aiChoices) : aiResponse
  let aiSendResult: { messageId: string | null }
  if (interactive) {
    try {
      aiSendResult = await sendInteractiveFn!(phone, interactive)
    } catch (e: any) {
      app.log.warn(`[chatbotFlow] interactive falhou, fallback texto: ${e?.message || e}`)
      aiSendResult = await sendFn(phone, outBody)
    }
  } else {
    aiSendResult = await sendFn(phone, outBody)
  }
  const aiMsgId = aiSendResult.messageId

  // Save AI response to Message table
  try {
    await prisma.message.create({
      data: {
        leadId: lead.id,
        fromMe: true,
        body: outBody,
        mediaType: 'text',
        provider,
        ...(provider === 'evolution' && instanceName ? { evolutionInstance: instanceName } : {}),
        senderName: attendantName || 'Beyond AI',
        isInternal: false,
        externalId: aiMsgId,
        ack: aiMsgId ? 1 : 0,
        timestamp: new Date()
      }
    })
  } catch (msgErr) {
    app.log.warn(`Failed to save AI response message: ${msgErr}`)
  }

  // Increment unread and update lastMessageAt
  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        unreadMessages: { increment: 1 },
        lastMessageAt: new Date()
      }
    })
  } catch (updErr) {
    app.log.warn(`Failed to update unread count: ${updErr}`)
  }
}
