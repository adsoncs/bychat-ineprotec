// Página pública de agendamento + API pública (sem auth). Fase 3.
import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { getMeetingTypeSlots, createBooking, validateSlot } from '../services/schedulingService.js'
import { notifyBooking, notifyCancelled } from '../services/schedulingNotify.js'

const LOCATION_LABELS: Record<string, string> = {
  google_meet: 'Google Meet', phone: 'Telefone', whatsapp: 'WhatsApp', in_person: 'Presencial', custom: 'Online',
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

async function getActiveType(slug: string) {
  const mt = await prisma.meetingType.findUnique({ where: { slug } })
  if (!mt || !mt.active) return null
  return mt
}

export async function schedulingPublicRoutes(app: FastifyInstance) {
  // ── Página pública (SSR shell + JS) ──
  app.get('/agendar/:slug', async (req, reply) => {
    const slug = (req.params as any).slug
    const embed = (req.query as any)?.embed === '1' || (req.query as any)?.embed === 'true'
    const mt = await getActiveType(slug)
    reply.header('Content-Security-Policy', 'frame-ancestors *')
    reply.type('text/html')
    if (!mt) return reply.code(404).send(renderNotFound())
    return reply.send(renderBookingPage(mt, embed))
  })

  // ── API pública: info do tipo de reunião ──
  app.get('/api/public/scheduling/:slug', async (req, reply) => {
    const mt = await getActiveType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    let ownerName: string | null = null
    if (mt.ownerUserId) {
      const u = await prisma.user.findUnique({ where: { id: mt.ownerUserId }, select: { name: true } })
      ownerName = u?.name ?? null
    }
    return {
      slug: mt.slug, name: mt.name, description: mt.description, color: mt.color,
      durationMin: mt.durationMin, locationType: mt.locationType, locationLabel: LOCATION_LABELS[mt.locationType] ?? mt.locationType,
      timezone: mt.timezone, ownerName, intakeFields: mt.intakeFields ?? null,
    }
  })

  // ── API pública: slots ──
  app.get('/api/public/scheduling/:slug/slots', async (req, reply) => {
    const mt = await getActiveType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const q = (req.query as any) || {}
    const days = await getMeetingTypeSlots(mt, { from: q.from || undefined, to: q.to || undefined })
    return { timezone: mt.timezone, durationMin: mt.durationMin, days }
  })

  // ── API pública: reservar ──
  app.post('/api/public/scheduling/:slug/book', async (req, reply) => {
    const mt = await getActiveType((req.params as any).slug)
    if (!mt) return reply.code(404).send({ error: 'Não encontrado' })
    const b = (req.body as any) || {}
    const result = await createBooking(mt, {
      name: b.name, email: b.email, phone: b.phone, startAt: b.startAt, answers: b.answers,
      timezone: b.timezone, visitorId: b.visitorId, utm: b.utm,
    })
    if (!result.ok) return reply.code(400).send({ error: result.error })
    return result
  })

  // ── Info de uma reserva (pra páginas de cancelar/remarcar) ──
  app.get('/api/public/scheduling/booking/:token', async (req, reply) => {
    const token = (req.params as any).token
    const b = await prisma.booking.findUnique({ where: { token } })
    if (!b) return reply.code(404).send({ error: 'Reserva não encontrada' })
    const mt = await prisma.meetingType.findUnique({ where: { id: b.meetingTypeId }, select: { name: true, slug: true, durationMin: true } })
    return { name: mt?.name, slug: mt?.slug, durationMin: mt?.durationMin, startAt: b.startAt.toISOString(), timezone: b.timezone, status: b.status }
  })

  // ── Cancelar ──
  app.post('/api/public/scheduling/booking/:token/cancel', async (req, reply) => {
    const token = (req.params as any).token
    const b = await prisma.booking.findUnique({ where: { token } })
    if (!b) return reply.code(404).send({ error: 'Reserva não encontrada' })
    if (b.status === 'cancelled') return { ok: true }
    const reason = ((req.body as any)?.reason || '').toString().substring(0, 255) || null
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled', cancelReason: reason } })
    if (b.activityId) {
      await prisma.activity.update({ where: { id: b.activityId }, data: { status: 'cancelled' } }).catch(() => {})
      import('../services/googleCalendarSync.js').then((m) => m.unsyncActivityFromCalendar(b.activityId!)).catch(() => {})
    }
    notifyCancelled(b.id).catch(() => {})
    return { ok: true }
  })

  // ── Remarcar (escolhe novo horário; valida e atualiza) ──
  app.post('/api/public/scheduling/booking/:token/reschedule', async (req, reply) => {
    const token = (req.params as any).token
    const b = await prisma.booking.findUnique({ where: { token } })
    if (!b) return reply.code(404).send({ error: 'Reserva não encontrada' })
    const mt = await prisma.meetingType.findUnique({ where: { id: b.meetingTypeId } })
    if (!mt || !mt.active) return reply.code(400).send({ error: 'Indisponível' })
    const startAt = ((req.body as any)?.startAt || '').toString()
    const valid = await validateSlot(mt, startAt)
    if (!valid) return reply.code(400).send({ error: 'Horário indisponível. Escolha outro.' })
    const start = new Date(valid)
    const end = new Date(start.getTime() + mt.durationMin * 60000)
    await prisma.booking.update({ where: { id: b.id }, data: { startAt: start, endAt: end, status: 'scheduled' } })
    if (b.activityId) {
      const a = await prisma.activity.findUnique({ where: { id: b.activityId }, select: { metadata: true } })
      const meta = (a?.metadata as any) || {}
      delete meta.reminded1h; delete meta.reminded24h // reseta lembretes
      await prisma.activity.update({ where: { id: b.activityId }, data: { scheduledAt: start, reminderAt: new Date(start.getTime() - 3600000), status: 'pending', metadata: meta } }).catch(() => {})
      import('../services/googleCalendarSync.js').then((m) => m.syncActivityToCalendar(b.activityId!)).catch(() => {})
        .finally(() => { notifyBooking(b.id, 'confirmation').catch(() => {}) })
    } else {
      notifyBooking(b.id, 'confirmation').catch(() => {})
    }
    return { ok: true, startAt: start.toISOString() }
  })

  // ── Página: cancelar ──
  app.get('/agendar/cancelar/:token', async (req, reply) => {
    reply.header('Content-Security-Policy', 'frame-ancestors *').type('text/html')
    return reply.send(renderManagePage((req.params as any).token, 'cancel'))
  })
  // ── Página: remarcar ──
  app.get('/agendar/remarcar/:token', async (req, reply) => {
    reply.header('Content-Security-Policy', 'frame-ancestors *').type('text/html')
    return reply.send(renderManagePage((req.params as any).token, 'reschedule'))
  })
}

function renderManagePage(token: string, mode: 'cancel' | 'reschedule'): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${mode === 'cancel' ? 'Cancelar' : 'Remarcar'} agendamento</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1f2328}
.wrap{max-width:640px;margin:0 auto;padding:24px 16px}.card{background:#fff;border:1px solid #e6e8eb;border-radius:14px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:19px;margin:0 0 6px}.muted{color:#666;font-size:14px}.btn{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;color:#fff}
.btn.dng{background:#c0392b}.btn.pri{background:#1a73e8}.days{display:flex;gap:12px;overflow-x:auto;margin-top:14px}.day{min-width:110px}.day h3{font-size:12px;color:#555;margin:0 0 6px;text-transform:capitalize}
.slot{display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid #1a73e8;background:#fff;color:#1a73e8;border-radius:8px;cursor:pointer;font-size:13px}.slot:hover{background:#1a73e8;color:#fff}.ok{text-align:center}.ok .ico{font-size:40px}</style></head>
<body><div class="wrap"><div class="card" id="c"><div class="muted">Carregando…</div></div></div>
<script>(function(){
var TK=${JSON.stringify(token)},MODE=${JSON.stringify(mode)},WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
var API='/api/public/scheduling/booking/'+encodeURIComponent(TK),c=document.getElementById('c'),info=null;
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
fetch(API).then(function(r){return r.json()}).then(function(i){
  if(i.error){c.innerHTML='<h1>Reserva não encontrada</h1>';return}
  info=i;var when=new Date(i.startAt).toLocaleString('pt-BR');
  if(i.status==='cancelled'){c.innerHTML='<h1>Agendamento cancelado</h1><p class="muted">'+esc(i.name)+' — '+when+'</p>';return}
  if(MODE==='cancel'){
    c.innerHTML='<h1>Cancelar agendamento</h1><p class="muted">'+esc(i.name)+'</p><p>📅 <b>'+when+'</b></p><button class="btn dng" id="go">Confirmar cancelamento</button>';
    document.getElementById('go').onclick=function(){var g=this;g.disabled=true;g.textContent='Cancelando…';
      fetch(API+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()}).then(function(res){
        c.innerHTML=res.ok?'<div class="ok"><div class="ico">✅</div><h1>Cancelado</h1><p class="muted">Seu agendamento foi cancelado.</p></div>':'<p>'+(res.error||'Erro')+'</p>';});};
  } else {
    c.innerHTML='<h1>Remarcar</h1><p class="muted">'+esc(i.name)+' — atual: '+when+'</p><div class="muted">Escolha um novo horário:</div><div id="sl">Carregando horários…</div>';
    fetch('/api/public/scheduling/'+encodeURIComponent(i.slug)+'/slots').then(function(r){return r.json()}).then(function(d){
      var days=(d.days||[]).filter(function(x){return x.slots.length});var sl=document.getElementById('sl');
      if(!days.length){sl.innerHTML='<p class="muted">Sem horários disponíveis.</p>';return}
      var h='<div class="days">';days.slice(0,14).forEach(function(day){var dd=day.date.slice(8,10)+'/'+day.date.slice(5,7);h+='<div class="day"><h3>'+WD[day.weekday]+' '+dd+'</h3>';day.slots.forEach(function(s){h+='<button class="slot" data-s="'+s.startAt+'">'+s.label+'</button>'});h+='</div>'});h+='</div>';
      sl.innerHTML=h;Array.prototype.forEach.call(sl.querySelectorAll('.slot'),function(b){b.onclick=function(){
        b.textContent='…';fetch(API+'/reschedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startAt:b.dataset.s})}).then(function(r){return r.json()}).then(function(res){
          if(res.error){alert(res.error);return}c.innerHTML='<div class="ok"><div class="ico">✅</div><h1>Remarcado!</h1><p class="muted">'+new Date(res.startAt).toLocaleString('pt-BR')+'</p></div>';});};});
    });
  }
});})();</script></body></html>`
}

function renderNotFound(): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agendamento</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#444">
<div style="text-align:center"><h1>Link indisponível</h1><p>Este agendamento não existe ou foi desativado.</p></div></body></html>`
}

