// src/services/saleDetection.ts
// Detecção automática de vendas por IA — Fase 7

import { prisma } from '../lib/prisma.js'
import { getBranding } from '../lib/branding.js'
import { logEvent, EVENT_TYPES, getOperator } from './leadHistory.js'
import { z } from 'zod'
import { getAnthropicKey, getOpenAiKey } from '../lib/aiKeys.js'

const DEFAULT_PROMPT = `Você é um analista de vendas especializado. Analise a conversa de WhatsApp abaixo entre um atendente e um cliente/lead.

Seu objetivo é determinar se uma VENDA foi CONCRETIZADA nesta conversa.

CRITÉRIOS PARA CONSIDERAR UMA VENDA:
- Cliente confirmou a compra explicitamente ("quero fechar", "vamos fechar", "pode fazer", "aceito", "fechado")
- Pagamento foi mencionado como realizado ("já paguei", "pix enviado", "boleto pago", "passou no cartão")
- Pedido foi confirmado ("pedido feito", "já encomendei")
- Contrato/proposta aceita ("assinei o contrato", "proposta aceita", "aprovado")
- Link de pagamento foi enviado E cliente confirmou pagamento
- Cliente forneceu dados de pagamento (cartão, pix, etc.)

NÃO É VENDA (falso positivo):
- Apenas pedir orçamento ou proposta
- Dizer que "vai pensar" ou "vou analisar"
- Perguntar preço sem confirmar compra
- Atendente enviar proposta mas sem confirmação do cliente
- Conversa ainda em negociação/dúvidas
- Cliente pedindo desconto sem fechar
- Agendamento de reunião ou demonstração
- Interesse sem compromisso ("achei interessante", "gostei")

SOBRE O VALOR:
- Extraia o valor EXATO mencionado na conversa (em reais)
- Se houver múltiplos valores, use o valor FINAL acordado
- Se o valor não foi mencionado, retorne null
- Converta para número decimal (ex: "2 mil" = 2000, "1.500" = 1500)

SOBRE CONFIANÇA:
- "high": confirmação clara de pagamento ou aceite explícito
- "medium": forte indicação de fechamento mas sem confirmação 100% clara
- "low": possível venda mas com ambiguidade

Responda APENAS em JSON válido (sem markdown, sem backticks, sem explicação fora do JSON):
{"sale": true, "value": 1500.00, "product": "Plano Premium mensal", "confidence": "high", "explanation": "Cliente confirmou o pagamento via PIX do plano premium no valor de R$ 1.500", "snippet": "as 2-3 mensagens mais relevantes que comprovam a venda"}

Se NÃO houve venda:
{"sale": false, "value": null, "product": null, "confidence": "high", "explanation": "Conversa ainda em fase de negociação, sem confirmação de compra", "snippet": ""}`

interface SaleResult {
  sale: boolean
  value: number | null
  product: string | null
  confidence: string
  explanation: string
  snippet: string
}

async function getDetectionPrompt(): Promise<string> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'sale_detection.prompt' } })
    if (setting) {
      const val = typeof setting.value === 'string' ? setting.value : String(setting.value)
      return val.replace(/^"|"$/g, '') || DEFAULT_PROMPT
    }
  } catch {}
  return DEFAULT_PROMPT
}

async function getTargetStage(): Promise<{ funnelId: number; stageKey: string } | null> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'sale_detection.target_stage' } })
    if (setting) {
      const val = typeof setting.value === 'string' ? setting.value : String(setting.value)
      const clean = val.replace(/^"|"$/g, '')
      if (!clean) return null
      // Formato: "funnelId:stageKey"
      const [fid, ...rest] = clean.split(':')
      const stageKey = rest.join(':')
      if (fid && stageKey) return { funnelId: parseInt(fid), stageKey }
      // Fallback: só stageKey (compatibilidade)
      return { funnelId: 0, stageKey: clean }
    }
  } catch {}
  return null
}

// Schema Zod para validar resposta da IA
const SaleResultSchema = z.object({
  sale: z.boolean(),
  value: z.number().positive().max(10000000).nullable().catch(null),
  product: z.string().max(200).nullable().catch(null),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
  explanation: z.string().max(500).catch(''),
  snippet: z.string().max(500).catch(''),
})

/**
 * Valida e normaliza o resultado da IA usando Zod.
 */
function validateSaleResult(raw: any): SaleResult {
  try {
    return SaleResultSchema.parse(raw)
  } catch {
    console.warn('[SaleDetection] Resposta da IA com schema inválido, normalizando:', raw)
    return {
      sale: !!raw?.sale,
      value: null,
      product: null,
      confidence: 'low',
      explanation: typeof raw?.explanation === 'string' ? raw.explanation.slice(0, 500) : 'Resposta da IA com formato inesperado',
      snippet: '',
    }
  }
}

