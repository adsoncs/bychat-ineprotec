// Parâmetros de template (HSM) da WhatsApp Cloud API.
//
// A Meta aceita dois formatos e recusa a mensagem inteira se vier o errado:
//   • posicional — {{1}}, {{2}}: cada parâmetro é só { type, text }, na ordem;
//   • nomeado    — {{nome}}:     cada parâmetro exige também `parameter_name`.
// Enviar posicional num template nomeado derruba com #132000, e o disparo se
// perde silenciosamente do ponto de vista de quem configurou o fluxo.
//
// Parâmetro vazio também é recusado (#132000/131008), por isso todo valor cai
// num placeholder em vez de ir em branco.

export const EMPTY_PARAM_PLACEHOLDER = '—'

/** Tokens do BODY na ordem em que aparecem (sem repetir) + se o template é nomeado. */
export function templateBodyTokens(components: unknown): { tokens: string[]; named: boolean } {
  const list = Array.isArray(components) ? components : []
  const body = list.find((c: any) => String(c?.type).toUpperCase() === 'BODY')
  const text = typeof (body as any)?.text === 'string' ? (body as any).text : ''
  const raw = [...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1])
  const named = raw.some((t) => !/^\d+$/.test(t))
  const ordered = named ? raw : [...raw].sort((a, b) => Number(a) - Number(b))
  const tokens: string[] = []
  for (const t of ordered) if (!tokens.includes(t)) tokens.push(t) // a Meta conta 1x cada variável
  return { tokens, named }
}

/** Monta os `parameters` do BODY a partir do template aprovado + valores por nome. */
export function buildBodyParams(components: unknown, values: Record<string, string>): any[] {
  const { tokens, named } = templateBodyTokens(components)
  return tokens.map((tok) => {
    const p: any = { type: 'text', text: values[tok] || EMPTY_PARAM_PLACEHOLDER }
    if (named) p.parameter_name = tok
    return p
  })
}

/** Texto do template com as variáveis trocadas — para registrar o que o cliente recebeu. */
export function renderTemplateText(components: unknown, values: Record<string, string>): string {
  const list = Array.isArray(components) ? components : []
  const body = list.find((c: any) => String(c?.type).toUpperCase() === 'BODY')
  const text = typeof (body as any)?.text === 'string' ? (body as any).text : ''
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, tok: string) => values[tok] || EMPTY_PARAM_PLACEHOLDER)
    || '[template]'
}
