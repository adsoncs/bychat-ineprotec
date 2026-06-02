// src/services/aiDocumentReview.ts
// F2 — Análise documental de matrículas via Claude Sonnet 4.6 com visão.
// Chamado pelo worker wf-document-review quando um documento é enviado por
// candidato e o DocumentType correspondente define um aiAnalysisTemplate.
//
// O modelo recebe (a) o arquivo em base64 + (b) prompt específico do template
// e devolve um JSON estruturado com:
//   - data: campos extraídos específicos do tipo
//   - suggestion: "approve" | "review" | "reject"
//   - confidence: 0.0–1.0
//   - reasoning: explicação curta para o operador humano
//
// IMPORTANTE: a IA NUNCA aprova/rejeita sozinha. Apenas sugere — o operador
// humano tem palavra final via EnrollmentDocument.status. A sugestão da IA
// alimenta a UI de review na F2.3 e o portal do candidato na F2.4.

import { prisma } from '../lib/prisma.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { captureException } from '../lib/observability.js'

const MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TOKENS = 1200
const CONFIDENCE_THRESHOLD = 0.7      // abaixo disso, sugestão cai em 'review'

// ─── Templates de análise por tipo de documento ─────────────
// Cada template especifica o prompt system, o prompt user (que acompanha a imagem),
// e os campos esperados no JSON. O shape do `data` é livre — a UI sabe lidar.

type Template = {
  systemPrompt: string
  userPrompt: (formContext: any) => string
  schemaHint: string
}

