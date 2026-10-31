import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'

/**
 * Páginas legais (LGPD) servidas via SSR: /privacidade, /termos, /cookies, /exclusao-de-dados.
 *
 * Conteúdo editável via Setting (grp "legal"):
 *   legal.company_name, legal.brand_name, legal.cnpj, legal.dpo_email, legal.controller_role,
 *   legal.privacy_html, legal.terms_html, legal.cookies_html, legal.deletion_html, legal.version
 * Quando o Setting de corpo (*_html) não existir, usa o template padrão abaixo.
 *
 * Estas páginas NÃO carregam analytics/pixels — são informativas e devem ser
 * acessíveis sem consentimento prévio.
 */

const POLICY_VERSION_DEFAULT = '1.0'

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function fmtCnpj(c: string): string {
  const d = String(c).replace(/\D/g, '')
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c
}

async function getSettings(keys: string[]): Promise<Record<string, any>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const map: Record<string, any> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

interface LegalVars {
  company: string
  brand: string
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
      <a href="/exclusao-de-dados">Exclusão de dados</a>
    </nav>`
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index,follow">
<title>${esc(title)} — ${esc(vars.brand)}</title>
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
  <!-- email_off: a Cloudflare troca e-mails por um link ofuscado; aqui o endereço precisa ficar legível -->
  <!--email_off-->
  <div class="lg-wrap">
    ${nav}
    ${body}
    <footer>
      <p><strong>${esc(vars.company)}</strong>${vars.cnpj ? ' · CNPJ ' + esc(fmtCnpj(vars.cnpj)) : ''}</p>
      <p>Encarregado pelo Tratamento de Dados (DPO): <a href="mailto:${esc(vars.dpoEmail)}">${esc(vars.dpoEmail)}</a></p>
      <p>Versão ${esc(vars.version)} · Documento informativo nos termos da Lei nº 13.709/2018 (LGPD).</p>
    </footer>
  </div>
  <!--/email_off-->
</body>
</html>`
}

