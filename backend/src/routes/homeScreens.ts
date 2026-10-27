// src/routes/homeScreens.ts
// Tela Inicial — o que cada papel vê ao entrar no sistema.
//
// Uma tela é uma PILHA DE BLOCOS (aviso, KPIs, atalhos, meu dia, placar) que o
// admin monta em Configurações › Tela inicial e atribui a um papel, com exceção
// por usuário quando alguém precisa de algo diferente do cargo.
//
// Regra que atravessa o arquivo: escolher a tela NÃO libera dado. Os blocos são
// podados pela permissão de quem está olhando (atalho de módulo sem acesso some,
// KPI só aparece com canView em 'dashboard') e as métricas vêm com `scoped`,
// que faz o widget-data recortar por own/team/all.

import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, adminStrict, type JwtPayload } from '../lib/auth.js'
import { resolvePermissions } from '../lib/permissions.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'
import * as edu from '../services/educationalMetrics.js'
import { painelComercial, lerConfig, salvarConfig, funisDoPainel, PONTOS_PADRAO, type Visao } from '../services/painelComercial.js'

const ROLES = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const

/**
 * Telas prontas do produto, oferecidas no editor ao lado das montadas em
 * blocos. São painéis inteiros que já existem em outro módulo e que fazem
 * sentido como porta de entrada.
 *
 * `abreDado` avisa o admin, na hora de escolher, que atribuir esta tela mostra
 * os números a quem não tem o módulo — a decisão é dele, mas não pode ser
 * silenciosa.
 */
const TELAS_NATIVAS = [
  {
    key: 'educacional',
    nome: 'Visão Geral Educacional',
    descricao: 'Matrículas, inscrições, receita e conversão do período, com gráficos por dia e por portal.',
    abreDado: 'Quem receber esta tela vê matrículas, receita e conversão mesmo sem permissão no módulo Educacional.',
  },
  {
    key: 'comercial_diretoria',
    nome: 'Comercial · Diretoria',
    descricao: 'KPIs gerais de vendas: leads, atendimento, matrículas, pagamentos, funil etapa a etapa, origens, cursos, perdas e o time inteiro, com filtros por funil, equipe e agente.',
    abreDado: 'Quem receber esta tela vê os números de TODO o comercial, inclusive receita, mesmo sem permissão nos módulos.',
  },
  {
    key: 'comercial_gerente',
    nome: 'Comercial · Gerente',
    descricao: 'A equipe do gerente: agente a agente, fila parada, sem resposta, atrasos, metas e onde cada um perde no funil.',
    abreDado: 'Quem receber esta tela vê os números das equipes de que participa, inclusive receita. Administradores veem todas.',
  },
  {
    key: 'comercial_agente',
    nome: 'Comercial · Agente',
    descricao: 'Os números do próprio agente, a meta, o dia de trabalho e o placar do time com pontos e conquistas (sem valores em R$ dos colegas).',
    abreDado: 'O agente vê o placar de todos os colegas — leads, matrículas, conversão, pontos e % da meta —, mas nenhum valor em R$ deles.',
  },
] as const

const CHAVES_NATIVAS = new Set(TELAS_NATIVAS.map((t) => t.key))
export const BLOCK_TYPES = ['notice', 'kpis', 'shortcuts', 'my_day', 'leaderboard'] as const
type BlockType = (typeof BLOCK_TYPES)[number]

type Block = { id: string; type: BlockType; config: any }

/** Aceita só bloco com tipo conhecido e config objeto — lixo no JSON vira tela quebrada. */
function sanitizeBlocks(input: any): Block[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((b) => b && typeof b === 'object' && (BLOCK_TYPES as readonly string[]).includes(b.type))
    .slice(0, 20)
    .map((b, i) => ({
      id: String(b.id || `b${i}`).substring(0, 40),
      type: b.type as BlockType,
      config: b.config && typeof b.config === 'object' ? b.config : {},
    }))
}

/**
 * Poda os blocos pelo que ESTE usuário pode ver. O atalho carrega o moduleId
 * escolhido no editor; sem canView, o cartão some em vez de virar um 403 na
 * cara de quem clicou. Bloco que fica sem conteúdo nenhum é descartado.
 */
