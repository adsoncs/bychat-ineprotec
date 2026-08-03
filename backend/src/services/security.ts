import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

// ── CONFIG ──────────────────────────────────────
// Bloqueio de IP por falha de login.
//
// O contador NÃO é por IP puro. Escola, escritório e clínica saem todos por um
// único IP (NAT): contando por IP, uma pessoa que esqueceu a senha derruba os
// colegas por 24h — foi o que aconteceu no Colégio Severiano em 03/08/2026,
// quando 5 erros da mesma usuária tiraram o prédio inteiro do ar.
//
// O que distingue "alguém esqueceu a senha" de "alguém está atacando" não é o
// número de falhas, é a VARIEDADE: um invasor varre vários e-mails, um usuário
// legítimo erra sempre o mesmo. Por isso o IP só é bloqueado quando há muitos
// e-mails distintos falhando, ou um volume de falhas alto demais para ser gente.
//
// Quem erra a própria senha continua protegido pelo que já existia e é mais
// preciso: rate limit por e-mail (checkEmailRateLimit) e auto-lock da conta em
// 10 tentativas (routes/users.ts) — ambos atingem a CONTA, não a rede.
const LOGIN_FAIL_WINDOW = 10        // minutos (janela de observação)
const LOGIN_FAIL_LIMIT = 5          // falhas do MESMO e-mail no MESMO IP → só registra alerta
const LOGIN_DISTINCT_EMAILS = 4     // e-mails distintos falhando no mesmo IP → enumeração
const LOGIN_TOTAL_FAIL_LIMIT = 25   // falhas totais no mesmo IP → volume não-humano
const LOGIN_BLOCK_DURATION = 1440   // minutos de bloqueio automático (24h)

const RATE_LIMIT_WINDOW = 60     // segundos (TTL do Redis)
const RATE_LIMIT_API = 500       // requests/min para APIs gerais
const RATE_LIMIT_AUTH = 2000     // requests/min para requests autenticadas (admin com várias abas + polling)
const RATE_LIMIT_LOGIN = 10      // requests/min para login
const RATE_LIMIT_TRACKING = 120  // requests/min para endpoints de tracking
const RATE_LIMIT_REDIRECT = 60   // requests/min para redirecionamentos
const RATE_BLOCK_DURATION = 15   // minutos de bloqueio por rate limit

// IPs imunes a bloqueio automático (loopback + redes privadas RFC1918)
// Evita auto-tiro-no-pé do servidor / scripts internos
const IMMUNE_IP_PATTERNS = [
  /^127\./,              // loopback IPv4
  /^::1$/,               // loopback IPv6
  /^::ffff:127\./,       // IPv4-mapped loopback
  /^10\./,               // RFC1918 private
  /^192\.168\./,         // RFC1918 private
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC1918 172.16.0.0/12
  /^fc00:/i, /^fd/i,     // ULA IPv6
  /^fe80:/i,             // link-local IPv6
]

function isImmuneIp(ip: string): boolean {
  return IMMUNE_IP_PATTERNS.some(p => p.test(ip))
}

// ── REDIS KEY PREFIXES ─────────────────────────
const REDIS_PREFIX = 'sec:'
const RATE_KEY = `${REDIS_PREFIX}rate:`
const AUTH_RATE_KEY = `${REDIS_PREFIX}authrate:`
const TRACK_RATE_KEY = `${REDIS_PREFIX}trackrate:`
const REDIR_RATE_KEY = `${REDIS_PREFIX}redirrate:`
const LOGIN_FAIL_KEY = `${REDIS_PREFIX}loginfail:`
const BLOCKED_IPS_KEY = `${REDIS_PREFIX}blocked_ips`
const JWT_BLACKLIST_KEY = `${REDIS_PREFIX}jwt_blacklist:`

