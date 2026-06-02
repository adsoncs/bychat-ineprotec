// src/routes/chat.ts
// Chat conversacional para diagnóstico Raio-X de Growth via IA
// Usa Anthropic com fallback OpenAI (mesmo padrão de analyze.ts)

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { notifyNewLead } from '../services/notify.js'
import { logEvent, EVENT_TYPES, getIp } from '../services/leadHistory.js'
import { generateUid } from '../services/dedup.js'
import { onChatbotComplete } from '../services/scoring.js'
import { getBranding } from '../lib/branding.js'
import { resolveDefaultTeamId } from '../services/teamRouting.js'

// ─── Test Sessions (in-memory, no DB) ─────────────────────

const testSessions = new Map<string, { messages: Array<{role: string, content: string}>, createdAt: number }>()

// Cleanup test sessions older than 1 hour
setInterval(() => {
  const now = Date.now()
  for (const [key, session] of testSessions) {
    if (now - session.createdAt > 3600000) testSessions.delete(key)
  }
}, 300000)

// ─── Constants ─────────────────────────────────────────────

const INV_LABELS = [
  'Sem orçamento definido', 'Até R$1.000/mês', 'R$1.000–2.500/mês',
  'R$2.500–5.000/mês', 'R$5.000–10.000/mês',
  'R$10.000–20.000/mês', 'Acima de R$20.000/mês'
]

function buildChatSystemPrompt(brandName: string): string {
  return `Você é a IA assistente da ${brandName}. Você está conduzindo um diagnóstico gratuito por chat.

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

SEQUÊNCIA EXATA DE PERGUNTAS (siga esta ordem rigorosamente, uma por vez):

1. Cumprimento + pergunte o NOME da pessoa
2. Nome da EMPRESA
3. WHATSAPP para contato
4. E-MAIL
5. SEGMENTO da empresa (dê as opções: Varejo/E-commerce, Serviços B2B, Serviços B2C, Saúde e Bem-estar, Educação, Imóveis, Tecnologia/SaaS, Alimentação, Indústria, Outro)
6. CIDADE/Estado
7. TAMANHO da empresa (Só você/autônomo, Micro até 10 pessoas, Pequena 11-30, Média 30+)
8. TEMPO de mercado (Menos de 1 ano, 1 a 3 anos, 3 a 7 anos, Mais de 7 anos)
9. Qual o MAIOR DESAFIO da empresa hoje? (texto livre)
10. Como define o MOMENTO da empresa? (Crescendo mas desestruturado, Estagnada, Faturamento em queda, Em início)
11. Qual a META principal para os próximos 3-6 meses?
12. Onde sente MAIS DIFICULDADE? (pode citar vários: Marketing, Vendas, Posicionamento, Processo, Tecnologia, Dados, Equipe, Financeiro)
13. INVESTE em marketing? (Tráfego pago, Orgânico, Os dois, Não investe)
14. Quais CANAIS usa? (Instagram, Google Ads, Meta Ads, YouTube, TikTok, E-mail, WhatsApp, Indicação)
15. O que JÁ TROUXE RESULTADO em marketing?
16. O que NÃO FUNCIONOU?
17. Tem DIFICULDADE em gerar leads qualificados? (Grande dificuldade, Um pouco, Não mas não converto, Não está bem)
18. Possui SITE ou landing page? (Sim bem estruturado, Sim mas fraco, Em construção, Não possui)
19. Produz CRIATIVOS e conteúdo com frequência? (Sim consistente, Esporadicamente, Raramente, Não)
20. Qual o principal PRODUTO/SERVIÇO?
21. Qual o DIFERENCIAL percebido pelo mercado?
22. O mercado ENTENDE seu diferencial? (Sim claramente, Parcialmente, Não há confusão, Não sei)
23. Tem PROVA SOCIAL (cases, depoimentos)? (Muitos e fortes, Poucos/fracos, Construindo, Não tenho)
24. Como avalia a FORÇA DA OFERTA principal? (Muito forte, Boa mas pode melhorar, Fraca/confusa, Reformulando)
25. Existe UPSELL ou produto complementar? (Sim estruturado, Sim informal, Não mas quero, Não)
26. Como os leads são ATENDIDOS hoje? (texto livre)
27. Possui TIME COMERCIAL? (Sim estruturado, Sim informal, Sou eu mesmo, Não)
28. Possui FUNIL de vendas definido? (Sim documentado, Sim informal, Parcialmente, Não)
29. Sente que PERDE VENDAS por falta de processo? (Sim muito, Às vezes, Raramente, Não)
30. Usa CRM? (Sim ativo, Sim pouco usado, Planilha apenas, Nada)
31. ACOMPANHA os números do negócio? (Sim tenho controle, Sim básico, Pouco, Não)
32. Quais MÉTRICAS acompanha? (Faturamento, CAC, CPL, Taxa de conversão, Ticket médio, Churn, ROAS/ROI, Nenhum)
33. Sente FALTA DE CLAREZA nos dados? (Sim muito, Um pouco, Não tenho clareza, Não uso dados)
34. Quais FERRAMENTAS usa? (Planilhas, Dashboards, CRM, ERP, Automações, Nenhuma)
35. Algum PROBLEMA OPERACIONAL que poderia ser resolvido com tecnologia?
36. Consegue PRODUZIR VÍDEOS e conteúdo? (Sim com frequência, Sim com dificuldade, Raramente, Não)
37. Tem pessoa interna para APOIAR MARKETING? (Sim dedicado, Sim parcialmente, Faço tudo eu, Não)
38. Tem CAPACIDADE para atender mais demanda? (Sim fácil, Sim com esforço, No limite, Não)
39. ORÇAMENTO disponível para crescimento? (Tenho orçamento, Limitado, Precisa provar ROI, Sem orçamento)
40. Qual FAIXA DE INVESTIMENTO mensal em marketing? (Sem orçamento, Até R$1.000, R$1.000-2.500, R$2.500-5.000, R$5.000-10.000, R$10.000-20.000, Acima de R$20.000)

Após a pergunta 40, agradeça e diga que o diagnóstico está sendo gerado.

IMPORTANTE:
- Se o usuário responder várias coisas de uma vez, aceite e pule para a próxima pergunta pendente
- Campos com * são obrigatórios — se o usuário pular, insista gentilmente
- Adapte linguagem natural para os valores internos (ex: "só eu" = time comercial "apenas-eu")`
}

