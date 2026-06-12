// src/services/formRenderer.ts
// Renderer de MODO EDIÇÃO para o builder visual de Formulários.
//
// Diferente dos renderers PÚBLICOS em routes/forms.ts (conversacional em /f/:slug
// e o Web Component clássico), que montam a UI client-side, este renderer emite
// um documento HTML com TODOS os campos EMPILHADOS como DOM real e selecionável —
// é o "canvas SSR" que o editor carrega num <iframe> (espelha pageRenderer.ts da
// landing). Quando `edit` é true, cada bloco é envolvido em [data-form-field-id]
// e injetamos um script que faz clique→postMessage('forms-canvas') ao parent.
//
// A aparência reaproveita os mesmos tokens/HTML do embed clássico, então o canvas
// bate visualmente com o formulário publicado no modo clássico.

import { sanitizeBlockHtml } from '../routes/forms.js'

export interface FormCanvasInput {
  id: number
  name: string
  fields: any[]
  settings: any
  styling: any // já mesclado com getDefaultFormStyling() pelo chamador
  baseUrl: string
}
export interface FormCanvasOptions {
  edit?: boolean
}

// Sentinelas dos pseudo-blocos (telas que não são campo).
export const FORM_WELCOME_ID = '__welcome__'
export const FORM_SUCCESS_ID = '__success__'

