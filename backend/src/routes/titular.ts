// src/routes/titular.ts
// Portal de Direitos do Titular (LGPD art. 18) — público, SSR, sem auth de painel.
//
// Identidade verificada por MAGIC LINK enviado ao canal do próprio titular
// (e-mail ou WhatsApp do cadastro), evitando expor dados a quem só tem um token
// adivinhável. Fluxo:
//   GET  /meus-dados                         → formulário (informe e-mail/WhatsApp)
//   POST /api/public/titular/request-access  → acha o lead, envia magic link (resposta neutra)
//   GET  /meus-dados/:token                  → portal: ver dados + ações
//   GET  /api/public/titular/:token/export.(json|csv) → portabilidade (art. 18 V)
//   POST /api/public/titular/:token/revogar  → revoga consentimento + opt-out total (imediato)
//   POST /api/public/titular/:token/solicitar → cria DataSubjectRequest (correção/eliminação) c/ SLA 15d
//
// Eliminação NÃO é automática: vira requisição revisada pelo Encarregado (pode
// haver guarda legal — fiscal/matrícula). Revogação e opt-out são imediatos.

import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { adminOnly, type JwtPayload } from '../lib/auth.js'
import { logEvent, getIp } from '../services/leadHistory.js'
import { getPreferencesUrl } from '../services/preferencesToken.js'
import { moveToTrash, snapshotLead } from '../services/trash.js'

const SECRET = process.env.CANDIDATE_SECRET || process.env.JWT_SECRET || 'bychat-titular-secret'
const TTL_MS = 2 * 24 * 60 * 60 * 1000 // 2 dias

interface TitularTokenPayload { leadId: number; exp: number; kind: 'dsar' }

// Separador '~' (não '.'): o find-my-way trata '.' como sufixo paramétrico e
// não casa o token em rotas com :token seguido/precedido de segmento estático.
function signTitularToken(leadId: number): string {
  const payload: TitularTokenPayload = { leadId, exp: Date.now() + TTL_MS, kind: 'dsar' }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}~${sig}`
}

function verifyTitularToken(token: string | null | undefined): TitularTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('~')) return null
  const [body, sig] = token.split('~')
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const p: TitularTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (!p || p.kind !== 'dsar' || typeof p.exp !== 'number' || p.exp < Date.now()) return null
    if (typeof p.leadId !== 'number') return null
    return p
  } catch { return null }
}

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function baseUrl(req: any): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  return `${proto.split(',')[0]}://${req.headers.host}`
}

