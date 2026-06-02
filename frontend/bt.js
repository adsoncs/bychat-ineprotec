/**
 * Beyond Tracking (bt.js) — Script de analytics interno
 * Coleta: pageviews, cliques, scroll depth, tempo na página, form interactions,
 *         UTM params, referrer, fingerprint, device info, Web Vitals, SPA navigation
 * Leve (~5KB gzipped), sem dependencias, privacy-first
 * LGPD/GDPR compliant — requer consentimento antes de coletar dados
 */
(function(win, doc) {
  'use strict';
  if (win.__BT_LOADED) return;
  win.__BT_LOADED = true;

  // ─── Config ────────────────────────────────────────────
  var scriptEl = doc.querySelector('script[src*="bt.js"]');
  var API_BASE = scriptEl ? scriptEl.src.replace(/\/api\/t\/bt\.js.*/, '') : '';
  if (!API_BASE) {
    // Fallback: use a tag script src origin
    var scripts = doc.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('bt.js') !== -1) {
        API_BASE = scripts[i].src.replace(/\/api\/t\/bt\.js.*/, '');
        break;
      }
    }
  }

  var COLLECT_URL = API_BASE + '/api/t/collect';
  var HEARTBEAT_URL = API_BASE + '/api/t/heartbeat';
  var FLUSH_INTERVAL = 3000;      // Enviar batch a cada 3s
  var HEARTBEAT_INTERVAL = 30000; // Heartbeat a cada 30s
  var SCROLL_DEBOUNCE = 500;
  var MAX_QUEUE = 100;
  var CONSENT_COOKIE = 'bt_consent';
  var CONSENT_DAYS = 365;

  // ─── Storage helpers ───────────────────────────────────
  function getCookie(name) {
    var m = doc.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, val, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 86400000);
    var parts = [name + '=' + encodeURIComponent(val), 'expires=' + d.toUTCString(), 'path=/'];
    // Cross-site compatibility
    if (location.protocol === 'https:') {
      parts.push('SameSite=None', 'Secure');
    } else {
      parts.push('SameSite=Lax');
    }
    doc.cookie = parts.join('; ');
  }

  function deleteCookie(name) {
    doc.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  }

  function getSession(key) {
    try { return sessionStorage.getItem(key); } catch(e) { return null; }
  }

  function setSession(key, val) {
    try { sessionStorage.setItem(key, val); } catch(e) {}
  }

  // ─── Consent Management (LGPD/GDPR) ───────────────────
  var consentStatus = getCookie(CONSENT_COOKIE); // 'granted', 'denied', or null
  var trackingActive = consentStatus === 'granted';
  var bannerShown = false;

  function showConsentBanner() {
    if (bannerShown || consentStatus) return;
    bannerShown = true;

    var banner = doc.createElement('div');
    banner.id = 'bt-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Consentimento de cookies');
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;' +
      'background:#1a1a2e;color:#fff;padding:16px 24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'font-size:14px;line-height:1.5;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;' +
      'box-shadow:0 -2px 16px rgba(0,0,0,0.3);border-top:2px solid #4361ee;';

    var textDiv = doc.createElement('div');
    textDiv.style.cssText = 'flex:1;min-width:280px;';
    textDiv.innerHTML = '<strong>Privacidade e Cookies</strong><br>' +
      'Utilizamos cookies e tecnologias semelhantes para melhorar sua experiencia, ' +
      'analisar o trafego e personalizar conteudo. Ao clicar em "Aceitar", voce concorda com o uso dessas tecnologias. ' +
      '<a href="javascript:void(0)" id="bt-consent-details" style="color:#4361ee;text-decoration:underline;">Saiba mais</a>';

    var btnWrap = doc.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';

    var btnAccept = doc.createElement('button');
    btnAccept.textContent = 'Aceitar';
    btnAccept.style.cssText = 'background:#4361ee;color:#fff;border:none;padding:10px 24px;border-radius:6px;' +
      'cursor:pointer;font-size:14px;font-weight:600;transition:background 0.2s;';
    btnAccept.onmouseover = function() { btnAccept.style.background = '#3451d1'; };
    btnAccept.onmouseout = function() { btnAccept.style.background = '#4361ee'; };

    var btnReject = doc.createElement('button');
    btnReject.textContent = 'Recusar';
    btnReject.style.cssText = 'background:transparent;color:#fff;border:1px solid #555;padding:10px 24px;border-radius:6px;' +
      'cursor:pointer;font-size:14px;font-weight:500;transition:background 0.2s;';
    btnReject.onmouseover = function() { btnReject.style.background = 'rgba(255,255,255,0.1)'; };
    btnReject.onmouseout = function() { btnReject.style.background = 'transparent'; };

    btnAccept.onclick = function() { grantConsent(); banner.remove(); };
    btnReject.onclick = function() { denyConsent(); banner.remove(); };

    btnWrap.appendChild(btnAccept);
    btnWrap.appendChild(btnReject);
    banner.appendChild(textDiv);
    banner.appendChild(btnWrap);

    if (doc.body) {
      doc.body.appendChild(banner);
    } else {
      doc.addEventListener('DOMContentLoaded', function() { doc.body.appendChild(banner); });
    }
  }

  function grantConsent() {
    consentStatus = 'granted';
    setCookie(CONSENT_COOKIE, 'granted', CONSENT_DAYS);
    trackingActive = true;
    // Iniciar tracking agora que temos consentimento
    startTracking();
  }

  function denyConsent() {
    consentStatus = 'denied';
    setCookie(CONSENT_COOKIE, 'denied', CONSENT_DAYS);
    trackingActive = false;
    // Limpar cookies de tracking existentes
    deleteCookie('bt_vid');
    try { sessionStorage.removeItem('bt_sid'); } catch(e) {}
  }

  // ─── ID generation ─────────────────────────────────────
  function genId() {
    if (win.crypto && win.crypto.randomUUID) return win.crypto.randomUUID().replace(/-/g, '');
    var s = '';
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ─── Visitor & Session IDs (only when consent granted) ─
  var vid = null;
  var sid = null;
  var isNewSession = false;

  function initIds() {
    vid = getCookie('bt_vid');
    if (!vid) {
      vid = genId();
      setCookie('bt_vid', vid, 365);
    }

    sid = getSession('bt_sid');
    isNewSession = false;
    if (!sid) {
      sid = genId();
      setSession('bt_sid', sid);
      isNewSession = true;
    }
  }

  // ─── Fingerprint (canvas + screen + webgl) ─────────────
  var fingerprint = null;

  function generateFingerprint() {
    var components = [];

    // Screen
    components.push(screen.width + 'x' + screen.height);
    components.push(screen.colorDepth || '');
    components.push(new Date().getTimezoneOffset());
    components.push(navigator.language || '');
    components.push(navigator.hardwareConcurrency || '');
    components.push(navigator.maxTouchPoints || 0);

    // Canvas fingerprint
    try {
      var canvas = doc.createElement('canvas');
      canvas.width = 200; canvas.height = 50;
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(50, 0, 100, 50);
      ctx.fillStyle = '#069';
      ctx.fillText('Beyond Tracking', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Beyond Tracking', 4, 17);
      components.push(canvas.toDataURL().slice(-50));
    } catch(e) {
      components.push('no-canvas');
    }

    // WebGL renderer
    try {
      var gl = doc.createElement('canvas').getContext('webgl');
      if (gl) {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          components.push(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
          components.push(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        }
      }
    } catch(e) {
      components.push('no-webgl');
    }

    // AudioContext fingerprint
    try {
      var AudioCtx = win.OfflineAudioContext || win.webkitOfflineAudioContext;
      if (AudioCtx) {
        components.push('audio-yes');
      }
    } catch(e) {
      components.push('no-audio');
    }

    // Hash using simple djb2
    var str = components.join('|');
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    fingerprint = Math.abs(hash).toString(36) + str.length.toString(36);
  }

  // ─── UTM extraction ────────────────────────────────────
  function getUTMs() {
    var params = {};
    try {
      var sp = new URL(location.href).searchParams;
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) {
        var v = sp.get(k);
        if (v) params[k] = v;
      });
      // Google Ads gclid / Facebook fbclid
      var gclid = sp.get('gclid');
      var fbclid = sp.get('fbclid');
      if (gclid) params.gclid = gclid;
      if (fbclid) params.fbclid = fbclid;
    } catch(e) {}
    return params;
  }

  // ─── Event queue ───────────────────────────────────────
  var queue = [];
  var pendingIdentify = null;
  var sessionStartTime = Date.now();
  var lastActivityTime = Date.now();

  function pushEvent(type, data) {
    if (!trackingActive) return; // Respeitar consentimento
    if (queue.length >= MAX_QUEUE) queue.shift();
    var evt = { t: type, ts: Date.now() };
    if (data) {
      for (var k in data) {
        if (data.hasOwnProperty(k)) evt[k] = data[k];
      }
    }
    queue.push(evt);
    lastActivityTime = Date.now();
  }

  // ─── Flush (send to server) ────────────────────────────
  var flushInProgress = false;

  function flush() {
    if (!trackingActive || flushInProgress || queue.length === 0) return;
    flushInProgress = true;

    var batch = queue.splice(0, 50);
    var utms = getUTMs();

    var payload = {
      vid: vid,
      sid: sid,
      fp: fingerprint,
      events: batch,
      meta: {
        url: location.href,
        ref: doc.referrer || '',
        lang: navigator.language || '',
        sw: screen.width,
        sh: screen.height,
      }
    };

    // Merge UTMs into meta
    for (var k in utms) payload.meta[k] = utms[k];

    // Attach identify if pending
    if (pendingIdentify) {
      payload.identify = pendingIdentify;
      pendingIdentify = null;
    }

    // Use sendBeacon if available, fallback to fetch
    var json = JSON.stringify(payload);
    var sent = false;

    if (navigator.sendBeacon) {
      try {
        sent = navigator.sendBeacon(COLLECT_URL, new Blob([json], { type: 'application/json' }));
      } catch(e) {}
    }

    if (!sent) {
      // Fallback: fetch
      try {
        fetch(COLLECT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json,
          keepalive: true,
          mode: 'cors',
          credentials: 'omit',
        }).then(function() {}).catch(function() {});
      } catch(e) {}
    }

    flushInProgress = false;
  }

  // ─── Heartbeat (session duration) ──────────────────────
  function heartbeat() {
    if (!trackingActive || !sid) return;
    var duration = Math.round((Date.now() - sessionStartTime) / 1000);
    var json = JSON.stringify({ sid: sid, duration: duration });

    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(HEARTBEAT_URL, new Blob([json], { type: 'application/json' }));
        return;
      } catch(e) {}
    }

    try {
      fetch(HEARTBEAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function() {});
    } catch(e) {}
  }

  // ─── Auto-track: Page View ─────────────────────────────
  var lastTrackedUrl = '';

  function trackPageView() {
    var url = location.href;
    if (url === lastTrackedUrl) return;
    lastTrackedUrl = url;
    pushEvent('pageview', {
      url: url,
      title: doc.title,
      ref: doc.referrer || ''
    });
  }

  // ─── Auto-track: Scroll Depth ──────────────────────────
  var maxScrollDepth = 0;
  var scrollTimer = null;

  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function() {
      var docHeight = Math.max(
        doc.body.scrollHeight, doc.documentElement.scrollHeight,
        doc.body.offsetHeight, doc.documentElement.offsetHeight
      );
      var winHeight = win.innerHeight;
      var scrollTop = win.pageYOffset || doc.documentElement.scrollTop;
      var depth = Math.min(100, Math.round(((scrollTop + winHeight) / docHeight) * 100));

      if (depth > maxScrollDepth) {
        maxScrollDepth = depth;
        // Track at 25%, 50%, 75%, 100%
        if (depth >= 25 && depth < 50 && maxScrollDepth < 50) {
          pushEvent('scroll', { scroll_depth: 25, url: location.href });
        } else if (depth >= 50 && depth < 75 && maxScrollDepth < 75) {
          pushEvent('scroll', { scroll_depth: 50, url: location.href });
        } else if (depth >= 75 && depth < 100 && maxScrollDepth < 100) {
          pushEvent('scroll', { scroll_depth: 75, url: location.href });
        } else if (depth >= 100) {
          pushEvent('scroll', { scroll_depth: 100, url: location.href });
        }
      }
    }, SCROLL_DEBOUNCE);
  }

  // ─── Auto-track: Click tracking ────────────────────────
  function getSelector(el) {
    if (!el || el === doc.body || el === doc.documentElement) return 'body';
    var parts = [];
    while (el && el !== doc.body && parts.length < 4) {
      var tag = el.tagName.toLowerCase();
      if (el.id) { parts.unshift('#' + el.id); break; }
      var cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      parts.unshift(tag + cls);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function onClick(e) {
    var el = e.target;
    if (!el) return;

    // So track cliques em links, botoes e elementos interativos
    var clickable = el.closest('a, button, [role="button"], input[type="submit"], [data-bt-track]');
    if (!clickable) return;

    var data = {
      url: location.href,
      selector: getSelector(clickable),
      x: e.clientX,
      y: e.clientY,
    };

    // Info extra para links
    if (clickable.tagName === 'A' && clickable.href) {
      data.value = clickable.href;
    }
    // Texto do botao
    var text = (clickable.textContent || '').trim().slice(0, 100);
    if (text) data.d = { text: text };

    // data-bt-track attribute for custom event names
    var customName = clickable.getAttribute('data-bt-track');
    if (customName) data.d = Object.assign(data.d || {}, { trackName: customName });

    pushEvent('click', data);
  }

  // ─── Auto-track: Form interactions ─────────────────────
  var trackedForms = new WeakSet();

  function trackForms() {
    var forms = doc.querySelectorAll('form');
    forms.forEach(function(form) {
      if (trackedForms.has(form)) return;
      trackedForms.add(form);

      form.addEventListener('focusin', function() {
        pushEvent('form_start', {
          url: location.href,
          selector: getSelector(form),
          d: { action: form.action || '', id: form.id || '' }
        });
      }, { once: true });

      form.addEventListener('submit', function() {
        pushEvent('form_submit', {
          url: location.href,
          selector: getSelector(form),
          d: { action: form.action || '', id: form.id || '' }
        });
      });
    });
  }

  // ─── Auto-track: Visibility / Tab change ───────────────
  var hiddenTime = 0;

  function onVisibilityChange() {
    if (doc.hidden) {
      hiddenTime = Date.now();
      flush(); // Flush antes de sair da tab
      heartbeat();
    } else if (hiddenTime) {
      var away = Math.round((Date.now() - hiddenTime) / 1000);
      if (away > 2) {
        pushEvent('tab_return', { d: { awaySeconds: away }, url: location.href });
      }
      hiddenTime = 0;
    }
  }

  // ─── Auto-track: SPA navigation (pushState/popstate) ───
  var originalPushState = history.pushState;
  var originalReplaceState = history.replaceState;

  function onSPANavigation() {
    setTimeout(function() {
      maxScrollDepth = 0; // Reset scroll tracking
      trackPageView();
      trackForms();
    }, 100);
  }

  history.pushState = function() {
    originalPushState.apply(this, arguments);
    onSPANavigation();
  };

  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    onSPANavigation();
  };

  win.addEventListener('popstate', onSPANavigation);

  // ─── Auto-track: Web Vitals (lightweight) ──────────────
  function trackWebVitals() {
    // Largest Contentful Paint
    try {
      var lcpObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        if (last) {
          pushEvent('web_vital', { d: { metric: 'LCP', value: Math.round(last.startTime) }, url: location.href });
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch(e) {}

    // First Input Delay
    try {
      var fidObserver = new PerformanceObserver(function(list) {
        var entry = list.getEntries()[0];
        if (entry) {
          pushEvent('web_vital', { d: { metric: 'FID', value: Math.round(entry.processingStart - entry.startTime) }, url: location.href });
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch(e) {}

    // CLS
    try {
      var clsValue = 0;
      var clsObserver = new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        });
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });

      // Report CLS on page hide
      win.addEventListener('pagehide', function() {
        if (clsValue > 0) {
          pushEvent('web_vital', { d: { metric: 'CLS', value: Math.round(clsValue * 1000) / 1000 }, url: location.href });
          flush();
        }
      }, { once: true });
    } catch(e) {}
  }

  // ─── MutationObserver with debounce ────────────────────
  var formObserverTimer = null;

  function startFormObserver() {
    try {
      var mo = new MutationObserver(function() {
        clearTimeout(formObserverTimer);
        formObserverTimer = setTimeout(trackForms, 300);
      });
      mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    } catch(e) {}
  }

  // ─── Public API ────────────────────────────────────────
  var BT = win.BT || { q: [] };

  /**
   * BT.identify({ email, phone, name }) — Vincular visitante com dados de contato
   */
  BT.identify = function(data) {
    if (!data || typeof data !== 'object') return;
    pendingIdentify = {};
    if (data.email) pendingIdentify.email = String(data.email);
    if (data.phone) pendingIdentify.phone = String(data.phone);
    if (data.name) pendingIdentify.name = String(data.name);
    pushEvent('identify', { d: pendingIdentify, url: location.href });
  };

  /**
   * BT.track(eventName, properties) — Evento customizado
   */
  BT.track = function(eventName, props) {
    var data = { url: location.href };
    if (props && typeof props === 'object') data.d = props;
    data.d = data.d || {};
    data.d.eventName = String(eventName);
    pushEvent('custom', data);
  };

  /**
   * BT.page() — Forcar tracking de pageview (util em SPAs)
   */
  BT.page = function() {
    lastTrackedUrl = ''; // Force re-track
    trackPageView();
  };

  /**
   * BT.getVisitorId() — Retornar ID do visitante
   */
  BT.getVisitorId = function() { return vid; };

  /**
   * BT.getSessionId() — Retornar ID da sessao
   */
  BT.getSessionId = function() { return sid; };

  /**
   * BT.grantConsent() — Conceder consentimento programaticamente
   */
  BT.grantConsent = function() { grantConsent(); };

  /**
   * BT.denyConsent() — Revogar consentimento programaticamente
   */
  BT.denyConsent = function() { denyConsent(); };

  /**
   * BT.hasConsent() — Verificar se consentimento foi concedido
   */
  BT.hasConsent = function() { return trackingActive; };

  /**
   * BT.showBanner() — Exibir banner de consentimento manualmente
   */
  BT.showBanner = function() { bannerShown = false; consentStatus = null; showConsentBanner(); };

  // Process queued calls (from loader snippet)
  if (BT.q && BT.q.length) {
    BT.q.forEach(function(call) {
      var method = call[0];
      var args = call[1];
      if (BT[method]) BT[method].apply(BT, args);
    });
    BT.q = [];
  }

  win.BT = BT;

  // ─── Initialize tracking (only after consent) ─────────
  var flushInterval = null;
  var heartbeatInterval = null;

  function startTracking() {
    if (!trackingActive) return;

    initIds();
    generateFingerprint();

    // First pageview
    trackPageView();

    // Event listeners
    win.addEventListener('scroll', onScroll, { passive: true });
    doc.addEventListener('click', onClick, { capture: true });
    doc.addEventListener('visibilitychange', onVisibilityChange);

    // Track forms after DOM ready
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function() {
        trackForms();
        trackWebVitals();
        startFormObserver();
      });
    } else {
      trackForms();
      trackWebVitals();
      startFormObserver();
    }

    // Periodic flush
    if (!flushInterval) flushInterval = setInterval(flush, FLUSH_INTERVAL);

    // Heartbeat
    if (!heartbeatInterval) heartbeatInterval = setInterval(heartbeat, HEARTBEAT_INTERVAL);

    // Flush on page unload
    win.addEventListener('beforeunload', function() {
      // Track time on page
      var timeOnPage = Math.round((Date.now() - sessionStartTime) / 1000);
      pushEvent('page_exit', {
        url: location.href,
        d: { timeOnPage: timeOnPage, maxScrollDepth: maxScrollDepth }
      });
      flush();
      heartbeat();
    });

    // Flush on page hide (mobile)
    win.addEventListener('pagehide', function() {
      flush();
      heartbeat();
    });
  }

  // ─── Boot ──────────────────────────────────────────────
  function boot() {
    if (consentStatus === 'granted') {
      // Consentimento ja concedido — iniciar tracking
      startTracking();
    } else if (consentStatus === 'denied') {
      // Consentimento negado — nao fazer nada
    } else {
      // Sem decisao — mostrar banner
      showConsentBanner();
    }
  }

  if (doc.body) {
    boot();
  } else {
    doc.addEventListener('DOMContentLoaded', boot);
  }

})(window, document);
