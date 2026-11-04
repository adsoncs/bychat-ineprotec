// Inscrição ASSISTIDA: o atendente abriu este portal pelo painel
// (/portal/<slug>?t=<token>&atendimento=1) para fazer a inscrição com o
// candidato. O token fica só nesta aba (sessionStorage) e vai no cabeçalho
// X-Attrae-Atendente de todo pedido ao servidor — é por ele que o sistema sabe
// quem da equipe fez cada passo, e barra o que só o candidato pode fazer
// (redação, contrato, cartão, senha). Ver backend/src/services/inscricaoAssistida.ts.

const CHAVE = 'attrae_atendimento'
const CABECALHO = 'X-Attrae-Atendente'

export interface DadosDoAtendimento { nome: string; exp: number; leadId: number | null }

function lerPayload(token: string): DadosDoAtendimento | null {
  try {
    const corpo = token.split('.')[0]
    const json = JSON.parse(decodeURIComponent(escape(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')))))
    if (json?.kind !== 'atendimento') return null
    return { nome: String(json.nome || 'Atendente'), exp: Number(json.exp) || 0, leadId: json.leadId ?? null }
  } catch { return null }
}

export function tokenDoAtendimento(): string | null {
  try { return sessionStorage.getItem(CHAVE) } catch { return null }
}

export function emAtendimento(): boolean {
  return !!tokenDoAtendimento()
}

export function dadosDoAtendimento(): DadosDoAtendimento | null {
  const t = tokenDoAtendimento()
  return t ? lerPayload(t) : null
}

// Inscrição em andamento nesta aba (para "Passar para o candidato").
let codigoAtual: string | null = null
const ouvintes = new Set<() => void>()
export function definirInscricaoDoAtendimento(codigo: string | null): void {
  codigoAtual = codigo
  ouvintes.forEach((f) => f())
}
export function inscricaoDoAtendimento(): string | null { return codigoAtual }
export function aoMudarInscricao(f: () => void): () => void { ouvintes.add(f); return () => ouvintes.delete(f) }

/** Chamado uma vez, antes de a tela montar. */
export function iniciarAtendimento(): void {
  try {
    const q = new URLSearchParams(location.search)
    if (q.get('atendimento') === '1') {
      const t = q.get('t') || ''
      if (lerPayload(t)) sessionStorage.setItem(CHAVE, t)
      // A marca sai da URL (o ?t= fica: é ele que abre o formulário certo).
      q.delete('atendimento')
      const resto = q.toString()
      history.replaceState(null, '', `${location.pathname}${resto ? `?${resto}` : ''}${location.hash}`)
    }
  } catch { /* sem sessionStorage: segue como portal comum */ }

  const token = tokenDoAtendimento()
  if (!token) return
  const original = window.fetch.bind(window)
  window.fetch = (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    let alvo: URL | null = null
    try { alvo = new URL(url, location.href) } catch { /* url estranha: não mexe */ }
    if (alvo && alvo.origin === location.origin && alvo.pathname.startsWith('/api/')) {
      const h = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined))
      h.set(CABECALHO, tokenDoAtendimento() || token)
      return original(entrada, { ...init, headers: h })
    }
    return original(entrada, init)
  }
}

export function encerrarAtendimento(): void {
  try { sessionStorage.removeItem(CHAVE) } catch { /* nada */ }
}

/** "Passar para o candidato": o link para ele continuar de onde parou. */
export async function linkParaOCandidato(slug: string): Promise<{ url: string; validadeDias: number; candidato?: { nome?: string | null; whatsapp?: string | null; email?: string | null } | null }> {
  const r = await fetch(`/api/public/portals/${encodeURIComponent(slug)}/atendimento/link`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateCode: codigoAtual }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d?.error || 'Não foi possível gerar o link.')
  return d
}