const LAYOUT_HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:36px auto;padding:0 16px;color:#1f2937;background:#f7f8fa}
h1{font-size:24px;margin:0 0 6px}h2{font-size:17px;margin:26px 0 8px}
p.sub{color:#5f6368;margin:0 0 22px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-bottom:16px}
label.fl{display:block;font-size:13px;font-weight:600;margin:0 0 6px;color:#374151}
input[type=text],input[type=email],textarea{width:100%;padding:11px 13px;border:1px solid #d1d5db;border-radius:8px;font:inherit;font-size:15px}
textarea{min-height:84px;resize:vertical}
button{padding:11px 16px;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
button:hover{background:#1666cc}button.sec{background:#eef1f4;color:#1f2937}button.danger{background:#fde8e8;color:#a11}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.kv{display:grid;grid-template-columns:160px 1fr;gap:6px 12px;font-size:14px}
.kv dt{color:#6b7280}.kv dd{margin:0;color:#111827;word-break:break-word}
.note{background:#dcfce7;color:#14532d;padding:10px 12px;border-radius:8px;margin-bottom:14px;display:none}
.err{background:#fde8e8;color:#a11;padding:10px 12px;border-radius:8px;margin-bottom:14px;display:none}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:#eef1f4;color:#374151}
.ok{background:#dcfce7;color:#14532d}.no{background:#fde8e8;color:#a11}
footer{text-align:center;color:#9ca3af;font-size:13px;margin-top:24px}
a{color:#1a73e8}
</style>`

function pageRequest(req: any, sent = false): string {
  return `<!doctype html><html lang="pt-BR"><head><title>Meus dados — Direitos do titular</title>${LAYOUT_HEAD}</head><body>
  <h1>Acesso aos seus dados</h1>
  <p class="sub">Conforme a Lei Geral de Proteção de Dados (LGPD), você pode acessar, corrigir, exportar e solicitar a eliminação dos seus dados. Para confirmar sua identidade, enviaremos um link seguro ao seu e-mail ou WhatsApp cadastrado.</p>
  <div id="note" class="note">Se houver um cadastro com este contato, enviamos um link de acesso. Verifique seu e-mail ou WhatsApp.</div>
  <div id="err" class="err"></div>
  <form id="f" class="card">
    <label class="fl" for="c">Seu e-mail ou WhatsApp</label>
    <input type="text" id="c" placeholder="voce@email.com ou (62) 9....." autocomplete="off" />
    <div class="actions"><button type="submit">Enviar link de acesso</button></div>
  </form>
  <footer>Em caso de dúvidas, contate nosso Encarregado pela Política de Privacidade.</footer>
  <script>
  document.getElementById('f').addEventListener('submit',async function(e){
    e.preventDefault();var c=document.getElementById('c').value.trim();var err=document.getElementById('err');err.style.display='none';
    if(!c){err.textContent='Informe seu e-mail ou WhatsApp.';err.style.display='block';return;}
    var btn=this.querySelector('button');btn.disabled=true;
    try{var r=await fetch('/api/public/titular/request-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact:c})});
      document.getElementById('note').style.display='block';this.style.display='none';
    }catch(_){err.textContent='Erro ao enviar. Tente novamente.';err.style.display='block';}finally{btn.disabled=false;}
  });
  </script></body></html>`
}

function pagePortal(req: any, token: string, lead: any, prefsUrl: string): string {
  const consent = lead.lgpdConsent
    ? `<span class="badge ok">Concedido${lead.lgpdConsentAt ? ' em ' + new Date(lead.lgpdConsentAt).toLocaleDateString('pt-BR') : ''}</span>`
    : `<span class="badge no">Não concedido / revogado</span>`
  return `<!doctype html><html lang="pt-BR"><head><title>Meus dados</title>${LAYOUT_HEAD}</head><body>
  <h1>Olá${lead.nome ? ', ' + esc(lead.nome) : ''}</h1>
  <p class="sub">Aqui você exerce seus direitos sobre os dados que tratamos. Este acesso expira em 48 horas.</p>
  <div id="note" class="note"></div>
  <div id="err" class="err"></div>

  <div class="card">
    <h2 style="margin-top:0">Confirmação de tratamento e acesso</h2>
    <dl class="kv">
      <dt>Nome</dt><dd>${esc(lead.nome) || '—'}</dd>
      <dt>E-mail</dt><dd>${esc(lead.email) || '—'}</dd>
      <dt>WhatsApp</dt><dd>${esc(lead.whatsapp) || '—'}</dd>
      <dt>Empresa</dt><dd>${esc(lead.empresa) || '—'}</dd>
      <dt>Cidade</dt><dd>${esc(lead.cidade) || '—'}</dd>
      <dt>Cadastro em</dt><dd>${lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('pt-BR') : '—'}</dd>
      <dt>Consentimento</dt><dd>${consent}</dd>
    </dl>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Portabilidade — exportar meus dados</h2>
    <p class="sub" style="margin-bottom:10px">Baixe uma cópia estruturada dos seus dados (art. 18, V).</p>
    <div class="actions">
      <a href="/api/public/titular/export?format=json&token=${encodeURIComponent(token)}"><button type="button" class="sec">Exportar JSON</button></a>
      <a href="/api/public/titular/export?format=csv&token=${encodeURIComponent(token)}"><button type="button" class="sec">Exportar CSV</button></a>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Comunicações e consentimento</h2>
    <p class="sub" style="margin-bottom:10px">Gerencie por quais canais aceita receber mensagens, ou revogue o consentimento de tratamento para marketing/enriquecimento.</p>
    <div class="actions">
      <a href="${esc(prefsUrl)}"><button type="button" class="sec">Gerenciar canais</button></a>
      <button type="button" class="danger" id="revogar">Revogar consentimento</button>
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Correção de dados</h2>
    <p class="sub" style="margin-bottom:10px">Descreva o que está incorreto e o valor correto. Sua solicitação será atendida em até 15 dias.</p>
    <form id="fcorr">
      <textarea id="corr" placeholder="Ex.: meu telefone correto é (62) 9...."></textarea>
      <div class="actions"><button type="submit" class="sec">Solicitar correção</button></div>
    </form>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Eliminação dos meus dados</h2>
    <p class="sub" style="margin-bottom:10px">Você pode solicitar a eliminação. Avaliaremos obrigações legais de guarda (ex.: fiscais) e responderemos em até 15 dias.</p>
    <form id="fdel">
      <textarea id="delmsg" placeholder="Motivo (opcional)"></textarea>
      <div class="actions"><button type="submit" class="danger">Solicitar eliminação</button></div>
    </form>
  </div>

  <footer>Cumprimos a LGPD. Suas solicitações são registradas e atendidas pelo nosso Encarregado.</footer>
  <script>
  var TK=${JSON.stringify(token)};
  function flash(id,msg){var el=document.getElementById(id);el.textContent=msg;el.style.display='block';window.scrollTo(0,0);}
  async function post(path,body){var r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});var j=await r.json().catch(function(){return{};});if(!r.ok||j.ok===false)throw new Error(j.error||'Falha');return j;}
  document.getElementById('revogar').addEventListener('click',async function(){
    if(!confirm('Confirma revogar o consentimento? Pararemos o tratamento para marketing/enriquecimento e o contato pelos canais.'))return;
    this.disabled=true;try{await post('/api/public/titular/revogar',{token:TK});flash('note','Consentimento revogado e canais desativados. Registramos sua solicitação.');this.textContent='Revogado';}catch(e){this.disabled=false;flash('err',e.message);}
  });
  document.getElementById('fcorr').addEventListener('submit',async function(e){e.preventDefault();var v=document.getElementById('corr').value.trim();if(!v){flash('err','Descreva a correção.');return;}var b=this.querySelector('button');b.disabled=true;try{await post('/api/public/titular/solicitar',{token:TK,type:'correction',message:v});flash('note','Solicitação de correção registrada. Atenderemos em até 15 dias.');this.style.display='none';}catch(err){b.disabled=false;flash('err',err.message);}});
  document.getElementById('fdel').addEventListener('submit',async function(e){e.preventDefault();if(!confirm('Confirma solicitar a eliminação dos seus dados?'))return;var v=document.getElementById('delmsg').value.trim();var b=this.querySelector('button');b.disabled=true;try{await post('/api/public/titular/solicitar',{token:TK,type:'deletion',message:v});flash('note','Solicitação de eliminação registrada. Avaliaremos e responderemos em até 15 dias.');this.style.display='none';}catch(err){b.disabled=false;flash('err',err.message);}});
  </script></body></html>`
}

// Normaliza telefone para dígitos (compara sufixo p/ achar lead).
function digits(s: string): string { return String(s || '').replace(/\D/g, '') }

async function findLeadByContact(contact: string): Promise<any | null> {
  const c = String(contact || '').trim()
  if (!c) return null
  if (c.includes('@')) {
    return prisma.lead.findFirst({ where: { email: c }, orderBy: { id: 'desc' } })
  }
  const d = digits(c)
  if (d.length < 8) return null
  const tail = d.slice(-8) // últimos 8 dígitos (robusto a DDI/0)
  return prisma.lead.findFirst({ where: { whatsapp: { contains: tail } }, orderBy: { id: 'desc' } })
}

async function notifyEncarregado(subject: string, lines: string[]): Promise<void> {
  const text = lines.join('\n')
  // WhatsApp ao número de notificação (se configurado)
  try {
    const num = process.env.NOTIF_WHATSAPP_NUMBER
    if (num) {
      const { getDefaultProvider } = await import('../services/whatsappProvider.js')
      const provider = await getDefaultProvider()
      await provider.sendText(num, `🔐 *LGPD — ${subject}*\n\n${text}`)
    }
  } catch (e: any) { console.warn('[titular] notify WA falhou:', e?.message) }
  // E-mail ao endereço de notificação (se configurado)
  try {
    const to = process.env.NOTIFY_EMAIL_TO
    if (to) {
      const { sendEmailGeneric, getEmailConfig, getFromAddress } = await import('../services/notify.js')
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'LGPD'), to,
        subject: `[LGPD] ${subject}`,
        html: `<p>${lines.map(esc).join('<br>')}</p>`,
      })
    }
  } catch (e: any) { console.warn('[titular] notify email falhou:', e?.message) }
}

async function sendAccessLink(req: any, lead: any): Promise<void> {
  const token = signTitularToken(lead.id)
  const link = `${baseUrl(req)}/meus-dados?t=${encodeURIComponent(token)}`
  const msg = `Recebemos um pedido de acesso aos seus dados (LGPD). Use o link a seguir (válido por 48h) para ver, exportar, corrigir ou solicitar a eliminação dos seus dados:\n\n${link}\n\nSe não foi você, ignore esta mensagem.`
  // Canal preferido: e-mail se houver; senão WhatsApp.
  if (lead.email) {
    try {
      const { sendEmailGeneric, getEmailConfig, getFromAddress } = await import('../services/notify.js')
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'Privacidade'), to: lead.email,
        subject: 'Acesso aos seus dados (LGPD)',
        html: `<p>Olá${lead.nome ? ' ' + esc(lead.nome) : ''},</p><p>Recebemos um pedido de acesso aos seus dados (LGPD). Clique no botão abaixo (válido por 48 horas):</p><p><a href="${esc(link)}" style="display:inline-block;padding:12px 18px;background:#1a73e8;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Acessar meus dados</a></p><p style="color:#6b7280;font-size:13px">Se não foi você, ignore esta mensagem.</p>`,
      })
      return
    } catch (e: any) { console.warn('[titular] envio email falhou, tenta WhatsApp:', e?.message) }
  }
  if (lead.whatsapp) {
    try {
      const { getProviderForLead } = await import('../services/whatsappProvider.js')
      const provider = await getProviderForLead({ id: lead.id, whatsapp: lead.whatsapp })
      await provider.sendText(lead.whatsapp, msg)
    } catch (e: any) { console.warn('[titular] envio WhatsApp falhou:', e?.message) }
  }
}

const reqAccessHits = new Map<string, { n: number; reset: number }>()

export async function titularRoutes(app: FastifyInstance) {
  // ── Página /meus-dados — path ESTÁTICO + token na query (?t=).
  //    Sem ?t: formulário de pedido de acesso. Com ?t válido: portal do titular.
  //    (Token em :param de path é instável no find-my-way p/ valores longos.)
  app.get<{ Querystring: { t?: string } }>('/meus-dados', async (req, reply) => {
    const tok = String((req.query as any).t || '')
    if (!tok) { reply.type('text/html').send(pageRequest(req)); return }
    const p = verifyTitularToken(tok)
    if (!p) { reply.code(404).type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Link inválido</title>${LAYOUT_HEAD}</head><body><h1>Link inválido ou expirado</h1><p class="sub">Solicite um novo acesso em <a href="/meus-dados">/meus-dados</a>.</p></body></html>`); return }
    const lead = await prisma.lead.findUnique({
      where: { id: p.leadId },
      select: { id: true, nome: true, email: true, whatsapp: true, empresa: true, cidade: true, createdAt: true, lgpdConsent: true, lgpdConsentAt: true },
    })
    if (!lead) { reply.code(404).type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Não encontrado</title>${LAYOUT_HEAD}</head><body><h1>Cadastro não encontrado</h1><p class="sub">Seus dados podem já ter sido eliminados. Em caso de dúvida, contate o Encarregado.</p></body></html>`); return }
    let prefsUrl = '/meus-dados'
    try { prefsUrl = await getPreferencesUrl(lead.id) } catch { /* fallback */ }
    reply.type('text/html').send(pagePortal(req, tok, lead, prefsUrl))
  })

  // ── Pedido de acesso: envia magic link (resposta SEMPRE neutra) ──
  app.post('/api/public/titular/request-access', async (req, reply) => {
    const ip = getIp(req)
    const now = Date.now()
    const h = reqAccessHits.get(ip) || { n: 0, reset: now + 60_000 }
    if (now > h.reset) { h.n = 0; h.reset = now + 60_000 }
    h.n++; reqAccessHits.set(ip, h)
    if (h.n > 5) return reply.code(429).send({ ok: false, error: 'Muitas tentativas. Aguarde 1 minuto.' })

    const contact = String((req.body as any)?.contact || '')
    try {
      const lead = await findLeadByContact(contact)
      if (lead) {
        await sendAccessLink(req, lead)
        logEvent({
          leadId: lead.id, type: 'dsar_access_requested', category: 'lifecycle',
          title: 'Titular pediu acesso aos próprios dados (LGPD)', actorType: 'lead',
          source: 'titular_portal', ipAddress: ip, metadata: { channel: lead.email ? 'email' : 'whatsapp' },
        })
      }
    } catch (e: any) { req.log?.warn?.({ err: e?.message }, '[titular] request-access') }
    // Neutro: não revela existência de cadastro.
    return { ok: true }
  })

  // ── Export (portabilidade). Token via QUERY e ações via BODY (paths estáticos):
  //    o radix tree do find-my-way não casa o token longo quando ele é um :param
  //    em path profundo — então tiramos o token do path nas rotas da API.
  app.get<{ Querystring: { token?: string; format?: string } }>('/api/public/titular/export', async (req, reply) => {
    const data = await buildExport(String((req.query as any).token || ''))
    if (!data) return reply.code(404).send({ error: 'Link inválido ou expirado' })
    if ((req.query as any).format === 'csv') {
      return reply.header('Content-Disposition', 'attachment; filename="meus-dados.csv"').type('text/csv; charset=utf-8').send(toCsv(data))
    }
    reply.header('Content-Disposition', 'attachment; filename="meus-dados.json"').type('application/json').send(JSON.stringify(data, null, 2))
  })

  // ── Revogar consentimento (imediato) ──
  app.post<{ Body: { token?: string } }>('/api/public/titular/revogar', async (req, reply) => {
    const tp = verifyTitularToken(String((req.body as any)?.token || ''))
    if (!tp) return reply.code(404).send({ ok: false, error: 'Link inválido ou expirado' })
    const lead = await prisma.lead.findUnique({ where: { id: tp.leadId }, select: { id: true, nome: true, email: true, whatsapp: true, lgpdConsent: true } })
    if (!lead) return reply.code(404).send({ ok: false, error: 'Cadastro não encontrado' })

    await prisma.lead.update({
      where: { id: lead.id },
      data: { lgpdConsent: false, lgpdConsentSource: 'titular', optOutChannels: ['whatsapp', 'email', 'sms'] },
    })
    await prisma.consentLog.create({
      data: {
        leadId: lead.id, categories: { titular: false }, policyVersion: '1.0',
        action: 'withdraw', source: 'titular_portal', ip: getIp(req),
        userAgent: (req.headers['user-agent'] || '').toString().slice(0, 1000) || null,
      },
    }).catch(() => {})
    await prisma.dataSubjectRequest.create({
      data: {
        leadId: lead.id, email: lead.email || null, whatsapp: lead.whatsapp || null, name: lead.nome || null,
        type: 'revocation', status: 'done', source: 'titular_portal', ip: getIp(req),
        dueAt: new Date(Date.now() + 15 * 86400_000), handledAt: new Date(),
        details: { note: 'Revogação imediata + opt-out total pelo titular.' },
      },
    }).catch(() => {})
    logEvent({
      leadId: lead.id, type: 'dsar_consent_withdrawn', category: 'lifecycle',
      title: 'Titular revogou o consentimento (LGPD)', actorType: 'lead', source: 'titular_portal',
      oldValue: lead.lgpdConsent ? 'concedido' : 'não concedido', newValue: 'revogado', ipAddress: getIp(req),
    })
    notifyEncarregado('Consentimento revogado pelo titular', [
      `Lead #${lead.id} — ${lead.nome || '(sem nome)'}`,
      `E-mail: ${lead.email || '—'} · WhatsApp: ${lead.whatsapp || '—'}`,
      `Ação: revogação de consentimento + opt-out total (imediato).`,
    ]).catch(() => {})
    return { ok: true }
  })

  // ── Solicitar correção / eliminação (cria requisição c/ SLA) ──
  app.post<{ Body: { token?: string; type?: string; message?: string } }>('/api/public/titular/solicitar', async (req, reply) => {
    const tp = verifyTitularToken(String((req.body as any)?.token || ''))
    if (!tp) return reply.code(404).send({ ok: false, error: 'Link inválido ou expirado' })
    const type = String((req.body as any)?.type || '')
    if (type !== 'correction' && type !== 'deletion') return reply.code(400).send({ ok: false, error: 'Tipo inválido' })
    const message = String((req.body as any)?.message || '').slice(0, 4000)
    const lead = await prisma.lead.findUnique({ where: { id: tp.leadId }, select: { id: true, nome: true, email: true, whatsapp: true } })
    if (!lead) return reply.code(404).send({ ok: false, error: 'Cadastro não encontrado' })

    const dsr = await prisma.dataSubjectRequest.create({
      data: {
        leadId: lead.id, email: lead.email || null, whatsapp: lead.whatsapp || null, name: lead.nome || null,
        type, status: 'pending', source: 'titular_portal', ip: getIp(req),
        dueAt: new Date(Date.now() + 15 * 86400_000),
        details: { message },
      },
    })
    logEvent({
      leadId: lead.id, type: type === 'deletion' ? 'dsar_deletion_requested' : 'dsar_correction_requested',
      category: 'lifecycle', title: `Titular solicitou ${type === 'deletion' ? 'eliminação' : 'correção'} de dados (LGPD)`,
      actorType: 'lead', source: 'titular_portal', description: message || undefined, ipAddress: getIp(req),
      metadata: { requestId: dsr.id },
    })
    notifyEncarregado(`Nova requisição de titular: ${type === 'deletion' ? 'ELIMINAÇÃO' : 'correção'}`, [
      `Requisição #${dsr.id} — Lead #${lead.id} — ${lead.nome || '(sem nome)'}`,
      `E-mail: ${lead.email || '—'} · WhatsApp: ${lead.whatsapp || '—'}`,
      `Mensagem: ${message || '(sem detalhes)'}`,
      `Prazo de atendimento: ${dsr.dueAt.toLocaleDateString('pt-BR')} (15 dias).`,
    ]).catch(() => {})
    return { ok: true, requestId: dsr.id }
  })

  // ─── ADMIN: gestão das requisições (Encarregado) ───────────────────
  // GET lista + contadores (pendentes / em atraso).
  app.get<{ Querystring: { status?: string } }>('/api/admin/dsar', { preHandler: adminOnly }, async (req) => {
    const status = String((req.query as any).status || '')
    const where = status && status !== 'all' ? { status } : {}
    const [requests, pending, total] = await Promise.all([
      prisma.dataSubjectRequest.findMany({ where, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], take: 500 }),
      prisma.dataSubjectRequest.count({ where: { status: { in: ['pending', 'in_progress'] } } }),
      prisma.dataSubjectRequest.count(),
    ])
    const now = Date.now()
    const overdue = requests.filter((r) => ['pending', 'in_progress'].includes(r.status) && r.dueAt.getTime() < now).length
    return { requests, counts: { pending, overdue, total } }
  })

  // POST atualiza status / resposta de uma requisição.
  app.post<{ Params: { id: string }; Body: { status?: string; response?: string } }>('/api/admin/dsar/:id', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    if (isNaN(id)) return reply.code(400).send({ error: 'id inválido' })
    const dsr = await prisma.dataSubjectRequest.findUnique({ where: { id } })
    if (!dsr) return reply.code(404).send({ error: 'Requisição não encontrada' })
    const status = String((req.body as any)?.status || dsr.status)
    if (!['pending', 'in_progress', 'done', 'rejected'].includes(status)) return reply.code(400).send({ error: 'status inválido' })
    const response = typeof (req.body as any)?.response === 'string' ? (req.body as any).response.slice(0, 4000) : undefined
    const done = status === 'done' || status === 'rejected'
    const updated = await prisma.dataSubjectRequest.update({
      where: { id },
      data: {
        status,
        ...(response !== undefined ? { response } : {}),
        ...(done ? { handledAt: new Date(), handledBy: user.userId } : { handledAt: null }),
      },
    })
    if (dsr.leadId) {
      logEvent({
        leadId: dsr.leadId, type: 'dsar_status_changed', category: 'lifecycle',
        title: `Requisição LGPD #${id} → ${status}`, actorType: 'operator', userId: user.userId,
        source: 'admin', oldValue: dsr.status, newValue: status, description: response || undefined,
      })
    }
    return { ok: true, request: updated }
  })

  // POST executa a ELIMINAÇÃO do lead (envia à lixeira) e conclui a requisição.
  // Só para requisições do tipo 'deletion'. Rastreável e reversível por 90 dias.
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/api/admin/dsar/:id/delete-lead', { preHandler: adminOnly }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const id = parseInt((req.params as any).id)
    if (isNaN(id)) return reply.code(400).send({ error: 'id inválido' })
    const dsr = await prisma.dataSubjectRequest.findUnique({ where: { id } })
    if (!dsr) return reply.code(404).send({ error: 'Requisição não encontrada' })
    if (dsr.type !== 'deletion') return reply.code(400).send({ error: 'Apenas requisições de eliminação podem excluir o lead.' })
    if (!dsr.leadId) return reply.code(400).send({ error: 'Requisição sem lead vinculado.' })

    const snapshot = await snapshotLead(dsr.leadId)
    if (!snapshot) {
      // Lead já não existe — apenas conclui a requisição.
      const upd = await prisma.dataSubjectRequest.update({ where: { id }, data: { status: 'done', handledAt: new Date(), handledBy: user.userId, response: 'Lead já não existia no momento da execução.' } })
      return { ok: true, alreadyGone: true, request: upd }
    }
    await moveToTrash({
      entityType: 'lead', entityId: dsr.leadId,
      entityLabel: `${snapshot.empresa || ''} — ${snapshot.nome || snapshot.whatsapp || ''}`.trim(),
      snapshot, deletedBy: user.userId, deletedByName: user.name || user.email,
      reason: `LGPD: eliminação a pedido do titular (requisição #${id})`,
    })
    await prisma.lead.delete({ where: { id: dsr.leadId } })
    const upd = await prisma.dataSubjectRequest.update({
      where: { id }, data: { status: 'done', handledAt: new Date(), handledBy: user.userId, response: String((req.body as any)?.reason || 'Dados eliminados (movidos para a lixeira, purga em 90 dias).').slice(0, 4000) },
    })
    return { ok: true, request: upd }
  })
}

