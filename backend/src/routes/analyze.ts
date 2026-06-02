// src/routes/analyze.ts
// Rota opcional: move a chamada Anthropic do frontend para o backend
// Ativa quando ANTHROPIC_API_KEY estiver no .env
// Frontend chama POST /api/bychat/analyze ao invés da Anthropic diretamente

import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../lib/auth.js'
import { getBranding } from '../lib/branding.js'

const INV_LABELS = [
  'Sem orçamento definido','Até R$1.000/mês','R$1.000–2.500/mês',
  'R$2.500–5.000/mês','R$5.000–10.000/mês',
  'R$10.000–20.000/mês','Acima de R$20.000/mês'
]

function buildSystemPrompt(brandName: string): string {
  return `Você é a IA estratégica da ${brandName}. Analise o diagnóstico e gere uma análise consultiva em português do Brasil. Seja profissional, estratégico e direto. Não use linguagem infantil. Não invente dados. Use apenas as informações fornecidas. Responda APENAS em JSON válido com esta estrutura exata (sem markdown, sem backticks):
{"visaoGeral":"...","pontosFortesItems":["...","...","..."],"pontosFrageisItems":["...","...","..."],"gargalos":"...","oportunidades":["...","...","..."],"prioridade":"...","proximosPassos":[{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."},{"titulo":"...","desc":"..."}],"convite":"..."}`
}

async function callAnthropic(prompt: string, systemPrompt: string): Promise<any> {
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
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`)

  const data = await response.json()
  const txt = data.content?.[0]?.text || ''
  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

async function callOpenAI(prompt: string, systemPrompt: string): Promise<any> {
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
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  })

  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`)

  const data = await response.json()
  const txt = data.choices?.[0]?.message?.content || ''
  return JSON.parse(txt.replace(/```json|```/g, '').trim())
}

export async function analyzeRoutes(app: FastifyInstance) {

  app.post('/api/bychat/analyze', { preHandler: authMiddleware }, async (req, reply) => {
    const { formData, scores } = req.body as any
    const brand = await getBranding()
    const systemPrompt = buildSystemPrompt(brand.brandName)
    const prompt = buildPrompt(formData, scores)

    // Tenta Anthropic primeiro, cai para OpenAI se falhar
    let analysis: any = null
    let usedProvider = ''

    try {
      analysis = await callAnthropic(prompt, systemPrompt)
      usedProvider = 'anthropic'
    } catch (errA) {
      app.log.warn(`Anthropic falhou (${errA}), tentando OpenAI...`)
      try {
        analysis = await callOpenAI(prompt, systemPrompt)
        usedProvider = 'openai'
      } catch (errB) {
        app.log.error(`OpenAI também falhou: ${errB}`)
        return reply.code(502).send({ error: 'Ambas as APIs de análise falharam' })
      }
    }

    app.log.info(`Análise gerada via ${usedProvider}`)
    return { ok: true, analysis }
  })
}

function buildPrompt(d: any, sc: any): string {
  return `Dados do diagnóstico empresarial:
Empresa: ${d.empresa || '?'} | Segmento: ${d.segmento || '?'} | Porte: ${d.tamanho || '?'} | Tempo: ${d.tempo || '?'}
Desafio principal: ${d.desafio || 'Não informado'}
Momento: ${d.momento || '?'} | Meta: ${d.meta || 'Não informado'}
Dificuldades: ${(d.dificuldades || []).join(', ') || 'Nenhuma'}
Marketing: investe=${d.investe_mkt||'?'} | canais=${(d.canais||[]).join(', ')||'nenhum'} | site=${d.tem_site||'?'} | criativos=${d.tem_criativos||'?'}
Oferta: produto="${d.produto||'?'}" | diferencial="${d.diferencial||'?'}" | forca=${d.forca_oferta||'?'}
Vendas: time=${d.time_comercial||'?'} | funil=${d.funil||'?'} | perde=${d.perde_vendas||'?'} | crm=${d.usa_crm||'?'}
Dados: acompanha=${d.acompanha_numeros||'?'} | falta_clareza=${d.falta_clareza||'?'}
Execução: capacidade=${d.capacidade||'?'} | orcamento=${d.orcamento||'?'} | investimento=${INV_LABELS[parseInt(d.faixa_investimento||'0')]}
Scores: Geral=${sc.geral}/100 | Mkt=${sc.mkt}/100 | Vnd=${sc.vnd}/100 | Oferta=${sc.oferta}/100 | Dados=${sc.dados}/100 | Proc=${sc.proc}/100

Gere diagnóstico estratégico personalizado e específico para esta empresa.`
}
