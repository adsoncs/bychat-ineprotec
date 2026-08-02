// src/services/scoring.ts
// Serviço genérico de scoring, análise e sentimento para leads de qualquer chatbot

import { prisma } from '../lib/prisma.js'
import { logEvent, EVENT_TYPES } from './leadHistory.js'
import { getAnthropicKey, getOpenAiKey, getAnthropicModel, getOpenAiModel } from '../lib/aiKeys.js'

// ─── Tipos ────────────────────────────────────

interface ScoringRule {
  field: string        // campo do formData
  value: string        // valor esperado (ou "*" para qualquer, "includes:X" para arrays)
  points: number       // pontos a adicionar (pode ser negativo)
}

interface ScoringPillar {
  key: string          // ex: "mkt", "vendas", "atendimento"
  name: string         // ex: "Marketing", "Vendas"
  weight: number       // peso 0-1 (soma dos pesos deve ser 1)
  base: number         // score base (ex: 50)
  rules: ScoringRule[] // regras de ajuste
}

interface ScoringThreshold {
  max: number          // score máximo para esta faixa
  label: string        // ex: "Baixo", "Médio", "Alto"
  color: string        // ex: "#ea4335", "#fbbc04", "#34a853"
}

interface ScoringConfig {
  pillars: ScoringPillar[]
  thresholds: ScoringThreshold[]
}

// ─── Score padrão do ByChat (legado) ──────────

const LEGACY_BYCHAT_CONFIG: ScoringConfig = {
  pillars: [
    {
      key: 'mkt', name: 'Marketing', weight: 0.25, base: 50,
      rules: [
        { field: 'investe_mkt', value: 'sim-ambos', points: 20 },
        { field: 'investe_mkt', value: 'sim-pago', points: 10 },
        { field: 'investe_mkt', value: 'sim-organico', points: 10 },
        { field: 'investe_mkt', value: 'nao', points: -15 },
        { field: 'tem_site', value: 'sim-bom', points: 15 },
        { field: 'tem_site', value: 'nao', points: -12 },
        { field: 'tem_criativos', value: 'sim-consistente', points: 15 },
        { field: 'tem_criativos', value: 'raramente', points: -10 },
        { field: 'tem_criativos', value: 'nao', points: -10 },
        { field: 'dificuldade_leads', value: 'sim-muito', points: -20 },
        { field: 'dificuldade_leads', value: 'sim-pouco', points: -8 },
        { field: 'dificuldade_leads', value: 'nao', points: 10 },
      ]
    },
    {
      key: 'vnd', name: 'Vendas', weight: 0.25, base: 50,
      rules: [
        { field: 'time_comercial', value: 'sim-estruturado', points: 20 },
        { field: 'time_comercial', value: 'nao', points: -15 },
        { field: 'funil', value: 'sim-documentado', points: 22 },
        { field: 'funil', value: 'sim-informal', points: 8 },
        { field: 'funil', value: 'nao', points: -15 },
        { field: 'perde_vendas', value: 'sim-muito', points: -20 },
        { field: 'perde_vendas', value: 'sim-pouco', points: -8 },
        { field: 'usa_crm', value: 'sim-ativo', points: 15 },
        { field: 'usa_crm', value: 'sim-pouco', points: 5 },
        { field: 'usa_crm', value: 'nao', points: -8 },
      ]
    },
    {
      key: 'oferta', name: 'Oferta', weight: 0.20, base: 50,
      rules: [
        { field: 'forca_oferta', value: 'muito-forte', points: 25 },
        { field: 'forca_oferta', value: 'boa', points: 10 },
        { field: 'forca_oferta', value: 'fraca', points: -15 },
        { field: 'mercado_entende', value: 'sim', points: 15 },
        { field: 'mercado_entende', value: 'parcialmente', points: 5 },
        { field: 'mercado_entende', value: 'nao', points: -10 },
        { field: 'prova_social', value: 'sim-forte', points: 15 },
        { field: 'prova_social', value: 'nao', points: -10 },
        { field: 'upsell', value: 'sim-estruturado', points: 10 },
      ]
    },
    {
      key: 'dados', name: 'Dados', weight: 0.15, base: 50,
      rules: [
        { field: 'acompanha_numeros', value: 'sim-bem', points: 25 },
        { field: 'acompanha_numeros', value: 'nao', points: -25 },
        { field: 'falta_clareza', value: 'sim-muito', points: -20 },
      ]
    },
    {
      key: 'proc', name: 'Processos', weight: 0.15, base: 50,
      rules: [
        { field: 'capacidade', value: 'no-limite', points: -15 },
        { field: 'capacidade', value: 'sim-facilidade', points: 10 },
        { field: 'apoio_interno', value: 'sim-dedicado', points: 15 },
        { field: 'apoio_interno', value: 'tudo-eu', points: -10 },
        { field: 'produz_video', value: 'sim-frequencia', points: 10 },
        { field: 'produz_video', value: 'nao', points: -10 },
      ]
    },
  ],
  thresholds: [
    { max: 40, label: 'Negócio Inicial', color: '#ea4335' },
    { max: 55, label: 'Em Estruturação', color: '#fbbc04' },
    { max: 72, label: 'Em Crescimento', color: '#fbbc04' },
    { max: 100, label: 'Pronto para Escala', color: '#34a853' },
  ],
}

