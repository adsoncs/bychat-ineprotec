// src/lib/appUrl.ts
//
// O endereço deste painel, num lugar só.
//
// Cada ponto que montava um link tinha o seu próprio
// `process.env.APP_URL || 'https://bychat.ia.br'`. Eram 8 cópias do mesmo
// fallback, e o valor nelas era o domínio ANTERIOR à migração para o attrae:
// num tenant sem `APP_URL` o cliente receberia link de recuperação de senha, do
// portal e das preferências (LGPD) apontando para um domínio que pode não ser
// mais nosso — e webhooks de WhatsApp cadastrados lá simplesmente não chegariam.
//
// Não existe fallback aqui de propósito. Endereço de painel não se adivinha:
// quem chama decide o que fazer sem ele — omitir o link (`linhaDoLink`) ou
// recusar a operação (`appUrlObrigatoria`).

/** URL do painel, sem barra final. `null` quando não há `APP_URL` no .env. */
export function appUrl(): string | null {
  const raw = (process.env.APP_URL || '').trim()
  if (!raw) return null
  return raw.replace(/\/$/, '')
}

/**
 * Como `appUrl()`, mas para operações que não fazem sentido sem endereço
 * (inscrever webhook, mandar link por e-mail). Lança com mensagem de operador.
 */
export function appUrlObrigatoria(): string {
  const base = appUrl()
  if (!base) throw new Error('APP_URL não configurada no .env — sem ela não há endereço deste painel para montar o link.')
  return base
}

/** Caminho absoluto no painel (`/painel` → `https://…/painel`), ou `null`. */
export function urlNoPainel(path: string): string | null {
  const base = appUrl()
  if (!base) return null
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Linha pronta para entrar numa mensagem de WhatsApp/e-mail, ou string vazia
 * quando não há endereço — some do texto em vez de virar um link quebrado.
 */
export function linhaDoLink(rotulo: string, path: string): string {
  const url = urlNoPainel(path)
  return url ? `${rotulo} ${url}` : ''
}