async function callAI(systemPrompt: string, conversation: string): Promise<SaleResult> {
  // Try Anthropic first
  // Chave via Configurações › APIs (fallback .env) — ver lib/aiKeys.
  const anthropicKey = await getAnthropicKey()
  if (anthropicKey) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: conversation }]
      })
    })
    if (resp.ok) {
      const data = await resp.json() as any
      const txt = data.content?.[0]?.text || '{}'
      return validateSaleResult(JSON.parse(txt.replace(/```json|```/g, '').trim()))
    }
    // Falha da API era engolida e o log dizia só "nenhum provedor disponível" —
    // mensagem que manda procurar configuração quando o problema é crédito
    // acabado, chave revogada ou rate limit. Sem o motivo, ninguém investiga.
    console.warn(`[SaleDetection] Anthropic respondeu ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`)
  }

  // Fallback to OpenAI
  const openaiKey = await getOpenAiKey()
  if (openaiKey) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: conversation }
        ]
      })
    })
    if (resp.ok) {
      const data = await resp.json() as any
      const txt = data.choices?.[0]?.message?.content || '{}'
      return validateSaleResult(JSON.parse(txt.replace(/```json|```/g, '').trim()))
    }
    console.warn(`[SaleDetection] OpenAI respondeu ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`)
  }

  // Fallback: detecção por heurísticas quando IA não está disponível
  console.warn('[SaleDetection] IA indisponível (veja o motivo acima) — usando detecção por heurísticas')
  return detectSaleByHeuristics(conversation)
}

/**
 * Detecção de vendas por heurísticas (keywords) — fallback quando IA indisponível.
 * Não substitui a IA, mas captura vendas óbvias com confirmação explícita.
 */
function detectSaleByHeuristics(conversation: string): SaleResult {
  const lower = conversation.toLowerCase()

  // Padrões de confirmação de venda (alta confiança)
  const highConfidencePatterns = [
    /(?:j[aá]\s+paguei|pix\s+enviado|boleto\s+pago|pagamento\s+(?:feito|realizado|confirmado)|comprovante\s+(?:de\s+)?pagamento)/i,
    /(?:passou\s+no\s+cart[aã]o|cart[aã]o\s+aprovado|transa[cç][aã]o\s+aprovada)/i,
    /(?:assinei\s+o?\s*contrato|contrato\s+assinado|proposta\s+aceita)/i,
  ]

  // Padrões de fechamento (média confiança)
  const mediumConfidencePatterns = [
    /(?:vamos?\s+fechar|pode\s+fechar|quero\s+fechar|fechado|fecha\s+pra\s+mim|bora\s+fechar)/i,
    /(?:aceito|pode\s+fazer|vou\s+(?:querer|pegar|levar|comprar)|quero\s+(?:sim|comprar|contratar))/i,
    /(?:pedido\s+(?:feito|confirmado|realizado)|encomend(?:ei|ado))/i,
  ]

  // Falsos positivos — se encontrar, não é venda
  const falsePositivePatterns = [
    /(?:vou\s+pensar|vou\s+analisar|preciso\s+(?:pensar|ver|analisar)|deixa\s+eu\s+ver)/i,
    /(?:qual\s+(?:o\s+)?(?:pre[cç]o|valor)|quanto\s+(?:custa|fica|sai|[eé]))/i,
    /(?:me\s+(?:envia|manda)\s+(?:a\s+)?proposta|pode\s+enviar\s+(?:o\s+)?or[cç]amento)/i,
    /(?:n[aã]o\s+(?:quero|vou|posso)|cancel|desist)/i,
  ]

  // Verificar falsos positivos primeiro
  const lastMessages = conversation.split('\n').slice(-10).join('\n').toLowerCase()
  for (const pattern of falsePositivePatterns) {
    if (pattern.test(lastMessages)) return { sale: false, value: null, product: null, confidence: 'high', explanation: 'Heurística: padrão de não-venda detectado nas últimas mensagens', snippet: '' }
  }

  // Verificar alta confiança
  for (const pattern of highConfidencePatterns) {
    const match = lastMessages.match(pattern)
    if (match) {
      const value = extractValueFromText(lastMessages)
      return {
        sale: true,
        value,
        product: null,
        confidence: 'medium',
        explanation: `Heurística: confirmação de pagamento detectada — "${match[0]}"`,
        snippet: extractSnippet(conversation, match[0])
      }
    }
  }

  // Verificar média confiança
  for (const pattern of mediumConfidencePatterns) {
    const match = lastMessages.match(pattern)
    if (match) {
      const value = extractValueFromText(lastMessages)
      return {
        sale: true,
        value,
        product: null,
        confidence: 'low',
        explanation: `Heurística: indicação de fechamento detectada — "${match[0]}"`,
        snippet: extractSnippet(conversation, match[0])
      }
    }
  }

  return { sale: false, value: null, product: null, confidence: 'high', explanation: 'Heurística: nenhum padrão de venda detectado', snippet: '' }
}

