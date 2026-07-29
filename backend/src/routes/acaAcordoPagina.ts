// src/routes/acaAcordoPagina.ts
//
// Tela de negociação de dívida no portal (T-906).
//
// Os endpoints de acordo já existiam e ninguém chegava neles: eram JSON, e o
// portal é HTML server-side sem JavaScript. Funcionalidade sem caminho na tela
// é o mesmo que funcionalidade ausente.
//
// O fluxo tem dois passos porque não há JS para simular ao vivo: escolher as
// parcelas e ver a proposta, depois confirmar. Ver o valor antes de aceitar não
// é conveniência — é o mínimo para alguém assumir uma dívida parcelada.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { verifyPortalToken as verifyToken } from '../lib/acaPortalToken.js'
import { getPolitica, parcelasNegociaveis, simular, efetivar } from '../services/acaAcordo.js'
import { HEAD, esc, money } from './acaPortal.js'

const tokOf = (req: any): string => String((req.query as any)?.t || '')
const ipOf = (req: any): string => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0]!.trim()

interface Contexto { alunoId: number; quem: 'PORTAL_ALUNO' | 'PORTAL_RESPONSAVEL'; nome: string | null }

/** Aluno e responsável usam o mesmo fluxo; o token diz quem está negociando. */
async function contextoDoToken(req: any): Promise<Contexto | null> {
  const t = tokOf(req)
  const aluno = verifyToken(t, 'aca-aluno')
  if (aluno) {
    const a = await prisma.aluno.findUnique({ where: { id: aluno.id }, select: { lead: { select: { nome: true } } } })
    return { alunoId: aluno.id, quem: 'PORTAL_ALUNO', nome: a?.lead?.nome ?? null }
  }
  const resp = verifyToken(t, 'aca-responsavel')
  if (resp) {
    const r = await prisma.acaResponsavel.findUnique({ where: { id: resp.id }, select: { alunoId: true, nome: true } })
    if (r) return { alunoId: r.alunoId, quem: 'PORTAL_RESPONSAVEL', nome: r.nome }
  }
  return null
}

const pagina = (titulo: string, corpo: string) =>
  `<!doctype html><html lang="pt-BR"><head><title>${esc(titulo)}</title>${HEAD}</head><body>${corpo}</body></html>`

const voltar = (tk: string, quem: Contexto['quem']) =>
  `<a href="${quem === 'PORTAL_RESPONSAVEL' ? '/portal/aca/responsavel' : '/portal/aca/aluno'}?t=${tk}"><button class="sec" type="button">Voltar</button></a>`

