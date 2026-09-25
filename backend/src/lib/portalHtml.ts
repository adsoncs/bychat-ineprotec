// src/lib/portalHtml.ts
// Casca HTML das telas de acesso do portal público. Server-side e sem JS: quem
// abre isso costuma estar no celular, em rede ruim, no meio de uma inscrição.
// A fase 2 substitui as telas internas por uma aplicação; o acesso continua
// aqui, porque login precisa funcionar mesmo quando o resto não carrega.

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const CSS = `
:root{--fg:#12211f;--fg2:#5a6764;--line:#dde3e0;--bg:#f5f7f5;--card:#fff;--ac:#0e5a54;--err:#9c3a31;--ok:#2e7d4f}
@media (prefers-color-scheme:dark){:root{--fg:#e9eeeb;--fg2:#a3b0ac;--line:#2a3835;--bg:#0f1513;--card:#161f1d;--ac:#5cc3b6;--err:#e28a81;--ok:#6cc28d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
     display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.wrap{width:100%;max-width:400px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 24px}
h1{font-size:21px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--fg2);font-size:14.5px;margin:0 0 18px}
label{display:block;font-size:13.5px;font-weight:600;margin:14px 0 5px}
input{width:100%;padding:11px 12px;font-size:16px;color:var(--fg);background:var(--card);
      border:1px solid var(--line);border-radius:9px}
input:focus{outline:2px solid var(--ac);outline-offset:1px;border-color:var(--ac)}
button{width:100%;margin-top:18px;padding:12px;font:inherit;font-weight:600;color:#fff;background:var(--ac);
       border:0;border-radius:9px;cursor:pointer}
button:hover{filter:brightness(1.08)}
button.sec{color:var(--ac);background:transparent;border:1px solid var(--line);margin-top:10px}
.msg{padding:10px 12px;border-radius:9px;font-size:14px;margin-bottom:16px;border:1px solid}
.msg.err{color:var(--err);border-color:var(--err);background:transparent}
.msg.ok{color:var(--ok);border-color:var(--ok);background:transparent}
.sep{margin:20px 0 0;padding-top:16px;border-top:1px solid var(--line)}
.dica{color:var(--fg2);font-size:13px;margin:8px 0 0}
a{color:var(--ac)}
.item{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14.5px}
.item:last-child{border-bottom:0}
.item b{font-weight:600}
.tag{font-size:12px;font-weight:600;color:var(--fg2)}
`

export function pagina(titulo: string, conteudo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title><style>${CSS}</style></head>
<body><div class="wrap">${conteudo}</div></body></html>`
}

export function avisos(erro?: string, aviso?: string): string {
  return [
    erro ? `<div class="msg err">${esc(erro)}</div>` : '',
    aviso ? `<div class="msg ok">${esc(aviso)}</div>` : '',
  ].join('')
}
