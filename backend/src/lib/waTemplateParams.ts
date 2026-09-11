// Parâmetros de template (HSM) da WhatsApp Cloud API.
//
// A Meta aceita dois formatos e recusa a mensagem inteira se vier o errado:
//   • posicional — {{1}}, {{2}}: cada parâmetro é só { type, text }, na ordem;
//   • nomeado    — {{nome}}:     cada parâmetro exige também `parameter_name`.
// Enviar posicional num template nomeado derruba com #132000, e o disparo se
// perde silenciosamente do ponto de vista de quem configurou o fluxo.
//
// ── O buraco entre os dois formatos ─────────────────────────────────────────
//
// Quem chama conhece os valores POR NOME (`nome`, `reuniao`, `quando`, `link`).
// Num template posicional os tokens são "1", "2", "3", "4": procurar `values["1"]`
// não acha nada, e todo parâmetro caía no placeholder.
//
// O resultado chegava ao cliente assim, em 11/09/2026, no beyond:
//
//     Olá, —!
//     Recebemos o seu agendamento da *—* para — 📅
//     Acesse pelo link no horário marcado: —
//
// A Meta aceitou, o envio "deu certo", e ninguém soube — o operador teve de
// refazer a conversa na mão. Por isso `ordemPosicional` existe: quem chama diz
// em que ordem os seus nomes entram nos {{1}}..{{n}} daquele template.
//
// E por isso `faltando` existe: parâmetro sem valor não é detalhe de formatação,
// é a mensagem errada saindo. Quem envia decide o que fazer — mas agora SABE.

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

/**
 * Valor de um token do template.
 *
 * Nomeado: o token JÁ é o nome. Posicional: `{{1}}` é o primeiro nome de
 * `ordemPosicional`, `{{2}}` o segundo, e assim por diante — é o único jeito de
 * ligar "o que o código sabe" a "o que a Meta aprovou". Aceita também um mapa
 * que já venha com as chaves numéricas, para quem monta os valores na mão.
 */
function valorDoToken(
  token: string,
  named: boolean,
  values: Record<string, string>,
  ordemPosicional?: string[],
): string {
  const direto = values[token]
  if (direto) return direto
  if (named || !ordemPosicional) return ''
  const nome = ordemPosicional[Number(token) - 1]
  return (nome && values[nome]) || ''
}

export interface BodyParams {
  /** O que vai no `components[].parameters` da Cloud API. */
  params: any[]
  /** Tokens que ficaram sem valor. Vazio = a mensagem sai inteira. */
  faltando: string[]
}

/**
 * Monta os `parameters` do BODY a partir do template aprovado + valores por nome.
 *
 * `ordemPosicional` nomeia, em ordem, o que preenche {{1}}, {{2}}… num template
 * posicional. Sem ela, um template posicional não tem como ser preenchido — e é
 * isso que `faltando` denuncia.
 */
export function buildBodyParams(
  components: unknown,
  values: Record<string, string>,
  ordemPosicional?: string[],
): BodyParams {
  const { tokens, named } = templateBodyTokens(components)
  const faltando: string[] = []
  const params = tokens.map((tok) => {
    const valor = valorDoToken(tok, named, values, ordemPosicional)
    if (!valor) faltando.push(tok)
    const p: any = { type: 'text', text: valor || EMPTY_PARAM_PLACEHOLDER }
    if (named) p.parameter_name = tok
    return p
  })
  return { params, faltando }
}

/** Texto do template com as variáveis trocadas — para registrar o que o cliente recebeu. */
export function renderTemplateText(
  components: unknown,
  values: Record<string, string>,
  ordemPosicional?: string[],
): string {
  const list = Array.isArray(components) ? components : []
  const body = list.find((c: any) => String(c?.type).toUpperCase() === 'BODY')
  const text = typeof (body as any)?.text === 'string' ? (body as any).text : ''
  const { named } = templateBodyTokens(components)
  return text.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m: string, tok: string) =>
    valorDoToken(tok, named, values, ordemPosicional) || EMPTY_PARAM_PLACEHOLDER,
  ) || '[template]'
}
