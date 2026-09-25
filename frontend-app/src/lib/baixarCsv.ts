import { env } from './env'

/** Baixa um arquivo de uma rota autenticada da API (o link direto não leva o token). */
export async function baixarCsv(caminho: string, nome: string): Promise<void> {
  let token: string | null = null
  try { token = localStorage.getItem(env.authTokenKey) } catch { token = null }
  const r = await fetch(`${env.apiBase}${caminho}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!r.ok) throw new Error(`Não foi possível exportar (HTTP ${r.status})`)
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
