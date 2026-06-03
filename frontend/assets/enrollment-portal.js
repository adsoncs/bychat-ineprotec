// enrollment-portal.js — runtime do portal de matrículas
// Consume /api/public/portals/:slug e renderiza o formulário multi-step.

(function() {
  const slug = window.__PORTAL_SLUG__;
  const API = window.__API_BASE__ || '/api';
  const root = document.getElementById('portal-root');
  if (!slug || !root) return;

  // Decodifica base64url respeitando UTF-8.
  // atob() retorna string Latin-1 (1 byte/char); pra textos com acento precisamos
  // converter os bytes pra string UTF-8 via TextDecoder, senão "inscrição" vira "inscriÃ§Ã£o".
  function base64UrlDecodeUtf8(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Token de pré-preenchimento (gerado pelo admin para leads do CRM)
  function readPrefillToken() {
    const token = new URLSearchParams(location.search).get('t');
    if (!token || !token.includes('.')) return {};
    try {
      const body = token.split('.')[0];
      const payload = JSON.parse(base64UrlDecodeUtf8(body));
      if (payload.exp && payload.exp < Date.now()) return {};
      return payload;
    } catch { return {}; }
  }
  const prefill = readPrefillToken();

  const state = {
    portal: null,
    offerings: [],
    currentStep: 0,
    formData: {
      // UTM/click IDs
      utm_source: new URLSearchParams(location.search).get('utm_source') || '',
      utm_medium: new URLSearchParams(location.search).get('utm_medium') || '',
      utm_campaign: new URLSearchParams(location.search).get('utm_campaign') || '',
      fbclid: new URLSearchParams(location.search).get('fbclid') || '',
      gclid: new URLSearchParams(location.search).get('gclid') || '',
      referrer: document.referrer || '',
      // Pré-preenchimento via token assinado
      nome: prefill.nome || '',
      email: prefill.email || '',
      whatsapp: prefill.whatsapp || '',
      cpf: prefill.cpf || '',
      cidade: prefill.cidade || '',
    },
    errors: {},
    filters: { levelId: '', modalityId: '', campusId: '', courseQuery: '', entryModeCode: '' },
    submitting: false,
    // Para EntryMode='enem': File do boletim oficial (sobe via multipart logo
    // após o submit, separado do JSON do formulário).
    enemBoletimFile: null,
    // Para portal de interesse + continuação: token do magic link, lead resolvido,
    // flag de token expirado, e checkbox LGPD do form de interesse.
    continueToken: null,
    continueLead: null,
    continueExpired: false,
    lgpdConsent: false,
  };

  // Detecta modo embed (?embed=1 ou via JS global). Usado para esconder header/
  // footer da página do portal e ajustar margens — pensado para iframes em sites
  // de parceiros e LPs externas.
  const isEmbed = new URLSearchParams(location.search).get('embed') === '1' || window.__EMBED__ === true;
  if (isEmbed) document.body.classList.add('embed-mode');

  // ─── Utilidades ───
  function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtCurrency(v) { if (v == null || v === '') return '-'; const n = Number(v); return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function normalizeCpf(cpf) { return String(cpf || '').replace(/\D/g, ''); }
  function formatCpfMask(cpf) { const c = normalizeCpf(cpf).slice(0, 11); return c.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1-$2'); }
  function formatPhoneMask(p) { const c = String(p||'').replace(/\D/g, '').slice(0, 11); if (c.length <= 10) return c.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2'); return c.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2'); }
  function isValidCpf(cpf) { const c = normalizeCpf(cpf); if (c.length !== 11) return false; if (/^(\d)\1+$/.test(c)) return false; let s=0; for (let i=0;i<9;i++) s+=parseInt(c[i])*(10-i); let d1=11-(s%11); if (d1>=10) d1=0; if (d1!==parseInt(c[9])) return false; s=0; for (let i=0;i<10;i++) s+=parseInt(c[i])*(11-i); let d2=11-(s%11); if (d2>=10) d2=0; return d2===parseInt(c[10]); }
  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim()); }

  // ─── CEP auto-fill via BrasilAPI ───
  async function fetchCep(cep) {
    const c = String(cep||'').replace(/\D/g, '');
    if (c.length !== 8) return null;
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${c}`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  // ─── Captcha loader ───
  function loadCaptcha() {
    const type = state.portal?.captchaType;
    const key = state.portal?.captchaSiteKey;
    if (!type || !key) return;
    if (type === 'recaptcha' && !window.grecaptcha) {
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
      s.async = true; document.head.appendChild(s);
    }
    if (type === 'hcaptcha' && !window.hcaptcha) {
      const s = document.createElement('script');
      s.src = 'https://js.hcaptcha.com/1/api.js';
      s.async = true; document.head.appendChild(s);
    }
  }

  async function getCaptchaToken() {
    const type = state.portal?.captchaType;
    const key = state.portal?.captchaSiteKey;
    if (!type || !key) return '';
    try {
      if (type === 'recaptcha' && window.grecaptcha) {
        return await new Promise((res) => {
          window.grecaptcha.ready(() => window.grecaptcha.execute(key, { action: 'enrollment' }).then(res).catch(() => res('')));
        });
      }
      if (type === 'hcaptcha' && window.hcaptcha) {
        return await new Promise((res) => {
          // Renderiza invisível em container dedicado e executa
          let c = document.getElementById('hcaptcha-invisible');
          if (!c) { c = document.createElement('div'); c.id = 'hcaptcha-invisible'; c.style.display='none'; document.body.appendChild(c); }
          window.hcaptcha.render('hcaptcha-invisible', { sitekey: key, size: 'invisible', callback: (tok) => res(tok) });
          window.hcaptcha.execute('hcaptcha-invisible');
        });
      }
    } catch {}
    return '';
  }

  // ─── Auto-save (draft) ───
  // sessionId persistente em localStorage → permite resume se candidato fechar o browser.
  // 20 chars aleatórios garante >= 16 (requisito do backend).
  function getDraftSessionId() {
    let sid = localStorage.getItem(`ep-draft-${slug}`);
    if (!sid || !/^[a-zA-Z0-9_-]{16,64}$/.test(sid)) {
      const rnd = () => Math.random().toString(36).slice(2);
      sid = (rnd() + rnd() + Date.now().toString(36)).substring(0, 40);
      localStorage.setItem(`ep-draft-${slug}`, sid);
    }
    return sid;
  }
  function clearDraftSession() { localStorage.removeItem(`ep-draft-${slug}`); }

  let _draftTimer = null;
  function scheduleDraftSave() {
    if (_draftTimer) clearTimeout(_draftTimer);
    _draftTimer = setTimeout(saveDraftNow, 800);
  }
  async function saveDraftNow() {
    try {
      await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: getDraftSessionId(), formData: state.formData, currentStep: state.currentStep }),
        keepalive: true,
      });
    } catch {}
  }
  async function restoreDraft() {
    const sid = localStorage.getItem(`ep-draft-${slug}`);
    if (!sid) return;
    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/draft/${encodeURIComponent(sid)}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.formData) {
        state.formData = { ...state.formData, ...d.formData };
        state.currentStep = Math.max(0, parseInt(d.currentStep) || 0);
      }
    } catch {}
  }

  // ─── Fetch inicial ───
  async function loadPortal() {
    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}`);
      if (!r.ok) { renderError('Portal indisponível ou desativado.'); return; }
      const d = await r.json();
      state.portal = d.portal;
      state.offerings = d.offerings || [];

      // Modo "continuação" via magic link: portal full + ?t=<token> → valida o
      // token, busca prefill do lead que veio do portal de interesse.
      const urlToken = new URLSearchParams(location.search).get('t');
      if (urlToken && state.portal?.formMode !== 'interest') {
        try {
          const cr = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/continue?t=${encodeURIComponent(urlToken)}`);
          if (cr.ok) {
            const cd = await cr.json();
            state.continueToken = urlToken;
            state.continueLead = cd.lead;
            // Prefill se ainda não há valor digitado
            const p = cd.prefill || {};
            ['nome','email','whatsapp','cidade'].forEach(k => {
              if (p[k] && !state.formData[k]) state.formData[k] = p[k];
            });
            if (p.offeringId && !state.formData.offeringId) state.formData.offeringId = p.offeringId;
          } else {
            // Token inválido/expirado: avisa, mas deixa preencher do zero
            state.continueExpired = true;
          }
        } catch { /* offline ou rede ruim — segue sem prefill */ }
      }

      if (state.portal?.formMode !== 'interest') {
        mergeDefaultFormExtras();
        await restoreDraft();
      }
      loadCaptcha();
      render();
    } catch (e) { renderError('Erro ao carregar portal. Tente novamente.'); }
  }

  // Mescla EntryMode.defaultFormExtras das ofertas no formConfig.steps.
  // Cada extra entra uma única vez (chave: name), com visibleWhen.entryMode
  // contendo todos os codes de modos que o declaram. Campos já configurados pelo
  // admin (mesmo `name`) são preservados como estão. Os extras são anexados ao
  // step que contém o offering-picker; sem picker, ao último step.
  function mergeDefaultFormExtras() {
    const fc = state.portal?.formConfig;
    if (!fc || !Array.isArray(fc.steps) || fc.steps.length === 0) return;
    const existing = new Set();
    for (const s of fc.steps) for (const f of (s?.fields || [])) if (f?.name) existing.add(f.name);
    let targetIdx = fc.steps.findIndex(s => (s?.fields || []).some(f => f?.type === 'offering-picker'));
    if (targetIdx < 0) targetIdx = fc.steps.length - 1;
    const buckets = new Map();
    for (const o of (state.offerings || [])) {
      const code = o?.selectionProcess?.entryMode?.code;
      const extras = o?.selectionProcess?.entryMode?.defaultFormExtras;
      if (!code || !Array.isArray(extras)) continue;
      for (const ex of extras) {
        if (!ex?.name || existing.has(ex.name)) continue;
        const cur = buckets.get(ex.name) || { ...ex, visibleWhen: { entryMode: [] } };
        if (!cur.visibleWhen.entryMode.includes(code)) cur.visibleWhen.entryMode.push(code);
        buckets.set(ex.name, cur);
      }
    }
    const target = fc.steps[targetIdx];
    target.fields = target.fields || [];
    for (const f of buckets.values()) target.fields.push(f);

    // Sintético: para EntryMode='enem', injeta upload do boletim oficial.
    // Esse campo NÃO é JSON — fica em `state.enemBoletimFile` e sobe via
    // multipart logo após o submit (rota /document com candidateToken).
    // É obrigatório quando a oferta selecionada é ENEM, validado no submit.
    const hasEnem = (state.offerings || []).some(o => o?.selectionProcess?.entryMode?.code === 'enem');
    if (hasEnem && !existing.has('_enemBoletimFile')) {
      target.fields.push({
        name: '_enemBoletimFile',
        type: 'enem-boletim-upload',
        label: 'Boletim oficial do ENEM',
        required: true,
        hint: 'Envie o PDF do boletim baixado no portal do INEP. A IA vai extrair suas notas e classificar automaticamente. Aceitamos também foto nítida do boletim impresso (JPG/PNG/WEBP) — máx 15MB.',
        visibleWhen: { entryMode: ['enem'] },
      });
    }
  }

  // ─── Renderização ───
  function renderError(msg) {
    root.innerHTML = `<div class="portal-card"><div style="text-align:center;padding:30px;color:#dc2626"><div style="font-size:40px">⚠</div><div style="margin-top:10px;font-weight:500">${esc(msg)}</div></div></div>`;
  }

  function renderStepsIndicator() {
    const steps = state.portal?.formConfig?.steps || [];
    return `<div class="steps-indicator">${steps.map((s, i) => {
      const cls = i < state.currentStep ? 'done' : i === state.currentStep ? 'active' : '';
      return `<div class="step-dot ${cls}"><span class="bullet">${i < state.currentStep ? '✓' : i + 1}</span><span class="label">${esc(s.name || 'Etapa ' + (i + 1))}</span></div>`;
    }).join('')}</div>`;
  }

  function renderField(f) {
    const val = state.formData[f.name] || '';
    const err = state.errors[f.name];
    const errCls = err ? ' has-error' : '';
    const reqMark = f.required ? ' <span class="req">*</span>' : '';

    if (f.type === 'offering-picker') return renderOfferingPicker(f);
    if (f.type === 'textarea') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><textarea name="${esc(f.name)}" rows="3">${esc(val)}</textarea><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'select') {
      const opts = Array.isArray(f.options) ? f.options : [];
      return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><select name="${esc(f.name)}"><option value="">Selecione...</option>${opts.map(o => `<option value="${esc(o.value)}" ${o.value===val?'selected':''}>${esc(o.label || o.value)}</option>`).join('')}</select><div class="error">${esc(err)}</div></div>`;
    }
    if (f.type === 'date') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="date" name="${esc(f.name)}" value="${esc(val)}"><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'number') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="number" name="${esc(f.name)}" value="${esc(val)}" inputmode="numeric"><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'checkbox') {
      const checked = (val === true || val === 'true' || val === 'on') ? ' checked' : '';
      return `<div class="field${errCls}"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" name="${esc(f.name)}"${checked}><span>${esc(f.label)}${reqMark}</span></label><div class="error">${esc(err)}</div></div>`;
    }
    if (f.type === 'cep') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="text" name="${esc(f.name)}" value="${esc(val)}" data-mask="cep" maxlength="9" placeholder="00000-000"><div class="error">${esc(err)}</div>${f.hint?`<div class="hint">${esc(f.hint)}</div>`:''}</div>`;
    if (f.type === 'cpf') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="text" name="${esc(f.name)}" value="${esc(val)}" data-mask="cpf" maxlength="14" placeholder="000.000.000-00" inputmode="numeric"><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'phone') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="tel" name="${esc(f.name)}" value="${esc(val)}" data-mask="phone" maxlength="15" placeholder="(00) 00000-0000"><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'email') return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="email" name="${esc(f.name)}" value="${esc(val)}" autocomplete="email"><div class="error">${esc(err)}</div></div>`;
    if (f.type === 'enem-boletim-upload') {
      const file = state.enemBoletimFile;
      const fileBadge = file
        ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#e6f4ea;border:1px solid #34a853;border-radius:8px;font-size:13px"><span style="font-size:18px">📄</span><div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${esc(file.name)}</strong><div style="font-size:11px;color:#5f6368">${(file.size/1024/1024).toFixed(2)} MB</div></div><button type="button" data-action="clear-boletim" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:18px;padding:0;line-height:1" title="Remover">×</button></div>`
        : `<label class="file-upload-zone" style="display:block;padding:24px 16px;background:#f8faff;border:2px dashed #1a73e8;border-radius:10px;text-align:center;cursor:pointer;transition:all .15s">
            <div style="font-size:32px;margin-bottom:8px">📋</div>
            <div style="font-size:14px;font-weight:500;color:#1a73e8">Clique para enviar o boletim</div>
            <div style="font-size:12px;color:#5f6368;margin-top:4px">PDF do INEP ou foto · até 15MB</div>
            <input type="file" name="${esc(f.name)}" accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp" style="display:none">
          </label>`;
      return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label>${fileBadge}${f.hint?`<div class="hint" style="margin-top:8px;font-size:12px;color:#5f6368;line-height:1.5">${esc(f.hint)}</div>`:''}<div class="error">${esc(err)}</div></div>`;
    }
    // default text
    return `<div class="field${errCls}"><label>${esc(f.label)}${reqMark}</label><input type="text" name="${esc(f.name)}" value="${esc(val)}"><div class="error">${esc(err)}</div></div>`;
  }

  function renderOfferingPicker(f) {
    const selId = state.formData[f.name];

    // Modos de ingresso disponíveis nas ofertas. Quando há 2+, exibimos um
    // seletor obrigatório ANTES da lista de cursos — só após escolher o modo
    // o candidato vê os cursos correspondentes. Com 1 só modo, auto-seleciona.
    const allModes = uniqBy(
      state.offerings.map(o => o.selectionProcess?.entryMode).filter(Boolean),
      'code'
    );
    if (allModes.length === 1 && state.filters.entryModeCode !== allModes[0].code) {
      state.filters.entryModeCode = allModes[0].code;
    }
    const selectedModeCode = state.filters.entryModeCode;
    const needsModeFirst = allModes.length > 1 && !selectedModeCode;

    // Base após o filtro de modo (se aplicável)
    const offeringsAfterMode = selectedModeCode
      ? state.offerings.filter(o => o.selectionProcess?.entryMode?.code === selectedModeCode)
      : state.offerings;

    // Agrega filtros únicos a partir do que sobrou após o modo
    const levels = uniqBy(offeringsAfterMode.map(o => o.level).filter(Boolean), 'id');
    const modalities = uniqBy(offeringsAfterMode.map(o => o.modality).filter(Boolean), 'id');
    const campuses = uniqBy(offeringsAfterMode.flatMap(o => (o.campuses || []).map(c => c.campus)).filter(Boolean), 'id');

    const filtered = offeringsAfterMode.filter(o => {
      if (state.filters.levelId && String(o.level?.id) !== String(state.filters.levelId)) return false;
      if (state.filters.modalityId && String(o.modality?.id) !== String(state.filters.modalityId)) return false;
      if (state.filters.campusId) {
        const campusIds = (o.campuses || []).map(c => String(c.campus?.id));
        if (!campusIds.includes(String(state.filters.campusId))) return false;
      }
      if (state.filters.courseQuery) {
        const q = state.filters.courseQuery.toLowerCase();
        if (!String(o.course?.nome || '').toLowerCase().includes(q) && !String(o.nome || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const err = state.errors[f.name];

    const quizHelperEnabled = !!f.config?.quizHelperEnabled;

    // Bloco do seletor de modo (cards grandes) — sempre visível quando há 2+ modos
    const modeSelector = allModes.length > 1 ? `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:500;color:#3c4043;margin-bottom:8px">1. Como você quer ingressar?</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
          ${allModes.map(m => {
            const sel = m.code === selectedModeCode;
            return `<button type="button" onclick="window.__epPickEntryMode&&window.__epPickEntryMode('${esc(m.code)}')" style="padding:14px 12px;border:2px solid ${sel?'#1a73e8':'#e8eaed'};border-radius:10px;background:${sel?'#f0f7ff':'#fff'};cursor:pointer;font-family:inherit;text-align:left;transition:all .15s">
              <div style="font-size:18px;line-height:1">${esc(m.icon||'🎓')}</div>
              <div style="font-size:13px;font-weight:600;color:${sel?'#1a73e8':'#202124'};margin-top:6px">${esc(m.name)}</div>
              ${m.description ? `<div style="font-size:11px;color:#5f6368;margin-top:4px;line-height:1.4">${esc(m.description)}</div>` : ''}
            </button>`;
          }).join('')}
        </div>
      </div>` : '';

    if (needsModeFirst) {
      return `<div class="field${err?' has-error':''}">
        <label>${esc(f.label || 'Escolha o curso')} ${f.required ? '<span class="req">*</span>' : ''}</label>
        ${modeSelector}
        <div style="padding:14px 16px;background:#fef7e0;border:1px solid #fdd835;border-radius:8px;font-size:12px;color:#b06000">
          ⚠ Selecione um modo de ingresso acima para ver os cursos disponíveis.
        </div>
        <div class="error">${esc(err)}</div>
      </div>`;
    }

    return `<div class="field${err?' has-error':''}">
      <label>${esc(f.label || 'Escolha o curso')} ${f.required ? '<span class="req">*</span>' : ''}</label>
      ${modeSelector}
      ${quizHelperEnabled ? `<button type="button" onclick="window.__epOpenQuiz&&window.__epOpenQuiz()" style="display:block;width:100%;padding:10px 14px;border:1px dashed #1a73e8;background:#f0f7ff;color:#1a73e8;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;margin-bottom:10px">✨ Não sei qual curso escolher — me ajude!</button>` : ''}
      ${allModes.length > 1 ? `<div style="font-size:12px;font-weight:500;color:#3c4043;margin-bottom:8px">2. Escolha o curso</div>` : ''}
      <div class="filters">
        <input type="text" placeholder="Buscar curso..." data-filter="courseQuery" value="${esc(state.filters.courseQuery)}">
        ${levels.length > 1 ? `<select data-filter="levelId"><option value="">Todos os níveis</option>${levels.map(l => `<option value="${l.id}" ${String(state.filters.levelId)===String(l.id)?'selected':''}>${esc(l.nome)}</option>`).join('')}</select>` : ''}
        ${modalities.length > 1 ? `<select data-filter="modalityId"><option value="">Todas as modalidades</option>${modalities.map(m => `<option value="${m.id}" ${String(state.filters.modalityId)===String(m.id)?'selected':''}>${esc(m.nome)}</option>`).join('')}</select>` : ''}
        ${campuses.length > 1 ? `<select data-filter="campusId"><option value="">Todos os campus</option>${campuses.map(c => `<option value="${c.id}" ${String(state.filters.campusId)===String(c.id)?'selected':''}>${esc(c.nome)}${c.cidade?` - ${esc(c.cidade)}`:''}</option>`).join('')}</select>` : ''}
      </div>
      <div class="offering-list">
        ${filtered.length === 0 ? `<div style="text-align:center;color:#6b7280;padding:30px;border:1px dashed #d1d5db;border-radius:8px">Nenhum curso encontrado com os filtros aplicados.</div>` : filtered.map(o => {
          const sel = String(selId) === String(o.id) ? ' selected' : '';
          const campusList = (o.campuses || []).map(c => c.campus?.nome).filter(Boolean).join(', ');
          // Valor monetário aparece quando o processo seletivo tem taxaInscricao definida.
          const taxa = Number(o.selectionProcess?.taxaInscricao || 0);
          return `<div class="offering-card${sel}" data-offering="${o.id}">
            <div class="title">${esc(o.course?.nome || o.nome)}</div>
            <div class="meta">
              ${o.level?.nome ? `<span>📚 ${esc(o.level.nome)}</span>` : ''}
              ${o.modality?.nome ? `<span>🎓 ${esc(o.modality.nome)}</span>` : ''}
              ${o.turno ? `<span>🕐 ${esc(o.turno)}</span>` : ''}
              ${taxa > 0 ? `<span>💰 Taxa de inscrição: ${fmtCurrency(taxa)}</span>` : ''}
              ${campusList ? `<span>📍 ${esc(campusList)}</span>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="error">${esc(err)}</div>
    </div>`;
  }

  function uniqBy(arr, key) { const seen = new Set(); return arr.filter(x => { if (!x || seen.has(x[key])) return false; seen.add(x[key]); return true; }); }

  // Modo de ingresso atual — determinado pela oferta selecionada (se houver).
  // Retorna null antes da escolha, permitindo que campos com regras de modo só
  // apareçam depois do offering-picker.
  function getCurrentEntryModeCode() {
    const offeringId = state.formData?.offeringId;
    if (!offeringId) return null;
    const off = (state.offerings || []).find(o => String(o.id) === String(offeringId));
    return off?.selectionProcess?.entryMode?.code || null;
  }

  // Aplica a regra visibleWhen.entryMode: array de codes permitidos.
  // Sem regra = sempre visível. Com regra e sem modo conhecido = escondido.
  function isFieldVisible(f) {
    // offering-picker é o campo que DEFINE o modo — não pode depender dele.
    if (f?.type === 'offering-picker') return true;
    const rule = f?.visibleWhen?.entryMode;
    if (!rule || (Array.isArray(rule) && rule.length === 0)) return true;
    const current = getCurrentEntryModeCode();
    if (!current) return false;
    return Array.isArray(rule) ? rule.includes(current) : rule === current;
  }

  function renderStep() {
    const steps = state.portal?.formConfig?.steps || [];
    const step = steps[state.currentStep];
    if (!step) return '';
    const isLast = state.currentStep === steps.length - 1;
    const visibleFields = (step.fields || []).filter(isFieldVisible);
    return `
      ${renderStepsIndicator()}
      <div class="portal-card">
        <div class="step-title">${esc(step.name || 'Etapa ' + (state.currentStep + 1))}</div>
        ${step.description ? `<div class="step-desc">${esc(step.description)}</div>` : ''}
        ${visibleFields.map(renderField).join('')}
        ${isLast ? `<div class="field${state.errors.lgpdConsent?' has-error':''}" style="margin-top:14px">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-weight:400;color:var(--muted);line-height:1.5">
            <input type="checkbox" name="lgpdConsent" ${state.formData.lgpdConsent?'checked':''} style="margin-top:3px;flex-shrink:0">
            <span>Li e aceito a <a href="/privacidade" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline">política de privacidade</a> e autorizo o tratamento dos meus dados e o contato pelos canais informados (LGPD).</span>
          </label>
          <div class="error">${esc(state.errors.lgpdConsent||'')}</div>
        </div>` : ''}
        <div class="buttons">
          ${state.currentStep > 0 ? `<button class="btn btn-secondary" data-action="prev">Voltar</button>` : ''}
          <button class="btn btn-primary" data-action="${isLast?'submit':'next'}" ${state.submitting?'disabled':''}>${state.submitting?'<span class="loading"></span>Enviando...':(isLast?'Enviar inscrição':'Próximo')}</button>
        </div>
      </div>
    `;
  }

  function render() {
    if (state.portal?.formMode === 'interest') {
      root.innerHTML = renderInterestForm();
      attachInterestHandlers();
      return;
    }
    root.innerHTML = renderContinuationBanner() + renderStep();
    attachHandlers();
    // Tracking: marca step alcançado (1x por sessão+step)
    trackFunnelOnce(`step_reached_${state.currentStep}`, { event: 'step_reached', stepIndex: state.currentStep });
  }

  // Banner verde mostrado no portal full quando o lead chega via magic link
  // do portal de interesse — indica continuidade e dá segurança visual.
  function renderContinuationBanner() {
    if (state.continueExpired) {
      return `<div class="portal-card" style="background:#fef7e0;border:1px solid #fdd835;padding:14px 16px;margin-bottom:14px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="font-size:24px">⏰</div>
          <div style="flex:1">
            <div style="font-weight:600;color:#b06000;font-size:14px">Link expirado</div>
            <div style="font-size:12px;color:#5f6368;margin-top:3px;line-height:1.5">Não tem problema! Você pode preencher o formulário normalmente — só vai precisar informar seus dados de novo.</div>
          </div>
        </div>
      </div>`;
    }
    if (!state.continueLead) return '';
    return `<div class="portal-card" style="background:#e6f4ea;border:1px solid #34a853;padding:14px 16px;margin-bottom:14px">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="font-size:24px">👋</div>
        <div style="flex:1">
          <div style="font-weight:600;color:#0d652d;font-size:14px">Olá, ${esc(state.continueLead.nome || '')}! Continuando sua inscrição</div>
          <div style="font-size:12px;color:#137333;margin-top:3px;line-height:1.5">Seus dados básicos já estão preenchidos. Só precisamos completar com algumas informações finais.</div>
        </div>
      </div>
    </div>`;
  }

  // Form simples para portal de interesse — single step, mobile-first.
  // 4 campos + LGPD + curso. Submit cria Lead e o backend dispara magic link
  // por email/WA. Tela seguinte instrui o candidato a checar o canal.
  function renderInterestForm() {
    const ofs = state.offerings || [];
    const errs = state.errors || {};
    const interestSubmitted = state.interestDone;

    if (interestSubmitted) {
      return renderInterestSuccess();
    }

    const courseOptions = ofs.length > 1
      ? `<div class="field${errs.offeringId?' has-error':''}">
          <label>Curso de interesse <span class="req">*</span></label>
          <select name="offeringId">
            <option value="">— Selecione —</option>
            ${ofs.map(o => `<option value="${o.id}" ${String(state.formData.offeringId||'')===String(o.id)?'selected':''}>${esc((o.course?.nome || o.nome) + (o.turno ? ' · ' + o.turno : ''))}</option>`).join('')}
          </select>
          <div class="error">${esc(errs.offeringId||'')}</div>
        </div>`
      : (ofs.length === 1
        ? `<input type="hidden" name="offeringId" value="${ofs[0].id}">`
        : '');

    return `<div class="portal-card">
      <div style="margin-bottom:18px">
        <div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:6px">Quero saber mais</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.5">Preencha em 30 segundos. Você receberá no WhatsApp o link com seu cadastro pré-preenchido para finalizar a inscrição.</div>
      </div>
      <div class="field${errs.nome?' has-error':''}">
        <label>Nome completo <span class="req">*</span></label>
        <input type="text" name="nome" value="${esc(state.formData.nome||'')}" autocomplete="name" autofocus>
        <div class="error">${esc(errs.nome||'')}</div>
      </div>
      <div class="field${errs.whatsapp?' has-error':''}">
        <label>WhatsApp <span class="req">*</span></label>
        <input type="tel" name="whatsapp" value="${esc(state.formData.whatsapp||'')}" data-mask="phone" maxlength="15" placeholder="(00) 00000-0000" inputmode="tel" autocomplete="tel">
        <div class="hint">Você receberá o link aqui</div>
        <div class="error">${esc(errs.whatsapp||'')}</div>
      </div>
      <div class="field${errs.email?' has-error':''}">
        <label>E-mail</label>
        <input type="email" name="email" value="${esc(state.formData.email||'')}" autocomplete="email" placeholder="opcional, mas recomendado">
        <div class="error">${esc(errs.email||'')}</div>
      </div>
      ${courseOptions}
      <div class="field${errs.lgpdConsent?' has-error':''}" style="margin-top:14px">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-weight:400;color:var(--muted);line-height:1.5">
          <input type="checkbox" name="lgpdConsent" ${state.lgpdConsent?'checked':''} style="margin-top:3px;flex-shrink:0">
          <span>Concordo com a <a href="/privacidade" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline">política de privacidade</a> e autorizo o contato pelos canais informados (LGPD).</span>
        </label>
        <div class="error">${esc(errs.lgpdConsent||'')}</div>
      </div>
      <div class="buttons" style="margin-top:8px">
        <button class="btn btn-primary" data-action="submit-interest" ${state.submitting?'disabled':''} style="width:100%;padding:14px;font-size:15px">
          ${state.submitting?'<span class="loading"></span>Enviando...':'Quero meu link de inscrição →'}
        </button>
      </div>
    </div>`;
  }

  function renderInterestSuccess() {
    const wa = state.formData.whatsapp || '';
    const email = state.formData.email || '';
    const channels = [wa && `📱 WhatsApp <strong>${esc(wa)}</strong>`, email && `📧 e-mail <strong>${esc(email)}</strong>`].filter(Boolean).join(' e ');
    return `<div class="portal-card success-box">
      <div class="icon">✅</div>
      <div style="font-size:20px;font-weight:600;color:var(--success);margin-bottom:8px">Pronto! Falta pouco</div>
      <div style="font-size:14px;color:var(--text);line-height:1.6;margin-top:8px">Enviamos para ${channels} um link para você <strong>completar sua inscrição</strong>.</div>
      <div style="background:#f0f7ff;border:1px solid #d2e3fc;border-radius:10px;padding:14px;margin-top:18px;font-size:13px;color:#3c4043;line-height:1.6">
        💡 Verifique seu WhatsApp (ou caixa de entrada e spam do email). O link abre um formulário rápido — em 2 minutos você termina.
      </div>
      <div style="margin-top:18px;font-size:12px;color:var(--muted)">Não recebeu em alguns minutos?</div>
      <div style="margin-top:8px">
        <button class="btn btn-secondary" data-action="resend-link" style="font-size:13px">Reenviar link</button>
      </div>
      ${state.resendStatus ? `<div style="margin-top:12px;padding:10px;background:${state.resendStatus.error?'#fef2f2':'#f0fdf4'};border:1px solid ${state.resendStatus.error?'#fecaca':'#bbf7d0'};border-radius:8px;font-size:12px;color:${state.resendStatus.error?'#991b1b':'#137333'}">${esc(state.resendStatus.message)}</div>`:''}
    </div>`;
  }

  function attachInterestHandlers() {
    // Aplica máscara + sincroniza state em todos inputs/select/checkbox
    root.querySelectorAll('input[name], select[name]').forEach(el => {
      const handler = () => {
        const mask = el.getAttribute('data-mask');
        let v = el.value;
        if (mask === 'phone') v = formatPhoneMask(v);
        if (mask) el.value = v;
        if (el.type === 'checkbox') {
          if (el.name === 'lgpdConsent') state.lgpdConsent = el.checked;
        } else {
          state.formData[el.name] = el.value;
        }
        if (state.errors[el.name]) { delete state.errors[el.name]; el.closest('.field')?.classList.remove('has-error'); }
      };
      el.addEventListener('input', handler);
      if (el.type === 'checkbox') el.addEventListener('change', handler);
    });

    // Submit
    root.querySelectorAll('button[data-action="submit-interest"]').forEach(el => {
      el.addEventListener('click', submitInterest);
    });

    // Reenvio do link
    root.querySelectorAll('button[data-action="resend-link"]').forEach(el => {
      el.addEventListener('click', resendInterestLink);
    });
  }

  async function submitInterest() {
    if (state.submitting) return;
    // Validação básica
    state.errors = {};
    const nome = (state.formData.nome || '').trim();
    const whatsapp = (state.formData.whatsapp || '').trim();
    const email = (state.formData.email || '').trim();
    if (!nome || nome.length < 3) state.errors.nome = 'Informe seu nome completo';
    if (!whatsapp || whatsapp.replace(/\D/g, '').length < 10) state.errors.whatsapp = 'WhatsApp inválido';
    if (email && !isValidEmail(email)) state.errors.email = 'E-mail inválido';
    if (!state.lgpdConsent) state.errors.lgpdConsent = 'É necessário aceitar para continuar';
    // Curso só é obrigatório quando há mais de 1
    const ofs = state.offerings || [];
    if (ofs.length > 1 && !state.formData.offeringId) state.errors.offeringId = 'Selecione um curso';
    if (Object.keys(state.errors).length > 0) { render(); return; }

    state.submitting = true; render();
    try {
      const captchaToken = await getCaptchaToken();
      const trackingVisitorId = (typeof window.BT?.getVisitorId === 'function') ? window.BT.getVisitorId() : null;
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: { ...state.formData, lgpdConsent: state.lgpdConsent, offeringId: ofs.length === 1 ? ofs[0].id : state.formData.offeringId },
          captchaToken,
          trackingVisitorId,
        }),
      });
      const data = await r.json();
      state.submitting = false;
      if (!r.ok) {
        state.errors._global = data.error || 'Erro ao enviar';
        render();
        alert(data.error || 'Erro ao enviar. Tente novamente.');
        return;
      }
      state.interestDone = true;
      // Disparar conversão (evento mais leve — é topo de funil)
      try {
        if (window.gtag) window.gtag('event', 'generate_lead', { currency: 'BRL', value: 0 });
        if (window.fbq) window.fbq('track', 'Lead', { content_name: state.portal?.nome || '' });
        if (window.ttq) window.ttq.track('SubmitForm', { content_name: state.portal?.nome || '' });
      } catch {}
      render();
    } catch (e) {
      state.submitting = false;
      alert('Erro de conexão. Verifique sua internet e tente novamente.');
    }
  }

  async function resendInterestLink() {
    const wa = state.formData.whatsapp || '';
    const email = state.formData.email || '';
    const target = email || wa;
    if (!target) {
      state.resendStatus = { error: true, message: 'Sem canal para reenviar.' };
      render();
      return;
    }
    state.resendStatus = { message: 'Reenviando...' };
    render();
    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/resend-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrWhatsapp: target }),
      });
      const d = await r.json();
      if (!r.ok) {
        state.resendStatus = { error: true, message: d.error || 'Falha no reenvio. Tente novamente em instantes.' };
      } else {
        state.resendStatus = { message: 'Link reenviado! Confira seu WhatsApp e e-mail.' };
      }
    } catch {
      state.resendStatus = { error: true, message: 'Erro de conexão.' };
    }
    render();
  }

  // Dispara evento de funil no servidor (idempotente por key)
  const _trackedKeys = new Set();
  function trackFunnelOnce(key, payload) {
    if (_trackedKeys.has(key)) return;
    _trackedKeys.add(key);
    try {
      navigator.sendBeacon?.(`${API}/public/portals/${encodeURIComponent(slug)}/track`,
        new Blob([JSON.stringify({ ...payload, sessionId: getSessionId() })], { type: 'application/json' }))
        || fetch(`${API}/public/portals/${encodeURIComponent(slug)}/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, sessionId: getSessionId() }), keepalive: true });
    } catch {}
  }
  function getSessionId() {
    let sid = sessionStorage.getItem('ep-session');
    if (!sid) { sid = Math.random().toString(36).slice(2, 14) + Date.now().toString(36); sessionStorage.setItem('ep-session', sid); }
    return sid;
  }

  // Detecta abandono quando o usuário fecha a aba antes de submeter
  window.addEventListener('beforeunload', () => {
    if (state.currentStep !== undefined && !state.submitting && !_trackedKeys.has('submitted')) {
      trackFunnelOnce(`abandoned_${state.currentStep}`, { event: 'abandoned', stepIndex: state.currentStep });
    }
  });

  function renderSuccess(data) {
    // Dispara eventos de conversão nos pixels habilitados
    fireConversionEvents(data);
    clearDraftSession();

    const msg = state.portal?.ctaMessage || 'Inscrição recebida com sucesso!';
    if (state.portal?.ctaBehavior === 'redirect' && state.portal?.ctaTarget) {
      root.innerHTML = `<div class="portal-card success-box"><div class="icon">✅</div><div style="font-size:16px;margin-bottom:6px">Inscrição enviada!</div><div style="color:#6b7280;font-size:13px">Redirecionando...</div></div>`;
      setTimeout(() => { location.href = state.portal.ctaTarget; }, 1500);
      return;
    }

    // Modo transparente: auto-loga o candidato (sessionStorage) e leva direto pro
    // portal logado, onde o checkout (PIX/Boleto/Cartão) renderiza inline.
    // Mesma TOKEN_KEY usada pelo candidate-portal.js.
    if (data.paymentMode === 'transparent' && data.candidateToken) {
      try { sessionStorage.setItem('bychat_candidate_token', data.candidateToken) } catch (_) {}
      const candidateUrl = `${location.origin}/candidato/${encodeURIComponent(data.candidateCode)}`;
      root.innerHTML = `
        <div class="portal-card success-box">
          <div class="icon">🎉</div>
          <div style="font-size:19px;font-weight:600">Inscrição recebida!</div>
          <div style="color:#6b7280;margin-top:6px">Falta só o pagamento da taxa. Levando você para a tela…</div>
          <div style="margin-top:14px"><div class="loading" style="margin:0 auto;width:32px;height:32px;border-width:3px"></div></div>
          <div style="margin-top:18px;font-size:12px;color:#6b7280">Código:</div>
          <div class="code">${esc(data.candidateCode)}</div>
        </div>`;
      setTimeout(() => { location.href = candidateUrl; }, 1000);
      return;
    }

    const candidateUrl = `${location.origin}/candidato/${encodeURIComponent(data.candidateCode)}`;
    const contactLines = [];
    if (state.formData?.email)    contactLines.push(`e-mail <strong>${esc(state.formData.email)}</strong>`);
    if (state.formData?.whatsapp) contactLines.push(`WhatsApp <strong>${esc(state.formData.whatsapp)}</strong>`);
    const contactInfo = contactLines.length
      ? `Enviamos os detalhes para ${contactLines.join(' e ')}. Se não receber em alguns minutos, verifique spam ou use o link abaixo para acompanhar.`
      : 'Use o link abaixo para acompanhar sua inscrição.';

    root.innerHTML = `
      <div class="portal-card success-box">
        <div class="icon">🎉</div>
        <div style="font-size:19px;font-weight:600">Inscrição recebida!</div>
        <div style="color:#6b7280;margin-top:6px">${esc(msg)}</div>
        <div style="margin-top:18px;font-size:12px;color:#6b7280">Seu código de candidato:</div>
        <div class="code">${esc(data.candidateCode)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:10px">Guarde este código. Você o usará para acompanhar o status da sua inscrição.</div>
        <div style="margin-top:18px;padding:12px;background:#f0f7ff;border:1px solid #d2e3fc;border-radius:8px;font-size:12px;color:#5f6368;line-height:1.6">${contactInfo}</div>
        <div style="margin-top:14px"><a href="${esc(candidateUrl)}" class="btn btn-primary" style="display:inline-block;text-decoration:none">Acompanhar minha inscrição →</a></div>
        ${data.paymentUrl ? `<div style="margin-top:10px"><a href="${esc(data.paymentUrl)}" class="btn" style="display:inline-block;text-decoration:none;background:#137333;color:#fff">Pagar taxa de inscrição</a></div>` : ''}
      </div>`;
  }

  // Dispara eventos padrão de conversão nos pixels configurados
  function fireConversionEvents(data) {
    try {
      // GA4 / GTM: evento customizado 'enrollment_submitted'
      if (window.gtag) {
        window.gtag('event', 'enrollment_submitted', {
          event_category: 'enrollment',
          event_label: data.candidateCode,
          value: 1,
        });
        window.gtag('event', 'generate_lead', { currency: 'BRL', value: 0 });
      }
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: 'enrollment_submitted', candidateCode: data.candidateCode });
      }
      // Meta Pixel: Lead
      if (window.fbq) window.fbq('track', 'Lead', { content_name: state.portal?.nome || '' });
      // TikTok
      if (window.ttq) window.ttq.track('SubmitForm', { content_name: state.portal?.nome || '' });
      // LinkedIn — conversão (precisa conversion_id específico; emitindo evento genérico)
      if (window.lintrk) window.lintrk('track');
    } catch (e) { /* nunca bloqueia UX */ }
  }

  // ─── Handlers ───
  function attachHandlers() {
    // Inputs do form
    root.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
      const handler = (e) => {
        const mask = el.getAttribute('data-mask');
        let v = el.value;
        if (mask === 'cpf') v = formatCpfMask(v);
        else if (mask === 'phone') v = formatPhoneMask(v);
        else if (mask === 'cep') v = v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
        if (mask) el.value = v;
        if (el.type === 'checkbox') state.formData[el.name] = el.checked;
        else state.formData[el.name] = el.value;
        // Limpa erro do campo ao editar
        if (state.errors[el.name]) { delete state.errors[el.name]; el.closest('.field')?.classList.remove('has-error'); }
        scheduleDraftSave();
      };
      el.addEventListener('input', handler);
      // Checkbox emite 'change' (não 'input' em alguns browsers)
      if (el.type === 'checkbox') el.addEventListener('change', handler);
      // Auto-fill CEP ao completar
      if (el.getAttribute('data-mask') === 'cep') {
        el.addEventListener('blur', async () => {
          const v = el.value.replace(/\D/g, '');
          if (v.length === 8) {
            const data = await fetchCep(v);
            if (data) {
              const mapping = { logradouro: 'endereco', bairro: 'bairro', cidade: 'cidade', estado: 'estado', uf: 'uf' };
              Object.entries(mapping).forEach(([src, dst]) => {
                const input = root.querySelector(`input[name="${dst}"]`);
                if (input && data[src] && !input.value) { input.value = data[src]; state.formData[dst] = data[src]; }
              });
            }
          }
        });
      }
    });

    // Upload de boletim ENEM — file não vai pra state.formData (JSON), guarda
    // a referência ao File em state.enemBoletimFile para subir via multipart.
    root.querySelectorAll('input[type=file][name="_enemBoletimFile"]').forEach(el => {
      el.addEventListener('change', () => {
        const f = el.files?.[0];
        if (!f) return;
        const MAX = 15 * 1024 * 1024;
        if (f.size > MAX) {
          state.errors._enemBoletimFile = 'Arquivo muito grande (máx 15MB)';
          el.value = '';
          render();
          return;
        }
        const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (f.type && !allowed.includes(f.type)) {
          state.errors._enemBoletimFile = 'Envie PDF ou imagem (JPG/PNG/WEBP)';
          el.value = '';
          render();
          return;
        }
        state.enemBoletimFile = f;
        delete state.errors._enemBoletimFile;
        render();
      });
    });
    root.querySelectorAll('[data-action="clear-boletim"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        state.enemBoletimFile = null;
        render();
      });
    });

    // Filtros do offering-picker
    root.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('input', (e) => {
        state.filters[el.getAttribute('data-filter')] = el.value;
        render();
      });
    });

    // Cards de oferta
    root.querySelectorAll('.offering-card[data-offering]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-offering');
        state.formData.offeringId = parseInt(id);
        render();
        scheduleDraftSave();
      });
    });

    // Botões
    root.querySelectorAll('button[data-action]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.getAttribute('data-action');
        if (act === 'prev') { state.currentStep--; render(); scheduleDraftSave(); }
        else if (act === 'next') {
          if (validateStep()) {
            trackFunnelOnce(`step_submitted_${state.currentStep}`, { event: 'step_submitted', stepIndex: state.currentStep });
            state.currentStep++; render(); scheduleDraftSave();
          }
        }
        else if (act === 'submit') {
          trackFunnelOnce(`step_submitted_${state.currentStep}`, { event: 'step_submitted', stepIndex: state.currentStep });
          _trackedKeys.add('submitted');
          submit();
        }
      });
    });
  }

  function validateStep() {
    const step = (state.portal?.formConfig?.steps || [])[state.currentStep];
    if (!step) return true;
    state.errors = {};
    let ok = true;
    for (const f of (step.fields || [])) {
      // Campo escondido pela regra de modo não valida (nem required, nem formato)
      if (!isFieldVisible(f)) continue;
      // File upload: estado vive fora do formData JSON.
      if (f.type === 'enem-boletim-upload') {
        if (f.required && !state.enemBoletimFile) { state.errors[f.name] = 'Envie o boletim para continuar'; ok = false; }
        continue;
      }
      const v = state.formData[f.name];
      if (f.required && (v == null || v === '')) { state.errors[f.name] = 'Campo obrigatório'; ok = false; continue; }
      if (f.type === 'email' && v && !isValidEmail(v)) { state.errors[f.name] = 'E-mail inválido'; ok = false; }
      if (f.type === 'cpf' && v && !isValidCpf(v)) { state.errors[f.name] = 'CPF inválido'; ok = false; }
      if (f.type === 'phone' && v) {
        const digits = v.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 13) { state.errors[f.name] = 'Telefone inválido'; ok = false; }
      }
    }
    // Consentimento LGPD obrigatório na última etapa (antes de enviar a inscrição).
    const isLastStep = state.currentStep === ((state.portal?.formConfig?.steps || []).length - 1);
    if (isLastStep && !state.formData.lgpdConsent) {
      state.errors.lgpdConsent = 'É necessário aceitar a política de privacidade para enviar.';
      ok = false;
    }
    if (!ok) render();
    return ok;
  }

  async function submit() {
    if (!validateStep()) return;
    if (state.submitting) return;
    state.submitting = true; render();
    try {
      const captchaToken = await getCaptchaToken();
      // Vincula tracking visitor (bt.js) ao lead que será criado
      const trackingVisitorId = (typeof window.BT?.getVisitorId === 'function') ? window.BT.getVisitorId() : null;
      try {
        if (window.BT?.identify) {
          window.BT.identify({
            email: state.formData.email || undefined,
            phone: state.formData.whatsapp || undefined,
            name: state.formData.nome || undefined,
          });
        }
      } catch {}

      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: state.formData,
          captchaToken,
          sessionId: getDraftSessionId(),
          trackingVisitorId,
          // Continuação a partir do portal de interesse: backend resolve o lead
          // pelo token em vez de duplicar via dedup whatsapp/email.
          ...(state.continueToken ? { continueToken: state.continueToken } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        state.submitting = false;
        root.innerHTML = `<div class="portal-card"><div style="text-align:center;padding:20px"><div style="font-size:40px;color:#dc2626">⚠</div><div style="margin-top:12px;font-weight:500">${esc(data.error || 'Erro ao enviar inscrição')}</div><button class="btn btn-secondary" style="margin-top:14px" onclick="location.reload()">Tentar novamente</button></div></div>`;
        return;
      }

      // ENEM: sobe boletim e mostra tela de análise. Outros modos: tela padrão.
      if (data.entryModeCode === 'enem' && state.enemBoletimFile && data.candidateToken) {
        await uploadBoletimAndAnalyze(data);
      } else {
        renderSuccess(data);
      }
    } catch (e) {
      state.submitting = false;
      root.innerHTML = `<div class="portal-card"><div style="text-align:center;padding:20px;color:#dc2626">⚠ Erro de conexão. Verifique sua internet.</div></div>`;
    }
  }

  // ENEM: pós-submit, sobe o boletim e mostra tela "Analisando seu boletim…"
  // com polling do endpoint /status até a IA processar (ou timeout, com fallback
  // graceful para o portal do candidato).
  async function uploadBoletimAndAnalyze(submitData) {
    fireConversionEvents(submitData);
    clearDraftSession();

    renderEnemAnalyzing(submitData, { phase: 'uploading' });

    const fd = new FormData();
    fd.append('type', 'boletim_enem');
    fd.append('file', state.enemBoletimFile);

    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(submitData.candidateCode)}/document`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${submitData.candidateToken}` },
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        renderEnemAnalyzing(submitData, { phase: 'upload-failed', error: err.error || 'Falha ao enviar o boletim' });
        return;
      }
    } catch (e) {
      renderEnemAnalyzing(submitData, { phase: 'upload-failed', error: 'Erro de conexão ao enviar o boletim' });
      return;
    }

    renderEnemAnalyzing(submitData, { phase: 'analyzing' });
    pollEnemStatus(submitData);
  }

  async function pollEnemStatus(submitData, attempt = 0) {
    // Até ~3min total: 30 tentativas com backoff 6s (IA boletim_enem ~10–60s).
    if (attempt > 30) {
      renderEnemAnalyzing(submitData, { phase: 'timeout' });
      return;
    }
    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/registrations/${encodeURIComponent(submitData.candidateCode)}/status`, {
        headers: { 'Authorization': `Bearer ${submitData.candidateToken}` },
      });
      const d = await r.json();
      if (r.ok && d.scoreImport && d.document?.aiStatus === 'done') {
        renderEnemAnalyzing(submitData, { phase: 'done', result: d });
        return;
      }
      if (r.ok && d.document?.aiStatus === 'failed') {
        renderEnemAnalyzing(submitData, { phase: 'analysis-failed', error: 'Não conseguimos analisar seu boletim automaticamente. Sua inscrição está registrada e nossa equipe vai validar manualmente.' });
        return;
      }
    } catch {}
    setTimeout(() => pollEnemStatus(submitData, attempt + 1), 6000);
  }

  function renderEnemAnalyzing(data, st) {
    const candidateUrl = `${location.origin}/candidato/${encodeURIComponent(data.candidateCode)}`;
    // Salva o candidateToken em sessionStorage pra que o portal logado abra
    // direto na tela de checkout sem pedir CPF de novo (auto-login).
    if (data.candidateToken) {
      try { sessionStorage.setItem('bychat_candidate_token', data.candidateToken) } catch (_) {}
    }
    const isTransparentPay = data.paymentMode === 'transparent'
    const codeBlock = `<div style="font-size:12px;color:#6b7280">Código de candidato:</div><div class="code">${esc(data.candidateCode)}</div>`;
    let body = '';

    if (st.phase === 'uploading') {
      body = `<div style="text-align:center;padding:30px 10px"><div class="loading" style="margin:0 auto 16px;width:48px;height:48px;border-width:4px"></div><div style="font-size:18px;font-weight:600;color:#1a73e8">Enviando seu boletim…</div><div style="font-size:13px;color:#5f6368;margin-top:6px">Isso leva uns segundos.</div></div>`;
    } else if (st.phase === 'analyzing') {
      body = `<div style="text-align:center;padding:30px 10px"><div class="loading" style="margin:0 auto 16px;width:48px;height:48px;border-width:4px"></div><div style="font-size:18px;font-weight:600;color:#1a73e8">Analisando seu boletim com IA…</div><div style="font-size:13px;color:#5f6368;margin-top:6px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto">Estamos lendo as 5 notas, calculando sua média e comparando com a nota de corte do curso. Pode levar até 1 minuto.</div>${codeBlock}</div>`;
    } else if (st.phase === 'done') {
      const s = st.result.scoreImport;
      const d = st.result.document;
      const passed = s.passed === true;
      const inconclusive = s.passed == null;
      const headerColor = passed ? '#137333' : (inconclusive ? '#1a73e8' : '#c5221f');
      const headerLabel = passed ? '✅ Classificado!' : (inconclusive ? '📋 Boletim recebido' : '⏳ Aguardando validação');
      const headerHint = passed
        ? 'Sua nota atingiu o corte. Próximos passos serão enviados para você.'
        : (inconclusive
          ? 'Seu boletim foi recebido. Como o curso não tem nota de corte automática, nossa equipe acadêmica vai validar.'
          : 'Sua nota ficou abaixo da nota de corte automática deste curso. Nossa equipe vai revisar manualmente.');
      const notaItem = (label, v) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f3f4;font-size:13px"><span style="color:#5f6368">${label}</span><strong style="color:#202124">${v != null ? Number(v).toFixed(1) : '—'}</strong></div>`;
      body = `
        <div style="text-align:center;padding:8px 0 20px">
          <div style="font-size:36px">${passed ? '🎉' : (inconclusive ? '📩' : '📋')}</div>
          <div style="font-size:20px;font-weight:600;color:${headerColor};margin-top:4px">${headerLabel}</div>
          <div style="font-size:13px;color:#5f6368;margin-top:6px;line-height:1.5;max-width:420px;margin-left:auto;margin-right:auto">${esc(headerHint)}</div>
        </div>
        <div style="background:#f8faff;border:1px solid #e8eaed;border-radius:10px;padding:16px;margin-bottom:14px">
          <div style="font-size:11px;color:#5f6368;text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:8px">Suas notas extraídas</div>
          ${notaItem('Ciências Humanas', s.cienciasHumanas)}
          ${notaItem('Ciências da Natureza', s.cienciasNatureza)}
          ${notaItem('Linguagens', s.linguagens)}
          ${notaItem('Matemática', s.matematica)}
          ${notaItem('Redação', s.redacao)}
          <div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:6px;border-top:2px solid #1a73e8;font-size:14px"><span style="color:#1a73e8;font-weight:600">Média</span><strong style="color:#1a73e8;font-size:16px">${s.mediaSimples != null ? Number(s.mediaSimples).toFixed(1) : '—'}</strong></div>
          ${s.cutoffScore != null ? `<div style="display:flex;justify-content:space-between;padding:6px 0 0;font-size:12px;color:#5f6368"><span>Nota de corte</span><span>${Number(s.cutoffScore).toFixed(1)}</span></div>` : ''}
        </div>
        ${codeBlock}
        <div style="margin-top:18px;text-align:center">
          <a href="${esc(candidateUrl)}" class="btn btn-primary" style="display:inline-block;text-decoration:none">
            ${isTransparentPay ? 'Ir para pagamento da taxa →' : 'Acompanhar minha inscrição →'}
          </a>
        </div>
        ${data.paymentUrl ? `<div style="margin-top:10px;text-align:center"><a href="${esc(data.paymentUrl)}" class="btn" style="display:inline-block;text-decoration:none;background:#137333;color:#fff">Pagar taxa de inscrição</a></div>` : ''}
        <div style="margin-top:10px;font-size:11px;color:#9aa0a6;text-align:center">As notas extraídas pela IA serão validadas pela secretaria. Em caso de divergência, seu resultado pode ser ajustado.</div>`;
    } else if (st.phase === 'upload-failed' || st.phase === 'analysis-failed' || st.phase === 'timeout') {
      const isUpload = st.phase === 'upload-failed';
      const isTimeout = st.phase === 'timeout';
      body = `
        <div style="text-align:center;padding:20px 10px">
          <div style="font-size:36px">${isTimeout ? '⏰' : '⚠'}</div>
          <div style="font-size:18px;font-weight:600;color:${isUpload?'#c5221f':'#b06000'};margin-top:6px">${isUpload ? 'Falha ao enviar o boletim' : (isTimeout ? 'A análise está demorando mais que o normal' : 'Análise pendente')}</div>
          <div style="font-size:13px;color:#5f6368;margin-top:8px;line-height:1.5;max-width:420px;margin-left:auto;margin-right:auto">${esc(st.error || 'Sua inscrição já foi registrada. Você pode acompanhar pelo portal do candidato e reenviar o boletim por lá quando precisar.')}</div>
        </div>
        ${codeBlock}
        <div style="margin-top:18px;text-align:center"><a href="${esc(candidateUrl)}" class="btn btn-primary" style="display:inline-block;text-decoration:none">Acompanhar pelo portal do candidato →</a></div>`;
    }

    root.innerHTML = `<div class="portal-card success-box">${body}</div>`;
  }

  // ─── Live Chat widget (inline, conectado ao atendimento do CRM) ───
  const chatState = { sessionId: localStorage.getItem('ep-chat-session') || '', open: false, lastMsgId: 0, pollTimer: null, messages: [] };

  function mountLiveChatWidget() {
    if (document.getElementById('ep-live-chat')) return;
    const widget = document.createElement('div');
    widget.id = 'ep-live-chat';
    widget.innerHTML = `
      <div id="ep-chat-launcher" style="position:fixed;bottom:20px;right:20px;width:58px;height:58px;border-radius:50%;background:#1a73e8;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9998;transition:.2s">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
      </div>
      <div id="ep-chat-box" style="display:none;position:fixed;bottom:90px;right:20px;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:9999;overflow:hidden;display:none;flex-direction:column">
        <div style="background:#1a73e8;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-weight:600;font-size:14px">Precisa de ajuda?</div><div style="font-size:11px;opacity:.85">Responde em alguns minutos</div></div>
          <button onclick="window.__epToggleChat()" style="background:none;border:none;color:#fff;cursor:pointer;font-size:20px;padding:0 4px">×</button>
        </div>
        <div id="ep-chat-log" style="flex:1;overflow-y:auto;padding:14px;background:#f6f7fb;display:flex;flex-direction:column;gap:8px"></div>
        <div style="padding:10px;border-top:1px solid #e5e7eb;display:flex;gap:6px;background:#fff">
          <input id="ep-chat-input" type="text" placeholder="Digite sua mensagem..." style="flex:1;padding:9px 12px;border:1px solid #e5e7eb;border-radius:20px;font-size:13px;font-family:inherit;outline:none" onkeydown="if(event.key==='Enter'){event.preventDefault();window.__epSendChat()}">
          <button onclick="window.__epSendChat()" style="background:#1a73e8;color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(widget);
    document.getElementById('ep-chat-launcher').addEventListener('click', () => window.__epToggleChat());
  }

  window.__epToggleChat = async function() {
    const box = document.getElementById('ep-chat-box');
    if (!box) return;
    chatState.open = !chatState.open;
    box.style.display = chatState.open ? 'flex' : 'none';
    if (chatState.open) {
      // Garante sessão
      if (!chatState.sessionId) {
        try {
          const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/chat/session`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome: state.formData.nome, whatsapp: state.formData.whatsapp, email: state.formData.email }),
          });
          const d = await r.json();
          chatState.sessionId = d.sessionId;
          localStorage.setItem('ep-chat-session', chatState.sessionId);
        } catch {}
      }
      // Mensagem de boas-vindas
      if (chatState.messages.length === 0) {
        renderChatMessage({ fromMe: true, body: 'Olá! Sou do time de atendimento. Como posso te ajudar?', senderName: 'Atendimento' });
      }
      document.getElementById('ep-chat-input')?.focus();
      // Inicia polling
      if (!chatState.pollTimer) chatState.pollTimer = setInterval(pollChatMessages, 5000);
    } else {
      if (chatState.pollTimer) { clearInterval(chatState.pollTimer); chatState.pollTimer = null; }
    }
  };

  window.__epSendChat = async function() {
    const input = document.getElementById('ep-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !chatState.sessionId) return;
    input.value = '';
    renderChatMessage({ fromMe: false, body: text, senderName: 'Você' });
    try {
      await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/chat/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: chatState.sessionId, text }),
      });
    } catch (e) {
      renderChatMessage({ fromMe: true, body: '⚠ Não foi possível enviar agora. Tente novamente.', senderName: 'Sistema' });
    }
  };

  async function pollChatMessages() {
    if (!chatState.sessionId) return;
    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/chat/messages?sessionId=${encodeURIComponent(chatState.sessionId)}&since=${chatState.lastMsgId}`);
      if (!r.ok) return;
      const d = await r.json();
      for (const m of (d.messages || [])) {
        // Mensagens do operador vêm como fromMe=true (do ponto de vista do CRM)
        // No portal, inverte: quem mandou mensagem pelo portal tem fromMe=false no DB
        const isOperator = m.fromMe === true;
        if (!chatState.messages.find(x => x.id === m.id)) {
          if (isOperator) renderChatMessage({ fromMe: true, body: m.body, senderName: m.senderName || 'Atendimento' });
        }
        if (m.id > chatState.lastMsgId) chatState.lastMsgId = m.id;
      }
    } catch {}
  }

  function renderChatMessage(msg) {
    chatState.messages.push(msg);
    const log = document.getElementById('ep-chat-log');
    if (!log) return;
    const div = document.createElement('div');
    const isOperator = msg.fromMe === true;
    div.style.cssText = `max-width:75%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;word-break:break-word;${isOperator ? 'align-self:flex-start;background:#fff;border:1px solid #e5e7eb;color:#1a2332' : 'align-self:flex-end;background:#1a73e8;color:#fff'}`;
    div.textContent = msg.body;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ─── Quiz de recomendação de curso (IA) ───
  window.__epOpenQuiz = function() {
    // Overlay em tela cheia com 4 perguntas simples
    const existing = document.getElementById('ep-quiz-overlay');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'ep-quiz-overlay';
    el.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
        <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;padding:24px;max-height:90vh;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div style="font-size:17px;font-weight:600">✨ Encontre o curso ideal</div>
            <button onclick="document.getElementById('ep-quiz-overlay').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#6b7280">×</button>
          </div>
          <div id="ep-quiz-body">
            <div class="field">
              <label style="font-size:13px;color:#5f6368;font-weight:500;display:block;margin-bottom:5px">Qual área te interessa? (palavras-chave)</label>
              <input id="qz-area" type="text" placeholder="Ex: tecnologia, saúde, direito, negócios..." style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;font-family:inherit">
            </div>
            <div class="field">
              <label style="font-size:13px;color:#5f6368;font-weight:500;display:block;margin-bottom:5px;margin-top:14px">Modalidade preferida</label>
              <select id="qz-modality" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;font-family:inherit">
                <option value="">Tanto faz</option>
                <option value="presencial">Presencial</option>
                <option value="ead">EAD / A distância</option>
                <option value="híbrido">Híbrido</option>
              </select>
            </div>
            <div class="field">
              <label style="font-size:13px;color:#5f6368;font-weight:500;display:block;margin-bottom:5px;margin-top:14px">Orçamento mensal (R$)</label>
              <input id="qz-budget" type="number" min="0" step="50" placeholder="Ex: 500" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;font-family:inherit">
            </div>
            <div class="field">
              <label style="font-size:13px;color:#5f6368;font-weight:500;display:block;margin-bottom:5px;margin-top:14px">Turno disponível</label>
              <select id="qz-time" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;font-family:inherit">
                <option value="">Tanto faz</option>
                <option value="manhã">Manhã</option>
                <option value="tarde">Tarde</option>
                <option value="noite">Noite</option>
                <option value="integral">Integral</option>
              </select>
            </div>
            <button onclick="window.__epRunQuiz()" style="margin-top:18px;width:100%;padding:12px;background:#1a73e8;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Ver recomendações</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
  };

  window.__epRunQuiz = async function() {
    const answers = {
      area: document.getElementById('qz-area')?.value?.trim() || '',
      modality: document.getElementById('qz-modality')?.value?.trim() || '',
      budget: parseFloat(document.getElementById('qz-budget')?.value) || 0,
      time_available: document.getElementById('qz-time')?.value?.trim() || '',
    };
    const body = document.getElementById('ep-quiz-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:30px;color:#6b7280"><div class="loading" style="border-color:#1a73e8;border-top-color:transparent;width:24px;height:24px"></div><div style="margin-top:10px">Analisando suas preferências...</div></div>';

    try {
      const r = await fetch(`${API}/public/portals/${encodeURIComponent(slug)}/recommend-course`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      });
      const d = await r.json();
      const recs = (d.recommendations || []).filter(x => x.score > 0);

      if (recs.length === 0) {
        body.innerHTML = `<div style="text-align:center;padding:20px;color:#6b7280">
          <div style="font-size:40px;margin-bottom:8px">🤔</div>
          <div style="font-size:14px;font-weight:500">Nenhuma recomendação bateu</div>
          <div style="font-size:12px;margin-top:6px">Tente palavras-chave diferentes, ou explore todos os cursos manualmente.</div>
          <button onclick="document.getElementById('ep-quiz-overlay').remove()" style="margin-top:14px;padding:8px 18px;background:#f1f5f9;color:#1a73e8;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit">Voltar ao formulário</button>
        </div>`;
        return;
      }

      body.innerHTML = `<div style="font-size:13px;color:#6b7280;margin-bottom:12px">✨ Baseado nas suas respostas, sugerimos:</div>
        <div style="display:grid;gap:10px">
          ${recs.map((r, idx) => `<div style="border:${idx===0?'2px solid #1a73e8':'1px solid #e5e7eb'};border-radius:8px;padding:14px;background:${idx===0?'#f0f7ff':'#fff'}">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
              <div style="flex:1;min-width:0">
                ${idx===0?'<div style="font-size:10px;font-weight:600;color:#1a73e8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">⭐ Melhor match</div>':''}
                <div style="font-size:15px;font-weight:600">${esc(r.courseName)}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:4px">
                  ${r.level ? `${esc(r.level)} · ` : ''}${r.modality ? `${esc(r.modality)} · ` : ''}${r.turno ? `${esc(r.turno)} · ` : ''}${r.campus ? esc(r.campus) : ''}
                </div>
                ${r.requiresPayment && r.taxaInscricao ? `<div style="font-size:12px;color:#137333;font-weight:500;margin-top:4px">Taxa de inscrição: ${fmtCurrency(r.taxaInscricao)}</div>` : ''}
                ${r.matchReasons?.length ? `<div style="font-size:11px;color:#6b7280;margin-top:6px">✓ ${r.matchReasons.join(' · ')}</div>` : ''}
              </div>
              <button onclick="window.__epPickOffering(${r.offeringId})" style="padding:8px 14px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap">Escolher →</button>
            </div>
          </div>`).join('')}
        </div>
        <button onclick="document.getElementById('ep-quiz-overlay').remove()" style="margin-top:14px;width:100%;padding:9px;background:#f1f5f9;color:#5f6368;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit">Fechar e escolher manualmente</button>`;
    } catch (e) {
      body.innerHTML = '<div style="color:#dc2626;padding:20px;text-align:center">Erro ao buscar recomendações. Tente novamente.</div>';
    }
  };

  window.__epPickOffering = function(offeringId) {
    state.formData.offeringId = offeringId;
    document.getElementById('ep-quiz-overlay')?.remove();
    render();
  };

  // Trocar de modo de ingresso reseta o curso, os filtros e os campos
  // controlados por visibleWhen.entryMode (que dependem do modo derivado da oferta).
  window.__epPickEntryMode = function(code) {
    if (state.filters.entryModeCode === code) {
      state.filters.entryModeCode = '';
    } else {
      state.filters.entryModeCode = code;
    }
    state.formData.offeringId = null;
    state.filters.levelId = '';
    state.filters.modalityId = '';
    state.filters.campusId = '';
    state.filters.courseQuery = '';
    render();
  };

  loadPortal();
  setTimeout(mountLiveChatWidget, 60000);
})();
