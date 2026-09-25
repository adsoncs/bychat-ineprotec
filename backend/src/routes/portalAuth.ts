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
  acharConta, consumirLinkDeAcesso, criarLinkDeAcesso, definirSenha, garantirConta,
  login, quemE, validarSenha,
} from '../services/portalAccount.js'
import { getProviderForLeadOwner } from '../services/whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from '../services/notify.js'
import { avisos, esc } from '../lib/portalHtml.js'
import { paginaComMarca, marcaDoAcesso } from '../lib/portalMarca.js'
import { paginaDoPortal, portalAppDisponivel } from '../lib/portalApp.js'

/** Sessão da requisição, ou null. Usado pelas rotas do próprio portal. */
export async function sessaoDaRequisicao(req: any): Promise<{ accountId: number } | null> {
  const r = await validarSessao(cookieDaRequisicao(req))
  return r.ok ? { accountId: r.accountId } : null
}

async function enviarLink(leadId: number, url: string, finalidade: string): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, nome: true, whatsapp: true, email: true },
  })
  if (!lead) return null
  const acao = finalidade === 'recuperacao' ? 'criar uma nova senha' : 'entrar no portal e criar sua senha'
  const texto = `Olá, ${lead.nome ?? 'tudo bem'}! Use o link abaixo para ${acao}:\n\n${url}\n\n` +
    'O link vale por 48 horas, serve uma vez só e é de uso pessoal.'

  if (lead.whatsapp) {
    try {
      const { provider } = await getProviderForLeadOwner({ id: lead.id, whatsapp: lead.whatsapp })
      await provider.sendText(lead.whatsapp, texto)
      return 'whatsapp'
    } catch {
      // Cai para o e-mail: WhatsApp fora do ar não pode deixar a pessoa sem acesso.
    }
  }
  if (lead.email) {
    try {
      const cfg = await getEmailConfig()
      await sendEmailGeneric({
        from: getFromAddress(cfg, 'secretaria'),
        to: lead.email,
        subject: 'Acesso ao portal',
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${texto.replace(/\n/g, '<br>')}</div>`,
      })
      return 'email'
    } catch { /* nada a fazer */ }
  }
  return null
}

export async function portalAuthRoutes(app: FastifyInstance) {
  // Convite de volta para quem abandonou a inscrição no meio. Fica aqui (e não
  // no overlay) porque vale para qualquer instalação com portal de matrículas.
  import('../services/enrollmentRetomada.js')
    .then((m) => m.iniciarRetomadaDeRascunhos())
    .catch((e) => console.warn('[enrollmentRetomada] init falhou:', e?.message || e))

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
    const r = await consumirLinkDeAcesso(token, {
      userAgent: req.headers['user-agent'] as string, ip: ipDaRequisicao(req),
    })
    if (!r.ok) {
      return reply.code(303).header('location', `/portal/login?erro=${encodeURIComponent(r.erro)}`).send()
    }
    gravarCookie(reply, r.raw, r.expiresAt)

    const conta = await prisma.portalAccount.findUnique({ where: { id: r.accountId }, select: { senhaHash: true } })
    // Sem senha ainda, ou veio de "esqueci a senha": a próxima tela é criar uma.
    if (!conta?.senhaHash || r.finalidade === 'recuperacao') {
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
    if (querHtml) return reply.code(303).header('location', String(b.destino || '/portal')).send()
    return { ok: true, expiraEm: r.expiresAt }
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
    const m = await marcaDoAcesso(req, reply).catch(() => null)
    reply.header('cache-control', 'no-store')
    return { marca: m ? { ...m.bruto } : null }
  })

  // ── GET /portal/login ──
  app.get('/portal/login', async (req, reply) => {
    const q = (req.query as any) || {}
    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Entrar no portal', `
      <div class="card">
        <h1>Entrar no portal</h1>
        <p class="sub">Use o CPF ou o e-mail do seu cadastro.</p>
        ${avisos(q.erro, q.aviso)}
        <form method="post" action="/api/public/portal/login">
          <label for="id">CPF, e-mail ou RA</label>
          <input id="id" name="identificador" required autocomplete="username" autocapitalize="off" autocorrect="off">
          <label for="s">Senha</label>
          <input id="s" name="senha" type="password" required autocomplete="current-password">
          <button type="submit">Entrar</button>
        </form>
        <div class="sep">
          <p class="sub" style="margin-bottom:6px">Primeiro acesso ou esqueceu a senha?</p>
          <form method="post" action="/api/public/portal/recuperar">
            <input name="identificador" required placeholder="CPF, e-mail ou RA" aria-label="CPF, e-mail ou RA">
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
    const q = (req.query as any) || {}
    const eu = await quemE(s.accountId)
    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Criar senha', `
      <div class="card">
        <h1>${eu?.temSenha ? 'Trocar senha' : 'Criar sua senha'}</h1>
        <p class="sub">${eu?.temSenha ? 'A senha atual deixa de valer e os outros aparelhos saem do portal.' : `Olá, ${esc(eu?.nome ?? '')}. Escolha uma senha para entrar quando quiser, sem depender do link.`}</p>
        ${avisos(q.erro, q.aviso)}
        <form method="post" action="/api/public/portal/senha">
          <label for="p1">Senha</label>
          <input id="p1" name="senha" type="password" required autocomplete="new-password" minlength="8">
          <label for="p2">Repita a senha</label>
          <input id="p2" name="confirmacao" type="password" required autocomplete="new-password" minlength="8">
          <button type="submit">Salvar senha</button>
        </form>
        <p class="dica">Ao menos 8 caracteres, misturando letras e números.</p>
      </div>`))
  })



  // ── GET /portal/aluno — painel do aluno (aplicação) ──
  // O SSR em /portal/aca/aluno continua no ar: é ele que atende os links de
  // aviso já enviados e quem estiver sem JavaScript.
  app.get('/portal/aluno', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+ver+seu+portal.').send()
    if (!portalAppDisponivel()) return reply.code(303).header('location', '/portal').send()
    return reply.type('text/html').send(paginaDoPortal({
      nome: 'Meu portal', slug: 'aluno',
      metaTitle: 'Meu portal', metaDescription: 'Situação da matrícula, financeiro e documentos.',
    }, process.env.APP_URL || ''))
  })

  // ── GET /portal/documentos — área logada, servida pela mesma aplicação ──
  app.get('/portal/documentos', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+ver+seus+documentos.').send()
    if (!portalAppDisponivel()) {
      return reply.code(503).type('text/html').send(await paginaComMarca(req, reply, 'Documentos', '<div class="card"><h1>Indisponível</h1><p class="sub">A tela de documentos ainda não foi publicada nesta instalação.</p></div>'))
    }
    return reply.type('text/html').send(paginaDoPortal({
      nome: 'Meus documentos', slug: 'documentos',
      metaTitle: 'Meus documentos',
      metaDescription: 'Envio de documentos da sua inscrição.',
    }, process.env.APP_URL || ''))
  })

  // ── GET /portal/contrato — leitura e assinatura do contrato (Fase 5) ──
  // Antes só existia no SSR do ERP (/portal/aca/aluno) e no provedor externo.
  app.get('/portal/contrato', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login?erro=Entre+para+ver+seu+contrato.').send()
    if (!portalAppDisponivel()) return reply.code(303).header('location', '/portal').send()
    return reply.type('text/html').send(paginaDoPortal({
      nome: 'Meu contrato', slug: 'contrato',
      metaTitle: 'Meu contrato',
      metaDescription: 'Contrato de matrícula: leitura e assinatura.',
    }, process.env.APP_URL || ''))
  })

  // ── GET /portal — o que a pessoa tem aqui dentro ──
  app.get('/portal', async (req, reply) => {
    const s = await sessaoDaRequisicao(req)
    if (!s) return reply.code(303).header('location', '/portal/login').send()
    const eu = await quemE(s.accountId)
    const q = (req.query as any) || {}

    const inscricoes = (eu?.inscricoes ?? []).map((i) =>
      `<div class="item"><span><b>${esc(i.candidateCode)}</b></span><span class="tag">${esc(i.status)}</span></div>`).join('')

    const bloco = (titulo: string, corpo: string) =>
      `<div class="card" style="margin-bottom:14px"><h1 style="font-size:16px;margin-bottom:10px">${titulo}</h1>${corpo}</div>`

    return reply.type('text/html').send(await paginaComMarca(req, reply, 'Meu portal', `
      ${avisos(q.erro, q.aviso)}
      <div class="card" style="margin-bottom:14px">
        <h1>Olá, ${esc((eu?.nome ?? '').split(' ')[0])}</h1>
        <p class="sub" style="margin:0">${eu?.aluno ? `Aluno · RA ${esc(eu.aluno.ra ?? '—')}` : 'Candidato'}</p>
      </div>
      ${eu?.aluno
        ? bloco('Vida acadêmica', '<p class="sub" style="margin:0 0 10px">Situação da matrícula, financeiro, documentos e contrato.</p><a href="/portal/aluno"><button class="sec" type="button">Abrir meu portal</button></a>')
        : ''}
      ${inscricoes ? bloco('Minhas inscrições', inscricoes
        + '<a href="/portal/documentos"><button class="sec" type="button">Enviar documentos</button></a>') : ''}
      ${bloco('Conta', `<div class="item"><span>${esc(eu?.email ?? '—')}</span><span class="tag">e-mail</span></div>
        <div class="item"><span>${esc(eu?.whatsapp ?? '—')}</span><span class="tag">WhatsApp</span></div>
        <a href="/portal/senha"><button class="sec" type="button">Trocar senha</button></a>
        <form method="post" action="/api/public/portal/sair"><button class="sec" type="submit">Sair do portal</button></form>`)}
    `))
  })

}