const TEMPLATES: Record<string, Template> = {
  rg_cpf: {
    systemPrompt: `Você é um especialista em validação de documentos de identidade brasileiros (RG/CPF). Extraia dados do documento e sinalize problemas de legibilidade, divergência com o cadastro, ou sinais de fraude. Nunca aprove sozinho — sua saída é apenas sugestão para um operador humano.`,
    userPrompt: (ctx) => `Analise este documento de identidade (RG ou CPF). Contexto do cadastro do candidato:
- Nome informado: ${ctx?.nome || '(não informado)'}
- CPF informado: ${ctx?.cpf || '(não informado)'}

Extraia: nome completo, número do documento (RG ou CPF), data de nascimento, data de emissão/validade se visível, órgão emissor.
Verifique se o nome no documento bate com o nome informado. Verifique legibilidade.

Retorne APENAS JSON válido (sem markdown) com esta estrutura:
{
  "data": {
    "documentKind": "rg" | "cpf" | "cnh" | "outro",
    "nome": "...",
    "cpf": "...",           // formato 000.000.000-00 (ou null se não visível)
    "rg": "...",            // ou null
    "dataNascimento": "YYYY-MM-DD",
    "orgaoEmissor": "...",
    "dataEmissao": "YYYY-MM-DD",
    "legibilidade": "alta" | "media" | "baixa",
    "nomeBateComForm": true | false,
    "cpfBateComForm": true | false
  },
  "suggestion": "approve" | "review" | "reject",
  "confidence": 0.0,
  "reasoning": "frase curta explicando"
}

Sugestão de regras:
- approve: todos campos legíveis, nome/CPF batem, sem anomalias → confidence >= 0.8
- review: algum campo incerto, divergência mínima, legibilidade média
- reject: documento ilegível, dados conflitantes, imagem cortada/rasurada`,
    schemaHint: 'rg_cpf',
  },

  academic_history: {
    systemPrompt: `Você analisa histórico escolar brasileiro de ensino superior (graduação). Extraia disciplinas cursadas, cargas horárias, notas/conceitos, e sinalize problemas. Nunca aprove sozinho — sugestão é para operador humano decidir equivalência.`,
    userPrompt: (ctx) => `Analise este histórico escolar. Contexto:
- Candidato: ${ctx?.nome || '(não informado)'}
- IES de origem informada: ${ctx?.iesAnterior || '(não informada)'}
- Curso anterior: ${ctx?.cursoAnterior || '(não informado)'}

Extraia:
1. Identificação: IES, curso, situação (em andamento/concluído), data início, ano/semestre atual
2. Disciplinas cursadas: lista com nome, carga horária, nota (escala 0-10), semestre

Retorne APENAS JSON válido:
{
  "data": {
    "ies": "...",
    "curso": "...",
    "situacao": "em_andamento" | "concluido" | "trancado",
    "cargaTotalHoras": 0,
    "disciplinas": [
      { "nome": "...", "cargaHoraria": 60, "nota": 8.5, "semestre": "2024/1", "status": "aprovado" | "reprovado" | "em_curso" }
    ],
    "iesBateComForm": true | false,
    "cursoBateComForm": true | false,
    "legibilidade": "alta" | "media" | "baixa"
  },
  "suggestion": "approve" | "review" | "reject",
  "confidence": 0.0,
  "reasoning": "..."
}

Sugestão: histórico legível + IES/curso batendo → review (decisão de equivalência é humana). Ilegível ou divergente → reject.`,
    schemaHint: 'academic_history',
  },

  diploma: {
    systemPrompt: `Você analisa diplomas de graduação brasileiros. Extraia informações-chave e sinalize falsificações óbvias ou problemas de legibilidade.`,
    userPrompt: (ctx) => `Analise este diploma. Contexto:
- Candidato: ${ctx?.nome || '(não informado)'}

Extraia: nome do graduado, curso, IES, data de colação de grau, registro MEC/validade.

Retorne JSON:
{
  "data": {
    "nome": "...",
    "curso": "...",
    "ies": "...",
    "dataColacao": "YYYY-MM-DD",
    "registroMec": "...",
    "nomeBateComForm": true | false,
    "legibilidade": "alta" | "media" | "baixa",
    "indiciosFraude": true | false
  },
  "suggestion": "approve" | "review" | "reject",
  "confidence": 0.0,
  "reasoning": "..."
}`,
    schemaHint: 'diploma',
  },

  address_proof: {
    systemPrompt: `Você valida comprovantes de residência brasileiros (conta de luz/água/internet/telefone fixo, boleto bancário com endereço). Extraia endereço completo e data de emissão. Comprovante válido geralmente tem < 90 dias.`,
    userPrompt: (ctx) => `Analise este comprovante de residência. Contexto:
- Candidato: ${ctx?.nome || '(não informado)'}

Extraia titular do documento, endereço completo (rua, número, bairro, cidade, estado, CEP), tipo de conta (luz/água/internet/outro), e data de emissão.

Retorne JSON:
{
  "data": {
    "titular": "...",
    "tipoConta": "luz" | "agua" | "internet" | "telefone" | "bancario" | "outro",
    "endereco": {
      "logradouro": "...",
      "numero": "...",
      "bairro": "...",
      "cidade": "...",
      "uf": "..",
      "cep": "00000-000"
    },
    "dataEmissao": "YYYY-MM-DD",
    "diasDesdeEmissao": 0,
    "titularBateComForm": true | false,
    "legibilidade": "alta" | "media" | "baixa"
  },
  "suggestion": "approve" | "review" | "reject",
  "confidence": 0.0,
  "reasoning": "..."
}

Regras: emitido há > 90 dias → review. Nome do titular diferente do candidato sem explicação → review. Ilegível → reject.`,
    schemaHint: 'address_proof',
  },

  enem_score: {
    systemPrompt: `Você extrai notas de boletins oficiais do ENEM. O boletim tem as 5 competências: Ciências Humanas, Ciências da Natureza, Linguagens, Matemática, Redação. Também tem número de inscrição, ano da prova e status de treineiro.`,
    userPrompt: (ctx) => `Analise este boletim do ENEM. Contexto informado pelo candidato:
- Nome: ${ctx?.nome || '(não informado)'}
- Inscrição ENEM: ${ctx?.enemInscricao || '(não informada)'}
- Ano da prova: ${ctx?.enemAno || '(não informado)'}

Extraia as 5 notas, nome do candidato, número de inscrição, ano, se é treineiro.

Retorne JSON:
{
  "data": {
    "nome": "...",
    "inscricao": "...",
    "ano": 2024,
    "treineiro": true | false,
    "notas": {
      "cienciasHumanas": 0.0,
      "cienciasNatureza": 0.0,
      "linguagens": 0.0,
      "matematica": 0.0,
      "redacao": 0.0,
      "mediaSimples": 0.0
    },
    "nomeBateComForm": true | false,
    "inscricaoBateComForm": true | false,
    "anoBateComForm": true | false,
    "legibilidade": "alta" | "media" | "baixa",
    "boletimOficial": true | false
  },
  "suggestion": "approve" | "review" | "reject",
  "confidence": 0.0,
  "reasoning": "..."
}

Regras de sugestão:
- approve: 5 notas legíveis, nome/inscrição/ano batem, boletim aparenta ser oficial → confidence >= 0.85
- review: dados OK mas alguma divergência pequena (nome com abreviação, etc.)
- reject: boletim que aparenta montagem, notas ilegíveis, dados conflitantes.`,
    schemaHint: 'enem_score',
  },
}

