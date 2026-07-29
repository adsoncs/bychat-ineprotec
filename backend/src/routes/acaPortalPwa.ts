// src/routes/acaPortalPwa.ts
//
// Envelope PWA do portal acadêmico: instalável na tela inicial e utilizável
// quando a rede falha.
//
// DECISÃO DE SEGURANÇA — o service worker NÃO cacheia página autenticada.
// O portal identifica o titular por token na URL (?t=…), e as páginas trazem
// notas, faltas e dívida. Guardar isso no cache do navegador deixaria os dados
// acessíveis depois no mesmo aparelho — e o aparelho costuma ser compartilhado.
// Por isso o SW usa network-only para tudo do portal e só guarda a casca:
// ícone, manifesto e a página de "sem conexão".

import { FastifyInstance } from 'fastify'
import { getDocHeader } from '../services/acaDocRender.js'

/** Ícone gerado a partir da inicial da instituição — evita depender de upload. */
function iconeSvg(nome: string, tamanho = 512): string {
  const inicial = (nome.trim()[0] || 'A').toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${tamanho}" height="${tamanho}">
  <rect width="512" height="512" rx="96" fill="#111827"/>
  <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
        font-size="260" font-weight="700" fill="#ffffff">${inicial.replace(/[<>&]/g, '')}</text>
</svg>`
}

export async function acaPortalPwaRoutes(app: FastifyInstance) {
  app.get('/portal/aca/manifest.webmanifest', async (_req, reply) => {
    const h = await getDocHeader()
    const manifest = {
      name: `${h.instituicao} — Portal`,
      short_name: 'Portal',
      description: 'Boletim, frequência, financeiro e documentos.',
      // A raiz é a home do aluno; o token continua vindo pela URL do atalho.
      start_url: '/portal/aca/aluno',
      scope: '/portal/aca/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f7f8fa',
      theme_color: '#111827',
      icons: [
        { src: '/portal/aca/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/portal/aca/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    }
    return reply.header('content-type', 'application/manifest+json; charset=utf-8').send(JSON.stringify(manifest))
  })

  app.get('/portal/aca/icon.svg', async (_req, reply) => {
    const h = await getDocHeader()
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=86400')
      .send(iconeSvg(h.instituicao))
  })

  app.get('/portal/aca/offline', async (_req, reply) => {
    const h = await getDocHeader()
    return reply.header('content-type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sem conexão — ${h.instituicao}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:22vh auto;padding:0 20px;color:#1f2937;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#5f6368;margin:0 0 18px}
button{font:inherit;padding:10px 18px;border-radius:10px;border:1px solid #d1d5db;background:#111827;color:#fff;cursor:pointer}</style>
</head><body>
<h1>Sem conexão</h1>
<p>Não foi possível carregar seus dados agora. Assim que a internet voltar, tente de novo.</p>
<button onclick="location.reload()">Tentar novamente</button>
</body></html>`)
  })

  app.get('/portal/aca/sw.js', async (_req, reply) => {
    // Escopo /portal/aca/ — o SW não enxerga o resto da aplicação.
    const sw = `// Service worker do portal acadêmico.
// Página autenticada NUNCA é cacheada: o portal expõe notas, faltas e dívida,
// e o aparelho costuma ser compartilhado. Guardamos apenas a casca.
const CACHE = 'aca-portal-v2'
const CASCA = ['/portal/aca/offline', '/portal/aca/icon.svg', '/portal/aca/manifest.webmanifest']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // Casca: pode vir do cache.
  if (CASCA.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)))
    return
  }

  // Conteúdo do portal: sempre da rede. Sem internet, mostra a página offline
  // em vez de servir dado velho de outra sessão.
  if (url.pathname.startsWith('/portal/aca/')) {
    e.respondWith(fetch(req).catch(() => caches.match('/portal/aca/offline')))
  }
})

// Notificação push. O payload chega cifrado e é decifrado aqui pelo próprio
// navegador — o serviço de push do fabricante não lê o conteúdo.
self.addEventListener('push', (e) => {
  let d = { titulo: 'Aviso da secretaria', corpo: '', url: '/portal/aca/login' }
  try { if (e.data) d = Object.assign(d, e.data.json()) } catch (_) { /* payload malformado vira aviso genérico */ }
  e.waitUntil(self.registration.showNotification(d.titulo, {
    body: d.corpo,
    icon: '/portal/aca/icon.svg',
    badge: '/portal/aca/icon.svg',
    data: { url: d.url },
    // Sem tag fixa: dois avisos diferentes não devem se sobrescrever.
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const alvo = (e.notification.data && e.notification.data.url) || '/portal/aca/login'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      // Reaproveita uma aba do portal já aberta em vez de empilhar janelas.
      for (const c of lista) {
        if (c.url.includes('/portal/aca/') && 'focus' in c) return c.focus()
      }
      return self.clients.openWindow(alvo)
    }),
  )
})
`
    return reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'no-cache')
      .header('service-worker-allowed', '/portal/aca/')
      .send(sw)
  })
}
