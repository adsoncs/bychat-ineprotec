// src/routes/portalAuth.ts
//
// Porta de entrada única do portal público: candidato e aluno entram pelo mesmo
// lugar, com CPF/e-mail e senha, e a sessão fica num cookie httpOnly — não mais
// num token na barra de endereço.
//
// Rotas core (não overlay): quem tem Portal de Matrículas ganha conta de
// verdade mesmo sem o ERP acadêmico instalado.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import {
  cookieDaRequisicao, emitirSessao, gravarCookie, ipDaRequisicao, limparCookie,
  revogarSessao, revogarTudo, validarSessao,
} from '../lib/portalSession.js'
import { authMiddleware } from '../lib/auth.js'
import { verifyCandidateToken } from '../lib/candidateAuth.js'
import {
  acharConta, consumirLinkDeAcesso, criarLinkDeAcesso, definirSenha, enderecoDoPortal, garantirConta,
  login, quemE, validarSenha,
  LINK_TTL_HORAS,
} from '../services/portalAccount.js'
import { guardTela } from '../lib/eduTelas.js'
import { logEvent } from '../services/leadHistory.js'
import { logUserAudit, auditActor } from '../services/userAudit.js'
import { getProviderForLeadOwner } from '../services/whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from '../services/notify.js'
import { avisos, esc } from '../lib/portalHtml.js'
import { etapasDaInscricao } from '../services/portalJornada.js'
import { paginaComMarca, marcaDoAcesso } from '../lib/portalMarca.js'
import { paginaDoPortal, portalAppDisponivel } from '../lib/portalApp.js'
import { cabecalhoDaTela, type TelaDoPortal } from '../lib/portalSeo.js'
import { lerEduGeral, vestirMarca, loginResolvido } from '../lib/eduGeral.js'

/** Situação da inscrição em português (a lista do portal mostrava o código cru, ex. "pending"). */
const STATUS_INSCRICAO: Record<string, string> = {
  draft: 'Rascunho', pending: 'Em andamento', submitted: 'Enviada', paid: 'Paga',
  docs_uploaded: 'Documentos enviados', docs_reviewing: 'Documentos em análise', docs_approved: 'Documentos aprovados',
  docs_rejected: 'Documentos recusados', reviewing: 'Em análise', approved: 'Aprovada', enrolled: 'Matriculado',
  rejected: 'Não aprovada', cancelled: 'Cancelada', expired: 'Expirada',
}

/**
 * Telas do /portal (início, entrar, senha) servidas pela aplicação do portal —
 * a mesma moldura, marca e componentes da inscrição. A cor e o favicon da
 * marca já vão no HTML, para a primeira pintura não piscar no tom padrão.
 * Sem a aplicação publicada, as rotas caem na versão do servidor (reserva).
 */
// Título, descrição, imagem e indexação de cada tela vêm do portal da marca
// (Configurações › Domínio + SEO). Ver lib/portalSeo.ts.
async function telaDoApp(req: any, reply: any, tela: TelaDoPortal) {
  const m = await marcaDoAcesso(req, reply).catch(() => null)
  const html = paginaDoPortal(await cabecalhoDaTela(m?.slug, tela), process.env.APP_URL || '')
  return reply.type('text/html').header('cache-control', 'no-store').send(html)
}

/** Sessão da requisição, ou null. Usado pelas rotas do próprio portal. */
export async function sessaoDaRequisicao(req: any): Promise<{ accountId: number } | null> {
  const r = await validarSessao(cookieDaRequisicao(req))
  return r.ok ? { accountId: r.accountId } : null
}

type CanalDeEnvio = 'whatsapp' | 'email'

/**
 * Manda um modelo do sistema (`<base>_wa` / `<base>_email`) ao contato.
 * `canais` é a ordem de tentativa: o primeiro que funcionar encerra. Devolve o
 * canal usado (ou null) e o motivo de cada canal que falhou — a tela mostra,
 * para a equipe saber que precisa entregar por outro caminho.
 */
