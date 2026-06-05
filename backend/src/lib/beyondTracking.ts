// src/lib/beyondTracking.ts
// Snippet de instalação do Beyond Tracking (pixel first-party "Pixel do ByChat Beyond",
// servido em /api/t/bt.js). Define a fila window.BT com stubs (identify/track/page) para
// não perder chamadas antes do bt.js carregar, e carrega o bt.js async. É idempotente
// (b.BT=b.BT||{q:[]}), então pode coexistir com o snippet manual já colado num site.
//
// Fonte ÚNICA usada por: rota /api/tracking/snippet (cópia manual), renderer de landing
// pages e renderer de formulários — assim o pixel entra NATIVAMENTE nessas superfícies.

/** Markup completo do snippet (com tag <script>), para injetar no <head>/<body>. */
export function beyondTrackingSnippet(baseUrl: string): string {
  return `<!-- Beyond Tracking -->
<script>
${beyondTrackingInlineJs(baseUrl)}
</script>`
}

/** Só o corpo JS do loader (sem <script>), para injetar dentro de outro script
 *  (ex.: o connectedCallback do Web Component do formulário embedado). */
export function beyondTrackingInlineJs(baseUrl: string): string {
  return `(function(b,e,o,d){b.BT=b.BT||{q:[]};['identify','track','page'].forEach(function(m){b.BT[m]=b.BT[m]||function(){b.BT.q.push([m,[].slice.call(arguments)])}});if(!b.__btLoaded){b.__btLoaded=1;d=e.createElement('script');d.async=1;d.src=o+'/api/t/bt.js';e.head.appendChild(d)}})(window,document,${JSON.stringify(baseUrl)});`
}