async function pruneForUser(blocks: Block[], user: JwtPayload): Promise<Block[]> {
  const perms = user.role === 'SUPERADMIN' ? null : await resolvePermissions(user.userId, user.role)
  const canView = (moduleId?: string) => {
    if (!moduleId) return true
    if (!perms) return true // SUPERADMIN
    return perms[moduleId]?.canView === true
  }
  // O bloco de KPIs busca dados em POST /api/admin/widget-data, e o gate de
  // permissões deriva a ação do método HTTP → POST vira 'create'. Ou seja: quem
  // tem "ver" no Dashboard mas não "criar" (VIEWER, por padrão) leva 403 em cada
  // card. Melhor não entregar o bloco do que entregar uma fileira de "Sem
  // permissão" na cara de quem abriu o sistema.
  const canLoadKpis = () => !perms || (perms['dashboard']?.canView === true && perms['dashboard']?.canCreate === true)

  const out: Block[] = []
  for (const b of blocks) {
    if (b.type === 'shortcuts') {
      const items = (Array.isArray(b.config?.items) ? b.config.items : []).filter((i: any) => canView(i?.moduleId))
      if (items.length === 0) continue
      out.push({ ...b, config: { ...b.config, items } })
      continue
    }
    if (b.type === 'notice') {
      const links = (Array.isArray(b.config?.links) ? b.config.links : []).filter((l: any) => canView(l?.moduleId))
      out.push({ ...b, config: { ...b.config, links } })
      continue
    }
    if (b.type === 'kpis' && !canLoadKpis()) continue
    // "Meu dia" lista atividades e compromissos: sem Atividades nem Agenda,
    // o bloco abria vazio (ou com dado que a pessoa não pode abrir).
    if (b.type === 'my_day' && !canView('activities') && !canView('scheduling')) continue
    out.push(b)
  }
  return out
}

/**
 * Tela deste usuário. Precedência: exceção do usuário → regra do papel → nada
 * (o frontend cai na Visão Geral de fábrica, que é o comportamento de sempre).
 *
 * Extraído porque a rota de dados da tela nativa precisa da MESMA resposta para
 * decidir se entrega os números: se as duas resolvessem por conta própria, uma
 * mudança de precedência abriria dado para quem já não vê mais a tela.
 */
async function atribuicaoDoUsuario(user: JwtPayload) {
  return (
    (await prisma.homeScreenAssignment.findFirst({
      where: { userId: user.userId, screen: { active: true } },
      include: { screen: true },
    })) ||
    (await prisma.homeScreenAssignment.findFirst({
      where: { role: user.role as any, screen: { active: true } },
      include: { screen: true },
    }))
  )
}

