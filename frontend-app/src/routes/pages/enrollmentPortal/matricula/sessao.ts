// Matrícula interna: as abas falam com as MESMAS rotas públicas do portal (cobrança,
// valor personalizado, documentos), com o token de atendimento `interno`. Assim
// nenhuma regra é duplicada no painel. Os tokens ficam só em memória, por inscrição.
import { api } from '@/lib/apiClient'

export interface SessaoInterna { candidateCode: string; slug: string; candidateToken: string; atendenteToken: string; expiraEm: number }

const sessoes = new Map<number, SessaoInterna>()

export async function sessaoInterna(registrationId: number, nova = false): Promise<SessaoInterna> {
  const s = sessoes.get(registrationId)
  if (!nova && s && s.expiraEm - Date.now() > 5 * 60_000) return s
  const r = await api.get<SessaoInterna>(`/admin/matricula-interna/${registrationId}/sessao`)
  sessoes.set(registrationId, r)
  return r
}

/** `caminho` recebe a sessão, porque quase todo endereço leva o código da inscrição. */
export async function chamarComoAgente<T>(
  registrationId: number,
  caminho: (s: SessaoInterna) => string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const tentar = async (nova: boolean): Promise<Response> => {
    const s = await sessaoInterna(registrationId, nova)
    const headers: Record<string, string> = { Authorization: `Bearer ${s.candidateToken}`, 'X-Attrae-Atendente': s.atendenteToken }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(`/api${caminho(s)}`, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'omit',
      ...(init.form ? { body: init.form } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  }
  let r = await tentar(false)
  if (r.status === 401) r = await tentar(true)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as any)?.error || `Erro ${r.status}`)
  return d as T
}

export const rotaInscricao = (s: SessaoInterna) => `/public/registrations/${encodeURIComponent(s.candidateCode)}`