// ─── Motor de cálculo genérico ────────────────

function matchRule(formData: any, rule: ScoringRule): boolean {
  const val = formData[rule.field]
  if (val === undefined || val === null) return false

  if (rule.value.startsWith('includes:')) {
    // Para campos array: verifica se o array inclui o valor
    const target = rule.value.replace('includes:', '')
    return Array.isArray(val) ? val.includes(target) : false
  }

  if (rule.value === '*') return true // qualquer valor não-vazio

  return String(val) === rule.value
}

export function calcScoresGeneric(formData: any, config: ScoringConfig): Record<string, number> {
  const scores: Record<string, number> = {}

  let geral = 0
  for (const pillar of config.pillars) {
    let score = pillar.base
    for (const rule of pillar.rules) {
      if (matchRule(formData, rule)) {
        score += rule.points
      }
    }
    // Bonus para arrays longos do canais (legado - mantém compatibilidade)
    if (pillar.key === 'mkt' && Array.isArray(formData.canais) && formData.canais.length > 3) {
      score += 8
    }
    if (pillar.key === 'dados') {
      const n = formData.numeros_conhece || []
      if (Array.isArray(n)) {
        if (n.includes('nenhum')) score -= 20
        else score += Math.min(n.length * 5, 20)
      }
      if (Array.isArray(formData.usa_ferramentas) && formData.usa_ferramentas.includes('dashboard')) {
        score += 10
      }
    }
    if (pillar.key === 'proc' && Array.isArray(formData.dificuldades) && formData.dificuldades.includes('processo')) {
      score -= 15
    }

    score = Math.min(100, Math.max(10, score))
    scores[pillar.key] = Math.round(score)
    geral += score * pillar.weight
  }

  scores.geral = Math.round(geral)
  return scores
}

export function getMaturityLabel(score: number, config: ScoringConfig): { label: string; color: string } {
  for (const t of config.thresholds) {
    if (score <= t.max) return { label: t.label, color: t.color }
  }
  const last = config.thresholds[config.thresholds.length - 1]
  return { label: last?.label || 'N/A', color: last?.color || '#5f6368' }
}

// ─── Obter config de scoring do chatbot ───────

export async function getScoringConfig(chatbotId?: number | null): Promise<ScoringConfig> {
  if (!chatbotId) return LEGACY_BYCHAT_CONFIG

  const chatbot = await prisma.chatbot.findUnique({
    where: { id: chatbotId },
    select: { scoringConfig: true },
  })

  if (chatbot?.scoringConfig) {
    const cfg = chatbot.scoringConfig as any
    if (cfg.pillars && Array.isArray(cfg.pillars) && cfg.pillars.length > 0) {
      return cfg as ScoringConfig
    }
  }

  return LEGACY_BYCHAT_CONFIG
}

// ─── Análise IA genérica ──────────────────────