const EXTRACTION_PROMPT = `Analise a conversa abaixo e extraia os dados estruturados do diagnóstico. Retorne APENAS JSON válido (sem markdown, sem backticks).

CAMPOS E VALORES POSSÍVEIS:

Etapa 0: nome (string), empresa (string), whatsapp (string), email (string), site (string), instagram (string), segmento (Varejo/E-commerce|Serviços B2B|Serviços B2C|Saúde e Bem-estar|Educação|Imóveis|Tecnologia/SaaS|Alimentação|Indústria|Outro), cidade (string), tamanho (solopreneur|micro|pequena|media), tempo (menos1|1a3|3a7|mais7)

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
- A etapa avança quando os campos obrigatórios daquela etapa estão preenchidos

Retorne exatamente este formato:
{"formData":{...campos extraídos...},"currentStep":N,"completed":false}`

// ─── AI Call Functions (same redundancy as analyze.ts) ─────

async function callAnthropicChat(systemPrompt: string, messages: Array<{role: string, content: string}>): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
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
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
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

async function chatWithAI(systemPrompt: string, messages: Array<{role: string, content: string}>): Promise<string> {
  try {
    return await callAnthropicChat(systemPrompt, messages)
  } catch (errA) {
    console.warn(`Anthropic chat falhou (${errA}), tentando OpenAI...`)
    return await callOpenAIChat(systemPrompt, messages)
  }
}