// ── SUSPICIOUS PATTERNS ─────────────────────────
const SUSPICIOUS_PATHS = [
  /\.\.\//,                        // path traversal
  /\/etc\/passwd/i,
  /\/proc\//i,
  /\.(env|git|htaccess|htpasswd)/i,
  /wp-admin|wp-login|wp-content|xmlrpc\.php/i, // wordpress probes
  /phpmyadmin|phpinfo|adminer/i,
  /\.asp|\.aspx|\.jsp/i,
  /\/admin\.php/i,
  // Probes /shell, /cmd, /exec — exige fim de path/segment ou extensão
  // (.php/.cgi/.exe...). Sem essa âncora, "casava" com paths legítimos como
  // /workflows/:id/execution-stats, /activities/:id/execute, /executions.
  /\/(shell|cmd|exec)(?:\.[a-z0-9]+)?(?:[/?#]|$)/i,
  /\/\.aws|\/\.ssh|\/\.docker/i,   // cloud/dev secrets
  /\/wp-json\/wp\/v2\/users/i,     // WP user enumeration
  /\/cgi-bin\//i,                  // legacy CGI probes
]

const SQL_INJECTION_PATTERNS = [
  /(\bunion\b\s+(all\s+)?\bselect\b)/i,
  /(\bor\b\s+\d+\s*=\s*\d+)/i,
  /(\band\b\s+\d+\s*=\s*\d+)/i,
  /(--\s|--$|\/\*[\s\S]*?\*\/)/,             // SQL comments (excluindo "--" sozinho que dá false positive)
  /(\bdrop\b\s+(table|database|schema)\b)/i,
  /(\binsert\b\s+\binto\b)/i,
  /(\bdelete\b\s+\bfrom\b)/i,
  /(\bexec\b.*\bxp_)/i,
  /(\bselect\b.*\bfrom\b.*\bwhere\b)/i,
  /(\bwaitfor\b\s+\bdelay\b)/i,              // MSSQL time-based blind
  /(\bsleep\s*\(\s*\d+\s*\))/i,              // MySQL time-based blind
  /(\bbenchmark\s*\(\s*\d+)/i,               // MySQL time-based blind
  /(\bload_file\s*\()/i,                     // MySQL file read
  /(\bextractvalue\s*\()/i,                  // MySQL XPath injection
  /(\binformation_schema\b)/i,
  /(0x[0-9a-f]{20,})/i,                      // Hex-encoded payloads longos
]

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript:[^"'`\s]/i,
  /on(error|load|click|mouseover|focus|blur|submit|change|toggle)\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /<svg[^>]*on\w+\s*=/i,            // <svg onload=...>
  /eval\s*\(/i,
  /document\.(cookie|domain|location)/i,
  /window\.(location|document)/i,
  /\bexpression\s*\(/i,             // CSS expression()
  /\balert\s*\(/i,                  // alert(1) — clássico de PoC
]

const COMMAND_INJECTION_PATTERNS = [
  /[;&|]\s*(ls|cat|wget|curl|nc|bash|sh|chmod|chown|rm|mv|cp|ping|nslookup|dig|whoami|id|uname|ps|netstat|ifconfig)\b/i,
  /\$\(\s*[a-z]/i,                   // $(cmd...)
  /`[^`]{2,}`/,                       // `cmd...`
  /\|\s*(nc|netcat|bash|sh|telnet)\b/i,
  /&&\s*(wget|curl|nc|bash|sh)\b/i,
  /\/dev\/(tcp|udp)\//i,
]

const NOSQL_INJECTION_PATTERNS = [
  /\$where\s*[:=]/i,
  /\$ne\s*[:=]/i,
  /\$gt\s*[:=]/i,
  /\$lt\s*[:=]/i,
  /\$regex\s*[:=]/i,
  /\$or\s*[:=]\s*\[/i,
  /\$nin\s*[:=]/i,
]

// Scanners e ferramentas de pentest conhecidas (substring case-insensitive)
const SUSPICIOUS_UA = [
  /sqlmap/i, /nikto/i, /nmap/i, /masscan/i, /zgrab/i,
  /dirbuster/i, /gobuster/i, /wfuzz/i, /ffuf/i, /dirb/i,
  /hydra/i, /medusa/i, /patator/i,
  /burpsuite/i, /burp\s/i, /metasploit/i, /paros/i,
  /wpscan/i, /joomscan/i, /droopescan/i,
  /acunetix/i, /qualys/i, /openvas/i, /nessus/i, /nexpose/i,
  /w3af/i, /arachni/i, /skipfish/i, /webinspect/i, /appscan/i, /netsparker/i,
  /grabber/i, /fimap/i, /sqlsus/i, /sqlninja/i, /havij/i,
]

// ── CACHE DE IPS BLOQUEADOS (Redis Set) ─────────
export async function refreshBlockedIpsCache() {
  const now = new Date()
  const blocks = await prisma.ipBlock.findMany({
    where: {
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    select: { ip: true }
  })
  const pipeline = redis.pipeline()
  pipeline.del(BLOCKED_IPS_KEY)
  if (blocks.length > 0) {
    pipeline.sadd(BLOCKED_IPS_KEY, ...blocks.map(b => b.ip))
  }
  await pipeline.exec()
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  try {
    return (await redis.sismember(BLOCKED_IPS_KEY, ip)) === 1
  } catch {
    return false
  }
}

// ── LOG DE EVENTOS ──────────────────────────────
export async function logSecurityEvent(data: {
  ip: string
  type: string
  severity: string
  email?: string
  userAgent?: string
  path?: string
  details?: string
}) {
  try {
    await prisma.securityEvent.create({ data })
  } catch (e) {
    console.error('[Security] Failed to log event:', e)
  }
}

// ── BLOQUEIO DE IP ──────────────────────────────
export async function blockIp(ip: string, reason: string, durationMinutes?: number, details?: string, createdBy?: string) {
  // IPs internos/loopback nunca são bloqueados automaticamente
  if (!createdBy && isImmuneIp(ip)) {
    console.warn(`[Security] Ignorando bloqueio automático de IP imune: ${ip} (motivo: ${reason})`)
    return
  }
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null

  // Dedup: se já existe bloqueio ativo do mesmo (ip, reason), apenas estende a validade
  // (evita poluir auditoria com 6+ registros idênticos quando o admin clica várias vezes
  // ou quando rate-limit dispara em rajada).
  const existing = await prisma.ipBlock.findFirst({
    where: { ip, reason, active: true }
  })
  if (existing) {
    const keepLonger = !expiresAt || (existing.expiresAt && existing.expiresAt > expiresAt)
    await prisma.ipBlock.update({
      where: { id: existing.id },
      data: {
        expiresAt: keepLonger ? existing.expiresAt : expiresAt,
        details: details ?? existing.details,
      }
    })
  } else {
    await prisma.ipBlock.create({
      data: {
        ip,
        reason,
        details,
        auto: !createdBy,
        expiresAt,
        active: true,
        createdBy
      }
    })
  }
  await redis.sadd(BLOCKED_IPS_KEY, ip)
}

/** Bloqueia IP PERMANENTEMENTE (sem expiração). Usado para ataques sérios
 * (SQL injection, XSS, scanner UA, etc.) — só desbloqueio manual via painel. */
export async function permanentBlockIp(ip: string, reason: string, details: string) {
  await blockIp(ip, reason, undefined, details)
}

// ── DETECÇÃO: LOGIN (Redis) ─────────────────────
export async function onLoginFail(ip: string, email?: string, userAgent?: string) {
  await logSecurityEvent({
    ip, type: 'login_fail', severity: 'medium',
    email, userAgent, path: '/api/admin/login',
    details: `Tentativa de login falhada para ${email || 'email não informado'}`
  })

  const who = (email || 'sem-email').toLowerCase().trim()
  const ttl = LOGIN_FAIL_WINDOW * 60

  // Três contadores na janela: falhas deste par (ip,email), total de falhas do
  // IP e quantos e-mails distintos falharam nele.
  const pairKey = `${LOGIN_FAIL_KEY}${ip}:${who}`
  const totalKey = `${LOGIN_FAIL_KEY}total:${ip}`
  const emailsKey = `${LOGIN_FAIL_KEY}emails:${ip}`

  const pairCount = await redis.incr(pairKey)
  if (pairCount === 1) await redis.expire(pairKey, ttl)

  const totalCount = await redis.incr(totalKey)
  if (totalCount === 1) await redis.expire(totalKey, ttl)

  await redis.sadd(emailsKey, who)
  await redis.expire(emailsKey, ttl)
  const distinctEmails = await redis.scard(emailsKey)

  // ── Ataque: vários e-mails diferentes ou volume alto no mesmo IP ──
  const isEnumeration = distinctEmails >= LOGIN_DISTINCT_EMAILS
  const isFlood = totalCount >= LOGIN_TOTAL_FAIL_LIMIT
  if (isEnumeration || isFlood) {
    const motivo = isEnumeration
      ? `${distinctEmails} e-mails diferentes tentados`
      : `${totalCount} falhas no mesmo IP`
    await blockIp(ip, 'brute_force', LOGIN_BLOCK_DURATION,
      `Bloqueio automático: ${motivo} em ${LOGIN_FAIL_WINDOW}min`)
    await logSecurityEvent({
      ip, type: 'brute_force', severity: 'critical',
      email, userAgent, path: '/api/admin/login',
      details: `IP bloqueado por ${LOGIN_BLOCK_DURATION}min — ${motivo}`
    })
    await redis.del(pairKey, totalKey, emailsKey)
    return
  }

  // ── Mesma conta errando muito: registra, mas NÃO bloqueia o IP ──
  // A conta já é protegida por rate limit de e-mail e auto-lock em 10 tentativas.
  // Bloquear o IP aqui puniria toda a rede pelo esquecimento de uma pessoa.
  if (pairCount === LOGIN_FAIL_LIMIT) {
    await logSecurityEvent({
      ip, type: 'login_fail_repeated', severity: 'medium',
      email, userAgent, path: '/api/admin/login',
      details: `${pairCount} falhas seguidas de ${who} neste IP — provável senha esquecida (IP não bloqueado)`
    })
  }
}

export async function onLoginSuccess(ip: string, email: string, userAgent?: string) {
  const who = (email || '').toLowerCase().trim()
  // Zera o contador DESTE usuário e o remove do conjunto de e-mails que
  // falharam. O total do IP não é zerado: quem acertou a própria senha não
  // deve limpar o rastro de um ataque que esteja em curso na mesma rede.
  await redis.del(`${LOGIN_FAIL_KEY}${ip}:${who}`)
  await redis.srem(`${LOGIN_FAIL_KEY}emails:${ip}`, who)
  await logSecurityEvent({
    ip, type: 'login_success', severity: 'low',
    email, userAgent, path: '/api/admin/login',
    details: `Login bem-sucedido`
  })
}

// ── DETECÇÃO: RATE LIMIT (Redis) ────────────────
async function checkRate(prefix: string, ip: string, limit: number): Promise<boolean> {
  try {
    const key = `${prefix}${ip}`
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW)
    }
    return count > limit
  } catch (err) {
    // Redis indisponível — bloquear request por segurança (fail-closed)
    console.error('[Security] Redis rate-limit check failed — blocking request:', (err as Error).message)
    return true
  }
}

export async function checkRateLimit(ip: string, isLogin: boolean): Promise<boolean> {
  const limit = isLogin ? RATE_LIMIT_LOGIN : RATE_LIMIT_API
  return checkRate(RATE_KEY + (isLogin ? 'login:' : 'api:'), ip, limit)
}

export async function checkAuthRateLimit(ip: string): Promise<boolean> {
  return checkRate(AUTH_RATE_KEY, ip, RATE_LIMIT_AUTH)
}

export async function checkTrackingRateLimit(ip: string, type: 'tracking' | 'redirect'): Promise<boolean> {
  const prefix = type === 'tracking' ? TRACK_RATE_KEY : REDIR_RATE_KEY
  const limit = type === 'tracking' ? RATE_LIMIT_TRACKING : RATE_LIMIT_REDIRECT
  return checkRate(prefix, ip, limit)
}

export async function onRateLimitExceeded(ip: string, path: string, userAgent?: string) {
  await logSecurityEvent({
    ip, type: 'rate_limit', severity: 'high',
    userAgent, path,
    details: `Rate limit excedido em ${path}`
  })

  // Auto-block if rate limit exceeded many times
  const recentEvents = await prisma.securityEvent.count({
    where: {
      ip,
      type: 'rate_limit',
      createdAt: { gt: new Date(Date.now() - 5 * 60_000) }
    }
  })

  if (recentEvents >= 5) {
    await blockIp(ip, 'rate_limit', RATE_BLOCK_DURATION,
      `Bloqueio automático: rate limit excedido ${recentEvents}x em 5min`)
  }
}

// ── JWT BLACKLIST (Redis) ───────────────────────
export async function blacklistToken(jti: string, expiresInSeconds: number) {
  await redis.set(`${JWT_BLACKLIST_KEY}${jti}`, '1', 'EX', expiresInSeconds)
}

export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  return (await redis.exists(`${JWT_BLACKLIST_KEY}${jti}`)) === 1
}

// ── DETECÇÃO: PAYLOADS MALICIOSOS ───────────────
// Política: ataques sérios (SQL/XSS/path traversal/scanner/command injection)
// disparam bloqueio PERMANENTE de IP na 1ª tentativa. Só desbloqueio manual
// via painel. IPs imunes (loopback / RFC1918) ficam isentos no `blockIp`.
export async function analyzeRequest(ip: string, path: string, userAgent: string, body?: any): Promise<{ blocked: boolean; reason?: string }> {
  // Scanner UA → BLOQUEIA REQUEST + IP PERMANENTE
  for (const pattern of SUSPICIOUS_UA) {
    if (pattern.test(userAgent)) {
      const ua200 = userAgent.substring(0, 200)
      await logSecurityEvent({
        ip, type: 'suspicious_ua', severity: 'critical',
        userAgent, path,
        details: `Scanner detectado: ${ua200}`
      })
      await permanentBlockIp(ip, 'scanner_ua', `Scanner: ${ua200}`)
      return { blocked: true, reason: 'suspicious_ua' }
    }
  }

  // Path traversal / probes → BLOQUEIA + IP PERMANENTE
  for (const pattern of SUSPICIOUS_PATHS) {
    if (pattern.test(path)) {
      const path200 = path.substring(0, 200)
      await logSecurityEvent({
        ip, type: 'path_traversal', severity: 'critical',
        userAgent, path,
        details: `Tentativa de acesso suspeito: ${path200}`
      })
      await permanentBlockIp(ip, 'path_traversal', `Probe em: ${path200}`)
      return { blocked: true, reason: 'path_traversal' }
    }
  }

  const checkStr = `${path} ${JSON.stringify(body || '')}`

  // SQL injection → BLOQUEIA + IP PERMANENTE
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(checkStr)) {
      await logSecurityEvent({
        ip, type: 'sql_injection', severity: 'critical',
        userAgent, path,
        details: `SQL injection detectado (pattern ${pattern.source.substring(0, 60)})`
      })
      await permanentBlockIp(ip, 'sql_injection', `Pattern: ${pattern.source.substring(0, 100)}`)
      return { blocked: true, reason: 'sql_injection' }
    }
  }

  // XSS → BLOQUEIA + IP PERMANENTE
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(checkStr)) {
      await logSecurityEvent({
        ip, type: 'xss_attempt', severity: 'critical',
        userAgent, path,
        details: `XSS detectado (pattern ${pattern.source.substring(0, 60)})`
      })
      await permanentBlockIp(ip, 'xss_attempt', `Pattern: ${pattern.source.substring(0, 100)}`)
      return { blocked: true, reason: 'xss_attempt' }
    }
  }

  // Command injection → BLOQUEIA + IP PERMANENTE
  for (const pattern of COMMAND_INJECTION_PATTERNS) {
    if (pattern.test(checkStr)) {
      await logSecurityEvent({
        ip, type: 'command_injection', severity: 'critical',
        userAgent, path,
        details: `Command injection detectado (pattern ${pattern.source.substring(0, 60)})`
      })
      await permanentBlockIp(ip, 'command_injection', `Pattern: ${pattern.source.substring(0, 100)}`)
      return { blocked: true, reason: 'command_injection' }
    }
  }

  // NoSQL injection → BLOQUEIA + IP PERMANENTE
  for (const pattern of NOSQL_INJECTION_PATTERNS) {
    if (pattern.test(checkStr)) {
      await logSecurityEvent({
        ip, type: 'nosql_injection', severity: 'critical',
        userAgent, path,
        details: `NoSQL injection detectado (pattern ${pattern.source.substring(0, 60)})`
      })
      await permanentBlockIp(ip, 'nosql_injection', `Pattern: ${pattern.source.substring(0, 100)}`)
      return { blocked: true, reason: 'nosql_injection' }
    }
  }

  return { blocked: false }
}

// ── CLEANUP PERIÓDICO ───────────────────────────
export function startSecurityCleanup() {
  // Desativar bloqueios expirados a cada 1min e sincronizar cache Redis
  setInterval(async () => {
    try {
      await prisma.ipBlock.updateMany({
        where: {
          active: true,
          expiresAt: { not: null, lte: new Date() }
        },
        data: { active: false }
      })
      await refreshBlockedIpsCache()
    } catch (e) {
      console.error('[Security] Cleanup error:', e)
    }
  }, 60_000)

  // Refresh inicial
  refreshBlockedIpsCache()
}
