// src/routes/seiIntegration.ts
//
// Integração com o SEI (ERP acadêmico) — Integrações › SEI.
//
//   GET  /api/admin/sei/config            POST /api/admin/sei/config
//   POST /api/admin/sei/testar            → NE003 (lista de cursos/banners)
//   GET  /api/admin/sei/catalogo/banners  GET /api/admin/sei/catalogo/curso/:codigo
//   GET  /api/admin/sei/catalogo/opcoes   → NE009 para uma pessoa de teste
//   GET  /api/admin/sei/mapeamentos       PUT /api/admin/sei/mapeamentos/:tipo/:localId
//   GET  /api/admin/sei/previa/:registrationId
//   GET  /api/admin/sei/inscricao/:registrationId   (estado do envio de uma inscrição)
//   GET  /api/admin/sei/envios            GET /api/admin/sei/envios/:id
//   POST /api/admin/sei/envios            POST /api/admin/sei/envios/:id/reprocessar | /cancelar

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly } from '../lib/auth.js'
import * as sei from '../lib/seiClient.js'
import { previa, enfileirar, processar, CONTRATO_LOCAL_ID } from '../services/seiIntegracao.js'

const guard = { preHandler: [authMiddleware, adminOnly] }

async function salvar(key: string, value: string, label: string, fieldType: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, label, grp: 'sei', fieldType },
    update: { value },
  })
}

function erro(reply: any, e: any) {
  const status = e instanceof sei.SeiError ? 502 : 400
  return reply.code(status).send({ error: e?.message || String(e) })
}

const TIPOS_MAPA = new Set(['oferta', 'documento', 'contrato'])

