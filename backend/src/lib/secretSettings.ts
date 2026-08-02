// Segredos guardados em `Setting` (Configurações › APIs / Integrações).
//
// Chave de API, client_secret e token de app ficavam legíveis na tabela: quem
// tivesse SELECT levava, de uma vez, o acesso à Anthropic, OpenAI, Evolution,
// Resend, Google, Meta e Instagram do cliente. A criptografia já existia no
// produto (AES-256-GCM em services/cloudApi.ts, usada para Cloud API, gateways
// de pagamento e OAuth do Google) — faltava alcançar as Settings.
//
// A cifragem é aplicada por middleware do Prisma (lib/prisma.ts), não em cada
// call site: são dezenas de pontos lendo `Setting` por todo o backend, e um
// esquecido significaria segredo em claro de novo, sem ninguém perceber.

import { encryptToken, decryptToken } from '../services/cloudApi.js'

/** Prefixo do envelope. Distingue valor cifrado de valor legado em claro. */
export const SECRET_PREFIX = 'enc:v1:'

/**
 * Uma chave é secreta pelo NOME, não por lista fechada: integração nova entra
 * protegida por padrão. `ai.default_provider` ou `smtp.from_email` não casam;
 * `*.api_key`, `*_secret`, `*.access_token` casam.
 */
const SECRET_PATTERNS: RegExp[] = [
  /api[_.]?key$/i,
  /(^|[._])secret$/i,
  /access[_.]?token$/i,
  /(^|[._])password$/i,
  /developer[_.]?token$/i,
  /(^|[._])token$/i,
  /evolution[_.]?key$/i,
  /webhook[_.]?secret$/i,
]

/** Chaves que casam o padrão mas NÃO são segredo (evita cifrar número/flag). */
const NOT_SECRET = new Set<string>([
  'ai.chat_max_tokens',
  'ai.analysis_max_tokens',
  'ai.journey_max_tokens',
  'chatbot.takeover_auto_resume_hours',
])

export function isSecretSettingKey(key: unknown): boolean {
  if (typeof key !== 'string' || !key) return false
  if (NOT_SECRET.has(key)) return false
  return SECRET_PATTERNS.some((re) => re.test(key))
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX)
}

/**
 * Cifra o valor de um Setting secreto.
 *
 * `Setting.value` é JSON: o conteúdo real quase sempre é a string com aspas
 * (`"sk-ant-..."`). Serializamos o valor inteiro antes de cifrar para devolver
 * exatamente o mesmo tipo na leitura — string, número ou objeto.
 *
 * Sem CLOUD_API_TOKEN_KEY configurada não dá para cifrar: devolvemos o valor
 * como veio (o produto segue funcionando) e avisamos no log. Falhar aqui
 * quebraria o salvamento de qualquer configuração.
 */
export function encryptSettingValue(value: unknown): unknown {
  if (value == null || isEncrypted(value)) return value
  try {
    return SECRET_PREFIX + encryptToken(JSON.stringify(value))
  } catch (e: any) {
    console.warn(`[secretSettings] não foi possível cifrar (${e?.message}) — valor mantido em claro`)
    return value
  }
}

/** Decifra o valor lido. Valor legado (em claro) passa direto. */
export function decryptSettingValue(value: unknown): unknown {
  if (!isEncrypted(value)) return value
  try {
    return JSON.parse(decryptToken((value as string).slice(SECRET_PREFIX.length)))
  } catch (e: any) {
    // Chave trocada/perdida: melhor devolver vazio do que o envelope cru, que
    // vazaria para a UI e seria enviado como se fosse a credencial.
    console.error(`[secretSettings] falha ao decifrar: ${e?.message}`)
    return ''
  }
}
