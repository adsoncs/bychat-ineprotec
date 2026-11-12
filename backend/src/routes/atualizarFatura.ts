// routes/atualizarFatura.ts — "Atualizar fatura vencida" (services/atualizarFatura).
//   Equipe:  GET  /api/admin/enrollment-registrations/:id/faturas
//            POST /api/admin/enrollment-registrations/:id/faturas/atualizar  { chave, vencimento }
//   Financeiro do portal (mesmas rotas, permissão da tela edu_financeiro_portal):
//            GET  /api/admin/educational/portal-financeiro/:id/faturas
//            POST /api/admin/educational/portal-financeiro/:id/faturas/atualizar
//   Aluno:   POST /api/public/portal/area/fatura/atualizar                  { codigo, chave }  (Meu Portal, cookie)
//            POST /api/public/registrations/:code/fatura/atualizar          { chave }          (tela de pagamento, token)
// O aluno só atualiza a vencida e só para hoje; a equipe escolhe a data.
//
// Desconto em fatura já gerada (services/descontoFatura, 12/11/2026), nas duas bases da equipe:
//            GET  .../:id/descontos            → descontos dados + cupons utilizáveis
//            POST .../:id/faturas/desconto      { chave, modo, valor|percentual|cupom, motivo, aprovadoPor, vencimento? }
//            GET  /api/admin/educational/portal-financeiro/descontos(.csv)  → relatório
import { FastifyInstance } from 'fastify'
import { guardTela } from '../lib/eduTelas.js'
import type { JwtPayload } from '../lib/auth.js'
import { contaDaRequisicao } from '../lib/portalSession.js'
import { verifyCandidateToken } from '../lib/candidateAuth.js'
import { atualizarFaturaVencida, mensagemDaFaturaAtualizada } from '../services/atualizarFatura.js'
import { areaAtiva, faturasDaInscricao, inscricaoParaFaturas, inscricoesDaConta } from '../services/areaDoAluno.js'
import { hojeBr } from '../services/pagamentoCombinado.js'
import { estadoParaReabrir, reabrirPagamento } from '../services/reabrirPagamento.js'
import { concederDesconto, cuponsParaDesconto, descontosDaInscricao, relatorioDeDescontos } from '../services/descontoFatura.js'

const CHAVE = /^(titulo:\d+|reg:\d+|asaas:[A-Za-z0-9_]+)$/

