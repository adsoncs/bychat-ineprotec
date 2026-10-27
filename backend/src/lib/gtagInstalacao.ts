// src/lib/gtagInstalacao.ts
//
// Bloco do Google tag (gtag.js) das páginas públicas: formulário, landing page,
// agendamento, portal de matrícula e link rastreável.
//
// O ID vem da integração GA4 DESTA instalação (Configurações › Google › GA4).
// Sem integração ativa, só fica o Consent Mode + a fila de consentimento — que
// o banner de cookies (/api/consent/cc.js) usa —, sem carregar nada do Google.
// Antes o ID era fixo no código e as visitas de todos os clientes iam para a
// mesma propriedade de Analytics.
//
// Os renderizadores são síncronos, então o ID fica em memória e é relido a
// cada minuto (troca de configuração aparece em até 1 min).

import { prisma } from './prisma.js'

let idAtual = ''

async function carregar(): Promise<void> {
  try {
    const cfg = await prisma.gA4Config.findFirst({ where: { active: true }, orderBy: { id: 'desc' }, select: { measurementId: true } })
    const id = String(cfg?.measurementId || '').trim()
    idAtual = /^G-[A-Z0-9]{4,20}$/i.test(id) ? id : ''
  } catch { /* mantém o último valor */ }
}
void carregar()
setInterval(() => { void carregar() }, 60_000).unref()

/** ID GA4 da instalação ('' = sem integração ativa). */
export function idGa4DaInstalacao(): string {
  return idAtual
}

/** HTML para o <head>: Consent Mode v2 (LGPD) e, com ID configurado, o gtag.js. */
export function blocoGtag(): string {
  const id = idAtual
  return `<!-- Google tag (gtag.js) + Consent Mode v2 (LGPD) -->
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
gtag('js', new Date());
${id ? `gtag('config', '${id}');\n` : ''}window.bychOnMarketingConsent=window.bychOnMarketingConsent||function(f){(window.__bychMktQ=window.__bychMktQ||[]).push(f)};
</script>
${id ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n` : ''}`
}