function esc(s: any): string {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Sanitiza valor que entra no <style> (sem fechar a tag nem injetar JS).
function cssVal(input: any, fallback: string): string {
  const v = typeof input === 'string' ? input.trim() : ''
  if (!v) return fallback
  if (/<\/style|<script|expression\s*\(|javascript:/i.test(v)) return fallback
  return v
}

// ── Instrumentação de edição (só quando options.edit) ──
const FORM_EDIT_CSS = `
.bf-edit-wrap{position:relative;cursor:pointer;outline:1px dashed transparent;outline-offset:2px;border-radius:8px;transition:outline-color .12s ease}
.bf-edit-wrap:hover{outline-color:rgba(37,99,235,.55)}
.bf-edit-wrap.bf-sel{outline:2px solid #2563eb;outline-offset:2px}
.bf-edit-wrap.bf-sel::before{content:attr(data-form-label);position:absolute;top:-9px;left:8px;z-index:99999;background:#2563eb;color:#fff;font:600 10px/1.4 system-ui,sans-serif;padding:2px 7px;border-radius:5px;pointer-events:none;text-transform:capitalize;letter-spacing:.02em;white-space:nowrap}
.bf-edit-wrap *{pointer-events:none}
.bf-disabled{opacity:.5}
.bf-hidden-chip{font-size:12px;color:#9aa0a6;border:1px dashed #cbd5e1;border-radius:8px;padding:9px 12px;background:#f8fafc}
.bf-sched-mock{border:1px dashed var(--field-border);border-radius:10px;padding:12px}
.bf-sched-days{display:flex;gap:10px;overflow-x:auto}
.bf-sched-day{min-width:104px}
.bf-sched-dh{font-size:11px;color:var(--label-color);opacity:.7;margin-bottom:6px;text-transform:capitalize}
.bf-sched-slot{display:block;width:100%;margin-bottom:6px;padding:7px;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:8px;font-size:12px}
`

const FORM_EDIT_SCRIPT = `<script>(function(){
  function find(id){var a=document.querySelectorAll('[data-form-field-id]');for(var i=0;i<a.length;i++){if(a[i].getAttribute('data-form-field-id')===id)return a[i];}return null;}
  function clear(){var a=document.querySelectorAll('.bf-edit-wrap.bf-sel');for(var i=0;i<a.length;i++)a[i].classList.remove('bf-sel');}
  function select(id,scroll){clear();var el=find(id);if(el){el.classList.add('bf-sel');if(scroll)el.scrollIntoView({behavior:'smooth',block:'center'});}}
  // Aviso de pré-visualização: o botão de envio no canvas é inerte de propósito
  // (este é o editor de layout). Sem feedback, parece que o form "não envia" —
  // então mostramos um toast deixando claro que o envio só ocorre no publicado.
  function notice(msg){var n=document.getElementById('bf-prev-note');if(!n){n=document.createElement('div');n.id='bf-prev-note';n.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;background:#1e293b;color:#fff;font:600 12px/1.45 system-ui,-apple-system,sans-serif;padding:10px 16px;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.28);max-width:92%;text-align:center;opacity:0;transition:opacity .2s';document.body.appendChild(n);}n.textContent=msg;n.style.opacity='1';clearTimeout(n._t);n._t=setTimeout(function(){n.style.opacity='0';},2800);}
  document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;if(t.closest('.bf-btn')){e.preventDefault();e.stopPropagation();notice('Pré-visualização — o envio só funciona no formulário publicado.');return;}var w=t.closest('[data-form-field-id]');if(!w)return;e.preventDefault();e.stopPropagation();var id=w.getAttribute('data-form-field-id');select(id,false);parent.postMessage({source:'forms-canvas',type:'select',id:id},'*');},true);
  document.addEventListener('submit',function(e){e.preventDefault();notice('Pré-visualização — o envio só funciona no formulário publicado.');},true);
  window.addEventListener('message',function(e){var d=e.data||{};if(d.type==='forms-highlight'&&d.id){select(d.id,!!d.scroll);}});
  parent.postMessage({source:'forms-canvas',type:'ready'},'*');
})();</script>`

// Resolve cada token com fallback no default (igual generateEmbedScript).
function resolveTokens(styling: any) {
  const s = styling ?? {}
  const g = (k: string, fb: string) => cssVal(s[k], fb)
  const primary = g('primaryColor', '#1a73e8')
  return {
    primary,
    primaryHover: g('primaryHoverColor', '#1557b0'),
    buttonText: g('buttonTextColor', '#ffffff'),
    background: g('backgroundColor', 'transparent'),
    labelColor: g('labelColor', '#202124'),
    labelSize: g('labelSize', '13px'),
    labelWeight: g('labelWeight', '600'),
    fieldBg: g('fieldBgColor', '#ffffff'),
    fieldBorder: g('fieldBorderColor', '#dadce0'),
    fieldText: g('fieldTextColor', '#202124'),
    fieldPlaceholder: g('fieldPlaceholderColor', '#9aa0a6'),
    fieldFontSize: g('fieldFontSize', '14px'),
    fieldPadding: g('fieldPadding', '11px 14px'),
    radius: g('borderRadius', '8px'),
    buttonRadius: g('buttonRadius', '8px'),
    buttonPadding: g('buttonPadding', '13px'),
    buttonFontSize: g('buttonFontSize', '15px'),
    buttonFontWeight: g('buttonFontWeight', '600'),
    fontFamily: g('fontFamily', "'Inter', system-ui, sans-serif"),
    fontSize: g('fontSize', '14px'),
    maxWidth: g('maxWidth', '480px'),
    fieldSpacing: g('fieldSpacing', '16px'),
    successTitleColor: g('successTitleColor', '#34a853'),
    successTextColor: g('successTextColor', '#5f6368'),
    successTitleSize: g('successTitleSize', '20px'),
    errorBorder: g('errorBorderColor', '#c5221f'),
  }
}

function buildCss(v: ReturnType<typeof resolveTokens>): string {
  const focusRing = /^#([0-9a-f]{6})$/i.test(v.primary) ? `${v.primary}22` : v.primary
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--accent:${v.primary};--accent-hover:${v.primaryHover};--btn-text:${v.buttonText};--label-color:${v.labelColor};--field-bg:${v.fieldBg};--field-border:${v.fieldBorder};--field-text:${v.fieldText};--radius:${v.radius}}
html,body{min-height:100%}
body{font-family:${v.fontFamily};color:${v.labelColor};line-height:1.5;font-size:${v.fontSize};background:#f1f5f9;padding:28px 16px}
.bf-wrap{max-width:${v.maxWidth};margin:0 auto;background:${v.background === 'transparent' ? '#ffffff' : v.background};padding:28px 24px;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.08),0 8px 24px -16px rgba(15,23,42,.25)}
.bf-field{margin-bottom:${v.fieldSpacing}}
.bf-statement{margin-bottom:${v.fieldSpacing};text-align:center}
.bf-st-ico{font-size:40px;line-height:1;margin-bottom:8px}
.bf-st-img{max-width:100%;max-height:200px;border-radius:10px;margin:0 0 10px;display:inline-block}
.bf-st-h{font-size:18px;font-weight:700;color:${v.labelColor};margin-bottom:4px}
.bf-st-p{font-size:14px;color:${v.fieldPlaceholder}}
.bf-st-html{font-size:14px;color:${v.labelColor};text-align:left;margin-top:6px}
.bf-field label{display:block;font-size:${v.labelSize};font-weight:${v.labelWeight};margin-bottom:6px;color:${v.labelColor}}
.bf-field input,.bf-field select,.bf-field textarea{width:100%;padding:${v.fieldPadding};border:1px solid ${v.fieldBorder};border-radius:${v.radius};font-size:${v.fieldFontSize};font-family:inherit;color:${v.fieldText};background:${v.fieldBg};transition:border-color .2s,box-shadow .2s;outline:none}
.bf-field input::placeholder,.bf-field textarea::placeholder{color:${v.fieldPlaceholder}}
.bf-field input:focus,.bf-field select:focus,.bf-field textarea:focus{border-color:${v.primary};box-shadow:0 0 0 3px ${focusRing}}
.bf-field textarea{min-height:80px;resize:vertical}
.bf-btn{display:block;width:100%;padding:${v.buttonPadding};background:${v.primary};color:${v.buttonText};border:none;border-radius:${v.buttonRadius};font-size:${v.buttonFontSize};font-weight:${v.buttonFontWeight};cursor:pointer;font-family:inherit}
.bf-btn:hover{background:${v.primaryHover}}
.bf-welcome{text-align:center;margin-bottom:${v.fieldSpacing};padding-bottom:18px;border-bottom:1px dashed ${v.fieldBorder}}
.bf-welcome-title{font-size:22px;font-weight:700;color:${v.labelColor};margin-bottom:6px}
.bf-welcome-text{font-size:14px;color:${v.fieldPlaceholder};margin-bottom:14px}
.bf-btn-inline{display:inline-block;width:auto;padding:11px 26px}
.bf-success{text-align:center;padding:22px 8px;margin-top:${v.fieldSpacing};border-top:1px dashed ${v.fieldBorder}}
.bf-success-ico{font-size:42px;color:${v.successTitleColor};margin-bottom:6px}
.bf-success h3{font-size:${v.successTitleSize};font-weight:700;color:${v.successTitleColor};margin-bottom:6px}
.bf-success p{font-size:${v.fontSize};color:${v.successTextColor}}
`
}

// ── HTML de cada campo (espelha generateEmbedScript) ──
function renderFieldInner(f: any, v: ReturnType<typeof resolveTokens>, edit: boolean): string {
  const req = f.required ? ' *' : ''
  const id = `bf-${esc(f.key)}`
  if (f.type === 'statement') {
    const align = f.align === 'left' || f.align === 'right' ? f.align : 'center'
    return `<div class="bf-statement" style="text-align:${align}">${f.icon ? `<div class="bf-st-ico">${esc(f.icon)}</div>` : ''}${f.imageUrl ? `<img class="bf-st-img" src="${esc(f.imageUrl)}" alt="">` : ''}${f.label ? `<div class="bf-st-h">${sanitizeBlockHtml(f.label)}</div>` : ''}${f.helpText ? `<div class="bf-st-p">${sanitizeBlockHtml(f.helpText)}</div>` : ''}${f.html ? `<div class="bf-st-html">${sanitizeBlockHtml(f.html)}</div>` : ''}</div>`
  }
  if (f.type === 'scheduling') {
    // Placeholder estático — NUNCA busca slots reais no canvas.
    const days = ['Seg 12', 'Ter 13', 'Qua 14']
    const slots = ['09:00', '10:30', '14:00']
    return `<div class="bf-field"><label>${esc(f.label || 'Escolha um horário')}</label><div class="bf-sched-mock"><div class="bf-sched-days">${days.map((d) => `<div class="bf-sched-day"><div class="bf-sched-dh">${d}</div>${slots.map((sl) => `<span class="bf-sched-slot">${sl}</span>`).join('')}</div>`).join('')}</div></div></div>`
  }
  if (f.type === 'hidden') {
    if (edit) return `<div class="bf-hidden-chip">Campo oculto · <strong>${esc(f.key)}</strong>${f.defaultValue ? ` = ${esc(f.defaultValue)}` : ''}</div>`
    return `<input type="hidden" name="${esc(f.key)}" value="${esc(f.defaultValue || '')}">`
  }
  if (f.type === 'select') {
    return `<div class="bf-field"><label for="${id}">${esc(f.label)}${req}</label><select id="${id}" name="${esc(f.key)}"><option value="">${esc(f.placeholder || 'Selecione...')}</option>${(f.options || []).map((o: any) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></div>`
  }
  if (f.type === 'textarea') {
    return `<div class="bf-field"><label for="${id}">${esc(f.label)}${req}</label><textarea id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"></textarea></div>`
  }
  const inputType = f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'
  return `<div class="bf-field"><label for="${id}">${esc(f.label)}${req}</label><input type="${inputType}" id="${id}" name="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"></div>`
}

function wrap(id: string, type: string, label: string, html: string, edit: boolean): string {
  if (!edit) return html
  return `<div data-form-field-id="${esc(id)}" data-form-field-type="${esc(type)}" data-form-label="${esc(label)}" class="bf-edit-wrap">${html}</div>`
}

export function renderFormCanvas(input: FormCanvasInput, options: FormCanvasOptions = {}): string {
  const edit = options.edit === true
  const v = resolveTokens(input.styling)
  const settings = input.settings || {}
  const cv = settings.conversational || {}
  const fields: any[] = Array.isArray(input.fields) ? input.fields : []

  // Bloco Boas-vindas (no editor sempre aparece; esmaecido se desabilitado).
  const welcomeEnabled = !!cv.welcomeEnabled
  const welcomeInner = `<div class="bf-welcome${edit && !welcomeEnabled ? ' bf-disabled' : ''}">${cv.welcomeIcon ? `<div class="bf-st-ico">${esc(cv.welcomeIcon)}</div>` : ''}${cv.welcomeImageUrl ? `<img class="bf-st-img" src="${esc(cv.welcomeImageUrl)}" alt="">` : ''}<div class="bf-welcome-title">${esc(cv.welcomeTitle || input.name)}</div>${cv.welcomeText ? `<div class="bf-welcome-text">${esc(cv.welcomeText)}</div>` : ''}<div><button type="button" class="bf-btn bf-btn-inline">${esc(cv.startButtonText || 'Começar')}</button></div></div>`
  const welcomeBlock = (edit || welcomeEnabled)
    ? wrap(FORM_WELCOME_ID, 'welcome', 'Boas-vindas', welcomeInner, edit)
    : ''

  // Campos.
  const fieldsHtml = fields.map((f) => {
    const label = f.type === 'statement' ? 'Conteúdo' : (f.type === 'scheduling' ? 'Agendamento' : (f.label || f.type))
    return wrap(String(f.id), f.type, label, renderFieldInner(f, v, edit), edit)
  }).join('\n      ')

  // Botão de envio (não selecionável).
  const submitBtn = `<button type="button" class="bf-btn">${esc(settings.submitText || 'Enviar')}</button>`

  // Bloco Sucesso.
  const successHtmlClean = sanitizeBlockHtml(settings.successHtml)
  const successInner = `<div class="bf-success">${successHtmlClean ? `<div class="bf-success-html">${successHtmlClean}</div>` : `<div class="bf-success-ico">✓</div><h3>${esc(settings.successTitle || 'Enviado!')}</h3><p>${esc(settings.successMessage || 'Entraremos em contato em breve.')}</p>`}</div>`
  const successBlock = wrap(FORM_SUCCESS_ID, 'success', 'Tela de sucesso', successInner, edit)

  return `<!doctype html>
<html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(input.name)}</title>
<style>${buildCss(v)}${edit ? FORM_EDIT_CSS : ''}</style>
</head>
<body>
  <div class="bf-wrap">
    ${welcomeBlock}
    <form id="bf" novalidate>
      ${fieldsHtml || (edit ? '<div class="bf-hidden-chip">Nenhum campo ainda. Use “Adicionar campo”.</div>' : '')}
      ${submitBtn}
    </form>
    ${successBlock}
  </div>
  ${edit ? FORM_EDIT_SCRIPT : ''}
</body>
</html>`
}