export async function seiIntegrationRoutes(app: FastifyInstance) {
  app.get('/api/admin/sei/config', guard, async () => {
    const c = await sei.getSeiConfig(true)
    const [pendentes, erros, concluidos] = await Promise.all([
      prisma.seiEnvio.count({ where: { status: { in: ['PENDENTE', 'PROCESSANDO'] } } }),
      prisma.seiEnvio.count({ where: { status: 'ERRO' } }),
      prisma.seiEnvio.count({ where: { status: 'CONCLUIDO' } }),
    ])
    return {
      baseUrl: c.baseUrl,
      authTipo: c.authTipo,
      username: c.username,
      senhaConfigurada: !!c.password, // segredo nunca sai daqui
      tokenConfigurado: !!c.token,
      headerNome: c.headerNome,
      enabled: c.enabled,
      autoEnviar: c.autoEnviar,
      enviarContrato: c.enviarContrato,
      camposExtras: c.camposExtras,
      totais: { pendentes, erros, concluidos },
    }
  })

  app.post('/api/admin/sei/config', guard, async (req, reply) => {
    const b = (req.body ?? {}) as any
    if (b.baseUrl !== undefined) {
      const url = String(b.baseUrl).trim().replace(/\/+$/, '')
      if (url && !/^https?:\/\//i.test(url)) return reply.code(400).send({ error: 'A URL do SEI precisa começar com https://' })
      await salvar(sei.SEI_KEYS.baseUrl, url, 'URL do SEI', 'text')
    }
    if (b.authTipo !== undefined) {
      if (!['nenhum', 'basic', 'bearer', 'header'].includes(b.authTipo)) return reply.code(400).send({ error: 'Tipo de autenticação inválido.' })
      await salvar(sei.SEI_KEYS.authTipo, b.authTipo, 'Autenticação do SEI', 'text')
    }
    if (b.username !== undefined) await salvar(sei.SEI_KEYS.username, String(b.username).trim(), 'Usuário do SEI', 'text')
    if (b.password) await salvar(sei.SEI_KEYS.password, String(b.password), 'Senha do SEI', 'password')
    if (b.token) await salvar(sei.SEI_KEYS.token, String(b.token).trim(), 'Token do SEI', 'password')
    if (b.headerNome !== undefined) await salvar(sei.SEI_KEYS.headerNome, String(b.headerNome).trim() || 'Authorization', 'Header de autenticação', 'text')
    for (const [campo, key, rot] of [
      ['enabled', sei.SEI_KEYS.enabled, 'Integração SEI ativa'],
      ['autoEnviar', sei.SEI_KEYS.autoEnviar, 'Enviar ao SEI ao efetivar a matrícula'],
      ['enviarContrato', sei.SEI_KEYS.enviarContrato, 'Enviar contrato assinado ao SEI'],
      ['camposExtras', sei.SEI_KEYS.camposExtras, 'Enviar campos extras da pessoa'],
    ] as const) {
      if (b[campo] !== undefined) await salvar(key, b[campo] ? 'true' : 'false', rot, 'boolean')
    }
    sei.resetSeiCache()
    return { ok: true }
  })

  // Teste barato e de leitura: lista os cursos ofertados (NE003).
  app.post('/api/admin/sei/testar', guard, async (_req, reply) => {
    try {
      const r = await sei.listarBanners()
      const banners = Array.isArray(r?.banner) ? r.banner : []
      return { ok: true, total: banners.length, amostra: banners.slice(0, 5) }
    } catch (e) {
      return erro(reply, e)
    }
  })

  app.get('/api/admin/sei/catalogo/banners', guard, async (_req, reply) => {
    try {
      const r = await sei.listarBanners()
      return { banners: Array.isArray(r?.banner) ? r.banner : [] }
    } catch (e) {
      return erro(reply, e)
    }
  })

  app.get('/api/admin/sei/catalogo/curso/:codigo', guard, async (req, reply) => {
    try {
      return await sei.consultarCurso((req.params as any).codigo)
    } catch (e) {
      return erro(reply, e)
    }
  })

  // NE009 exige uma pessoa: o de-para usa uma pessoa de teste cadastrada no
  // SEI para enxergar unidades, turnos, turmas, processos e condições.
  app.get('/api/admin/sei/catalogo/opcoes', guard, async (req, reply) => {
    const q = req.query as any
    if (!q.curso || !q.banner || !q.pessoa) return reply.code(400).send({ error: 'Informe curso, banner e o código de uma pessoa de teste no SEI.' })
    try {
      const d: any = await sei.iniciarMatricula(String(q.curso), String(q.banner), String(q.pessoa))
      const lista = (x: any) => (Array.isArray(x) ? x : [])
      return {
        unidades: lista(d?.unidadeEnsinos),
        turnos: lista(d?.turnos),
        turmas: lista(d?.turmas),
        processos: lista(d?.processoMatriculas),
        condicoes: lista(d?.condicaoPagamentos),
        gradeCurricular: d?.curso?.gradeDisciplina?.codigo ?? null,
        periodoLetivo: d?.periodoLetivo ?? null,
      }
    } catch (e) {
      return erro(reply, e)
    }
  })

  app.get('/api/admin/sei/mapeamentos', guard, async () => {
    const [ofertas, docs, mapas] = await Promise.all([
      prisma.courseOffering.findMany({
        where: { active: true },
        orderBy: [{ nome: 'asc' }],
        select: {
          id: true, nome: true, complemento: true, turno: true, status: true,
          course: { select: { nome: true } }, unit: { select: { nome: true } },
          campuses: { select: { campus: { select: { id: true, nome: true } } } },
        },
      }),
      prisma.documentType.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { ordem: 'asc' }], select: { id: true, code: true, name: true } }),
      prisma.seiMapeamento.findMany(),
    ])
    const m = new Map(mapas.map((x) => [`${x.tipo}:${x.localId}`, x.dados]))
    return {
      ofertas: ofertas.map((o) => ({
        id: o.id, nome: o.nome, complemento: o.complemento, turno: o.turno, status: o.status,
        curso: o.course?.nome ?? null, unidade: o.unit?.nome ?? null,
        polos: o.campuses.map((c) => c.campus),
        mapa: m.get(`oferta:${o.id}`) ?? null,
      })),
      documentos: docs.map((d) => ({ ...d, mapa: m.get(`documento:${d.id}`) ?? null })),
      contrato: m.get(`contrato:${CONTRATO_LOCAL_ID}`) ?? null,
    }
  })

  app.put('/api/admin/sei/mapeamentos/:tipo/:localId', guard, async (req, reply) => {
    const { tipo } = req.params as any
    const localId = parseInt((req.params as any).localId)
    if (!TIPOS_MAPA.has(tipo) || Number.isNaN(localId)) return reply.code(400).send({ error: 'De-para inválido.' })
    const dados = (req.body ?? {}) as Record<string, unknown>
    // Só textos curtos (códigos) e os dois dicionários conhecidos.
    const limpo: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(dados)) {
      if (k === 'condicoesPorParcelas' || k === 'polos') {
        if (v && typeof v === 'object') {
          limpo[k] = Object.fromEntries(Object.entries(v as any).map(([a, b]) => [String(a), String(b ?? '').trim()]).filter(([, b]) => b))
        }
      } else if (v != null && String(v).trim() !== '') {
        limpo[k] = String(v).trim().slice(0, 120)
      }
    }
    if (!Object.keys(limpo).length) {
      await prisma.seiMapeamento.deleteMany({ where: { tipo, localId } })
      return { ok: true, removido: true }
    }
    await prisma.seiMapeamento.upsert({
      where: { tipo_localId: { tipo, localId } },
      create: { tipo, localId, dados: limpo as any },
      update: { dados: limpo as any },
    })
    return { ok: true }
  })

  app.get('/api/admin/sei/previa/:registrationId', guard, async (req, reply) => {
    try {
      return await previa(parseInt((req.params as any).registrationId))
    } catch (e) {
      return erro(reply, e)
    }
  })

  app.get('/api/admin/sei/inscricao/:registrationId', guard, async (req) => {
    const registrationId = parseInt((req.params as any).registrationId)
    const envio = await prisma.seiEnvio.findUnique({ where: { registrationId } })
    const cfg = await sei.getSeiConfig()
    return { habilitada: cfg.enabled, envio }
  })

  app.get('/api/admin/sei/envios', guard, async (req) => {
    const q = req.query as any
    const where: any = {}
    if (q.status) where.status = String(q.status)
    const envios = await prisma.seiEnvio.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 })
    const regs = await prisma.enrollmentRegistration.findMany({
      where: { id: { in: envios.map((e) => e.registrationId) } },
      select: { id: true, candidateCode: true, formData: true, lead: { select: { nome: true } } },
    })
    const r = new Map(regs.map((x) => [x.id, x]))
    return {
      envios: envios.map((e) => {
        const reg = r.get(e.registrationId)
        return {
          ...e,
          candidateCode: reg?.candidateCode ?? null,
          nome: (reg?.formData as any)?.nome || reg?.lead?.nome || null,
        }
      }),
    }
  })

  app.get('/api/admin/sei/envios/:id', guard, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const envio = await prisma.seiEnvio.findUnique({ where: { id } })
    if (!envio) return reply.code(404).send({ error: 'Envio não encontrado.' })
    const chamadas = await prisma.seiChamada.findMany({ where: { envioId: id }, orderBy: { id: 'desc' }, take: 100 })
    return { envio, chamadas }
  })

  app.post('/api/admin/sei/envios', guard, async (req, reply) => {
    const registrationId = parseInt((req.body as any)?.registrationId)
    if (!registrationId) return reply.code(400).send({ error: 'Informe a inscrição.' })
    const cfg = await sei.getSeiConfig(true)
    if (!cfg.enabled) return reply.code(400).send({ error: 'Ligue a integração com o SEI antes de enviar.' })
    const envio = await enfileirar(registrationId, 'manual', (req as any).user?.userId ?? null)
    if (envio.status === 'CONCLUIDO') return { envio, jaEnviado: true }
    void processar(envio.id)
    return { envio }
  })

  app.post('/api/admin/sei/envios/:id/reprocessar', guard, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const envio = await prisma.seiEnvio.findUnique({ where: { id } })
    if (!envio) return reply.code(404).send({ error: 'Envio não encontrado.' })
    if (envio.status === 'CONCLUIDO') return reply.code(400).send({ error: 'Este envio já foi concluído.' })
    const atualizado = await prisma.seiEnvio.update({
      where: { id }, data: { status: 'PENDENTE', proximaTentativaEm: new Date(), tentativas: 0, ultimoErro: null },
    })
    void processar(id)
    return { envio: atualizado }
  })

  app.post('/api/admin/sei/envios/:id/cancelar', guard, async (req, reply) => {
    const id = parseInt((req.params as any).id)
    const envio = await prisma.seiEnvio.findUnique({ where: { id } })
    if (!envio) return reply.code(404).send({ error: 'Envio não encontrado.' })
    if (envio.status === 'CONCLUIDO') return reply.code(400).send({ error: 'Envio concluído não se cancela: a matrícula já existe no SEI.' })
    return { envio: await prisma.seiEnvio.update({ where: { id }, data: { status: 'CANCELADO', proximaTentativaEm: null } }) }
  })
}
