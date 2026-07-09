import { initObservability, register, httpRequestsTotal, httpRequestDuration, captureException } from './lib/observability.js'
initObservability()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import staticFiles from '@fastify/static'
import multipart from '@fastify/multipart'
import { join, dirname } from 'path'
import { readFileSync } from 'fs'
import { prisma } from './lib/prisma.js'
import { fileURLToPath } from 'url'
import { leadsRoutes } from './routes/leads.js'
import { realtimeRoutes } from './routes/realtime.js'
import { telegramRoutes } from './routes/telegram.js'
import { instagramRoutes, startInstagramTokenRefresher } from './routes/instagram.js'
import { chatRoutes } from './routes/chat.js'
import { statsRoutes } from './routes/stats.js'
import { analyzeRoutes } from './routes/analyze.js'
import { whatsappRoutes } from './routes/whatsapp.js'
import { usersRoutes } from './routes/users.js'
import { stagesRoutes } from './routes/stages.js'
import { kanbanRoutes } from './routes/kanban.js'
import { settingsRoutes } from './routes/settings.js'
import { systemEmailsRoutes } from './routes/systemEmails.js'
import { chatbotsRoutes } from './routes/chatbots.js'
import { instancesRoutes } from './routes/instances.js'
import { funnelsRoutes } from './routes/funnels.js'
import { atendimentoRoutes } from './routes/atendimento.js'
import { transferRequestsRoutes } from './routes/transferRequests.js'
import { leadsImportRoutes } from './routes/leadsImport.js'
import { kommoIntegrationRoutes } from './routes/kommoIntegration.js'
import { teamsRoutes } from './routes/teams.js'
import { agentsRoutes } from './routes/agents.js'
import { channelGovernanceRoutes } from './routes/channelGovernance.js'
import { preferencesRoutes } from './routes/preferences.js'
import { salesCadencesRoutes } from './routes/salesCadences.js'
import { enrollmentPortalsRoutes } from './routes/enrollmentPortals.js'
import { enrollmentPortalPublicRoutes } from './routes/enrollmentPortalPublic.js'
import { candidatePortalRoutes } from './routes/candidatePortal.js'
import { enrollmentDocReviewRoutes } from './routes/enrollmentDocReview.js'
import { enrollmentEvaluationsRoutes } from './routes/enrollmentEvaluations.js'
import { paymentProvidersRoutes } from './routes/paymentProviders.js'
import { paymentsDashboardRoutes } from './routes/paymentsDashboard.js'
import { couponsRoutes } from './routes/coupons.js'
import { leadHistoryRoutes } from './routes/leadHistory.js'
import { activitiesRoutes, startActivityScheduler } from './routes/activities.js'
import { leadAttachmentsRoutes } from './routes/leadAttachments.js'
import { savedFiltersRoutes } from './routes/savedFilters.js'
import { templatesRoutes } from './routes/templates.js'
import { metaRoutes, startMetaLeadPoller } from './routes/meta.js'
import { trackingRoutes } from './routes/tracking.js'
import { pagesRoutes } from './routes/pages.js'
import { formsRoutes } from './routes/forms.js'
import { customFieldsRoutes } from './routes/customFields.js'
import { tagsRoutes } from './routes/tags.js'
import { appearanceRoutes } from './routes/appearance.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { userDashboardsRoutes } from './routes/userDashboards.js'
import { installationsRoutes } from './routes/installations.js'
import { authMiddleware } from './lib/auth.js'
import { isPrimaryInstall } from './lib/install.js'
import { startInactivityChecker } from './services/inactivity.js'
import { backfillUids } from './services/dedup.js'
import { securityRoutes } from './routes/security.js'
import { cloudApiSetupRoutes } from './routes/cloudApiSetup.js'
import { broadcastRoutes } from './routes/broadcast.js'
import { cloudApiWebhookRoutes } from './routes/cloudApiWebhook.js'
import { metaAdsReportRoutes } from './routes/metaAdsReport.js'
import { funnelReportRoutes } from './routes/funnelReport.js'
import { trackableLinksRoutes } from './routes/trackableLinks.js'
import { pixelRoutes } from './routes/pixel.js'
import { educationalRoutes } from './routes/educational.js'
import { modulesRoutes } from './routes/modules.js'
import { salesRoutes } from './routes/sales.js'
import { conversionsRoutes } from './routes/conversions.js'
import { reportsRoutes } from './routes/reports.js'
import { leadExportRoutes } from './routes/leadExport.js'
import { startSaleDetectionScheduler } from './services/saleDetection.js'
import { workflowRoutes } from './routes/workflows.js'
import { queueRoutes } from './routes/queues.js'
import { trashRoutes } from './routes/trash.js'
import { publicApiRoutes } from './routes/publicApi.js'
import { apiKeysRoutes } from './routes/apiKeys.js'
import { webhooksRoutes } from './routes/webhooks.js'
import { inboundWebhooksRoutes } from './routes/inboundWebhooks.js'
import { dbConnectorsRoutes } from './routes/dbConnectors.js'
import { startDbConnectorScheduler } from './services/dbConnectors/scheduler.js'
import { makeRoutes } from './routes/make.js'
import { startWebhookDispatcher } from './services/webhookDispatcher.js'
import { googleSheetsRoutes } from './routes/googleSheets.js'
import { googleCalendarRoutes } from './routes/googleCalendar.js'
import { startGoogleSheetsSync } from './services/googleSheetsSync.js'
import { googleDriveRoutes } from './routes/googleDrive.js'
import { googleAdsRoutes } from './routes/googleAds.js'
import { googleAdsReportRoutes } from './routes/googleAdsReport.js'
import { utmsRoutes } from './routes/utms.js'
import { voipRoutes } from './routes/voip.js'
import { meetingsRoutes } from './routes/meetings.js'
import { negotiationsRoutes } from './routes/negotiations.js'
import { catalogRoutes } from './routes/catalog.js'
import { waCallsRoutes } from './routes/waCalls.js'
import { schedulingRoutes } from './routes/scheduling.js'
import { schedulingPublicRoutes } from './routes/schedulingPublic.js'
import { legalRoutes } from './routes/legal.js'
import { consentRoutes } from './routes/consent.js'
import { titularRoutes } from './routes/titular.js'
import { toolsRoutes } from './routes/tools.js'
import { personasRoutes } from './routes/personas.js'
import { conversationAuditsRoutes } from './routes/conversationAudits.js'
import { aiJourneyRoutes } from './routes/aiJourney.js'
import { funnelConversionRoutes } from './routes/funnelConversion.js'
import { ga4Routes } from './routes/ga4.js'
import { startGA4Sync } from './services/ga4Sync.js'
import { gmailRoutes } from './routes/gmail.js'
import { gmailWebhookRoutes } from './routes/gmailWebhook.js'
import { startGmailWatchRenew } from './services/gmailWatchRenew.js'
import { startGmailInboundPoll } from './services/gmailInboundPoll.js'
import { googleTasksRoutes } from './routes/googleTasks.js'
import { integrationsGoogleRoutes } from './routes/integrationsGoogle.js'
import { lossReasonsRoutes } from './routes/lossReasons.js'
import { lookerStudioRoutes } from './routes/lookerStudio.js'
import { enrichmentRoutes } from './routes/enrichment.js'
import { helpdeskRoutes } from './routes/helpdesk.js'
import { helpdeskKbRoutes } from './routes/helpdeskKb.js'
import { helpdeskPortalRoutes } from './routes/helpdeskPortal.js'
import { startSlaScheduler } from './services/helpdeskSla.js'
import { startAutomationScheduler } from './services/helpdeskAutomation.js'
import { startHelpdeskRoutingScheduler } from './services/helpdeskRouting.js'
import { startTrashPurgeScheduler } from './services/trash.js'
import { startMeetingRetentionPurge } from './services/meetingRetentionPurge.js'
import { startMeetingTranscriptPoll } from './services/meetingTranscriptPoll.js'
import { startMeetingAutoDispatch } from './services/meetingAutoDispatch.js'
import { startMeetingCalendarWatch } from './services/meetingCalendarWatch.js'
import { startEscalationScheduler } from './services/routing/escalation.js'
import { startTransferExpireScheduler } from './services/routing/transferExpire.js'
import { startShiftHandoverScheduler } from './services/routing/shiftHandover.js'
import { startWorkflowEngine } from './services/workflowEngine.js'
import { startWorkers } from './services/workers.js'
import { startCadenceScheduler } from './services/cadenceScheduler.js'
import { startPriorityScoreScheduler } from './services/priorityScoreService.js'
import { startEvolutionMonitor } from './services/evolutionMonitor.js'
import { startCapiRetryScheduler } from './services/metaCapi.js'
import { startEnrollmentExpireJob } from './services/enrollmentExpireJob.js'
import { startEnrichmentRerunJob } from './services/enrichmentRerunJob.js'
import { startLossReasonSpikeWatcher } from './services/lossReasonSpike.js'
import { isIpBlocked, checkRateLimit, checkAuthRateLimit, checkTrackingRateLimit, onRateLimitExceeded, analyzeRequest, startSecurityCleanup, logSecurityEvent } from './services/security.js'
import { modulePermissionHook } from './lib/permissions.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true
})

