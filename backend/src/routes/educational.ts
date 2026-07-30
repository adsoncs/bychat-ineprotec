// src/routes/educational.ts
// Módulo Educacional — rotas de ativação, status e seed.
// CRUD das entidades (levels, modalities, units, campuses, courses, offerings,
// selection-processes, registrations) será adicionado na Fase 2.

import { FastifyInstance } from 'fastify'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import {
  isEducationalEnabled,
  setEducationalEnabled,
  seedDefaults,
  seedEducationalFunnel,
  DEFAULT_LEVELS,
  DEFAULT_MODALITIES,
  DEFAULT_CUSTOM_FIELDS,
  DEFAULT_FUNNEL_STAGES,
} from '../services/educational.js'
import { prisma } from '../lib/prisma.js'
import { moveToTrash, snapshotEntity, type TrashEntityType } from '../services/trash.js'
import { getOfferingSlotCounts } from '../services/educationalSlots.js'
import { FORMAS_INGRESSO, CRITERIOS_CLASSIFICACAO, acharForma, acharCriterio } from '../services/acaFormaIngresso.js'

// Conta dependências de uma entidade educacional. Retorna lista de
// { label, count } com count > 0. Vazia = pode deletar.
async function _eduDependencies(type: TrashEntityType, id: number): Promise<Array<{ label: string; count: number }>> {
  const out: Array<{ label: string; count: number }> = []
  const push = async (label: string, p: Promise<number>) => {
    const c = await p
    if (c > 0) out.push({ label, count: c })
  }
  switch (type) {
    case 'edu_level':
      await push('curso(s) usando este nível',          prisma.course.count({ where: { levelId: id } }))
      await push('oferta(s) usando este nível',         prisma.courseOffering.count({ where: { levelId: id } }))
      await push('processo(s) seletivo(s) neste nível', prisma.selectionProcess.count({ where: { levelId: id } }))
      break
    case 'edu_modality':
      await push('oferta(s) usando esta modalidade', prisma.courseOffering.count({ where: { modalityId: id } }))
      break
    case 'edu_unit':
      await push('campus vinculado(s) a esta unidade',         prisma.campus.count({ where: { unitId: id } }))
      await push('curso(s) vinculado(s) a esta unidade',       prisma.course.count({ where: { unitId: id } }))
      await push('oferta(s) vinculada(s) a esta unidade',      prisma.courseOffering.count({ where: { unitId: id } }))
      await push('processo(s) vinculado(s) a esta unidade',    prisma.selectionProcess.count({ where: { unitId: id } }))
      await push('portal(is) de matrícula desta unidade',      prisma.enrollmentPortal.count({ where: { unitId: id } }))
      break
    case 'edu_campus':
      await push('oferta(s) ministrada(s) neste local', prisma.courseOfferingCampus.count({ where: { campusId: id } }))
      break
    case 'edu_course':
      await push('oferta(s) deste curso', prisma.courseOffering.count({ where: { courseId: id } }))
      break
    case 'edu_offering':
      await push('inscrição(ões) nesta oferta', prisma.processRegistration.count({ where: { offeringId: id } }))
      break
    case 'edu_selection_process':
      await push('oferta(s) neste processo',         prisma.courseOffering.count({ where: { selectionProcessId: id } }))
      await push('inscrição(ões) neste processo',    prisma.processRegistration.count({ where: { selectionProcessId: id } }))
      break
    case 'edu_entry_mode':
      await push('processo(s) seletivo(s) com este modo', prisma.selectionProcess.count({ where: { entryModeId: id } }))
      break
  }
  return out
}

// Helper centralizado: checa dependências, faz snapshot e move para lixeira.
// Quem chama é responsável por executar o prisma.X.delete() depois (mantém
// flexibilidade se a entidade exigir transação ou cleanup específico).
async function _eduSoftDelete(opts: {
  type: TrashEntityType
  id: number
  label: string
  req: any
}): Promise<{ ok: true } | { error: string; statusCode: number; dependencies?: Array<{ label: string; count: number }> }> {
  const deps = await _eduDependencies(opts.type, opts.id)
  if (deps.length > 0) {
    return {
      statusCode: 409,
      error: `Não é possível excluir: existem registros dependentes. Remova-os antes ou desative em vez de excluir.`,
      dependencies: deps,
    }
  }
  const snap = await snapshotEntity(opts.type, opts.id)
  if (!snap) return { statusCode: 404, error: 'Registro não encontrado' }
  const user = opts.req?.user || {}
  await moveToTrash({
    entityType: opts.type,
    entityId: opts.id,
    entityLabel: opts.label,
    snapshot: snap,
    deletedBy: user.userId || user.id,
    deletedByName: user.name || user.email,
  })
  return { ok: true }
}

// Valida pares de datas (início ≤ término) e retorna mensagem de erro ou null.
// Aceita strings ISO ou Date. Pares com algum lado nulo/vazio são ignorados.
function validateDateRanges(body: any, pairs: Array<[string, string, string]>): string | null {
  for (const [startKey, endKey, label] of pairs) {
    const s = body[startKey]
    const e = body[endKey]
    if (!s || !e) continue
    const sd = new Date(s)
    const ed = new Date(e)
    if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) continue
    if (ed < sd) return `${label}: data de término não pode ser anterior à data de início`
  }
  return null
}

