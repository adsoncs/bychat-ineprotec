// src/lib/portalPixels.ts
//
// Snippets de pixel do portal (GA4, GTM, Meta, TikTok, LinkedIn). Ficavam
// dentro da rota da tela clássica, então a tela nova (portal-app) nascia sem
// nenhum deles: a instituição configurava na aba SEO e nada disparava. Aqui
// para que as duas telas usem exatamente o mesmo código.
//
// Os pixels de marketing passam por `window.bychOnMarketingConsent` quando ele
// existe — é o banner de cookies que decide a hora de carregar.

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

// Renderiza snippets de pixel (GA4, Meta, TikTok, LinkedIn)
export function renderPixels(config: any): string {
  if (!config || typeof config !== 'object') return ''
  const parts: string[] = []

  // GA4
  if (config.ga4Id) {
    const id = esc(config.ga4Id)
    parts.push(`<!-- GA4 --><script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`)
  }
  // GTM
  if (config.gtmId) {
    const id = esc(config.gtmId)
    parts.push(`<!-- GTM --><script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`)
  }
  // Meta Pixel
  if (config.metaPixelId) {
    const id = esc(config.metaPixelId)
    parts.push(`<!-- Meta Pixel --><script>(window.bychOnMarketingConsent||function(f){f()})(function(){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');})</script><noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`)
  }
  // TikTok Pixel
  if (config.tiktokPixelId) {
    const id = esc(config.tiktokPixelId)
    parts.push(`<!-- TikTok Pixel --><script>(window.bychOnMarketingConsent||function(f){f()})(function(){!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${id}');ttq.page();}(window,document,'ttq');})</script>`)
  }
  // LinkedIn Insight
  if (config.linkedinPartnerId) {
    const id = esc(config.linkedinPartnerId)
    parts.push(`<!-- LinkedIn Insight --><script>(window.bychOnMarketingConsent||function(f){f()})(function(){_linkedin_partner_id="${id}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s);})(window.lintrk);})</script>`)
  }
  return parts.join('\n')
}