// ── CORS ─────────────────────────────────────
// Reflete qualquer Origin: forms embedáveis (/api/forms/submit), pixel
// (/api/pixel/*) e tracking (/api/t/*) são chamados de páginas externas, então
// CORS precisa ser aberto. A segurança real fica em camadas independentes:
//   • Cookie httpOnly de refresh tem Path=/api/admin + SameSite=Lax → nunca
//     sai cross-origin em POST nem em paths públicos.
//   • Auth admin usa Bearer token no header (não é auto-enviado pelo browser).
//   • Hook CSRF abaixo bloqueia mutações em /api/* a partir de origins
//     desconhecidos, EXCETO rotas públicas (forms submit, pixel, tracking).
await app.register(cors, {
  origin: (_origin, cb) => cb(null, true),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
})

// ── HELMET (headers de segurança — defesa em profundidade, F5) ──────────────
// O nginx já injeta os headers para as respostas proxied; o helmet garante a
// mesma proteção caso o backend seja acessado direto (bypass do proxy).
// CSP fica DESLIGADA aqui: o documento HTML é coberto pela CSP do nginx e o
// /uploads tem CSP própria por rota (setHeaders) — evita header duplicado e
// interseção restritiva. Os valores abaixo espelham o nginx para que, quando
// duplicados atrás do proxy, sejam idênticos (inofensivos).
await app.register(helmet, {
  global: true,
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,                                  // não quebra SDKs externos (FB/Google)
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },   // popups de OAuth
  crossOriginResourcePolicy: false,                                  // mantém comportamento atual (sem CORP)
  hsts: { maxAge: 63072000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'sameorigin' },
})

// ── MULTIPART (file uploads) ─────────────────
// @fastify/multipart 8.3.1 (corrige GHSA-27c6-mcxv-x3fh / DoS; compatível com
// fastify v4). Limites globais rigorosos como defesa em profundidade — rotas
// específicas elevam o fileSize via req.file({ limits }) quando necessário.
await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,  // 10 MB por arquivo
    files: 10,                    // máximo 10 arquivos
    fields: 50,                   // máximo 50 campos
    headerPairs: 200
  }
} as any)

// ── MITIGAÇÃO CVE fastify: rejeitar Content-Type com CR/LF/TAB (body validation bypass) ──
app.addHook('onRequest', async (req, reply) => {
  const ct = req.headers['content-type']
  if (typeof ct === 'string' && /[\t\r\n]/.test(ct)) {
    return reply.code(400).send({ error: 'Invalid Content-Type header' })
  }
})