async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  // Chave via Configurações › APIs (fallback .env) — ver lib/aiKeys.
  const apiKey = await getAnthropicKey()
  if (apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: await getAnthropicModel(),
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!response.ok) throw new Error(`Anthropic ${response.status}`)
    const data = await response.json() as any
    return data.content?.[0]?.text || ''
  }

  const openaiKey = await getOpenAiKey()
  if (!openaiKey) throw new Error('Nenhuma API key configurada')
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1200,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI ${response.status}`)
  const data = await response.json() as any
  return data.choices?.[0]?.message?.content || ''
}

// ─── Gera análise de sentimento e probabilidade ──

export async function generateLeadAnalysis(leadId: number, force = false): Promise<any> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      tags: { select: { tag: { select: { name: true } } } },
      activities: {
        orderBy: { scheduledAt: 'desc' },
        take: 10,
        select: { type: true, title: true, status: true, scheduledAt: true, completedAt: true, description: true },
      },
      messages: {
        orderBy: { timestamp: 'desc' },
        take: 20,
        where: { isDeleted: false },
        select: { fromMe: true, body: true, timestamp: true, isInternal: true },
      },
      detectedSales: {
        orderBy: { detectedAt: 'desc' },
        take: 5,
        select: { value: true, productService: true, detectedAt: true, confidence: true, aiExplanation: true },
      },
      funnel: { select: { name: true } },
    },
  })
  if (!lead) return null

  // Se já tem análise e não forçou, retorna cache
  if (lead.aiSentiment && !force) return lead.aiSentiment

  // Busca config do chatbot se disponível
  let chatbot: any = null
  if (lead.chatbotId) {
    chatbot = await prisma.chatbot.findUnique({
      where: { id: lead.chatbotId },
      select: { name: true, sentimentPrompt: true, scoringConfig: true },
    })
  }

  // Busca eventos relevantes do histórico
  const events = await prisma.leadEvent.findMany({
    where: { leadId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { type: true, title: true, channel: true, createdAt: true, description: true },
  })

  const fd = (lead.formData || {}) as any
  const sc = (lead.scores || {}) as any
  const chatMessages = fd._chatMessages || []

  // ── Identifica tipo/origem do lead ──
  const source = lead.source || 'desconhecido'
  const sourceLabels: Record<string, string> = {
    web_chat: 'Chatbot de diagnóstico',
    meta_lead_ads: 'Meta Lead Ads (Facebook/Instagram)',
    whatsapp: 'WhatsApp direto',
    web_form: 'Formulário do site',
    api: 'Integração via API',
    manual: 'Cadastro manual',
  }
  const sourceLabel = sourceLabels[source] || source

  // ── Monta contexto completo ──
  const ctx: string[] = []

  // 1. Perfil básico
  ctx.push(`=== PERFIL DO LEAD ===`)
  ctx.push(`Nome: ${lead.nome || '–'} | Empresa: ${lead.empresa || '–'}`)
  if (lead.segmento) ctx.push(`Segmento: ${lead.segmento}`)
  if (lead.cidade) ctx.push(`Cidade: ${lead.cidade}`)
  if (lead.whatsapp) ctx.push(`WhatsApp: ${lead.whatsapp}`)
  if (lead.email) ctx.push(`Email: ${lead.email}`)
  ctx.push(`Origem: ${sourceLabel}`)
  ctx.push(`Status atual: ${lead.status}`)
  if (lead.funnel) ctx.push(`Funil: ${lead.funnel.name}`)
  if (lead.maturidade) ctx.push(`Maturidade: ${lead.maturidade}`)
  if (lead.annotation) ctx.push(`Anotação da equipe: ${lead.annotation}`)
  const tagNames = lead.tags.map(t => t.tag.name).filter(Boolean)
  if (tagNames.length > 0) ctx.push(`Tags: ${tagNames.join(', ')}`)

  // 2. Tracking / campanha
  if (lead.campaignName || lead.utmSource || lead.originType) {
    ctx.push(`\n=== ORIGEM / CAMPANHA ===`)
    if (lead.campaignName) ctx.push(`Campanha: ${lead.campaignName}`)
    if (lead.adsetName) ctx.push(`Conjunto: ${lead.adsetName}`)
    if (lead.adName) ctx.push(`Anúncio: ${lead.adName}`)
    if (lead.utmSource) ctx.push(`UTM: source=${lead.utmSource} medium=${lead.utmMedium || '–'} campaign=${lead.utmCampaign || '–'}`)
    if (lead.originType) ctx.push(`Tipo de origem: ${lead.originType}`)
  }

  // 3. Scores (só se existirem — leads de chatbot)
  const scoreKeys = Object.keys(sc).filter(k => k !== 'geral')
  if (sc.geral) {
    ctx.push(`\n=== SCORES DO DIAGNÓSTICO ===`)
    ctx.push(`Score Geral: ${sc.geral}/100`)
    if (scoreKeys.length > 0) ctx.push(`Pilares: ${scoreKeys.map(k => `${k}=${sc[k]}/100`).join(' | ')}`)
    if (lead.solucaoNome) ctx.push(`Solução recomendada: ${lead.solucaoNome}`)
  }

  // 4. Dados do formulário / chatbot
  const formFields = Object.entries(fd).filter(([k]) => !k.startsWith('_'))
  if (formFields.length > 0) {
    ctx.push(`\n=== DADOS COLETADOS ===`)
    for (const [k, v] of formFields) {
      ctx.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    }
  }

  // 5. Campos personalizados
  const cf = (lead.customFields || {}) as any
  const cfEntries = Object.entries(cf).filter(([, v]) => v !== null && v !== '')
  if (cfEntries.length > 0) {
    ctx.push(`\n=== CAMPOS PERSONALIZADOS ===`)
    for (const [k, v] of cfEntries) {
      ctx.push(`${k}: ${Array.isArray(v) ? (v as any[]).join(', ') : v}`)
    }
  }

  // 6. Conversa do chatbot (se veio do chatbot)
  if (chatMessages.length > 0) {
    ctx.push(`\n=== CONVERSA COM CHATBOT (${chatMessages.length} mensagens) ===`)
    const relevantMsgs = chatMessages.slice(-12)
    for (const m of relevantMsgs) {
      const role = m.role === 'user' ? 'LEAD' : 'CHATBOT'
      ctx.push(`[${role}]: ${String(m.content).substring(0, 300)}`)
    }
  }

  // 7. Mensagens do atendimento (conversas reais com operadores)
  const realMessages = lead.messages.filter(m => !m.isInternal)
  if (realMessages.length > 0) {
    ctx.push(`\n=== CONVERSAS DE ATENDIMENTO (últimas ${realMessages.length} msgs) ===`)
    for (const m of realMessages.reverse()) {
      const who = m.fromMe ? 'OPERADOR' : 'LEAD'
      ctx.push(`[${who} ${new Date(m.timestamp).toLocaleDateString('pt-BR')}]: ${m.body.substring(0, 300)}`)
    }
  }

  // 8. Atividades (follow-ups, tarefas, reuniões)
  if (lead.activities.length > 0) {
    ctx.push(`\n=== ATIVIDADES REGISTRADAS ===`)
    for (const a of lead.activities) {
      const statusPt = a.status === 'completed' ? 'concluída' : a.status === 'pending' ? 'pendente' : a.status
      ctx.push(`[${a.type}] ${a.title} — ${statusPt} (${new Date(a.scheduledAt).toLocaleDateString('pt-BR')})${a.description ? ' — ' + a.description.substring(0, 150) : ''}`)
    }
  }

  // 9. Vendas detectadas
  if (lead.detectedSales.length > 0) {
    ctx.push(`\n=== VENDAS DETECTADAS ===`)
    for (const s of lead.detectedSales) {
      ctx.push(`R$ ${s.value || '?'} — ${s.productService || 'produto não especificado'} (${new Date(s.detectedAt).toLocaleDateString('pt-BR')}, confiança: ${s.confidence})`)
    }
  } else if (lead.saleDetected && lead.saleValue) {
    ctx.push(`\n=== VENDA DETECTADA ===`)
    ctx.push(`Valor: R$ ${lead.saleValue} em ${lead.saleDetectedAt ? new Date(lead.saleDetectedAt).toLocaleDateString('pt-BR') : '–'}`)
  }

  // 10. Timeline resumida
  if (events.length > 0) {
    ctx.push(`\n=== TIMELINE (últimos ${events.length} eventos) ===`)
    for (const e of events.slice(0, 15)) {
      ctx.push(`[${new Date(e.createdAt).toLocaleDateString('pt-BR')}] ${e.title}${e.channel ? ` (${e.channel})` : ''}`)
    }
  }

  // Datas importantes
  ctx.push(`\n=== DATAS ===`)
  ctx.push(`Criado em: ${new Date(lead.createdAt).toLocaleDateString('pt-BR')}`)
  if (lead.lastMessageAt) ctx.push(`Última mensagem: ${new Date(lead.lastMessageAt).toLocaleDateString('pt-BR')}`)
  if (lead.lastActivityAt) ctx.push(`Última atividade: ${new Date(lead.lastActivityAt).toLocaleDateString('pt-BR')}`)
  const diasDesdeCreacao = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000)
  ctx.push(`Dias desde criação: ${diasDesdeCreacao}`)

  const fullContext = ctx.join('\n')

  // ── Prompt adaptado ao tipo de lead ──
  const customPrompt = chatbot?.sentimentPrompt || ''

  // Determina o nível de dados disponível para calibrar expectativas
  const hasConversation = chatMessages.length > 0 || realMessages.length > 0
  const hasFormData = formFields.length > 0
  const hasScores = !!sc.geral
  const hasSales = lead.detectedSales.length > 0 || lead.saleDetected
  const hasActivities = lead.activities.length > 0

  let dataQuality = 'mínimo'
  const dataPoints = [hasConversation, hasFormData, hasScores, hasSales, hasActivities].filter(Boolean).length
  if (dataPoints >= 4) dataQuality = 'muito rico'
  else if (dataPoints >= 3) dataQuality = 'bom'
  else if (dataPoints >= 2) dataQuality = 'moderado'

  const systemPrompt = `Você é um analista comercial experiente, realista e direto. Analisa leads com base APENAS nos dados concretos disponíveis — sem inventar informações, sem presumir intenções não evidenciadas. Responda APENAS em JSON válido.`

  const userPrompt = customPrompt
    ? `${customPrompt}\n\nDADOS DO LEAD:\n${fullContext}`
    : `Analise este lead e retorne APENAS JSON válido (sem markdown, sem backticks) com esta estrutura:
{"probabilidade":NUMBER_0_100,"sentimento":"TEXTO","caminhoFechamento":"TEXTO","acoes":["ACAO1","ACAO2","ACAO3"],"pontosAtencao":"TEXTO"}

