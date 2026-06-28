// src/routes/acaFinBanco.ts
// Módulo Acadêmico · F9 — Financeiro Bancário (rotas /api/admin/aca/fin-banco).
// Plano de contas, contas bancárias, indexadores, feriados, cobranças recorrentes/
// avulsas e remessa/retorno CNAB-400 (boleto registrado).

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'
import { gerarRemessaCNAB400, gerarRecorrencias, processarRetornoCNAB400, avancarPeriodo, ajustarDiaUtil, feriadosSet, type TituloRemessa } from '../services/acaFinBanco.js'

export async function acaFinBancoRoutes(app: FastifyInstance) {
  // ───────── Plano de contas ─────────
  app.get('/api/admin/aca/fin-banco/contas-financeiras', { preHandler: authMiddleware }, async () => ({ contas: await prisma.acaContaFinanceira.findMany({ orderBy: { codigo: 'asc' } }) }))
  app.post('/api/admin/aca/fin-banco/contas-financeiras', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.codigo || !b.nome) return reply.code(400).send({ error: 'codigo e nome obrigatórios' })
    return reply.code(201).send({ conta: await prisma.acaContaFinanceira.create({ data: { codigo: String(b.codigo).slice(0, 30), nome: String(b.nome).slice(0, 191), tipo: b.tipo === 'DESPESA' ? 'DESPESA' : 'RECEITA' } }) })
  })
  app.put('/api/admin/aca/fin-banco/contas-financeiras/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('codigo' in b) data.codigo = String(b.codigo).slice(0, 30)
    if ('nome' in b) data.nome = String(b.nome).slice(0, 191)
    if ('tipo' in b) data.tipo = b.tipo === 'DESPESA' ? 'DESPESA' : 'RECEITA'
    if ('ativo' in b) data.ativo = !!b.ativo
    return { conta: await prisma.acaContaFinanceira.update({ where: { id }, data }) }
  })

  // ───────── Contas bancárias ─────────
  app.get('/api/admin/aca/fin-banco/contas-bancarias', { preHandler: authMiddleware }, async () => ({ contas: await prisma.acaContaBancaria.findMany({ orderBy: { id: 'desc' } }) }))
  app.post('/api/admin/aca/fin-banco/contas-bancarias', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome || !b.bancoCodigo) return reply.code(400).send({ error: 'nome e bancoCodigo obrigatórios' })
    return reply.code(201).send({ conta: await prisma.acaContaBancaria.create({ data: {
      nome: String(b.nome).slice(0, 120), bancoCodigo: String(b.bancoCodigo).slice(0, 5), agencia: b.agencia || null, conta: b.conta || null,
      carteira: b.carteira || null, convenio: b.convenio || null, cnab: b.cnab === '240' ? '240' : '400', cedente: b.cedente || null, documentoCedente: b.documentoCedente || null,
    } }) })
  })
  app.put('/api/admin/aca/fin-banco/contas-bancarias/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['nome', 'bancoCodigo', 'agencia', 'conta', 'carteira', 'convenio', 'cedente', 'documentoCedente']) if (k in b) data[k] = b[k] || null
    if ('cnab' in b) data.cnab = b.cnab === '240' ? '240' : '400'
    if ('ativo' in b) data.ativo = !!b.ativo
    return { conta: await prisma.acaContaBancaria.update({ where: { id }, data }) }
  })

  // ───────── Indexadores ─────────
  app.get('/api/admin/aca/fin-banco/indexadores', { preHandler: authMiddleware }, async () => ({ indexadores: await prisma.acaIndexador.findMany({ orderBy: { id: 'desc' }, include: { valores: { orderBy: { competencia: 'desc' }, take: 24 } } }) }))
  app.post('/api/admin/aca/fin-banco/indexadores', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    return reply.code(201).send({ indexador: await prisma.acaIndexador.create({ data: { nome: String(b.nome).slice(0, 60) } }) })
  })
  app.post('/api/admin/aca/fin-banco/indexadores/:id/valores', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    if (!b.competencia || b.valorPct == null) return reply.code(400).send({ error: 'competencia e valorPct obrigatórios' })
    return reply.code(201).send({ valor: await prisma.acaIndexadorValor.upsert({
      where: { indexadorId_competencia: { indexadorId: id, competencia: String(b.competencia).slice(0, 7) } },
      create: { indexadorId: id, competencia: String(b.competencia).slice(0, 7), valorPct: Number(b.valorPct) },
      update: { valorPct: Number(b.valorPct) },
    }) })
  })

  // ───────── Feriados ─────────
  app.get('/api/admin/aca/fin-banco/feriados', { preHandler: authMiddleware }, async () => ({ feriados: await prisma.acaFeriado.findMany({ orderBy: { data: 'asc' } }) }))
  app.post('/api/admin/aca/fin-banco/feriados', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.data || !b.nome) return reply.code(400).send({ error: 'data e nome obrigatórios' })
    try { return reply.code(201).send({ feriado: await prisma.acaFeriado.create({ data: { data: new Date(b.data), nome: String(b.nome).slice(0, 120) } }) }) }
    catch { return reply.code(409).send({ error: 'feriado já cadastrado nessa data' }) }
  })
  app.delete('/api/admin/aca/fin-banco/feriados/:id', { preHandler: authMiddleware }, async (req) => {
    await prisma.acaFeriado.delete({ where: { id: Number((req.params as any).id) } }); return { ok: true }
  })

  // ───────── Cobranças recorrentes ─────────
  app.get('/api/admin/aca/fin-banco/recorrentes', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaCobrancaRecorrente.findMany({ orderBy: { id: 'desc' }, take: 300 })
    const alunoIds = [...new Set(rows.map((r) => r.alunoId))]
    const alunos = alunoIds.length ? await prisma.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, ra: true, lead: { select: { nome: true } } } }) : []
    const aMap = new Map(alunos.map((a) => [a.id, a]))
    return { recorrentes: rows.map((r) => ({ ...r, alunoNome: aMap.get(r.alunoId)?.lead.nome ?? '—', ra: aMap.get(r.alunoId)?.ra ?? null })) }
  })
  app.post('/api/admin/aca/fin-banco/recorrentes', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const contratoId = Number(b.contratoId)
    if (!contratoId || !b.descricao || !b.valorCentavos) return reply.code(400).send({ error: 'contratoId, descricao e valorCentavos obrigatórios' })
    const contrato = await prisma.acaContrato.findUnique({ where: { id: contratoId }, select: { matricula: { select: { alunoId: true } } } })
    if (!contrato) return reply.code(404).send({ error: 'Contrato não encontrado' })
    const dia = Math.min(Math.max(Number(b.diaVencimento) || 10, 1), 28)
    const prox = b.proximaGeracao ? new Date(b.proximaGeracao) : avancarPeriodo(new Date(), b.periodo || 'MENSAL', dia)
    return reply.code(201).send({ recorrente: await prisma.acaCobrancaRecorrente.create({ data: {
      contratoId, alunoId: contrato.matricula.alunoId, descricao: String(b.descricao).slice(0, 191), valorCentavos: Math.round(Number(b.valorCentavos)),
      periodo: ['MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'].includes(b.periodo) ? b.periodo : 'MENSAL',
      diaVencimento: dia, contaFinanceiraId: b.contaFinanceiraId ? Number(b.contaFinanceiraId) : null, proximaGeracao: prox,
    } }) })
  })
  app.put('/api/admin/aca/fin-banco/recorrentes/:id', { preHandler: authMiddleware }, async (req) => {
    const id = Number((req.params as any).id); const b = (req.body as any) || {}
    const data: any = {}
    if ('descricao' in b) data.descricao = String(b.descricao).slice(0, 191)
    if ('valorCentavos' in b) data.valorCentavos = Math.round(Number(b.valorCentavos))
    if ('diaVencimento' in b) data.diaVencimento = Math.min(Math.max(Number(b.diaVencimento) || 10, 1), 28)
    if ('ativo' in b) data.ativo = !!b.ativo
    return { recorrente: await prisma.acaCobrancaRecorrente.update({ where: { id }, data }) }
  })
  app.post('/api/admin/aca/fin-banco/recorrentes/gerar', { preHandler: authMiddleware }, async (req) => {
    const b = (req.body as any) || {}
    return gerarRecorrencias({ dryRun: b.dryRun !== false })
  })

  // ───────── Cobrança avulsa (parcela one-off num contrato) ─────────
  app.post('/api/admin/aca/fin-banco/cobranca-avulsa', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const contratoId = Number(b.contratoId)
    if (!contratoId || !b.valorCentavos || !b.dataVencimento) return reply.code(400).send({ error: 'contratoId, valorCentavos e dataVencimento obrigatórios' })
    const ultima = await prisma.acaParcela.findFirst({ where: { contratoId }, orderBy: { nroParcela: 'desc' }, select: { nroParcela: true } })
    const fers = await feriadosSet()
    const parcela = await prisma.acaParcela.create({ data: {
      contratoId, nroParcela: (ultima?.nroParcela ?? 0) + 1, tipo: ['MATRICULA', 'MENSALIDADE', 'MATERIAL', 'TAXA', 'OUTRO'].includes(b.tipo) ? b.tipo : 'OUTRO',
      valorBrutoCentavos: Math.round(Number(b.valorCentavos)), dataVencimento: ajustarDiaUtil(new Date(b.dataVencimento), fers), situacao: 'ABERTA',
      contaFinanceiraId: b.contaFinanceiraId ? Number(b.contaFinanceiraId) : null,
    } })
    return reply.code(201).send({ parcela })
  })

  // ───────── Remessa CNAB ─────────
  app.get('/api/admin/aca/fin-banco/parcelas-aberto', { preHandler: authMiddleware }, async (req) => {
    const q = req.query as any
    const where: any = { situacao: { in: ['ABERTA', 'VENCIDA'] } }
    if (q.semRemessa) where.remessaId = null
    const parcelas = await prisma.acaParcela.findMany({
      where, orderBy: { dataVencimento: 'asc' }, take: 500,
      select: { id: true, nroParcela: true, tipo: true, valorBrutoCentavos: true, dataVencimento: true, remessaId: true, contrato: { select: { matricula: { select: { aluno: { select: { ra: true, lead: { select: { nome: true } } } } } } } } },
    })
    return { parcelas: parcelas.map((p) => ({ id: p.id, nroParcela: p.nroParcela, tipo: p.tipo, valorBrutoCentavos: p.valorBrutoCentavos, dataVencimento: p.dataVencimento, remessaId: p.remessaId, alunoNome: p.contrato.matricula.aluno.lead.nome, ra: p.contrato.matricula.aluno.ra })) }
  })

  app.post('/api/admin/aca/fin-banco/remessa/gerar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const contaBancariaId = Number(b.contaBancariaId)
    const parcelaIds: number[] = Array.isArray(b.parcelaIds) ? b.parcelaIds.map(Number) : []
    if (!contaBancariaId || parcelaIds.length === 0) return reply.code(400).send({ error: 'contaBancariaId e parcelaIds obrigatórios' })
    const conta = await prisma.acaContaBancaria.findUnique({ where: { id: contaBancariaId } })
    if (!conta) return reply.code(404).send({ error: 'Conta bancária não encontrada' })
    const parcelas = await prisma.acaParcela.findMany({
      where: { id: { in: parcelaIds } },
      select: { id: true, nroParcela: true, valorBrutoCentavos: true, dataVencimento: true, contrato: { select: { matricula: { select: { aluno: { select: { cpf: true, lead: { select: { nome: true } } } } } } } } },
    })
    if (!parcelas.length) return reply.code(400).send({ error: 'Nenhuma parcela válida' })
    const seq = conta.sequencialRemessa + 1
    const titulos: TituloRemessa[] = parcelas.map((p, i) => ({
      parcelaId: p.id, nossoNumero: `${seq}${String(p.id).padStart(8, '0')}`, valorCentavos: p.valorBrutoCentavos,
      vencimento: p.dataVencimento, numeroDocumento: String(p.id), sacadoNome: p.contrato.matricula.aluno.lead.nome,
      sacadoDoc: p.contrato.matricula.aluno.cpf || '',
    }))
    const arquivo = gerarRemessaCNAB400({ ...conta, sequencial: seq }, titulos)
    const nomeArquivo = `CB${String(seq).padStart(6, '0')}.REM`
    const remessa = await prisma.acaRemessa.create({ data: {
      contaBancariaId, sequencial: seq, layout: conta.cnab, qtdTitulos: titulos.length,
      valorTotalCentavos: titulos.reduce((s, t) => s + t.valorCentavos, 0), arquivo, nomeArquivo, status: 'GERADA',
    } })
    // marca parcelas com remessaId + nossoNumero
    for (const t of titulos) await prisma.acaParcela.update({ where: { id: t.parcelaId }, data: { remessaId: remessa.id, nossoNumero: t.nossoNumero } })
    await prisma.acaContaBancaria.update({ where: { id: contaBancariaId }, data: { sequencialRemessa: seq } })
    return reply.code(201).send({ remessa: { id: remessa.id, sequencial: seq, qtdTitulos: titulos.length, valorTotalCentavos: remessa.valorTotalCentavos, nomeArquivo } })
  })

  app.get('/api/admin/aca/fin-banco/remessas', { preHandler: authMiddleware }, async () => {
    const rows = await prisma.acaRemessa.findMany({ orderBy: { id: 'desc' }, take: 100, select: { id: true, contaBancariaId: true, sequencial: true, layout: true, qtdTitulos: true, valorTotalCentavos: true, nomeArquivo: true, status: true, createdAt: true } })
    return { remessas: rows }
  })
  app.get('/api/admin/aca/fin-banco/remessa/:id/arquivo', { preHandler: authMiddleware }, async (req, reply) => {
    const r = await prisma.acaRemessa.findUnique({ where: { id: Number((req.params as any).id) } })
    if (!r) return reply.code(404).send({ error: 'Remessa não encontrada' })
    reply.header('Content-Type', 'text/plain').header('Content-Disposition', `attachment; filename="${r.nomeArquivo}"`).send(r.arquivo)
  })

  // ───────── Retorno CNAB (baixa) ─────────
  app.post('/api/admin/aca/fin-banco/retorno/processar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    if (!b.conteudo || typeof b.conteudo !== 'string') return reply.code(400).send({ error: 'conteudo (texto do arquivo de retorno) obrigatório' })
    return processarRetornoCNAB400(b.conteudo)
  })
}