function renderBookingPage(mt: { slug: string; name: string; color: string | null }, embed = false): string {
  const accent = mt.color || '#1a73e8'
  return `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(mt.name)} — Agendar</title>
<style>
  :root{--accent:${esc(accent)}}
  *{box-sizing:border-box} body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:${embed ? 'transparent' : '#f6f7f9'};color:#1f2328}
  .wrap{max-width:760px;margin:0 auto;padding:${embed ? '0' : '24px 16px'}}
  .card{background:#fff;border:1px solid #e6e8eb;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .head{padding:20px;border-bottom:1px solid #eee}
  .head h1{margin:0 0 4px;font-size:20px} .meta{color:#666;font-size:13px;display:flex;gap:14px;flex-wrap:wrap}
  .body{padding:20px}
  .days{display:flex;gap:14px;overflow-x:auto;padding-bottom:6px}
  .day{min-width:120px} .day h3{font-size:12px;color:#555;margin:0 0 8px;text-transform:capitalize}
  .slot{display:block;width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--accent);background:#fff;color:var(--accent);border-radius:8px;cursor:pointer;font-size:13px}
  .slot:hover{background:var(--accent);color:#fff}
  .muted{color:#888;font-size:13px}
  label{display:block;font-size:12px;color:#555;margin:10px 0 4px}
  input{width:100%;padding:10px;border:1px solid #d6d9dd;border-radius:8px;font-size:14px}
  .btn{margin-top:16px;width:100%;padding:12px;background:var(--accent);color:#fff;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
  .btn:disabled{opacity:.6} .back{background:none;border:0;color:var(--accent);cursor:pointer;font-size:13px;padding:0;margin-bottom:8px}
  .ok{text-align:center;padding:20px} .ok .ico{font-size:40px}
  .err{color:#c0392b;font-size:13px;margin-top:8px}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><h1 id="t">Carregando…</h1><div class="meta" id="m"></div></div>
  <div class="body" id="b"><div class="muted">Carregando horários…</div></div>
</div>
${embed ? '' : '<p class="muted" style="text-align:center;margin-top:12px;font-size:11px">Agendamento via ByChat</p>'}
</div>
<script>
(function(){
  var SLUG=${JSON.stringify(mt.slug)};
  var API='/api/public/scheduling/'+encodeURIComponent(SLUG);
  var WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var info=null, chosen=null;
  var b=document.getElementById('b');
  // utm + visitorId
  var qp=new URLSearchParams(location.search);
  var utm={source:qp.get('utm_source'),medium:qp.get('utm_medium'),campaign:qp.get('utm_campaign'),content:qp.get('utm_content'),term:qp.get('utm_term')};
  var vid=localStorage.getItem('bh_vid'); if(!vid){vid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('bh_vid',vid);}
  function fmtDur(m){return m+' min';}
  fetch(API).then(function(r){return r.json()}).then(function(i){
    if(i.error){document.getElementById('t').textContent='Indisponível';return;}
    info=i; document.getElementById('t').textContent=i.name;
    document.getElementById('m').innerHTML='⏱ '+fmtDur(i.durationMin)+' · '+(i.locationLabel||'')+(i.ownerName?(' · '+i.ownerName):'')+(i.description?('<div style="flex:1 0 100%;margin-top:6px">'+esc(i.description)+'</div>'):'');
    loadSlots();
  });
  function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function loadSlots(){
    fetch(API+'/slots').then(function(r){return r.json()}).then(function(d){
      var days=(d.days||[]).filter(function(x){return x.slots.length});
      if(!days.length){b.innerHTML='<div class="muted">Nenhum horário disponível no momento.</div>';return;}
      var h='<div class="days">';
      days.slice(0,14).forEach(function(day){
        var dd=day.date.slice(8,10)+'/'+day.date.slice(5,7);
        h+='<div class="day"><h3>'+WD[day.weekday]+' '+dd+'</h3>';
        day.slots.forEach(function(s){ h+='<button class="slot" data-s="'+s.startAt+'" data-l="'+s.label+'" data-d="'+dd+'" data-w="'+WD[day.weekday]+'">'+s.label+'</button>'; });
        h+='</div>';
      });
      h+='</div>';
      b.innerHTML=h;
      Array.prototype.forEach.call(b.querySelectorAll('.slot'),function(btn){btn.onclick=function(){pick(btn.dataset)}});
    });
  }
  function pick(d){
    chosen=d.s;
    b.innerHTML='<button class="back" id="bk">← voltar</button>'
      +'<div class="muted">'+d.w+', '+d.d+' às <b>'+d.l+'</b></div>'
      +'<label>Nome*</label><input id="f_name" placeholder="Seu nome">'
      +'<label>E-mail</label><input id="f_email" type="email" placeholder="voce@email.com">'
      +'<label>WhatsApp/Telefone</label><input id="f_phone" placeholder="(62) 99999-9999">'
      +'<button class="btn" id="go">Confirmar agendamento</button><div class="err" id="er"></div>';
    document.getElementById('bk').onclick=loadSlots;
    document.getElementById('go').onclick=submit;
  }
  function submit(){
    var name=document.getElementById('f_name').value.trim();
    var email=document.getElementById('f_email').value.trim();
    var phone=document.getElementById('f_phone').value.trim();
    var er=document.getElementById('er');
    if(!name){er.textContent='Informe seu nome';return;}
    if(!email&&!phone){er.textContent='Informe e-mail ou telefone';return;}
    var go=document.getElementById('go');go.disabled=true;go.textContent='Agendando…';
    fetch(API+'/book',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,email:email,phone:phone,startAt:chosen,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,visitorId:vid,utm:utm})})
      .then(function(r){return r.json()}).then(function(res){
        if(res.error){er.textContent=res.error;go.disabled=false;go.textContent='Confirmar agendamento';loadSlots();return;}
        var dt=new Date(res.booking.startAt);
        b.innerHTML='<div class="ok"><div class="ico">✅</div><h2>Agendado!</h2><p class="muted">'+dt.toLocaleString('pt-BR')+'</p><p class="muted">Você receberá a confirmação em breve.</p></div>';
      }).catch(function(){er.textContent='Erro ao agendar. Tente de novo.';go.disabled=false;go.textContent='Confirmar agendamento';});
  }
})();
</script></body></html>`
}