export async function acaAcordoPaginaRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const out: Record<string, any> = {}
      // Vários checkboxes com o mesmo nome viram lista — é assim que as
      // parcelas selecionadas chegam.
      for (const [k, v] of new URLSearchParams(String(body))) {
        if (k in out) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v]
        else out[k] = v
      }
      done(null, out)
    } catch (e) { done(e as Error, undefined) }
  })

  const listaIds = (v: unknown): number[] =>
    (Array.isArray(v) ? v : v == null ? [] : [v]).map(Number).filter((n) => Number.isFinite(n) && n > 0)

  // ───────── Passo 1: escolher as parcelas ─────────
  app.get('/portal/aca/acordo', async (req, reply) => {
    const ctx = await contextoDoToken(req)
    if (!ctx) {
      return reply.code(403).type('text/html').send(pagina('Link inválido',
        '<div class="card"><h1>Link inválido ou expirado</h1><p class="sub">Solicite um novo acesso à secretaria.</p></div>'))
    }
    const tk = encodeURIComponent(tokOf(req))
    const politica = await getPolitica()
    if (!politica.portalHabilitado) {
      return reply.type('text/html').send(pagina('Negociação', `
        <div class="card"><h1>Negociação online indisponível</h1>
        <p class="sub">A instituição não abriu a negociação pelo portal. Fale com a secretaria para renegociar.</p>
        ${voltar(tk, ctx.quem)}</div>`))
    }

    const parcelas = await parcelasNegociaveis(ctx.alunoId, politica)
    const erro = String((req.query as any)?.erro || '')

    if (parcelas.length === 0) {
      return reply.type('text/html').send(pagina('Negociação', `
        <div class="card"><h1>Nada a negociar</h1>
        <p class="sub">Não há parcelas elegíveis${politica.atrasoMinimoDias > 0 ? ` (o acordo online vale a partir de ${politica.atrasoMinimoDias} dia(s) de atraso)` : ''}.</p>
        ${voltar(tk, ctx.quem)}</div>`))
    }

    const total = parcelas.reduce((s, p) => s + p.totalCentavos, 0)
    return reply.type('text/html').send(pagina('Negociar dívida', `
      <div class="card">
        <h1>Negociar dívida</h1>
        <p class="sub">${ctx.quem === 'PORTAL_RESPONSAVEL' ? 'Você está negociando como responsável financeiro.' : 'Selecione as parcelas que quer renegociar.'}</p>
        ${erro ? `<div class="card" style="background:#fde8e8;border-color:#f5b5b5;color:#a11;font-size:13px">${esc(erro)}</div>` : ''}
        <form method="post" action="/api/public/aca/acordo/proposta?t=${tk}">
          <table><thead><tr><th></th><th>Parcela</th><th>Vencimento</th><th class="r">Atraso</th><th class="r">Total c/ encargos</th></tr></thead><tbody>
          ${parcelas.map((p) => `<tr>
            <td><input type="checkbox" name="parcelaIds" value="${p.id}" checked></td>
            <td>${p.nroParcela}ª ${esc(p.tipo)}</td>
            <td>${new Date(p.dataVencimento).toLocaleDateString('pt-BR')}</td>
            <td class="r">${p.diasAtraso} dia(s)</td>
            <td class="r">${money(p.totalCentavos)}</td>
          </tr>`).join('')}
          </tbody></table>
          <p class="sub" style="text-align:right;margin-top:6px">Total selecionável: <b>${money(total)}</b></p>

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <label style="font-size:13px">Parcelar em
              <select name="numParcelas" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;font:inherit;margin-left:6px">
                ${Array.from({ length: politica.maxParcelas }, (_, i) => i + 1).map((n) => `<option value="${n}">${n}x</option>`).join('')}
              </select>
            </label>
            <label style="font-size:13px">Entrada (R$)
              <input type="text" name="entradaReais" inputmode="decimal" placeholder="0,00" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;font:inherit;margin-left:6px;width:110px">
            </label>
          </div>
          ${politica.entradaMinimaPct > 0 ? `<p class="sub" style="font-size:12px;margin-top:6px">Entrada mínima: ${politica.entradaMinimaPct}% do total.</p>` : ''}
          <button type="submit" style="margin-top:12px">Ver proposta</button>
        </form>
        <div style="margin-top:10px">${voltar(tk, ctx.quem)}</div>
      </div>`))
  })

  // ───────── Passo 2: proposta calculada, antes de assumir ─────────
  app.post('/api/public/aca/acordo/proposta', async (req, reply) => {
    const ctx = await contextoDoToken(req)
    if (!ctx) return reply.code(403).send({ error: 'token inválido' })
    const tk = encodeURIComponent(tokOf(req))
    const b = (req.body as any) || {}
    const ids = listaIds(b.parcelaIds)
    const volta = (msg: string) => reply.code(303).header('location', `/portal/aca/acordo?t=${tk}&erro=${encodeURIComponent(msg)}`).send()
    if (ids.length === 0) return volta('Selecione ao menos uma parcela.')

    // Nunca confiar no id que veio do formulário: só parcelas do próprio aluno.
    const doAluno = await parcelasNegociaveis(ctx.alunoId)
    const permitidos = new Set(doAluno.map((p) => p.id))
    if (ids.some((id) => !permitidos.has(id))) return volta('Parcela inválida para esta negociação.')

    const entradaCentavos = Math.round(Number(String(b.entradaReais || '0').replace(/\./g, '').replace(',', '.')) * 100) || 0
    const numParcelas = Number(b.numParcelas) || 1
    let sim
    try {
      sim = await simular({ parcelaIds: ids, numParcelas, entradaCentavos, canalPortal: true })
    } catch (e: any) {
      return volta(e?.message || 'Não foi possível simular.')
    }

    const campos = ids.map((id) => `<input type="hidden" name="parcelaIds" value="${id}">`).join('')
    return reply.type('text/html').send(pagina('Proposta de acordo', `
      <div class="card">
        <h1>Proposta de acordo</h1>
        <table>
          <tr><td>Parcelas renegociadas</td><td class="r">${sim.qtd}</td></tr>
          <tr><td>Valor original</td><td class="r">${money(sim.valorOriginalCentavos)}</td></tr>
          <tr><td>Multa e juros</td><td class="r">${money(sim.encargosCentavos)}</td></tr>
          ${sim.descontoEncargosCentavos > 0 ? `<tr><td>Desconto em multa/juros</td><td class="r" style="color:#1a6b1a">− ${money(sim.descontoEncargosCentavos)}</td></tr>` : ''}
          <tr><td><b>Total do acordo</b></td><td class="r"><b>${money(sim.totalCentavos)}</b></td></tr>
          ${sim.entradaCentavos > 0 ? `<tr><td>Entrada</td><td class="r">${money(sim.entradaCentavos)}</td></tr>` : ''}
          <tr><td>Parcelamento</td><td class="r">${sim.numParcelas}x de ${money(sim.valorParcelaCentavos)}</td></tr>
        </table>
        ${sim.avisos.length > 0 ? `<div class="card" style="background:#fff8e6;border-color:#f0d9a0;font-size:13px"><b>Ajustes aplicados pela política da instituição:</b><ul style="margin:6px 0 0 18px">${sim.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}

        <form method="post" action="/api/public/aca/acordo/fechar?t=${tk}" style="margin-top:12px">
          ${campos}
          <input type="hidden" name="numParcelas" value="${sim.numParcelas}">
          <input type="hidden" name="entradaCentavos" value="${sim.entradaCentavos}">
          <label style="display:block;font-size:13px;margin-bottom:8px">
            <input type="checkbox" name="aceite" value="on" required>
            Li e aceito os termos: as parcelas acima serão substituídas pelo acordo, e o não pagamento o torna sem efeito.
          </label>
          <input type="text" name="aceiteNome" required placeholder="Digite seu nome completo para assinar" value="${esc(ctx.nome ?? '')}" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:6px">
          <input type="text" name="aceiteDocumento" placeholder="CPF (opcional)" style="width:100%;padding:9px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:8px">
          <button type="submit">Fechar acordo</button>
        </form>
        <div style="margin-top:10px"><a href="/portal/aca/acordo?t=${tk}"><button class="sec" type="button">Refazer simulação</button></a></div>
      </div>`))
  })

  // ───────── Passo 3: efetivar ─────────
  app.post('/api/public/aca/acordo/fechar', async (req, reply) => {
    const ctx = await contextoDoToken(req)
    if (!ctx) return reply.code(403).send({ error: 'token inválido' })
    const tk = encodeURIComponent(tokOf(req))
    const b = (req.body as any) || {}
    const ids = listaIds(b.parcelaIds)
    const volta = (msg: string) => reply.code(303).header('location', `/portal/aca/acordo?t=${tk}&erro=${encodeURIComponent(msg)}`).send()

    if (ids.length === 0) return volta('Selecione ao menos uma parcela.')
    if (!b.aceite) return volta('É preciso aceitar os termos do acordo.')
    if (!String(b.aceiteNome || '').trim()) return volta('Informe o nome de quem está assinando.')

    const doAluno = await parcelasNegociaveis(ctx.alunoId)
    const permitidos = new Set(doAluno.map((p) => p.id))
    if (ids.some((id) => !permitidos.has(id))) return volta('Parcela inválida para esta negociação.')

    try {
      const r = await efetivar({
        parcelaIds: ids,
        numParcelas: Number(b.numParcelas) || 1,
        entradaCentavos: Number(b.entradaCentavos) || 0,
        origem: ctx.quem,
        canalPortal: true,
        observacao: `Acordo fechado no portal por ${String(b.aceiteNome).trim()}.`,
        aceite: {
          nome: String(b.aceiteNome).trim(),
          documento: b.aceiteDocumento ? String(b.aceiteDocumento) : null,
          ip: ipOf(req),
          userAgent: String(req.headers['user-agent'] || '').substring(0, 500),
        },
      })
      return reply.type('text/html').send(pagina('Acordo fechado', `
        <div class="card">
          <h1>Acordo fechado</h1>
          <p class="sub">Acordo nº ${r.acordo.id} · ${r.parcelasCriadas} parcela(s) gerada(s).</p>
          <p style="font-size:14px">As novas parcelas já aparecem no seu financeiro, com boleto e PIX disponíveis.
          Guarde este número: ele identifica a negociação.</p>
          ${voltar(tk, ctx.quem)}
        </div>`))
    } catch (e: any) {
      return volta(e?.message || 'Não foi possível fechar o acordo.')
    }
  })
}