async function enviarModeloAoContato(
  leadId: number, base: string, vars: Record<string, any>, canais: CanalDeEnvio[] = ['whatsapp', 'email'],
): Promise<{ canal: CanalDeEnvio | null; falhas: string[] }> {
  const falhas: string[] = []
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, nome: true, whatsapp: true, email: true },
  })
  if (!lead) return { canal: null, falhas: ['Contato não encontrado.'] }
  const { renderizarModelo } = await import('../services/modelosDoSistema.js')
  const todas = { nome: lead.nome ?? '', ...vars }

  for (const canal of canais) {
    if (canal === 'whatsapp') {
      if (!lead.whatsapp) { falhas.push('WhatsApp: contato sem número.'); continue }
      const msg = await renderizarModelo(`${base}_wa`, todas)
      if (!msg?.body.trim()) { falhas.push('WhatsApp: modelo desligado em Modelos.'); continue }
      try {
        const { provider } = await getProviderForLeadOwner({ id: lead.id, whatsapp: lead.whatsapp })
        await provider.sendText(lead.whatsapp, msg.body)
        return { canal: 'whatsapp', falhas }
      } catch (e: any) {
        // Cai para o próximo canal: WhatsApp fora do ar não pode deixar a pessoa sem acesso.
        falhas.push(`WhatsApp: ${String(e?.message || e).slice(0, 200)}`)
      }
    } else {
      if (!lead.email) { falhas.push('E-mail: contato sem e-mail.'); continue }
      // O corpo do e-mail é HTML: senha com "<" ou "&" quebraria a mensagem.
      const emHtml = Object.fromEntries(Object.entries(todas).map(([k, v]) => [k, typeof v === 'string' ? esc(v) : v]))
      const em = await renderizarModelo(`${base}_email`, emHtml)
      if (!em?.body.trim()) { falhas.push('E-mail: modelo desligado em Modelos.'); continue }
      try {
        const cfg = await getEmailConfig()
        await sendEmailGeneric({ from: getFromAddress(cfg), to: lead.email, subject: em.subject, html: em.body })
        return { canal: 'email', falhas }
      } catch (e: any) {
        falhas.push(`E-mail: ${String(e?.message || e).slice(0, 200)}`)
      }
    }
  }
  return { canal: null, falhas }
}

async function enviarLink(leadId: number, url: string, finalidade: string, canais?: CanalDeEnvio[]): Promise<string | null> {
  const base = finalidade === 'recuperacao' ? 'portal_recuperacao' : 'portal_acesso'
  return (await enviarModeloAoContato(leadId, base, { link: url, validade: LINK_TTL_HORAS }, canais)).canal
}

/** Canais pedidos pela tela: 'whatsapp', 'email' ou o padrão (WhatsApp, senão e-mail). */
function canaisPedidos(v: unknown): CanalDeEnvio[] {
  return v === 'whatsapp' ? ['whatsapp'] : v === 'email' ? ['email'] : ['whatsapp', 'email']
}

/**
 * Senha definida pela equipe: mais exigente que a do próprio aluno, porque
 * vai trafegar numa mensagem. 10+ caracteres com maiúscula, minúscula,
 * número e símbolo.
 */