CONTEXTO IMPORTANTE:
- Este lead veio de: ${sourceLabel}
- Nível de dados disponíveis: ${dataQuality} (${dataPoints}/5 categorias preenchidas)
- Status atual no funil: ${lead.status}${lead.funnel ? ` (funil: ${lead.funnel.name})` : ''}
${diasDesdeCreacao > 30 ? `- ATENÇÃO: lead tem ${diasDesdeCreacao} dias — considere se está esfriando ou inativo` : ''}
${hasSales ? '- ATENÇÃO: já há vendas detectadas para este lead' : ''}

DADOS COMPLETOS DO LEAD:
${fullContext}

INSTRUÇÕES DE ANÁLISE:
- "probabilidade": percentual REALISTA de 0-100 de conversão. Seja conservador se os dados forem escassos. Considere:
  * Quantidade e qualidade dos dados disponíveis (dados escassos = menor confiança)
  * Engajamento real: respondeu msgs? participou de follow-ups? voltou a interagir?
  * Tempo desde criação: leads antigos sem interação recente devem ter probabilidade menor
  * Sinais concretos de compra vs. apenas preencheu formulário
  * Se já houve venda, a probabilidade de RECOMPRA/UPSELL
  ${source === 'meta_lead_ads' ? '* Leads de Meta Ads: muitos preenchem formulário por impulso — pondere se houve engajamento posterior' : ''}
  ${source === 'manual' ? '* Lead cadastrado manualmente: avalie pelos dados disponíveis e interações registradas' : ''}
  ${source === 'web_chat' ? '* Lead de chatbot: considere profundidade e qualidade das respostas no diagnóstico' : ''}
  ${source === 'whatsapp' ? '* Lead de WhatsApp: considere o teor da conversa e se demonstrou interesse genuíno' : ''}

