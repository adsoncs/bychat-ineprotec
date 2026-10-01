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

/**
 * Endereço público de um portal de matrícula: o domínio próprio da instituição
 * quando o portal tem um (`customDomain`), senão o do painel. Links que vão
 * para o aluno precisam sair no MESMO endereço em que ele se inscreveu: a
 * sessão do portal é um cookie do endereço, e um link no domínio do painel o
 * obrigava a entrar de novo.
 */
export function baseDoPortal(customDomain?: string | null): string | null {
  const d = String(customDomain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return d ? `https://${d}` : appUrl()
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