// ─── Montagem do pacote de portabilidade ───────────────────────────
async function buildExport(token: string): Promise<any | null> {
  const tp = verifyTitularToken(token)
  if (!tp) return null
  const lead = await prisma.lead.findUnique({
    where: { id: tp.leadId },
    select: {
      id: true, uid: true, nome: true, email: true, whatsapp: true, empresa: true, segmento: true, cidade: true,
      customFields: true, formData: true, status: true, source: true, createdAt: true,
      lgpdConsent: true, lgpdConsentAt: true, lgpdConsentSource: true, optOutChannels: true,
      utmSource: true, utmMedium: true, utmCampaign: true,
    },
  })
  if (!lead) return null
  const [messages, events, registrations, consentLogs] = await Promise.all([
    prisma.message.findMany({ where: { leadId: lead.id, isInternal: false, isDeleted: false }, select: { fromMe: true, body: true, mediaType: true, timestamp: true }, orderBy: { timestamp: 'asc' }, take: 5000 }),
    prisma.leadEvent.findMany({ where: { leadId: lead.id }, select: { type: true, title: true, createdAt: true, channel: true }, orderBy: { createdAt: 'asc' }, take: 2000 }),
    prisma.enrollmentRegistration.findMany({ where: { leadId: lead.id }, select: { id: true, status: true, createdAt: true } }).catch(() => []),
    prisma.consentLog.findMany({ where: { leadId: lead.id }, select: { categories: true, action: true, policyVersion: true, source: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ])
  return {
    _aviso: 'Cópia dos seus dados pessoais tratados, fornecida nos termos do art. 18 da LGPD.',
    geradoEm: new Date().toISOString(),
    cadastro: lead,
    consentimentos: consentLogs,
    mensagens: messages.map((m) => ({ de: m.fromMe ? 'empresa' : 'titular', tipo: m.mediaType, texto: m.body, data: m.timestamp })),
    eventos: events,
    inscricoes: registrations,
  }
}

function toCsv(data: any): string {
  const rows: string[][] = [['secao', 'campo', 'valor']]
  const cell = (v: any) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  for (const [k, v] of Object.entries(data.cadastro || {})) rows.push(['cadastro', k, cell(v)])
  ;(data.consentimentos || []).forEach((c: any, i: number) => rows.push(['consentimento', `#${i + 1}`, cell(c)]))
  ;(data.mensagens || []).forEach((m: any, i: number) => rows.push(['mensagem', `#${i + 1} (${m.de})`, `${cell(m.data)} — ${cell(m.texto)}`]))
  ;(data.eventos || []).forEach((e: any, i: number) => rows.push(['evento', `#${i + 1}`, `${cell(e.createdAt)} — ${cell(e.title)}`]))
  ;(data.inscricoes || []).forEach((r: any, i: number) => rows.push(['inscricao', `#${i + 1}`, cell(r)]))
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')
}
