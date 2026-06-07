// src/services/journey/interpret.ts
//
// Camada de INTERPRETAÇÃO por IA da jornada (parte híbrida do motor). Quando o
// chatbot scripted está com `aiInterpret` ligado e a resposta do usuário a uma
// pergunta de seleção NÃO casa de forma determinística (nem botão, nem número,
// nem label/value), a IA mapeia o texto livre para a opção mais próxima — ou
// devolve "unclear" (resposta ambígua) para o runner reapresentar a pergunta.
//
// PRINCÍPIO: a IA só CLASSIFICA a resposta (escolhe um value de opção existente);
// o roteamento de etapa continua 100% determinístico (resolveQualification +
// resolveStageMove sobre o value retornado). Assim ganhamos conversa natural sem
// abrir mão do funil auditável. Falha/indisponibilidade da IA → "unclear" →
// fallback para o comportamento determinístico atual (reask).

import { chatWithAI } from '../chatbotFlow.js'

export interface InterpretResult {
  value: string | null // value de uma opção existente, quando a IA conseguiu mapear
  unclear: boolean // true → resposta ambígua / IA indisponível → reask
}

function stripHtml(s: any): string {
  return String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// Monta o prompt do classificador: pergunta + opções (value↔label) + instrução
// estrita de saída JSON. `extra` é a instrução opcional por chatbot (interpretPrompt).
function buildPrompt(question: string, options: Array<{ value: string; label: string }>, extra?: string | null): string {
  const list = options.map((o, i) => `${i + 1}. value="${o.value}" — ${o.label}`).join('\n')
  return [
    'Você classifica a resposta de um usuário em UMA das opções pré-definidas de uma pergunta de um formulário de WhatsApp.',
    extra && extra.trim() ? `\nContexto adicional do atendimento:\n${extra.trim()}` : '',
    `\nPergunta:\n${question}`,
    `\nOpções válidas (use EXATAMENTE o value):\n${list}`,
    '\nRegras:',
    '- Escolha a opção cujo significado melhor corresponde à resposta do usuário, mesmo que ele use outras palavras, gírias, números aproximados ou frases.',
    '- Se a resposta for ambígua, vazia, fora do tema ou não der para decidir com segurança, marque unclear.',
    '- NUNCA invente um value que não esteja na lista.',
    '\nResponda APENAS com JSON válido (sem markdown, sem comentários), no formato:',
    '{"value":"<value exato de uma opção ou null>","unclear":<true|false>}',
  ].filter(Boolean).join('\n')
}

// Extrai o JSON da resposta da IA e valida o value contra as opções reais.
function parseResult(raw: string, valueSet: Set<string>): InterpretResult {
  if (!raw) return { value: null, unclear: true }
  const m = /\{[\s\S]*\}/.exec(raw) // pega o primeiro objeto JSON, ignorando lixo ao redor
  if (!m) return { value: null, unclear: true }
  let obj: any
  try { obj = JSON.parse(m[0]) } catch { return { value: null, unclear: true } }
  if (obj?.unclear === true) return { value: null, unclear: true }
  const v = obj?.value
  if (typeof v === 'string' && valueSet.has(v)) return { value: v, unclear: false }
  return { value: null, unclear: true } // value ausente/alucinado → trata como ambíguo
}

// Interpreta a resposta livre a um campo de SELEÇÃO, mapeando-a para o value de
// uma opção existente (ou unclear). Determinístico-primeiro acontece ANTES, no
// runner (parseAnswer); esta função só é chamada quando aquele falha.
export async function interpretSelectAnswer(
  field: any, text: string, opts?: { instruction?: string | null },
): Promise<InterpretResult> {
  const options: Array<{ value: string; label: string }> = Array.isArray(field?.options)
    ? field.options.map((o: any) => ({ value: String(o.value), label: stripHtml(o.label) || String(o.value) }))
    : []
  const t = (text ?? '').trim()
  if (!options.length || !t) return { value: null, unclear: true }
  const question = stripHtml(field?.label) || String(field?.key || '')
  const valueSet = new Set(options.map((o) => o.value))
  let raw = ''
  try {
    raw = await chatWithAI(buildPrompt(question, options, opts?.instruction), [{ role: 'user', content: t.slice(0, 600) }])
  } catch {
    return { value: null, unclear: true } // IA indisponível → reask determinístico
  }
  return parseResult(raw, valueSet)
}