function privacyTemplate(v: LegalVars): string {
  return `
  <h1>Política de Privacidade</h1>
  <p class="lg-meta">Versão ${esc(v.version)}.</p>

  <div class="lg-box">Esta Política explica quais dados pessoais a ${esc(v.brand)} coleta, para que usa, com quem compartilha, por quanto tempo guarda e como você pode pedir a exclusão, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD). Dúvidas: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>.</div>

  <h2>1. Quem somos</h2>
  <p>A ${esc(v.brand)} é uma plataforma de atendimento multicanal e CRM (WhatsApp, Instagram, Messenger, e-mail e formulários) mantida por ${esc(v.company)}${v.cnpj ? ', CNPJ ' + esc(fmtCnpj(v.cnpj)) : ''}, acessível em <code>${esc(v.host)}</code> e nos endereços das instalações de nossos clientes (<code>*.attrae.com.br</code>).</p>
  <p>Quando tratamos os dados de nosso site e de nossos próprios clientes, somos <strong>controladora</strong>. Quando uma empresa contratante usa a plataforma para atender os contatos dela (alunos, pacientes, clientes), essa empresa é a <strong>controladora</strong> e nós atuamos como <strong>operadora</strong>, tratando os dados apenas conforme as instruções dela.</p>

  <h2>2. Dados que coletamos</h2>
  <ul>
    <li><strong>Identificação e contato:</strong> nome, e-mail, telefone/WhatsApp, empresa.</li>
    <li><strong>Usuários da plataforma:</strong> nome, e-mail, papel e registros de acesso (data, hora e IP).</li>
    <li><strong>Conteúdo de atendimento:</strong> mensagens, áudios, imagens e arquivos trocados pelos canais conectados.</li>
    <li><strong>Dados de matrícula (clientes educacionais):</strong> CPF, dados acadêmicos, documentos e dados de pagamento, quando aplicável.</li>
    <li><strong>Navegação:</strong> IP, cookies de sessão e parâmetros de campanha (UTMs), conforme sua escolha de cookies.</li>
  </ul>

  <h2 id="meta">3. Dados recebidos do Facebook, Instagram, Messenger e WhatsApp (Meta)</h2>
  <p>Quando uma empresa conecta à ${esc(v.brand)} a sua Página do Facebook, sua conta profissional do Instagram ou seu número do WhatsApp Business, recebemos da Meta, por meio das APIs oficiais e com a autorização dessa empresa:</p>
  <ul>
    <li><strong>Da empresa:</strong> identificador e nome da Página, identificador e nome de usuário da conta do Instagram, identificador da conta do WhatsApp Business e os tokens de acesso necessários para operar a integração.</li>
    <li><strong>De quem envia mensagem para a empresa:</strong> identificador da conversa (ID específico do app), nome e foto de perfil públicos, e o conteúdo das mensagens e anexos enviados e recebidos.</li>
  </ul>
  <p><strong>Uso:</strong> esses dados são usados exclusivamente para exibir as conversas na caixa de entrada da empresa, permitir que a equipe dela responda, organizar o atendimento no CRM (funil, responsável, histórico) e manter o registro da conversa. As respostas só são enviadas a quem iniciou o contato com a empresa.</p>
  <p><strong>Não fazemos:</strong> não vendemos esses dados, não os usamos para publicidade, não criamos perfis para terceiros e não os compartilhamos com ninguém além dos prestadores listados na seção 5, sempre limitados a esta finalidade. O uso respeita os <a href="https://developers.facebook.com/terms" target="_blank" rel="noopener">Termos da Plataforma da Meta</a>.</p>
  <p><strong>Exclusão:</strong> veja a página <a href="/exclusao-de-dados">Exclusão de dados</a>.</p>

  <h2>4. Finalidades e bases legais</h2>
  <ul>
    <li>Prestação do serviço, atendimento e suporte — execução de contrato (art. 7º, V).</li>
    <li>Matrícula, cobrança e obrigações fiscais — execução de contrato e obrigação legal (art. 7º, II e V).</li>
    <li>Marketing e analytics no site — <strong>consentimento</strong>, revogável a qualquer momento (art. 7º, I).</li>
    <li>Segurança, prevenção a fraudes e melhoria do serviço — legítimo interesse (art. 7º, IX).</li>
  </ul>

  <h2>5. Compartilhamento e transferência internacional</h2>
  <p>Compartilhamos dados apenas com prestadores necessários à operação, limitados à finalidade: hospedagem e infraestrutura, mensageria (Meta — WhatsApp, Instagram e Messenger), envio de e-mail, meios de pagamento e serviços de inteligência artificial usados nos recursos de atendimento contratados pela empresa. Alguns estão fora do Brasil; nesses casos adotamos as salvaguardas do art. 33 da LGPD, como cláusulas contratuais padrão. Também podemos fornecer dados quando exigido por lei ou ordem judicial.</p>

  <h2>6. Crianças e adolescentes</h2>
  <p>O tratamento observa o melhor interesse do menor. Dados de crianças são tratados com consentimento específico e em destaque de um dos pais ou responsável legal.</p>

  <h2>7. Por quanto tempo guardamos</h2>
  <p>Enquanto durar o contrato com a empresa contratante e pelo tempo exigido por obrigações legais. Quando uma integração é desconectada, os tokens de acesso são apagados na hora. Ao fim do contrato, ou mediante pedido de exclusão, os dados são eliminados ou anonimizados em até 30 dias, salvo guarda obrigatória por lei.</p>

  <h2>8. Seus direitos (art. 18 da LGPD)</h2>
  <p>Você pode pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação e revogação do consentimento. Use o portal <a href="/meus-dados"><strong>Meus dados</strong></a> ou escreva para <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>. Se você é contato de uma empresa que usa a ${esc(v.brand)}, também pode falar diretamente com ela; encaminhamos a ela os pedidos que recebermos.</p>

  <h2>9. Segurança</h2>
  <p>Usamos conexão criptografada (HTTPS), controle de acesso por usuário e papel, criptografia de credenciais e tokens, cópias de segurança e registro de eventos de segurança.</p>

  <h2>10. Atualizações</h2>
  <p>Esta Política pode ser atualizada; a versão vigente fica sempre nesta página.</p>`
}