async function extractDataWithAI(conversation: Array<{role: string, content: string}>): Promise<any> {
  const convoText = conversation.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`).join('\n')
  const extractionMessages = [{ role: 'user', content: `CONVERSA:\n${convoText}\n\nExtraia os dados estruturados.` }]

  let txt = ''
  try {
    txt = await callAnthropicChat(EXTRACTION_PROMPT, extractionMessages as any)
  } catch (errA) {
    console.warn(`Anthropic extraction falhou (${errA}), tentando OpenAI...`)
    txt = await callOpenAIChat(EXTRACTION_PROMPT, extractionMessages as any)
  }

  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

// ─── Analysis prompt (reused from analyze.ts) ──────────────

function buildAnalysisSystemPrompt(brandName: string): string {
  return `Você é a IA estratégica da ${brandName}. Analise o diagnóstico e gere uma análise consultiva em português do Brasil. Seja profissional, estratégico e direto. Não use linguagem infantil. Não invente dados. Use apenas as informações fornecidas. Responda APENAS em JSON válido com esta estrutura exata (sem markdown, sem backticks):
{"visaoGeral":"...","pontosFortesItems":["...","...","..."],"pontosFrageisItems":["...","...","..."],"gargalos":"...","oportunidades":["...","...","..."],"prioridade":"...","proximosPassos":[{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."}],"convite":"..."}`
}

async function callAnalysis(formData: any, scores: any): Promise<any> {
  const brand = await getBranding()
  const systemPrompt = buildAnalysisSystemPrompt(brand.brandName)
  const prompt = buildAnalysisPrompt(formData, scores)
  const messages = [{ role: 'user' as const, content: prompt }]

  let txt = ''
  try {
    txt = await callAnthropicChat(systemPrompt, messages)
  } catch (errA) {
    console.warn(`Anthropic analysis falhou (${errA}), tentando OpenAI...`)
    txt = await callOpenAIChat(systemPrompt, messages)
  }

  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

function buildAnalysisPrompt(d: any, sc: any): string {
  return `Dados do diagnóstico empresarial:
Empresa: ${d.empresa || '?'} | Segmento: ${d.segmento || '?'} | Porte: ${d.tamanho || '?'} | Tempo: ${d.tempo || '?'}
Desafio principal: ${d.desafio || 'Não informado'}
Momento: ${d.momento || '?'} | Meta: ${d.meta || 'Não informado'}
Dificuldades: ${(d.dificuldades || []).join(', ') || 'Nenhuma'}
Marketing: investe=${d.investe_mkt || '?'} | canais=${(d.canais || []).join(', ') || 'nenhum'} | site=${d.tem_site || '?'} | criativos=${d.tem_criativos || '?'}
Oferta: produto="${d.produto || '?'}" | diferencial="${d.diferencial || '?'}" | forca=${d.forca_oferta || '?'}
Vendas: time=${d.time_comercial || '?'} | funil=${d.funil || '?'} | perde=${d.perde_vendas || '?'} | crm=${d.usa_crm || '?'}
Dados: acompanha=${d.acompanha_numeros || '?'} | falta_clareza=${d.falta_clareza || '?'}
Execução: capacidade=${d.capacidade || '?'} | orcamento=${d.orcamento || '?'} | investimento=${INV_LABELS[parseInt(d.faixa_investimento || '0')]}
Scores: Geral=${sc.geral}/100 | Mkt=${sc.mkt}/100 | Vnd=${sc.vnd}/100 | Oferta=${sc.oferta}/100 | Dados=${sc.dados}/100 | Proc=${sc.proc}/100

Gere diagnóstico estratégico personalizado e específico para esta empresa.`
}

// ─── Score Calculation (ported from frontend) ──────────────

function calcScores(d: any) {
  let mkt = 50, vnd = 50, oferta = 50, dados = 50, proc = 50

  // Marketing
  if (d.investe_mkt === 'sim-ambos') mkt += 20
  else if (d.investe_mkt === 'sim-pago' || d.investe_mkt === 'sim-organico') mkt += 10
  else mkt -= 15
  if (d.tem_site === 'sim-bom') mkt += 15
  else if (d.tem_site === 'nao') mkt -= 12
  if (d.tem_criativos === 'sim-consistente') mkt += 15
  else if (d.tem_criativos === 'raramente' || d.tem_criativos === 'nao') mkt -= 10
  if (d.dificuldade_leads === 'sim-muito') mkt -= 20
  else if (d.dificuldade_leads === 'sim-pouco') mkt -= 8
  else if (d.dificuldade_leads === 'nao') mkt += 10
  if ((d.canais || []).length > 3) mkt += 8
  mkt = Math.min(100, Math.max(10, mkt))

  // Vendas
  if (d.time_comercial === 'sim-estruturado') vnd += 20
  else if (d.time_comercial === 'nao') vnd -= 15
  if (d.funil === 'sim-documentado') vnd += 22
  else if (d.funil === 'sim-informal') vnd += 8
  else vnd -= 15
  if (d.perde_vendas === 'sim-muito') vnd -= 20
  else if (d.perde_vendas === 'sim-pouco') vnd -= 8
  if (d.usa_crm === 'sim-ativo') vnd += 15
  else if (d.usa_crm === 'sim-pouco') vnd += 5
  else vnd -= 8
  vnd = Math.min(100, Math.max(10, vnd))

  // Oferta
  if (d.forca_oferta === 'muito-forte') oferta += 25
  else if (d.forca_oferta === 'boa') oferta += 10
  else if (d.forca_oferta === 'fraca') oferta -= 15
  if (d.mercado_entende === 'sim') oferta += 15
  else if (d.mercado_entende === 'parcialmente') oferta += 5
  else oferta -= 10
  if (d.prova_social === 'sim-forte') oferta += 15
  else if (d.prova_social === 'nao') oferta -= 10
  if (d.upsell === 'sim-estruturado') oferta += 10
  oferta = Math.min(100, Math.max(10, oferta))

  // Dados
  if (d.acompanha_numeros === 'sim-bem') dados += 25
  else if (d.acompanha_numeros === 'nao') dados -= 25
  const n = d.numeros_conhece || []
  if (n.includes('nenhum')) dados -= 20
  else dados += Math.min(n.length * 5, 20)
  if (d.falta_clareza === 'sim-muito') dados -= 20
  if ((d.usa_ferramentas || []).includes('dashboard')) dados += 10
  dados = Math.min(100, Math.max(10, dados))

  // Processo
  if (d.capacidade === 'no-limite') proc -= 15
  else if (d.capacidade === 'sim-facilidade') proc += 10
  if (d.apoio_interno === 'sim-dedicado') proc += 15
  else if (d.apoio_interno === 'tudo-eu') proc -= 10
  if (d.produz_video === 'sim-frequencia') proc += 10
  else if (d.produz_video === 'nao') proc -= 10
  if ((d.dificuldades || []).includes('processo')) proc -= 15
  proc = Math.min(100, Math.max(10, proc))

  const geral = Math.round(mkt * 0.25 + vnd * 0.25 + oferta * 0.2 + dados * 0.15 + proc * 0.15)
  return {
    geral,
    mkt: Math.round(mkt),
    vnd: Math.round(vnd),
    oferta: Math.round(oferta),
    dados: Math.round(dados),
    proc: Math.round(proc)
  }
}

function getMaturidade(score: number) {
  if (score < 40) return { label: 'Negócio Inicial', cls: 'mat-inicial', dot: '🔴' }
  if (score < 55) return { label: 'Em Estruturação', cls: 'mat-estruturando', dot: '🟡' }
  if (score < 72) return { label: 'Em Crescimento', cls: 'mat-crescimento', dot: '🟡' }
  return { label: 'Pronto para Escala', cls: 'mat-escala', dot: '🟢' }
}

function getSolucao(d: any, sc: any) {
  if (sc.vnd < 45 && d.funil !== 'sim-documentado')
    return { nome: 'Growth Sales', desc: 'Sua empresa precisa urgentemente estruturar processo comercial. A frente de Growth Sales da Beyond atua diretamente na construção de funil, CRM, roteiro e equipe comercial, transformando leads em clientes de forma previsível.', tags: ['Funil de vendas', 'CRM', 'Scripts comerciais', 'Treinamento'] }
  if (sc.mkt < 45)
    return { nome: 'Growth Marketing 1.0', desc: 'O foco agora deve ser construir base: posicionamento claro, canais ativos, conteúdo consistente e primeiras campanhas estruturadas. O Growth Marketing 1.0 é o ponto de partida ideal para quem ainda não tem tração.', tags: ['Posicionamento', 'Conteúdo', 'Tráfego pago', 'Base digital'] }
  if (d.tem_criativos === 'nao' || d.tem_criativos === 'raramente')
    return { nome: 'Audiovisual + Marketing', desc: 'Você tem o negócio, mas não a presença visual. A produção de vídeos, criativos e conteúdos estratégicos é o combustível que falta para o crescimento.', tags: ['Produção de vídeo', 'Criativos', 'Reels/Shorts', 'Conteúdo estratégico'] }
  if (d.tem_site === 'nao' || d.tem_site === 'sim-fraco')
    return { nome: 'Sites + Landing Pages', desc: 'Você precisa de uma presença digital que converta. Um site ou landing page de alta performance é a base para transformar visibilidade em leads e tráfego em receita.', tags: ['Site institucional', 'Landing pages', 'SEO técnico', 'CRO'] }
  if (sc.dados < 45)
    return { nome: 'Diagnóstico + Automação', desc: 'Seu negócio cresce, mas você não enxerga com clareza onde está perdendo dinheiro. A Beyond pode implementar dashboards, automações e fluxos que dão visibilidade real para decisões mais inteligentes.', tags: ['Dashboards', 'Automações', 'Análise de dados', 'BI'] }
  return { nome: 'Growth Marketing 2.0', desc: 'Você já tem estrutura. Agora é hora de escalar com inteligência: campanhas mais performáticas, automações de marketing, funil completo e expansão de canais.', tags: ['Escala de mídia', 'Automação de marketing', 'Funil completo', 'Expansão'] }
}

// ─── Routes ────────────────────────────────────────────────

export async function chatRoutes(app: FastifyInstance) {

  // POST /api/bychat/chat/start — Inicia nova conversa de diagnóstico
  app.post('/api/bychat/chat/start', async (req, reply) => {
    try {
      const { _test } = (req.body || {}) as any
      const brand = await getBranding()
      const firstMessage = `Olá! 👋 Eu sou a assistente virtual da ${brand.brandName}. Estou aqui para fazer um diagnóstico gratuito do seu negócio.

Em poucos minutos de conversa, vou entender o momento da sua empresa e gerar um relatório completo com scores, pontos fortes e uma recomendação personalizada.

Para começar, qual é o seu nome?`

      const chatMessages = [
        { role: 'assistant', content: firstMessage }
      ]

      // MODO TESTE: não cria lead real — usa sessão em memória
      if (_test) {
        const testId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        testSessions.set(testId, { messages: chatMessages, createdAt: Date.now() })
        return {
          leadId: testId,
          messages: [{ role: 'assistant', content: firstMessage }]
        }
      }

      // MODO REAL: cria lead no banco
      const routedTeamId = await resolveDefaultTeamId()
      const lead = await prisma.lead.create({
        data: {
          uid: await generateUid(),
          nome: '',
          empresa: '',
          whatsapp: '',
          email: '',
          formData: { _chatMessages: chatMessages },
          scores: {},
          lastStep: 0,
          completed: false,
          lastActivityAt: new Date(),
          source: 'web_chat',
          originType: 'web_chat',
          teamId: routedTeamId,
        }
      })

      logEvent({
        leadId: lead.id,
        type: EVENT_TYPES.DIAGNOSIS_STARTED,
        category: 'lifecycle',
        title: 'Diagnóstico iniciado via chat web',
        channel: 'web_chat',
        source: 'chatbot',
        actorType: 'lead',
        ipAddress: getIp(req),
      })

      return {
        leadId: lead.id,
        messages: [{ role: 'assistant', content: firstMessage }]
      }
    } catch (err: any) {
      app.log.error(`Chat start error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao iniciar chat' })
    }
  })

  // POST /api/bychat/chat/message — Envia mensagem e recebe resposta da IA
  app.post('/api/bychat/chat/message', async (req, reply) => {
    const { leadId, message } = req.body as { leadId: any; message: string }

    if (!leadId || !message) {
      return reply.code(400).send({ error: 'leadId e message são obrigatórios' })
    }

    // MODO TESTE: sessão em memória, sem banco
    if (typeof leadId === 'string' && leadId.startsWith('test_')) {
      const session = testSessions.get(leadId)
      if (!session) return reply.code(404).send({ error: 'Sessão de teste expirada' })

      try {
        session.messages.push({ role: 'user', content: message })
        const aiMessages = session.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        const brand = await getBranding()
        const aiResponse = await chatWithAI(buildChatSystemPrompt(brand.brandName), aiMessages)
        session.messages.push({ role: 'assistant', content: aiResponse })

        return { messages: [{ role: 'assistant', content: aiResponse }] }
      } catch (err: any) {
        return reply.code(500).send({ error: 'Erro na IA: ' + err.message })
      }
    }

    try {
      // Load lead and conversation history
      const lead = await prisma.lead.findUnique({ where: { id: Number(leadId) } })
      if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
      if (lead.completed) return reply.code(400).send({ error: 'Diagnóstico já foi concluído' })

      const formData = (lead.formData || {}) as any
      const chatMessages: Array<{role: string, content: string}> = formData._chatMessages || []

      // Add user message
      chatMessages.push({ role: 'user', content: message })

      // Build messages for AI (only role: user|assistant)
      const aiMessages = chatMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))

      // Get AI conversational response
      const brand = await getBranding()
      const aiResponse = await chatWithAI(buildChatSystemPrompt(brand.brandName), aiMessages)

      // Add assistant response to history
      chatMessages.push({ role: 'assistant', content: aiResponse })

      // Extract structured data from conversation
      let extracted: any = { formData: {}, currentStep: lead.lastStep, completed: false }
      try {
        extracted = await extractDataWithAI(chatMessages)
      } catch (extractErr) {
        app.log.warn(`Data extraction failed: ${extractErr}`)
      }

      const extractedFormData = extracted.formData || {}
      const currentStep = extracted.currentStep ?? lead.lastStep
      const isCompleted = extracted.completed === true

      // Merge extracted data into formData, preserving _chatMessages
      const updatedFormData = {
        ...formData,
        ...extractedFormData,
        _chatMessages: chatMessages
      }

      // Update lead in DB
      const updateData: any = {
        formData: updatedFormData,
        lastStep: currentStep,
        lastActivityAt: new Date()
      }

      // Update top-level fields if extracted
      if (extractedFormData.nome) updateData.nome = extractedFormData.nome
      if (extractedFormData.empresa) updateData.empresa = extractedFormData.empresa
      if (extractedFormData.whatsapp) updateData.whatsapp = extractedFormData.whatsapp
      if (extractedFormData.email) updateData.email = extractedFormData.email
      if (extractedFormData.segmento) updateData.segmento = extractedFormData.segmento
      if (extractedFormData.cidade) updateData.cidade = extractedFormData.cidade

      // If completed, run full analysis via scoring service
      if (isCompleted) {
        try {
          // Salva formData antes de processar
          await prisma.lead.update({ where: { id: leadId }, data: updateData })

          // Usa o serviço genérico de scoring (lê config do chatbot se disponível)
          const result = await onChatbotComplete(leadId, extractedFormData, lead.chatbotId)

          logEvent({
            leadId,
            type: EVENT_TYPES.DIAGNOSIS_COMPLETED,
            category: 'lifecycle',
            title: 'Diagnóstico completo via chat web',
            channel: 'web_chat',
            source: 'chatbot',
            actorType: 'lead',
            description: `Score geral: ${result.scores.geral}/100, Maturidade: ${result.maturity.label}`,
            metadata: { scores: result.scores, maturidade: result.maturity.label },
            ipAddress: getIp(req),
          })

          // Notify
          try {
            const updatedLead = await prisma.lead.findUnique({ where: { id: leadId } })
            if (updatedLead) await notifyNewLead(updatedLead)
          } catch (notifErr) {
            app.log.warn(`Notification failed: ${notifErr}`)
          }

          return {
            messages: [{ role: 'assistant', content: aiResponse }],
            extractedData: extractedFormData,
            currentStep: 7,
            completed: true,
            scores: result.scores,
            maturidade: result.maturity,
            analysis: result.analysis
          }
        } catch (completionErr) {
          app.log.error(`Completion processing error: ${completionErr}`)
          updateData.completed = false
          await prisma.lead.update({
            where: { id: leadId },
            data: updateData
          })
        }
      } else {
        await prisma.lead.update({
          where: { id: leadId },
          data: updateData
        })

        // Log progresso apenas quando muda de etapa
        if (currentStep > lead.lastStep) {
          logEvent({
            leadId,
            type: EVENT_TYPES.DIAGNOSIS_PROGRESS,
            category: 'lifecycle',
            title: `Chat avançou para etapa ${currentStep}`,
            channel: 'web_chat',
            source: 'chatbot',
            actorType: 'lead',
            oldValue: String(lead.lastStep),
            newValue: String(currentStep),
            ipAddress: getIp(req),
          })
        }
      }

      return {
        messages: [{ role: 'assistant', content: aiResponse }],
        extractedData: extractedFormData,
        currentStep,
        completed: false
      }
    } catch (err: any) {
      app.log.error(`Chat message error: ${err.message}`)
      return reply.code(500).send({ error: 'Erro ao processar mensagem' })
    }
  })
}
