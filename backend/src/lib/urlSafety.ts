// SSRF protection — bloqueia URLs apontando para rede interna/metadata
export function isInternalUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    if (host.endsWith('.local') || host.endsWith('.internal')) return true
    const parts = host.split('.').map(Number)
    if (parts.length === 4 && !parts.some(isNaN)) {
      if (parts[0] === 10) return true
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
      if (parts[0] === 192 && parts[1] === 168) return true
      if (parts[0] === 169 && parts[1] === 254) return true
      if (parts[0] === 127) return true
    }
    if (!['http:', 'https:'].includes(u.protocol)) return true
    return false
  } catch { return true }
}
