// SSRF protection — bloqueia URLs apontando para rede interna/metadata.
// Fonte única (antes havia cópias divergentes em webhooks.ts e make.ts).
import { lookup } from 'dns/promises'

// ── Checagem de IP privado/reservado ────────────────────────────────────
// Cobre IPv4 (notação pontilhada) e IPv6 (loopback, ULA fc00::/7, link-local
// fe80::/10, e mapeados ::ffff:a.b.c.d).
export function ipIsPrivate(ip: string): boolean {
  const addr = ip.toLowerCase().trim()

  // IPv6
  if (addr.includes(':')) {
    if (addr === '::1' || addr === '::') return true
    // IPv4 mapeado em IPv6. O Node normaliza ::ffff:127.0.0.1 para a forma hex
    // ::ffff:7f00:1 — tratamos as duas: dotted e par de hextets.
    if (addr.startsWith('::ffff:')) {
      const rest = addr.slice(7)
      if (rest.includes('.')) return ipIsPrivate(rest)
      const groups = rest.split(':')
      if (groups.length === 2) {
        const hi = parseInt(groups[0], 16), lo = parseInt(groups[1], 16)
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const v4 = [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.')
          return ipIsPrivate(v4)
        }
      }
    }
    const first = addr.split(':')[0]
    // fc00::/7 (ULA) → primeiro hextet fc.. ou fd..
    if (/^f[cd][0-9a-f]{0,2}$/.test(first)) return true
    // fe80::/10 (link-local)
    if (/^fe[89ab][0-9a-f]$/.test(first)) return true
    return false
  }

  // IPv4 pontilhado
  const parts = addr.split('.').map(Number)
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true // link-local + metadata (169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true // multicast/reservado
    return false
  }
  return false
}

// Normaliza hostnames numéricos não-pontilhados (decimal/hex/octal) para IPv4
// pontilhado, para que truques como http://2130706433 (=127.0.0.1) ou
// http://0x7f000001 sejam detectados. Retorna null se não for IPv4 numérico.
function normalizeNumericHost(host: string): string | null {
  let n: number | null = null
  if (/^\d+$/.test(host)) n = parseInt(host, 10)
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16)
  else if (/^0[0-7]+$/.test(host)) n = parseInt(host, 8)
  if (n === null || !Number.isFinite(n) || n < 0 || n > 0xffffffff) return null
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

// Checagem síncrona por hostname/literal de IP. NÃO resolve DNS — para defesa
// completa contra DNS rebinding use assertUrlIsPublic (async).
export function isInternalUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    if (!['http:', 'https:'].includes(u.protocol)) return true

    let host = u.hostname.toLowerCase()
    // IPv6 entre colchetes: remove [ ]
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

    if (!host) return true
    if (host === 'localhost') return true
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true

    // Hostname numérico (decimal/hex/octal) → normaliza p/ IPv4 pontilhado
    const normalized = normalizeNumericHost(host)
    const ipCandidate = normalized || host
    if (ipIsPrivate(ipCandidate)) return true

    return false
  } catch {
    return true
  }
}

// Valida um host "pelado" (sem URL), como o de um conector de banco. Bloqueia
// literais de IP interno e hostnames que resolvem para IP interno.
export async function assertHostIsPublic(host: string): Promise<{ ok: boolean; reason?: string }> {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return { ok: false, reason: 'host vazio' }
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) {
    return { ok: false, reason: 'host interno' }
  }
  const normalized = normalizeNumericHost(h) || h
  if (/^[\d.]+$/.test(normalized) || normalized.includes(':')) {
    return ipIsPrivate(normalized) ? { ok: false, reason: 'IP interno/reservado' } : { ok: true }
  }
  try {
    const records = await lookup(h, { all: true })
    for (const r of records) {
      if (ipIsPrivate(r.address)) return { ok: false, reason: `host resolve para IP interno (${r.address})` }
    }
  } catch {
    return { ok: false, reason: 'falha ao resolver host' }
  }
  return { ok: true }
}

// Verificação completa (async): aplica isInternalUrl E resolve o hostname,
// validando TODOS os IPs resolvidos (impede DNS rebinding e hostnames que
// apontam para IP interno). Use no momento do disparo de requests de saída.
export async function assertUrlIsPublic(urlStr: string): Promise<{ ok: boolean; reason?: string }> {
  if (isInternalUrl(urlStr)) return { ok: false, reason: 'URL aponta para destino interno/reservado' }
  let host: string
  try {
    host = new URL(urlStr).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return { ok: false, reason: 'URL inválida' }
  }
  // Já é literal de IP — isInternalUrl cobriu
  if (/^[\d.]+$/.test(host) || host.includes(':')) return { ok: true }
  try {
    const records = await lookup(host, { all: true })
    for (const r of records) {
      if (ipIsPrivate(r.address)) {
        return { ok: false, reason: `hostname resolve para IP interno (${r.address})` }
      }
    }
  } catch {
    return { ok: false, reason: 'falha ao resolver hostname' }
  }
  return { ok: true }
}