function extractValueFromText(text: string): number | null {
  // R$ 1.500,00 | R$ 1500 | 1.500 reais | 2 mil | 2k
  const patterns = [
    /R\$\s*([\d.]+,?\d*)/i,
    /([\d.]+,\d{2})\s*(?:reais|real)/i,
    /(\d+)\s*mil(?:\s*reais)?/i,
    /(\d+)k\b/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      let val = m[1].replace(/\./g, '').replace(',', '.')
      let num = parseFloat(val)
      if (/mil|k/i.test(m[0])) num *= 1000
      if (num > 0 && num < 10000000) return num
    }
  }
  return null
}

function extractSnippet(conversation: string, keyword: string): string {
  const lines = conversation.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(keyword.toLowerCase())) {
      return lines.slice(Math.max(0, i - 1), i + 2).join('\n').slice(0, 300)
    }
  }
  return lines.slice(-3).join('\n').slice(0, 300)
}

/**
 * Analisa as mensagens de um lead para detectar se houve venda.
 */
export async function analyzeSaleForLead(leadId: number): Promise<SaleResult | null> {
  const messages = await prisma.message.findMany({
    where: { leadId, isDeleted: false, isInternal: false },
    orderBy: { timestamp: 'asc' },
    take: 60,
    select: { fromMe: true, body: true, timestamp: true, senderName: true }
  })

  if (messages.length < 4) return null // Too few messages to analyze

  const conversation = messages.map(m => {
    const sender = m.fromMe ? 'Atendente' : 'Cliente'
    return `[${sender}]: ${m.body}`
  }).join('\n')

  const prompt = await getDetectionPrompt()

  try {
    const result = await callAI(prompt, conversation)
    return result
  } catch (err) {
    console.error(`Sale detection AI error for lead ${leadId}:`, err)
    return null
  }
}

/**
 * Processa o resultado da detecção e salva no banco.
 */
export async function processSaleDetection(leadId: number): Promise<void> {
  const result = await analyzeSaleForLead(leadId)
  if (!result || !result.sale) {
    // Update lastSaleAnalysis even when no sale detected
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastSaleAnalysis: new Date() }
    }).catch(() => {})
    return
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, originType: true, campaignId: true, campaignName: true, utmSource: true, trackableLinkId: true, saleDetected: true }
  })
  if (!lead) return

  const target = await getTargetStage()

  // Create DetectedSale
  await prisma.detectedSale.create({
    data: {
      leadId,
      value: result.value ? result.value : null,
      productService: result.product || null,
      confidence: result.confidence || 'medium',
      aiExplanation: result.explanation || null,
      conversationSnippet: result.snippet || null,
      previousStatus: lead.status,
      newStatus: target?.stageKey || lead.status,
      autoMoved: !!target,
      originType: lead.originType || null,
      campaignId: lead.campaignId || null,
      campaignName: lead.campaignName || null,
      utmSource: lead.utmSource || null,
    }
  })

  // Update lead
  const updateData: any = {
    saleDetected: true,
    saleDetectedAt: new Date(),
    lastSaleAnalysis: new Date(),
  }
  if (result.value) updateData.saleValue = result.value
  if (target) {
    updateData.status = target.stageKey
    if (target.funnelId > 0) updateData.funnelId = target.funnelId
  }

  await prisma.lead.update({ where: { id: leadId }, data: updateData })

  // Atribuição de venda ao link rastreável de origem (se o lead veio de um).
  // Só credita na primeira detecção (lead.saleDetected era false) para não duplicar.
  if (lead.trackableLinkId && !lead.saleDetected) {
    try {
      await prisma.trackableLink.update({
        where: { id: lead.trackableLinkId },
        data: {
          totalSales: { increment: 1 },
          ...(result.value ? { totalRevenue: { increment: result.value } } : {}),
        },
      })
    } catch (err) {
      console.error('[saleDetection] Falha ao atribuir venda ao trackable link:', err)
    }
  }

  // Log event
  await logEvent({
    leadId,
    type: 'sale_detected',
    category: 'lifecycle',
    source: 'ai_detection',
    actorType: 'ai',
    title: `Venda detectada pela IA — R$ ${result.value || '?'}`,
    description: result.explanation || 'Venda detectada automaticamente por análise de IA',
    metadata: { value: result.value, product: result.product, confidence: result.confidence },
  })
}