- "sentimento": análise em 2-3 frases do sentimento REAL baseado nos dados. Se não há conversas, diga claramente que não é possível avaliar sentimento com precisão e baseie-se nos dados disponíveis.

- "caminhoFechamento": estratégia objetiva em 2-3 frases, específica para o contexto deste lead. Não seja genérico — use os dados reais para recomendar uma abordagem.

- "acoes": 3-4 ações CONCRETAS e ESPECÍFICAS para este lead, baseadas nos dados reais. Nada genérico como "fazer follow-up" — diga exatamente o quê.

- "pontosAtencao": riscos ou objeções reais identificados nos dados. Se há pouca informação, diga que o principal risco é a falta de dados para qualificar adequadamente.`

  try {
    const txt = await callAI(systemPrompt, userPrompt)
    const analysis = JSON.parse(txt.replace(/```json|```/g, '').trim())

    await prisma.lead.update({
      where: { id: leadId },
      data: { aiSentiment: analysis },
    })

    logEvent({
      leadId,
      type: EVENT_TYPES.AI_SENTIMENT_GENERATED,
      category: 'system',
      title: 'Análise IA gerada',
      source: chatbot ? chatbot.name : 'sistema',
      actorType: 'ai',
      description: `Probabilidade: ${analysis.probabilidade}% | Dados: ${dataQuality}`,
      metadata: { probabilidade: analysis.probabilidade, sentimento: analysis.sentimento, dataQuality, source },
    })

    return analysis
  } catch (err) {
    console.error('Erro ao gerar análise IA:', err)
    return null
  }
}

// ─── Pipeline completo ao completar chatbot ───

export async function onChatbotComplete(leadId: number, formData: any, chatbotId?: number | null) {
  // 1. Calcular scores
  const config = await getScoringConfig(chatbotId)
  const scores = calcScoresGeneric(formData, config)
  const maturity = getMaturityLabel(scores.geral, config)

  // 2. Gerar análise estratégica via IA
  let analysis = null
  try {
    const pillarSummary = config.pillars
      .map(p => `${p.name}=${scores[p.key]}/100`)
      .join(' | ')

    const formFields = Object.entries(formData)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\n')

    const analysisPrompt = `Dados do lead:
