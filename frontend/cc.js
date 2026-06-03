/**
 * cc.js — ByChat Consent Client (LGPD)
 * Banner de cookies + Google Consent Mode v2 + registro de consentimento.
 *
 * Pré-requisito: o snippet gtag de cada página define `gtag('consent','default', {... denied})`
 * ANTES de carregar este script. Aqui apenas atualizamos (granted/denied) conforme a escolha.
 *
 * Categorias: analytics, marketing. "Necessários" são sempre permitidos.
 * Sincroniza com o Beyond Tracking (cookie bt_consent) e emite o evento `bych:consent`.
 */
(function (w, d) {
  'use strict';
  var COOKIE = 'bych_consent';
  var DAYS = 180;
  var VERSION = (w.__BYCH_POLICY_VERSION__ || '1.0');

  function getCookie(n) {
    var m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(n, v, days) {
    var dt = new Date(); dt.setTime(dt.getTime() + days * 864e5);
    var secure = location.protocol === 'https:' ? ';Secure' : '';
    d.cookie = n + '=' + encodeURIComponent(v) + ';expires=' + dt.toUTCString() + ';path=/;SameSite=Lax' + secure;
  }
  function readDecision() {
    try { var v = getCookie(COOKIE); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function gtagSafe() {
    w.dataLayer = w.dataLayer || [];
    if (!w.gtag) { w.gtag = function () { w.dataLayer.push(arguments); }; }
    return w.gtag;
  }

  function applyConsent(c) {
    var g = gtagSafe();
    g('consent', 'update', {
      analytics_storage: c.analytics ? 'granted' : 'denied',
      ad_storage: c.marketing ? 'granted' : 'denied',
      ad_user_data: c.marketing ? 'granted' : 'denied',
      ad_personalization: c.marketing ? 'granted' : 'denied'
    });
    w.__bychConsent = c;
    // Beyond Tracking lê bt_consent (granted|denied) — analytics governa.
    setCookie('bt_consent', c.analytics ? 'granted' : 'denied', DAYS);
    // Pixels de marketing (Meta/TikTok/LinkedIn) não respeitam Consent Mode:
    // ficam numa fila e só executam quando o consentimento de marketing é dado.
    w.bychMarketingGranted = !!c.marketing;
    if (c.marketing) {
      var q = w.__bychMktQ || []; w.__bychMktQ = [];
      for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) {} }
    }
    w.bychOnMarketingConsent = function (fn) { if (w.bychMarketingGranted) { try { fn(); } catch (e) {} } };
    try { w.dispatchEvent(new CustomEvent('bych:consent', { detail: c })); } catch (e) {}
  }

  function persist(c, action) {
    setCookie(COOKIE, JSON.stringify({ a: c.analytics ? 1 : 0, m: c.marketing ? 1 : 0, v: VERSION, t: Date.now() }), DAYS);
    applyConsent(c);
    try {
      fetch('/api/public/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({
          categories: { analytics: !!c.analytics, marketing: !!c.marketing },
          action: action, policyVersion: VERSION, source: location.pathname, url: location.href
        })
      }).catch(function () {});
    } catch (e) {}
  }

  // ─── UI ───────────────────────────────────────────────
  var EL_ID = 'bych-cc';
  function remove() { var e = d.getElementById(EL_ID); if (e) e.remove(); }

  function bannerHtml() {
    return '' +
      '<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483646;background:#0f172a;color:#e2e8f0;' +
      'padding:16px 20px;box-shadow:0 -6px 24px rgba(0,0,0,.25);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
      '<div style="max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between">' +
      '<div style="flex:1;min-width:260px;font-size:13.5px;line-height:1.55">' +
      'Usamos cookies para operar o site e, com seu consentimento, para medir audiência e personalizar comunicações. ' +
      'Veja a <a href="/cookies" style="color:#7dd3fc">Política de Cookies</a> e a <a href="/privacidade" style="color:#7dd3fc">Política de Privacidade</a>.' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button id="bych-cc-prefs" style="' + btn('#1e293b', '#e2e8f0', '#334155') + '">Preferências</button>' +
      '<button id="bych-cc-reject" style="' + btn('#1e293b', '#e2e8f0', '#334155') + '">Recusar</button>' +
      '<button id="bych-cc-accept" style="' + btn('#22c55e', '#06231a', '#22c55e') + '">Aceitar todos</button>' +
      '</div></div></div>';
  }
  function btn(bg, fg, bd) {
    return 'cursor:pointer;border:1px solid ' + bd + ';background:' + bg + ';color:' + fg +
      ';font-weight:600;font-size:13.5px;padding:9px 16px;border-radius:9px;font-family:inherit';
  }
  function prefsHtml(cur) {
    function row(id, title, desc, checked, disabled) {
      return '<label style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid #1e293b">' +
        '<input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' ' + (disabled ? 'disabled' : '') +
        ' style="margin-top:3px;width:18px;height:18px">' +
        '<span><b style="font-size:14px">' + title + '</b><br><span style="font-size:12.5px;color:#94a3b8">' + desc + '</span></span></label>';
    }
    return '<div style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">' +
      '<div role="dialog" aria-label="Preferências de cookies" style="background:#0f172a;color:#e2e8f0;max-width:440px;width:100%;border-radius:14px;padding:22px">' +
      '<div style="font-size:17px;font-weight:700;margin-bottom:4px">Preferências de cookies</div>' +
      '<div style="font-size:12.5px;color:#94a3b8;margin-bottom:6px">Recusar é tão simples quanto aceitar. Os cookies necessários não podem ser desativados.</div>' +
      row('bych-cc-nec', 'Necessários', 'Sessão, segurança e funcionamento básico.', true, true) +
      row('bych-cc-ana', 'Analíticos', 'Medição de audiência (ex.: Google Analytics).', cur.analytics, false) +
      row('bych-cc-mkt', 'Marketing', 'Personalização e medição de anúncios (Meta, Google Ads, etc.).', cur.marketing, false) +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
      '<button id="bych-cc-save" style="' + btn('#22c55e', '#06231a', '#22c55e') + '">Salvar preferências</button>' +
      '</div></div></div>';
  }

  function showBanner() {
    remove();
    var wrap = d.createElement('div'); wrap.id = EL_ID; wrap.innerHTML = bannerHtml();
    (d.body || d.documentElement).appendChild(wrap);
    d.getElementById('bych-cc-accept').onclick = function () { remove(); persist({ analytics: true, marketing: true }, 'accept_all'); };
    d.getElementById('bych-cc-reject').onclick = function () { remove(); persist({ analytics: false, marketing: false }, 'reject'); };
    d.getElementById('bych-cc-prefs').onclick = function () { showPrefs(w.__bychConsent || { analytics: false, marketing: false }); };
  }
  function showPrefs(cur) {
    remove();
    var wrap = d.createElement('div'); wrap.id = EL_ID; wrap.innerHTML = prefsHtml(cur);
    (d.body || d.documentElement).appendChild(wrap);
    d.getElementById('bych-cc-save').onclick = function () {
      var c = { analytics: d.getElementById('bych-cc-ana').checked, marketing: d.getElementById('bych-cc-mkt').checked };
      remove(); persist(c, 'custom');
    };
  }

  // ─── init ─────────────────────────────────────────────
  var dec = readDecision();
  if (dec) { applyConsent({ analytics: !!dec.a, marketing: !!dec.m }); }
  else { if (d.body) showBanner(); else d.addEventListener('DOMContentLoaded', showBanner); }

  // Reabrir a central de preferências de qualquer lugar.
  w.openCookiePreferences = function () { showPrefs(w.__bychConsent || (dec ? { analytics: !!dec.a, marketing: !!dec.m } : { analytics: false, marketing: false })); };
})(window, document);
