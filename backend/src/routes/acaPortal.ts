// src/routes/acaPortal.ts
// Módulo Acadêmico · P8 — Portais (aluno e professor) por magic link.
// Token STATELESS assinado por HMAC (igual titular.ts), sem tabela nova.
//   Aluno (read): boletim, frequência, financeiro (2ª via Asaas), documentos.
//   Professor: lista de turmas/diários + lançamento de chamada e notas (forms SSR).
// Páginas públicas em /portal/aca/*, ações em /api/public/aca/* (bypass de auth).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { criarCobrancaParcela } from '../services/acaFinanceiro.js'
import { mintPortalToken as mintToken, verifyPortalToken as verifyToken } from '../lib/acaPortalToken.js'
import { statusBloqueio } from '../services/acaBloqueio.js'
import { emitirDocumentoAluno, emitirQuitacaoAnual, emitirCarteirinha, type DocTipo } from '../services/acaDocumentos.js'
import { proximoProtocolo } from './acaRequerimento.js'
import { contratoAtivoDoAluno, dadosContrato, registrarAceite } from '../services/acaContrato.js'
import { ofertasAbertas, previewTermoRematricula, efetivarRematricula } from '../services/acaRematricula.js'
import { proximosEventosDoAluno } from './acaCalendario.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { gradeDoAluno, DIAS } from './acaHorario.js'
import { materiaisDoAluno } from './acaMaterial.js'
import { resumoHoras } from './acaEstagio.js'

