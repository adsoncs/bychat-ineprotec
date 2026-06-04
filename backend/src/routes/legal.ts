import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

/**
 * Páginas legais (LGPD) servidas via SSR: /privacidade, /termos, /cookies.
 *
 * Conteúdo editável via Setting (grp "legal"):
 *   legal.company_name, legal.cnpj, legal.dpo_email, legal.controller_role,
 *   legal.privacy_html, legal.terms_html, legal.cookies_html, legal.version
 * Quando o Setting de corpo (*_html) não existir, usa o template padrão abaixo.
 *
 * Estas páginas NÃO carregam analytics/pixels — são informativas e devem ser
 * acessíveis sem consentimento prévio.
 */

const POLICY_VERSION_DEFAULT = '1.0'

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

async function getSettings(keys: string[]): Promise<Record<string, any>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const map: Record<string, any> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

interface LegalVars {
  company: string
  cnpj: string
  dpoEmail: string
  host: string
  version: string
}

function layout(title: string, body: string, vars: LegalVars): string {
  const nav = `
    <nav class="lg-nav">
      <a href="/privacidade">Política de Privacidade</a>
      <a href="/termos">Termos de Uso</a>
      <a href="/cookies">Política de Cookies</a>
    </nav>`
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index,follow">
<title>${esc(title)} — ${esc(vars.company)}</title>
<style>
  :root{--ink:#1a2332;--mut:#5f6368;--line:#e6e8eb;--blue:#1a73e8;--bg:#f7f8fa}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.65}
  .lg-wrap{max-width:820px;margin:0 auto;padding:32px 20px 80px}
  .lg-nav{display:flex;flex-wrap:wrap;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:28px;font-size:14px}
  .lg-nav a{color:var(--blue);text-decoration:none;font-weight:600}
  .lg-nav a:hover{text-decoration:underline}
  h1{font-size:28px;margin:0 0 6px}
  h2{font-size:19px;margin:32px 0 8px;padding-top:8px}
  h3{font-size:16px;margin:20px 0 6px}
  p,li{font-size:15px;color:#27313d}
  ul{padding-left:20px}
  .lg-meta{color:var(--mut);font-size:13px;margin-bottom:24px}
  .lg-box{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:18px 0}
  a{color:var(--blue)}
  footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
  code{background:#eef1f4;padding:1px 6px;border-radius:5px;font-size:13px}
</style>
</head>
<body>
  <div class="lg-wrap">
    ${nav}
    ${body}
    <footer>
      <p><strong>${esc(vars.company)}</strong>${vars.cnpj ? ' · CNPJ ' + esc(vars.cnpj) : ''}</p>
      <p>Encarregado pelo Tratamento de Dados (DPO): <a href="mailto:${esc(vars.dpoEmail)}">${esc(vars.dpoEmail)}</a></p>
      <p>Versão ${esc(vars.version)} · Documento informativo nos termos da Lei nº 13.709/2018 (LGPD).</p>
    </footer>
  </div>
</body>
</html>`
}

function privacyTemplate(v: LegalVars): string {
  return `
  <h1>Política de Privacidade</h1>
  <p class="lg-meta">Última atualização: revisão ${esc(v.version)}.</p>

  <div class="lg-box">Esta Política descreve como tratamos dados pessoais nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD). Em caso de dúvidas, fale com nosso Encarregado: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>.</p>

  <h2>1. Quem somos e nosso papel</h2>
  <p>${esc(v.company)} opera a plataforma acessível em <code>${esc(v.host)}</code>. Conforme o tratamento, atuamos como <strong>controladora</strong> (quando definimos as finalidades — p. ex. nosso site institucional e cadastro de clientes) ou como <strong>operadora</strong> (quando tratamos dados em nome de nossos clientes contratantes, que são os controladores dos dados de seus próprios contatos/alunos).</p>

  <h2>2. Dados que coletamos</h2>
  <ul>
    <li><strong>Dados de identificação e contato:</strong> nome, e-mail, telefone/WhatsApp, empresa.</li>
    <li><strong>Dados de matrícula (educacional):</strong> CPF, dados acadêmicos e, quando aplicável, dados de pagamento e documentos.</li>
    <li><strong>Dados de navegação:</strong> endereço IP, identificadores de cookies/sessão, páginas visitadas e parâmetros de campanha (UTMs), coletados conforme sua escolha de cookies.</li>
    <li><strong>Conteúdo de atendimento:</strong> mensagens trocadas pelos canais de comunicação.</li>
  </ul>

  <h2>3. Finalidades e bases legais</h2>
  <ul>
    <li>Prestação do serviço e atendimento — execução de contrato.</li>
    <li>Processos de matrícula e pagamento — execução de contrato e obrigação legal.</li>
    <li>Comunicações de marketing e analytics — <strong>consentimento</strong>, revogável a qualquer tempo.</li>
    <li>Segurança, prevenção a fraudes e melhoria do serviço — legítimo interesse.</li>
  </ul>

  <h2>4. Compartilhamento e transferência internacional</h2>
  <p>Podemos compartilhar dados com prestadores que nos apoiam (provedores de mensageria, pagamento, analytics, publicidade e inteligência artificial), sempre limitados à finalidade. Alguns desses prestadores estão localizados fora do Brasil; nesses casos adotamos as salvaguardas previstas na LGPD (art. 33), incluindo cláusulas contratuais padrão.</p>

  <h2>5. Tratamento de dados de crianças e adolescentes</h2>
  <p>O tratamento observa sempre o melhor interesse do menor. Dados de crianças são tratados mediante consentimento específico e em destaque de um dos pais ou responsável legal.</p>

  <h2>6. Por quanto tempo guardamos</h2>
  <p>Mantemos os dados pelo tempo necessário às finalidades informadas e às obrigações legais. Encerrada a necessidade, os dados são eliminados ou anonimizados.</p>

  <h2>7. Seus direitos (art. 18 da LGPD)</h2>
  <p>Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação e revogação de consentimento. Exerça seus direitos de forma autônoma pelo portal <a href="/meus-dados"><strong>Meus dados</strong></a> (acesso confirmado por link enviado ao seu e-mail ou WhatsApp), ou contate o Encarregado em <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>. Responderemos nos prazos legais.</p>

  <h2>8. Segurança</h2>
  <p>Adotamos medidas técnicas e administrativas para proteger seus dados, como controle de acesso, criptografia de credenciais e registro de eventos de segurança.</p>

  <h2>9. Atualizações</h2>
  <p>Esta Política pode ser atualizada. A versão vigente estará sempre disponível nesta página.</p>`
}

function termsTemplate(v: LegalVars): string {
  return `
  <h1>Termos de Uso</h1>
  <p class="lg-meta">Última atualização: revisão ${esc(v.version)}.</p>
  <h2>1. Aceitação</h2>
  <p>Ao utilizar os serviços disponibilizados em <code>${esc(v.host)}</code>, você concorda com estes Termos e com a <a href="/privacidade">Política de Privacidade</a>.</p>
  <h2>2. Uso do serviço</h2>
  <p>Você se compromete a fornecer informações verdadeiras e a não utilizar o serviço para fins ilícitos, ofensivos ou que violem direitos de terceiros.</p>
  <h2>3. Propriedade intelectual</h2>
  <p>Os conteúdos, marcas e a tecnologia da plataforma pertencem a ${esc(v.company)} ou a seus licenciadores.</p>
  <h2>4. Limitação de responsabilidade</h2>
  <p>O serviço é fornecido no estado em que se encontra. Empenhamo-nos pela disponibilidade e segurança, sem garantir operação ininterrupta.</p>
  <h2>5. Contato</h2>
  <p>Dúvidas sobre estes Termos: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>.</p>`
}

function cookiesTemplate(v: LegalVars): string {
  return `
  <h1>Política de Cookies</h1>
  <p class="lg-meta">Última atualização: revisão ${esc(v.version)}.</p>
  <p>Utilizamos cookies e tecnologias semelhantes para operar a plataforma e, mediante seu consentimento, para medir audiência e personalizar comunicações.</p>
  <h2>Categorias</h2>
  <ul>
    <li><strong>Necessários:</strong> indispensáveis ao funcionamento (sessão, segurança). Não exigem consentimento.</li>
    <li><strong>Analíticos:</strong> ajudam a entender o uso do site (p. ex. Google Analytics). Dependem de consentimento.</li>
    <li><strong>Marketing:</strong> personalizam anúncios e medem campanhas (p. ex. Meta, Google Ads, TikTok, LinkedIn). Dependem de consentimento.</li>
  </ul>
  <h2>Como gerenciar</h2>
  <p>Você pode aceitar, recusar ou configurar categorias pelo banner de cookies exibido ao acessar o site, e alterar sua escolha a qualquer momento limpando os cookies do navegador ou pela central de preferências. Recusar é tão simples quanto aceitar.</p>
  <h2>Contato</h2>
  <p>Dúvidas: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>.</p>`
}

export async function legalRoutes(app: FastifyInstance) {
  async function resolveVars(req: any): Promise<LegalVars> {
    const s = await getSettings(['legal.company_name', 'legal.cnpj', 'legal.dpo_email', 'legal.version'])
    const host = String(req.headers?.host || 'este site')
    const dpo = (s['legal.dpo_email'] as string) || `dpo@${host.replace(/:.*$/, '')}`
    return {
      company: (s['legal.company_name'] as string) || '[Razão Social — configurar em Configurações]',
      cnpj: (s['legal.cnpj'] as string) || '',
      dpoEmail: dpo,
      host,
      version: (s['legal.version'] as string) || POLICY_VERSION_DEFAULT,
    }
  }

  async function render(req: any, reply: any, doc: 'privacy' | 'terms' | 'cookies', title: string, tpl: (v: LegalVars) => string) {
    const vars = await resolveVars(req)
    const custom = await getSettings([`legal.${doc}_html`])
    const body = (custom[`legal.${doc}_html`] as string) || tpl(vars)
    reply.type('text/html').header('Cache-Control', 'public, max-age=300').send(layout(title, body, vars))
  }

  app.get('/privacidade', (req, reply) => render(req, reply, 'privacy', 'Política de Privacidade', privacyTemplate))
  app.get('/termos', (req, reply) => render(req, reply, 'terms', 'Termos de Uso', termsTemplate))
  app.get('/cookies', (req, reply) => render(req, reply, 'cookies', 'Política de Cookies', cookiesTemplate))

  // JSON para o banner/app consumirem (links + versão vigente)
  app.get('/api/public/legal/meta', async (req, reply) => {
    const vars = await resolveVars(req)
    reply.send({
      version: vars.version,
      links: { privacy: '/privacidade', terms: '/termos', cookies: '/cookies' },
      dpoEmail: vars.dpoEmail,
    })
  })
}