function termsTemplate(v: LegalVars): string {
  return `
  <h1>Termos de Uso</h1>
  <p class="lg-meta">Versão ${esc(v.version)}.</p>
  <h2>1. Aceitação</h2>
  <p>Ao usar a ${esc(v.brand)} (<code>${esc(v.host)}</code> e instalações em <code>*.attrae.com.br</code>), você concorda com estes Termos e com a <a href="/privacidade">Política de Privacidade</a>.</p>
  <h2>2. O serviço</h2>
  <p>A ${esc(v.brand)} é uma plataforma de atendimento multicanal e CRM. A empresa contratante conecta seus próprios canais (WhatsApp Business, Página do Facebook, conta profissional do Instagram, e-mail) e sua equipe atende os contatos pela plataforma.</p>
  <h2>3. Responsabilidades da empresa contratante</h2>
  <ul>
    <li>Conectar apenas canais que lhe pertencem ou que está autorizada a administrar.</li>
    <li>Fornecer informações verdadeiras e manter seus acessos em sigilo.</li>
    <li>Ter base legal para tratar os dados dos seus contatos e responder aos pedidos deles.</li>
    <li>Cumprir as políticas da Meta (WhatsApp Business, Instagram e Messenger), não enviar spam nem mensagens a quem não pediu, e não usar o serviço para fins ilícitos, ofensivos ou que violem direitos de terceiros.</li>
  </ul>
  <h2>4. Integrações com a Meta</h2>
  <p>As integrações usam as APIs oficiais da Meta e dependem das regras e da disponibilidade dela. A empresa pode desconectar um canal a qualquer momento pelo painel ou revogando o acesso nas configurações do Facebook ou do Instagram.</p>
  <h2>5. Propriedade intelectual</h2>
  <p>Marca, conteúdo e tecnologia da plataforma pertencem a ${esc(v.company)} ou a seus licenciadores. Os dados e conversas de cada empresa pertencem a ela.</p>
  <h2>6. Limitação de responsabilidade</h2>
  <p>Trabalhamos pela disponibilidade e segurança do serviço, sem garantir operação ininterrupta, e não respondemos por falhas de serviços de terceiros, como as plataformas da Meta.</p>
  <h2>7. Encerramento</h2>
  <p>Ao fim do contrato, os dados da empresa são eliminados conforme a <a href="/privacidade">Política de Privacidade</a> e a página <a href="/exclusao-de-dados">Exclusão de dados</a>.</p>
  <h2>8. Contato e foro</h2>
  <p>Dúvidas: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>. Aplica-se a legislação brasileira.</p>`
}