// ── REDIRECT /admin → /app (cutover 2026-04-28) ─────────────
// O app legado (SPA do /admin) foi 100% migrado para o Preact app em /app/.
// Mantemos o redirect para preservar bookmarks. Como hash routing (#leads,
// #dashboard, ...) não chega ao servidor, devolvemos um HTML mínimo que lê
// `location.hash` no browser e mapeia para a rota equivalente no /app.
// Visitantes que não tiverem hash caem no /app/dashboard.
const ADMIN_REDIRECT_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Redirecionando…</title>
<meta name="robots" content="noindex">
<style>body{font:14px/1.5 system-ui,sans-serif;background:#0b1220;color:#cbd5e1;display:grid;place-items:center;min-height:100dvh;margin:0}</style>
<script>(function(){
  // Mapa hash legado → rota do /app. Mantenha sincronizado com migrationRegistry.
  var map = {
    '#dashboard':'/app/dashboard','#leads':'/app/leads','#kanban':'/app/kanban',
    '#funnels':'/app/funnels','#activities':'/app/activities','#tags':'/app/tags',
    '#conversations':'/app/conversations','#atendimento':'/app/conversations',
    '#forms':'/app/forms','#chatbots':'/app/chatbots','#templates':'/app/templates',
    '#pages':'/app/pages','#tracking':'/app/tracking','#sources':'/app/sources',
    '#origens':'/app/sources','#roi':'/app/roi','#reports':'/app/reports',
    '#relatorios':'/app/reports','#links':'/app/links',
    '#trackable-links':'/app/links','#intelligence':'/app/intelligence',
    '#inteligencia':'/app/intelligence','#meta-ads':'/app/meta-ads',
    '#meta':'/app/meta-ads','#google-ads':'/app/google-ads',
    '#sales-ai':'/app/sales-ai','#vendas-ai':'/app/sales-ai',
    '#workflows':'/app/workflows','#jobs':'/app/jobs','#queues':'/app/jobs',
    '#filas':'/app/jobs','#whatsapp':'/app/whatsapp',
    '#cloud-api':'/app/cloud-api','#whatsapp-cloud':'/app/cloud-api',
    '#settings':'/app/settings','#configuracoes':'/app/settings',
    '#aparencia':'/app/settings','#appearance':'/app/settings',
    '#telegram':'/app/telegram','#instagram':'/app/instagram',
    '#integrations':'/app/integrations','#integracoes':'/app/integrations'
  };
  var h = location.hash.split('?')[0].split('/')[0];
  var dest = map[h] || '/app/dashboard';
  location.replace(dest);
})();</script>
<noscript>
  <p>Redirecionando para o painel novo. <a href="/app/dashboard">Clique aqui</a> se não for automático.</p>
</noscript>
<p>Redirecionando para o painel…</p>`

// ── STATIC FILES (frontend) ──────────────────
await app.register(staticFiles, {
  root: join(__dirname, '../../frontend'),
  prefix: '/',
  setHeaders: (res: any) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  }
})

// ── STATIC FILES (uploads) ──────────────────
// Defesa contra XSS armazenado (A8): arquivos de usuário servidos do domínio
// principal. nosniff impede MIME confusion; a CSP `default-src 'none'; sandbox`
// neutraliza qualquer script embutido (ex.: SVG/HTML) mesmo se o arquivo for
// aberto como documento de topo; para tipos que o browser renderiza como
// documento (svg/html/xml) força download em navegação direta — sem afetar o
// uso legítimo via <img>/CSS, que ignora Content-Disposition.
await app.register(staticFiles, {
  root: join(__dirname, '../../uploads'),
  prefix: '/uploads/',
  decorateReply: false,
  setHeaders: (res: any, filePath: string) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    if (/\.(svgz?|html?|xht|xhtml|xml)$/i.test(filePath)) {
      res.setHeader('Content-Disposition', 'attachment')
    }
  },
})

// ── STATIC FILES (frontend-app — SPA novo, Fase 0+) ───────
// Estratégia strangler: /app/* serve o frontend modernizado (Vite + Preact),
// enquanto / e /admin continuam servindo o legado até a migração concluir.
// Build: cd frontend-app && npm run build → produz frontend-app/dist
const NEW_APP_ROOT = join(__dirname, '../../frontend-app/dist')
await app.register(staticFiles, {
  root: NEW_APP_ROOT,
  prefix: '/app/',
  decorateReply: false,
  // index:false — /app/ e /app/index.html caem no handler com injeção SEO.
  index: false,
  setHeaders: (res: any, path: string) => {
    // Assets com hash (gerados pelo Vite) podem ser cacheados longamente.
    // index.html nunca cachear — para deploys propagarem na hora.
    if (path.endsWith('/index.html') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else if (/\/assets\/.+\.(js|css|woff2?|svg|png|jpg|webp|avif)$/.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  },
})

// ── RAW BODY CAPTURE (Cloud API webhook signature validation) ──
app.addHook('preParsing', async (req, _reply, payload) => {
  if ((req.url === '/api/cloud-api/webhook' || req.url.startsWith('/api/meta/webhook')) && req.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const chunk of payload as any) {
      chunks.push(chunk as Buffer)
    }
    const raw = Buffer.concat(chunks)
    ;(req as any).rawBody = raw
    const { Readable } = await import('stream')
    return Readable.from(raw) as any
  }
  return payload
})

// ── INPUT SANITIZATION ──────────────────────────
function sanitizeValue(val: any): any {
  if (typeof val === 'string') {
    return val
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/javascript:/gi, '')
      .replace(/on(error|load|click|mouseover|mouseout|focus|blur)\s*=/gi, '')
  }
  if (Array.isArray(val)) return val.map(sanitizeValue)
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(val)) out[k] = sanitizeValue(v)
    return out
  }
  return val
}

// Campos que NÃO devem ser sanitizados (conteúdo HTML legítimo)
const SANITIZE_SKIP_ROUTES = [
  '/api/admin/settings',       // custom HTML codes (head/body injection)
  '/api/admin/chatbots',       // prompt templates podem conter caracteres especiais
  '/api/admin/pages',          // landing page builder com HTML
  '/api/admin/templates',      // templates de chatbot
]

app.addHook('preHandler', async (req) => {
  if (!req.body || typeof req.body !== 'object') return
  if (req.method !== 'POST' && req.method !== 'PUT') return

  // Skip rotas que aceitam HTML legítimo
  const shouldSkip = SANITIZE_SKIP_ROUTES.some(r => req.url.startsWith(r))
  if (shouldSkip) return

  req.body = sanitizeValue(req.body)
})

// ── CSRF PROTECTION ─────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.CORS_ORIGIN || 'https://bychat.ia.br',
  process.env.APP_URL || 'https://bychat.ia.br',
].filter(Boolean)

app.addHook('onRequest', async (req, reply) => {
  // CSRF: validar Origin em requests de mutação (POST/PUT/DELETE)
  if (!req.url.startsWith('/api/')) return
  const method = req.method
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return

  // Webhooks externos não têm Origin do nosso domínio
  const isWebhookRoute = req.url === '/api/whatsapp/webhook' ||
    req.url === '/api/cloud-api/webhook' ||
    req.url.startsWith('/api/meta/webhook')
  if (isWebhookRoute) return

  // Emergency unblock bypass
  if (req.url === '/api/emergency-unblock') return

  // Public API v1 usa API Key, não Origin
  if (req.url.startsWith('/api/v1/')) return

  // Webhook outbound test/endpoints
  if (req.url.startsWith('/api/webhooks/incoming/')) return

  // Rotas públicas chamadas de páginas externas (forms embedados, pixel,
  // tracking script). Não há sessão/credencial enviada — formulários são
  // protegidos por rate-limit por IP e validação de campos no handler.
  if (req.url.startsWith('/api/forms/submit/')) return
  if (req.url.startsWith('/api/forms/config/')) return
  if (req.url.startsWith('/api/forms/embed/')) return
  if (req.url.startsWith('/api/pixel/')) return
  if (req.url.startsWith('/api/t/')) return

  const origin = req.headers.origin || req.headers.referer
  if (origin) {
    const originHost = origin.replace(/\/$/, '').split('?')[0]
    const isAllowed = ALLOWED_ORIGINS.some(allowed => originHost.startsWith(allowed))
    if (!isAllowed) {
      return reply.code(403).send({ error: 'Origem não permitida (CSRF)' })
    }
  }
})

// ── SECURITY MIDDLEWARE ──────────────────────────
app.addHook('onRequest', async (req, reply) => {
  // Skip static files
  if (!req.url.startsWith('/api/')) return

  // Skip emergency unblock route (must work even when blocked)
  if (req.url === '/api/emergency-unblock' && req.method === 'POST') return

  // Skip self-unblock route (SUPERADMIN com cookie válido — exige sessão prévia)
  if (req.url === '/api/admin/security/self-unblock' && req.method === 'POST') return

  // Skip webhook routes from ALL security checks (IP blocking, rate limit, analysis)
  // Webhooks vêm de servidores externos (Evolution API, Meta) e não devem ser bloqueados
  const isWebhookRoute = req.url === '/api/whatsapp/webhook' ||
    req.url === '/api/cloud-api/webhook' ||
    req.url.startsWith('/api/meta/webhook')
  if (isWebhookRoute) return

  // Public API v1 has its own rate limiting via API key middleware
  if (req.url.startsWith('/api/v1/')) return

  // WebSocket upgrade: conexão longa com backoff próprio no cliente.
  // Exemptar do rate-limit HTTP evita death-spiral quando o IP é bloqueado:
  // o WS reconecta, gera blocked_request, que conta como nova violação.
  if (req.url.startsWith('/api/ws')) return

  const ip = req.ip
  const ua = req.headers['user-agent'] || ''

  // 1. Check if IP is blocked
  if (await isIpBlocked(ip)) {
    await logSecurityEvent({ ip, type: 'blocked_request', severity: 'medium', userAgent: ua, path: req.url, details: 'Request de IP bloqueado' })
    return reply.code(403).send({ error: 'Acesso bloqueado. Entre em contato com o administrador.' })
  }

  // 2. Rate limiting
  const hasAuth = !!req.headers.authorization
  const isLogin = req.url === '/api/admin/login' && req.method === 'POST'
  const isWebhookExempt = req.url === '/api/appearance' ||
    req.url.startsWith('/api/bychat/chat/') ||
    req.url.startsWith('/api/chatbots/public/') ||
    req.url.startsWith('/api/chatbots/embed/')

  // Rate limit específico para tracking (mais permissivo, mas protege contra DoS)
  if (req.url.startsWith('/api/t/')) {
    if (await checkTrackingRateLimit(ip, 'tracking')) {
      return reply.code(429).send({ ok: false, error: 'Rate limit exceeded' })
    }
  }
  // Rate limit específico para redirects de links rastreáveis
  else if (req.url.startsWith('/r/')) {
    if (await checkTrackingRateLimit(ip, 'redirect')) {
      return reply.code(429).send({ error: 'Muitas requisições. Tente novamente em 1 minuto.' })
    }
  }
  // Rate limit para requests autenticadas (mais permissivo: 1000/min)
  else if (hasAuth && await checkAuthRateLimit(ip)) {
    await onRateLimitExceeded(ip, req.url, ua)
    return reply.code(429).send({ error: 'Muitas requisições. Tente novamente em 1 minuto.' })
  }
  // Rate limit geral para APIs públicas (500/min)
  else if (!hasAuth && !isWebhookExempt && await checkRateLimit(ip, isLogin)) {
    await onRateLimitExceeded(ip, req.url, ua)
    return reply.code(429).send({ error: 'Muitas requisições. Tente novamente em 1 minuto.' })
  }

  // 3. Analyze request for malicious patterns
  // Portais acadêmicos públicos (/api/public/aca/*) carregam um token HMAC longo
  // em base64url na query — o analisador de padrões dá falso-positivo (e poderia
  // banir o IP do próprio aluno). Já têm auth própria (token assinado); isenta
  // SÓ da análise de padrões (IP-block e rate-limit acima continuam valendo).
  if (!req.url.startsWith('/api/public/aca/')) {
    const analysis = await analyzeRequest(ip, req.url, ua)
    if (analysis.blocked) {
      return reply.code(403).send({ error: 'Requisição bloqueada por motivos de segurança.' })
    }
  }
})

// ── MODULE PERMISSIONS (após auth, antes das rotas) ──
app.addHook('preHandler', modulePermissionHook)

// ── ROUTES ───────────────────────────────────
await app.register(realtimeRoutes)
await app.register(telegramRoutes)
await app.register(instagramRoutes)
await app.register(leadsRoutes)
await app.register(statsRoutes)
await app.register(analyzeRoutes)
await app.register(chatRoutes)
await app.register(whatsappRoutes)
await app.register(usersRoutes)
await app.register(stagesRoutes)
await app.register(kanbanRoutes)
await app.register(settingsRoutes)
await app.register(systemEmailsRoutes)
await app.register(chatbotsRoutes)
await app.register(instancesRoutes)
await app.register(funnelsRoutes)
await app.register(atendimentoRoutes)
await app.register(transferRequestsRoutes)
await app.register(leadsImportRoutes)
await app.register(teamsRoutes)
await app.register(agentsRoutes)
await app.register(channelGovernanceRoutes)
await app.register(preferencesRoutes)
await app.register(salesCadencesRoutes)
await app.register(enrollmentPortalsRoutes)
await app.register(enrollmentPortalPublicRoutes)
await app.register(candidatePortalRoutes)
await app.register(enrollmentDocReviewRoutes)
await app.register(enrollmentEvaluationsRoutes)
await app.register(paymentProvidersRoutes)
await app.register(paymentsDashboardRoutes)
await app.register(couponsRoutes)
await app.register(leadHistoryRoutes)
await app.register(activitiesRoutes)
await app.register(leadAttachmentsRoutes)
await app.register(savedFiltersRoutes)
await app.register(templatesRoutes)
await app.register(metaRoutes)
await app.register(trackingRoutes)
await app.register(pagesRoutes)
await app.register(formsRoutes)
await app.register(customFieldsRoutes)
await app.register(tagsRoutes)
await app.register(appearanceRoutes)
await app.register(dashboardRoutes)
await app.register(userDashboardsRoutes)
await app.register(installationsRoutes)
await app.register(securityRoutes)
await app.register(metaAdsReportRoutes)
await app.register(funnelReportRoutes)
await app.register(trackableLinksRoutes)
await app.register(pixelRoutes)
await app.register(educationalRoutes)
await app.register(modulesRoutes)
await app.register(salesRoutes)
await app.register(cloudApiSetupRoutes)
await app.register(broadcastRoutes)
await app.register(cloudApiWebhookRoutes)
await app.register(conversionsRoutes)
await app.register(reportsRoutes)
await app.register(leadExportRoutes)
await app.register(workflowRoutes)
await app.register(queueRoutes)
await app.register(trashRoutes)
await app.register(publicApiRoutes)
await app.register(apiKeysRoutes)
await app.register(webhooksRoutes)
await app.register(inboundWebhooksRoutes)
await app.register(dbConnectorsRoutes)
await app.register(makeRoutes)
await app.register(googleSheetsRoutes)
await app.register(googleCalendarRoutes)
await app.register(googleDriveRoutes)
await app.register(googleAdsRoutes)
await app.register(googleAdsReportRoutes)
await app.register(utmsRoutes)
await app.register(voipRoutes)
await app.register(meetingsRoutes)
await app.register(negotiationsRoutes)
await app.register(catalogRoutes)
await app.register(waCallsRoutes)
await app.register(schedulingRoutes)
await app.register(schedulingPublicRoutes)
await app.register(legalRoutes)
await app.register(consentRoutes)
await app.register(titularRoutes)
await app.register(toolsRoutes)
await app.register(personasRoutes)
await app.register(conversationAuditsRoutes)
await app.register(aiJourneyRoutes)
await app.register(funnelConversionRoutes)
await app.register(ga4Routes)
await app.register(gmailRoutes)
await app.register(gmailWebhookRoutes)
await app.register(googleTasksRoutes)
await app.register(integrationsGoogleRoutes)
await app.register(lossReasonsRoutes)
await app.register(lookerStudioRoutes)
await app.register(enrichmentRoutes)
await app.register(kommoIntegrationRoutes)
await app.register(helpdeskRoutes)
await app.register(helpdeskKbRoutes)
await app.register(helpdeskPortalRoutes)

// ── Overlay do tenant (módulos próprios: ex. ERP ineprotec, Venda360) ──
// Carrega src/overlay/index.ts SE existir; no-op nos tenants sem overlay. Mantém
// este server.ts IDÊNTICO em todos os tenants (núcleo compartilhado, Modelo A).
try {
  const overlayPath = './overlay/index.js' // via variável: tsc não resolve (no-op sem overlay)
  const overlay: any = await import(overlayPath)
  if (typeof overlay.registerOverlay === 'function') await overlay.registerOverlay(app)
} catch (e: any) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND' && !/Cannot find module/i.test(e?.message || '')) {
    console.warn('[overlay] falha ao registrar overlay do tenant:', e?.message)
  }
}

// Health check
app.get('/api/health', async () => ({
  ok: true,
  timestamp: new Date().toISOString(),
  version: '1.0.0'
}))

// ── Prometheus metrics endpoint (gated por token ou localhost) ──
app.get('/api/metrics', async (req, reply) => {
  const token = process.env.METRICS_TOKEN
  const auth = req.headers['authorization'] || ''
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || (req.ip || '').startsWith('172.')
  const hasToken = token && auth === `Bearer ${token}`
  if (!isLocal && !hasToken) {
    return reply.code(403).send({ error: 'Forbidden' })
  }
  reply.header('Content-Type', register.contentType)
  return register.metrics()
})

// ── Métricas e captura de erros por request ──
app.addHook('onResponse', async (req, reply) => {
  try {
    const route = (req as any).routeOptions?.url || (req as any).routerPath || 'unknown'
    const labels = { method: req.method, route, status: String(reply.statusCode) }
    httpRequestsTotal.inc(labels)
    const rt = reply.elapsedTime ? reply.elapsedTime / 1000 : 0
    if (rt > 0) httpRequestDuration.observe(labels, rt)
  } catch {}
})

app.setErrorHandler(async (error, req, reply) => {
  const status = (error as any).statusCode || 500
  if (status >= 500) {
    captureException(error, {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    req.log.error({ err: error }, 'Unhandled error')
  }
  return reply.code(status).send({
    error: (error as any).message || 'Internal Server Error',
  })
})

// ── Serve index.html com meta tags e códigos injetados server-side ──
const HEAD_SANITIZE_OPTS: any = {
  allowedTags: ['meta','link','style','title','script','noscript'],
  allowedAttributes: {
    meta: ['name','content','property','charset','http-equiv'],
    link: ['rel','href','type','crossorigin','integrity','sizes','as','media'],
    style: ['type','media'],
    script: ['src','type','async','defer','crossorigin','integrity','nonce'],
  },
  allowedSchemes: ['http','https']
}
const BODY_SANITIZE_OPTS: any = {
  allowedTags: ['script','noscript','iframe','div','span','style'],
  allowedAttributes: {
    script: ['src','type','async','defer','crossorigin','integrity','nonce'],
    iframe: ['src','width','height','frameborder','style','scrolling'],
    div: ['id','class','style'],
    span: ['id','class','style']
  },
  allowedSchemes: ['http','https']
}

function escapeHtmlAttr(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function loadAppearanceConfig(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { grp: 'appearance' } })
  const cfg: Record<string, string> = {}
  rows.forEach(r => {
    let val = typeof r.value === 'string' ? r.value : String(r.value)
    // Desfaz N camadas de JSON.stringify acumuladas (alguns valores foram
    // re-salvos várias vezes e ficaram com escape exponencial: \\\\\\\" etc.)
    for (let i = 0; i < 20 && val.length >= 2 && val.startsWith('"') && val.endsWith('"'); i++) {
      try {
        const next = JSON.parse(val)
        if (typeof next !== 'string' || next === val) break
        val = next
      } catch {
        break
      }
    }
    // Após o JSON.parse: pode restar escape literal (\\\\\\" → \\\" → \" → ").
    // Desfaz iterativamente até a string estabilizar.
    let prev = ''
    for (let i = 0; i < 30 && prev !== val; i++) {
      prev = val
      val = val.replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n')
    }
    cfg[r.key] = val
  })
  return cfg
}

function decodeHtmlEntities(s: string): string {
  // Decodifica entidades comuns; usado para campos LP onde o painel salvou
  // tags HTML como &lt;br&gt; e o consumo final precisa de tags reais.
  return String(s)
    .replace(/&amp;/g, ' AMP ') // marker para evitar dupla decode de & em entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ AMP /g, '&')
}

// Sanitize options para lp_title: permite <br> e <span class="gold|dim"> apenas.
// allowedAttributes mantém TODOS os atributos permitidos; allowedClasses filtra
// quais valores de class podem passar (whitelist).
const LP_TITLE_SANITIZE_OPTS: any = {
  allowedTags: ['br', 'span', 'em', 'strong'],
  allowedAttributes: {
    '*': ['class'],
  },
  allowedClasses: {
    span: ['gold', 'dim'],
  },
  selfClosing: ['br'],
  allowedSchemes: [],
}

function escapeHtmlText(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function injectAppearanceIntoHtml(rawHtml: string, kind: 'admin' | 'lp'): Promise<string> {
  let html = rawHtml
  const cfg = await loadAppearanceConfig()
  const { default: sanitizeHtmlLib } = await import('sanitize-html')

  const prefix = kind === 'admin' ? 'admin' : 'lp'
  const robotsVal = cfg[`appearance.${prefix}_robots_index`] || (kind === 'admin' ? 'noindex' : 'index')
  const robotsContent = robotsVal === 'index' ? 'index, follow' : 'noindex, nofollow'
  const pageTitle = cfg[`appearance.${prefix}_page_title`] || ''
  const pageDescription = cfg[`appearance.${prefix}_page_description`] || ''
  const faviconUrl = cfg['appearance.favicon_url'] || ''
  const headCode = cfg[`appearance.${prefix === 'admin' ? 'custom_head_code' : 'lp_custom_head_code'}`] || ''
  const bodyCode = cfg[`appearance.${prefix === 'admin' ? 'custom_body_code' : 'lp_custom_body_code'}`] || ''

  // <title> — substitui o existente (ou injeta se não existir)
  if (pageTitle) {
    const safeTitle = escapeHtmlAttr(pageTitle)
    if (/<title>[\s\S]*?<\/title>/i.test(html)) {
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    } else {
      html = html.replace('</head>', `<title>${safeTitle}</title>\n</head>`)
    }
  }

  // <meta name="description"> — substitui ou adiciona
  if (pageDescription) {
    const descTag = `<meta name="description" content="${escapeHtmlAttr(pageDescription)}">`
    if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, descTag)
    } else {
      html = html.replace('</head>', `${descTag}\n</head>`)
    }
  }

  // <meta name="robots"> — substitui ou adiciona
  const robotsTag = `<meta name="robots" content="${robotsContent}">`
  if (/<meta\s+name=["']robots["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\s+name=["']robots["'][^>]*>/i, robotsTag)
  } else {
    html = html.replace('</head>', `${robotsTag}\n</head>`)
  }

  // <link rel="icon"> — substitui ou adiciona se favicon configurado
  if (faviconUrl) {
    const safeFavicon = escapeHtmlAttr(faviconUrl)
    const iconTag = `<link rel="icon" href="${safeFavicon}">`
    if (/<link\s+rel=["'](?:shortcut )?icon["'][^>]*>/i.test(html)) {
      html = html.replace(/<link\s+rel=["'](?:shortcut )?icon["'][^>]*>/i, iconTag)
    } else {
      html = html.replace('</head>', `${iconTag}\n</head>`)
    }
  }

  // Custom <head> code (sanitizado, mas allowlist permite scripts)
  if (headCode) {
    html = html.replace('</head>', `${sanitizeHtmlLib(headCode, HEAD_SANITIZE_OPTS)}\n</head>`)
  }

  // Custom <body> code
  if (bodyCode) {
    html = html.replace('</body>', `${sanitizeHtmlLib(bodyCode, BODY_SANITIZE_OPTS)}\n</body>`)
  }

  // ── LP-only: aplicar cores, fonte, conteúdo, marca e tracking ──
  if (kind === 'lp') {
    const landingBg = cfg['appearance.landing_bg'] || '#0a0a0a'
    const landingText = cfg['appearance.landing_text'] || '#ffffff'
    const landingTextLight = cfg['appearance.landing_text_light'] || '#000000'
    const landingGold = cfg['appearance.landing_gold'] || '#d1ae60'
    const landingGoldLight = cfg['appearance.landing_gold_light'] || '#e8cc8a'
    const landingGoldDark = cfg['appearance.landing_gold_dark'] || '#a88a3d'
    const landingFont = cfg['appearance.landing_font'] || "'Poppins', sans-serif"
    const lpTitle = decodeHtmlEntities(cfg['appearance.lp_title'] || '')
    const lpDescription = cfg['appearance.lp_description'] || ''
    const lpLogoMode = cfg['appearance.lp_logo_mode'] || 'text'
    const lpLogoUrl = cfg['appearance.lp_logo_url'] || ''
    const lpLogoSize = cfg['appearance.lp_logo_size'] || '18'
    const lpBrandName = cfg['appearance.lp_brand_name'] || 'BeyondHub'
    const lpBrandAccent = cfg['appearance.lp_brand_accent'] || ''
    const lpEventForm = decodeHtmlEntities(cfg['appearance.lp_event_btn_form'] || '')
    const lpEventChat = decodeHtmlEntities(cfg['appearance.lp_event_btn_chat'] || '')

    // Quando o brand_name começa com brand_accent (ex: "BeyondHub" / accent "Hub"),
    // separamos a base do destaque para renderizar com cor de acento.
    let brandBase = lpBrandName
    let brandAccent = ''
    if (lpBrandAccent && lpBrandName.endsWith(lpBrandAccent)) {
      brandBase = lpBrandName.slice(0, lpBrandName.length - lpBrandAccent.length)
      brandAccent = lpBrandAccent
    }

    // 1. Injeta CSS vars + fonte sobrescrevendo as hardcoded da landing.
    // Várias classes do template original têm cor/fonte hardcoded; sobrescrevemos
    // aqui para que as configs landing_text/landing_gold/landing_font realmente
    // se reflitam no visual. Para gold com alpha (gradient/badge/glow) usamos
    // color-mix(in srgb, var(--gold) X%, transparent) — recompõe a transparência
    // a partir da cor configurada (suporte universal nos navegadores modernos).
    const sizePx = /^\d+(\.\d+)?$/.test(lpLogoSize) ? `${lpLogoSize}px` : lpLogoSize
    const lpVarsCss = `
<style id="lp-appearance">
:root{
  --gold:${landingGold};
  --gold-l:${landingGoldLight};
  --gold-d:${landingGoldDark};
  --black:${landingBg};
  --b2:${landingBg};
  --g3:${landingText};
  --g4:${landingText};
  --lp-logo-size:${sizePx};
}
html,body{font-family:${landingFont}}
.land-h1,.land-logo,.land-nav-logo,.loading-logo,.result-logo,.form-logo{font-family:${landingFont}}
.land-nav-logo{font-size:var(--lp-logo-size)}
.land-nav-logo img{height:calc(var(--lp-logo-size) * 1.6);width:auto;display:block}
/* Cor de texto geral — sobrescreve #fff hardcoded (tema escuro apenas;
   tema claro mantém sua cor fixa via [data-theme="light"]). */
.land-h1,.land-h1 .dim,.land-sub,.land-card-text,.land-footer,.land-footer a,.land-note,.how-label{color:var(--g3)}
/* Gold com alpha — recompõe rgba(209,174,96,X) a partir de var(--gold). */
.land-bg{background:radial-gradient(ellipse 80% 60% at 50% -10%,color-mix(in srgb,var(--gold) 12%,transparent) 0%,transparent 60%),radial-gradient(ellipse 40% 40% at 90% 80%,color-mix(in srgb,var(--gold) 6%,transparent) 0%,transparent 50%),var(--black)}
.land-grid{background-image:linear-gradient(color-mix(in srgb,var(--gold) 4%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--gold) 4%,transparent) 1px,transparent 1px)}
.land-badge{background:color-mix(in srgb,var(--gold) 10%,transparent);border-color:color-mix(in srgb,var(--gold) 25%,transparent);color:var(--gold)}
.land-badge .dot{background:var(--gold)}
.land-card:hover{border-color:color-mix(in srgb,var(--gold) 30%,transparent)}
.land-card-title{color:var(--gold)}
.btn-primary:hover{box-shadow:0 8px 32px color-mix(in srgb,var(--gold) 30%,transparent)}
.btn-chat-cta{color:var(--gold);border-color:var(--gold)}
.btn-chat-cta:hover{background:color-mix(in srgb,var(--gold) 12%,transparent);box-shadow:0 8px 32px color-mix(in srgb,var(--gold) 15%,transparent)}
.how-num{background:color-mix(in srgb,var(--gold) 10%,transparent);border-color:color-mix(in srgb,var(--gold) 20%,transparent);color:var(--gold)}
.land-footer a:hover{color:var(--gold)}
.land-nav-logo,.land-nav-logo .lp-logo-base{color:var(--g3)}
.land-nav-logo .lp-logo-accent,.lp-logo-accent{color:var(--gold)}
/* Tema claro: cor de texto separada (landing_text_light) — sobrescreve as
   regras hardcoded #000/#111 do template. */
