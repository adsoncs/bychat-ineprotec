// src/routes/helpdeskPortal.ts
// Portal do Cliente / Self-service (F7): magic link por e-mail, "meus chamados",
// abrir e responder chamados. API sob /api/v1/helpdesk/portal/* (sem auth de
// painel — autentica por token do solicitante) + página pública SSR em /suporte.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { signPortalSession, signMagicLink, verifyPortalToken, requesterFromReq } from '../lib/helpdeskPortalAuth.js'
import { intakeTicket, logTicketEvent, sanitizeHelpdeskCustomFields, TERMINAL_STATUSES, type TicketStatus } from '../services/helpdesk.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from '../services/notify.js'

const STATUS_LABEL: Record<string, string> = {
  new: 'Recebido', open: 'Em andamento', pending: 'Aguardando você', on_hold: 'Em espera', solved: 'Resolvido', closed: 'Encerrado',
}

function appOrigin(req: any): string {
  return process.env.APP_URL || `${req.protocol}://${req.headers.host}`
}

export async function helpdeskPortalRoutes(app: FastifyInstance) {
  // POST /portal/request-link ── Envia magic link ao e-mail ──
  app.post('/api/v1/helpdesk/portal/request-link', async (req, reply) => {
    const email = ((req.body as any)?.email || '').toString().trim().toLowerCase()
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'E-mail inválido' })
    const link = `${appOrigin(req)}/suporte?t=${signMagicLink(email)}`
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'suporte'),
        to: email,
        subject: 'Acesso ao portal de suporte',
        html: `<p>Olá,</p><p>Clique no link abaixo para acessar seus chamados (válido por 30 minutos):</p><p><a href="${link}">Acessar portal de suporte</a></p><p>Se você não solicitou, ignore este e-mail.</p>`,
      })
    } catch (e) {
      console.error('[helpdesk-portal] envio do magic link falhou:', (e as Error).message)
    }
    // Em ambiente sem e-mail configurado, expõe o link só quando o Setting permite.
    const devRow = await prisma.setting.findUnique({ where: { key: 'helpdesk.portal_expose_link' } })
    const expose = devRow?.value === true || String(devRow?.value).replace(/"/g, '') === 'true'
    return { ok: true, ...(expose ? { link } : {}) }
  })

  // GET /portal/exchange?t= ── Troca magic link por sessão de 7 dias ──
  app.get('/api/v1/helpdesk/portal/exchange', async (req, reply) => {
    const p = verifyPortalToken((req.query as any)?.t)
    if (!p) return reply.code(401).send({ error: 'Link inválido ou expirado' })
    return { token: signPortalSession(p.email), email: p.email }
  })

  // GET /portal/me ── E-mail + chamados do solicitante ──
  app.get('/api/v1/helpdesk/portal/me', async (req, reply) => {
    const email = requesterFromReq(req)
    if (!email) return reply.code(401).send({ error: 'Sessão inválida' })
    const tickets = await prisma.helpdeskTicket.findMany({
      where: { requesterEmail: email },
      orderBy: { lastActivityAt: 'desc' },
      select: { number: true, subject: true, status: true, priority: true, createdAt: true, lastActivityAt: true },
      take: 100,
    })
    return { email, tickets: tickets.map((t) => ({ ...t, statusLabel: STATUS_LABEL[t.status] || t.status })) }
  })

  // GET /portal/tickets/:number ── Detalhe (só comentários públicos) ──
  app.get('/api/v1/helpdesk/portal/tickets/:number', async (req, reply) => {
    const email = requesterFromReq(req)
    if (!email) return reply.code(401).send({ error: 'Sessão inválida' })
    const number = Number((req.params as any).number)
    const ticket = await prisma.helpdeskTicket.findFirst({ where: { number, requesterEmail: email } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const comments = await prisma.helpdeskComment.findMany({
      where: { ticketId: ticket.id, visibility: 'public' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, authorType: true, authorName: true, body: true, createdAt: true },
    })
    // CSAT: se resolvido e ainda sem resposta, oferece o token de avaliação.
    let surveyToken: string | null = null
    if (TERMINAL_STATUSES.includes(ticket.status as TicketStatus)) {
      const s = await prisma.helpdeskSurvey.findUnique({ where: { ticketId: ticket.id }, select: { token: true, respondedAt: true } })
      if (s && !s.respondedAt) surveyToken = s.token
    }
    return {
      ticket: { number: ticket.number, subject: ticket.subject, status: ticket.status, statusLabel: STATUS_LABEL[ticket.status] || ticket.status, createdAt: ticket.createdAt },
      comments, surveyToken,
    }
  })

  // GET /portal/custom-fields ── Campos do formulário de abertura (group=helpdesk, showInForm) ──
  app.get('/api/v1/helpdesk/portal/custom-fields', async (req, reply) => {
    if (!requesterFromReq(req)) return reply.code(401).send({ error: 'Sessão inválida' })
    const fields = await prisma.customField.findMany({
      where: { group: 'helpdesk', active: true, showInForm: true },
      orderBy: [{ position: 'asc' }, { label: 'asc' }],
      select: { key: true, label: true, type: true, placeholder: true, options: true, required: true, description: true },
    })
    return { fields }
  })

  // POST /portal/tickets ── Abrir chamado ──
  app.post('/api/v1/helpdesk/portal/tickets', async (req, reply) => {
    const email = requesterFromReq(req)
    if (!email) return reply.code(401).send({ error: 'Sessão inválida' })
    const b = (req.body as any) || {}
    const subject = (b.subject || '').toString().trim()
    if (!subject) return reply.code(400).send({ error: 'Assunto obrigatório' })
    // sanitiza respostas de campos personalizados contra o catálogo (só showInForm)
    const customFields = await sanitizeHelpdeskCustomFields(b.customFields, true)
    if (customFields.error) return reply.code(400).send({ error: customFields.error })
    // herda nome de um chamado anterior, se houver
    const prev = await prisma.helpdeskTicket.findFirst({ where: { requesterEmail: email, requesterName: { not: null } }, select: { requesterName: true } })
    const ticket = await intakeTicket({
      subject, description: b.description, channel: 'web',
      requesterEmail: email, requesterName: prev?.requesterName ?? null as any, requesterAuthored: true,
      customFields: customFields.values,
    })
    return reply.code(201).send({ number: ticket.number })
  })

  // POST /portal/tickets/:number/reply ── Responder (reabre se resolvido) ──
  app.post('/api/v1/helpdesk/portal/tickets/:number/reply', async (req, reply) => {
    const email = requesterFromReq(req)
    if (!email) return reply.code(401).send({ error: 'Sessão inválida' })
    const number = Number((req.params as any).number)
    const ticket = await prisma.helpdeskTicket.findFirst({ where: { number, requesterEmail: email } })
    if (!ticket) return reply.code(404).send({ error: 'Chamado não encontrado' })
    const body = ((req.body as any)?.body || '').toString().trim()
    if (!body) return reply.code(400).send({ error: 'Mensagem vazia' })
    await prisma.helpdeskComment.create({ data: { ticketId: ticket.id, authorType: 'requester', authorName: ticket.requesterName || email, visibility: 'public', channel: 'web', body } })
    const upd: any = { lastActivityAt: new Date() }
    if (ticket.status === 'solved') { upd.status = 'open'; upd.reopenCount = { increment: 1 }; upd.solvedAt = null }
    await prisma.helpdeskTicket.update({ where: { id: ticket.id }, data: upd })
    await logTicketEvent({ ticketId: ticket.id, type: 'comment_added', title: `Resposta do solicitante (portal)`, actorType: 'requester' })
    // F27 — arma o relógio de próxima resposta (cliente respondeu).
    try { const { armNextResponseSla } = await import('../services/helpdeskSla.js'); await armNextResponseSla(ticket.id) } catch { /* best-effort */ }
    try { const { notifyTicketAgent } = await import('../services/helpdeskNotify.js'); await notifyTicketAgent(ticket.id, 'customer_reply') } catch { /* best-effort */ }
    return { ok: true, reopened: ticket.status === 'solved' }
  })

  // ════════════════════ CSAT (avaliação pública) ════════════════════

  // GET /api/v1/helpdesk/csat/:token ── Dados da pesquisa ──
  app.get('/api/v1/helpdesk/csat/:token', async (req, reply) => {
    const token = (req.params as any).token
    const survey = await prisma.helpdeskSurvey.findUnique({ where: { token } })
    if (!survey) return reply.code(404).send({ error: 'Pesquisa não encontrada' })
    const ticket = await prisma.helpdeskTicket.findUnique({ where: { id: survey.ticketId }, select: { number: true, subject: true } })
    return { ticketNumber: ticket?.number, subject: ticket?.subject, rating: survey.rating, responded: !!survey.respondedAt }
  })

  // POST /api/v1/helpdesk/csat/:token ── Registra avaliação ──
  app.post('/api/v1/helpdesk/csat/:token', async (req, reply) => {
    const token = (req.params as any).token
    const survey = await prisma.helpdeskSurvey.findUnique({ where: { token } })
    if (!survey) return reply.code(404).send({ error: 'Pesquisa não encontrada' })
    const b = (req.body as any) || {}
    const rating = Math.max(1, Math.min(5, Number(b.rating) || 0))
    if (!rating) return reply.code(400).send({ error: 'Avaliação inválida (1 a 5)' })
    await prisma.helpdeskSurvey.update({ where: { token }, data: { rating, comment: (b.comment || '').toString().slice(0, 2000) || null, respondedAt: new Date() } })
    await logTicketEvent({ ticketId: survey.ticketId, type: 'survey_responded', title: `Satisfação: ${rating}/5`, actorType: 'requester', newValue: String(rating) })
    return { ok: true }
  })

  // GET /avaliar/:token ── Página pública de avaliação ──
  app.get('/avaliar/:token', async (req, reply) => {
    reply.type('text/html').header('Cache-Control', 'no-store').send(CSAT_HTML((req.params as any).token))
  })

  // ── Página pública do portal ──
  app.get('/suporte', async (req, reply) => {
    reply.type('text/html').header('Cache-Control', 'no-store').send(PORTAL_HTML)
  })

  // ── Help Center público (F22) — site da Base de Conhecimento com a marca ──
  app.get('/ajuda', async (req, reply) => {
    const rows = await prisma.setting.findMany({ where: { key: { in: ['appearance.admin_brand_name', 'appearance.admin_brand_accent', 'appearance.admin_logo_url', 'appearance.primary_color', 'appearance.favicon_url'] } } })
    const g = (k: string, d = '') => { const r = rows.find((x) => x.key === k); if (!r) return d; const v = r.value as any; return (typeof v === 'string' ? v.replace(/^"|"$/g, '') : String(v)) || d }
    const brand = (g('appearance.admin_brand_name', 'Suporte') + (g('appearance.admin_brand_accent') ? g('appearance.admin_brand_accent') : '')).trim()
    const accent = g('appearance.primary_color', '#1a73e8')
    const logo = g('appearance.admin_logo_url')
    const favicon = g('appearance.favicon_url')
    reply.type('text/html').header('Cache-Control', 'public, max-age=120').send(HELP_CENTER_HTML({ brand, accent, logo, favicon }))
  })
}

function HELP_CENTER_HTML(b: { brand: string; accent: string; logo: string; favicon: string }): string {
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Ajuda — ${esc(b.brand)}</title>${b.favicon ? `<link rel="icon" href="${esc(b.favicon)}">` : ''}
<style>
:root{--ac:${esc(b.accent)};--bg:#f6f8fb;--card:#fff;--bd:#e5e9f0;--fg:#1f2733;--mut:#6b7785}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--ac);color:#fff;padding:0}
.hwrap{max-width:880px;margin:0 auto;padding:18px 16px}
.topbar{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#fff}
.brand img{height:28px}
.openbtn{background:#fff;color:var(--ac);border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
.hero{text-align:center;padding:18px 0 8px}.hero h1{font-size:26px;margin:0 0 12px}
.search{display:flex;max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden}
.search input{flex:1;border:0;padding:13px 14px;font-size:15px;outline:none}
.wrap{max-width:880px;margin:0 auto;padding:20px 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;cursor:pointer}
.card:hover{border-color:var(--ac);box-shadow:0 2px 12px rgba(0,0,0,.05)}
.card h3{margin:0 0 4px;font-size:16px}.card p{margin:0;color:var(--mut);font-size:13px}
.alist a{display:block;background:#fff;border:1px solid var(--bd);border-radius:10px;padding:13px 16px;margin-bottom:8px;color:var(--fg)}
.alist a:hover{border-color:var(--ac);text-decoration:none}
.article{background:#fff;border:1px solid var(--bd);border-radius:12px;padding:24px}
.article h1{font-size:24px;margin:0 0 14px}.article .body{line-height:1.7}.article .body img{max-width:100%}
.back{color:var(--mut);cursor:pointer;font-size:14px;display:inline-block;margin-bottom:12px}
.vote{margin-top:24px;padding-top:16px;border-top:1px solid var(--bd);color:var(--mut);font-size:14px}
.vote button{background:#fff;border:1px solid var(--bd);border-radius:8px;padding:6px 14px;cursor:pointer;margin:0 4px}
.mut{color:var(--mut)}.hide{display:none}
footer{text-align:center;color:var(--mut);font-size:13px;padding:24px}
</style></head><body>
<header><div class="hwrap">
  <div class="topbar">
    <div class="brand">${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ''}${esc(b.brand)}</div>
    <button class="openbtn" onclick="location.href='/suporte'">Abrir chamado</button>
  </div>
  <div class="hero"><h1>Como podemos ajudar?</h1>
    <div class="search"><input id="q" placeholder="Buscar na central de ajuda…" oninput="onSearch()"></div>
  </div>
</div></header>
<div class="wrap"><div id="view"></div></div>
<footer>Central de Ajuda · ${esc(b.brand)}</footer>
<script>
var KB='/api/v1/helpdesk/kb';
function h(s){return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function gv(){return document.getElementById('view')}
var searchT=null;
function onSearch(){clearTimeout(searchT);searchT=setTimeout(doSearch,300)}
async function doSearch(){var q=document.getElementById('q').value.trim();if(q.length<2){home();return}var r=await fetch(KB+'/articles?q='+encodeURIComponent(q)).then(function(x){return x.json()});gv().innerHTML='<div class="alist"><div class="mut" style="margin-bottom:8px">Resultados para "'+h(q)+'":</div>'+(r.articles.length?r.articles.map(function(a){return '<a href="#" onclick="openArt(\\''+a.slug+'\\');return false">'+h(a.title)+(a.excerpt?'<div class="mut" style="font-size:13px">'+h(a.excerpt)+'</div>':'')+'</a>'}).join(''):'<p class="mut">Nada encontrado. <a href="/suporte">Abrir um chamado</a>.</p>')+'</div>'}
async function home(){var c=await fetch(KB+'/categories').then(function(x){return x.json()});var html='<div class="grid">'+c.categories.map(function(cat){return '<div class="card" onclick="openCat(\\''+cat.slug+'\\',\\''+h(cat.name)+'\\')"><h3>'+h(cat.name)+'</h3><p>'+h(cat.description||'')+'</p></div>'}).join('')+'</div>';if(!c.categories.length)html='<p class="mut">Ainda não há artigos publicados. <a href="/suporte">Abrir um chamado</a>.</p>';gv().innerHTML=html}
async function openCat(slug,name){var r=await fetch(KB+'/articles?categorySlug='+encodeURIComponent(slug)).then(function(x){return x.json()});gv().innerHTML='<span class="back" onclick="home()">&larr; Central</span><h2>'+h(name)+'</h2><div class="alist">'+(r.articles.length?r.articles.map(function(a){return '<a href="#" onclick="openArt(\\''+a.slug+'\\');return false">'+h(a.title)+'</a>'}).join(''):'<p class="mut">Sem artigos nesta categoria.</p>')+'</div>'}
async function openArt(slug){var r=await fetch(KB+'/articles/'+encodeURIComponent(slug)).then(function(x){return x.json()});if(!r.article){home();return}var a=r.article;gv().innerHTML='<span class="back" onclick="home()">&larr; Central</span><div class="article"><h1>'+h(a.title)+'</h1><div class="body">'+a.body+'</div><div class="vote" id="vote">Este artigo foi útil? <button onclick="vote(\\''+slug+'\\',\\'up\\')">👍 Sim</button><button onclick="vote(\\''+slug+'\\',\\'down\\')">👎 Não</button></div></div>';window.scrollTo(0,0)}
async function vote(slug,dir){await fetch(KB+'/articles/'+encodeURIComponent(slug)+'/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir:dir})});document.getElementById('vote').innerHTML=dir==='up'?'Obrigado pelo retorno! ✅':'Obrigado. Se precisar, <a href="/suporte">abra um chamado</a>.'}
home();
</script></body></html>`
}

function CSAT_HTML(token: string): string {
  const t = String(token).replace(/[^a-f0-9]/gi, '')
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Avalie o atendimento</title>
<style>:root{--bg:#0b0f17;--card:#141a24;--bd:#243042;--fg:#e6edf3;--mut:#8b97a8;--ac:#3b82f6}*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--fg);display:grid;min-height:100vh;place-items:center}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:24px;max-width:440px;width:92%;text-align:center}
h1{font-size:20px;margin:0 0 6px}.mut{color:var(--mut);font-size:14px}
.stars{font-size:38px;cursor:pointer;margin:16px 0;user-select:none}.stars span{padding:2px;filter:grayscale(1);opacity:.5}.stars span.on{filter:none;opacity:1}
textarea{width:100%;background:#0d121b;border:1px solid var(--bd);border-radius:8px;color:var(--fg);padding:10px;margin:8px 0}
button{background:var(--ac);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer}</style></head><body>
<div class="card" id="c">
  <h1>Como foi o atendimento?</h1><p class="mut">Sua avaliação ajuda a melhorar o suporte.</p>
  <div class="stars" id="stars">${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}">★</span>`).join('')}</div>
  <textarea id="cm" rows="3" placeholder="Comentário (opcional)"></textarea>
  <button onclick="send()">Enviar avaliação</button>
</div>
<script>
var TK='${t}',rating=0;
var st=document.getElementById('stars');
st.querySelectorAll('span').forEach(function(s){s.onclick=function(){rating=+s.dataset.v;st.querySelectorAll('span').forEach(function(x){x.classList.toggle('on',+x.dataset.v<=rating)})}});
fetch('/api/v1/helpdesk/csat/'+TK).then(function(r){return r.json()}).then(function(d){if(d.responded){document.getElementById('c').innerHTML='<h1>Obrigado!</h1><p class="mut">Você já avaliou este atendimento.</p>'}});
function send(){if(!rating){alert('Escolha de 1 a 5 estrelas.');return}fetch('/api/v1/helpdesk/csat/'+TK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:rating,comment:document.getElementById('cm').value})}).then(function(r){return r.json()}).then(function(){document.getElementById('c').innerHTML='<h1>Obrigado pela avaliação!</h1><p class="mut">Sua opinião foi registrada.</p>'})}
</script></body></html>`
}

const PORTAL_HTML = `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Central de Suporte</title>
<style>
:root{--bg:#0b0f17;--card:#141a24;--bd:#243042;--fg:#e6edf3;--mut:#8b97a8;--ac:#3b82f6;--ok:#22c55e;--warn:#f59e0b}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);font-size:14px;margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px;margin-bottom:12px}
input,textarea,button{font:inherit}
input,textarea{width:100%;background:#0d121b;border:1px solid var(--bd);border-radius:8px;color:var(--fg);padding:10px;margin:6px 0}
button{background:var(--ac);color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer;font-weight:600}
button.ghost{background:transparent;border:1px solid var(--bd);color:var(--fg)}
.row{display:flex;gap:8px;align-items:center}.row>*{flex:1}.row button{flex:0 0 auto}
.tk{cursor:pointer}.tk:hover{border-color:var(--ac)}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:#1f2937;color:var(--mut)}
.badge.open{background:rgba(59,130,246,.15);color:#93c5fd}.badge.solved{background:rgba(34,197,94,.15);color:#86efac}
.badge.pending,.badge.new{background:rgba(245,158,11,.15);color:#fcd34d}
.msg{padding:10px 12px;border-radius:8px;margin:6px 0;font-size:14px;white-space:pre-wrap}
.msg.them{background:#0d121b}.msg.me{background:rgba(59,130,246,.1)}
.who{font-size:12px;color:var(--mut);margin-bottom:2px}
a{color:var(--ac)}.muted{color:var(--mut);font-size:13px}.err{color:#f87171;font-size:13px}
.hide{display:none}.back{cursor:pointer;color:var(--mut);font-size:13px;margin-bottom:8px;display:inline-block}
</style></head><body><div class="wrap">
<h1>Central de Suporte</h1><p class="sub">Acompanhe e abra chamados de suporte.</p>

<div id="login" class="card hide">
  <p class="muted">Informe seu e-mail para receber um link de acesso aos seus chamados.</p>
  <input id="email" type="email" placeholder="seu@email.com" autocomplete="email">
  <button onclick="requestLink()">Receber link de acesso</button>
  <p id="loginMsg" class="muted"></p>
</div>

<div id="home" class="hide">
  <div class="row" style="margin-bottom:12px"><div class="muted" id="who"></div><button onclick="logout()" class="ghost">Sair</button></div>
  <div class="card"><strong>Abrir novo chamado</strong>
    <input id="nSubject" placeholder="Assunto"><textarea id="nBody" rows="3" placeholder="Descreva o problema"></textarea>
    <div id="cfBox"></div>
    <div class="row"><button onclick="askAi()" class="ghost">✨ Perguntar à IA</button><button onclick="createTicket()">Enviar chamado</button></div>
    <div id="aiBox"></div><p id="newMsg" class="err"></p>
  </div>
  <div id="list"></div>
</div>

<div id="detail" class="hide">
  <span class="back" onclick="showHome()">&larr; Voltar aos chamados</span>
  <div class="card"><div class="row"><strong id="dSubject"></strong><span id="dStatus" class="badge"></span></div>
    <div id="thread" style="margin-top:10px"></div>
    <div id="csat"></div>
    <textarea id="reply" rows="2" placeholder="Escreva uma resposta…"></textarea>
    <button onclick="sendReply()">Responder</button><p id="replyMsg" class="muted"></p>
  </div>
</div>

<script>
var API='/api/v1/helpdesk/portal', tok=localStorage.getItem('hd_portal_tok'), curNum=null;
function h(s){return (s||'').replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function show(id){['login','home','detail'].forEach(function(x){document.getElementById(x).classList.add('hide')});document.getElementById(id).classList.remove('hide')}
async function api(path,opts){opts=opts||{};opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(tok)opts.headers.Authorization='Bearer '+tok;var r=await fetch(API+path,opts);if(r.status===401){logout();throw new Error('401')}return r.json()}
async function requestLink(){var e=document.getElementById('email').value.trim();var m=document.getElementById('loginMsg');if(!e){m.textContent='Informe o e-mail.';return}m.textContent='Enviando…';var r=await fetch(API+'/request-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e})}).then(function(x){return x.json()});if(r.link){location.href=r.link}else{m.textContent='Link enviado! Verifique seu e-mail.'}}
function logout(){localStorage.removeItem('hd_portal_tok');tok=null;show('login')}
async function loadHome(){try{var d=await api('/me');document.getElementById('who').textContent=d.email;renderList(d.tickets);loadCustomFields();show('home')}catch(e){show('login')}}
var CFIELDS=[];
async function loadCustomFields(){try{var d=await api('/custom-fields');CFIELDS=d.fields||[];var box=document.getElementById('cfBox');if(!CFIELDS.length){box.innerHTML='';return}box.innerHTML=CFIELDS.map(function(f){var lbl='<label style="display:block;font-size:13px;margin-top:8px">'+h(f.label)+(f.required?' <span style="color:var(--err)">*</span>':'');var inp;if(f.type==='select'){inp='<select data-cf="'+h(f.key)+'"><option value="">— Selecione</option>'+(f.options||[]).map(function(o){return '<option value="'+h(o.value)+'">'+h(o.label)+'</option>'}).join('')+'</select>'}else if(f.type==='textarea'){inp='<textarea data-cf="'+h(f.key)+'" rows="2" placeholder="'+h(f.placeholder||'')+'"></textarea>'}else{var t=(f.type==='number'||f.type==='currency')?'number':(f.type==='date'?'date':(f.type==='email'?'email':'text'));inp='<input type="'+t+'" data-cf="'+h(f.key)+'" placeholder="'+h(f.placeholder||'')+'">'}return lbl+inp+'</label>'}).join('')}catch(e){}}
function collectCustomFields(){var cf={};document.querySelectorAll('#cfBox [data-cf]').forEach(function(el){var k=el.getAttribute('data-cf'),v=el.value;if(v!=='')cf[k]=v});return cf}
function badgeClass(s){return 'badge '+(s)}
function renderList(ts){var el=document.getElementById('list');if(!ts.length){el.innerHTML='<p class="muted">Você ainda não tem chamados.</p>';return}el.innerHTML=ts.map(function(t){return '<div class="card tk" onclick="openTicket('+t.number+')"><div class="row"><strong>#'+t.number+' '+h(t.subject)+'</strong><span class="'+badgeClass(t.status)+'">'+h(t.statusLabel)+'</span></div><div class="muted">Atualizado '+new Date(t.lastActivityAt).toLocaleString('pt-BR')+'</div></div>'}).join('')}
async function openTicket(n){curNum=n;var d=await api('/tickets/'+n);document.getElementById('dSubject').textContent='#'+d.ticket.number+' '+d.ticket.subject;var st=document.getElementById('dStatus');st.textContent=d.ticket.statusLabel;st.className=badgeClass(d.ticket.status);document.getElementById('thread').innerHTML=d.comments.map(function(c){var me=c.authorType==='requester';return '<div class="msg '+(me?'me':'them')+'"><div class="who">'+h(me?'Você':(c.authorName||'Suporte'))+' · '+new Date(c.createdAt).toLocaleString('pt-BR')+'</div>'+h(c.body)+'</div>'}).join('')||'<p class="muted">Sem mensagens.</p>';document.getElementById('csat').innerHTML=d.surveyToken?'<div style="margin:10px 0;padding:10px;border:1px solid var(--bd);border-radius:8px">Este chamado foi resolvido. <a href="/avaliar/'+d.surveyToken+'">Avalie o atendimento &rarr;</a></div>':'';document.getElementById('reply').value='';document.getElementById('replyMsg').textContent='';show('detail')}
function showHome(){loadHome()}
async function sendReply(){var b=document.getElementById('reply').value.trim();var m=document.getElementById('replyMsg');if(!b){m.textContent='Escreva uma mensagem.';return}m.textContent='Enviando…';await api('/tickets/'+curNum+'/reply',{method:'POST',body:JSON.stringify({body:b})});openTicket(curNum)}
async function createTicket(){var s=document.getElementById('nSubject').value.trim(),b=document.getElementById('nBody').value.trim();var m=document.getElementById('newMsg');if(!s){m.textContent='Informe o assunto.';return}m.textContent='';var r=await api('/tickets',{method:'POST',body:JSON.stringify({subject:s,description:b,customFields:collectCustomFields()})});if(r.error){m.textContent=r.error;return}document.getElementById('nSubject').value='';document.getElementById('nBody').value='';document.getElementById('aiBox').innerHTML='';document.querySelectorAll('#cfBox [data-cf]').forEach(function(el){el.value=''});openTicket(r.number)}
async function askAi(){var q=(document.getElementById('nBody').value.trim()||document.getElementById('nSubject').value.trim());var box=document.getElementById('aiBox');if(q.length<3){box.innerHTML='<p class="muted">Descreva sua dúvida para eu consultar a base.</p>';return}box.innerHTML='<p class="muted">Consultando a base de conhecimento…</p>';try{var r=await fetch('/api/v1/helpdesk/kb/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})}).then(function(x){return x.json()});var html='';if(r.answer){html+='<div class="msg them" style="margin-top:8px"><div class="who">✨ Assistente</div>'+h(r.answer)+'</div>'}if(r.articles&&r.articles.length){html+='<div class="muted" style="margin-top:6px">Artigos relacionados:</div>'+r.articles.map(function(a){return '<div style="font-size:13px">• '+h(a.title)+'</div>'}).join('')}if(!html){html='<p class="muted">Não encontrei na base. Envie um chamado abaixo que um agente vai te ajudar.</p>'}else{html+='<div style="margin-top:8px;font-size:13px">Isso resolveu? <button class="ghost" onclick="aiResolved()">Sim, obrigado</button> <span class="muted">— ou envie o chamado abaixo</span></div>'}box.innerHTML=html}catch(e){box.innerHTML='<p class="muted">Não foi possível consultar agora. Você pode enviar o chamado abaixo.</p>'}}
function aiResolved(){document.getElementById('aiBox').innerHTML='<p style="color:var(--ok)">Que bom! Ficamos à disposição. ✅</p>';document.getElementById('nSubject').value='';document.getElementById('nBody').value=''}
(async function(){var u=new URL(location.href);var t=u.searchParams.get('t');if(t){try{var r=await fetch(API+'/exchange?t='+encodeURIComponent(t)).then(function(x){return x.json()});if(r.token){tok=r.token;localStorage.setItem('hd_portal_tok',tok);history.replaceState({},'',location.pathname)}}catch(e){}}if(tok){loadHome()}else{show('login')}})();
</script></div></body></html>`