// ─── Carregamento do arquivo ────────────────────────────────

// Resolve o path local do fileUrl. O candidate portal salva em
// `${APP_URL}/uploads/enrollment-docs/{saved}` — recuperamos o basename e
// procuramos no FS local.
async function loadFileBase64(fileUrl: string): Promise<{ base64: string; bytes: number }> {
  const savedName = path.basename(new URL(fileUrl, 'http://local').pathname)
  if (!savedName) throw new Error('fileUrl inválido')
  // process.cwd() = backend/, o uploads fica 1 nível acima
  const filePath = path.join(process.cwd(), '..', 'uploads', 'enrollment-docs', savedName)
  const buf = await fs.readFile(filePath)
  return { base64: buf.toString('base64'), bytes: buf.length }
}

// ─── Chamada Claude com visão ───────────────────────────────

// Resolve key/model via lib/aiKeys (Setting → env). Sem isso, key configurada
// pelo admin via UI era ignorada.
import { getAnthropicKey as resolveAnthropicKey, getAnthropicModel } from '../lib/aiKeys.js'

async function ensureAnthropicKey(): Promise<string> {
  const k = await resolveAnthropicKey()
  if (!k) throw new Error('Configure a chave Anthropic em Configurações > APIs antes de revisar documentos com IA.')
  return k
}

// Custo estimado (aproximação — só pra telemetria).
// Sonnet 4.5: input $3/Mtok, output $15/Mtok.
function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000
}