export function validarSenhaForte(senha: string): string | null {
  if (!senha || senha.length < 10) return 'A senha precisa ter ao menos 10 caracteres.'
  if (senha.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  if (/\s/.test(senha)) return 'A senha não pode ter espaços.'
  if (!/[a-z]/.test(senha) || !/[A-Z]/.test(senha)) return 'Use letras maiúsculas e minúsculas.'
  if (!/[0-9]/.test(senha)) return 'Use ao menos um número.'
  if (!/[^A-Za-z0-9]/.test(senha)) return 'Use ao menos um símbolo (ex.: ! @ # $ %).'
  return null
}

export async function portalAuthRoutes(app: FastifyInstance) {
  // DESLIGADO: o convite de volta para quem abandonou a inscrição saía sozinho
  // daqui, sem fluxo e sem botão (e, sem instância própria, pelo número de
  // outra empresa). Regra (08/10): mensagem automática para lead/candidato/aluno só sai por
  // fluxo configurável na UX (Automação › Fluxos), nunca por rotina no código.
  // A varredura (services/enrollmentRetomada.ts) fica só para quando virar gatilho de fluxo.

  // Formulários do portal são POST de <form> — o portal funciona sem JS.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(String(body))) out[k] = v
      done(null, out)
    } catch (e) { done(e as Error, undefined) }
  })

  // ── GET /portal/entrar?c=… — troca o link de acesso por sessão ──
  // O link morre aqui: é consumido, vira cookie e some da barra de endereço.
  app.get('/portal/entrar', async (req, reply) => {
    const token = String((req.query as any)?.c || '')
    const destino = String((req.query as any)?.d || '')
    // Robô de prévia de link (WhatsApp/Meta, Telegram, Slack...) abre a URL
    // segundos depois do envio para montar o cartão da conversa. Se ele
    // consumisse o link, a pessoa tocava e recebia "Este link já foi usado".
    // Para ele, uma página neutra; o link continua valendo para quem tocar.
    if (ehRoboDePrevia(req.headers['user-agent'] as string)) {
      return reply.code(200).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .send('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Área do candidato</title><meta property="og:title" content="Área do candidato"><meta property="og:description" content="Toque para entrar na sua área do candidato."><meta name="robots" content="noindex"></head><body>Área do candidato</body></html>')
    }
    const r = await consumirLinkDeAcesso(token, {
      userAgent: req.headers['user-agent'] as string, ip: ipDaRequisicao(req),
    })
    if (!r.ok) {
      return reply.code(303).header('location', `/portal/login?erro=${encodeURIComponent(r.erro)}`).send()
    }
    gravarCookie(reply, r.raw, r.expiresAt)

    const conta = await prisma.portalAccount.findUnique({ where: { id: r.accountId }, select: { senhaHash: true } })
    // Sem senha ainda, ou veio de "esqueci a senha": a próxima tela é criar uma.
    if (r.finalidade !== 'acesso_direto' && (!conta?.senhaHash || r.finalidade === 'recuperacao')) {
      return reply.code(303).header('location', '/portal/senha').send()
    }
    return reply.code(303).header('location', destino || '/portal').send()
  })

  // ── POST /api/public/portal/login ──
  app.post('/api/public/portal/login', async (req, reply) => {
    const b = (req.body as any) || {}
    const r = await login(String(b.identificador || ''), String(b.senha || ''), {
      userAgent: req.headers['user-agent'] as string, ip: ipDaRequisicao(req),
    })
    const querHtml = String(req.headers.accept || '').includes('text/html')
    if (!r.ok) {
      if (querHtml) return reply.code(303).header('location', `/portal/login?erro=${encodeURIComponent(r.erro || '')}`).send()
      return reply.code(401).send({ error: r.erro, precisaDefinirSenha: !!r.precisaDefinirSenha })
    }
    gravarCookie(reply, r.raw!, r.expiresAt!)
    // Primeiro acesso com a senha padrão (CPF): oferece criar a própria — com
    // "agora não", que segue para onde a pessoa ia.
    const destino = String(b.destino || '/portal')
    if (querHtml) {
      return reply.code(303).header('location', r.senhaPadrao ? `/portal/senha?primeiro=1&depois=${encodeURIComponent(destino)}` : destino).send()
    }
    return { ok: true, expiraEm: r.expiresAt, senhaPadrao: !!r.senhaPadrao }
  })

  // ── POST /api/public/portal/sair ──
  app.post('/api/public/portal/sair', async (req, reply) => {
    await revogarSessao(cookieDaRequisicao(req))
    limparCookie(reply)
    if (String(req.headers.accept || '').includes('text/html')) {
      return reply.code(303).header('location', '/portal/login?aviso=Você saiu do portal.').send()
    }
    return { ok: true }
  })

  // ── POST /api/public/portal/meus-dados — o candidato corrige os dados dele ──
  // Só os dados de contato da pessoa: nome, e-mail e WhatsApp. CPF e os dados
  // da inscrição (unidade, forma de ingresso, curso, modalidade) não mudam por
  // aqui — errou a inscrição, faz outra. O e-mail é o login do portal: não pode
  // ser de outra conta. A troca fica no histórico do lead, para a equipe ver.
  app.post('/api/public/portal/meus-dados', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(401).send({ error: 'Sessão expirada. Entre de novo.' })
    const conta = await prisma.portalAccount.findUnique({
      where: { id: s.accountId },
      select: { leadId: true, lead: { select: { nome: true, email: true, whatsapp: true } } },
    })
    if (!conta) return reply.code(404).send({ error: 'Conta não encontrada.' })
    const b = (req.body as any) || {}
    const nome = String(b.nome ?? '').trim().replace(/\s+/g, ' ')
    const email = String(b.email ?? '').trim().toLowerCase()
    const whatsapp = String(b.whatsapp ?? '').trim()
    const erros: Record<string, string> = {}
    if (nome.length < 5 || nome.length > 120 || nome.split(' ').length < 2) erros.nome = 'Informe o nome completo.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 191) erros.email = 'E-mail inválido.'
    const { phoneKey } = await import('../lib/phone.js')
    if (!phoneKey(whatsapp)) erros.whatsapp = 'WhatsApp inválido — informe com DDD.'
    if (Object.keys(erros).length) return reply.code(400).send({ error: Object.values(erros)[0], erros })
    const dono = await prisma.lead.findFirst({
      where: { email, id: { not: conta.leadId }, portalAccount: { isNot: null } },
      select: { id: true },
    })
    if (dono) return reply.code(409).send({ error: 'Este e-mail já é usado por outra conta do portal.', erros: { email: 'E-mail já usado por outra conta.' } })

    const antes = conta.lead
    await prisma.lead.update({ where: { id: conta.leadId }, data: { nome, email, whatsapp } })
    const depois = await prisma.lead.findUnique({ where: { id: conta.leadId }, select: { nome: true, email: true, whatsapp: true } })
    // As inscrições guardam os dados como foram enviados; atualiza só os de
    // contato (CPF, curso e o resto da inscrição ficam como estão).
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { leadId: conta.leadId, status: { not: 'merged' } }, select: { id: true, formData: true },
    })
    for (const r of regs) {
      const fd = { ...((r.formData as Record<string, unknown>) || {}), nome, email, whatsapp: depois?.whatsapp ?? whatsapp }
      await prisma.enrollmentRegistration.update({ where: { id: r.id }, data: { formData: fd as any } })
    }
    const mudou = (['nome', 'email', 'whatsapp'] as const).filter((k) => String(antes?.[k] ?? '') !== String(depois?.[k] ?? ''))
    if (mudou.length) {
      const { logEvent, EVENT_TYPES } = await import('../services/leadHistory.js')
      const rotulo: Record<string, string> = { nome: 'nome', email: 'e-mail', whatsapp: 'WhatsApp' }
      logEvent({
        leadId: conta.leadId, type: EVENT_TYPES.LEAD_EDITED, category: 'lifecycle', source: 'portal', actorType: 'lead',
        title: `Candidato atualizou ${mudou.map((k) => rotulo[k]).join(', ')} no portal`,
        description: mudou.map((k) => `${rotulo[k]}: ${antes?.[k] ?? '—'} → ${depois?.[k] ?? '—'}`).join('\n'),
        metadata: { campos: mudou, antes: Object.fromEntries(mudou.map((k) => [k, antes?.[k] ?? null])), depois: Object.fromEntries(mudou.map((k) => [k, depois?.[k] ?? null])) },
      })
    }
    return { ok: true, eu: await quemE(s.accountId) }
  })

  // ── GET /api/public/portal/eu — quem está logado ──
  app.get('/api/public/portal/eu', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(401).send({ error: 'Sessão expirada. Entre de novo.' })
    return { eu: await quemE(s.accountId) }
  })

  // ── POST /api/public/portal/senha — define/troca a senha (exige sessão) ──
  app.post('/api/public/portal/senha', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    const querHtml = String(req.headers.accept || '').includes('text/html')
    if (!s) {
      if (querHtml) return reply.code(303).header('location', '/portal/login?erro=Sess%C3%A3o+expirada.').send()
      return reply.code(401).send({ error: 'Sessão expirada. Entre de novo.' })
    }
    const b = (req.body as any) || {}
    const senha = String(b.senha || '')
    if (senha !== String(b.confirmacao ?? senha)) {
      const erro = 'As duas senhas não são iguais.'
      return querHtml
        ? reply.code(303).header('location', `/portal/senha?erro=${encodeURIComponent(erro)}`).send()
        : reply.code(400).send({ error: erro })
    }
    const invalida = validarSenha(senha)
    if (invalida) {
      return querHtml
        ? reply.code(303).header('location', `/portal/senha?erro=${encodeURIComponent(invalida)}`).send()
        : reply.code(400).send({ error: invalida })
    }
    // Trocar a senha derruba as outras sessões; a de quem está trocando é
    // reemitida logo abaixo, senão a pessoa cairia para fora no próprio ato.
    await definirSenha(s.accountId, senha)
    const sess = await emitirSessao({
      accountId: s.accountId, userAgent: req.headers['user-agent'] as string, ip: ipDaRequisicao(req),
    })
    gravarCookie(reply, sess.raw, sess.expiresAt)
    return querHtml
      ? reply.code(303).header('location', '/portal?aviso=Senha+atualizada.').send()
      : { ok: true }
  })

  // ── POST /api/public/portal/recuperar — pede link por WhatsApp/e-mail ──
  // Responde igual exista ou não a conta: este formulário é público, e
  // diferenciar as respostas o transformaria em consulta de "fulano estuda aí?".
  app.post('/api/public/portal/recuperar', async (req, reply) => {
    const b = (req.body as any) || {}
    const querHtml = String(req.headers.accept || '').includes('text/html')
    const resposta = 'Se houver cadastro com esse dado, enviamos um link de acesso pelo WhatsApp ou e-mail.'

    const conta = await acharConta(String(b.identificador || ''))
    if (conta) {
      const link = await criarLinkDeAcesso(conta.id, 'recuperacao')
      await enviarLink(conta.leadId, link.url, 'recuperacao').catch(() => null)
    }
    return querHtml
      ? reply.code(303).header('location', `/portal/login?aviso=${encodeURIComponent(resposta)}`).send()
      : { ok: true, mensagem: resposta }
  })

  // ── POST /api/admin/portal-accounts/:leadId/link — secretaria gera o acesso ──
  // Fica aqui (e não no overlay) porque vale para qualquer instalação com portal.
  app.post('/api/admin/portal-accounts/:leadId/link', { preHandler: authMiddleware }, async (req, reply) => {
    const leadId = Number((req.params as any).leadId)
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Contato não encontrado' })

    const conta = await garantirConta(leadId)
    const link = await criarLinkDeAcesso(conta.id, 'primeiro_acesso')
    const canal = (req.body as any)?.enviar === false ? null : await enviarLink(leadId, link.url, 'primeiro_acesso')
    return { ok: true, url: link.url, expiraEm: link.expiresAt, enviadoPor: canal }
  })

  // ── POST /api/admin/portal-accounts/:leadId/revogar — derruba as sessões ──
  app.post('/api/admin/portal-accounts/:leadId/revogar', { preHandler: authMiddleware }, async (req, reply) => {
    const conta = await prisma.portalAccount.findUnique({
      where: { leadId: Number((req.params as any).leadId) }, select: { id: true },
    })
    if (!conta) return reply.code(404).send({ error: 'Este contato não tem conta no portal.' })
    return { ok: true, sessoesEncerradas: await revogarTudo(conta.id) }
  })

  // ── Senha do portal pela equipe (inscrição › Portal do candidato) ──
  // Credencial: tudo vai para a timeline do lead e para a auditoria, com quem
  // fez. A senha em si nunca é gravada em log nem em evento.
  const lerLeadId = (req: any) => Number(req.params?.leadId)
  const autor = (req: any) => {
    const a = auditActor(req)
    return { userId: a.actorId ?? undefined, userName: a.actorName ?? undefined, a }
  }

  // GET — situação do acesso: tem senha? último login? bloqueado?
  app.get('/api/admin/portal-accounts/:leadId/acesso', { preHandler: guardTela('admin') }, async (req, reply) => {
    const leadId = lerLeadId(req)
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, email: true, whatsapp: true, portalAccount: { select: { cpf: true, senhaHash: true, senhaDefinidaEm: true, ultimoLoginEm: true, bloqueadoAte: true, ativo: true } } },
    })
    if (!lead) return reply.code(404).send({ error: 'Contato não encontrado' })
    const c = lead.portalAccount
    reply.header('cache-control', 'no-store')
    return {
      temConta: !!c, temSenha: !!c?.senhaHash, senhaDefinidaEm: c?.senhaDefinidaEm ?? null,
      ultimoLoginEm: c?.ultimoLoginEm ?? null,
      bloqueadoAte: c?.bloqueadoAte && c.bloqueadoAte > new Date() ? c.bloqueadoAte : null,
      ativo: c?.ativo ?? true, usuario: c?.cpf ? 'cpf' : lead.email ? 'email' : null,
      temWhatsapp: !!lead.whatsapp, temEmail: !!lead.email,
    }
  })

  // POST — manda o link para a pessoa criar uma senha nova
  app.post('/api/admin/portal-accounts/:leadId/enviar-nova-senha', { preHandler: guardTela('admin') }, async (req, reply) => {
    const leadId = lerLeadId(req)
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Contato não encontrado' })
    const conta = await garantirConta(leadId)
    const link = await criarLinkDeAcesso(conta.id, 'recuperacao')
    const r = await enviarModeloAoContato(leadId, 'portal_recuperacao', { link: link.url, validade: LINK_TTL_HORAS }, canaisPedidos((req.body as any)?.canal))
    const { userId, userName, a } = autor(req)
    logEvent({
      leadId, type: 'magic_link_gerado', category: 'lifecycle', channel: 'portal', source: 'portal_senha_equipe',
      title: r.canal ? `Link para nova senha do portal enviado por ${r.canal === 'whatsapp' ? 'WhatsApp' : 'e-mail'}` : 'Link para nova senha do portal NÃO foi enviado',
      description: r.falhas.join(' · ') || undefined,
      actorType: 'operator', userId, userName, metadata: { finalidade: 'recuperacao', enviadoPor: r.canal, falhas: r.falhas },
    })
    void logUserAudit({ action: 'portal.nova_senha_link', targetType: 'lead', targetLabel: String(leadId), changes: { enviadoPor: r.canal }, ...a })
    reply.header('cache-control', 'no-store')
    if (!r.canal) return reply.code(502).send({ error: `Não foi possível enviar. ${r.falhas.join(' · ')}`, url: link.url })
    return { ok: true, enviadoPor: r.canal, falhas: r.falhas, ttlHoras: LINK_TTL_HORAS }
  })

  // POST — a equipe define a senha (forte) e, se pedir, manda à pessoa
  app.post('/api/admin/portal-accounts/:leadId/senha', { preHandler: guardTela('admin') }, async (req, reply) => {
    const leadId = lerLeadId(req)
    const b = (req.body as any) || {}
    const senha = String(b.senha ?? '')
    const erro = validarSenhaForte(senha)
    if (erro) return reply.code(400).send({ error: erro })
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, email: true } })
    if (!lead) return reply.code(404).send({ error: 'Contato não encontrado' })

    const conta = await garantirConta(leadId)
    const def = await definirSenha(conta.id, senha) // derruba as sessões abertas
    if (!def.ok) return reply.code(400).send({ error: def.erro })
    await prisma.portalAccount.update({ where: { id: conta.id }, data: { ativo: true } }).catch(() => {})

    const cpf = (await prisma.portalAccount.findUnique({ where: { id: conta.id }, select: { cpf: true } }))?.cpf ?? null
    const usuario = cpf ? cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : (lead.email ?? '')
    let envio: { canal: CanalDeEnvio | null; falhas: string[] } = { canal: null, falhas: [] }
    if (b.enviar) {
      const login = `${await enderecoDoPortal(conta.id)}/portal/login`
      envio = await enviarModeloAoContato(leadId, 'portal_senha_definida', { usuario, senha, link: login }, canaisPedidos(b.canal))
    }
    const { userId, userName, a } = autor(req)
    logEvent({
      leadId, type: 'note_added', category: 'operator', channel: 'portal', source: 'portal_senha_equipe',
      title: `Senha do portal definida pela equipe${b.enviar ? (envio.canal ? ` e enviada por ${envio.canal === 'whatsapp' ? 'WhatsApp' : 'e-mail'}` : ' (envio FALHOU)') : ' (não enviada)'}`,
      description: envio.falhas.join(' · ') || undefined,
      actorType: 'operator', userId, userName, metadata: { enviar: !!b.enviar, enviadoPor: envio.canal, falhas: envio.falhas },
    })
    void logUserAudit({ action: 'portal.senha_definida', targetType: 'lead', targetLabel: String(leadId), changes: { enviadoPor: envio.canal }, ...a })
    reply.header('cache-control', 'no-store')
    return { ok: true, usuario, enviadoPor: envio.canal, falhas: envio.falhas }
  })


  // ── POST /api/public/portal/senha-inicial ──
  // Criação de senha logo depois de enviar a inscrição, com o token que o
  // próprio /register devolveu. É o momento em que a pessoa está mais disposta
  // a criar acesso — e o formulário do portal nem sempre tem campo de senha,
  // porque quem monta o formulário é a instituição.
  app.post('/api/public/portal/senha-inicial', async (req, reply) => {
    const b = (req.body as any) || {}
    const sessao = verifyCandidateToken(String(b.candidateToken || ''))
    if (!sessao) return reply.code(401).send({ error: 'Sua sessão de inscrição expirou. Peça um link de acesso para criar a senha.' })

    const senha = String(b.senha || '')
    const invalida = validarSenha(senha)
    if (invalida) return reply.code(400).send({ error: invalida })

    const reg = await prisma.enrollmentRegistration.findUnique({
      where: { id: sessao.enrollmentId },
      select: { leadId: true, formData: true },
    })
    if (!reg?.leadId) return reply.code(404).send({ error: 'Inscrição não encontrada.' })

    const cpf = (reg.formData as any)?.cpf ?? null
    const conta = await garantirConta(reg.leadId, cpf)
    // Já tinha senha: não é aqui que se troca (isso exige estar logado).
    if (conta.senhaHash) return reply.code(409).send({ error: 'Esta conta já tem senha. Entre com ela ou peça um link de acesso.' })

    await definirSenha(conta.id, senha, { revogarSessoes: false })
    const s = await emitirSessao({
      accountId: conta.id, userAgent: req.headers['user-agent'] as string, ip: ipDaRequisicao(req),
    })
    gravarCookie(reply, s.raw, s.expiresAt)
    return { ok: true }
  })

  // ───────────────────────── Telas de acesso ─────────────────────────

  // ── GET /api/public/portal/marca — a marca que as telas do portal vestem ──
  // Mesma regra do login (portal pedido › inscrição de quem está logado ›
  // último portal visitado › portal principal). Só dados públicos do Branding.
  app.get('/api/public/portal/marca', async (req, reply) => {
    // Pelo código da inscrição (/candidato/<código>): a marca do portal dela já
    // na tela de entrada, antes do login.
    const cod = String((req.query as any)?.inscricao || '').trim().toUpperCase()
    const slugDaInscricao = /^[A-Z0-9-]{4,40}$/.test(cod)
      ? (await prisma.enrollmentRegistration.findUnique({ where: { candidateCode: cod }, select: { portal: { select: { slug: true } } } }).catch(() => null))?.portal?.slug ?? null
      : null
    const m = await marcaDoAcesso(req, reply, slugDaInscricao).catch(() => null)
    reply.header('cache-control', 'no-store')
    // Configurações Gerais: completam o que o portal deixou vazio, trazem o
    // tema geral (cores neutras, espaçamento) e os textos da tela de entrar.
    const g = await lerEduGeral()
    const marca = m || g.identidade.nome || g.aparencia.corPrincipal ? vestirMarca(m ? { ...m.bruto } : null, g) : null
    const login = loginResolvido(g, { linkHoras: LINK_TTL_HORAS, prefixoCodigo: (m?.bruto as any)?.codePrefix ?? null })
    return { marca, login }
  })

  // ── GET /portal/login ──
  app.get('/portal/login', async (req, reply) => {
    if (portalAppDisponivel()) return telaDoApp(req, reply, 'login')
    const q = (req.query as any) || {}
    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Acesse sua inscrição', `
      <div class="card">
        <h1>Acesse sua inscrição</h1>
        ${avisos(q.erro, q.aviso)}
        <form method="post" action="/api/public/portal/login">
          <label for="id">E-mail</label>
          <input id="id" name="identificador" type="email" required autocomplete="username" autocapitalize="off" autocorrect="off">
          <label for="s">Senha</label>
          <input id="s" name="senha" type="password" required autocomplete="current-password">
          <button type="submit">Entrar</button>
        </form>
        <div class="sep">
          <p class="sub" style="margin-bottom:6px">Primeiro acesso ou esqueceu a senha?</p>
          <form method="post" action="/api/public/portal/recuperar">
            <input name="identificador" type="email" required placeholder="E-mail" aria-label="E-mail">
            <button class="sec" type="submit">Receber link de acesso</button>
          </form>
          <p class="dica">Mandamos um link pelo WhatsApp ou e-mail do seu cadastro. Ele vale 48 horas e serve uma vez.</p>
        </div>
      </div>`))
  })

  // ── GET /portal/senha — criar ou trocar a senha (exige sessão) ──
  app.get('/portal/senha', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+criar+sua+senha.').send()
    if (portalAppDisponivel()) return telaDoApp(req, reply, 'senha')
    const q = (req.query as any) || {}
    const eu = await quemE(s.accountId)
    // "depois": para onde seguir no "agora não" (só caminho interno do portal).
    const depois = /^\/(portal|candidato)(\/|$|\?|#)/.test(String(q.depois || '')) ? String(q.depois) : '/portal'
    const primeiro = !eu?.temSenha
    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Criar senha', `
      <div class="card">
        <h1>${eu?.temSenha ? 'Trocar senha' : 'Criar sua senha'}</h1>
        <p class="sub">${eu?.temSenha ? 'A senha atual deixa de valer e os outros aparelhos saem do portal.' : `Olá, ${esc((eu?.nome ?? '').split(' ')[0])}. Você entrou com a senha padrão (o seu CPF). Crie uma senha só sua — a partir daí o CPF deixa de valer como senha.`}</p>
        ${avisos(q.erro, q.aviso)}
        <form method="post" action="/api/public/portal/senha">
          <label for="p1">Senha</label>
          <input id="p1" name="senha" type="password" required autocomplete="new-password" minlength="8">
          <label for="p2">Repita a senha</label>
          <input id="p2" name="confirmacao" type="password" required autocomplete="new-password" minlength="8">
          <button type="submit">Salvar senha</button>
        </form>
        <p class="dica">Ao menos 8 caracteres, misturando letras e números.</p>
        ${primeiro ? `<a href="${esc(depois)}"><button class="sec" type="button">Agora não, continuar</button></a>` : ''}
      </div>`))
  })



  // ── GET /portal/aluno — virou o portal único (/portal) ──
  // A vida acadêmica é uma seção do /portal. Links antigos (avisos, PWA
  // instalado) continuam valendo por este redirecionamento.
  app.get('/portal/aluno', async (_req, reply) => reply.code(303).header('location', '/portal').send())

  // ── GET /portal/documentos — área logada, servida pela mesma aplicação ──
  app.get('/portal/documentos', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+ver+seus+documentos.').send()
    if (!portalAppDisponivel()) {
      return reply.code(503).type('text/html').send(await paginaComMarca(req, reply, 'Documentos', '<div class="card"><h1>Indisponível</h1><p class="sub">A tela de documentos ainda não foi publicada nesta instalação.</p></div>'))
    }
    return telaDoApp(req, reply, 'documentos')
  })

  // ── GET /portal/contrato — leitura e assinatura do contrato (Fase 5) ──
  // Antes só existia no SSR do ERP (/portal/aca/aluno) e no provedor externo.
  app.get('/portal/contrato', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+ver+seu+contrato.').send()
    if (!portalAppDisponivel()) return reply.code(303).header('location', '/portal').send()
    return telaDoApp(req, reply, 'contrato')
  })

  // ── GET /portal — o que a pessoa tem aqui dentro ──
  app.get('/portal', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login').send()
    if (portalAppDisponivel()) return telaDoApp(req, reply, 'portal')
    const eu = await quemE(s.accountId)
    const q = (req.query as any) || {}

    // A inscrição em andamento mostra as etapas NA ORDEM do portal (aba Etapas
    // › portal logado), cada uma com a situação e o atalho que abre a etapa no
    // painel. Antes eram botões fixos ("Enviar documentos") e o contrato, o
    // pagamento e a ordem configurada não apareciam aqui.
    const ativas = (eu?.inscricoes ?? []).filter((i) => i.status !== 'merged')
    const jornada = ativas[0] ? await etapasDaInscricao(ativas[0].id, 'painel').catch(() => null) : null
    const etapas = jornada?.etapas ?? []
    const proxima = etapas.find((e) => e.situacao === 'pendente')
    const SIT: Record<string, { rotulo: string; cor: string }> = {
      feito: { rotulo: 'Concluído', cor: 'var(--ok, #15803d)' },
      aguardando: { rotulo: 'Em análise', cor: 'var(--marca, #2563eb)' },
      pendente: { rotulo: 'Pendente', cor: '#b45309' },
    }
    const listaEtapas = etapas.length ? `<ol style="list-style:none;margin:10px 0 12px;padding:0;display:grid;gap:8px">${etapas.map((e, n) => {
      const sit = SIT[e.situacao] ?? SIT.pendente
      const acao = e.situacao === 'feito' ? '' : `<a href="/portal#etapa-${esc(e.chave)}" style="font-size:13px;font-weight:600;white-space:nowrap">${e.situacao === 'aguardando' ? 'Ver' : 'Fazer agora'}</a>`
      return `<li style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(0,0,0,.08);border-radius:10px">
        <span style="flex:0 0 22px;height:22px;border-radius:999px;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;background:${e.situacao === 'pendente' ? '#9ca3af' : sit.cor}">${e.situacao === 'feito' ? '✓' : n + 1}</span>
        <span style="flex:1;min-width:0"><b style="display:block">${esc(e.titulo)}</b><span class="sub" style="margin:0;font-size:13px">${esc(e.detalhe)}</span>
          <span style="display:flex;gap:12px;align-items:center;margin-top:4px"><span style="font-size:12px;font-weight:600;color:${sit.cor}">${sit.rotulo}</span>${acao}</span></span>
      </li>`
    }).join('')}</ol>` : ''
    const inscricoes = ativas.map((i, n) =>
      `<div class="item"><span><b>${esc(i.candidateCode)}</b>${n === 0 && jornada?.portal ? `<span class="sub" style="display:block;margin:0;font-size:12px">${esc(jornada.portal.nome)}</span>` : ''}</span><span class="tag">${esc(STATUS_INSCRICAO[i.status] ?? i.status)}</span></div>${n === 0 ? listaEtapas : ''}`).join('')

    const bloco = (titulo: string, corpo: string) =>
      `<div class="card" style="margin-bottom:14px"><h1 style="font-size:16px;margin-bottom:10px">${titulo}</h1>${corpo}</div>`

    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Meu portal', `
      ${avisos(q.erro, q.aviso)}
      <div class="card" style="margin-bottom:14px">
        <h1>Olá, ${esc((eu?.nome ?? '').split(' ')[0])}</h1>
        <p class="sub" style="margin:0">${eu?.aluno ? `Aluno · RA ${esc(eu.aluno.ra ?? '—')}` : 'Candidato'}</p>
      </div>
      ${eu && !eu.temSenha
        ? `<div class="card" style="margin-bottom:14px;border-left:4px solid #b45309"><p class="sub" style="margin:0 0 10px">Você está entrando com a <b>senha padrão</b> (o seu CPF). Crie uma senha só sua para proteger seus documentos e o contrato.</p><a href="/portal/senha"><button type="button">Criar minha senha</button></a></div>`
        : ''}
      ${eu?.aluno
        ? bloco('Vida acadêmica', '<p class="sub" style="margin:0 0 10px">Situação da matrícula, financeiro, documentos e contrato.</p><a href="/portal#financeiro"><button class="sec" type="button">Abrir meu portal</button></a>')
        : ''}
      ${inscricoes ? bloco('Minhas inscrições', inscricoes
        // Quem ainda não é aluno segue a jornada da inscrição (pagamento,
        // documentos, contrato, redação) na ordem do portal, em /portal.
        + (proxima
          ? `<a href="/portal#etapa-${esc(proxima.chave)}"><button type="button">Continuar: ${esc(proxima.titulo.toLowerCase())}</button></a>`
          : (eu?.aluno ? '' : '<a href="/portal"><button class="sec" type="button">Ver minha inscrição</button></a>'))) : ''}
      ${bloco('Conta', `<div class="item"><span>${esc(eu?.email ?? '—')}</span><span class="tag">e-mail</span></div>
        <div class="item"><span>${esc(eu?.whatsapp ?? '—')}</span><span class="tag">WhatsApp</span></div>
        <a href="/portal/senha"><button class="sec" type="button">Trocar senha</button></a>
        <form method="post" action="/api/public/portal/sair"><button class="sec" type="submit">Sair do portal</button></form>`)}
    `))
  })

}

/** User-agent de robô que abre links para gerar prévia (não é a pessoa). */
const ROBO_DE_PREVIA = /facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|bingbot|redditbot|Embedly|Pinterest|vkShare|bot\b.*preview|preview/i
export function ehRoboDePrevia(userAgent: string | null | undefined): boolean {
  return ROBO_DE_PREVIA.test(String(userAgent || ''))
}