export function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
export function baseUrl(req: any): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  return `${proto.split(',')[0]}://${req.headers.host}`
}
export const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<link rel="manifest" href="/portal/aca/manifest.webmanifest"><meta name="theme-color" content="#111827">
<link rel="apple-touch-icon" href="/portal/aca/icon.svg"><meta name="apple-mobile-web-app-capable" content="yes">
<script>if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/portal/aca/sw.js',{scope:'/portal/aca/'}).catch(function(){})})</script>
<style>
:root{color-scheme:light}*{box-sizing:border-box}
body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:28px auto;padding:0 16px;color:#1f2937;background:#f7f8fa}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 8px;color:#374151}
p.sub{color:#5f6368;margin:0 0 18px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04);margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #eef0f3}
th{font-size:12px;color:#6b7280;font-weight:600}td.r,th.r{text-align:right}
.badge{display:inline-block;font-size:12px;padding:2px 9px;border-radius:999px;background:#eef1f4;color:#374151}
.ok{background:#dcfce7;color:#14532d}.warn{background:#fef9c3;color:#854d0e}.no{background:#fde8e8;color:#a11}
button,input[type=submit]{padding:8px 13px;border:0;border-radius:8px;background:#1a73e8;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
button.sec{background:#eef1f4;color:#1f2937}
input[type=number]{width:64px;padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font:inherit;text-align:center}
input[type=checkbox]{width:18px;height:18px}
a{color:#1a73e8}code{background:#f3f4f6;padding:2px 6px;border-radius:5px;font-size:12px;word-break:break-all}
footer{text-align:center;color:#9ca3af;font-size:13px;margin-top:20px}
.tabs a{margin-right:10px;font-size:14px;text-decoration:none}
</style>`

const SIT_LABEL: Record<string, string> = { APROVADO: 'Aprovado', RECUPERACAO: 'Recuperação', REPROVADO_NOTA: 'Reprovado (nota)', REPROVADO_FREQUENCIA: 'Reprovado (freq.)', REPROVADO: 'Reprovado', EM_ANDAMENTO: 'Cursando' }
export function sitBadge(s: string) { const cls = s === 'APROVADO' ? 'ok' : s === 'RECUPERACAO' ? 'warn' : s.startsWith('REPROVADO') ? 'no' : ''; return `<span class="badge ${cls}">${SIT_LABEL[s] || s}</span>` }
export const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Boletim AO VIVO do aluno: por matrícula ativa → disciplinas (média/freq/situação). */
export async function boletimAluno(alunoId: number) {
  const mats = await prisma.acaMatricula.findMany({
    where: { alunoId, status: { in: ['MATRICULADO', 'CONCLUIDO', 'TRANCADO'] as any } },
    select: { id: true, turmaId: true, turma: { select: { nome: true } } },
    orderBy: { dataMatricula: 'asc' },
  })
  const out: Array<{ turma: string; disciplinas: Array<{ nome: string; media: number | null; freqPct: number; situacao: string | null }> }> = []
  for (const m of mats) {
    const diarios = await prisma.acaDiario.findMany({ where: { turmaId: m.turmaId }, select: { id: true, disciplinaId: true } })
    if (!diarios.length) continue
    const discs = await prisma.acaDisciplina.findMany({ where: { id: { in: [...new Set(diarios.map((d) => d.disciplinaId))] } }, select: { id: true, nome: true } })
    const dNome = new Map(discs.map((d) => [d.id, d.nome]))
    const resultados = await prisma.acaResultado.findMany({ where: { diarioId: { in: diarios.map((d) => d.id) }, matriculaId: m.id } })
    const resByDiario = new Map(resultados.map((r) => [r.diarioId, r]))
    const disciplinas = []
    for (const d of diarios) {
      const avaliacoes = await prisma.acaAvaliacao.findMany({ where: { diarioId: d.id } })
      const notas = avaliacoes.length ? await prisma.acaNota.findMany({ where: { avaliacaoId: { in: avaliacoes.map((a) => a.id) }, matriculaId: m.id } }) : []
      const notaByAval = new Map(notas.map((n) => [n.avaliacaoId, n.valor]))
      let soma = 0, somaPeso = 0
      for (const a of avaliacoes) { const v = notaByAval.get(a.id); if (v != null) { soma += v * a.peso; somaPeso += a.peso } }
      const media = somaPeso > 0 ? Math.round((soma / somaPeso) * 10) / 10 : null
      const aulas = await prisma.acaAula.findMany({ where: { diarioId: d.id }, select: { id: true, quantidadeAulas: true } })
      const totalAulas = aulas.reduce((s, a) => s + a.quantidadeAulas, 0)
      const qtdByAula = new Map(aulas.map((a) => [a.id, a.quantidadeAulas]))
      const freqs = aulas.length ? await prisma.acaFrequencia.findMany({ where: { aulaId: { in: aulas.map((a) => a.id) }, matriculaId: m.id, presente: false } }) : []
      const faltas = freqs.reduce((s, f) => s + (qtdByAula.get(f.aulaId) || 1), 0)
      const freqPct = totalAulas > 0 ? Math.round(((totalAulas - faltas) / totalAulas) * 100) : 100
      disciplinas.push({ nome: dNome.get(d.disciplinaId) || '—', media, freqPct, situacao: resByDiario.get(d.id)?.situacao ?? null })
    }
    out.push({ turma: m.turma.nome, disciplinas })
  }
  return out
}

/** Parcelas do aluno (todas as matrículas com contrato). */
export async function financeiroAluno(alunoId: number) {
  const mats = await prisma.acaMatricula.findMany({ where: { alunoId }, select: { id: true } })
  const contratos = await prisma.acaContrato.findMany({ where: { matriculaId: { in: mats.map((m) => m.id) } }, select: { id: true } })
  if (!contratos.length) return []
  return prisma.acaParcela.findMany({ where: { contratoId: { in: contratos.map((c) => c.id) } }, orderBy: [{ dataVencimento: 'asc' }] })
}

/**
 * Quem é o aluno desta requisição.
 *
 * Primeiro a sessão em cookie (a porta nova); se não houver, o token na URL,
 * que continua valendo para os links de aviso já enviados. Sem esse fallback,
 * toda mensagem de vencimento no WhatsApp de ontem viraria "link inválido".
 */
async function alunoDaReq(req: any): Promise<{ id: number } | null> {
  const conta = await contaDaRequisicao(req)
  if (conta) {
    const a = await prisma.aluno.findUnique({ where: { leadId: conta.leadId }, select: { id: true } })
    if (a) return { id: a.id }
  }
  // tokOf mora dentro de acaPortalRoutes; aqui o token é lido direto da query.
  return verifyToken((req.query?.t as string) || '', 'aca-aluno')
}

export async function acaPortalRoutes(app: FastifyInstance) {
  // Forms SSR do professor/aluno enviam x-www-form-urlencoded. Parser escopado
  // ao plugin (vira objeto chave→valor; campos repetidos viram array).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, any> = {}
      for (const [k, v] of new URLSearchParams(body as string)) { if (k in out) { out[k] = ([] as any[]).concat(out[k], v) } else out[k] = v }
      done(null, out)
    } catch (e) { done(e as Error, undefined) }
  })

  // Token vem por QUERY STRING (?t=...): params de rota com '~'/base64 longo
  // não casam de forma confiável no find-my-way (mesma ressalva do titular.ts).
  const tokOf = (req: any) => (req.query?.t as string) || ''
  const numOf = (req: any, k: string) => Number(req.query?.[k])

  // ───────── Admin: gerar magic link ─────────
  app.post('/api/admin/aca/portal/link', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const tipo = b.tipo === 'professor' ? 'aca-prof' : 'aca-aluno'
    const id = Number(b.id); const dias = Math.min(Math.max(Number(b.dias) || 30, 1), 365)
    if (!id) return reply.code(400).send({ error: 'id obrigatório' })
    if (tipo === 'aca-aluno' && !(await prisma.aluno.findUnique({ where: { id }, select: { id: true } }))) return reply.code(404).send({ error: 'Aluno não encontrado' })
    const token = mintToken(tipo as any, id, dias)
    const path = tipo === 'aca-prof' ? 'professor' : 'aluno'
    return { url: `${baseUrl(req)}/portal/aca/${path}?t=${encodeURIComponent(token)}`, token, expiraEm: new Date(Date.now() + dias * 86400_000) }
  })

  const pageErr = (reply: any, code: number, titulo: string, sub = '') =>
    reply.code(code).type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>${titulo}</title>${HEAD}</head><body><div class="card"><h1>${titulo}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></body></html>`)

  // ───────── Página: Portal do Aluno ─────────
  app.get('/portal/aca/aluno', async (req, reply) => {
    const p = await alunoDaReq(req)
    if (!p) return pageErr(reply, 403, 'Link inválido ou expirado', 'Solicite um novo acesso à secretaria.')
    const aluno = await prisma.aluno.findUnique({ where: { id: p.id }, select: { ra: true, lead: { select: { nome: true } } } })
    if (!aluno) return pageErr(reply, 404, 'Aluno não encontrado')
    const [boletim, parcelas, docs, bloq, reqTipos, reqs] = await Promise.all([
      boletimAluno(p.id), financeiroAluno(p.id),
      prisma.acaDocumento.findMany({ where: { alunoId: p.id }, orderBy: { emitidoEm: 'desc' } }),
      statusBloqueio(p.id),
      prisma.acaRequerimentoTipo.findMany({ where: { ativo: true }, orderBy: [{ ordem: 'asc' }] }),
      prisma.acaRequerimento.findMany({ where: { alunoId: p.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ])
    const tk = encodeURIComponent(tokOf(req))

    const bannerHtml = bloq.bloqueado ? `<div class="card" style="background:#fde8e8;border-color:#f5b5b5"><b style="color:#a11">Acesso acadêmico suspenso por pendência financeira.</b><div style="font-size:13px;color:#7a1f1f;margin-top:4px">${esc(bloq.motivo || '')}. Regularize as parcelas abaixo para liberar o boletim.</div></div>` : ''
    const boletimHtml = bloq.bloqueado ? '<p class="sub">🔒 Boletim indisponível enquanto houver pendência financeira.</p>' : boletim.length === 0 ? '<p class="sub">Sem disciplinas lançadas ainda.</p>' : boletim.map((t) => `
      <h2>${esc(t.turma)}</h2>
      <table><thead><tr><th>Disciplina</th><th class="r">Média</th><th class="r">Freq.</th><th class="r">Situação</th></tr></thead><tbody>
      ${t.disciplinas.map((d) => `<tr><td>${esc(d.nome)}</td><td class="r">${d.media != null ? d.media.toFixed(1) : '—'}</td><td class="r">${d.freqPct}%</td><td class="r">${d.situacao ? sitBadge(d.situacao) : '<span class="badge">Em curso</span>'}</td></tr>`).join('')}
      </tbody></table>`).join('')

    // Contrato (aceite digital · O2.3)
    const contratoId = await contratoAtivoDoAluno(p.id)
    const contrato = contratoId ? await dadosContrato(contratoId) : null
    const contratoHtml = !contrato ? '' : `<div class="card"><h2 style="margin-top:0">Contrato</h2>${contrato.aceiteEm
      ? `<p class="sub"><span class="badge ok">Aceito</span> em ${new Date(contrato.aceiteEm).toLocaleString('pt-BR')}${contrato.aceiteNome ? ` por ${esc(contrato.aceiteNome)}` : ''}</p><details><summary>Ver termo</summary><pre style="white-space:pre-wrap;font:13px/1.5 system-ui;color:#374151;background:#f7f8fa;padding:12px;border-radius:8px">${esc(contrato.termo)}</pre></details>`
      : `<p class="sub"><span class="badge warn">Pendente de aceite</span></p><pre style="white-space:pre-wrap;font:13px/1.5 system-ui;color:#374151;background:#f7f8fa;padding:12px;border-radius:8px;max-height:280px;overflow:auto">${esc(contrato.termo)}</pre>
        <form method="post" action="/api/public/aca/aluno/aceitar-contrato?t=${tk}&id=${contrato.id}" style="margin-top:8px">
          <label style="display:block;font-size:13px;margin-bottom:6px"><input type="checkbox" required> Li e concordo com os termos do contrato.</label>
          <input type="text" name="nome" required placeholder="Digite seu nome completo para assinar" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:6px">
          <button type="submit">Aceitar contrato</button>
        </form>`}</div>`

    const finHtml = parcelas.length === 0 ? '<p class="sub">Nenhuma parcela registrada.</p>' : `
      <table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="r">Valor</th><th class="r">Situação</th><th></th></tr></thead><tbody>
      ${parcelas.map((pc) => {
        const sit = pc.situacao === 'PAGA' ? '<span class="badge ok">Paga</span>' : pc.situacao === 'VENCIDA' ? '<span class="badge no">Vencida</span>' : '<span class="badge warn">Em aberto</span>'
        const acao = pc.situacao !== 'PAGA' ? (pc.pixCopiaCola || pc.linhaDigitavel
          ? `<details><summary>2ª via</summary>${pc.linhaDigitavel ? `<p style="font-size:12px">Boleto:<br><code>${esc(pc.linhaDigitavel)}</code></p>` : ''}${pc.pixCopiaCola ? `<p style="font-size:12px">PIX copia-e-cola:<br><code>${esc(pc.pixCopiaCola)}</code></p>` : ''}</details>`
          : `<form method="post" action="/api/public/aca/aluno/parcela-cobranca?t=${tk}&id=${pc.id}" style="margin:0"><button class="sec" type="submit">Gerar 2ª via</button></form>`) : ''
        return `<tr><td>${pc.nroParcela}ª ${esc(pc.tipo)}</td><td>${new Date(pc.dataVencimento).toLocaleDateString('pt-BR')}</td><td class="r">${money(pc.valorBrutoCentavos)}</td><td class="r">${sit}</td><td class="r">${acao}</td></tr>`
      }).join('')}</tbody></table>`

    // A lei fala do exercício ANTERIOR; oferecemos os três últimos por praxe.
    const anoAtual = new Date().getFullYear()
    const anosQuitacao = [anoAtual - 1, anoAtual - 2, anoAtual - 3]
    const docsLista = docs.length === 0 ? '<p class="sub">Nenhum documento emitido ainda.</p>' : `<ul>${docs.map((d) => `<li><a href="/api/public/aca/aluno/doc?t=${tk}&id=${d.id}" target="_blank">${esc(d.titulo)}</a> <span class="badge">${esc(d.numero)}</span></li>`).join('')}</ul>`
    const emitirForm = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <form method="post" action="/api/public/aca/aluno/emitir-documento?t=${tk}" style="margin:0"><input type="hidden" name="tipo" value="DECLARACAO_MATRICULA"><button class="sec" type="submit">Atestado de matrícula</button></form>
      <form method="post" action="/api/public/aca/aluno/emitir-documento?t=${tk}" style="margin:0"><input type="hidden" name="tipo" value="DECLARACAO_FREQUENCIA"><button class="sec" type="submit">Atestado de frequência</button></form>
      <form method="post" action="/api/public/aca/aluno/emitir-documento?t=${tk}" style="margin:0"><input type="hidden" name="tipo" value="HISTORICO"><button class="sec" type="submit">Histórico escolar</button></form>
      <form method="post" action="/api/public/aca/aluno/emitir-documento?t=${tk}" style="margin:0"><input type="hidden" name="tipo" value="CARTEIRINHA"><button class="sec" type="submit">Carteirinha</button></form>
      <form method="post" action="/api/public/aca/aluno/emitir-documento?t=${tk}" style="margin:0;display:flex;gap:6px;align-items:center">
        <input type="hidden" name="tipo" value="QUITACAO_ANUAL">
        <select name="ano" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font:inherit">${anosQuitacao.map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
        <button class="sec" type="submit">Quitação anual</button>
      </form>
      <form method="post" action="/api/public/aca/aluno/informe-ir?t=${tk}" style="margin:0;display:flex;gap:6px;align-items:center">
        <select name="ano" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font:inherit">${anosQuitacao.map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
        <button class="sec" type="submit">Informe para IR</button>
      </form>
    </div>
    <p class="sub" style="margin:-4px 0 10px;font-size:13px">A declaração de quitação (Lei 12.007/09) só é emitida se todas as parcelas do ano estiverem pagas. O informe para o Imposto de Renda lista o que foi efetivamente pago no ano — vale mesmo com parcelas em aberto.</p>`
    const docsHtml = `${emitirForm}${docsLista}`

    // Horários (O2.6) — grade da turma
    const grade = await gradeDoAluno(p.id)
    const gradeHtml = grade.length === 0 ? '' : (() => {
      const porDia = new Map<number, any[]>()
      for (const h of grade) (porDia.get(h.diaSemana) ?? porDia.set(h.diaSemana, []).get(h.diaSemana)!).push(h)
      const dias = [...porDia.keys()].sort()
      return `<div class="card"><h2 style="margin-top:0">Horário das aulas</h2><table><tbody>${dias.map((d) => `<tr><td style="width:90px;color:#6b7280;vertical-align:top">${esc(DIAS[d] || '')}</td><td>${porDia.get(d)!.map((h) => `${esc(h.horaInicio)}–${esc(h.horaFim)} <b>${esc(h.disciplinaNome)}</b>${h.sala ? ` · sala ${esc(h.sala)}` : ''}${h.professorNome ? ` · ${esc(h.professorNome)}` : ''}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`
    })()

    // Estágio + atividades (O2.9)
    const horas = await resumoHoras(p.id)
    const ativs = await prisma.acaAtividadeComplementar.findMany({ where: { alunoId: p.id }, orderBy: { createdAt: 'desc' }, take: 20 })
    const barra = (h: number, m: number) => { const pct = m > 0 ? Math.min(100, Math.round((h / m) * 100)) : 0; return `<div style="height:8px;border-radius:4px;background:#eef1f4;overflow:hidden"><div style="height:100%;width:${pct}%;background:${h >= m ? '#16a34a' : '#1a73e8'}"></div></div>` }
    const AT_STATUS: Record<string, string> = { PENDENTE: '<span class="badge warn">Em análise</span>', APROVADA: '<span class="badge ok">Aprovada</span>', REJEITADA: '<span class="badge no">Rejeitada</span>' }
    const horasHtml = `<div class="card"><h2 style="margin-top:0">Estágio e atividades</h2>
      <div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>Estágio supervisionado</span><span><b>${horas.estagio.horas}</b>/${horas.estagio.meta}h</span></div>${barra(horas.estagio.horas, horas.estagio.meta)}</div>
      <div><div style="display:flex;justify-content:space-between;font-size:13px"><span>Atividades complementares</span><span><b>${horas.atividades.horas}</b>/${horas.atividades.meta}h</span></div>${barra(horas.atividades.horas, horas.atividades.meta)}</div>
      ${ativs.length ? `<table style="margin-top:10px"><tbody>${ativs.map((a) => `<tr><td>${esc(a.titulo)}<span class="block" style="font-size:12px;color:#9ca3af">${a.horas}h${a.categoria ? ' · ' + esc(a.categoria) : ''}</span></td><td class="r">${AT_STATUS[a.status] || a.status}</td></tr>`).join('')}</tbody></table>` : ''}
      <form method="post" action="/api/public/aca/aluno/atividade?t=${tk}" style="margin-top:10px;display:grid;gap:6px">
        <input type="text" name="titulo" required placeholder="Atividade (palestra, curso, evento…)" style="padding:8px;border:1px solid #d1d5db;border-radius:6px">
        <div style="display:flex;gap:6px"><input type="number" name="horas" required placeholder="Horas" style="width:90px;padding:8px;border:1px solid #d1d5db;border-radius:6px"><input type="text" name="comprovanteUrl" placeholder="Link do comprovante (opcional)" style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:6px"></div>
        <div><button class="sec" type="submit">Enviar para análise</button></div>
      </form></div>`

    // Materiais (O2.7)
    const materiais = await materiaisDoAluno(p.id)
    const MAT_ICO: Record<string, string> = { LINK: '🔗', ARQUIVO: '📄', VIDEO: '🎬' }
    const materiaisHtml = materiais.length === 0 ? '' : `<div class="card"><h2 style="margin-top:0">Materiais de estudo</h2>${materiais.map((g) => `<div style="margin-bottom:8px"><div style="font-size:13px;font-weight:600;color:#374151">${esc(g.disciplina)}</div><ul style="margin:4px 0">${g.itens.map((m: any) => `<li>${MAT_ICO[m.tipo] || '🔗'} <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.titulo)}</a>${m.descricao ? ` <span style="font-size:12px;color:#9ca3af">— ${esc(m.descricao)}</span>` : ''}</li>`).join('')}</ul></div>`).join('')}</div>`

    // Calendário (O2.5) — próximas datas
    const eventos = await proximosEventosDoAluno(p.id)
    const EV_TIPO: Record<string, string> = { PROVA: '📝', FERIADO: '🏖️', MATRICULA: '📋', RECESSO: '☕', REUNIAO: '👥', EVENTO: '📌' }
    const eventosHtml = eventos.length === 0 ? '' : `<div class="card"><h2 style="margin-top:0">Próximas datas</h2><table><tbody>${eventos.map((e) => {
      const d = new Date(e.dataInicio)
      const ate = e.dataFim ? ` – ${new Date(e.dataFim).toLocaleDateString('pt-BR')}` : ''
      return `<tr><td style="width:90px;white-space:nowrap;color:#6b7280">${d.toLocaleDateString('pt-BR')}${ate}</td><td>${EV_TIPO[e.tipo] || '📌'} ${esc(e.titulo)}${e.descricao ? `<span class="block" style="font-size:12px;color:#9ca3af">${esc(e.descricao)}</span>` : ''}</td></tr>`
    }).join('')}</tbody></table></div>`

    // Rematrícula online (O2.4) — ofertas abertas
    const ofertas = await ofertasAbertas(p.id)
    const ofertasHtml = ofertas.length === 0 ? '' : `<div class="card"><h2 style="margin-top:0">Matrícula / Rematrícula</h2>
      <table><thead><tr><th>Curso / turma</th><th>Período</th><th class="r">Mensalidade</th><th></th></tr></thead><tbody>
      ${ofertas.map((o) => `<tr><td>${esc(o.curso)}<span class="block" style="font-size:12px;color:#6b7280">${esc(o.nome)}</span></td><td>${esc(o.periodo)}</td><td class="r">${o.temPlano ? (o.valorParcela / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '/mês' : '—'}</td><td class="r">${o.lotada ? '<span class="badge warn">Lotada</span>' : o.temPlano ? `<a href="/portal/aca/aluno/rematricula?t=${tk}&turma=${o.turmaId}">Matricular →</a>` : '<span class="badge">Sem plano</span>'}</td></tr>`).join('')}
      </tbody></table></div>`

    const REQ_STATUS: Record<string, string> = { ABERTO: 'Aberto', EM_ANALISE: 'Em análise', DEFERIDO: 'Deferido', INDEFERIDO: 'Indeferido', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado' }
    const reqLista = reqs.length === 0 ? '<p class="sub">Nenhuma solicitação ainda.</p>' : `<table><thead><tr><th>Protocolo</th><th>Tipo</th><th>Data</th><th class="r">Situação</th></tr></thead><tbody>${reqs.map((r) => {
      const cls = r.status === 'DEFERIDO' || r.status === 'CONCLUIDO' ? 'ok' : r.status === 'INDEFERIDO' || r.status === 'CANCELADO' ? 'no' : 'warn'
      const doc = r.documentoId ? ` <a href="/api/public/aca/aluno/doc?t=${tk}&id=${r.documentoId}" target="_blank">baixar</a>` : ''
      const resp = r.resposta ? `<div style="font-size:12px;color:#555;margin-top:2px">${esc(r.resposta)}${doc}</div>` : doc
      return `<tr><td><code>${esc(r.protocolo)}</code></td><td>${esc(r.tipoNome)}${resp}</td><td>${new Date(r.createdAt).toLocaleDateString('pt-BR')}</td><td class="r"><span class="badge ${cls}">${REQ_STATUS[r.status] || r.status}</span></td></tr>`
    }).join('')}</tbody></table>`
    const reqForm = reqTipos.length === 0 ? '' : `<form method="post" action="/api/public/aca/aluno/requerimentos?t=${tk}" style="margin-bottom:12px;display:grid;gap:6px">
      <select name="tipoId" required style="padding:9px;border:1px solid #d1d5db;border-radius:8px">${reqTipos.map((t) => `<option value="${t.id}">${esc(t.nome)} (prazo ${t.slaDias}d)</option>`).join('')}</select>
      <input type="text" name="assunto" required maxlength="180" placeholder="Assunto" style="padding:9px;border:1px solid #d1d5db;border-radius:8px">
      <textarea name="descricao" placeholder="Descreva sua solicitação (opcional)"></textarea>
      <div><button type="submit">Abrir solicitação</button></div>
    </form>`

    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Portal do Aluno</title>${HEAD}</head><body>
      <h1>Olá, ${esc(aluno.lead.nome)}</h1>
      <p class="sub">RA ${esc(aluno.ra || '—')} · Portal do Aluno</p>
      ${bannerHtml}
      ${gradeHtml}
      ${eventosHtml}
      <div class="card"><h2 style="margin-top:0">Boletim</h2>${boletimHtml}</div>
      ${contratoHtml}
      <div class="card"><h2 style="margin-top:0">Financeiro</h2>${finHtml}</div>
      <div class="card"><h2 style="margin-top:0">Documentos</h2>${docsHtml}</div>
      <div class="card"><h2 style="margin-top:0">Negociar dívida</h2>
        <p class="sub" style="font-size:13px">Parcelas em atraso podem ser renegociadas aqui mesmo, dentro das condições que a instituição definiu.</p>
        <a href="/portal/aca/acordo?t=${tk}"><button class="sec" type="button">Ver condições</button></a>
      </div>
      <div class="card"><h2 style="margin-top:0">Sua conta</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <a href="/api/public/aca/aluno/agenda.ics?t=${tk}"><button class="sec" type="button">Assinar calendário (.ics)</button></a>
          <a href="/portal/aca/senha?t=${tk}"><button class="sec" type="button">Criar/trocar senha</button></a>
          <button class="sec" type="button" id="btn-push">Ativar notificações</button>
        </div>
        <p class="sub" id="push-msg" style="font-size:12px;margin-top:6px"></p>
        <script>
        // Assinatura de push: só roda se o navegador suportar e a instituição
        // tiver configurado as chaves. Falha aqui não pode quebrar a página.
        (function () {
          var btn = document.getElementById('btn-push')
          var msg = document.getElementById('push-msg')
          var tk = ${JSON.stringify(tokOf(req))}
          if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            btn.disabled = true; msg.textContent = 'Este navegador não suporta notificações.'
            return
          }
          function b64(base64) {
            var pad = '='.repeat((4 - base64.length % 4) % 4)
            var raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
            return Uint8Array.from(raw, function (c) { return c.charCodeAt(0) })
          }
          btn.addEventListener('click', function () {
            btn.disabled = true; msg.textContent = 'Pedindo permissão…'
            fetch('/api/public/aca/push/chave?t=' + encodeURIComponent(tk))
              .then(function (r) { if (!r.ok) throw new Error('indisponivel'); return r.json() })
              .then(function (cfg) {
                return navigator.serviceWorker.register('/portal/aca/sw.js', { scope: '/portal/aca/' })
                  .then(function (reg) { return navigator.serviceWorker.ready.then(function () { return reg }) })
                  .then(function (reg) {
                    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.publicKey) })
                  })
              })
              .then(function (sub) {
                var j = sub.toJSON()
                return fetch('/api/public/aca/push/inscrever?t=' + encodeURIComponent(tk), {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
                })
              })
              .then(function () { msg.textContent = 'Notificações ativadas neste aparelho.' })
              .catch(function (e) {
                btn.disabled = false
                msg.textContent = e && e.message === 'indisponivel'
                  ? 'A instituição ainda não ativou as notificações.'
                  : 'Não foi possível ativar. Verifique a permissão do navegador.'
              })
          })
        })()
        </script>
        <p class="sub" style="font-size:13px;margin-top:8px">Com uma senha você entra pelo endereço do portal usando CPF ou RA, sem depender de achar este link.</p>
      </div>
      ${materiaisHtml}
      ${horasHtml}
      <div class="card"><h2 style="margin-top:0">Solicitações à secretaria</h2>${reqForm}${reqLista}</div>
      ${ofertasHtml}
      <footer>Acesso seguro por link temporário.</footer></body></html>`)
  })

  // ───────── Ação: gerar 2ª via (cobrança Asaas) ─────────
  app.post('/api/public/aca/aluno/parcela-cobranca', async (req, reply) => {
    const p = await alunoDaReq(req)
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const parcelaId = numOf(req, 'id')
    const parcela = await prisma.acaParcela.findUnique({ where: { id: parcelaId }, select: { contrato: { select: { matricula: { select: { alunoId: true } } } } } })
    if (!parcela || parcela.contrato.matricula.alunoId !== p.id) return reply.code(403).send({ error: 'não autorizado' })
    await criarCobrancaParcela(parcelaId).catch(() => {})
    reply.redirect(`/portal/aca/aluno?t=${encodeURIComponent(tokOf(req))}`)
  })

  // ───────── Ação: aluno emite o próprio documento (self-service · O2.1) ─────────
  app.post('/api/public/aca/aluno/emitir-documento', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const tipo = String((req.body as any)?.tipo || '')
    if (!['DECLARACAO_MATRICULA', 'DECLARACAO_FREQUENCIA', 'HISTORICO', 'QUITACAO_ANUAL', 'CARTEIRINHA'].includes(tipo)) return reply.code(400).send({ error: 'tipo não permitido' })
    try {
      // Autoatendimento: o aluno tira a própria quitação e a carteirinha sem
      // abrir requerimento — é o ponto do portal.
      const doc = tipo === 'QUITACAO_ANUAL'
        ? await emitirQuitacaoAnual(p.id, Number((req.body as any)?.ano) || new Date().getFullYear() - 1, null)
        : tipo === 'CARTEIRINHA'
          ? await emitirCarteirinha(p.id, null)
          : await emitirDocumentoAluno(tipo as DocTipo, p.id, null)
      return reply.redirect(`/api/public/aca/aluno/doc?t=${encodeURIComponent(tok)}&id=${doc.id}`, 303)
    } catch (e: any) {
      return pageErr(reply, 400, 'Não foi possível emitir', e?.message || '')
    }
  })

  // ───────── Ação: aluno abre um requerimento (O2.2) ─────────
  app.post('/api/public/aca/aluno/requerimentos', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const b = (req.body as any) || {}
    const tipoId = b.tipoId ? Number(b.tipoId) : null
    const tipo = tipoId ? await prisma.acaRequerimentoTipo.findUnique({ where: { id: tipoId } }) : null
    if (!tipo || !tipo.ativo) return pageErr(reply, 400, 'Tipo inválido')
    if (!b.assunto) return pageErr(reply, 400, 'Informe o assunto')
    const protocolo = await proximoProtocolo()
    await prisma.acaRequerimento.create({ data: {
      protocolo, alunoId: p.id, tipoId: tipo.id, tipoNome: tipo.nome,
      assunto: String(b.assunto).slice(0, 180), descricao: b.descricao ? String(b.descricao).slice(0, 4000) : null,
      status: 'ABERTO', prazoEm: new Date(Date.now() + tipo.slaDias * 86400_000),
    } })
    return reply.redirect(`/portal/aca/aluno?t=${encodeURIComponent(tok)}`, 303)
  })

  // ───────── Página: confirmação de (re)matrícula (O2.4) ─────────
  app.get('/portal/aca/aluno/rematricula', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return pageErr(reply, 403, 'Link inválido')
    const turmaId = numOf(req, 'turma')
    const pv = await previewTermoRematricula(p.id, turmaId)
    if (!pv) return pageErr(reply, 400, 'Turma indisponível', 'A matrícula pode ter sido encerrada.')
    const tk = encodeURIComponent(tok)
    const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    reply.type('text/html').send(`<!doctype html><html lang="pt-BR"><head><title>Matrícula</title>${HEAD}</head><body>
      <p class="tabs"><a href="/portal/aca/aluno?t=${tk}">← Voltar</a></p>
      <h1>Confirmar matrícula</h1>
      <div class="card">
        <div class="kv" style="display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:14px">
          <span style="color:#6b7280">Curso</span><span>${esc(pv.curso)}</span>
          <span style="color:#6b7280">Turma</span><span>${esc(pv.turma)}</span>
          <span style="color:#6b7280">Mensalidade</span><span>${pv.numParcelas}× de ${money(pv.valorParcela)}</span>
          ${pv.taxaMatricula > 0 ? `<span style="color:#6b7280">Taxa de matrícula</span><span>${money(pv.taxaMatricula)}</span>` : ''}
          <span style="color:#6b7280">Total</span><span><b>${money(pv.valorTotal)}</b></span>
        </div>
      </div>
      <div class="card"><h2 style="margin-top:0">Contrato</h2>
        <pre style="white-space:pre-wrap;font:13px/1.5 system-ui;color:#374151;background:#f7f8fa;padding:12px;border-radius:8px;max-height:260px;overflow:auto">${esc(pv.termo)}</pre>
        <form method="post" action="/api/public/aca/aluno/rematricula?t=${tk}&turma=${turmaId}" style="margin-top:8px">
          <label style="display:block;font-size:13px;margin-bottom:6px"><input type="checkbox" required> Li e concordo com os termos e com as condições financeiras.</label>
          <input type="text" name="nome" required placeholder="Digite seu nome completo para assinar" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:6px">
          <button type="submit">Confirmar matrícula</button>
        </form>
      </div>
      <footer>Acesso seguro por link temporário.</footer></body></html>`)
  })

  app.post('/api/public/aca/aluno/rematricula', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const turmaId = numOf(req, 'turma')
    const nome = String((req.body as any)?.nome || '').trim()
    if (!nome) return pageErr(reply, 400, 'Informe seu nome para assinar')
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    const r = await efetivarRematricula(p.id, turmaId, nome, ip)
    if (!r.ok) return pageErr(reply, 400, 'Não foi possível matricular', r.erro || '')
    return reply.redirect(`/portal/aca/aluno?t=${encodeURIComponent(tok)}`, 303)
  })

  // ───────── Ação: aluno aceita o contrato (O2.3) ─────────
  app.post('/api/public/aca/aluno/aceitar-contrato', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const contratoId = numOf(req, 'id')
    // garante que o contrato é do aluno
    const c = await prisma.acaContrato.findUnique({ where: { id: contratoId }, select: { matricula: { select: { alunoId: true } } } })
    if (!c || c.matricula.alunoId !== p.id) return reply.code(403).send({ error: 'não autorizado' })
    const nome = String((req.body as any)?.nome || '').trim()
    if (!nome) return pageErr(reply, 400, 'Informe seu nome para assinar')
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip
    await registrarAceite(contratoId, nome, ip)
    return reply.redirect(`/portal/aca/aluno?t=${encodeURIComponent(tok)}`, 303)
  })

  // ───────── Ação: aluno envia atividade complementar (O2.9) ─────────
  app.post('/api/public/aca/aluno/atividade', async (req, reply) => {
    const tok = tokOf(req); const p = verifyToken(tok, 'aca-aluno')
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const b = (req.body as any) || {}
    if (!b.titulo || !b.horas) return pageErr(reply, 400, 'Informe o título e as horas')
    await prisma.acaAtividadeComplementar.create({ data: { alunoId: p.id, titulo: String(b.titulo).slice(0, 191), horas: Number(b.horas) || 0, comprovanteUrl: b.comprovanteUrl || null, status: 'PENDENTE' } })
    return reply.redirect(`/portal/aca/aluno?t=${encodeURIComponent(tok)}`, 303)
  })

  // ───────── Ação: baixar PDF de documento (autorizado pelo token) ─────────
  app.get('/api/public/aca/aluno/doc', async (req, reply) => {
    const p = await alunoDaReq(req)
    if (!p) return reply.code(403).send({ error: 'token inválido' })
    const doc = await prisma.acaDocumento.findUnique({ where: { id: numOf(req, 'id') } })
    if (!doc || doc.alunoId !== p.id) return reply.code(403).send({ error: 'não autorizado' })
    const { renderDocumentoPdf } = await import('../services/acaDocRender.js')
    const pdf = await renderDocumentoPdf(doc)
    if (!pdf) return reply.code(400).send({ error: 'tipo inválido' })
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${doc.numero.replace('/', '-')}.pdf"`).send(pdf)
  })

  // ── Endereços que saíram na Fase 7 ──
  //
  // Sem uma rota explícita, estas URLs caem no fallback do servidor — que
  // entrega a landing de marketing. Quem guardou o link antigo veria uma página
  // de "Diagnóstico Estratégico" no lugar do portal, sem entender o que houve.
  // Melhor dizer o que aconteceu e para onde ir.
  for (const caminho of ['/portal/aca/professor', '/portal/aca/professor/diario', '/portal/aca/coordenador', '/portal/aca/responsavel', '/portal/aca/exaluno']) {
    app.get(caminho, async (_req, reply) =>
      pageErr(reply, 410, 'Esta página saiu do ar',
        'O acesso agora é pelo portal único. Entre em /portal/login — ou fale com a secretaria se precisar de ajuda.'))
  }

  // ── Portal do Professor: REMOVIDO ──
  //
  // Fase 7 da consolidação ERP × Portal (10/09/2026). As páginas
  // /portal/aca/professor e /portal/aca/professor/diario, e as seis rotas de
  // ação do diário, saíram: **zero docentes cadastrados** e nenhum acesso nos
  // logs. O diário de classe continua inteiro no ERP, em Acadêmico › Diário de
  // Classe, que é onde ele é usado.
  //
  // Se a instituição passar a usar portal do professor, ele volta pelo git — mas
  // deve nascer no portal-app, não em HTML montado à mão aqui.
}
