// candidate-portal.js — runtime do portal do candidato

(function() {
  const API = '/api';
  const pathParts = location.pathname.split('/').filter(Boolean);
  const initialCode = pathParts.length >= 2 && pathParts[0] === 'candidato' ? pathParts[1] : '';
  const app = document.getElementById('app');
  const TOKEN_KEY = 'bychat_candidate_token';

  let state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    data: null,
  };

  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtCurrency(v) { if (v == null) return '-'; return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function fmtDate(d) { if (!d) return '-'; const dt = new Date(d); return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function fmtBytes(b) { if (!b) return '-'; const kb = b / 1024; if (kb < 1024) return kb.toFixed(1) + ' KB'; return (kb/1024).toFixed(2) + ' MB'; }

  async function apiFetch(path, opts = {}) {
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
        ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(d.error || 'Erro'); err.status = r.status; throw err; }
    return d;
  }

  // Branding injetado pelo SSR a partir do EnrollmentPortal vinculado ao :code da URL.
  // Disponível inclusive antes do login (a tela inicial usa só o code da URL).
  function brandHeaderHtml(fallbackTitle, fallbackSub) {
    const b = (typeof window !== 'undefined' && window.__PORTAL_BRAND__) || {};
    if (b.brandLogoUrl) {
      const img = `<img src="${esc(b.brandLogoUrl)}" alt="${esc(fallbackTitle||'')}" style="max-height:56px;max-width:220px;width:auto;height:auto;display:block;margin:0 auto">`;
      const wrapped = b.brandLogoLink ? `<a href="${esc(b.brandLogoLink)}" target="_blank" rel="noopener">${img}</a>` : img;
      return `<div class="hdr">${wrapped}${fallbackSub?`<div class="sub" style="margin-top:8px">${esc(fallbackSub)}</div>`:''}</div>`;
    }
    return `<div class="hdr"><h1>${esc(fallbackTitle)}</h1>${fallbackSub?`<div class="sub">${esc(fallbackSub)}</div>`:''}</div>`;
  }

  // ─── Login ───
  function renderLogin(errMsg) {
    app.innerHTML = `
      ${brandHeaderHtml('Portal do Candidato', 'Acompanhe o status da sua inscrição')}
      <div class="card">
        <div class="field">
          <label>Código do candidato</label>
          <input id="login-code" type="text" value="${esc(initialCode)}" placeholder="MAT-26-000147" style="font-family:ui-monospace,monospace;text-transform:uppercase">
        </div>
        <div class="field">
          <label>CPF</label>
          <input id="login-cpf" type="text" placeholder="000.000.000-00" maxlength="14" inputmode="numeric">
        </div>
        ${errMsg ? `<div class="alert alert-err">${esc(errMsg)}</div>` : ''}
        <button class="btn btn-primary" id="login-btn">Entrar</button>
      </div>
      <div class="card" style="text-align:center;color:var(--muted);font-size:12px">
        Esqueceu o código? Verifique o e-mail ou WhatsApp enviado após sua inscrição.
      </div>`;

    const cpfInput = document.getElementById('login-cpf');
    cpfInput?.addEventListener('input', (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 11);
      v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1-$2');
      e.target.value = v;
    });

    const btn = document.getElementById('login-btn');
    btn.addEventListener('click', async () => {
      const candidateCode = document.getElementById('login-code').value.trim().toUpperCase();
      const cpf = document.getElementById('login-cpf').value.replace(/\D/g, '');
      if (!candidateCode || !cpf) { renderLogin('Preencha código e CPF'); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Entrando...';
      try {
        const r = await fetch(`${API}/candidate/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateCode, cpf }) });
        const d = await r.json();
        if (!r.ok) { renderLogin(d.error || 'Erro'); return; }
        state.token = d.token;
        sessionStorage.setItem(TOKEN_KEY, d.token);
        loadDashboard();
      } catch (e) { renderLogin('Erro de conexão'); }
    });
  }

  // ─── Dashboard ───
  async function loadDashboard() {
    try {
      state.data = await apiFetch('/candidate/me');
      // Defesa contra sessionStorage stale: se a URL traz um candidateCode
      // diferente do token (ex: usuário fez login com MAT-26-000001 e depois
      // navegou para /candidato/MAT-26-000002 sem deslogar), descarta o token
      // silenciosamente e mostra a tela de login da inscrição correta.
      // Sem alerta — o caso mais comum é troca proposital de inscrição.
      const tokenCode = state.data?.enrollment?.candidateCode;
      if (initialCode && tokenCode && initialCode.toUpperCase() !== tokenCode.toUpperCase()) {
        sessionStorage.removeItem(TOKEN_KEY);
        state.token = '';
        state.data = null;
        renderLogin();
        return;
      }
      renderDashboard();
    } catch (e) {
      if (e.status === 401) { sessionStorage.removeItem(TOKEN_KEY); state.token = ''; renderLogin('Sessão expirada — entre novamente'); return; }
      app.innerHTML = `<div class="card"><div class="alert alert-err">${esc(e.message)}</div></div>`;
    }
  }

  function renderDashboard() {
    const d = state.data;
    const en = d.enrollment;
    const requirePayment = !!d.portal?.requirePayment;
    const stage = d.stage;  // { key, name, color } | null
    const stageBadge = stage
      ? `<span class="badge" style="background:${stage.color}1a;color:${stage.color};border:1px solid ${stage.color}40">${esc(stage.name)}</span>`
      : `<span class="badge badge-pending">Inscrição enviada</span>`;
    const paymentBadge = (requirePayment && en.paymentStatus) ? getPaymentBadge(en.paymentStatus) : '';
    const courseName = d.processRegistration?.offering?.course?.nome || d.processRegistration?.offering?.nome || '-';
    const campusList = (d.processRegistration?.offering?.campuses || []).map(c => c.campus?.nome).filter(Boolean).join(', ') || '-';

    // Sincroniza __PORTAL_BRAND__ com a versão fresca vinda do /me (caso o admin
    // tenha trocado o logo entre o SSR e o login do candidato).
    if (d.portal) {
      window.__PORTAL_BRAND__ = {
        brandLogoUrl: d.portal.brandLogoUrl || null,
        brandLogoLink: d.portal.brandLogoLink || null,
      };
    }
    const headerHtml = brandHeaderHtml(d.portal.nome, d.portal.unit?.nome || '');
    const spName = d.processRegistration?.selectionProcess?.nome || '';

    // Faixa fixa de identificação — evita que o candidato confunda inscrições
    // quando tem múltiplas (ex: 2 vestibulares no mesmo lead).
    const idBar = `
      <div style="position:sticky;top:0;z-index:10;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.85">Inscrição ativa</div>
          <strong style="font-family:ui-monospace,monospace;font-size:14px;background:rgba(255,255,255,.18);padding:3px 10px;border-radius:4px">${esc(en.candidateCode)}</strong>
          ${spName ? `<span style="font-size:12px;opacity:.95">· ${esc(spName)}</span>` : ''}
        </div>
        <button onclick="_cpLogout()" style="padding:5px 12px;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:500">Sair desta inscrição</button>
      </div>`;

    app.innerHTML = `
      ${idBar}
      ${headerHtml}

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Código do candidato</div>
            <div style="font-size:20px;font-weight:700;font-family:ui-monospace,monospace;margin-top:2px;color:var(--primary)">${esc(en.candidateCode)}</div>
            <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${stageBadge} ${paymentBadge}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            <button class="btn btn-sm" onclick="_cpReceipt()" style="background:#e8f0fe;color:var(--primary);border:1px solid #d2e3fc">📄 Comprovante</button>
            <button class="btn btn-sm" onclick="_cpLogout()" style="background:#fff;border:1px solid var(--border);color:var(--muted)">Sair</button>
          </div>
        </div>
        <div class="kpi">
          <div class="kpi-card"><div class="v" style="font-size:15px">${esc(courseName)}</div><div class="l">Curso</div></div>
          <div class="kpi-card"><div class="v" style="font-size:14px">${esc(campusList)}</div><div class="l">Campus</div></div>
          <div class="kpi-card"><div class="v" style="font-size:14px">${fmtDate(en.createdAt)}</div><div class="l">Inscrita em</div></div>
        </div>
      </div>

      ${renderPaymentSection(d)}

      ${renderEnemResultSection(d)}

      <div id="essay-section-mount"></div>
      <div id="presencial-section-mount"></div>

      ${renderDocumentsSection(d)}

      <div class="card">
        <h3 style="margin-bottom:8px;font-size:15px">📅 Linha do tempo</h3>
        <div class="timeline">
          ${d.timeline.map(t => `
            <div class="timeline-item">
              <div class="ico">${t.icon || '•'}</div>
              <div class="body">
                <div class="t">${esc(t.title)}</div>
                <div class="at">${fmtDate(t.at)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    attachHandlers();
    // Carrega seções específicas do modo de ingresso (redação online / presencial)
    loadEssaySection().catch(err => console.warn('[essay]', err));
    loadPresencialSection().catch(err => console.warn('[presencial]', err));
    // Inicia polling se houver método pending e portal estiver em modo transparente.
    const hasPending = (d.paymentMethods || []).some(m => m.status === 'pending')
    if (d.portal?.paymentMode === 'transparent' && requirePayment && !en.paymentPaidAt && hasPending) {
      startPaymentPolling()
    }
  }

  // ─── Redação online ─────────────────────────────────────────
  // Renderiza tela de redação dentro de #essay-section-mount.
  // Anti-fraude: paste bloqueado (configurável), timer, contador, auto-save.
  let _essayState = null;
  let _essayDraftTimer = null;

  async function loadEssaySection() {
    const mount = document.getElementById('essay-section-mount');
    if (!mount) return;
    let data;
    try { data = await apiFetch('/candidate/essay'); }
    catch (e) { return; /* não exibe se erro de auth */ }
    if (!data?.eligible) return;
    _essayState = data;
    renderEssaySection();
  }

  function renderEssaySection() {
    const mount = document.getElementById('essay-section-mount');
    if (!mount || !_essayState) return;
    const cfg = _essayState.config || {};
    const final = _essayState.finalResult;
    const draft = _essayState.activeDraft;
    const pending = _essayState.pendingReview;

    // Resultado final (aprovada/rejeitada) — só leitura
    if (final) {
      const ok = final.status === 'approved';
      const attemptsLeft = _essayState.attemptsLeft || 0;
      // Se reprovada e ainda há tentativas, oferece refazer (botão reativado).
      const canRetry = !ok && attemptsLeft > 0;
      mount.innerHTML = `<div class="card" style="border-left:4px solid ${ok?'var(--success)':'var(--error)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <h3 style="font-size:15px">✍ Redação</h3>
          <span style="padding:4px 12px;border-radius:14px;font-size:12px;font-weight:600;background:${ok?'#d1fae5':'#fee2e2'};color:${ok?'var(--success)':'var(--error)'}">${ok?'✓ Aprovada':'✗ Não aprovada'}</span>
        </div>
        <div style="font-size:13px;color:var(--muted)">Nota: <strong style="color:var(--text);font-size:18px">${final.finalScore != null ? Math.round(final.finalScore) : '—'}</strong>${cfg.cutoff?` <span style="font-size:11px">(corte: ${cfg.cutoff})</span>`:''}</div>
        ${final.humanNote ? `<div style="margin-top:10px;padding:10px;background:#f9fafb;border-left:3px solid ${ok?'var(--success)':'var(--error)'};border-radius:4px;font-size:12px;color:var(--text)"><strong>Feedback:</strong> ${esc(final.humanNote)}</div>` : ''}
        ${canRetry ? `
          <div style="margin-top:14px;padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px;color:#7c2d12;line-height:1.5">
            Você ainda tem <strong>${attemptsLeft}</strong> tentativa(s). Pode refazer a redação.
          </div>
          <button class="btn btn-primary" onclick="_cpEssayStart()" style="width:100%;margin-top:12px">▶ Refazer redação</button>
        ` : ''}
      </div>`;
      return;
    }

    // Submissão pendente de revisão — bloqueia novo início.
    if (pending) {
      mount.innerHTML = `<div class="card" style="border-left:4px solid #1a73e8">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <h3 style="font-size:15px">✍ Redação</h3>
          <span style="padding:4px 12px;border-radius:14px;font-size:12px;font-weight:600;background:#e8f0fe;color:#1a73e8">⏳ Em avaliação</span>
        </div>
        <div style="background:#f8faff;border:1px solid #d2e3fc;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.65;color:#1a2332">
          <div style="font-weight:600;color:#1a73e8;margin-bottom:6px">📩 Sua redação foi enviada com sucesso!</div>
          <div>Sua redação está sendo avaliada por nossa equipe.</div>
          <div style="margin-top:10px;font-size:12px;color:var(--muted)">Você será avisado(a) assim que o veredito sair. Não é possível iniciar uma nova redação enquanto esta estiver em avaliação.</div>
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--muted);text-align:center">Enviada em ${pending.submittedAt ? new Date(pending.submittedAt).toLocaleString('pt-BR') : '—'}${pending.wordCount ? ` · ${pending.wordCount} palavras` : ''}</div>
      </div>`;
      return;
    }

    // Draft em andamento — mostra editor
    if (draft) {
      _essayRenderEditor(draft);
      return;
    }

    // Sem draft ativo, sem revisão pendente — botão pra começar
    const attemptsLeft = _essayState.attemptsLeft;
    if (attemptsLeft <= 0) {
      mount.innerHTML = `<div class="card">
        <h3 style="margin-bottom:8px;font-size:15px">✍ Redação</h3>
        <div class="alert alert-warn">Você esgotou as tentativas (${cfg.maxAttempts}).</div>
      </div>`;
      return;
    }
    const lastSub = (_essayState.submissions || []).find(s => s.status !== 'draft');
    const lastRejected = lastSub && (lastSub.status === 'rejected' || lastSub.status === 'expired');
    // O tema agora é sorteado no /start. Mostra aviso adequado ao candidato.
    const topicNotice = cfg.hasMultipleTopics
      ? `<strong style="color:#1a73e8">🎲 Tema sorteado ao iniciar</strong><br>O tema da sua redação será sorteado entre ${cfg.topicCount} possibilidades quando você clicar em iniciar. Não é possível trocar depois.`
      : `<strong style="color:#1a73e8">📝 Tema fixo</strong><br>O tema da redação será revelado ao clicar em iniciar.`;
    mount.innerHTML = `<div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="font-size:15px">✍ Redação Online</h3>
        <span style="font-size:11px;color:var(--muted);background:#f1f3f4;padding:3px 10px;border-radius:10px">${attemptsLeft} tentativa(s) restante(s)</span>
      </div>
      ${lastRejected ? `<div class="alert alert-warn" style="margin-bottom:12px">A tentativa anterior ${lastSub.status === 'expired' ? 'expirou' : 'não foi aprovada'}. Você pode tentar novamente.</div>` : ''}
      <div style="background:#f8faff;border:1px solid #d2e3fc;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px;line-height:1.6;color:#3c4043">
        ${topicNotice}
      </div>
      <ul style="font-size:12px;color:var(--muted);line-height:1.8;padding-left:18px;margin-bottom:14px">
        ${cfg.durationMinutes ? `<li>⏱ <strong>Tempo:</strong> ${cfg.durationMinutes} minutos a partir do início</li>` : ''}
        ${cfg.minWords || cfg.maxWords ? `<li>📏 <strong>Tamanho:</strong> ${cfg.minWords||0}${cfg.maxWords?`–${cfg.maxWords}`:'+'} palavras</li>` : ''}
        ${cfg.pasteBlocked ? `<li>🛡 <strong>Anti-fraude:</strong> copiar/colar bloqueado, mudanças de aba são contadas</li>` : ''}
        <li>💾 Seu texto é salvo automaticamente enquanto você digita</li>
        <li>📩 Após enviar, a correção é feita por IA e revisada por humano</li>
      </ul>
      <button class="btn btn-primary" onclick="_cpEssayStart()" style="width:100%">▶ ${lastRejected ? 'Refazer redação' : 'Iniciar redação'}</button>
    </div>`;
  }

  function _essayRenderEditor(sub) {
    const mount = document.getElementById('essay-section-mount');
    const cfg = _essayState.config || {};
    const expiresAt = sub.expiresAt ? new Date(sub.expiresAt) : null;
    mount.innerHTML = `<div class="card" style="border-left:4px solid var(--primary)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="font-size:15px">✍ Redação em andamento</h3>
        ${expiresAt ? `<div id="essay-timer" style="font-family:ui-monospace,monospace;font-size:14px;font-weight:600;padding:4px 10px;background:#fff;border:1px solid var(--border);border-radius:6px">--:--</div>` : ''}
      </div>
      <div style="background:#f8faff;border:1px solid #d2e3fc;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;line-height:1.5;color:#3c4043;white-space:pre-wrap">
        <strong>Tema:</strong> ${esc(sub.prompt || '')}
      </div>
      <textarea id="essay-textarea" rows="14" placeholder="Comece a escrever sua redação aqui..." style="width:100%;padding:14px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:Georgia,'Times New Roman',serif;line-height:1.7;resize:vertical;min-height:340px;outline:none">${esc(sub.essayText||'')}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--muted)">
        <div><span id="essay-wordcount">${sub.wordCount||0}</span> palavra(s)${cfg.minWords?` · mín: ${cfg.minWords}`:''}${cfg.maxWords?` · máx: ${cfg.maxWords}`:''}</div>
        <div><span id="essay-savestatus" style="font-size:11px">salvo</span></div>
      </div>
      <button class="btn btn-primary" onclick="_cpEssaySubmit()" style="width:100%;margin-top:14px">📤 Enviar redação (definitivo)</button>
      ${cfg.pasteBlocked ? '<div style="margin-top:10px;font-size:11px;color:var(--warning);text-align:center">🛡 Copiar/colar está bloqueado nesta redação</div>' : ''}
    </div>`;

    const ta = document.getElementById('essay-textarea');
    const wc = document.getElementById('essay-wordcount');
    const status = document.getElementById('essay-savestatus');
    let pasteAttempts = sub.pasteAttempts || 0;
    let visibilityChanges = sub.visibilityChanges || 0;

    if (cfg.pasteBlocked) {
      ta.addEventListener('paste', (e) => { e.preventDefault(); pasteAttempts++; status.textContent = '🛡 colar bloqueado'; status.style.color = 'var(--error)'; });
      ta.addEventListener('drop', (e) => { e.preventDefault(); pasteAttempts++; });
      // Bloqueia menu de contexto pra coibir paste-via-direito
      ta.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) visibilityChanges++;
    });

    const triggerSave = () => {
      const text = ta.value;
      wc.textContent = text.trim().split(/\s+/).filter(Boolean).length;
      status.textContent = 'salvando...';
      status.style.color = 'var(--muted)';
      clearTimeout(_essayDraftTimer);
      _essayDraftTimer = setTimeout(async () => {
        try {
          const r = await apiFetch(`/candidate/essay/${sub.id}/draft`, {
            method: 'PUT',
            body: JSON.stringify({ essayText: text, pasteAttempts, visibilityChanges }),
          });
          status.textContent = '✓ salvo';
          status.style.color = 'var(--success)';
        } catch (e) {
          status.textContent = '⚠ erro: ' + e.message;
          status.style.color = 'var(--error)';
        }
      }, 1500);
    };
    ta.addEventListener('input', triggerSave);

    // Timer
    if (expiresAt) {
      const t = document.getElementById('essay-timer');
      const update = () => {
        const ms = expiresAt - new Date();
        if (ms <= 0) {
          t.textContent = '⏱ Tempo esgotado';
          t.style.background = '#fef2f2'; t.style.borderColor = '#fecaca'; t.style.color = 'var(--error)';
          ta.disabled = true;
          // Auto-submit ao expirar
          _cpEssaySubmit(true);
          return;
        }
        const min = Math.floor(ms / 60000);
        const sec = Math.floor((ms % 60000) / 1000);
        t.textContent = `⏱ ${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        if (ms < 5 * 60 * 1000) { t.style.background = '#fef2f2'; t.style.color = 'var(--error)'; }
        else if (ms < 15 * 60 * 1000) { t.style.background = '#fef7e0'; t.style.color = 'var(--warning)'; }
        setTimeout(update, 1000);
      };
      update();
    }

    // Salva referência pra submit usar
    _essayState._editor = { ta, getMeta: () => ({ pasteAttempts, visibilityChanges }) };
  }

  window._cpEssayStart = async function() {
    try {
      const r = await apiFetch('/candidate/essay/start', { method: 'POST', body: JSON.stringify({}) });
      _essayState.activeDraft = r.submission;
      _essayState.canStart = false;
      renderEssaySection();
    } catch (e) { alert(e.message); }
  };

  window._cpEssaySubmit = async function(autoExpired) {
    if (!_essayState?._editor) return;
    if (!autoExpired && !confirm('Enviar redação? Esta ação não pode ser desfeita — a correção começará e você não poderá mais editar.')) return;
    const sub = _essayState.activeDraft;
    const meta = _essayState._editor.getMeta();
    try {
      const r = await apiFetch(`/candidate/essay/${sub.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          essayText: _essayState._editor.ta.value,
          pasteAttempts: meta.pasteAttempts,
          visibilityChanges: meta.visibilityChanges,
        }),
      });
      // Recarrega a seção
      await loadEssaySection();
      alert(autoExpired ? 'Tempo esgotado — sua redação foi enviada automaticamente.' : 'Redação enviada! A correção será feita em breve.');
    } catch (e) { alert(e.message); }
  };

  // ─── Vestibular Presencial ──────────────────────────────────
  // Mostra agenda + resultado da prova presencial (somente leitura).
  async function loadPresencialSection() {
    const mount = document.getElementById('presencial-section-mount');
    if (!mount) return;
    let data;
    try { data = await apiFetch('/candidate/presencial-exam'); }
    catch { return; }
    const exam = data?.exam;
    if (!exam) return;

    const verdictColor = exam.verdict === 'approved' ? 'var(--success)' : exam.verdict === 'rejected' ? 'var(--error)' : 'var(--primary)';
    const verdictLabel = exam.verdict === 'approved' ? '✅ Aprovado' : exam.verdict === 'rejected' ? '❌ Não aprovado' : '⏳ Aguardando resultado';
    const isFuture = exam.scheduledAt && new Date(exam.scheduledAt) > new Date();

    mount.innerHTML = `<div class="card" style="border-left:4px solid ${verdictColor}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="font-size:15px">🏫 Vestibular Presencial</h3>
        ${exam.verdict !== 'pending' ? `<span style="padding:4px 12px;border-radius:14px;font-size:12px;font-weight:600;background:${exam.verdict==='approved'?'#d1fae5':'#fee2e2'};color:${verdictColor}">${verdictLabel}</span>` : ''}
      </div>
      ${exam.scheduledAt ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div style="background:#f9fafb;padding:10px;border-radius:6px;font-size:12px">
          <div style="color:var(--muted);margin-bottom:4px">📅 Data e horário</div>
          <strong style="color:var(--text)">${fmtDate(exam.scheduledAt)}</strong>
        </div>
        ${exam.location ? `<div style="background:#f9fafb;padding:10px;border-radius:6px;font-size:12px">
          <div style="color:var(--muted);margin-bottom:4px">📍 Local</div>
          <strong style="color:var(--text)">${esc(exam.location)}</strong>
        </div>` : ''}
      </div>` : '<div class="alert alert-warn">⏳ Sua prova ainda não foi agendada. Aguarde comunicado da coordenação.</div>'}
      ${exam.room || exam.seatNumber ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">${exam.room?`Sala: <strong>${esc(exam.room)}</strong>`:''}${exam.room&&exam.seatNumber?' · ':''}${exam.seatNumber?`Carteira: <strong>${esc(exam.seatNumber)}</strong>`:''}</div>` : ''}
      ${exam.score != null ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:10px;background:#f0f7ff;border-radius:6px;margin-top:8px">
        <span>Sua nota: <strong style="font-size:16px">${exam.score}</strong>${exam.maxScore?` / ${exam.maxScore}`:''}</span>
        ${exam.cutoffApplied != null ? `<span style="color:var(--muted)">Corte: ${exam.cutoffApplied}</span>` : ''}
      </div>` : ''}
      ${exam.attendanceStatus === 'absent' ? '<div class="alert alert-err" style="margin-top:10px">⚠ Você foi marcado como ausente.</div>' : ''}
      ${exam.verdictReason ? `<div style="margin-top:10px;padding:10px;background:#f9fafb;border-left:3px solid ${verdictColor};border-radius:4px;font-size:12px">${esc(exam.verdictReason)}</div>` : ''}
      ${isFuture ? '<div style="margin-top:10px;font-size:11px;color:var(--muted);text-align:center">📌 Compareça com 30min de antecedência levando documento com foto</div>' : ''}
    </div>`;
  }

  // Mostra resultado do ENEM se há import processado.
  // Só aparece para processos com EntryMode "enem".
  function renderEnemResultSection(d) {
    const imports = d.enrollment?.enemScoreImports || d.enemScoreImports || [];
    if (!imports || imports.length === 0) return '';
    const entryModeCode = d.processRegistration?.selectionProcess?.entryMode?.code;
    if (entryModeCode !== 'enem') return '';

    const latest = imports[0]; // ordenado desc
    const media = latest.mediaSimples != null ? latest.mediaSimples.toFixed(1) : null;
    const cutoff = latest.cutoffScore != null ? latest.cutoffScore.toFixed(1) : null;
    const passed = latest.passed;

    // Cor de borda conforme resultado
    const borderColor = passed === true ? 'var(--success)' : passed === false ? 'var(--error)' : 'var(--warning)';
    const resultLabel = passed === true ? '✅ Aprovado pela nota' : passed === false ? '❌ Abaixo da nota de corte' : '🕐 Aguardando definição de corte';
    const resultColor = passed === true ? 'var(--success)' : passed === false ? 'var(--error)' : 'var(--warning)';

    const nota = (label, value) => `
      <div style="text-align:center;padding:10px 6px;background:#f8f9fa;border-radius:6px;flex:1;min-width:90px">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:500;margin-bottom:3px">${label}</div>
        <div style="font-size:18px;font-weight:700;color:var(--text)">${value != null ? Number(value).toFixed(0) : '—'}</div>
      </div>`;

    return `<div class="card" style="border-left:4px solid ${borderColor}">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <h3 style="font-size:15px">📝 Nota do ENEM ${latest.ano ? `(${latest.ano})` : ''}</h3>
        <span style="padding:4px 12px;border-radius:14px;font-size:12px;font-weight:600;background:${resultColor}22;color:${resultColor}">${resultLabel}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${nota('Linguagens', latest.linguagens)}
        ${nota('Humanas', latest.cienciasHumanas)}
        ${nota('Natureza', latest.cienciasNatureza)}
        ${nota('Matemática', latest.matematica)}
        ${nota('Redação', latest.redacao)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:10px;background:#f0f7ff;border-radius:6px">
        <span>Sua média simples: <strong>${media || '—'}</strong></span>
        ${cutoff ? `<span style="color:var(--muted)">Nota de corte: ${cutoff}</span>` : ''}
      </div>
      ${latest.treineiro ? '<div style="margin-top:8px;padding:8px;background:#fef7e0;border-radius:6px;font-size:11px;color:#b06000">⚠ Você marcou como treineiro. Verifique se o boletim é válido para este processo.</div>' : ''}
      ${latest.source === 'manual' ? '<div style="margin-top:8px;font-size:10px;color:var(--muted);font-style:italic">Notas conferidas manualmente pela equipe.</div>' : ''}
    </div>`;
  }

  // Renderiza a seção de documentos. Se o processo do candidato tem EntryMode
  // com requirements configurados, apresenta checklist (1 linha por tipo) com
  // status e botão de reenvio. Senão cai pro modo "genérico" (upload livre).
  function renderDocumentsSection(d) {
    // effectiveDocumentRequirements vem resolvido do backend (override do SP > default do modo).
    // Fallback ao caminho antigo só por compat com payloads pre-deploy.
    const requirements = d.processRegistration?.effectiveDocumentRequirements
      || d.processRegistration?.selectionProcess?.entryMode?.documentRequirements
      || [];
    const docs = d.documents || [];

    if (requirements.length === 0) {
      // Fallback: upload livre (docs que não têm checklist)
      return `<div class="card">
        <h3 style="margin-bottom:8px;font-size:15px">📎 Documentos</h3>
        <label class="doc-upload" id="doc-upload-label" data-type="other">
          <div style="font-size:28px;margin-bottom:6px">📤</div>
          <div style="font-size:13px;font-weight:500">Clique ou arraste para enviar</div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">JPG, PNG, GIF, BMP, WebP, HEIC, PDF — máx 25MB</div>
          <input type="file" id="doc-input" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,application/pdf,.heic,.heif" style="display:none" data-type="other">
        </label>
        <div class="doc-list">
          ${docs.length === 0 ? '<div style="text-align:center;color:var(--muted);font-size:12px;padding:10px">Nenhum documento enviado ainda</div>' : docs.map(doc => renderDocItem(doc)).join('')}
        </div>
      </div>`;
    }

    // Modo checklist: 1 linha por tipo esperado
    const docsByCode = {};
    docs.forEach(doc => {
      const code = doc.type?.code || doc.typeCode;
      if (!code) return;
      // Pega o mais recente (docs ordenados por uploadedAt desc)
      if (!docsByCode[code]) docsByCode[code] = doc;
    });

    const extraDocs = docs.filter(doc => {
      const code = doc.type?.code || doc.typeCode;
      return !code || !requirements.some(r => r.documentType.code === code);
    });

    const nRequired = requirements.filter(r => r.required).length;
    const nApproved = requirements.filter(r => r.required && docsByCode[r.documentType.code]?.status === 'approved').length;

    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <h3 style="font-size:15px">📎 Documentos necessários</h3>
        <span style="font-size:12px;color:var(--muted)">${nApproved} de ${nRequired} aprovados</span>
      </div>
      <div class="doc-checklist">
        ${requirements.map(r => renderChecklistItem(r, docsByCode[r.documentType.code])).join('')}
      </div>
      ${extraDocs.length > 0 ? `
        <div style="margin-top:14px">
          <div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:500">Outros documentos enviados</div>
          ${extraDocs.map(doc => renderDocItem(doc)).join('')}
        </div>` : ''}
    </div>`;
  }

  function renderChecklistItem(req, doc) {
    const dt = req.documentType;
    const statusInfo = doc
      ? (doc.status === 'approved' ? { c: 'badge-approved', l: '✓ Aprovado', icon: '✅', tone: '--success' }
        : doc.status === 'rejected' ? { c: 'badge-rejected', l: '✗ Rejeitado', icon: '❌', tone: '--error' }
        : { c: 'badge-pending', l: '⏳ Em análise', icon: '🕐', tone: '--warning' })
      : { c: 'badge-pending', l: 'Pendente', icon: '📤', tone: '--muted' };

    const showReason = doc?.status === 'rejected' && doc?.reviewNote;
    const needsUpload = !doc || doc.status === 'rejected';

    return `<div style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;${doc?.status === 'rejected' ? 'background:#fef2f2;border-color:#fecaca' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:18px">${statusInfo.icon}</span>
            <strong style="font-size:14px">${esc(dt.name)}</strong>
            ${req.required ? '<span style="color:var(--error);font-size:11px;font-weight:500">obrigatório</span>' : '<span style="color:var(--muted);font-size:11px">opcional</span>'}
            <span class="badge ${statusInfo.c}">${statusInfo.l}</span>
          </div>
          ${req.helpText ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(req.helpText)}</div>` : ''}
          ${doc ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">📄 ${esc(doc.fileName)} · ${fmtBytes(doc.sizeBytes)}</div>` : ''}
          ${showReason ? `<div style="margin-top:8px;padding:8px 10px;background:#fff;border-left:3px solid var(--error);border-radius:4px;font-size:12px;color:#991b1b"><strong>Motivo da rejeição:</strong> ${esc(doc.reviewNote)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${needsUpload ? `<label class="btn btn-sm" style="cursor:pointer;background:${doc?.status === 'rejected' ? '#dc2626' : 'var(--primary)'};color:#fff">
            ${doc?.status === 'rejected' ? '🔄 Reenviar' : '📤 Enviar'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,application/pdf,.heic,.heif" style="display:none" data-type="${esc(dt.code)}" onchange="_cpHandleFileInput(this)">
          </label>` : ''}
          ${doc && doc.status !== 'approved' ? `<button class="btn btn-sm" onclick="_cpDeleteDoc(${doc.id})" style="background:#fef2f2;color:var(--error);border:1px solid #fecaca">Remover</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderDocItem(doc) {
    const badgeClass = doc.status === 'approved' ? 'badge-approved' : doc.status === 'rejected' ? 'badge-rejected' : 'badge-pending';
    const badgeLabel = doc.status === 'approved' ? 'APROVADO' : doc.status === 'rejected' ? 'REJEITADO' : 'EM ANÁLISE';
    const icon = doc.mimeType?.startsWith('image/') ? '🖼️' : '📄';
    return `<div class="doc-item">
      <span class="icon">${icon}</span>
      <div class="info">
        <div class="name">${esc(doc.label || doc.fileName)}</div>
        <div class="meta">${esc(doc.fileName)} · ${fmtBytes(doc.sizeBytes)} · <span class="badge ${badgeClass}">${badgeLabel}</span>${doc.reviewNote ? ` · "${esc(doc.reviewNote)}"` : ''}</div>
      </div>
      ${doc.status !== 'approved' ? `<button class="btn btn-sm" onclick="_cpDeleteDoc(${doc.id})" style="background:#fef2f2;color:var(--error);border:1px solid #fecaca">Remover</button>` : ''}
    </div>`;
  }

  function getStatusBadge(s) {
    const map = {
      pending: { c: 'badge-pending', l: 'AGUARDANDO PAGAMENTO' },
      submitted: { c: 'badge-approved', l: 'INSCRIÇÃO ENVIADA' },
      paid: { c: 'badge-approved', l: 'PAGO' },
      docs_uploaded: { c: 'badge-pending', l: 'DOCUMENTOS ENVIADOS' },
      docs_approved: { c: 'badge-approved', l: 'DOCS APROVADOS' },
      approved: { c: 'badge-approved', l: 'APROVADO' },
      rejected: { c: 'badge-rejected', l: 'REJEITADO' },
      enrolled: { c: 'badge-approved', l: 'MATRICULADO' },
      cancelled: { c: 'badge-rejected', l: 'CANCELADO' },
      expired: { c: 'badge-rejected', l: 'EXPIRADO' },
    };
    const m = map[s] || { c: 'badge-pending', l: s?.toUpperCase() || '-' };
    return `<span class="badge ${m.c}">${m.l}</span>`;
  }
  function getPaymentBadge(s) {
    const map = {
      pending:    { c: 'badge-pending',  l: 'AGUARDANDO' },
      paid:       { c: 'badge-approved', l: 'PAGO' },
      overdue:    { c: 'badge-rejected', l: 'VENCIDO' },
      expired:    { c: 'badge-rejected', l: 'EXPIRADO' },
      failed:     { c: 'badge-rejected', l: 'FALHOU' },
      refunded:   { c: 'badge-rejected', l: 'REEMBOLSADO' },
      cancelled:  { c: 'badge-rejected', l: 'CANCELADO' },
      received:   { c: 'badge-pending',  l: 'RECEBIDO' },
      processing: { c: 'badge-pending',  l: 'PROCESSANDO' },
    };
    const m = map[s] || { c: 'badge-pending', l: s?.toUpperCase() || '-' };
    return `<span class="badge ${m.c}">💳 ${m.l}</span>`;
  }

  function attachHandlers() {
    // Modo fallback (upload livre): input #doc-input com label
    const input = document.getElementById('doc-input');
    const label = document.getElementById('doc-upload-label');
    if (input) input.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      label.innerHTML = '<div class="loading"></div> Enviando...';
      try {
        await uploadFile(f, 'other');
        loadDashboard();
      } catch (e) { alert('Erro ao enviar'); loadDashboard(); }
    });
  }

  async function uploadFile(file, typeCode) {
    const fd = new FormData();
    // ORDEM IMPORTA: fastify-multipart só popula `file.fields` com campos
    // recebidos ANTES do arquivo. Por isso `type` e `label` vão primeiro.
    fd.append('type', typeCode || 'other');
    fd.append('label', file.name.replace(/\.[^.]+$/, ''));
    fd.append('file', file);
    const r = await fetch(`${API}/candidate/documents`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: fd,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  // Handler usado pelos inputs da checklist (1 por tipo esperado)
  window._cpHandleFileInput = async function(inputEl) {
    const f = inputEl.files?.[0]; if (!f) return;
    const typeCode = inputEl.getAttribute('data-type') || 'other';
    const labelEl = inputEl.closest('label');
    const originalHTML = labelEl?.innerHTML;
    if (labelEl) labelEl.innerHTML = '<div class="loading"></div> Enviando...';
    try {
      await uploadFile(f, typeCode);
      loadDashboard();
    } catch (e) {
      alert('Erro ao enviar');
      if (labelEl && originalHTML) labelEl.innerHTML = originalHTML;
    }
  };

  // ═══════════════════════════════════════════════════════
  // Checkout transparente — PIX (Fase 3)
  // ═══════════════════════════════════════════════════════
  // Renderiza dentro do dashboard quando portal.paymentMode === 'transparent'.
  // Modo 'link' antigo continua funcionando (link/redirect).
  //
  // Estados:
  //   1. Nada: candidato escolhe método → POST /payment-init
  //   2. Método ativo (pending): mostra QR/linha/cartão e pollar status
  //   3. paid: mostra confirmação (handlado no topo de renderPaymentSection)

  let _paymentPollTimer = null
  let _paymentCountdownTimer = null

  function stopPaymentPolling() {
    if (_paymentPollTimer) { clearTimeout(_paymentPollTimer); _paymentPollTimer = null; }
    if (_paymentCountdownTimer) { clearInterval(_paymentCountdownTimer); _paymentCountdownTimer = null; }
  }

  function renderPaymentSection(d) {
    stopPaymentPolling()
    const en = d.enrollment
    const portal = d.portal || {}
    const methods = d.paymentMethods || []
    const requirePayment = !!portal.requirePayment

    if (!requirePayment) return ''

    // Paid: mostra confirmação e encerra qualquer polling pendente.
    if (en.paymentPaidAt || en.paymentStatus === 'paid') {
      return `
        <div class="card" style="border-left:4px solid var(--success)">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:24px">✅</span>
            <div><strong>Pagamento confirmado</strong>
              <div style="font-size:12px;color:var(--muted)">Em ${fmtDate(en.paymentPaidAt || new Date())}</div>
            </div>
          </div>
        </div>`
    }

    // Modo 'link' antigo: PaymentLink redireciona pra Pagar.me/Asaas.
    if (portal.paymentMode !== 'transparent') {
      if (!en.paymentUrl) return ''
      return `
        <div class="card" style="border-left:4px solid var(--warning)">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:24px">💳</span><strong>Pagamento pendente</strong>
          </div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:10px">
            Valor: <strong style="color:var(--text)">${fmtCurrency(en.paymentAmount)}</strong> — Prazo: ${fmtDate(en.paymentExpiresAt)}
          </div>
          <a href="${esc(en.paymentUrl)}" class="btn btn-primary" style="text-decoration:none;display:inline-block;width:auto">
            Pagar agora →
          </a>
        </div>`
    }

    // Modo transparente — checkout no portal.
    const cardEnabled = portal.paymentConnection?.hasPublicKey
    const lastMethod = methods.find(m => m.status === 'pending') || methods[0] || null
    const activeTab = (lastMethod?.method === 'boleto' || lastMethod?.method === 'credit_card')
      ? lastMethod.method
      : 'pix'  // default

    return `
      <div class="card" style="border-left:4px solid var(--warning)" id="payment-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:24px">💳</span>
            <div>
              <strong>Pagamento da taxa</strong>
              ${en.paymentAmount ? `<div style="font-size:13px;color:var(--muted)">Valor: <strong style="color:var(--text)">${fmtCurrency(en.paymentAmount)}</strong></div>` : ''}
            </div>
          </div>
          <span class="badge badge-pending">Aguardando pagamento</span>
        </div>

        <div style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px;flex-wrap:wrap">
          <button onclick="_cpSwitchMethod('pix')" id="pmtab-pix"
            class="pmtab ${activeTab==='pix'?'active':''}">📱 PIX</button>
          <button onclick="_cpSwitchMethod('boleto')" id="pmtab-boleto"
            class="pmtab ${activeTab==='boleto'?'active':''}">📄 Boleto</button>
          <button ${cardEnabled?'':'disabled'} onclick="_cpSwitchMethod('credit_card')" id="pmtab-credit_card"
            class="pmtab ${activeTab==='credit_card'?'active':''}"
            title="${cardEnabled?'':'Cartão indisponível — peça ao gestor para cadastrar a public key em Pagamentos'}">💳 Cartão</button>
        </div>

        <div id="payment-panel">
          ${renderPaymentMethodPanel(activeTab, lastMethod)}
        </div>

        <style>
          .pmtab { padding:8px 14px;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;font-size:13px;color:var(--muted);transition:all .15s }
          .pmtab:hover:not(:disabled) { color:var(--text) }
          .pmtab.active { color:var(--primary);border-bottom-color:var(--primary);font-weight:600 }
          .pmtab:disabled { opacity:.4;cursor:not-allowed }
          .pix-qr-box { display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;background:#fafbff;border:1px dashed var(--border);border-radius:10px;margin:10px 0 }
          .pix-qr-box img { width:240px;height:240px;max-width:100%;border:1px solid var(--border);border-radius:8px;background:#fff;padding:4px }
          .pix-code-row { display:flex;gap:6px;width:100%;margin-top:8px }
          .pix-code-row input { flex:1;font-family:ui-monospace,monospace;font-size:11px;padding:8px;border:1px solid var(--border);border-radius:6px;background:#fff }
          .pix-code-row button { padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap }
        </style>
      </div>`
  }

  function isMethodAlive(m) {
    if (!m) return false
    if (m.status !== 'pending') return false
    if (!m.expiresAt) return true
    return new Date(m.expiresAt).getTime() > Date.now()
  }

  function renderPaymentMethodPanel(method, lastMethod) {
    if (method === 'pix') {
      const m = (lastMethod?.method === 'pix' && isMethodAlive(lastMethod)) ? lastMethod : null
      if (!m || !m.qrCode) {
        const expiredHint = (lastMethod?.method === 'pix' && lastMethod?.status === 'pending')
          ? '<div style="font-size:12px;color:var(--warning);margin-bottom:10px">⚠ O QR anterior expirou. Gere um novo:</div>' : ''
        return `
          <div style="text-align:center;padding:20px 10px">
            ${expiredHint}
            <div style="font-size:13px;color:var(--muted);margin-bottom:14px">Gere um QR Code PIX para pagar agora. Aprovação imediata.</div>
            <button class="btn btn-primary" onclick="_cpInitPayment('pix')" id="btn-pix-gen">▶ Gerar QR PIX</button>
          </div>`
      }
      return `
        <div class="pix-qr-box">
          ${m.qrCodeUrl ? `<img src="${esc(m.qrCodeUrl)}" alt="QR Code PIX">` : ''}
          <div style="font-size:13px;color:var(--text);text-align:center">
            Abra o app do seu banco e <strong>escaneie o QR</strong> ou cole o código abaixo.
          </div>
          <div class="pix-code-row">
            <input id="pix-code" readonly value="${esc(m.qrCode)}">
            <button onclick="_cpCopyPix()">📋 Copiar</button>
          </div>
          <div style="font-size:12px;color:var(--muted)" id="pix-countdown">
            Aguardando confirmação · expira em ${m.expiresAt ? fmtDate(m.expiresAt) : '—'}
          </div>
        </div>`
    }

    if (method === 'boleto') {
      const m = (lastMethod?.method === 'boleto' && isMethodAlive(lastMethod)) ? lastMethod : null
      if (!m) {
        const expiredHint = (lastMethod?.method === 'boleto' && lastMethod?.status === 'pending')
          ? '<div style="font-size:12px;color:var(--warning);margin-bottom:10px">⚠ O boleto anterior venceu. Gere um novo:</div>' : ''
        return `
          <div style="text-align:center;padding:20px 10px">
            ${expiredHint}
            <div style="font-size:13px;color:var(--muted);margin-bottom:14px">Boleto bancário — compensação em até 3 dias úteis.</div>
            <button class="btn btn-primary" onclick="_cpInitPayment('boleto')" id="btn-boleto-gen">▶ Gerar boleto</button>
          </div>`
      }
      return `
        <div style="padding:16px;background:#fafbff;border:1px dashed var(--border);border-radius:10px">
          ${m.boletoLine ? `
            <div style="margin-bottom:10px">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Linha digitável</div>
              <div class="pix-code-row">
                <input id="boleto-line" readonly value="${esc(m.boletoLine)}">
                <button onclick="_cpCopyBoletoLine()">📋 Copiar</button>
              </div>
            </div>` : '<div style="color:var(--muted);font-size:12px">Linha digitável indisponível — use o PDF abaixo.</div>'}
          ${m.boletoPdfUrl ? `
            <a href="${esc(m.boletoPdfUrl)}" target="_blank" class="btn btn-primary" style="text-decoration:none;display:inline-block;margin-top:8px">⬇ Baixar PDF do boleto</a>` : ''}
          <div style="font-size:12px;color:var(--muted);margin-top:10px">
            Vencimento: ${m.boletoDueAt ? fmtDate(m.boletoDueAt) : '—'}
          </div>
        </div>`
    }

    if (method === 'credit_card') {
      const provider = state.data?.portal?.paymentConnection?.provider
      const hasPk = !!state.data?.portal?.paymentConnection?.hasPublicKey
      if (provider !== 'pagarme') {
        return `
          <div style="text-align:center;padding:24px 10px;color:var(--muted);font-size:13px">
            Pagamento por cartão indisponível para este provedor. Use PIX ou boleto.
          </div>`
      }
      if (!hasPk) {
        return `
          <div style="text-align:center;padding:24px 10px;color:var(--muted);font-size:13px">
            Cartão indisponível — falta a public key da conta Pagar.me. Use PIX ou boleto.
          </div>`
      }
      const m = (lastMethod?.method === 'credit_card') ? lastMethod : null
      if (m?.status === 'pending') {
        return `
          <div style="padding:24px 10px;text-align:center">
            <div class="loading" style="display:inline-block;margin-bottom:10px"></div>
            <div style="font-size:13px;color:var(--text)">Processando cartão final ${esc(m.cardLastDigits || '')}…</div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px">Aguarde confirmação do banco emissor.</div>
          </div>`
      }
      if (m?.status === 'failed') {
        return `
          ${cardFormHtml(true, m.lastErrorMessage)}`
      }
      return cardFormHtml(false, null)
    }

    return ''
  }

  function cardFormHtml(showError, errMsg) {
    return `
      <form id="card-form" onsubmit="return _cpPayCard(event)" style="padding:6px 0">
        ${showError ? `<div class="alert alert-err" style="margin-bottom:12px">${esc(errMsg || 'Cartão recusado. Verifique os dados ou tente outro.')}</div>` : ''}
        <div class="field">
          <label>Número do cartão</label>
          <input id="cc-number" inputmode="numeric" autocomplete="cc-number" maxlength="19" placeholder="1234 5678 9012 3456" required
            oninput="_cpMaskCard(this)" style="font-family:ui-monospace,monospace;letter-spacing:.04em">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="field">
            <label>Validade (MM/AA)</label>
            <input id="cc-exp" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="MM/AA" required
              oninput="_cpMaskExp(this)" style="font-family:ui-monospace,monospace">
          </div>
          <div class="field">
            <label>CVV</label>
            <input id="cc-cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123" required
              oninput="this.value=this.value.replace(/\\D/g,'')" style="font-family:ui-monospace,monospace">
          </div>
        </div>
        <div class="field">
          <label>Nome impresso no cartão</label>
          <input id="cc-name" autocomplete="cc-name" placeholder="Como aparece no cartão" required style="text-transform:uppercase">
        </div>
        <button class="btn btn-primary" type="submit" id="btn-card-pay" style="width:100%;margin-top:6px">▶ Pagar com cartão</button>
        <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:10px;line-height:1.5">
          🔒 Dados do cartão são tokenizados direto no Pagar.me. <strong>Não passamos pelos nossos servidores.</strong>
        </div>
      </form>`
  }

  // ── Handlers globais ───────────────────────────────────────
  let _selectedPaymentMethod = 'pix'

  window._cpSwitchMethod = function(method) {
    _selectedPaymentMethod = method
    document.querySelectorAll('.pmtab').forEach(b => b.classList.toggle('active', b.id === 'pmtab-' + method))
    const panel = document.getElementById('payment-panel')
    if (!panel) return
    const methods = state.data?.paymentMethods || []
    const lastOfThis = methods.find(m => m.method === method) || null
    panel.innerHTML = renderPaymentMethodPanel(method, lastOfThis)
    startPaymentPolling()
  }

  window._cpInitPayment = async function(method) {
    const btn = document.getElementById('btn-' + method + '-gen')
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="loading"></div> Gerando...' }
    try {
      const r = await apiFetch(`/public/registrations/${encodeURIComponent(state.data.enrollment.candidateCode)}/payment-init`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      })
      // Atualiza o array local com o método novo no topo
      if (r.method) {
        state.data.paymentMethods = [r.method, ...(state.data.paymentMethods || [])]
      }
      const panel = document.getElementById('payment-panel')
      if (panel) panel.innerHTML = renderPaymentMethodPanel(method, r.method)
      startPaymentPolling()
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '▶ Tentar novamente' }
      alert((e && e.message) || 'Falha ao gerar cobrança. Tente outro método.')
    }
  }

  window._cpCopyPix = function() {
    const inp = document.getElementById('pix-code')
    if (!inp) return
    inp.select(); inp.setSelectionRange(0, 999)
    try { navigator.clipboard.writeText(inp.value) } catch (_) { document.execCommand('copy') }
    const btn = inp.nextElementSibling
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copiado!'; setTimeout(() => { btn.textContent = orig }, 1800) }
  }

  // ── Cartão: máscaras + tokenização Pagar.me direto do browser (PCI SAQ A) ──
  window._cpMaskCard = function(el) {
    let v = el.value.replace(/\D/g, '').slice(0, 19)
    v = v.replace(/(\d{4})(?=\d)/g, '$1 ')
    el.value = v
  }
  window._cpMaskExp = function(el) {
    let v = el.value.replace(/\D/g, '').slice(0, 4)
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2)
    el.value = v
  }

  // Tokeniza cartão diretamente na API do Pagar.me usando a public key cadastrada
  // no PaymentProviderConnection. PAN nunca passa pelo nosso backend.
  async function tokenizeCardPagarme(publicKey, card) {
    const url = `https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'card',
        card: {
          number: card.number.replace(/\s/g, ''),
          holder_name: card.holderName,
          exp_month: Number(card.expMonth),
          exp_year: Number(card.expYear),
          cvv: card.cvv,
        },
      }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = data?.message
        || (Array.isArray(data?.errors) && data.errors[0]?.message)
        || (data?.errors && typeof data.errors === 'object'
            ? Object.entries(data.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
            : `HTTP ${r.status}`)
      throw new Error(detail)
    }
    return data.id   // ex: "token_..."
  }

  window._cpPayCard = async function(ev) {
    ev.preventDefault()
    const number = document.getElementById('cc-number')?.value?.trim() || ''
    const exp = document.getElementById('cc-exp')?.value?.trim() || ''
    const cvv = document.getElementById('cc-cvv')?.value?.trim() || ''
    const name = document.getElementById('cc-name')?.value?.trim() || ''
    const btn = document.getElementById('btn-card-pay')

    if (!number || !exp.includes('/') || !cvv || !name) {
      alert('Preencha todos os campos do cartão.')
      return false
    }
    const [mm, aa] = exp.split('/')
    if (!mm || !aa || mm.length < 1 || aa.length < 2) {
      alert('Validade inválida. Use MM/AA.')
      return false
    }
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="loading"></div> Tokenizando...' }

    try {
      const code = state.data.enrollment.candidateCode
      const pkResp = await apiFetch(`/public/registrations/${encodeURIComponent(code)}/payment-public-key`)
      if (!pkResp?.publicKey) throw new Error('Public key indisponível — configure em Pagamentos.')

      const cardToken = await tokenizeCardPagarme(pkResp.publicKey, {
        number,
        holderName: name,
        expMonth: mm,
        expYear: aa.length === 2 ? '20' + aa : aa,
        cvv,
      })

      if (btn) btn.innerHTML = '<div class="loading"></div> Cobrando...'

      const r = await apiFetch(`/public/registrations/${encodeURIComponent(code)}/payment-init`, {
        method: 'POST',
        body: JSON.stringify({ method: 'credit_card', cardToken }),
      })
      if (r.method) {
        state.data.paymentMethods = [r.method, ...(state.data.paymentMethods || [])]
        const panel = document.getElementById('payment-panel')
        if (panel) panel.innerHTML = renderPaymentMethodPanel('credit_card', r.method)
      }
      startPaymentPolling()
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '▶ Tentar novamente' }
      alert((e && e.message) || 'Falha ao processar cartão. Tente novamente ou use PIX.')
    }
    return false
  }

  window._cpCopyBoletoLine = function() {
    const inp = document.getElementById('boleto-line')
    if (!inp) return
    inp.select(); inp.setSelectionRange(0, 999)
    try { navigator.clipboard.writeText(inp.value) } catch (_) { document.execCommand('copy') }
    const btn = inp.nextElementSibling
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copiado!'; setTimeout(() => { btn.textContent = orig }, 1800) }
  }

  // Polling do status — 5s enquanto pending; reload do dashboard quando pago.
  function startPaymentPolling() {
    stopPaymentPolling()
    const code = state.data?.enrollment?.candidateCode
    if (!code) return
    const poll = async () => {
      try {
        const r = await apiFetch(`/public/registrations/${encodeURIComponent(code)}/payment-status`)
        if (r.paymentStatus === 'paid') {
          // Recarrega o dashboard inteiro pra refletir paymentPaidAt + timeline.
          loadDashboard()
          return
        }
        // Atualiza só o array de métodos sem rerender total (preserva o QR visível)
        if (Array.isArray(r.methods)) state.data.paymentMethods = r.methods
      } catch (_) { /* silencia — tenta de novo */ }
      _paymentPollTimer = setTimeout(poll, 5000)
    }
    _paymentPollTimer = setTimeout(poll, 5000)
  }

  window._cpLogout = function() { sessionStorage.removeItem(TOKEN_KEY); state.token = ''; renderLogin(); };
  window._cpReceipt = function() {
    // Abre em nova aba com token no header via fetch + blob
    fetch(`${API}/candidate/receipt.pdf`, { headers: { 'Authorization': `Bearer ${state.token}` } })
      .then(r => r.ok ? r.text() : Promise.reject('fail'))
      .then(html => { const w = window.open(); if (w) { w.document.open(); w.document.write(html); w.document.close(); } })
      .catch(() => alert('Erro ao gerar comprovante'));
  };
  window._cpDeleteDoc = async function(id) {
    if (!confirm('Remover este documento?')) return;
    try { await apiFetch(`/candidate/documents/${id}`, { method: 'DELETE' }); loadDashboard(); }
    catch (e) { alert(e.message); }
  };

  // Bootstrap
  if (state.token) loadDashboard(); else renderLogin();
})();