export async function atualizarFaturaRoutes(app: FastifyInstance) {
  // Mesmo serviço nas duas telas da equipe; o guardTela decide a permissão
  // pela URL (inscrição = Portal de Matrículas; Financeiro = Financeiro do portal).
  for (const base of ['/api/admin/enrollment-registrations', '/api/admin/educational/portal-financeiro']) {
    app.get(`${base}/:id/faturas`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const r = await inscricaoParaFaturas(Number((req.params as any).id))
      if (!r) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
      const { faturas, aviso } = await faturasDaInscricao(r)
      return { faturas, aviso, hoje: hojeBr() }
    })

    app.post(`${base}/:id/faturas/atualizar`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const id = Number((req.params as any).id)
      const b = (req.body as any) || {}
      const chave = String(b.chave || '')
      if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
      const user = (req as any).user as JwtPayload
      const r = await atualizarFaturaVencida({ registrationId: id, chave, vencimento: b.vencimento ? String(b.vencimento) : null, ator: { tipo: 'atendente', userId: user?.userId ?? null, nome: (user as any)?.name ?? null, req } })
      if (!r.ok) return reply.code(r.status).send({ error: r.erro })
      return { ...r, mensagem: await mensagemDaFaturaAtualizada(id, r) }
    })
  }

  // Relatório de descontos concedidos (antes das rotas com :id).
  const filtrosDoRelatorio = (q: any) => ({
    de: /^\d{4}-\d{2}-\d{2}$/.test(String(q?.de ?? '')) ? String(q.de) : undefined,
    ate: /^\d{4}-\d{2}-\d{2}$/.test(String(q?.ate ?? '')) ? String(q.ate) : undefined,
    portalId: Number(q?.portalId) || undefined,
    por: q?.por ? String(q.por) : undefined,
  })
  app.get('/api/admin/educational/portal-financeiro/descontos', { preHandler: guardTela('admin') }, async (req) => relatorioDeDescontos(filtrosDoRelatorio(req.query)))
  app.get('/api/admin/educational/portal-financeiro/descontos.csv', { preHandler: guardTela('admin') }, async (req, reply) => {
    const r = await relatorioDeDescontos(filtrosDoRelatorio(req.query))
    const SIT: Record<string, string> = { aplicado: 'Aplicado', aguardando_cartao: 'Aguardando cartão', nao_usado: 'Não usado (troca cancelada/expirada)' }
    const cel = (v: unknown) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
    const num = (n: number) => n.toFixed(2).replace('.', ',')
    const linhas = [['Data', 'Inscrição', 'Aluno', 'Portal', 'Fatura', 'Valor antes', 'Desconto', 'Valor depois', 'Como', 'Cupom', 'Situação', 'Dado por', 'Aprovado por', 'Motivo'].join(';')]
    for (const i of r.itens) {
      linhas.push([new Date(i.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), i.codigo, i.aluno, i.portal, i.fatura, num(i.antes), num(i.desconto), num(i.depois),
        i.modo === 'percentual' ? `${i.percentual}%` : i.modo === 'cupom' ? 'Cupom' : 'Valor', i.cupom, SIT[i.situacao] ?? i.situacao, i.por, i.aprovadoPor, i.motivo].map(cel).join(';'))
    }
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="descontos-concedidos.csv"')
    return '\uFEFF' + linhas.join('\n')
  })

  for (const base of ['/api/admin/enrollment-registrations', '/api/admin/educational/portal-financeiro']) {
    app.get(`${base}/:id/descontos`, { preHandler: guardTela('admin') }, async (req) => {
      const id = Number((req.params as any).id)
      const [descontos, cupons] = await Promise.all([descontosDaInscricao(id), cuponsParaDesconto(id)])
      return { descontos, cupons }
    })
    // Trocar plano / nova cobrança: cancela a cobrança aberta e destrava a inscrição expirada (services/reabrirPagamento).
    app.get(`${base}/:id/reabrir-pagamento`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const e = await estadoParaReabrir(Number((req.params as any).id))
      return e ?? reply.code(404).send({ error: 'Inscrição não encontrada.' })
    })
    app.post(`${base}/:id/reabrir-pagamento`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const user = (req as any).user as JwtPayload
      const r = await reabrirPagamento(Number((req.params as any).id), req.body, { userId: user?.userId ?? null, nome: (user as any)?.name ?? null, req })
      if (!r.ok) return reply.code(r.status).send({ error: r.erro })
      return r
    })
    app.post(`${base}/:id/faturas/desconto`, { preHandler: guardTela('admin') }, async (req, reply) => {
      const id = Number((req.params as any).id)
      const b = (req.body as any) || {}
      if (!CHAVE.test(String(b.chave || ''))) return reply.code(400).send({ error: 'Fatura inválida.' })
      const user = (req as any).user as JwtPayload
      const r = await concederDesconto(id, b, { userId: user?.userId ?? 0, nome: (user as any)?.name ?? 'Equipe', req })
      if (!r.ok) return reply.code(r.status).send({ error: r.erro })
      return r
    })
  }

  app.post('/api/public/portal/area/fatura/atualizar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    if (!(await areaAtiva())) return reply.code(404).send({ error: 'Indisponível' })
    const conta = await contaDaRequisicao(req)
    if (!conta) return reply.code(401).send({ error: 'Entre no portal de novo.' })
    const b = (req.body as any) || {}
    const chave = String(b.chave || '')
    if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
    const reg = (await inscricoesDaConta(conta.leadId)).find((x) => x.candidateCode === String(b.codigo || ''))
    if (!reg || !reg.portal?.areaDoAluno) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
    // Só o que a própria área mostra como atualizável.
    const { faturas } = await faturasDaInscricao(reg)
    if (!faturas.some((f) => f.chave === chave && f.podeAtualizar)) return reply.code(409).send({ error: 'Esta fatura não pode ser atualizada. Fale com a secretaria.' })
    const r = await atualizarFaturaVencida({ registrationId: reg.id, chave, ator: { tipo: 'candidato', req } })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return r
  })

  app.post('/api/public/registrations/:code/fatura/atualizar', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const code = String((req.params as any).code || '')
    const sess = verifyCandidateToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    if (!sess || sess.candidateCode !== code) return reply.code(401).send({ error: 'Sessão inválida ou expirada' })
    const chave = String(((req.body as any) || {}).chave || '')
    if (!CHAVE.test(chave)) return reply.code(400).send({ error: 'Fatura inválida.' })
    const reg = await inscricaoParaFaturas(sess.enrollmentId)
    if (!reg) return reply.code(404).send({ error: 'Inscrição não encontrada.' })
    const { faturas } = await faturasDaInscricao(reg)
    if (!faturas.some((f) => f.chave === chave && f.podeAtualizar)) return reply.code(409).send({ error: 'Esta fatura não pode ser atualizada. Fale com a secretaria.' })
    const r = await atualizarFaturaVencida({ registrationId: reg.id, chave, ator: { tipo: 'candidato', req } })
    if (!r.ok) return reply.code(r.status).send({ error: r.erro })
    return r
  })
}
