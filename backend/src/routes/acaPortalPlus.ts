// src/routes/acaPortalPlus.ts
// Módulo Acadêmico · F7 — Portais por perfil (Central do Responsável e Ex-aluno).
// Reusa a infraestrutura SSR magic-link de acaPortal.ts (token HMAC por query ?t=,
// páginas públicas /portal/aca/*, ações /api/public/aca/*). Sem schema novo:
//   Responsável → boletim/financeiro/datas do(s) dependente(s) (AcaResponsavel).
//   Ex-aluno    → histórico + documentos (2ª via) de quem CONCLUIU.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { criarCobrancaAsaas } from '../services/acaFinanceiro.js'
import { mintPortalToken as mintToken, verifyPortalToken as verifyToken } from '../lib/acaPortalToken.js'
import { emitirDocumentoAluno, montarHistorico, emitirInformeIR, emitirQuitacaoAnual, type DocTipo } from '../services/acaDocumentos.js'
import { proximosEventosDoAluno } from './acaCalendario.js'
import { HEAD, esc, money, sitBadge, baseUrl, boletimAluno, financeiroAluno } from './acaPortal.js'

export async function acaPortalPlusRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, any> = {}
      for (const [k, v] of new URLSearchParams(body as string)) { if (k in out) out[k] = ([] as any[]).concat(out[k], v); else out[k] = v }
      done(null, out)
    } catch (e) { done(e as Error, undefined) }
  })
  const tokOf = (req: any) => (req.query?.t as string) || ''
  const numOf = (req: any, k: string) => Number(req.query?.[k])
  const pageErr = (reply: any, code: number, titulo: string, sub = '') =>
    reply.code(code).type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>${titulo}</title>${HEAD}</head><body><div class="card"><h1>${titulo}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></body></html>`)

  // ───────── Admin: buscar alunos (responsáveis + flag concluído) ─────────
  app.get('/api/admin/aca/portal-plus/alunos', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    const where: any = {}
    if (q) where.OR = [{ ra: { contains: q } }, { lead: { is: { nome: { contains: q } } } }]
    const alunos = await prisma.aluno.findMany({
      where, take: 50, orderBy: { id: 'desc' },
      select: { id: true, ra: true, lead: { select: { nome: true } }, responsaveis: { where: { ativo: true }, select: { id: true, nome: true, parentesco: true, tipo: true } } },
    })
    const ids = alunos.map((a) => a.id)
    const concl = ids.length ? await prisma.acaMatricula.findMany({ where: { alunoId: { in: ids }, status: 'CONCLUIDO' }, select: { alunoId: true } }) : []
    const conclSet = new Set(concl.map((c) => c.alunoId))
    return { alunos: alunos.map((a) => ({ id: a.id, ra: a.ra, nome: a.lead.nome, concluido: conclSet.has(a.id), responsaveis: a.responsaveis })) }
  })

  // ───────── Admin: gerar magic link (responsável | ex-aluno) ─────────
  app.post('/api/admin/aca/portal-plus/link', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const dias = Math.min(Math.max(Number(b.dias) || 30, 1), 365)
    const id = Number(b.id)
    if (!id) return reply.code(400).send({ error: 'id obrigatório' })
    if (b.tipo === 'responsavel') {
      const r = await prisma.acaResponsavel.findUnique({ where: { id }, select: { id: true } })
      if (!r) return reply.code(404).send({ error: 'Responsável não encontrado' })
      const token = mintToken('aca-responsavel', id, dias)
      return { url: `${baseUrl(req)}/portal/aca/responsavel?t=${encodeURIComponent(token)}`, token, expiraEm: new Date(Date.now() + dias * 86400_000) }
    }
    if (b.tipo === 'exaluno') {
      const concl = await prisma.acaMatricula.findFirst({ where: { alunoId: id, status: 'CONCLUIDO' }, select: { id: true } })
      if (!concl) return reply.code(400).send({ error: 'Aluno não possui matrícula concluída' })
      const token = mintToken('aca-exaluno', id, dias)
      return { url: `${baseUrl(req)}/portal/aca/exaluno?t=${encodeURIComponent(token)}`, token, expiraEm: new Date(Date.now() + dias * 86400_000) }
    }
    if (b.tipo === 'coord') {
      const c = await prisma.acaCoordenador.findUnique({ where: { id }, select: { id: true } })
      if (!c) return reply.code(404).send({ error: 'Coordenador não encontrado' })
      const token = mintToken('aca-coord', id, dias)
      return { url: `${baseUrl(req)}/portal/aca/coordenador?t=${encodeURIComponent(token)}`, token, expiraEm: new Date(Date.now() + dias * 86400_000) }
    }
    return reply.code(400).send({ error: 'tipo inválido (responsavel|exaluno|coord)' })
  })

  // ───────── Admin: cursos (picker) e coordenadores (CRUD) ─────────
  app.get('/api/admin/aca/portal-plus/cursos', { preHandler: authMiddleware }, async () => {
    const courses = await prisma.course.findMany({ where: { active: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true }, take: 300 })
    return { cursos: courses }
  })
  app.get('/api/admin/aca/portal-plus/coordenadores', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaCoordenador.findMany({ orderBy: { id: 'desc' }, take: 300 })
    const cursoIds = [...new Set(rows.map((r) => r.courseId))]
    const cursos = cursoIds.length ? await prisma.course.findMany({ where: { id: { in: cursoIds } }, select: { id: true, nome: true } }) : []
    const cMap = new Map(cursos.map((c) => [c.id, c.nome]))
    return { coordenadores: rows.map((r) => ({ ...r, cursoNome: cMap.get(r.courseId) ?? '—' })) }
  })
  app.post('/api/admin/aca/portal-plus/coordenadores', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.courseId) return reply.code(400).send({ error: 'nome e courseId obrigatórios' })
    const coord = await prisma.acaCoordenador.create({ data: { nome: String(b.nome).slice(0, 191), email: b.email || null, courseId: Number(b.courseId), leadId: b.leadId ? Number(b.leadId) : null } })
    return reply.code(201).send({ coordenador: coord })
  })
  app.put('/api/admin/aca/portal-plus/coordenadores/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('nome' in b) data.nome = String(b.nome).slice(0, 191)
    if ('email' in b) data.email = b.email || null
    if ('courseId' in b) data.courseId = Number(b.courseId)
    if ('ativo' in b) data.ativo = !!b.ativo
    return { coordenador: await prisma.acaCoordenador.update({ where: { id }, data }) }
  })

  // ───────── Admin: candidatos (link reusa o portal /candidato/:code existente) ─────────
  app.get('/api/admin/aca/portal-plus/candidatos', { preHandler: authMiddleware }, async (req) => {
    const q = String((req.query as any)?.q || '').trim()
    const regs = await prisma.enrollmentRegistration.findMany({
      where: q ? { OR: [{ candidateCode: { contains: q } }] } : {},
      orderBy: { id: 'desc' }, take: 50,
      select: { id: true, candidateCode: true, status: true, lead: { select: { nome: true } }, portal: { select: { slug: true } } },
    })
    return {
      candidatos: regs.map((r) => ({
        id: r.id, candidateCode: r.candidateCode, status: r.status,
        nome: r.lead?.nome ?? null, url: `${baseUrl(req)}/candidato/${r.candidateCode}`,
      })),
    }
  })

  // ───────── Página: Central do Coordenador ─────────
  app.get('/portal/aca/coordenador', async (req, reply) => {
    const p = verifyToken(tokOf(req), 'aca-coord')
    if (!p) return pageErr(reply, 403, 'Link inválido ou expirado', 'Solicite um novo acesso à secretaria.')
    const coord = await prisma.acaCoordenador.findUnique({ where: { id: p.id }, select: { nome: true, courseId: true } })
    if (!coord) return pageErr(reply, 404, 'Coordenador não encontrado')
    const course = await prisma.course.findUnique({ where: { id: coord.courseId }, select: { nome: true } })
    const offerings = await prisma.courseOffering.findMany({ where: { courseId: coord.courseId }, select: { id: true } })
    const turmas = await prisma.acaTurma.findMany({
      where: { courseOfferingId: { in: offerings.map((o) => o.id) } },
      orderBy: { id: 'desc' }, take: 100,
      select: { id: true, nome: true, ativo: true, periodoLetivo: { select: { codigo: true } } },
    })

    const blocos: string[] = []
    for (const t of turmas) {
      const [nAlunos, diarios] = await Promise.all([
        prisma.acaMatricula.count({ where: { turmaId: t.id, status: { in: ['MATRICULADO', 'CONCLUIDO', 'TRANCADO'] as any } } }),
        prisma.acaDiario.findMany({ where: { turmaId: t.id }, select: { id: true, disciplinaId: true } }),
      ])
      const discIds = [...new Set(diarios.map((d) => d.disciplinaId))]
      const discs = discIds.length ? await prisma.acaDisciplina.findMany({ where: { id: { in: discIds } }, select: { id: true, nome: true } }) : []
      const dMap = new Map(discs.map((d) => [d.id, d.nome]))
      const linhasDisc: string[] = []
      for (const d of diarios) {
        const aulas = await prisma.acaAula.findMany({ where: { diarioId: d.id }, orderBy: { data: 'desc' }, take: 3, select: { data: true, conteudo: true, quantidadeAulas: true } })
        const totalAulas = await prisma.acaAula.aggregate({ where: { diarioId: d.id }, _sum: { quantidadeAulas: true } })
        const ultimas = aulas.length === 0 ? '<span style="color:#9ca3af">sem aulas registradas</span>' : aulas.map((a) => `${new Date(a.data).toLocaleDateString('pt-BR')}: ${esc((a.conteudo || '').slice(0, 80) || '—')}`).join('<br>')
        linhasDisc.push(`<tr><td><b>${esc(dMap.get(d.disciplinaId) || '—')}</b><span class="block" style="font-size:12px;color:#9ca3af">${totalAulas._sum.quantidadeAulas || 0} aula(s) registradas</span></td><td style="font-size:13px">${ultimas}</td></tr>`)
      }
      blocos.push(`<div class="card"><h2 style="margin-top:0">${esc(t.nome)} <span class="badge">${esc(t.periodoLetivo?.codigo || '')}</span>${t.ativo ? '' : ' <span class="badge no">inativa</span>'}</h2>
        <p class="sub">${nAlunos} aluno(s) · conteúdo ministrado (últimos registros):</p>
        ${linhasDisc.length ? `<table><tbody>${linhasDisc.join('')}</tbody></table>` : '<p class="sub">Nenhum diário nesta turma.</p>'}</div>`)
    }

    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Central do Coordenador</title>${HEAD}</head><body>
      <h1>Olá, ${esc(coord.nome)}</h1>
      <p class="sub">Coordenação · ${esc(course?.nome || '—')} · ${turmas.length} turma(s)</p>
      ${blocos.join('') || '<div class="card"><p class="sub">Nenhuma turma vinculada às ofertas deste curso ainda.</p></div>'}
      <footer>Acesso seguro por link temporário.</footer></body></html>`)
  })

  // ───────── Página: Central do Responsável ─────────
  app.get('/portal/aca/responsavel', async (req, reply) => {
    const p = verifyToken(tokOf(req), 'aca-responsavel')
    if (!p) return pageErr(reply, 403, 'Link inválido ou expirado', 'Solicite um novo acesso à secretaria.')
    const resp = await prisma.acaResponsavel.findUnique({ where: { id: p.id }, select: { nome: true, parentesco: true, alunoId: true } })
    if (!resp) return pageErr(reply, 404, 'Responsável não encontrado')
    const aluno = await prisma.aluno.findUnique({ where: { id: resp.alunoId }, select: { ra: true, lead: { select: { nome: true } } } })
    if (!aluno) return pageErr(reply, 404, 'Aluno não encontrado')
    const tk = encodeURIComponent(tokOf(req))
    const [boletim, parcelas, eventos] = await Promise.all([boletimAluno(resp.alunoId), financeiroAluno(resp.alunoId), proximosEventosDoAluno(resp.alunoId)])

    const boletimHtml = boletim.length === 0 ? '<p class="sub">Sem disciplinas lançadas ainda.</p>' : boletim.map((t) => `
      <h2>${esc(t.turma)}</h2>
      <table><thead><tr><th>Disciplina</th><th class="r">Média</th><th class="r">Freq.</th><th class="r">Situação</th></tr></thead><tbody>
      ${t.disciplinas.map((d) => `<tr><td>${esc(d.nome)}</td><td class="r">${d.media != null ? d.media.toFixed(1) : '—'}</td><td class="r">${d.freqPct}%</td><td class="r">${d.situacao ? sitBadge(d.situacao) : '<span class="badge">Em curso</span>'}</td></tr>`).join('')}
      </tbody></table>`).join('')

    const finHtml = parcelas.length === 0 ? '<p class="sub">Nenhuma parcela registrada.</p>' : `
      <table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="r">Valor</th><th class="r">Situação</th><th></th></tr></thead><tbody>
      ${parcelas.map((pc) => {
        const sit = pc.situacao === 'PAGA' ? '<span class="badge ok">Paga</span>' : pc.situacao === 'VENCIDA' ? '<span class="badge no">Vencida</span>' : '<span class="badge warn">Em aberto</span>'
        const acao = pc.situacao !== 'PAGA' ? (pc.pixCopiaCola || pc.linhaDigitavel
          ? `<details><summary>2ª via</summary>${pc.linhaDigitavel ? `<p style="font-size:12px">Boleto:<br><code>${esc(pc.linhaDigitavel)}</code></p>` : ''}${pc.pixCopiaCola ? `<p style="font-size:12px">PIX:<br><code>${esc(pc.pixCopiaCola)}</code></p>` : ''}</details>`
          : `<form method="post" action="/api/public/aca/responsavel/parcela-cobranca?t=${tk}&id=${pc.id}" style="margin:0"><button class="sec" type="submit">Gerar 2ª via</button></form>`) : ''
        return `<tr><td>${pc.nroParcela}ª ${esc(pc.tipo)}</td><td>${new Date(pc.dataVencimento).toLocaleDateString('pt-BR')}</td><td class="r">${money(pc.valorBrutoCentavos)}</td><td class="r">${sit}</td><td class="r">${acao}</td></tr>`
      }).join('')}</tbody></table>`

    const EV_TIPO: Record<string, string> = { PROVA: '📝', FERIADO: '🏖️', MATRICULA: '📋', RECESSO: '☕', REUNIAO: '👥', EVENTO: '📌' }
    const eventosHtml = eventos.length === 0 ? '' : `<div class="card"><h2 style="margin-top:0">Próximas datas</h2><table><tbody>${eventos.map((e) => {
      const d = new Date(e.dataInicio); const ate = e.dataFim ? ` – ${new Date(e.dataFim).toLocaleDateString('pt-BR')}` : ''
      return `<tr><td style="width:90px;white-space:nowrap;color:#6b7280">${d.toLocaleDateString('pt-BR')}${ate}</td><td>${EV_TIPO[e.tipo] || '📌'} ${esc(e.titulo)}</td></tr>`
    }).join('')}</tbody></table></div>`

    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Central do Responsável</title>${HEAD}</head><body>
      <h1>Olá, ${esc(resp.nome)}</h1>
      <p class="sub">Acompanhando <b>${esc(aluno.lead.nome)}</b> (RA ${esc(aluno.ra || '—')})${resp.parentesco ? ` · ${esc(resp.parentesco)}` : ''}</p>
      ${eventosHtml}
      <div class="card"><h2 style="margin-top:0">Boletim do(a) aluno(a)</h2>${boletimHtml}</div>
      <div class="card"><h2 style="margin-top:0">Financeiro</h2>${finHtml}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <a href="/portal/aca/acordo?t=${tk}"><button class="sec" type="button">Negociar dívida</button></a>
          <form method="post" action="/api/public/aca/responsavel/doc-financeiro?t=${tk}" style="margin:0;display:flex;gap:6px;align-items:center">
            <input type="hidden" name="tipo" value="INFORME_IR">
            <select name="ano" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font:inherit">${[1, 2, 3].map((n) => new Date().getFullYear() - n).map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
            <button class="sec" type="submit">Informe para IR</button>
          </form>
          <form method="post" action="/api/public/aca/responsavel/doc-financeiro?t=${tk}" style="margin:0;display:flex;gap:6px;align-items:center">
            <input type="hidden" name="tipo" value="QUITACAO_ANUAL">
            <select name="ano" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font:inherit">${[1, 2, 3].map((n) => new Date().getFullYear() - n).map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
            <button class="sec" type="submit">Quitação anual</button>
          </form>
        </div>
        <p class="sub" style="font-size:12px;margin-top:8px">Quem paga a mensalidade é quem declara a despesa de instrução no imposto de renda — por isso os dois documentos ficam aqui.</p>
      </div>
      <footer>Acesso seguro por link temporário.</footer></body></html>`)
  })

  app.post('/api/public/aca/responsavel/parcela-cobranca', async (req, reply) => {
    const p = verifyToken(tokOf(req), 'aca-responsavel')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const resp = await prisma.acaResponsavel.findUnique({ where: { id: p.id }, select: { alunoId: true } })
    const parcelaId = numOf(req, 'id')
    const parcela = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { contrato: { select: { matricula: { select: { alunoId: true } } } } } })
    if (!resp || !parcela || parcela.contrato.matricula.alunoId !== resp.alunoId) return reply.code(403).send({ error: 'não autorizado' })
    await criarCobrancaAsaas(parcelaId).catch(() => {})
    reply.redirect(`/portal/aca/responsavel?t=${encodeURIComponent(tokOf(req))}`)
  })

  // ───────── Página: Central do Ex-aluno ─────────
  app.get('/portal/aca/exaluno', async (req, reply) => {
    const p = verifyToken(tokOf(req), 'aca-exaluno')
    if (!p) return pageErr(reply, 403, 'Link inválido ou expirado', 'Solicite um novo acesso à secretaria.')
    const concl = await prisma.acaMatricula.findFirst({ where: { alunoId: p.id, status: 'CONCLUIDO' }, select: { id: true, dataConclusao: true } })
    if (!concl) return pageErr(reply, 403, 'Acesso restrito', 'A Central do Ex-aluno é exclusiva para egressos.')
    const tk = encodeURIComponent(tokOf(req))
    const [hist, docs] = await Promise.all([
      montarHistorico(p.id),
      prisma.acaDocumento.findMany({ where: { alunoId: p.id }, orderBy: { emitidoEm: 'desc' } }),
    ])

    const histHtml = !hist || hist.periodos.length === 0 ? '<p class="sub">Histórico ainda não disponível.</p>' : hist.periodos.map((per: any) => `
      <h2>${esc(per.periodo)} — ${esc(per.turma)}</h2>
      <table><thead><tr><th>Disciplina</th><th class="r">CH</th><th class="r">Média</th><th class="r">Situação</th></tr></thead><tbody>
      ${per.disciplinas.map((d: any) => `<tr><td>${esc(d.nome)}</td><td class="r">${d.cargaHoraria}h</td><td class="r">${d.media != null ? Number(d.media).toFixed(1) : '—'}</td><td class="r">${d.situacao ? sitBadge(d.situacao) : '—'}</td></tr>`).join('')}
      </tbody></table>`).join('') + `<p class="sub" style="margin-top:10px">Carga horária total: <b>${hist.chTotal}h</b> · Curso: ${esc(hist.curso)}</p>`

    const docsLista = docs.length === 0 ? '<p class="sub">Nenhum documento emitido ainda.</p>' : `<ul>${docs.map((d) => `<li><a href="/api/public/aca/portal-plus/doc?t=${tk}&id=${d.id}" target="_blank">${esc(d.titulo)}</a> <span class="badge">${esc(d.numero)}</span></li>`).join('')}</ul>`
    const emitir = `<form method="post" action="/api/public/aca/exaluno/emitir-documento?t=${tk}" style="margin-bottom:10px"><input type="hidden" name="tipo" value="HISTORICO"><button class="sec" type="submit">Emitir 2ª via do histórico</button></form>`

    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Central do Ex-aluno</title>${HEAD}</head><body>
      <h1>Bem-vindo(a) de volta</h1>
      <p class="sub">${esc(hist?.aluno?.nome || '')} · RA ${esc(hist?.aluno?.ra || '—')}${concl.dataConclusao ? ` · concluído em ${new Date(concl.dataConclusao).toLocaleDateString('pt-BR')}` : ''}</p>
      <div class="card"><h2 style="margin-top:0">Histórico escolar</h2>${histHtml}</div>
      <div class="card"><h2 style="margin-top:0">Documentos</h2>${emitir}${docsLista}</div>
      <footer>Acesso seguro por link temporário.</footer></body></html>`)
  })

  /**
   * Documentos financeiros pedidos pelo responsável.
   *
   * Só os dois que dizem respeito a quem paga: informe para o IR e quitação
   * anual. Histórico e boletim continuam sendo do aluno — o responsável
   * acompanha, não é titular do registro acadêmico.
   */
  app.post('/api/public/aca/responsavel/doc-financeiro', async (req, reply) => {
    const tok = tokOf(req)
    const p = verifyToken(tok, 'aca-responsavel')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const resp = await prisma.acaResponsavel.findUnique({ where: { id: p.id }, select: { alunoId: true } })
    if (!resp) return pageErr(reply, 404, 'Responsável não encontrado')

    const b = (req.body as any) || {}
    const tipo = String(b.tipo || '')
    const ano = Number(b.ano) || new Date().getFullYear() - 1
    if (!['INFORME_IR', 'QUITACAO_ANUAL'].includes(tipo)) return reply.code(400).send({ error: 'tipo não permitido' })

    try {
      const doc = tipo === 'INFORME_IR'
        ? await emitirInformeIR(resp.alunoId, ano, null)
        : await emitirQuitacaoAnual(resp.alunoId, ano, null)
      return reply.redirect(`/api/public/aca/portal-plus/doc?t=${encodeURIComponent(tok)}&id=${doc.id}`, 303)
    } catch (e: any) {
      return pageErr(reply, 400, 'Não foi possível emitir', e?.message || '')
    }
  })

  app.post('/api/public/aca/exaluno/emitir-documento', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-exaluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const tipo = String((req.body as any)?.tipo || '')
    if (!['HISTORICO', 'DECLARACAO_MATRICULA'].includes(tipo)) return reply.code(400).send({ error: 'tipo não permitido' })
    try {
      const doc = await emitirDocumentoAluno(tipo as DocTipo, p.id, null)
      return reply.redirect(`/api/public/aca/portal-plus/doc?t=${encodeURIComponent(tok)}&id=${doc.id}`, 303)
    } catch (e: any) { return pageErr(reply, 400, 'Não foi possível emitir', e?.message || '') }
  })

  // ───────── Download de documento (responsável | ex-aluno) ─────────
  app.get('/api/public/aca/portal-plus/doc', async (req, reply) => {
    const tok = tokOf(req)
    const pr = verifyToken(tok, 'aca-responsavel')
    const pe = verifyToken(tok, 'aca-exaluno')
    let alunoId: number | null = null
    if (pr) { const r = await prisma.acaResponsavel.findUnique({ where: { id: pr.id }, select: { alunoId: true } }); alunoId = r?.alunoId ?? null }
    else if (pe) alunoId = pe.id
    if (alunoId == null) return reply.code(403).send({ error: 'token inválido' })
    const doc = await prisma.acaDocumento.findUnique({ where: { id: numOf(req, 'id') } })
    if (!doc || doc.alunoId !== alunoId) return reply.code(403).send({ error: 'não autorizado' })
    const { renderDocumentoPdf } = await import('../services/acaDocRender.js')
    const pdf = await renderDocumentoPdf(doc)
    if (!pdf) return reply.code(400).send({ error: 'tipo inválido' })
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${doc.numero.replace('/', '-')}.pdf"`).send(pdf)
  })
}
