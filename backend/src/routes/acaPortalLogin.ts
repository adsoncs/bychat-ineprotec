// src/routes/acaPortalLogin.ts
//
// Porta de entrada do portal do aluno (G6 / RF-701).
//
// Páginas SSR — o portal inteiro é assim, e um SPA só para o login seria um
// bundle a mais para quem entra pelo celular no ponto de ônibus.
//
// O link com token continua funcionando: quem já recebe aviso de vencimento
// com link não é obrigado a criar senha. O login existe para quem quer entrar
// sem depender de achar a mensagem antiga.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { verifyPortalToken } from '../lib/acaPortalToken.js'
import { HEAD, esc, baseUrl } from './acaPortal.js'
import { login, definirSenha, enviarLinkAcesso, validarSenha } from '../services/acaPortalAuth.js'
import { emitirInformeIR } from '../services/acaDocumentos.js'
import { proximosEventosDoAluno } from './acaCalendario.js'

const tokOf = (req: any): string => String((req.query as any)?.t || '')

function pagina(titulo: string, conteudo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><title>${esc(titulo)}</title>${HEAD}</head><body>${conteudo}</body></html>`
}

export async function acaPortalLoginRoutes(app: FastifyInstance) {
  // Formulários urlencoded: o portal inteiro usa POST de <form>, sem JS.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(String(body))) out[k] = v
      done(null, out)
    } catch (e) { done(e as Error, undefined) }
  })

  // ───────── Página de login ─────────
  // ── GET /portal/aca/login — porta antiga, agora leva à porta única ──
  //
  // Fase 7 da consolidação ERP × Portal (10/09/2026). Havia duas portas para o
  // mesmo aluno: por aqui ele caía no portal SSR do ERP, e por /portal/login na
  // aplicação — duas versões do mesmo portal, com conteúdos diferentes, vivas ao
  // mesmo tempo. Desde a Fase 2 a autenticação é a mesma dos dois lados (a conta
  // única aceita CPF, e-mail ou RA, e a senha antiga do ERP entra e é migrada),
  // então mandar todo mundo para a porta nova não tranca ninguém do lado de fora.
  //
  // O SSR em /portal/aca/aluno continua no ar: ele atende os links de acesso já
  // enviados e as seções que a aplicação ainda não tem (horário, materiais,
  // estágio, próximas datas).
  app.get('/portal/aca/login', async (req, reply) => {
    const q = (req.query as any) || {}
    const erro = String(q.erro || '')
    const destino = erro ? `/portal/login?erro=${encodeURIComponent(erro)}` : '/portal/login'
    return reply.code(303).header('location', destino).send()
  })

  app.post('/api/public/aca/portal/login', async (req, reply) => {
    const b = (req.body as any) || {}
    const r = await login(String(b.identificador || ''), String(b.senha || ''))
    if (!r.ok) {
      const destino = r.precisaDefinirSenha
        ? `/portal/aca/login?erro=${encodeURIComponent(r.erro || '')}`
        : `/portal/aca/login?erro=${encodeURIComponent(r.erro || 'Não foi possível entrar.')}`
      return reply.code(303).header('location', destino).send()
    }
    return reply.code(303).header('location', `/portal/aca/aluno?t=${encodeURIComponent(r.token!)}`).send()
  })

  /**
   * Envio do link de acesso. Responde igual exista ou não o aluno — este
   * formulário é público, e diferenciar as respostas o transformaria em
   * consulta de "fulano estuda aí?".
   */
  app.post('/api/public/aca/portal/link', async (req, reply) => {
    const b = (req.body as any) || {}
    await enviarLinkAcesso(String(b.identificador || ''), baseUrl(req)).catch(() => ({ enviado: false }))
    const msg = 'Se o cadastro existir, o link de acesso foi enviado para o WhatsApp ou e-mail cadastrado.'
    return reply.code(303).header('location', `/portal/aca/login?aviso=${encodeURIComponent(msg)}`).send()
  })

  // ───────── Definir/trocar senha (entra pelo link) ─────────
  app.get('/portal/aca/senha', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) {
      return reply.code(403).type('text/html').send(pagina('Link expirado', `
        <div class="card"><h1>Link inválido ou expirado</h1>
        <p class="sub">Peça um novo link na tela de acesso.</p>
        <a href="/portal/aca/login"><button class="sec" style="margin-top:8px">Ir para o acesso</button></a></div>`))
    }
    const aluno = await prisma.aluno.findUnique({ where: { id: p.id }, select: { portalSenhaHash: true, lead: { select: { nome: true } } } })
    const erro = String((req.query as any)?.erro || '')
    const tk = encodeURIComponent(tokOf(req))
    return reply.type('text/html').send(pagina('Definir senha', `
      <div class="card">
        <h1>${aluno?.portalSenhaHash ? 'Trocar senha' : 'Criar sua senha'}</h1>
        <p class="sub">${esc(aluno?.lead?.nome ?? '')}</p>
        ${erro ? `<div class="card" style="background:#fde8e8;border-color:#f5b5b5;color:#a11;font-size:13px">${esc(erro)}</div>` : ''}
        <form method="post" action="/api/public/aca/portal/senha?t=${tk}">
          <label style="display:block;font-size:13px;margin:8px 0 4px">Nova senha</label>
          <input type="password" name="senha" required autocomplete="new-password" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px">
          <label style="display:block;font-size:13px;margin:10px 0 4px">Repita a senha</label>
          <input type="password" name="senha2" required autocomplete="new-password" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px">
          <p class="sub" style="font-size:12px;margin-top:6px">Ao menos 8 caracteres, misturando letras e números.</p>
          <button type="submit" style="margin-top:10px;width:100%">Salvar senha</button>
        </form>
      </div>`))
  })

  app.post('/api/public/aca/portal/senha', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const b = (req.body as any) || {}
    const senha = String(b.senha || '')
    const tk = encodeURIComponent(tokOf(req))
    const volta = (erro: string) => reply.code(303).header('location', `/portal/aca/senha?t=${tk}&erro=${encodeURIComponent(erro)}`).send()

    if (senha !== String(b.senha2 || '')) return volta('As senhas não conferem.')
    const problema = validarSenha(senha)
    if (problema) return volta(problema)

    const r = await definirSenha(p.id, senha)
    if (!r.ok) return volta(r.erro || 'Não foi possível salvar.')
    // Já entra: pedir para logar de novo logo após criar a senha é atrito à toa.
    return reply.code(303).header('location', `/portal/aca/aluno?t=${tk}`).send()
  })

  // ───────── Agenda em .ics (RF-701) ─────────
  //
  // O aluno assina o calendário no celular e as datas de prova aparecem junto
  // dos compromissos dele. Sem isso, "consultar o calendário" depende de ele
  // lembrar de abrir o portal — que é justamente o que ninguém faz.
  app.get('/api/public/aca/aluno/agenda.ics', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const eventos = await proximosEventosDoAluno(p.id, 365).catch(() => [] as any[])

    const stamp = (d: Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const dia = (d: Date) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '')
    // Dobra de linha do iCalendar é em 75 octetos; escapar vírgula e ponto-e-
    // vírgula é obrigatório, senão o evento chega truncado no celular.
    const txt = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n')

    const linhas = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ByChat//Portal do Aluno//PT-BR',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Calendário acadêmico',
    ]
    for (const e of eventos as any[]) {
      const ini = new Date(e.dataInicio)
      const fim = e.dataFim ? new Date(e.dataFim) : ini
      linhas.push('BEGIN:VEVENT')
      linhas.push(`UID:aca-evento-${e.id}@bychat`)
      linhas.push(`DTSTAMP:${stamp(new Date())}`)
      if (e.diaInteiro) {
        // Em evento de dia inteiro o DTEND é EXCLUSIVO — sem o +1 o último dia
        // some da agenda.
        const fimExcl = new Date(fim); fimExcl.setDate(fimExcl.getDate() + 1)
        linhas.push(`DTSTART;VALUE=DATE:${dia(ini)}`)
        linhas.push(`DTEND;VALUE=DATE:${dia(fimExcl)}`)
      } else {
        linhas.push(`DTSTART:${stamp(ini)}`)
        linhas.push(`DTEND:${stamp(fim)}`)
      }
      linhas.push(`SUMMARY:${txt(e.titulo ?? e.nome ?? 'Evento acadêmico')}`)
      if (e.descricao) linhas.push(`DESCRIPTION:${txt(e.descricao)}`)
      if (e.tipo) linhas.push(`CATEGORIES:${txt(e.tipo)}`)
      linhas.push('END:VEVENT')
    }
    linhas.push('END:VCALENDAR')

    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', 'attachment; filename="calendario-academico.ics"')
      .send(linhas.join('\r\n'))
  })

  // ───────── Informe de pagamentos para o IR ─────────
  app.post('/api/public/aca/aluno/informe-ir', async (req, reply) => {
    const p = verifyPortalToken(tokOf(req), 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'Link inválido ou expirado' })
    const b = (req.body as any) || {}
    const ano = Number(b.ano) || new Date().getFullYear() - 1
    const tk = encodeURIComponent(tokOf(req))
    try {
      const doc = await emitirInformeIR(p.id, ano, null)
      return reply.code(303).header('location', `/api/public/aca/aluno/doc?t=${tk}&id=${doc.id}`).send()
    } catch (e: any) {
      return reply.code(303).header('location', `/portal/aca/aluno?t=${tk}&erro=${encodeURIComponent(e?.message || 'Falha ao emitir')}`).send()
    }
  })
}