async function callClaudeVision(params: {
  systemPrompt: string
  userPrompt: string
  fileBase64: string
  mimeType: string
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { systemPrompt, userPrompt, fileBase64, mimeType } = params

  // Claude aceita image/jpeg, image/png, image/gif, image/webp como image
  // e application/pdf como document (suporta até ~100 páginas em PDF).
  const isPdf = mimeType === 'application/pdf'
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBase64 } }

  const apiKey = await ensureAnthropicKey()
  const model = await getAnthropicModel()

  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [fileBlock, { type: 'text', text: userPrompt }],
      },
    ],
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${errText.substring(0, 300)}`)
  }

  const data = await resp.json()
  const text: string = data.content?.[0]?.text || ''
  const inputTokens: number = data.usage?.input_tokens || 0
  const outputTokens: number = data.usage?.output_tokens || 0
  return { text, inputTokens, outputTokens }
}

// ─── Parse da resposta ──────────────────────────────────────

function parseResponse(raw: string): { data: any; suggestion: string; confidence: number; reasoning: string } {
  // Modelo às vezes embrulha em markdown apesar da instrução. Limpa.
  const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
  let parsed: any
  try {
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(`Resposta da IA não é JSON válido: ${clean.substring(0, 200)}`)
  }

  const suggestion = ['approve', 'review', 'reject'].includes(parsed.suggestion) ? parsed.suggestion : 'review'
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.substring(0, 500) : ''
  const data = parsed.data || parsed  // fallback caso o modelo não aninhe

  return { data, suggestion, confidence, reasoning }
}

// Se a confiança está abaixo do threshold, força revisão humana mesmo se IA sugeriu approve/reject.
function guardSuggestion(suggestion: string, confidence: number): string {
  if (suggestion === 'approve' && confidence < CONFIDENCE_THRESHOLD) return 'review'
  return suggestion
}

// ─── Entry point — chamado pelo worker ──────────────────────

export async function reviewDocumentById(docId: number): Promise<{ ok: boolean; status: string; suggestion?: string; reason?: string }> {
  const doc = await prisma.enrollmentDocument.findUnique({
    where: { id: docId },
    include: {
      type: true,
      registration: { select: { id: true, formData: true } },
    },
  })
  if (!doc) throw new Error(`Documento ${docId} não encontrado`)

  // Sem template → marca skipped sem custo
  const tmplKey = doc.type?.aiAnalysisTemplate
  if (!tmplKey || !TEMPLATES[tmplKey]) {
    await prisma.enrollmentDocument.update({
      where: { id: docId },
      data: { aiStatus: 'skipped', aiProcessedAt: new Date() },
    })
    return { ok: true, status: 'skipped', reason: 'Tipo sem template de IA' }
  }

  // Marca processing
  await prisma.enrollmentDocument.update({ where: { id: docId }, data: { aiStatus: 'processing' } })

  try {
    const tmpl = TEMPLATES[tmplKey]
    const formData = (doc.registration?.formData as any) || {}
    const { base64, bytes } = await loadFileBase64(doc.fileUrl)

    // Proteção de tamanho: arquivos > ~5MB consomem muitos tokens. Pula por segurança.
    if (bytes > 5 * 1024 * 1024) {
      await prisma.enrollmentDocument.update({
        where: { id: docId },
        data: {
          aiStatus: 'skipped',
          aiProcessedAt: new Date(),
          aiAnalysis: { skipReason: 'Arquivo maior que 5MB, análise IA pulada', bytes },
        },
      })
      return { ok: true, status: 'skipped', reason: 'arquivo grande demais' }
    }

    const { text, inputTokens, outputTokens } = await callClaudeVision({
      systemPrompt: tmpl.systemPrompt,
      userPrompt: tmpl.userPrompt(formData),
      fileBase64: base64,
      mimeType: doc.mimeType,
    })

    const parsed = parseResponse(text)
    const finalSuggestion = guardSuggestion(parsed.suggestion, parsed.confidence)
    const cost = estimateCostUsd(inputTokens, outputTokens)

    await prisma.enrollmentDocument.update({
      where: { id: docId },
      data: {
        aiStatus: 'done',
        aiSuggestion: finalSuggestion,
        aiConfidence: parsed.confidence,
        aiAnalysis: {
          template: tmplKey,
          model: MODEL,
          data: parsed.data,
          reasoning: parsed.reasoning,
          tokens: { input: inputTokens, output: outputTokens },
        },
        aiCostUsd: cost,
        aiProcessedAt: new Date(),
      },
    })

    // F3.2 + F3.3: se é boletim ENEM, importa notas e classifica
    if (tmplKey === 'enem_score') {
      try {
        const { processEnemScoreFromDocument } = await import('./enemClassification.js')
        await processEnemScoreFromDocument(docId)
      } catch (err: any) {
        // Não falha o review inteiro se a classificação falhar — só loga
        console.error(`[enem-classification] doc ${docId}:`, err?.message || err)
      }
    }

    return { ok: true, status: 'done', suggestion: finalSuggestion }
  } catch (err: any) {
    await prisma.enrollmentDocument.update({
      where: { id: docId },
      data: {
        aiStatus: 'failed',
        aiProcessedAt: new Date(),
        aiAnalysis: { error: err.message || String(err) },
      },
    }).catch(() => {})
    captureException(err, { docId, template: doc.type?.aiAnalysisTemplate })
    throw err
  }
}
