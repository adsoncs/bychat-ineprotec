// src/routes/acaAluno.ts
// Módulo Acadêmico · P1 — Aluno (extensão 1:1 do Lead/Contato do CRM).
// Promover um Lead a Aluno NÃO cria contato novo: anexa o registro Aluno +
// gera RA (Registro Acadêmico). Sem silo. Rotas /api/admin/aca/*.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware } from '../lib/auth.js'

const ALUNO_SELECT = {
  id: true, leadId: true, ra: true, cpf: true, dataNascimento: true, sexo: true,
  nomeSocial: true, fotoUrl: true, ativo: true, createdAt: true,
  lead: { select: { id: true, uid: true, nome: true, email: true, whatsapp: true } },
} as const

/** Gera um RA único: ano + sequência (com retry em colisão). */
async function nextRa(): Promise<string> {
  const ano = new Date().getFullYear()
  const count = await prisma.aluno.count()
  for (let i = 1; i <= 50; i++) {
    const ra = `${ano}${String(count + i).padStart(5, '0')}`
    const exists = await prisma.aluno.findUnique({ where: { ra }, select: { id: true } })
    if (!exists) return ra
  }
  return `${ano}${Date.now().toString().slice(-6)}`
}

export async function acaAlunoRoutes(app: FastifyInstance) {
  // ── GET /alunos — lista + busca (RA, CPF, nome, e-mail) ──
  app.get('/api/admin/aca/alunos', { preHandler: authMiddleware }, async (req) => {
    const q = ((req.query as any).q || '').toString().trim()
    const where: any = {}
    if (q) {
      where.OR = [
        { ra: { contains: q } },
        { cpf: { contains: q } },
        { lead: { nome: { contains: q } } },
        { lead: { email: { contains: q } } },
      ]
    }
    const [alunos, total] = await Promise.all([
      prisma.aluno.findMany({ where, select: ALUNO_SELECT, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.aluno.count({ where }),
    ])
    return { alunos, total }
  })

  // ── GET /alunos/:id — detalhe + responsáveis + matrículas ──
  app.get('/api/admin/aca/alunos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const aluno = await prisma.aluno.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, uid: true, nome: true, email: true, whatsapp: true } },
        responsaveis: { orderBy: { id: 'asc' } },
        matriculas: { select: { id: true, status: true, turmaId: true, dataMatricula: true } },
      },
    })
    if (!aluno) return reply.code(404).send({ error: 'Aluno não encontrado' })
    return { aluno }
  })

  // ── GET /leads/search — candidatos a promover (Leads que ainda não são Aluno) ──
  app.get('/api/admin/aca/leads/search', { preHandler: authMiddleware }, async (req) => {
    const q = ((req.query as any).q || '').toString().trim()
    if (q.length < 2) return { leads: [] }
    const leads = await prisma.lead.findMany({
      where: {
        aluno: null, // ainda não é aluno
        OR: [{ nome: { contains: q } }, { email: { contains: q } }, { whatsapp: { contains: q } }],
      },
      select: { id: true, uid: true, nome: true, email: true, whatsapp: true },
      take: 15, orderBy: { createdAt: 'desc' },
    })
    return { leads }
  })

  // ── POST /alunos — promove um Lead a Aluno (gera RA) ──
  app.post('/api/admin/aca/alunos', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const leadId = Number(b.leadId)
    if (!leadId) return reply.code(400).send({ error: 'leadId é obrigatório' })
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
    if (!lead) return reply.code(404).send({ error: 'Lead não encontrado' })
    const already = await prisma.aluno.findUnique({ where: { leadId }, select: { id: true } })
    if (already) return reply.code(409).send({ error: 'Este contato já é um aluno', alunoId: already.id })

    const ra = await nextRa()
    const aluno = await prisma.aluno.create({
      data: {
        leadId, ra,
        cpf: b.cpf ?? null,
        dataNascimento: b.dataNascimento ? new Date(b.dataNascimento) : null,
        sexo: b.sexo ?? null,
        nomeSocial: b.nomeSocial ?? null,
      },
      select: ALUNO_SELECT,
    })
    return reply.code(201).send({ aluno })
  })

  // ── PATCH /alunos/:id — edita dados acadêmicos ──
  app.patch('/api/admin/aca/alunos/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const current = await prisma.aluno.findUnique({ where: { id }, select: { id: true } })
    if (!current) return reply.code(404).send({ error: 'Aluno não encontrado' })
    const b = (req.body as any) || {}
    const data: any = {}
    if ('cpf' in b) data.cpf = b.cpf || null
    if ('sexo' in b) data.sexo = b.sexo || null
    if ('nomeSocial' in b) data.nomeSocial = b.nomeSocial || null
    if ('dataNascimento' in b) data.dataNascimento = b.dataNascimento ? new Date(b.dataNascimento) : null
    if ('ativo' in b) data.ativo = !!b.ativo
    // F23 — ficha completa: colunas consultáveis
    for (const k of ['rg', 'rgOrgaoEmissor', 'racaCor', 'nacionalidade', 'naturalidade', 'estadoCivil', 'religiao', 'nomePai', 'nomeMae', 'codigoInep', 'codigoGdae', 'enemInscricao']) if (k in b) data[k] = b[k] || null
    if ('emancipado' in b) data.emancipado = !!b.emancipado
    if ('podeSairSozinho' in b) data.podeSairSozinho = !!b.podeSairSozinho
    if ('enemAno' in b) data.enemAno = b.enemAno ? Number(b.enemAno) : null
    if ('enemNota' in b) data.enemNota = b.enemNota != null && b.enemNota !== '' ? Number(b.enemNota) : null
    // JSON (documentos / sócio-econômico / endereço / pessoas autorizadas) — substitui o objeto
    if ('documentosJson' in b) data.documentosJson = b.documentosJson ?? null
    if ('socioEconomicoJson' in b) data.socioEconomicoJson = b.socioEconomicoJson ?? null
    if ('enderecoJson' in b) data.enderecoJson = b.enderecoJson ?? null
    if ('pessoasAutorizadasJson' in b) data.pessoasAutorizadasJson = b.pessoasAutorizadasJson ?? null
    if (Object.keys(data).length === 0) return { ok: true }
    const aluno = await prisma.aluno.update({ where: { id }, data, select: ALUNO_SELECT })
    return { aluno }
  })

  // ── GET /pessoas — listagem unificada por papel (Aluno/Professor/Coordenador/Candidato) ──
  app.get('/api/admin/aca/pessoas', { preHandler: authMiddleware }, async (req) => {
    const q = ((req.query as any).q || '').toString().trim()
    const papel = ((req.query as any).papel || '').toString()
    const like = q ? { contains: q } : undefined
    const pessoas: any[] = []

    if (!papel || papel === 'ALUNO') {
      const alunos = await prisma.aluno.findMany({
        where: q ? { OR: [{ ra: like }, { cpf: like }, { lead: { nome: like } }] } : {},
        select: { id: true, ra: true, cpf: true, ativo: true, lead: { select: { nome: true, email: true } } },
        orderBy: { id: 'desc' }, take: 200,
      })
      for (const a of alunos) pessoas.push({ papel: 'ALUNO', nome: a.lead.nome, documento: a.cpf, ra: a.ra, email: a.lead.email, alunoId: a.id, refId: a.id, ativo: a.ativo })
    }
    if (!papel || papel === 'PROFESSOR' || papel === 'ORIENTADOR') {
      const where: any = {}
      if (papel === 'ORIENTADOR') where.orientador = true
      const docs = await prisma.acaDocente.findMany({ where, select: { id: true, userId: true, titulacao: true, ativo: true, orientador: true }, take: 200 })
      const users = docs.length ? await prisma.user.findMany({ where: { id: { in: docs.map((d) => d.userId) } }, select: { id: true, name: true, email: true } }) : []
      const uMap = new Map(users.map((u) => [u.id, u]))
      for (const d of docs) {
        const u = uMap.get(d.userId)
        if (q && !(u?.name || '').toLowerCase().includes(q.toLowerCase())) continue
        const base = { nome: u?.name ?? `User #${d.userId}`, documento: null, email: u?.email ?? null, refId: d.id, ativo: d.ativo, extra: d.titulacao }
        if ((!papel || papel === 'PROFESSOR')) pessoas.push({ papel: 'PROFESSOR', ...base })
        if (d.orientador && (!papel || papel === 'ORIENTADOR')) pessoas.push({ papel: 'ORIENTADOR', ...base })
      }
    }
    if (!papel || papel === 'COORDENADOR') {
      const coords = await prisma.acaCoordenador.findMany({ where: q ? { nome: like } : {}, select: { id: true, nome: true, email: true, ativo: true, courseId: true }, take: 200 })
      for (const c of coords) pessoas.push({ papel: 'COORDENADOR', nome: c.nome, documento: null, email: c.email, refId: c.id, ativo: c.ativo })
    }
    if (!papel || papel === 'CANDIDATO') {
      const regs = await prisma.processRegistration.findMany({
        where: { status: { notIn: ['matriculado', 'desistente'] }, ...(q ? { lead: { is: { nome: like } } } : {}) },
        select: { id: true, status: true, lead: { select: { nome: true, email: true } } }, orderBy: { id: 'desc' }, take: 200,
      })
      for (const r of regs) pessoas.push({ papel: 'CANDIDATO', nome: r.lead.nome, documento: null, email: r.lead.email, refId: r.id, extra: r.status })
    }
    const counts: Record<string, number> = {}
    for (const p of pessoas) counts[p.papel] = (counts[p.papel] ?? 0) + 1
    return { pessoas: pessoas.slice(0, 400), counts }
  })

  // ── GET /pessoas/refs — apoio ao "Novo" (usuários p/ professor, cursos, processos) ──
  app.get('/api/admin/aca/pessoas/refs', { preHandler: authMiddleware }, async () => {
    const [users, docentes, cursos, processos, offerings] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 }),
      prisma.acaDocente.findMany({ select: { userId: true } }),
      prisma.course.findMany({ where: { active: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' }, take: 300 }),
      prisma.selectionProcess.findMany({ where: { active: true }, select: { id: true, nome: true }, orderBy: { id: 'desc' }, take: 100 }),
      prisma.courseOffering.findMany({ select: { id: true, nome: true }, orderBy: { id: 'desc' }, take: 200 }),
    ])
    const jaDoc = new Set(docentes.map((d) => d.userId))
    return { usuarios: users.map((u) => ({ ...u, jaDocente: jaDoc.has(u.id) })), cursos, processos, offerings }
  })

  // ── POST /pessoas/criar — criação unificada por papel (o botão "Novo") ──
  app.post('/api/admin/aca/pessoas/criar', { preHandler: authMiddleware }, async (req, reply) => {
    const b = (req.body as any) || {}
    const papel = String(b.papel || '')
    const novoLead = async () => prisma.lead.create({ data: { empresa: b.empresa || b.nome || '—', nome: String(b.nome || '').slice(0, 191), whatsapp: b.whatsapp || `manual-${Date.now()}`, email: b.email || `sememail-${Date.now()}@local`, formData: {}, scores: {}, source: 'manual_aca' } })

    if (papel === 'ALUNO') {
      let leadId = b.leadId ? Number(b.leadId) : null
      if (leadId) { if (await prisma.aluno.findUnique({ where: { leadId }, select: { id: true } })) return reply.code(409).send({ error: 'Este contato já é aluno' }) }
      else { if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' }); leadId = (await novoLead()).id }
      const aluno = await prisma.aluno.create({ data: { leadId, ra: await nextRa(), cpf: b.cpf || null, dataNascimento: b.dataNascimento ? new Date(b.dataNascimento) : null, sexo: b.sexo || null }, select: { id: true } })
      return reply.code(201).send({ papel: 'ALUNO', alunoId: aluno.id })
    }
    if (papel === 'PROFESSOR' || papel === 'ORIENTADOR') {
      const userId = Number(b.userId)
      if (!userId) return reply.code(400).send({ error: 'Selecione um usuário' })
      if (await prisma.acaDocente.findUnique({ where: { userId }, select: { id: true } })) return reply.code(409).send({ error: 'Usuário já é docente' })
      const doc = await prisma.acaDocente.create({ data: { userId, titulacao: b.titulacao || null, regime: ['HORISTA', 'PARCIAL', 'INTEGRAL'].includes(b.regime) ? b.regime : 'HORISTA', valorHoraCentavos: Math.max(0, Number(b.valorHoraCentavos) || 0), orientador: papel === 'ORIENTADOR' || !!b.orientador }, select: { id: true } })
      return reply.code(201).send({ papel, docenteId: doc.id })
    }
    if (papel === 'COORDENADOR') {
      if (!b.nome || !b.courseId) return reply.code(400).send({ error: 'nome e curso obrigatórios' })
      const c = await prisma.acaCoordenador.create({ data: { nome: String(b.nome).slice(0, 191), email: b.email || null, courseId: Number(b.courseId) }, select: { id: true } })
      return reply.code(201).send({ papel: 'COORDENADOR', coordenadorId: c.id })
    }
    if (papel === 'CANDIDATO') {
      if (!b.nome || !b.selectionProcessId || !b.offeringId) return reply.code(400).send({ error: 'nome, processo e oferta obrigatórios' })
      const lead = await novoLead()
      const reg = await prisma.processRegistration.create({ data: { leadId: lead.id, offeringId: Number(b.offeringId), selectionProcessId: Number(b.selectionProcessId), status: 'inscrito' }, select: { id: true } })
      return reply.code(201).send({ papel: 'CANDIDATO', registrationId: reg.id })
    }
    return reply.code(400).send({ error: 'papel inválido' })
  })

  // ── POST /alunos/:id/responsaveis — adiciona responsável ──
  app.post('/api/admin/aca/alunos/:id/responsaveis', { preHandler: authMiddleware }, async (req, reply) => {
    const alunoId = Number((req.params as any).id)
    const b = (req.body as any) || {}
    if (!b.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const tipo = ['FINANCEIRO', 'PEDAGOGICO', 'LEGAL', 'CONTRATO', 'FAMILIAR'].includes(b.tipo) ? b.tipo : 'FINANCEIRO'
    const responsavel = await prisma.acaResponsavel.create({
      data: { alunoId, nome: String(b.nome).slice(0, 191), cpf: b.cpf ?? null, parentesco: b.parentesco ?? null, tipo, telefone: b.telefone ?? null, email: b.email ?? null },
    })
    return reply.code(201).send({ responsavel })
  })

  // ── PUT /alunos/:id/responsaveis/:rid — edita responsável ──
  app.put('/api/admin/aca/alunos/:id/responsaveis/:rid', { preHandler: authMiddleware }, async (req) => {
    const rid = Number((req.params as any).rid); const b = (req.body as any) || {}
    const data: any = {}
    for (const k of ['nome', 'cpf', 'parentesco', 'telefone', 'email']) if (k in b) data[k] = b[k] || null
    if ('tipo' in b && ['FINANCEIRO', 'PEDAGOGICO', 'LEGAL', 'CONTRATO', 'FAMILIAR'].includes(b.tipo)) data.tipo = b.tipo
    if ('ativo' in b) data.ativo = !!b.ativo
    return { responsavel: await prisma.acaResponsavel.update({ where: { id: rid }, data }) }
  })

  // ── DELETE /alunos/:id/responsaveis/:rid ──
  app.delete('/api/admin/aca/alunos/:id/responsaveis/:rid', { preHandler: authMiddleware }, async (req) => {
    const rid = Number((req.params as any).rid)
    await prisma.acaResponsavel.deleteMany({ where: { id: rid } })
    return { ok: true }
  })

  // ── GET /aca/meta — atalhos p/ a UI (turma-piloto, contadores) ──
  app.get('/api/admin/aca/meta', { preHandler: authMiddleware }, async () => {
    const [alunos, turmas] = await Promise.all([
      prisma.aluno.count(),
      prisma.acaTurma.count({ where: { ativo: true } }),
    ])
    return { alunos, turmas }
  })
}