html[data-theme="light"] .land-h1,
html[data-theme="light"] .land-h1 .dim,
html[data-theme="light"] .land-sub,
html[data-theme="light"] .land-card-text,
html[data-theme="light"] .land-footer,
html[data-theme="light"] .land-footer a,
html[data-theme="light"] .land-note,
html[data-theme="light"] .how-label,
html[data-theme="light"] .land-nav-logo,
html[data-theme="light"] .land-nav-logo .lp-logo-base{color:${landingTextLight}}
/* Mobile responsivo: respeita lp_logo_size em vez do 16px/15px hardcoded. */
@media(max-width:640px){.land-nav-logo{font-size:var(--lp-logo-size)}}
@media(max-width:380px){.land-nav-logo{font-size:calc(var(--lp-logo-size) * 0.85)}}
</style>`
    html = html.replace('</head>', `${lpVarsCss}\n</head>`)

    // 2. Substitui H1 pelo lp_title (sanitizado: permite <br> e <span class="gold|dim">).
    if (lpTitle) {
      const safeTitle = sanitizeHtmlLib(lpTitle, LP_TITLE_SANITIZE_OPTS)
      html = html.replace(
        /<h1\s+class="land-h1"\s+id="land-h1">[\s\S]*?<\/h1>/,
        `<h1 class="land-h1" id="land-h1">${safeTitle}</h1>`
      )
    }

    // 3. Substitui descrição pelo lp_description (texto puro escapado).
    if (lpDescription) {
      html = html.replace(
        /<p\s+class="land-sub"\s+id="land-sub">[\s\S]*?<\/p>/,
        `<p class="land-sub" id="land-sub">${escapeHtmlText(lpDescription)}</p>`
      )
    }

    // 4. Substitui o nav-logo pelo logo configurado (texto ou imagem).
    let logoInner: string
    if (lpLogoMode === 'image' && lpLogoUrl) {
      logoInner = `<img src="${escapeHtmlAttr(lpLogoUrl)}" alt="${escapeHtmlAttr(lpBrandName)}">`
    } else {
      logoInner = brandAccent
        ? `<span class="lp-logo-base">${escapeHtmlText(brandBase)}</span><span class="lp-logo-accent">${escapeHtmlText(brandAccent)}</span>`
        : `<span class="lp-logo-base">${escapeHtmlText(brandBase)}</span>`
    }
    html = html.replace(
      /<div\s+class="land-nav-logo"\s+data-lp-bind="logo">[\s\S]*?<\/div>/,
      `<div class="land-nav-logo" data-lp-bind="logo">${logoInner}</div>`
    )

    // 5. Substitui texto da marca no footer.
    html = html.replace(
      /<span\s+class="brand-name-text"\s+data-lp-bind="brand-text">[^<]*<\/span>/,
      `<span class="brand-name-text" data-lp-bind="brand-text">${escapeHtmlText(lpBrandName)}</span>`
    )

    // 6. Tracking dos CTAs: snippets executados ao clicar nos botões marcados.
    // Os snippets são código JS livre digitado pelo admin (gtag/dataLayer/fbq/etc).
    // Embrulhamos em try/catch para não quebrar a navegação caso o snippet falhe.
    if (lpEventForm || lpEventChat) {
      const ctaScript = `
