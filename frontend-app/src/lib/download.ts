import { env } from './env'

/**
 * Download autenticado de arquivo da API.
 * fetch + blob → click invisível em <a download>. Necessário porque
 * window.open não envia o header Authorization Bearer.
 */
export async function downloadFile(
  path: string,
  filename: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<void> {
  const token = localStorage.getItem(env.authTokenKey)
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')

  const init: RequestInit = { method: options.method ?? 'GET', headers }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)
  const res = await fetch(path.startsWith('http') ? path : `${env.apiBase}${path}`, init)

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const text = await res.text()
      const data: unknown = JSON.parse(text)
      if (data && typeof data === 'object' && 'error' in data) {
        msg = String((data).error)
      }
    } catch { /* mantém msg HTTP */ }
    throw new Error(msg)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 100)
}
