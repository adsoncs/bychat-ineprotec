// src/services/clinicaExperts/passosScript.ts
//
// O JavaScript da página pública para o agendamento em três passos.
//
// Fica aqui, e não dentro de `schedulingPublic.ts`, porque aquele arquivo é
// igual nos 13 tenants. Lá só existe um ponto de extensão de três linhas:
//
//     if (window.__cePassos) window.__cePassos(info, ctx); else loadSlots();
//
// Em qualquer tenant sem esta integração o script não é servido,
// `window.__cePassos` não existe e a página segue idêntica ao que sempre foi.
//
// O script reaproveita as classes de estilo que a página já define (.slot,
// .day, .days, .btn, .back, .muted, .err, .ok) — nada de CSS novo, para a
// aparência continuar sendo a do tipo de agendamento.

/**
 * Devolve o conteúdo do script. Servido como `application/javascript` em
 * `/api/public/clinica-experts/passos.js`.
 */
export function scriptDosPassos(): string {
  return `/* Agendamento em três passos — Clinica Experts */
(function () {
  'use strict';

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  var WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  window.__cePassos = function (info, ctx) {
    var box = ctx.box;
    var slug = ctx.slug;
    var base = '/api/public/clinica-experts/' + encodeURIComponent(slug);
    var estado = { procedimento: null, duracao: null, profissional: null, escolherProfissional: true, horario: null };

    function erro(msg, tentarDeNovo) {
      box.innerHTML = '<div class="muted">' + esc(msg) + '</div>';
      if (tentarDeNovo) {
        var b = document.createElement('button');
        b.className = 'btn'; b.textContent = 'Tentar de novo';
        b.onclick = tentarDeNovo; box.appendChild(b);
      }
    }

    function carregando(texto) {
      box.innerHTML = '<div class="muted">' + esc(texto || 'Carregando…') + '</div>';
    }

    // ── Passo 1 — o que a pessoa quer fazer ────────────────────────────────
    function passoProcedimento() {
      carregando('Carregando os procedimentos…');
      fetch(base + '/procedimentos').then(function (r) { return r.json(); }).then(function (d) {
        if (d.error || !d.itens || !d.itens.length) {
          // Sem catálogo não dá para seguir por aqui: cai no fluxo simples, que
          // é melhor que deixar a pessoa sem conseguir agendar.
          ctx.loadSlotsPadrao();
          return;
        }
        var h = '<div class="muted" style="margin-bottom:10px">O que você quer agendar?</div><div class="days"><div class="day">';
        d.itens.forEach(function (p) {
          h += '<button class="slot" style="display:block;width:100%;text-align:left" data-id="' + p.id + '" data-dur="' + p.duracaoMin + '">'
            + esc(p.nome) + ' <span class="muted">· ' + p.duracaoMin + ' min</span></button>';
        });
        h += '</div></div>';
        box.innerHTML = h;
        Array.prototype.forEach.call(box.querySelectorAll('.slot'), function (btn) {
          btn.onclick = function () {
            estado.procedimento = btn.dataset.id;
            estado.duracao = btn.dataset.dur;
            passoProfissional();
          };
        });
      }).catch(function () { ctx.loadSlotsPadrao(); });
    }

    // ── Passo 2 — com quem ─────────────────────────────────────────────────
    function passoProfissional() {
      carregando('Carregando os profissionais…');
      fetch(base + '/profissionais').then(function (r) { return r.json(); }).then(function (d) {
        estado.escolherProfissional = d.escolherProfissional !== false;
        var itens = d.itens || [];
        // Um profissional só, ou a clínica não deixa escolher: pula o passo.
        if (!estado.escolherProfissional || itens.length <= 1) {
          estado.profissional = itens.length === 1 ? String(itens[0].usuarioId) : null;
          passoHorario();
          return;
        }
        var h = '<button class="back" id="ce_bk">← voltar</button>'
          + '<div class="muted" style="margin:8px 0 10px">Com quem você prefere se atender?</div>'
          + '<div class="days"><div class="day">';
        itens.forEach(function (p) {
          h += '<button class="slot" style="display:block;width:100%;text-align:left" data-u="' + p.usuarioId + '">' + esc(p.nome) + '</button>';
        });
        h += '<button class="slot" style="display:block;width:100%;text-align:left" data-u="">Não tenho preferência</button>';
        h += '</div></div>';
        box.innerHTML = h;
        document.getElementById('ce_bk').onclick = passoProcedimento;
        Array.prototype.forEach.call(box.querySelectorAll('.slot'), function (btn) {
          btn.onclick = function () { estado.profissional = btn.dataset.u || null; passoHorario(); };
        });
      }).catch(function () { erro('Não consegui carregar os profissionais.', passoProfissional); });
    }

    // ── Passo 3 — quando ───────────────────────────────────────────────────
    function passoHorario() {
      carregando('Procurando horários…');
      var q = '?procedimento=' + encodeURIComponent(estado.procedimento);
      if (estado.profissional) q += '&profissional=' + encodeURIComponent(estado.profissional);
      fetch(base + '/horarios' + q).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { erro(d.error, passoProfissional); return; }
        var days = (d.days || []).filter(function (x) { return x.slots.length; });
        var voltar = '<button class="back" id="ce_bk">← voltar</button>';
        if (!days.length) {
          box.innerHTML = voltar + '<div class="muted" style="margin-top:8px">Nenhum horário disponível para essa escolha.</div>';
          document.getElementById('ce_bk').onclick = passoProfissional;
          return;
        }
        var h = voltar + '<div class="muted" style="margin:8px 0">' + d.durationMin + ' min</div><div class="days">';
        days.slice(0, 14).forEach(function (day) {
          var dd = day.date.slice(8, 10) + '/' + day.date.slice(5, 7);
          h += '<div class="day"><h3>' + WD[day.weekday] + ' ' + dd + '</h3>';
          day.slots.forEach(function (s) {
            h += '<button class="slot" data-s="' + s.startAt + '" data-l="' + esc(s.label) + '" data-d="' + dd + '" data-w="' + WD[day.weekday] + '">' + esc(s.label) + '</button>';
          });
          h += '</div>';
        });
        h += '</div>';
        box.innerHTML = h;
        document.getElementById('ce_bk').onclick = passoProfissional;
        Array.prototype.forEach.call(box.querySelectorAll('.slot'), function (btn) {
          btn.onclick = function () { passoDados(btn.dataset); };
        });
      }).catch(function () { erro('Não consegui carregar os horários.', passoHorario); });
    }

    // ── Passo 4 — quem é você ──────────────────────────────────────────────
    function passoDados(d) {
      estado.horario = d.s;
      box.innerHTML = '<button class="back" id="ce_bk">← voltar</button>'
        + '<div class="muted">' + esc(d.w) + ', ' + esc(d.d) + ' às <b>' + esc(d.l) + '</b></div>'
        + '<label>Nome*</label><input id="ce_name" placeholder="Seu nome">'
        + '<label>E-mail</label><input id="ce_email" type="email" placeholder="voce@email.com">'
        + '<label>WhatsApp/Telefone</label><input id="ce_phone" placeholder="(62) 99999-9999">'
        + '<button class="btn" id="ce_go">Confirmar agendamento</button><div class="err" id="ce_er"></div>';
      document.getElementById('ce_bk').onclick = passoHorario;
      document.getElementById('ce_go').onclick = enviar;
    }

    function enviar() {
      var nome = document.getElementById('ce_name').value.trim();
      var email = document.getElementById('ce_email').value.trim();
      var fone = document.getElementById('ce_phone').value.trim();
      var er = document.getElementById('ce_er');
      if (!nome) { er.textContent = 'Informe seu nome'; return; }
      if (!email && !fone) { er.textContent = 'Informe e-mail ou telefone'; return; }
      var go = document.getElementById('ce_go');
      go.disabled = true; go.textContent = 'Agendando…';

      fetch(base + '/reservar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nome, email: email, phone: fone,
          startAt: estado.horario,
          procedimento: estado.procedimento,
          profissional: estado.profissional,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          visitorId: ctx.visitorId, utm: ctx.utm
        })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res.error) {
          er.textContent = res.error;
          go.disabled = false; go.textContent = 'Confirmar agendamento';
          // Horário tomado no meio do caminho: volta para a grade já atualizada.
          passoHorario();
          return;
        }
        var dt = new Date(res.booking.startAt);
        box.innerHTML = '<div class="ok"><div class="ico">✅</div><h2>Agendado!</h2>'
          + '<p class="muted">' + dt.toLocaleString('pt-BR') + '</p>'
          + '<p class="muted">Você receberá a confirmação em breve.</p></div>';
      }).catch(function () {
        er.textContent = 'Não consegui concluir agora. Tente de novo.';
        go.disabled = false; go.textContent = 'Confirmar agendamento';
      });
    }

    passoProcedimento();
  };
})();
`
}