/**
 * Busca leads pendentes de análise e enfileira cada um como job individual.
 */
async function enqueueLeadsForAnalysis() {
  try {
    const toAnalyze = await prisma.$queryRaw`
      SELECT id FROM bychat_leads
      WHERE saleDetected = false
        AND completed = false
        AND lastMessageAt IS NOT NULL
        AND (lastSaleAnalysis IS NULL OR lastMessageAt > lastSaleAnalysis)
      ORDER BY lastMessageAt DESC
      LIMIT 10
    ` as Array<{ id: number }>

    if (toAnalyze.length === 0) return

    const { Queue } = await import('bullmq')
    const queue = new Queue('sale-detection', {
      connection: { host: process.env.REDIS_HOST || '127.0.0.1', port: parseInt(process.env.REDIS_PORT || '6379'), password: process.env.REDIS_PASSWORD || undefined }
    })

    for (const lead of toAnalyze) {
      await queue.add('analyze-lead', { leadId: lead.id }, {
        jobId: `sale-${lead.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      })
    }

    await queue.close()
  } catch (err) {
    console.error('[SaleDetection] Enqueue error:', err)
  }
}

/**
 * Scheduler com BullMQ: job queue persistente para detecção de vendas.
 * Jobs sobrevivem a restarts do processo.
 */
export async function startSaleDetectionScheduler() {
  const intervalMs = parseInt(process.env.SALE_DETECTION_INTERVAL || '600000') // Default 10 min
  if (intervalMs <= 0) {
    console.log('[SaleDetection] Scheduler desativado (intervalo <= 0)')
    return
  }

  const redisHost = process.env.REDIS_HOST || '127.0.0.1'
  const redisPort = parseInt(process.env.REDIS_PORT || '6379')

  try {
    const { Worker, Queue } = await import('bullmq')
    const connection = { host: redisHost, port: redisPort, password: process.env.REDIS_PASSWORD || undefined }

    // Worker que processa cada lead individualmente
    const worker = new Worker('sale-detection', async (job) => {
      const { leadId } = job.data
      console.log(`[SaleDetection] Analisando lead ${leadId}...`)
      await processSaleDetection(leadId)
    }, {
      connection,
      concurrency: 1, // Processar 1 por vez para evitar rate limit da IA
      limiter: { max: 1, duration: 2000 }, // Max 1 job a cada 2s
    })

    worker.on('completed', (job) => {
      console.log(`[SaleDetection] Lead ${job.data.leadId} analisado com sucesso`)
    })

    worker.on('failed', (job, err) => {
      console.error(`[SaleDetection] Falha ao analisar lead ${job?.data?.leadId}:`, err.message)
    })

    // Scheduler: enfileira leads pendentes no intervalo configurado
    const schedulerQueue = new Queue('sale-detection-scheduler', { connection })

    // Repeatable job que busca e enfileira leads
    await schedulerQueue.add('find-leads', {}, {
      repeat: { every: intervalMs },
      removeOnComplete: 10,
      removeOnFail: 10,
    })

    const schedulerWorker = new Worker('sale-detection-scheduler', async () => {
      await enqueueLeadsForAnalysis()
    }, { connection, concurrency: 1 })

    // Primeira execução imediata
    await enqueueLeadsForAnalysis()

    console.log(`[SaleDetection] BullMQ scheduler iniciado (intervalo: ${intervalMs / 1000}s, Redis: ${redisHost}:${redisPort})`)

    // Graceful shutdown
    const shutdown = async () => {
      await worker.close()
      await schedulerWorker.close()
      await schedulerQueue.close()
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

  } catch (err) {
    console.error('[SaleDetection] Falha ao iniciar BullMQ, usando fallback setInterval:', err)
    // Fallback para setInterval se Redis não disponível
    console.log(`[SaleDetection] Fallback scheduler iniciado (intervalo: ${intervalMs / 1000}s)`)
    setInterval(async () => {
      try {
        const toAnalyze = await prisma.$queryRaw`
          SELECT id FROM bychat_leads
          WHERE saleDetected = false
            AND completed = false
            AND lastMessageAt IS NOT NULL
            AND (lastSaleAnalysis IS NULL OR lastMessageAt > lastSaleAnalysis)
          ORDER BY lastMessageAt DESC
          LIMIT 10
        ` as Array<{ id: number }>

        for (const lead of toAnalyze) {
          await processSaleDetection(lead.id)
          await new Promise(r => setTimeout(r, 2000))
        }
      } catch (err) {
        console.error('[SaleDetection] Scheduler error:', err)
      }
    }, intervalMs)
  }
}