export async function homeScreensRoutes(app: FastifyInstance) {
  // ── Resolução da tela do usuário logado ───────────────────────────────
  app.get('/api/home-screen/me', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const assignment = await atribuicaoDoUsuario(user)

    if (!assignment?.screen) return { screen: null }

    // Tela nativa não tem blocos: o frontend renderiza um painel pronto e os
    // dados vêm por rota própria, já com a checagem de atribuição.
    if (assignment.screen.builtin) {
      return {
        screen: {
          id: assignment.screen.id,
          name: assignment.screen.name,
          description: assignment.screen.description,
          builtin: assignment.screen.builtin,
          blocks: [],
        },
        pruned: 0,
        source: assignment.userId ? 'user' : 'role',
      }
    }
    const originais = sanitizeBlocks(assignment.screen.blocks)
    const blocks = await pruneForUser(originais, user)
    return {
      screen: {
        id: assignment.screen.id,
        name: assignment.screen.name,
        description: assignment.screen.description,
        blocks,
      },
      // Quantos blocos a permissão removeu. Com a tela inteira podada, o
      // frontend precisa dizer "seu acesso não alcança nada aqui" em vez de
      // "tela sem blocos" — o admin configurou algo, só não para este papel.
      pruned: originais.length - blocks.length,
      // De onde veio a tela — o admin consegue explicar "por que estou vendo isto".
      source: assignment.userId ? 'user' : 'role',
    }
  })

  // ── Dados da tela nativa "Visão Geral Educacional" ────────────────────
  //
  // Mora aqui, e não em /api/admin/educacional, de propósito: o prefixo
  // /api/home-screen/ é liberado do gate de módulo porque é a porta de entrada
  // do sistema, e a decisão do produto é que quem RECEBE esta tela vê os
  // indicadores mesmo sem permissão no módulo Educacional.
  //
  // Aberto não é o mesmo que solto: só responde a quem realmente tem a tela
  // nativa atribuída (pelo papel ou por exceção de usuário). Sem isso, a rota
  // viraria um atalho para qualquer autenticado ler receita e volume de
  // matrículas — que é justamente o dado que o módulo protege.
  app.get('/api/home-screen/educacional', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as { dateFrom?: string; dateTo?: string; groupBy?: any }

    const minha = await atribuicaoDoUsuario(user)
    if (minha?.screen?.builtin !== 'educacional') {
      return reply.code(403).send({ error: 'Esta tela não está atribuída a você.' })
    }

    // Acesso por portal: quem não vê todos os portais recebe os números SÓ dos
    // portais que enxerga (antes levava 403 "só para quem vê todos" e a tela
    // inteira virava erro). O panorama de processos seletivos não tem portal,
    // então não vai para quem é recortado.
    const { alcanceDePortais, whereInscricoes } = await import('../lib/portalAccess.js')
    const recorteInscricoes = whereInscricoes(await alcanceDePortais(user.userId, user.role))
    const cfg = { dateFrom: q.dateFrom, dateTo: q.dateTo, groupBy: q.groupBy, recorteInscricoes }
    const [panorama, inscricoes, pagas, receita, conversao, porDia, porPortal] = await Promise.all([
      recorteInscricoes ? Promise.resolve(null) : edu.panoramaAcademico(),
      edu.inscricoesTotal(cfg),
      edu.inscricoesPagas(cfg),
      edu.receitaDoPeriodo(cfg),
      edu.taxaDeConversao(cfg),
      edu.inscricoesPorDia(cfg),
      edu.inscricoesPorPortal(cfg),
    ])

    return {
      panorama,
      recortadoPorPortal: !!recorteInscricoes,
      kpis: { inscricoes, pagas, receita, conversao },
      graficos: { porDia: porDia.data, porPortal: porPortal.data },
    }
  })

  // ── Dados das telas nativas do comercial ─────────────────────────────
  //
  // Mesma regra da Visão Geral Educacional: só responde a quem tem a tela
  // atribuída. A visão vem da TELA, não do pedido — um agente não troca para
  // "diretoria" mudando a URL. Administrador pode pedir qualquer visão (é o
  // que o editor usa na pré-visualização).
  app.get('/api/home-screen/comercial', { preHandler: authMiddleware }, async (req, reply) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as Record<string, string | undefined>
    const admin = user.role === 'SUPERADMIN' || user.role === 'ADMIN'
    const minha = await atribuicaoDoUsuario(user)
    const daTela = minha?.screen?.builtin?.startsWith('comercial_') ? (minha.screen.builtin.slice('comercial_'.length) as Visao) : null
    const pedida = (['diretoria', 'gerente', 'agente'] as const).find((v) => v === q.visao) ?? null
    const visao = admin ? pedida ?? daTela ?? 'diretoria' : daTela
    if (!visao) return reply.code(403).send({ error: 'Esta tela não está atribuída a você.' })

    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const ehData = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const dateTo = ehData(q.dateTo) ? q.dateTo! : hoje
    const dateFrom = ehData(q.dateFrom) ? q.dateFrom! : `${hoje.slice(0, 8)}01`
    const id = (v?: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
    return painelComercial(visao, { userId: user.userId, role: user.role }, {
      dateFrom, dateTo,
      funis: (q.funis || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0),
      teamId: id(q.teamId), userId: id(q.userId), origem: q.origem ? String(q.origem).slice(0, 60) : null,
    })
  })

  app.get('/api/admin/painel-comercial/config', { preHandler: adminStrict }, async () => {
    const config = await lerConfig()
    const { funis } = await funisDoPainel(config)
    return { config, funis, pontosPadrao: PONTOS_PADRAO }
  })

  app.put('/api/admin/painel-comercial/config', { preHandler: adminStrict }, async (req) => {
    const b = (req.body ?? {}) as any
    const atual = await lerConfig()
    const porFunil = (o: any) => {
      const out: Record<string, string[]> = {}
      if (o && typeof o === 'object') for (const [f, ks] of Object.entries(o)) if (Array.isArray(ks)) out[String(Number(f))] = (ks as unknown[]).map(String).slice(0, 10)
      return out
    }
    const pontos = { ...atual.pontos }
    for (const k of Object.keys(PONTOS_PADRAO) as (keyof typeof PONTOS_PADRAO)[]) {
      const n = Number(b.pontos?.[k]); if (Number.isFinite(n) && n >= 0 && n <= 1000) pontos[k] = n
    }
    const funis = Array.isArray(b.funis) ? b.funis.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null
    await salvarConfig({ funis: funis && funis.length ? funis : null, etapasMatricula: porFunil(b.etapasMatricula), etapasPerda: porFunil(b.etapasPerda), pontos })
    return { ok: true }
  })

  // ── Dados do bloco "Meu dia" ──────────────────────────────────────────
  // Sempre do próprio usuário: é a fila de trabalho dele, não um relatório.
  app.get('/api/home-screen/my-day', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as { staleHours?: string }
    const staleHours = Math.min(Math.max(Number(q.staleHours) || 24, 1), 720)

    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999)

    const [todayActivities, overdue, staleLeads] = await Promise.all([
      prisma.activity.findMany({
        where: { userId: user.userId, status: 'pending', scheduledAt: { gte: dayStart, lte: dayEnd } },
        select: { id: true, type: true, title: true, scheduledAt: true, leadId: true, lead: { select: { nome: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 20,
      }),
      prisma.activity.count({
        where: { userId: user.userId, status: 'pending', scheduledAt: { lt: dayStart } },
      }),
      prisma.lead.count({
        where: {
          assignedUserId: user.userId,
          outcome: null,
          // Conversa que não é lead (contato) não é fila de venda.
          qualifiedAt: { not: null },
          isGroup: false,
          OR: [
            { lastMessageAt: { lt: new Date(now.getTime() - staleHours * 3600_000) } },
            { lastMessageAt: null },
          ],
        },
      }),
    ])

    const meetings = todayActivities.filter((a) => a.type === 'meeting')
    return {
      activities: todayActivities.map((a) => ({
        id: a.id, type: a.type, title: a.title, scheduledAt: a.scheduledAt,
        leadId: a.leadId, leadName: a.lead?.nome || null,
      })),
      counts: { today: todayActivities.length, meetings: meetings.length, overdue, staleLeads },
      staleHours,
    }
  })

  // ── Dados do bloco "Placar" ───────────────────────────────────────────
  // Ranking de negócios ganhos no período. O recorte respeita o scope de quem
  // olha: agente com scope 'own' vê só a própria linha, e é assim mesmo — o
  // placar não é atalho para ver a carteira dos colegas.
  app.get('/api/home-screen/leaderboard', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as { days?: string; limit?: string }
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365)
    const limit = Math.min(Math.max(Number(q.limit) || 5, 1), 20)
    const since = new Date(Date.now() - days * 86400_000)

    const access = await buildLeadAccessWhere(user.userId, user.role)
    // Só lead conta no placar: contato (sem qualifiedAt) e grupo ficam de fora.
    // A venda é de quem a fez (Lead.vendedorUserId, gravado no Ganho): o aluno
    // passar para Secretaria/Financeiro não tira a linha de quem vendeu — nem
    // tira a venda do recorte dela.
    const where: any = { outcome: 'won', outcomeAt: { gte: since }, qualifiedAt: { not: null }, isGroup: false, vendedorUserId: { not: null } }
    if (Object.keys(access).length > 0) where.AND = [{ OR: [access, { vendedorUserId: user.userId }] }]

    const rows = await prisma.lead.groupBy({
      by: ['vendedorUserId'],
      where,
      _count: { _all: true },
      _sum: { saleValue: true },
    })
    const userIds = rows.map((r) => r.vendedorUserId).filter((v): v is number => v != null)
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const nameById = new Map(users.map((u) => [u.id, u.name]))

    const entries = rows
      .filter((r) => r.vendedorUserId != null)
      .map((r) => ({
        userId: r.vendedorUserId as number,
        name: nameById.get(r.vendedorUserId as number) || 'Sem nome',
        won: r._count._all,
        revenue: Number(r._sum.saleValue || 0),
        isMe: r.vendedorUserId === user.userId,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.won - a.won)

    return { days, entries: entries.slice(0, limit), total: entries.length }
  })

  // ── Administração das telas ───────────────────────────────────────────
  app.get('/api/admin/home-screens', { preHandler: adminOnly }, async () => {
    const [screens, assignments, users] = await Promise.all([
      prisma.homeScreen.findMany({ orderBy: { id: 'asc' } }),
      prisma.homeScreenAssignment.findMany(),
      prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: 'asc' } }),
    ])
    return { screens, assignments, users, roles: ROLES, nativas: TELAS_NATIVAS }
  })

  app.post('/api/admin/home-screens', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { name?: string; description?: string; blocks?: any; builtin?: string | null }
    const name = String(body.name || '').trim()
    if (!name) return reply.code(400).send({ error: 'Nome é obrigatório' })

    const builtin = body.builtin ? String(body.builtin) : null
    if (builtin && !CHAVES_NATIVAS.has(builtin as any)) {
      return reply.code(400).send({ error: 'Tela nativa desconhecida' })
    }

    const screen = await prisma.homeScreen.create({
      data: {
        name: name.substring(0, 120),
        description: body.description ? String(body.description).substring(0, 255) : null,
        // Tela nativa não guarda blocos: o conteúdo é o painel pronto. Gravar os
        // dois deixaria um resto invisível esperando para reaparecer no dia em
        // que alguém tirasse o `builtin`.
        blocks: (builtin ? [] : sanitizeBlocks(body.blocks)) as any,
        builtin,
      },
    })
    return { screen }
  })

  app.put('/api/admin/home-screens/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const body = req.body as { name?: string; description?: string; blocks?: any; active?: boolean; builtin?: string | null }
    const existing = await prisma.homeScreen.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Tela não encontrada' })
    const data: any = {}
    if (body.name !== undefined) data.name = String(body.name).trim().substring(0, 120) || existing.name
    if (body.description !== undefined) data.description = body.description ? String(body.description).substring(0, 255) : null
    if (body.builtin !== undefined) {
      const b = body.builtin ? String(body.builtin) : null
      if (b && !CHAVES_NATIVAS.has(b as any)) return reply.code(400).send({ error: 'Tela nativa desconhecida' })
      data.builtin = b
      if (b) data.blocks = [] as any
    }
    const virouNativa = data.builtin != null
    if (body.blocks !== undefined && !virouNativa) data.blocks = sanitizeBlocks(body.blocks) as any
    if (body.active !== undefined) data.active = !!body.active
    const screen = await prisma.homeScreen.update({ where: { id }, data })
    return { screen }
  })

  app.delete('/api/admin/home-screens/:id', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const existing = await prisma.homeScreen.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'Tela não encontrada' })
    if (existing.isSystem) return reply.code(400).send({ error: 'Tela de fábrica não pode ser removida' })
    // As atribuições caem junto (onDelete: Cascade) e quem apontava para ela
    // volta à Visão Geral — nunca fica com tela em branco.
    await prisma.homeScreen.delete({ where: { id } })
    return { ok: true }
  })

  // ── Atribuições ───────────────────────────────────────────────────────
  // Body: { roles: { AGENT: 3, MANAGER: null, ... }, users: [{ userId, screenId|null }] }
  // screenId null = remove a atribuição (volta para a regra do papel / Visão Geral).
  app.put('/api/admin/home-screens/assignments', { preHandler: adminOnly }, async (req, reply) => {
    const body = req.body as { roles?: Record<string, number | null>; users?: { userId: number; screenId: number | null }[] }

    const screenIds = new Set<number>()
    for (const v of Object.values(body.roles || {})) if (v) screenIds.add(Number(v))
    for (const u of body.users || []) if (u.screenId) screenIds.add(Number(u.screenId))
    if (screenIds.size > 0) {
      const found = await prisma.homeScreen.count({ where: { id: { in: [...screenIds] } } })
      if (found !== screenIds.size) return reply.code(400).send({ error: 'Tela inexistente na atribuição' })
    }

    for (const [role, screenId] of Object.entries(body.roles || {})) {
      if (!(ROLES as readonly string[]).includes(role)) continue
      if (screenId) {
        await prisma.homeScreenAssignment.upsert({
          where: { role: role as any },
          create: { role: role as any, screenId: Number(screenId) },
          update: { screenId: Number(screenId) },
        })
      } else {
        await prisma.homeScreenAssignment.deleteMany({ where: { role: role as any } })
      }
    }

    for (const u of body.users || []) {
      const userId = Number(u.userId)
      if (!userId) continue
      if (u.screenId) {
        await prisma.homeScreenAssignment.upsert({
          where: { userId },
          create: { userId, screenId: Number(u.screenId) },
          update: { screenId: Number(u.screenId) },
        })
      } else {
        await prisma.homeScreenAssignment.deleteMany({ where: { userId } })
      }
    }

    const assignments = await prisma.homeScreenAssignment.findMany()
    return { assignments }
  })

  // Pré-visualização: mostra a tela como um papel específico a veria, sem
  // precisar sair e entrar com outro usuário.
  app.get('/api/admin/home-screens/:id/preview', { preHandler: adminOnly }, async (req, reply) => {
    const id = Number((req.params as any).id)
    const role = String((req.query as any).role || 'AGENT')
    const screen = await prisma.homeScreen.findUnique({ where: { id } })
    if (!screen) return reply.code(404).send({ error: 'Tela não encontrada' })
    const me = (req as any).user as JwtPayload
    const blocks = await pruneForUser(sanitizeBlocks(screen.blocks), { ...me, role })
    return { screen: { id: screen.id, name: screen.name, blocks }, role }
  })
}