// Normaliza texto em slug: lowercase, sem acento, [a-z0-9-]. Máximo 100 chars.
function slugifyProcess(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

// Resolve o slug de um SelectionProcess:
// - Se o body traz slug: valida formato + unicidade.
// - Senão: gera de `nome-codigo`; em caso de colisão, sufixa com número.
async function resolveProcessSlug(opts: { requested?: string | null; nome: string; codigo?: string | null; excludeId: number | null }): Promise<{ slug?: string; error?: string }> {
  if (opts.requested !== undefined && opts.requested !== null && String(opts.requested).trim() !== '') {
    const normalized = slugifyProcess(opts.requested)
    if (!normalized || !/^[a-z0-9-]{3,100}$/.test(normalized)) {
      return { error: 'Slug inválido. Use apenas letras minúsculas, números e hífen (3-100 chars).' }
    }
    const collision = await prisma.selectionProcess.findFirst({
      where: { slug: normalized, ...(opts.excludeId ? { NOT: { id: opts.excludeId } } : {}) },
      select: { id: true },
    })
    if (collision) return { error: `Slug "${normalized}" já está em uso por outro processo.` }
    return { slug: normalized }
  }
  // Auto-gerar de nome + codigo
  const parts = [slugifyProcess(opts.nome)]
  if (opts.codigo) parts.push(slugifyProcess(opts.codigo))
  let base = parts.filter(Boolean).join('-')
  if (!base) base = `processo-${Date.now()}`
  // Dedup: tenta base; se em uso, sufixa com -2, -3...
  let candidate = base
  let n = 1
  while (true) {
    const exists = await prisma.selectionProcess.findFirst({
      where: { slug: candidate, ...(opts.excludeId ? { NOT: { id: opts.excludeId } } : {}) },
      select: { id: true },
    })
    if (!exists) return { slug: candidate }
    n++
    candidate = `${base}-${n}`
    if (n > 50) return { error: 'Não foi possível gerar um slug único. Informe um slug manualmente.' }
  }
}

export async function educationalRoutes(app: FastifyInstance) {

  // GET /api/admin/educacional/status — verifica se o módulo está ativo
  // enabled  = flag global (o que usuários regulares veem)
  // visible  = se ESTE usuário deve ver a UI do módulo (SUPERADMIN sempre true)
  app.get('/api/admin/educacional/status', { preHandler: authMiddleware }, async (req) => {
    const enabled = await isEducationalEnabled()
    const user = (req as any).user
    const isSuperadmin = user?.role === 'SUPERADMIN'
    const visible = enabled || isSuperadmin

    const [levels, modalities, units, courses, offerings, processes, registrations] = await Promise.all([
      prisma.educationalLevel.count({ where: { active: true } }),
      prisma.modality.count({ where: { active: true } }),
      prisma.educationalUnit.count({ where: { active: true } }),
      prisma.course.count({ where: { active: true } }),
      prisma.courseOffering.count({ where: { active: true } }),
      prisma.selectionProcess.count({ where: { active: true } }),
      prisma.processRegistration.count(),
    ])

    return {
      enabled,    // flag global (usada pra avaliar o estado de fato)
      visible,    // se este usuário deve ver o menu (inclui bypass SUPERADMIN)
      isSuperadmin,
      counts: { levels, modalities, units, courses, offerings, processes, registrations },
      defaults: {
        levels: DEFAULT_LEVELS.length,
        modalities: DEFAULT_MODALITIES.length,
        customFields: DEFAULT_CUSTOM_FIELDS.length,
        funnelStages: DEFAULT_FUNNEL_STAGES.length,
      },
    }
  })

  // POST /api/admin/educacional/toggle — ativa/desativa o módulo
  app.post('/api/admin/educacional/toggle', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { enabled: boolean }
    if (typeof body?.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled obrigatório (boolean)' })
    }
    await setEducationalEnabled(body.enabled)
    const enabled = await isEducationalEnabled()
    return { ok: true, enabled }
  })

  // POST /api/admin/educacional/seed — roda o seed (idempotente)
  app.post('/api/admin/educacional/seed', { preHandler: adminOnly }, async (req) => {
    const q = req.query as any
    const force = q.force === '1' || q.force === 'true'
    const result = await seedDefaults(force)
    return { ok: true, ...result }
  })

  // POST /api/admin/educacional/seed/funnel — cria funil "Captação Educacional"
  app.post('/api/admin/educacional/seed/funnel', { preHandler: adminOnly }, async () => {
    const result = await seedEducationalFunnel()
    return { ok: true, ...result }
  })

  // GET /api/admin/educacional/health — smoke test (gateado pelo modulePermissionHook global)
  app.get('/api/admin/educacional/health', {
    preHandler: [authMiddleware],
  }, async () => {
    return { ok: true, module: 'educational', version: '1.0' }
  })

  // Gateamento de CRUD: hook global modulePermissionHook checa permissão por role/usuário.
  // setEducationalEnabled() sincroniza ModulePermission ao ligar/desligar o módulo.
  const eduAuth = [authMiddleware]
  const eduAdmin = [adminOnly]

  // ══════════════════════════════════════════════
  // NÍVEIS DE ENSINO
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/levels', { preHandler: eduAuth }, async () => {
    const levels = await prisma.educationalLevel.findMany({
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        _count: { select: { courses: true, offerings: true, selectionProcesses: true } },
      },
    })
    return { levels }
  })

  app.post('/api/admin/educacional/levels', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    try {
      const level = await prisma.educationalLevel.create({
        data: {
          nome: body.nome,
          codigo: body.codigo || null,
          descricao: body.descricao || null,
          ordem: parseInt(body.ordem) || 0,
          active: body.active !== false,
        },
      })
      return { ok: true, level }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  app.put('/api/admin/educacional/levels/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    try {
      const level = await prisma.educationalLevel.update({
        where: { id: parseInt(id) },
        data: {
          ...(body.nome !== undefined && { nome: body.nome }),
          ...(body.codigo !== undefined && { codigo: body.codigo || null }),
          ...(body.descricao !== undefined && { descricao: body.descricao || null }),
          ...(body.ordem !== undefined && { ordem: parseInt(body.ordem) || 0 }),
          ...(body.active !== undefined && { active: !!body.active }),
        },
      })
      return { ok: true, level }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/levels/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.educationalLevel.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Nível não encontrado' })
    const r = await _eduSoftDelete({ type: 'edu_level', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    await prisma.educationalLevel.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  app.put('/api/admin/educacional/levels/reorder', { preHandler: eduAdmin }, async (req, reply) => {
    const { items } = req.body as any
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório (array de {id, position})' })
    for (const item of items) {
      const id = parseInt(item?.id)
      const position = parseInt(item?.position)
      if (!Number.isFinite(id) || !Number.isFinite(position)) continue
      await prisma.educationalLevel.update({ where: { id }, data: { ordem: position } })
    }
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // MODALIDADES
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/modalities', { preHandler: eduAuth }, async () => {
    const modalities = await prisma.modality.findMany({
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        _count: { select: { offerings: true } },
      },
    })
    return { modalities }
  })

  app.post('/api/admin/educacional/modalities', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    try {
      const modality = await prisma.modality.create({
        data: {
          nome: body.nome,
          codigo: body.codigo || null,
          descricao: body.descricao || null,
          ordem: parseInt(body.ordem) || 0,
          active: body.active !== false,
        },
      })
      return { ok: true, modality }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  app.put('/api/admin/educacional/modalities/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    try {
      const modality = await prisma.modality.update({
        where: { id: parseInt(id) },
        data: {
          ...(body.nome !== undefined && { nome: body.nome }),
          ...(body.codigo !== undefined && { codigo: body.codigo || null }),
          ...(body.descricao !== undefined && { descricao: body.descricao || null }),
          ...(body.ordem !== undefined && { ordem: parseInt(body.ordem) || 0 }),
          ...(body.active !== undefined && { active: !!body.active }),
        },
      })
      return { ok: true, modality }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/modalities/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.modality.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Modalidade não encontrada' })
    const r = await _eduSoftDelete({ type: 'edu_modality', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    await prisma.modality.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  app.put('/api/admin/educacional/modalities/reorder', { preHandler: eduAdmin }, async (req, reply) => {
    const { items } = req.body as any
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório (array de {id, position})' })
    for (const item of items) {
      const id = parseInt(item?.id)
      const position = parseInt(item?.position)
      if (!Number.isFinite(id) || !Number.isFinite(position)) continue
      await prisma.modality.update({ where: { id }, data: { ordem: position } })
    }
    return { ok: true }
  })

  // ══════════════════════════════════════════════
  // UNIDADES
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/units', { preHandler: eduAuth }, async () => {
    const units = await prisma.educationalUnit.findMany({
      orderBy: { nome: 'asc' },
      include: {
        _count: { select: { campuses: true, courses: true, offerings: true } },
      },
    })
    return { units }
  })

  app.post('/api/admin/educacional/units', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome) return reply.code(400).send({ error: 'nome obrigatório' })
    const unit = await prisma.educationalUnit.create({
      data: {
        nome: body.nome,
        codigo: body.codigo || null,
        descricao: body.descricao || null,
        active: body.active !== false,
      },
    })
    return { ok: true, unit }
  })

  app.put('/api/admin/educacional/units/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    try {
      const unit = await prisma.educationalUnit.update({
        where: { id: parseInt(id) },
        data: {
          ...(body.nome !== undefined && { nome: body.nome }),
          ...(body.codigo !== undefined && { codigo: body.codigo || null }),
          ...(body.descricao !== undefined && { descricao: body.descricao || null }),
          ...(body.active !== undefined && { active: !!body.active }),
        },
      })
      return { ok: true, unit }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/units/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.educationalUnit.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Unidade não encontrada' })
    const r = await _eduSoftDelete({ type: 'edu_unit', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    await prisma.educationalUnit.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  // ══════════════════════════════════════════════
  // CAMPUS
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/campuses', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.unitId) where.unitId = parseInt(q.unitId)
    const campuses = await prisma.campus.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        unit: { select: { id: true, nome: true } },
        _count: { select: { offerings: true } },
      },
    })
    return { campuses }
  })

  app.post('/api/admin/educacional/campuses', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome || !body?.unitId) return reply.code(400).send({ error: 'nome e unitId obrigatórios' })
    const campus = await prisma.campus.create({
      data: {
        unitId: parseInt(body.unitId),
        nome: body.nome,
        codigo: body.codigo || null,
        descricao: body.descricao || null,
        telefone: body.telefone || null,
        email: body.email || null,
        endereco: body.endereco || null,
        numero: body.numero || null,
        bairro: body.bairro || null,
        cep: body.cep || null,
        cidade: body.cidade || null,
        estado: body.estado || null,
        latitude: body.latitude != null ? parseFloat(body.latitude) : null,
        longitude: body.longitude != null ? parseFloat(body.longitude) : null,
        active: body.active !== false,
      },
    })
    return { ok: true, campus }
  })

  app.put('/api/admin/educacional/campuses/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    const fields = ['nome','codigo','descricao','telefone','email','endereco','numero','bairro','cep','cidade','estado']
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f] || null
    }
    if (body.unitId !== undefined) data.unitId = parseInt(body.unitId)
    if (body.latitude !== undefined) data.latitude = body.latitude != null ? parseFloat(body.latitude) : null
    if (body.longitude !== undefined) data.longitude = body.longitude != null ? parseFloat(body.longitude) : null
    if (body.active !== undefined) data.active = !!body.active
    try {
      const campus = await prisma.campus.update({ where: { id: parseInt(id) }, data })
      return { ok: true, campus }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/campuses/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.campus.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Local não encontrado' })
    const r = await _eduSoftDelete({ type: 'edu_campus', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    await prisma.campus.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  // ══════════════════════════════════════════════
  // CURSOS
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/courses', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.unitId) where.unitId = parseInt(q.unitId)
    if (q.levelId) where.levelId = parseInt(q.levelId)
    if (q.search) where.nome = { contains: q.search }
    const courses = await prisma.course.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        unit: { select: { id: true, nome: true } },
        level: { select: { id: true, nome: true } },
        _count: { select: { offerings: true } },
      },
    })
    return { courses }
  })

  app.post('/api/admin/educacional/courses', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome || !body?.unitId) return reply.code(400).send({ error: 'nome e unitId obrigatórios' })
    const course = await prisma.course.create({
      data: {
        unitId: parseInt(body.unitId),
        levelId: body.levelId ? parseInt(body.levelId) : null,
        nome: body.nome,
        codigo: body.codigo || null,
        descricao: body.descricao || null,
        duracaoMeses: body.duracaoMeses ? parseInt(body.duracaoMeses) : null,
        cargaHoraria: body.cargaHoraria ? parseInt(body.cargaHoraria) : null,
        active: body.active !== false,
      },
    })
    return { ok: true, course }
  })

  app.put('/api/admin/educacional/courses/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.unitId !== undefined) data.unitId = parseInt(body.unitId)
    if (body.levelId !== undefined) data.levelId = body.levelId ? parseInt(body.levelId) : null
    if (body.nome !== undefined) data.nome = body.nome
    if (body.codigo !== undefined) data.codigo = body.codigo || null
    if (body.descricao !== undefined) data.descricao = body.descricao || null
    if (body.duracaoMeses !== undefined) data.duracaoMeses = body.duracaoMeses ? parseInt(body.duracaoMeses) : null
    if (body.cargaHoraria !== undefined) data.cargaHoraria = body.cargaHoraria ? parseInt(body.cargaHoraria) : null
    if (body.active !== undefined) data.active = !!body.active
    try {
      const course = await prisma.course.update({ where: { id: parseInt(id) }, data })
      return { ok: true, course }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/courses/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.course.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Curso não encontrado' })
    const r = await _eduSoftDelete({ type: 'edu_course', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    await prisma.course.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  // ══════════════════════════════════════════════
  // OFERTAS DE CURSO
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/offerings', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.courseId) where.courseId = parseInt(q.courseId)
    if (q.unitId) where.unitId = parseInt(q.unitId)
    if (q.modalityId) where.modalityId = parseInt(q.modalityId)
    if (q.levelId) where.levelId = parseInt(q.levelId)
    if (q.selectionProcessId) where.selectionProcessId = parseInt(q.selectionProcessId)
    if (q.periodoLetivo) where.selectionProcess = { periodoLetivo: q.periodoLetivo }
    if (q.status) where.status = q.status
    if (q.search) where.nome = { contains: q.search }

    const offerings = await prisma.courseOffering.findMany({
      where,
      orderBy: [{ nome: 'asc' }],
      include: {
        course:    { select: { id: true, nome: true } },
        unit:      { select: { id: true, nome: true } },
        modality:  { select: { id: true, nome: true } },
        level:     { select: { id: true, nome: true } },
        selectionProcess: { select: { id: true, nome: true, periodoLetivo: true } },
        campuses:  { include: { campus: { select: { id: true, nome: true, cidade: true, estado: true } } } },
      },
    })
    const counts = await getOfferingSlotCounts(offerings.map(o => o.id))
    const decorated = offerings.map(o => {
      const c = counts.get(o.id) || { totalInscricoes: 0, vagasOcupadas: 0 }
      return {
        ...o,
        totalInscricoes: c.totalInscricoes,
        vagasOcupadas: c.vagasOcupadas,
        _count: { registrations: c.totalInscricoes },
      }
    })
    return { offerings: decorated }
  })

  app.get('/api/admin/educacional/offerings/:id', { preHandler: eduAuth }, async (req, reply) => {
    const { id } = req.params as any
    const offering = await prisma.courseOffering.findUnique({
      where: { id: parseInt(id) },
      include: {
        course:    true,
        unit:      { select: { id: true, nome: true } },
        modality:  { select: { id: true, nome: true } },
        level:     { select: { id: true, nome: true } },
        selectionProcess: { select: { id: true, nome: true } },
        campuses:  { include: { campus: true } },
      },
    })
    if (!offering) return reply.code(404).send({ error: 'Oferta não encontrada' })
    return { offering }
  })

  app.post('/api/admin/educacional/offerings', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome || !body?.courseId || !body?.unitId || !body?.modalityId) {
      return reply.code(400).send({ error: 'nome, courseId, unitId e modalityId obrigatórios' })
    }
    const dateErr = validateDateRanges(body, [
      ['inicioInscricao', 'terminoInscricao', 'Inscrições'],
      ['inicioMatricula', 'terminoMatricula', 'Matrículas'],
      ['inicioCurso',     'terminoCurso',     'Curso'],
    ])
    if (dateErr) return reply.code(400).send({ error: dateErr })
    const campusIds: number[] = Array.isArray(body.campusIds) ? body.campusIds.map(Number).filter(Boolean) : []

    const offering = await prisma.courseOffering.create({
      data: {
        courseId: parseInt(body.courseId),
        unitId: parseInt(body.unitId),
        modalityId: parseInt(body.modalityId),
        levelId: body.levelId ? parseInt(body.levelId) : null,
        selectionProcessId: body.selectionProcessId ? parseInt(body.selectionProcessId) : null,
        nome: body.nome,
        complemento: body.complemento || null,
        codigo: body.codigo || null,
        turno: body.turno || null,
        valorMensalidade: body.valorMensalidade != null ? parseFloat(body.valorMensalidade) : null,
        valorMatricula:   body.valorMatricula != null ? parseFloat(body.valorMatricula) : null,
        notaCorte:        body.notaCorte != null && body.notaCorte !== '' ? parseFloat(body.notaCorte) : null,
        vagasMinimas: body.vagasMinimas != null ? parseInt(body.vagasMinimas) : null,
        vagasMaximas: body.vagasMaximas != null ? parseInt(body.vagasMaximas) : null,
        inicioInscricao:  body.inicioInscricao  ? new Date(body.inicioInscricao)  : null,
        terminoInscricao: body.terminoInscricao ? new Date(body.terminoInscricao) : null,
        inicioMatricula:  body.inicioMatricula  ? new Date(body.inicioMatricula)  : null,
        terminoMatricula: body.terminoMatricula ? new Date(body.terminoMatricula) : null,
        inicioCurso:      body.inicioCurso      ? new Date(body.inicioCurso)      : null,
        terminoCurso:     body.terminoCurso     ? new Date(body.terminoCurso)     : null,
        status: body.status || 'active',
        active: body.active !== false,
        campuses: campusIds.length > 0 ? { create: campusIds.map(cid => ({ campusId: cid })) } : undefined,
      },
      include: { campuses: true },
    })
    return { ok: true, offering }
  })

  app.put('/api/admin/educacional/offerings/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const dateErr = validateDateRanges(body, [
      ['inicioInscricao', 'terminoInscricao', 'Inscrições'],
      ['inicioMatricula', 'terminoMatricula', 'Matrículas'],
      ['inicioCurso',     'terminoCurso',     'Curso'],
    ])
    if (dateErr) return reply.code(400).send({ error: dateErr })
    const data: any = {}
    const fks = ['courseId','unitId','modalityId','levelId','selectionProcessId']
    for (const k of fks) {
      if (body[k] !== undefined) data[k] = body[k] ? parseInt(body[k]) : null
    }
    const strs = ['nome','complemento','codigo','turno','status']
    for (const k of strs) {
      if (body[k] !== undefined) data[k] = body[k] || null
    }
    const floats = ['valorMensalidade','valorMatricula','notaCorte']
    for (const k of floats) {
      if (body[k] !== undefined) data[k] = body[k] != null && body[k] !== '' ? parseFloat(body[k]) : null
    }
    const ints = ['vagasMinimas','vagasMaximas']
    for (const k of ints) {
      if (body[k] !== undefined) data[k] = body[k] != null && body[k] !== '' ? parseInt(body[k]) : null
    }
    const dates = ['inicioInscricao','terminoInscricao','inicioMatricula','terminoMatricula','inicioCurso','terminoCurso']
    for (const k of dates) {
      if (body[k] !== undefined) data[k] = body[k] ? new Date(body[k]) : null
    }
    if (body.active !== undefined) data.active = !!body.active

    try {
      // Atualiza a oferta
      const offering = await prisma.courseOffering.update({
        where: { id: parseInt(id) },
        data,
      })
      // Se veio campusIds, sincroniza N:M
      if (Array.isArray(body.campusIds)) {
        const campusIds: number[] = body.campusIds.map(Number).filter(Boolean)
        await prisma.courseOfferingCampus.deleteMany({ where: { offeringId: offering.id } })
        if (campusIds.length > 0) {
          await prisma.courseOfferingCampus.createMany({
            data: campusIds.map(cid => ({ offeringId: offering.id, campusId: cid })),
          })
        }
      }
      return { ok: true, offering }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/offerings/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.courseOffering.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Oferta não encontrada' })
    const r = await _eduSoftDelete({ type: 'edu_offering', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    // CourseOfferingCampus tem onDelete:Cascade — remove junto sem violar FK
    await prisma.courseOffering.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  // ══════════════════════════════════════════════
  // MODOS DE INGRESSO (catálogo + matriz de docs)
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/entry-modes', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = q.includeInactive ? {} : { active: true }
    const modes = await prisma.entryMode.findMany({
      where,
      orderBy: { ordem: 'asc' },
      include: {
        documentRequirements: {
          orderBy: { ordem: 'asc' },
          include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
        },
        _count: { select: { selectionProcesses: true } },
      },
    })
    // Catálogo do Censo vai junto: a tela precisa dele para os selects e para
    // apontar quais modos ainda não declararam a forma oficial.
    return {
      modes,
      catalogoCenso: { formas: FORMAS_INGRESSO, criterios: CRITERIOS_CLASSIFICACAO },
      semFormaDeclarada: modes.filter((m) => !m.censoForma).map((m) => ({ id: m.id, name: m.name })),
    }
  })

  // CRUD do EntryMode em si — permite criar Mestrado, Vestibular EaD, etc.
  // Validações: code é slug-like e único; evaluationType vem de allow-list.
  const ALLOWED_EVAL_TYPES = ['none', 'docs', 'enem', 'exam_online', 'exam_presencial']
  // Forma do Censo e critério vêm de lista fechada (acaFormaIngresso). Valor
  // fora da lista virava dado que o INEP recusa na importação — grava nulo.
  const _censoForma = (v: unknown): string | null => (acharForma(v as string)?.codigo ?? null)
  const _criterio = (v: unknown): string | null => (acharCriterio(v as string)?.codigo ?? null)

  function _parseFormExtras(input: any): { ok: true; value: any } | { ok: false; error: string } {
    if (input === undefined) return { ok: true, value: undefined }
    if (input === null || input === '') return { ok: true, value: null }
    let parsed: any = input
    if (typeof input === 'string') {
      try { parsed = JSON.parse(input) } catch (e: any) { return { ok: false, error: 'defaultFormExtras: JSON inválido' } }
    }
    if (!Array.isArray(parsed)) return { ok: false, error: 'defaultFormExtras: deve ser um array de campos' }
    for (const f of parsed) {
      if (!f || typeof f !== 'object') return { ok: false, error: 'defaultFormExtras: cada campo deve ser um objeto' }
      if (typeof f.name !== 'string' || !f.name) return { ok: false, error: 'defaultFormExtras: cada campo precisa de `name`' }
      if (typeof f.type !== 'string' || !f.type) return { ok: false, error: `defaultFormExtras: campo "${f.name}" precisa de \`type\`` }
    }
    return { ok: true, value: parsed }
  }

  app.post('/api/admin/educacional/entry-modes', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    const code = String(body?.code || '').trim().toLowerCase()
    const name = String(body?.name || '').trim()
    if (!/^[a-z0-9_]{2,40}$/.test(code)) return reply.code(400).send({ error: 'code inválido (use letras minúsculas, números e _; 2–40 chars)' })
    if (!name) return reply.code(400).send({ error: 'name obrigatório' })
    const evaluationType = String(body?.evaluationType || 'docs')
    if (!ALLOWED_EVAL_TYPES.includes(evaluationType)) return reply.code(400).send({ error: `evaluationType inválido (use: ${ALLOWED_EVAL_TYPES.join(', ')})` })
    const extras = _parseFormExtras(body?.defaultFormExtras)
    if (!extras.ok) return reply.code(400).send({ error: extras.error })
    try {
      const mode = await prisma.entryMode.create({
        data: {
          code,
          name,
          icon: body?.icon || null,
          description: body?.description || null,
          evaluationType,
          requiresClassification: !!body?.requiresClassification,
          censoForma: _censoForma(body?.censoForma),
          criterioClassificacao: _criterio(body?.criterioClassificacao),
          defaultFormExtras: extras.value === undefined ? null : extras.value,
          ordem: body?.ordem != null ? parseInt(body.ordem) : 0,
          active: body?.active !== false,
        },
      })
      return { ok: true, mode }
    } catch (err: any) {
      if (String(err?.code) === 'P2002') return reply.code(409).send({ error: 'Já existe um modo com esse code' })
      return reply.code(400).send({ error: err.message })
    }
  })

  app.put('/api/admin/educacional/entry-modes/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.code !== undefined) {
      const c = String(body.code || '').trim().toLowerCase()
      if (!/^[a-z0-9_]{2,40}$/.test(c)) return reply.code(400).send({ error: 'code inválido' })
      data.code = c
    }
    if (body.name !== undefined) {
      const n = String(body.name || '').trim()
      if (!n) return reply.code(400).send({ error: 'name não pode ser vazio' })
      data.name = n
    }
    if (body.icon !== undefined) data.icon = body.icon || null
    if (body.description !== undefined) data.description = body.description || null
    if (body.evaluationType !== undefined) {
      if (!ALLOWED_EVAL_TYPES.includes(body.evaluationType)) return reply.code(400).send({ error: `evaluationType inválido (use: ${ALLOWED_EVAL_TYPES.join(', ')})` })
      data.evaluationType = body.evaluationType
    }
    if (body.requiresClassification !== undefined) data.requiresClassification = !!body.requiresClassification
    if (body.censoForma !== undefined) data.censoForma = _censoForma(body.censoForma)
    if (body.criterioClassificacao !== undefined) data.criterioClassificacao = _criterio(body.criterioClassificacao)
    if (body.defaultFormExtras !== undefined) {
      const extras = _parseFormExtras(body.defaultFormExtras)
      if (!extras.ok) return reply.code(400).send({ error: extras.error })
      data.defaultFormExtras = extras.value === undefined ? null : extras.value
    }
    if (body.ordem !== undefined) data.ordem = parseInt(body.ordem) || 0
    if (body.active !== undefined) data.active = !!body.active
    try {
      const mode = await prisma.entryMode.update({ where: { id: parseInt(id) }, data })
      return { ok: true, mode }
    } catch (err: any) {
      if (String(err?.code) === 'P2002') return reply.code(409).send({ error: 'Já existe um modo com esse code' })
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/entry-modes/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.entryMode.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Modo não encontrado' })
    const r = await _eduSoftDelete({ type: 'edu_entry_mode', id, label: item.name, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    // EntryModeDocumentRequirement tem cascade: some junto. SP usa SetNull mas
    // já bloqueamos acima se houver SP vinculado.
    await prisma.entryMode.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  app.put('/api/admin/educacional/entry-modes/reorder', { preHandler: eduAdmin }, async (req, reply) => {
    const { items } = req.body as any
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório (array de {id, position})' })
    for (const item of items) {
      const id = parseInt(item?.id)
      const position = parseInt(item?.position)
      if (!Number.isFinite(id) || !Number.isFinite(position)) continue
      await prisma.entryMode.update({ where: { id }, data: { ordem: position } })
    }
    return { ok: true }
  })

  // ── Matriz EntryMode × DocumentType (CRUD) ──
  // Cria/atualiza/remove a exigência de um documento dentro de um modo.
  // Usado pela UI admin para editar o default global de cada modo.

  app.post('/api/admin/educacional/entry-modes/:id/documents', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const entryModeId = parseInt(id)
    const documentTypeId = body?.documentTypeId ? parseInt(body.documentTypeId) : null
    if (!documentTypeId) return reply.code(400).send({ error: 'documentTypeId obrigatório' })
    const mode = await prisma.entryMode.findUnique({ where: { id: entryModeId } })
    if (!mode) return reply.code(404).send({ error: 'Modo de ingresso não encontrado' })
    const dt = await prisma.documentType.findUnique({ where: { id: documentTypeId } })
    if (!dt) return reply.code(400).send({ error: 'Tipo de documento inválido' })
    try {
      const req_ = await prisma.entryModeDocumentRequirement.create({
        data: {
          entryModeId,
          documentTypeId,
          required: body.required !== false,
          ordem: body.ordem != null ? parseInt(body.ordem) : 0,
          helpText: body.helpText || null,
        },
        include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
      })
      return { ok: true, requirement: req_ }
    } catch (err: any) {
      if (String(err?.code) === 'P2002') return reply.code(409).send({ error: 'Documento já cadastrado neste modo' })
      return reply.code(400).send({ error: err.message })
    }
  })

  app.put('/api/admin/educacional/entry-modes/:id/documents/:reqId', { preHandler: eduAdmin }, async (req, reply) => {
    const { id, reqId } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.required !== undefined) data.required = !!body.required
    if (body.ordem !== undefined) data.ordem = parseInt(body.ordem) || 0
    if (body.helpText !== undefined) data.helpText = body.helpText || null
    try {
      const updated = await prisma.entryModeDocumentRequirement.update({
        where: { id: parseInt(reqId) },
        data,
        include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
      })
      if (updated.entryModeId !== parseInt(id)) return reply.code(404).send({ error: 'Requirement não pertence ao modo informado' })
      return { ok: true, requirement: updated }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/entry-modes/:id/documents/:reqId', { preHandler: eduAdmin }, async (req, reply) => {
    const { id, reqId } = req.params as any
    try {
      const cur = await prisma.entryModeDocumentRequirement.findUnique({ where: { id: parseInt(reqId) } })
      if (!cur || cur.entryModeId !== parseInt(id)) return reply.code(404).send({ error: 'Requirement não encontrado' })
      await prisma.entryModeDocumentRequirement.delete({ where: { id: parseInt(reqId) } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ══════════════════════════════════════════════
  // TIPOS DE DOCUMENTO (catálogo read-only — seed)
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/document-types', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = { active: true }
    if (q.category) where.category = q.category
    const types = await prisma.documentType.findMany({
      where,
      orderBy: [{ category: 'asc' }, { ordem: 'asc' }],
    })
    return { types }
  })

  // ══════════════════════════════════════════════
  // PROCESSOS SELETIVOS
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/selection-processes', { preHandler: eduAuth }, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.unitId) where.unitId = parseInt(q.unitId)
    if (q.levelId) where.levelId = parseInt(q.levelId)
    if (q.entryModeId) where.entryModeId = parseInt(q.entryModeId)
    if (q.status) where.status = q.status
    const processes = await prisma.selectionProcess.findMany({
      where,
      orderBy: [{ inicioInscricao: 'desc' }, { nome: 'asc' }],
      include: {
        unit: { select: { id: true, nome: true } },
        level: { select: { id: true, nome: true } },
        entryMode: { select: { id: true, code: true, name: true, icon: true, evaluationType: true } },
        _count: { select: { offerings: true, registrations: true } },
      },
    })
    return { processes }
  })

  // GET por id — inclui matriz de docs custom (se houver) + default do modo,
  // suficiente para a UI renderizar o editor com toggle "usar padrão / customizar"
  app.get('/api/admin/educacional/selection-processes/:id', { preHandler: eduAuth }, async (req, reply) => {
    const { id } = req.params as any
    const process = await prisma.selectionProcess.findUnique({
      where: { id: parseInt(id) },
      include: {
        unit: { select: { id: true, nome: true } },
        level: { select: { id: true, nome: true } },
        entryMode: {
          select: {
            id: true, code: true, name: true, icon: true, evaluationType: true,
            documentRequirements: {
              orderBy: { ordem: 'asc' },
              include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
            },
          },
        },
        documentRequirements: {
          orderBy: { ordem: 'asc' },
          include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
        },
        _count: { select: { offerings: true, registrations: true } },
      },
    })
    if (!process) return reply.code(404).send({ error: 'Processo não encontrado' })
    return { process }
  })

  // ── Matriz SelectionProcess × DocumentType (CRUD) ──
  // Ativada quando SP.useCustomDocuments = true. Quando o coordenador liga o
  // toggle pela primeira vez, a UI envia o snapshot dos defaults do EntryMode
  // pra esta endpoint via POST /clone-from-mode, evitando começar com lista vazia.

  app.post('/api/admin/educacional/selection-processes/:id/documents', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const selectionProcessId = parseInt(id)
    const documentTypeId = body?.documentTypeId ? parseInt(body.documentTypeId) : null
    if (!documentTypeId) return reply.code(400).send({ error: 'documentTypeId obrigatório' })
    const sp = await prisma.selectionProcess.findUnique({ where: { id: selectionProcessId } })
    if (!sp) return reply.code(404).send({ error: 'Processo seletivo não encontrado' })
    const dt = await prisma.documentType.findUnique({ where: { id: documentTypeId } })
    if (!dt) return reply.code(400).send({ error: 'Tipo de documento inválido' })
    try {
      const req_ = await prisma.selectionProcessDocumentRequirement.create({
        data: {
          selectionProcessId,
          documentTypeId,
          required: body.required !== false,
          ordem: body.ordem != null ? parseInt(body.ordem) : 0,
          helpText: body.helpText || null,
        },
        include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
      })
      return { ok: true, requirement: req_ }
    } catch (err: any) {
      if (String(err?.code) === 'P2002') return reply.code(409).send({ error: 'Documento já cadastrado neste processo' })
      return reply.code(400).send({ error: err.message })
    }
  })

  app.put('/api/admin/educacional/selection-processes/:id/documents/:reqId', { preHandler: eduAdmin }, async (req, reply) => {
    const { id, reqId } = req.params as any
    const body = req.body as any
    const data: any = {}
    if (body.required !== undefined) data.required = !!body.required
    if (body.ordem !== undefined) data.ordem = parseInt(body.ordem) || 0
    if (body.helpText !== undefined) data.helpText = body.helpText || null
    try {
      const updated = await prisma.selectionProcessDocumentRequirement.update({
        where: { id: parseInt(reqId) },
        data,
        include: { documentType: { select: { id: true, code: true, name: true, category: true } } },
      })
      if (updated.selectionProcessId !== parseInt(id)) return reply.code(404).send({ error: 'Requirement não pertence ao processo informado' })
      return { ok: true, requirement: updated }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  app.delete('/api/admin/educacional/selection-processes/:id/documents/:reqId', { preHandler: eduAdmin }, async (req, reply) => {
    const { id, reqId } = req.params as any
    try {
      const cur = await prisma.selectionProcessDocumentRequirement.findUnique({ where: { id: parseInt(reqId) } })
      if (!cur || cur.selectionProcessId !== parseInt(id)) return reply.code(404).send({ error: 'Requirement não encontrado' })
      await prisma.selectionProcessDocumentRequirement.delete({ where: { id: parseInt(reqId) } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // Atalho: clona docs do EntryMode atual do SP para a tabela de override.
  // Usado pela UI quando o coordenador ativa o toggle "customizar para este processo"
  // pela primeira vez. Não duplica entradas existentes.
  app.post('/api/admin/educacional/selection-processes/:id/documents/clone-from-mode', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const selectionProcessId = parseInt(id)
    const sp = await prisma.selectionProcess.findUnique({
      where: { id: selectionProcessId },
      include: { entryMode: { include: { documentRequirements: true } } },
    })
    if (!sp) return reply.code(404).send({ error: 'Processo não encontrado' })
    const sourceReqs = sp.entryMode?.documentRequirements || []
    if (sourceReqs.length === 0) return { ok: true, cloned: 0 }
    const existing = await prisma.selectionProcessDocumentRequirement.findMany({
      where: { selectionProcessId },
      select: { documentTypeId: true },
    })
    const taken = new Set(existing.map(r => r.documentTypeId))
    const toCreate = sourceReqs.filter(r => !taken.has(r.documentTypeId))
    if (toCreate.length === 0) return { ok: true, cloned: 0 }
    await prisma.selectionProcessDocumentRequirement.createMany({
      data: toCreate.map(r => ({
        selectionProcessId,
        documentTypeId: r.documentTypeId,
        required: r.required,
        ordem: r.ordem,
        helpText: r.helpText,
      })),
    })
    return { ok: true, cloned: toCreate.length }
  })

  // ════════════════════════════════════════════════════════════════
  // Temas da Redação Online — CRUD por SelectionProcess
  // O candidato recebe um tema sorteado entre os ativos no /start.
  // ════════════════════════════════════════════════════════════════

  app.get('/api/admin/educacional/selection-processes/:id/essay-topics', { preHandler: eduAuth }, async (req) => {
    const { id } = req.params as any
    const topics = await prisma.essayTopic.findMany({
      where: { selectionProcessId: parseInt(id) },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    })
    return { topics }
  })

  app.post('/api/admin/educacional/selection-processes/:id/essay-topics', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = (req.body as any) || {}
    const prompt = String(body.prompt || '').trim()
    if (!prompt) return reply.code(400).send({ error: 'O enunciado (prompt) é obrigatório' })
    const sp = await prisma.selectionProcess.findUnique({ where: { id: parseInt(id) }, select: { id: true } })
    if (!sp) return reply.code(404).send({ error: 'Processo seletivo não encontrado' })
    // Origem do tema — UI envia 'ai' (gerado pela IA), 'enem' (importado do
    // catálogo INEP) ou 'manual' (digitado direto). Valida whitelist.
    const allowedSources = ['ai', 'enem', 'manual']
    const source = allowedSources.includes(String(body.source)) ? String(body.source) : 'manual'
    const topic = await prisma.essayTopic.create({
      data: {
        selectionProcessId: parseInt(id),
        title: body.title ? String(body.title).slice(0, 150) : null,
        prompt,
        supportTexts: body.supportTexts ? String(body.supportTexts) : null,
        active: body.active === false ? false : true,
        ordem: Number.isFinite(parseInt(body.ordem)) ? parseInt(body.ordem) : 0,
        source,
        sourceMeta: body.sourceMeta && typeof body.sourceMeta === 'object' ? body.sourceMeta : undefined,
      },
    })
    return { ok: true, topic }
  })

  app.put('/api/admin/educacional/essay-topics/:topicId', { preHandler: eduAdmin }, async (req, reply) => {
    const { topicId } = req.params as any
    const body = (req.body as any) || {}
    const data: any = {}
    if (body.title !== undefined)        data.title = body.title ? String(body.title).slice(0, 150) : null
    if (body.prompt !== undefined) {
      const p = String(body.prompt || '').trim()
      if (!p) return reply.code(400).send({ error: 'O enunciado (prompt) não pode ficar vazio' })
      data.prompt = p
    }
    if (body.supportTexts !== undefined) data.supportTexts = body.supportTexts ? String(body.supportTexts) : null
    if (body.active !== undefined)       data.active = !!body.active
    if (body.ordem !== undefined && Number.isFinite(parseInt(body.ordem))) data.ordem = parseInt(body.ordem)
    // Permite reclassificar a origem (ex: badge gravada errada no backfill).
    if (body.source !== undefined) {
      const allowed = ['ai', 'enem', 'manual']
      if (!allowed.includes(String(body.source))) {
        return reply.code(400).send({ error: 'source inválido (use ai|enem|manual)' })
      }
      data.source = String(body.source)
    }
    if (body.sourceMeta !== undefined) {
      data.sourceMeta = body.sourceMeta && typeof body.sourceMeta === 'object' ? body.sourceMeta : null
    }
    try {
      const topic = await prisma.essayTopic.update({ where: { id: parseInt(topicId) }, data })
      return { ok: true, topic }
    } catch (err: any) {
      return reply.code(404).send({ error: 'Tema não encontrado' })
    }
  })

  app.delete('/api/admin/educacional/essay-topics/:topicId', { preHandler: eduAdmin }, async (req, reply) => {
    const { topicId } = req.params as any
    try {
      await prisma.essayTopic.delete({ where: { id: parseInt(topicId) } })
      return { ok: true }
    } catch (err: any) {
      return reply.code(404).send({ error: 'Tema não encontrado' })
    }
  })

  app.put('/api/admin/educacional/selection-processes/:id/essay-topics/reorder', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const spId = parseInt(id)
    const { items } = req.body as any
    if (!Array.isArray(items)) return reply.code(400).send({ error: 'items obrigatório (array de {id, position})' })
    for (const item of items) {
      const topicId = parseInt(item?.id)
      const position = parseInt(item?.position)
      if (!Number.isFinite(topicId) || !Number.isFinite(position)) continue
      // updateMany com filtro por SP id, evita reordenar tema de outro SP por id forjado.
      await prisma.essayTopic.updateMany({
        where: { id: topicId, selectionProcessId: spId },
        data: { ordem: position },
      })
    }
    return { ok: true }
  })

  // Catálogo curado dos últimos 10 temas do ENEM (fonte: cadernos oficiais INEP).
  // Devolve title/prompt/supportTexts já no formato pronto para o editor.
  app.get('/api/admin/educacional/essay-topics/enem-catalog', { preHandler: eduAuth }, async () => {
    const { ENEM_ESSAY_CATALOG } = await import('../services/enemEssayCatalog.js')
    return { themes: ENEM_ESSAY_CATALOG }
  })

  // Geração de tema via IA (Claude). O resultado NÃO é persistido — o admin
  // revisa no editor e salva (ou descarta) pelo CRUD normal.
  app.post('/api/admin/educacional/essay-topics/ai-generate', { preHandler: eduAdmin }, async (req, reply) => {
    const body = (req.body as any) || {}
    const { generateEssayTopic } = await import('../services/aiEssayTopicGenerator.js')
    try {
      const topic = await generateEssayTopic({
        context: body.context ? String(body.context).slice(0, 500) : undefined,
        audience: body.audience ? String(body.audience).slice(0, 100) : undefined,
        area: body.area ? String(body.area).slice(0, 100) : undefined,
        includeSupportTexts: body.includeSupportTexts !== false,
      })
      return {
        ok: true,
        topic: {
          title: topic.title,
          prompt: topic.prompt,
          supportTexts: topic.supportTexts,
        },
        usage: {
          inputTokens: topic.inputTokens,
          outputTokens: topic.outputTokens,
          costUsd: topic.costUsd,
        },
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Falha ao gerar tema' })
    }
  })

  app.post('/api/admin/educacional/selection-processes', { preHandler: eduAdmin }, async (req, reply) => {
    const body = req.body as any
    if (!body?.nome || !body?.unitId) return reply.code(400).send({ error: 'nome e unitId obrigatórios' })
    if (!body?.entryModeId) return reply.code(400).send({ error: 'entryModeId é obrigatório — escolha o modo de ingresso' })
    const dateErr = validateDateRanges(body, [
      ['inicioInscricao', 'terminoInscricao', 'Inscrições'],
      ['inicioMatricula', 'terminoMatricula', 'Matrículas'],
    ])
    if (dateErr) return reply.code(400).send({ error: dateErr })

    const entryModeExists = await prisma.entryMode.findUnique({ where: { id: parseInt(body.entryModeId) } })
    if (!entryModeExists) return reply.code(400).send({ error: 'Modo de ingresso inválido' })

    // Resolve slug: usa fornecido ou gera automaticamente a partir de nome+codigo.
    const slugRes = await resolveProcessSlug({
      requested: body.slug,
      nome: body.nome,
      codigo: body.codigo,
      excludeId: null,
    })
    if (slugRes.error) return reply.code(409).send({ error: slugRes.error })

    const toInt = (v: any) => v != null && v !== '' && Number.isFinite(parseInt(v)) ? parseInt(v) : null
    const toFloat = (v: any) => v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null
    const maxAttempts = toInt(body.essayMaxAttempts)
    const process = await prisma.selectionProcess.create({
      data: {
        unitId: parseInt(body.unitId),
        levelId: body.levelId ? parseInt(body.levelId) : null,
        entryModeId: parseInt(body.entryModeId),
        nome: body.nome,
        codigo: body.codigo || null,
        slug: slugRes.slug,
        descricao: body.descricao || null,
        editalUrl: body.editalUrl || null,
        taxaInscricao: body.taxaInscricao != null ? parseFloat(body.taxaInscricao) : null,
        notaCorte: body.notaCorte != null && body.notaCorte !== '' ? parseFloat(body.notaCorte) : null,
        periodoLetivo: body.periodoLetivo || null,
        inicioInscricao:  body.inicioInscricao  ? new Date(body.inicioInscricao)  : null,
        terminoInscricao: body.terminoInscricao ? new Date(body.terminoInscricao) : null,
        inicioMatricula:  body.inicioMatricula  ? new Date(body.inicioMatricula)  : null,
        terminoMatricula: body.terminoMatricula ? new Date(body.terminoMatricula) : null,
        status: body.status || 'active',
        active: body.active !== false,
        useCustomDocuments: !!body.useCustomDocuments,
        // Configuração da Redação Online (modo exam_online) e cutoff presencial.
        essayPrompt:          body.essayPrompt || null,
        essayDurationMinutes: toInt(body.essayDurationMinutes),
        essayMaxAttempts:     maxAttempts != null && maxAttempts >= 1 ? maxAttempts : 1,
        essayMinWords:        toInt(body.essayMinWords),
        essayMaxWords:        toInt(body.essayMaxWords),
        essayPasteBlocked:    body.essayPasteBlocked === false ? false : true,
        essayAiEnabled:       body.essayAiEnabled === false ? false : true,
        essayAiAutoApprove:   body.essayAiAutoApprove === true,
        essayCutoff:          toFloat(body.essayCutoff),
        essayAiCriteria:      Array.isArray(body.essayAiCriteria) ? body.essayAiCriteria : null,
        presencialCutoff:     toFloat(body.presencialCutoff),
      },
    })
    return { ok: true, process }
  })

  app.put('/api/admin/educacional/selection-processes/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const dateErr = validateDateRanges(body, [
      ['inicioInscricao', 'terminoInscricao', 'Inscrições'],
      ['inicioMatricula', 'terminoMatricula', 'Matrículas'],
    ])
    if (dateErr) return reply.code(400).send({ error: dateErr })
    const data: any = {}
    if (body.unitId !== undefined) data.unitId = parseInt(body.unitId)
    if (body.levelId !== undefined) data.levelId = body.levelId ? parseInt(body.levelId) : null
    const strs = ['nome','codigo','descricao','editalUrl','status','periodoLetivo']
    for (const k of strs) if (body[k] !== undefined) data[k] = body[k] || null
    if (body.taxaInscricao !== undefined) data.taxaInscricao = body.taxaInscricao != null && body.taxaInscricao !== '' ? parseFloat(body.taxaInscricao) : null
    if (body.notaCorte !== undefined) data.notaCorte = body.notaCorte != null && body.notaCorte !== '' ? parseFloat(body.notaCorte) : null
    if (body.entryModeId !== undefined) data.entryModeId = body.entryModeId ? parseInt(body.entryModeId) : null
    const dates = ['inicioInscricao','terminoInscricao','inicioMatricula','terminoMatricula']
    for (const k of dates) if (body[k] !== undefined) data[k] = body[k] ? new Date(body[k]) : null
    if (body.active !== undefined) data.active = !!body.active
    if (body.useCustomDocuments !== undefined) data.useCustomDocuments = !!body.useCustomDocuments

    // ── Configuração da Redação Online + cutoff presencial ──
    const toInt = (v: any) => v != null && v !== '' && Number.isFinite(parseInt(v)) ? parseInt(v) : null
    const toFloat = (v: any) => v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null
    if (body.essayPrompt !== undefined)          data.essayPrompt = body.essayPrompt || null
    if (body.essayDurationMinutes !== undefined) data.essayDurationMinutes = toInt(body.essayDurationMinutes)
    if (body.essayMaxAttempts !== undefined) {
      const v = toInt(body.essayMaxAttempts)
      data.essayMaxAttempts = v != null && v >= 1 ? v : 1
    }
    if (body.essayMinWords !== undefined)     data.essayMinWords = toInt(body.essayMinWords)
    if (body.essayMaxWords !== undefined)     data.essayMaxWords = toInt(body.essayMaxWords)
    if (body.essayPasteBlocked !== undefined)  data.essayPasteBlocked = !!body.essayPasteBlocked
    if (body.essayAiEnabled !== undefined)     data.essayAiEnabled = !!body.essayAiEnabled
    if (body.essayAiAutoApprove !== undefined) data.essayAiAutoApprove = !!body.essayAiAutoApprove
    if (body.essayCutoff !== undefined)        data.essayCutoff = toFloat(body.essayCutoff)
    if (body.essayAiCriteria !== undefined)   data.essayAiCriteria = Array.isArray(body.essayAiCriteria) ? body.essayAiCriteria : null
    if (body.presencialCutoff !== undefined)  data.presencialCutoff = toFloat(body.presencialCutoff)

    // Resolve slug quando nome/codigo/slug mudaram (ou slug veio vazio pra regeneração)
    if (body.slug !== undefined || body.nome !== undefined || body.codigo !== undefined) {
      const current = await prisma.selectionProcess.findUnique({ where: { id: parseInt(id) }, select: { nome: true, codigo: true } })
      if (!current) return reply.code(404).send({ error: 'Processo não encontrado' })
      const slugRes = await resolveProcessSlug({
        requested: body.slug,
        nome: body.nome ?? current.nome,
        codigo: body.codigo ?? current.codigo,
        excludeId: parseInt(id),
      })
      if (slugRes.error) return reply.code(409).send({ error: slugRes.error })
      data.slug = slugRes.slug
    }

    try {
      const process = await prisma.selectionProcess.update({ where: { id: parseInt(id) }, data })
      return { ok: true, process }
    } catch (err: any) {
      return reply.code(404).send({ error: err.message })
    }
  })

  // ── GET /api/admin/educacional/selection-processes/by-slug/:slug — lookup pelo slug ──
  app.get('/api/admin/educacional/selection-processes/by-slug/:slug', { preHandler: eduAuth }, async (req, reply) => {
    const { slug } = req.params as any
    const process = await prisma.selectionProcess.findUnique({
      where: { slug },
      include: {
        unit: { select: { id: true, nome: true } },
        level: { select: { id: true, nome: true } },
        _count: { select: { offerings: true, registrations: true } },
      },
    })
    if (!process) return reply.code(404).send({ error: 'Processo não encontrado' })
    return { process }
  })

  // ── GET /api/public/selection-processes/:slug — endpoint público (SEM auth) para portal de matrículas ──
  app.get('/api/public/selection-processes/:slug', async (req, reply) => {
    const { slug } = req.params as any
    if (!/^[a-z0-9-]{3,100}$/.test(slug || '')) {
      return reply.code(400).send({ error: 'Slug inválido' })
    }
    const process = await prisma.selectionProcess.findUnique({
      where: { slug },
      select: {
        id: true, nome: true, codigo: true, slug: true, descricao: true,
        editalUrl: true, taxaInscricao: true, periodoLetivo: true,
        inicioInscricao: true, terminoInscricao: true,
        inicioMatricula: true, terminoMatricula: true,
        notaCorte: true,
        status: true, active: true,
        unit: { select: { id: true, nome: true, codigo: true } },
        level: { select: { id: true, nome: true } },
        entryMode: {
          select: {
            id: true, code: true, name: true, icon: true, description: true,
            evaluationType: true, requiresClassification: true,
            defaultFormExtras: true,
            documentRequirements: {
              orderBy: { ordem: 'asc' },
              select: {
                required: true, ordem: true, helpText: true,
                documentType: { select: { code: true, name: true, category: true } },
              },
            },
          },
        },
        offerings: {
          where: { active: true },
          select: {
            id: true, nome: true, vagasMinimas: true, vagasMaximas: true,
            valorMensalidade: true, valorMatricula: true,
            inicioCurso: true, terminoCurso: true,
            course: { select: { id: true, nome: true } },
            campuses: { select: { campus: { select: { id: true, nome: true, cidade: true, estado: true } } } },
          },
        },
      },
    })
    if (!process) return reply.code(404).send({ error: 'Processo não encontrado' })
    // Não expõe processos desativados/fechados ao público
    if (!process.active || process.status === 'draft') return reply.code(404).send({ error: 'Processo indisponível' })
    return { process }
  })

  app.delete('/api/admin/educacional/selection-processes/:id', { preHandler: eduAdmin }, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const item = await prisma.selectionProcess.findUnique({ where: { id } })
    if (!item) return reply.code(404).send({ error: 'Processo não encontrado' })
    const r = await _eduSoftDelete({ type: 'edu_selection_process', id, label: item.nome, req })
    if ('error' in r) return reply.code(r.statusCode).send({ error: r.error, dependencies: r.dependencies })
    // SelectionProcessDocumentRequirement tem cascade: some junto.
    await prisma.selectionProcess.delete({ where: { id } })
    return { ok: true, movedToTrash: true }
  })

  // ══════════════════════════════════════════════
  // REGISTROS DE PROCESSO (inscrições do lead)
  // ══════════════════════════════════════════════
  app.get('/api/bychat/leads/:leadId/educational-registrations', { preHandler: eduAuth }, async (req) => {
    const { leadId } = req.params as any
    const q = req.query as any
    const limit  = Math.min(Math.max(parseInt(q.limit)  || 50, 1), 200)
    const offset = Math.max(parseInt(q.offset) || 0, 0)
    const where = { leadId: parseInt(leadId) }
    const [total, registrations] = await Promise.all([
      prisma.processRegistration.count({ where }),
      prisma.processRegistration.findMany({
        where,
        orderBy: { inscritoEm: 'desc' },
        skip: offset,
        take: limit,
        include: {
          offering: {
            include: {
              course:   { select: { id: true, nome: true } },
              modality: { select: { id: true, nome: true } },
              level:    { select: { id: true, nome: true } },
              unit:     { select: { id: true, nome: true } },
            },
          },
          selectionProcess: { select: { id: true, nome: true } },
          enrollmentRegistration: {
            select: {
              id: true, candidateCode: true, status: true,
              paymentStatus: true, paymentUrl: true, paymentAmount: true, paymentPaidAt: true, paymentExpiresAt: true,
              portal: {
                select: {
                  id: true, nome: true, slug: true,
                  requirePayment: true, paymentConnectionId: true,
                },
              },
              _count: { select: { documents: true } },
            },
          },
        },
      }),
    ])
    return { registrations, total, limit, offset }
  })

  app.post('/api/bychat/leads/:leadId/educational-registrations', { preHandler: eduAuth }, async (req, reply) => {
    const { leadId } = req.params as any
    const body = req.body as any
    if (!body?.offeringId || !body?.selectionProcessId) {
      return reply.code(400).send({ error: 'offeringId e selectionProcessId obrigatórios' })
    }
    try {
      const reg = await prisma.processRegistration.create({
        data: {
          leadId: parseInt(leadId),
          offeringId: parseInt(body.offeringId),
          selectionProcessId: parseInt(body.selectionProcessId),
          codigo: body.codigo || null,
          status: body.status || 'inscrito',
          observacao: body.observacao || null,
          notaClassificacao: body.notaClassificacao != null ? parseFloat(body.notaClassificacao) : null,
          posicaoClassificacao: body.posicaoClassificacao != null ? parseInt(body.posicaoClassificacao) : null,
        },
      })
      return { ok: true, registration: reg }
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'Lead já está inscrito nessa oferta' })
      }
      return reply.code(400).send({ error: err.message })
    }
  })

  // PUT /api/bychat/leads/:leadId/educational-registrations/:id
  // Ao setar status='matriculado', dispara saleDetected + saleValue no lead.
  app.put('/api/bychat/leads/:leadId/educational-registrations/:id', { preHandler: eduAuth }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const actor = (req as any).user

    const existing = await prisma.processRegistration.findUnique({
      where: { id: parseInt(id) },
      include: { offering: true },
    })
    if (!existing) return reply.code(404).send({ error: 'Registro não encontrado' })

    const data: any = {}
    if (body.codigo !== undefined) data.codigo = body.codigo || null
    if (body.observacao !== undefined) data.observacao = body.observacao || null
    if (body.notaClassificacao !== undefined) data.notaClassificacao = body.notaClassificacao != null && body.notaClassificacao !== '' ? parseFloat(body.notaClassificacao) : null
    if (body.posicaoClassificacao !== undefined) data.posicaoClassificacao = body.posicaoClassificacao != null && body.posicaoClassificacao !== '' ? parseInt(body.posicaoClassificacao) : null
    if (body.valorPago !== undefined) data.valorPago = body.valorPago != null && body.valorPago !== '' ? parseFloat(body.valorPago) : null

    // Transições de status preenchem os timestamps automaticamente
    const statusChanged = body.status && body.status !== existing.status
    if (statusChanged) {
      data.status = body.status
      const now = new Date()
      switch (body.status) {
        case 'pago_taxa':   data.pagoTaxaEm = now; break
        case 'classificado': data.classificadoEm = now; break
        case 'convocado':   data.convocadoEm = now; break
        case 'matriculado': data.matriculadoEm = now; break
        case 'desistente':  data.desistenteEm = now; break
      }
    }

    const updated = await prisma.processRegistration.update({
      where: { id: parseInt(id) },
      data,
    })

    // Auditoria: registra mudança de status com ator e observação
    if (statusChanged) {
      await prisma.processRegistrationStatusLog.create({
        data: {
          registrationId: updated.id,
          fromStatus: existing.status,
          toStatus: body.status,
          actorId: actor?.id || null,
          actorName: actor?.name || actor?.email || null,
          observacao: body.observacao || null,
        },
      }).catch(err => console.error('[educational] falha ao gravar status log:', err))
    }

    // INTEGRAÇÃO MATRÍCULA → VENDA DETECTADA
    // Quando uma matrícula é confirmada, promove pra venda no CRM.
    // Isso alimenta ROI, Google Ads Conversions, Meta CAPI e widgets de vendas.
    if (body.status === 'matriculado' && existing.status !== 'matriculado') {
      try {
        const off = existing.offering
        // Valor da venda = mensalidade × duração do curso + matrícula
        // Se não tiver dados suficientes, usa só o valor da matrícula ou 0
        const course = await prisma.course.findUnique({ where: { id: off.courseId } })
        const mensalidade = off.valorMensalidade ? Number(off.valorMensalidade) : 0
        const duracao = course?.duracaoMeses || 0
        const matricula = off.valorMatricula ? Number(off.valorMatricula) : 0
        const saleValue = (mensalidade * duracao) + matricula

        await prisma.lead.update({
          where: { id: existing.leadId },
          data: {
            saleDetected: true,
            saleDetectedAt: new Date(),
            saleValue: saleValue > 0 ? saleValue : null,
          },
        })

        await prisma.detectedSale.create({
          data: {
            leadId: existing.leadId,
            value: saleValue > 0 ? saleValue : null,
            productService: off.nome,
            confidence: 'high',
            aiExplanation: `Matrícula confirmada em ${off.nome}`,
            previousStatus: 'CLASSIFICADO',
            newStatus: 'MATRICULADO',
            autoMoved: false,
            originType: 'educational_enrollment',
          } as any,
        }).catch(() => {}) // se tabela DetectedSale tiver colunas diferentes, não quebra
      } catch (err) {
        console.error('[educational] falha ao promover matrícula para venda:', err)
      }
    }

    return { ok: true, registration: updated }
  })

  app.delete('/api/bychat/leads/:leadId/educational-registrations/:id', { preHandler: eduAuth }, async (req) => {
    const { id } = req.params as any
    await prisma.processRegistration.delete({ where: { id: parseInt(id) } }).catch(() => null)
    return { ok: true }
  })

  // GET histórico de mudanças de status de uma inscrição
  app.get('/api/bychat/leads/:leadId/educational-registrations/:id/history', { preHandler: eduAuth }, async (req) => {
    const { id } = req.params as any
    const logs = await prisma.processRegistrationStatusLog.findMany({
      where: { registrationId: parseInt(id) },
      orderBy: { createdAt: 'desc' },
    })
    return { logs }
  })

  // ══════════════════════════════════════════════
  // STATS — widgets do dashboard educacional
  // ══════════════════════════════════════════════
  app.get('/api/admin/educacional/stats', { preHandler: eduAuth }, async () => {
    const [
      totalCourses, totalOfferings, totalProcesses,
      totalRegistrations, matriculados, inscritos,
      byStatus, byOffering,
    ] = await Promise.all([
      prisma.course.count({ where: { active: true } }),
      prisma.courseOffering.count({ where: { active: true } }),
      prisma.selectionProcess.count({ where: { active: true } }),
      prisma.processRegistration.count(),
      prisma.processRegistration.count({ where: { status: 'matriculado' } }),
      prisma.processRegistration.count({ where: { status: 'inscrito' } }),
      prisma.$queryRaw`
        SELECT status, COUNT(*) as count
        FROM bychat_edu_process_registrations
        GROUP BY status
        ORDER BY count DESC
      ` as Promise<any[]>,
      prisma.$queryRaw`
        SELECT o.id, o.nome, COUNT(r.id) as registrations,
               SUM(CASE WHEN r.status='matriculado' THEN 1 ELSE 0 END) as matriculated
        FROM bychat_edu_offerings o
        LEFT JOIN bychat_edu_process_registrations r ON r.offeringId = o.id
        WHERE o.active = 1
        GROUP BY o.id, o.nome
        ORDER BY registrations DESC
        LIMIT 10
      ` as Promise<any[]>,
    ])

    const sanitize = (rows: any[]) => rows.map(r => {
      const out: any = {}
      for (const k of Object.keys(r)) out[k] = typeof r[k] === 'bigint' ? Number(r[k]) : r[k]
      return out
    })

    const conversion = totalRegistrations > 0 ? Math.round((matriculados / totalRegistrations) * 100) : 0

    return {
      totalCourses,
      totalOfferings,
      totalProcesses,
      totalRegistrations,
      matriculados,
      inscritos,
      conversionRate: conversion,
      byStatus: sanitize(byStatus),
      topOfferings: sanitize(byOffering),
    }
  })
}