${formFields}

Scores: Geral=${scores.geral}/100 | ${pillarSummary}
Maturidade: ${maturity.label}

Gere diagnóstico estratégico personalizado e específico.`

    const systemPrompt = `Você é uma IA estratégica de análise de leads. Analise os dados e gere uma análise consultiva em português do Brasil. Seja profissional, estratégico e direto. Responda APENAS em JSON válido com esta estrutura exata (sem markdown, sem backticks):
{"visaoGeral":"...","pontosFortesItems":["...","...","..."],"pontosFrageisItems":["...","...","..."],"gargalos":"...","oportunidades":["...","...","..."],"prioridade":"...","proximosPassos":[{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."}],"convite":"..."}`

    const txt = await callAI(systemPrompt, analysisPrompt)
    analysis = JSON.parse(txt.replace(/```json|```/g, '').trim())
  } catch (err) {
    console.error('Erro ao gerar análise estratégica:', err)
  }

  // 3. Atualizar lead
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      scores,
      maturidade: maturity.label,
      analysis,
      completed: true,
      chatbotId: chatbotId || undefined,
    },
  })

  // 4. Gerar análise de sentimento/probabilidade automaticamente
  const chatbot = chatbotId
    ? await prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { autoAnalysis: true } })
    : null

  if (chatbot?.autoAnalysis !== false) {
    // Executa em background para não atrasar a resposta
    setTimeout(() => generateLeadAnalysis(leadId, true), 1000)
  }

  // CAPI 'CompleteRegistration' — sinal de fim de fluxo do chatbot.
  // O qualifyLead também dispara CAPI 'Lead' independente; ambos são úteis
  // pra Meta entender que o usuário concluiu o funil interno.
  ;(async () => {
    try {
      const { sendCapiEvent } = await import('./metaCapi.js')
      await sendCapiEvent({
        leadId,
        eventName: 'CompleteRegistration',
        funnelStage: 'chatbot_completed',
        customData: { maturity: maturity.label, score: scores.geral },
      })
    } catch { /* skip */ }
  })()

  return { scores, maturity, analysis }
}

// ─── Exporta config legada para uso em migração ──
export { LEGACY_BYCHAT_CONFIG }
