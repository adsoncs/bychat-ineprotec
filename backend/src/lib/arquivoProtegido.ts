// src/lib/arquivoProtegido.ts
//
// Documentos de candidato e contratos deixam de ser públicos.
//
// Até 21/10/2026, /uploads/enrollment-docs e /uploads/contratos eram estáticos
// abertos: quem tivesse o link baixava RG, diploma e contrato sem login — e o
// contrato gerado na efetivação tinha nome previsível (contrato-{aluno}-{env}).
// Nenhuma trava de tela ou de portal alcança um arquivo servido assim.
//
// Agora o link só abre ASSINADO:
//   • toda resposta da API que contém um desses caminhos sai com o link
//     assinado (`?acesso=<expira>.<assinatura>`), válido por algumas horas.
//     Quem recebeu a resposta já passou pela trava da rota — e é exatamente
//     quem pode abrir o arquivo;
//   • o estático recusa (404) o pedido sem assinatura válida.
// Quem lê o arquivo por dentro (SEI, PDF assinado, revisão por IA) vai direto
// ao disco e não passa por aqui.

import crypto from 'node:crypto'

const PROTEGIDOS = /^\/uploads\/(enrollment-docs|contratos)\//
const VALIDADE_MS = 6 * 3600_000
// Caminho protegido dentro de um texto (JSON/CSV), absoluto ou relativo, com
// ou sem assinatura antiga — a antiga é trocada pela nova.
const NO_TEXTO = /((?:https?:\/\/[^"'\s<>]*?)?\/uploads\/(?:enrollment-docs|contratos)\/[A-Za-z0-9._-]+)(?:\?acesso=[A-Za-z0-9._-]+)?/g

function segredo(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET ausente')
  return s
}

function assinar(caminho: string, expira: number): string {
  return crypto.createHmac('sha256', segredo()).update(`${caminho}|${expira}`).digest('base64url').slice(0, 32)
}

/** O caminho (/uploads/...) de uma URL absoluta ou relativa. */
function caminhoDe(url: string): string {
  try { return new URL(url, 'http://local').pathname } catch { return url.split('?')[0]! }
}

export function ehProtegido(caminho: string): boolean {
  return PROTEGIDOS.test(caminho)
}

/** Link assinado para um arquivo protegido. Outro arquivo volta como veio. */
export function linkAssinado(url: string, agora = Date.now()): string {
  const base = url.split('?')[0]!
  const caminho = caminhoDe(base)
  if (!ehProtegido(caminho)) return url
  // Janela arredondada: respostas próximas geram o mesmo link (cache do navegador).
  const expira = Math.ceil((agora + VALIDADE_MS) / 600_000) * 600_000
  return `${base}?acesso=${expira}.${assinar(caminho, expira)}`
}

/** Assina todo caminho protegido que aparecer num texto (corpo de resposta). */
export function assinarLinksNoTexto(texto: string): string {
  if (!texto.includes('/uploads/enrollment-docs/') && !texto.includes('/uploads/contratos/')) return texto
  return texto.replace(NO_TEXTO, (_m, url: string) => linkAssinado(url))
}

/** O pedido ao estático traz assinatura válida e dentro do prazo? */
export function acessoValido(caminho: string, acesso: string | undefined, agora = Date.now()): boolean {
  if (!acesso) return false
  const [exp, sig] = acesso.split('.')
  const expira = Number(exp)
  if (!Number.isFinite(expira) || expira < agora || !sig) return false
  const esperado = assinar(caminho, expira)
  return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))
}
