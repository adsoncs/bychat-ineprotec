// src/lib/portalHtml.ts
// Casca HTML das telas de acesso do portal público. Server-side e sem JS: quem
// abre isso costuma estar no celular, em rede ruim, no meio de uma inscrição.
// A fase 2 substitui as telas internas por uma aplicação; o acesso continua
// aqui, porque login precisa funcionar mesmo quando o resto não carrega.

import type { MarcaDoAcesso } from './portalMarca.js'

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const CSS_CLARO = `:root{--fg:#12211f;--fg2:#5a6764;--line:#dde3e0;--bg:#f5f7f5;--card:#fff;--ac:#0e5a54;--ac-fg:#fff;--ac2:var(--ac);--err:#9c3a31;--ok:#2e7d4f}`
const CSS_ESCURO = `@media (prefers-color-scheme:dark){:root{--fg:#e9eeeb;--fg2:#a3b0ac;--line:#2a3835;--bg:#0f1513;--card:#161f1d;--ac:#5cc3b6;--err:#e28a81;--ok:#6cc28d}}`
const CSS = `
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
button{width:100%;margin-top:18px;padding:12px;font:inherit;font-weight:600;color:var(--ac-fg);background:var(--ac);
       border:0;border-radius:9px;cursor:pointer}
button:hover{filter:brightness(1.08)}
button.sec{color:var(--ac2);background:transparent;border:1px solid var(--line);margin-top:10px}
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

const hex = (c: string | null | undefined): string | null => (c && /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : null)

/** Texto legível sobre a cor (preto ou branco), pela luminância relativa. */
function contraste(c: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.45 ? '#16211f' : '#ffffff'
}

// Os mesmos valores do portal (portal-app/src/App.tsx), para a tela de acesso
// não destoar das páginas de onde a pessoa veio.
const FONTES: Record<string, { familia: string; href?: string }> = {
  inter: { familia: "'Inter', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap' },
  roboto: { familia: "'Roboto', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap' },
  poppins: { familia: "'Poppins', system-ui, sans-serif", href: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap' },
  system: { familia: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
}
const RAIOS: Record<string, { cartao: string; campo: string }> = {
  sharp: { cartao: '2px', campo: '2px' },
  medium: { cartao: '12px', campo: '9px' },
  rounded: { cartao: '20px', campo: '14px' },
}

/**
 * Marca do portal (Branding) aplicada à tela de acesso: cor principal e de
 * apoio, fonte, arredondamento, fundo em degradê, formato do botão e logo.
 * Com marca, a tela fica no tema claro — como o próprio portal, que não tem
 * modo escuro; o azul-marinho da instituição sobre fundo escuro sumiria.
 */
function estiloDaMarca(m: MarcaDoAcesso): { head: string; css: string; topo: string } {
  const cor = hex(m.corPrincipal)
  const apoio = hex(m.corApoio) ?? cor
  const fonte = FONTES[String(m.fonte ?? '')]
  const raio = RAIOS[String(m.raio ?? '')]
  const regras: string[] = []
  const vars: string[] = []
  if (cor) vars.push(`--ac:${cor}`, `--ac-fg:${contraste(cor)}`)
  if (apoio) vars.push(`--ac2:${apoio}`)
  if (vars.length) regras.push(`:root{${vars.join(';')}}`)
  if (fonte) regras.push(`body,input,button{font-family:${fonte.familia}}`)
  if (raio) regras.push(`.card{border-radius:${raio.cartao}}input,button{border-radius:${raio.campo}}`)
  if (m.botaoFormato === 'pill') regras.push('button{border-radius:999px}')
  if (m.botaoCaixaAlta) regras.push('button:not(.sec){text-transform:uppercase;letter-spacing:.06em;font-size:14.5px}')
  const de = hex(m.fundoDe)
  const para = hex(m.fundoPara)
  if (de && para) regras.push(`body{background:linear-gradient(120deg,${de} 0%,var(--bg) 45%,${para} 100%);background-attachment:fixed}`)
  regras.push('.marca{text-align:center;margin:0 0 18px}.marca img{max-height:56px;max-width:220px;width:auto;height:auto}.marca .nome{font-weight:650;font-size:16px;color:var(--fg)}')

  const head = [
    fonte?.href ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${esc(fonte.href)}" rel="stylesheet">` : '',
    m.faviconUrl ? `<link rel="icon" href="${esc(m.faviconUrl)}">` : '',
  ].join('')
  const img = m.logoUrl ? `<img src="${esc(m.logoUrl)}" alt="${esc(m.nome)}">` : `<span class="nome">${esc(m.nome)}</span>`
  const topo = `<div class="marca">${m.logoUrl && m.logoLink ? `<a href="${esc(m.logoLink)}">${img}</a>` : img}</div>`
  return { head, css: regras.join('\n'), topo }
}

export function pagina(titulo: string, conteudo: string, marca?: MarcaDoAcesso | null): string {
  const m = marca ? estiloDaMarca(marca) : null
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}${marca ? ` · ${esc(marca.nome)}` : ''}</title>${m?.head ?? ''}<style>${CSS_CLARO}${m ? '' : CSS_ESCURO}${CSS}${m?.css ?? ''}</style></head>
<body><div class="wrap">${m?.topo ?? ''}${conteudo}</div></body></html>`
}

export function avisos(erro?: string, aviso?: string): string {
  return [
    erro ? `<div class="msg err">${esc(erro)}</div>` : '',
    aviso ? `<div class="msg ok">${esc(aviso)}</div>` : '',
  ].join('')
}