function deletionTemplate(v: LegalVars): string {
  const mail = `mailto:${esc(v.dpoEmail)}?subject=${encodeURIComponent('Exclusão de dados')}`
  return `
  <h1>Exclusão de dados</h1>
  <p class="lg-meta">Instruções para excluir dados da ${esc(v.brand)}, inclusive os recebidos do Facebook, Instagram, Messenger e WhatsApp. Versão ${esc(v.version)}.</p>

  <h2>Se você enviou mensagem para uma empresa que usa a ${esc(v.brand)}</h2>
  <ol>
    <li>Envie um e-mail para <a href="${mail}">${esc(v.dpoEmail)}</a> com o assunto <strong>"Exclusão de dados"</strong>.</li>
    <li>Informe o nome da empresa com quem conversou, o canal (Instagram, Messenger ou WhatsApp) e o seu nome de usuário do Instagram, nome no Facebook ou número de telefone.</li>
    <li>Confirmaremos o recebimento em até 2 dias úteis e excluiremos suas mensagens, nome, foto e identificadores em até 15 dias, avisando a empresa responsável. Você receberá a confirmação por e-mail.</li>
  </ol>
  <p>Você também pode usar o portal <a href="/meus-dados">Meus dados</a> ou pedir diretamente à empresa com quem conversou.</p>

  <h2>Se você é uma empresa que conectou sua Página ou Instagram</h2>
  <ol>
    <li>No painel da ${esc(v.brand)}, abra <strong>Integrações › Instagram/Messenger</strong> e clique em <strong>Desconectar</strong>. Os tokens de acesso são apagados na hora e paramos de receber mensagens.</li>
    <li>Para revogar também na Meta: no Facebook, <strong>Configurações › Integrações comerciais</strong>, ou no Instagram, <strong>Configurações › Apps e sites</strong>, e remova o app.</li>
    <li>Para apagar todo o histórico de conversas e contatos, escreva para <a href="${mail}">${esc(v.dpoEmail)}</a> a partir do e-mail do administrador da conta. A exclusão é concluída em até 30 dias, exceto o que a lei nos obriga a guardar.</li>
  </ol>

  <h2>O que é excluído</h2>
  <ul>
    <li>Identificadores da conversa e da conta (ID do Instagram, do Facebook ou telefone).</li>
    <li>Nome e foto de perfil.</li>
    <li>Mensagens, áudios, imagens e arquivos.</li>
    <li>Tokens de acesso da integração.</li>
  </ul>
  <p>Dúvidas: <a href="mailto:${esc(v.dpoEmail)}">${esc(v.dpoEmail)}</a>.</p>`
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
    const s = await getSettings(['legal.company_name', 'legal.brand_name', 'legal.cnpj', 'legal.dpo_email', 'legal.version'])
    const host = String(req.headers?.host || 'este site')
    const dpo = (s['legal.dpo_email'] as string) || `dpo@${host.replace(/:.*$/, '')}`
    const company = (s['legal.company_name'] as string) || '[Razão Social — configurar em Configurações]'
    return {
      company,
      brand: (s['legal.brand_name'] as string) || company,
      cnpj: (s['legal.cnpj'] as string) || '',
      dpoEmail: dpo,
      host,
      version: (s['legal.version'] as string) || POLICY_VERSION_DEFAULT,
    }
  }

  async function render(req: any, reply: any, doc: 'privacy' | 'terms' | 'cookies' | 'deletion', title: string, tpl: (v: LegalVars) => string) {
    const vars = await resolveVars(req)
    const custom = await getSettings([`legal.${doc}_html`])
    const body = (custom[`legal.${doc}_html`] as string) || tpl(vars)
    reply.type('text/html').header('Cache-Control', 'public, max-age=300').send(layout(title, body, vars))
  }

  app.get('/privacidade', (req, reply) => render(req, reply, 'privacy', 'Política de Privacidade', privacyTemplate))
  app.get('/termos', (req, reply) => render(req, reply, 'terms', 'Termos de Uso', termsTemplate))
  app.get('/cookies', (req, reply) => render(req, reply, 'cookies', 'Política de Cookies', cookiesTemplate))
  app.get('/exclusao-de-dados', (req, reply) => render(req, reply, 'deletion', 'Exclusão de dados', deletionTemplate))

  // JSON para o banner/app consumirem (links + versão vigente)
  app.get('/api/public/legal/meta', async (req, reply) => {
    const vars = await resolveVars(req)
    reply.send({
      version: vars.version,
      links: { privacy: '/privacidade', terms: '/termos', cookies: '/cookies', deletion: '/exclusao-de-dados' },
      dpoEmail: vars.dpoEmail,
    })
  })
}