<script id="lp-cta-tracking">
(function(){
  function bind(){
    var formFn = function(){ try { ${lpEventForm} } catch(e){ console.warn('[lp-cta form]', e); } };
    var chatFn = function(){ try { ${lpEventChat} } catch(e){ console.warn('[lp-cta chat]', e); } };
    document.querySelectorAll('[data-lp-cta="form"]').forEach(function(b){ b.addEventListener('click', formFn); });
    document.querySelectorAll('[data-lp-cta="chat"]').forEach(function(b){ b.addEventListener('click', chatFn); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
</script>`
      html = html.replace('</body>', `${ctaScript}\n</body>`)
    }
  }

  return html
}

async function serveHtmlWithInjections(req: any, reply: any) {
  try {
    const htmlPath = join(__dirname, '../../frontend/index.html')
    const raw = readFileSync(htmlPath, 'utf-8')
    const isAdminPath = req.url.startsWith('/admin') || req.url.startsWith('/app')
    const kind: 'admin' | 'lp' = isAdminPath ? 'admin' : 'lp'
    const html = await injectAppearanceIntoHtml(raw, kind)
    return reply.type('text/html').send(html)
  } catch {
    return reply.sendFile('index.html')
  }
}

// ── LANDING INSTITUCIONAL (bychat.ia.br) ──────────
// A vitrine de vendas pública só é servida no host institucional. Tenants
// (ex.: vantari.bychat.ia.br) mantêm o comportamento legado (login/app).
// Host derivado de MARKETING_HOST ou, na ausência, do hostname de APP_URL.
function resolveMarketingHost(): string | null {
  const explicit = process.env.MARKETING_HOST?.trim()
  if (explicit) return explicit.toLowerCase()
  const appUrl = process.env.APP_URL?.trim()
  if (!appUrl) return null
  try {
    return new URL(appUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}
const MARKETING_HOST = resolveMarketingHost()

// Contatos da landing — editáveis por painel (SUPERADMIN) sem rebuild.
// Defaults espelham frontend-app/src/landing/landing.copy.ts e o endpoint
// /api/admin/landing-contact (settings.ts).
const LANDING_CONTACT_DEFAULTS = {
  whatsappNumber: '5562985703567',
  whatsappMessage: 'Olá! Quero conhecer o ByChat e agendar uma demonstração.',
  loginUrl: '/app',
}
async function loadLandingContact(): Promise<{ whatsappNumber: string; whatsappMessage: string; loginUrl: string }> {
  try {
    const rows = await prisma.setting.findMany({ where: { grp: 'landing' } })
    const byKey: Record<string, string> = {}
    rows.forEach(r => { byKey[r.key] = (typeof r.value === 'string' ? r.value : String(r.value)).replace(/^"|"$/g, '') })
    return {
      whatsappNumber: byKey['landing.contact.whatsapp_number'] || LANDING_CONTACT_DEFAULTS.whatsappNumber,
      whatsappMessage: byKey['landing.contact.whatsapp_message'] || LANDING_CONTACT_DEFAULTS.whatsappMessage,
      loginUrl: byKey['landing.contact.login_url'] || LANDING_CONTACT_DEFAULTS.loginUrl,
    }
  } catch {
    return { ...LANDING_CONTACT_DEFAULTS }
  }
}

// Serve frontend-app/dist/landing.html (build do entry `landing`), injetando
// os contatos configuráveis em window.__LANDING_CONTACT__ antes de </head>.
// Retorna `null` quando o build ainda não existe — chamador faz fallback.
async function serveLandingPage(reply: any, file = 'landing.html'): Promise<unknown> {
  try {
    let raw = readFileSync(join(NEW_APP_ROOT, file), 'utf-8')
    const contact = await loadLandingContact()
    // Escape de < > & evita quebra/injeção dentro da tag <script>.
    const safeJson = JSON.stringify(contact)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
    const tag = `<script>window.__LANDING_CONTACT__=${safeJson};</script>`
    raw = raw.includes('</head>')
      ? raw.replace('</head>', `${tag}\n</head>`)
      : `${tag}\n${raw}`
    return reply
      .type('text/html')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(raw)
  } catch {
    return null
  }
}

// Rotas explícitas (antes do static plugin interceptar)
app.get('/', async (req, reply) => {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase()
  // Vitrine pública só na instalação PRINCIPAL (MARKETING_HOST explícito).
  // O `isPrimaryInstall()` evita que filhas, onde resolveMarketingHost()
  // cai no fallback do APP_URL (host === MARKETING_HOST), sirvam a landing.
  if (isPrimaryInstall() && MARKETING_HOST && host === MARKETING_HOST) {
    const served = await serveLandingPage(reply)
    if (served !== null) return served
    // Landing não buildada → cai no comportamento legado abaixo.
  }
  // Instalações FILHAS (tenants em subdomínio) não têm LP base própria:
  // a raiz redireciona direto pro app (ex.: vantari.bychat.ia.br → /app),
  // preservando a query string (utm_*, etc).
  if (!isPrimaryInstall()) {
    const qs = req.url.indexOf('?')
    return reply.redirect(302, qs >= 0 ? `/app${req.url.slice(qs)}` : '/app')
  }
  return serveHtmlWithInjections(req, reply)
})

// Landing dedicada ao segmento Educacional (entry `educacional` do build).
// Mesmo gate da vitrine principal: só na instalação PRINCIPAL e no host
// institucional. Filhas (tenants) redirecionam pro app.
async function serveEducationalLanding(req: any, reply: any) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase()
  if (isPrimaryInstall() && MARKETING_HOST && host === MARKETING_HOST) {
    const served = await serveLandingPage(reply, 'educacional.html')
    if (served !== null) return served
  }
  if (!isPrimaryInstall()) {
    return reply.redirect(302, '/app')
  }
  return serveHtmlWithInjections(req, reply)
}
app.get('/educacional', serveEducationalLanding)
app.get('/educacional/', serveEducationalLanding)

// Cutover 2026-04-28: /admin (legado) → /app (Preact). Como hash routing
// não chega ao servidor, devolvemos HTML mínimo que mapeia hash → rota /app.
app.get('/admin', async (_req, reply) => {
  reply.type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-cache, no-store, must-revalidate')
    .send(ADMIN_REDIRECT_HTML)
})
app.get('/admin/*', async (_req, reply) => {
  reply.type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-cache, no-store, must-revalidate')
    .send(ADMIN_REDIRECT_HTML)
})

// ── SPA fallback do frontend-app (Preact) ─────────
// /app e /app/<qualquer-rota-cliente> retornam o index.html do build novo,
// permitindo que o router Preact resolva client-side.
// Injeta SEO + códigos externos (admin) lendo Setting.appearance.
async function serveNewAppIndex(_req: any, reply: any) {
  try {
    const raw = readFileSync(join(NEW_APP_ROOT, 'index.html'), 'utf-8')
    let html: string
    try {
      html = await injectAppearanceIntoHtml(raw, 'admin')
    } catch {
      html = raw
    }
    return reply
      .type('text/html')
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(html)
  } catch {
    // Build ainda não existe (Fase 0 antes do primeiro `npm run build`)
    return reply.code(503).send({
      error: 'Frontend novo ainda não foi buildado. Rode: cd frontend-app && npm run build',
    })
  }
}
app.get('/app', serveNewAppIndex)
app.get('/app/', serveNewAppIndex)
app.get('/app/index.html', serveNewAppIndex)

// SPA fallback (legado para resto, novo app para /app/*)
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Rota não encontrada' })
  }
  if (req.url.startsWith('/app/')) {
    // Assets versionados que não existem (ex.: durante um deploy/rebuild) devem
    // retornar 404 — NUNCA o index.html. Caso contrário o fallback HTML é
    // cacheado no lugar do bundle .js (Cloudflare fragmenta por Vary: Origin/
    // Accept-Encoding) e o SPA quebra com tela preta até o cache expirar (7d).
    const pathname = req.url.split('?')[0]
    if (
      pathname.startsWith('/app/assets/') ||
      /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|json|txt|wasm)$/i.test(pathname)
    ) {
      // no-store: um asset 404 é transitório (deploy em andamento). Sem isto o
      // Cloudflare/browser pode cachear o próprio 404 e travar o asset mesmo
      // após o deploy terminar.
      return reply
        .code(404)
        .header('Cache-Control', 'no-store, no-cache, must-revalidate')
        .send({ error: 'Asset não encontrado' })
    }
    return serveNewAppIndex(req, reply)
  }
  return serveHtmlWithInjections(req, reply)
})

// ── START ─────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001')

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`🚀 ByChat Beyond rodando na porta ${PORT}`)
  // Semeia bychat_modules a partir do MODULE_REGISTRY (idempotente) — garante que
  // módulos novos (ex.: voip) tenham row e possam ser ativados/aparecer na sidebar.
  import('./lib/moduleManager.js')
    .then(m => m.ensureModulesSeeded())
    .catch(err => console.error('[moduleManager] seed init falhou:', err))
  startInactivityChecker()
  startActivityScheduler()
  startSecurityCleanup()
  startMetaLeadPoller()
  startSaleDetectionScheduler().catch(err => console.error('[SaleDetection] Init error:', err))
  startWorkflowEngine()
  startWorkers()
  startCadenceScheduler().catch(err => console.error('[cadenceScheduler] init falhou:', err))
  startDbConnectorScheduler().catch(err => console.error('[dbConnectorScheduler] init falhou:', err))
  import('./services/schedulingNotify.js').then(m => m.startSchedulingReminders()).catch(() => {})
  startPriorityScoreScheduler().catch(err => console.error('[priorityScore] init falhou:', err))
  startEnrollmentExpireJob()
  startEnrichmentRerunJob()
  import('./services/voipRecordingSync.js')
    .then(m => m.startVoipRecordingSync())
    .catch(err => console.error('[voipRecordingSync] init falhou:', err))
  startEvolutionMonitor()
  startTrashPurgeScheduler()
  startMeetingRetentionPurge()   // F0.6 — expurgo de gravações de reunião por retenção (LGPD)
  startMeetingTranscriptPoll()   // F1.3 — poller de status/transcrição das reuniões
  startMeetingAutoDispatch()     // auto-disparo do bot p/ usuários com licença ativa
  startMeetingCalendarWatch()    // vigia a agenda Google própria do agente (além do CRM)
  startCapiRetryScheduler()
  startEscalationScheduler()
  startTransferExpireScheduler()
  startShiftHandoverScheduler()
  startSlaScheduler()
  startAutomationScheduler()
  startHelpdeskRoutingScheduler()
  import('./services/cloudApiTemplates.js')
    .then(m => m.startCloudApiTemplateScheduler())
    .catch(err => console.warn('[cloudApiTemplates] init falhou:', err?.message || err))
  import('./services/broadcast.js')
    .then(m => m.startBroadcastWorker())
    .catch(err => console.warn('[broadcast] init falhou:', err?.message || err))
  import('./services/kommoWorker.js')
    .then(m => { m.startKommoWorker(); m.startKommoCron() })
    .catch(err => console.warn('[kommoSync] init falhou:', err?.message || err))
  import('./services/paymentSync.js')
    .then(m => m.startPaymentReconciliationScheduler())
    .catch(err => console.warn('[paymentSync] init falhou:', err?.message || err))
  import('./services/googleAdsConversions.js')
    .then(m => m.startGoogleAdsConversionDispatcher())
    .catch(err => console.warn('[googleAdsConversions] init falhou:', err?.message || err))
  import('./services/googleAdsClickEnrich.js')
    .then(m => m.startGoogleAdsEnrichment())
    .catch(err => console.warn('[googleAdsClickEnrich] init falhou:', err?.message || err))
  import('./services/aiJourneyService.js')
    .then(m => m.startAiJourneyListener())
    .catch(err => console.warn('[aiJourney] init falhou:', err?.message || err))
  startLossReasonSpikeWatcher()
  startInstagramTokenRefresher()
  // Seed de templates+workflows de notificação foi removido do startup (2026-05-25):
  // tenant novo deve subir com Modelos vazio. Função seedDefaultNotificationTemplates-
  // AndWorkflows() em notificationSeed.ts continua existindo pra invocação manual.
  // Seed de templates de email do sistema (Configurações > Emails do Sistema)
  import('./services/systemEmailTemplates.js')
    .then(m => m.seedSystemEmailTemplates())
    .then(() => console.log('✅ Seed de templates de email do sistema concluído'))
    .catch(err => console.warn('[systemEmailTemplates] seed falhou:', err.message))
  startWebhookDispatcher()
  startGoogleSheetsSync()
  startGA4Sync()
  startGmailWatchRenew()   // no-op sem tópico Pub/Sub (push desligado)
  startGmailInboundPoll()  // Plano B: recebimento por polling (não depende de Pub/Sub)
  // Garante chaves do Contexto do Negócio (alimenta o Lead Score por IA)
  import('./services/businessContext.js')
    .then(m => m.seedBusinessContextSettings())
    .then(() => console.log('✅ Seed de Contexto do Negócio concluído'))
    .catch(err => console.warn('[businessContext] seed falhou:', err?.message || err))
  // Lead Score preditivo por IA — scheduler + hooks (lead.created / enrichment.completed)
  import('./services/aiLeadScoreService.js')
    .then(m => m.startAiLeadScoreScheduler())
    .catch(err => console.warn('[aiLeadScore] init falhou:', err?.message || err))
  // Backfill UIDs para leads existentes
  backfillUids().then(n => { if (n > 0) console.log(`✅ UIDs gerados para ${n} leads existentes`) }).catch(() => {})
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
