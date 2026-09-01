import { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authMiddleware, adminOnly, type JwtPayload } from '../lib/auth.js'
import { buildLeadAccessWhere } from '../lib/teamAccess.js'

/**
 * Fatia uma lista de ids para caber numa prepared statement.
 *
 * O MySQL recusa mais de 65.535 marcadores por consulta, e o quadro monta
 * `leadId: { in: [...] }` com um id por lead exibido. Passou disso, a consulta
 * inteira falha com "Prepared statement contains too many placeholders" e o
 * Kanban devolve 500 — foi o que derrubou o unialfa, que tem 118 mil leads
 * qualificados e nenhum funil marcado como padrão, então o quadro tentava
 * carregar todos de uma vez. Em lotes, cada consulta cabe e o resultado é o
 * mesmo.
 */
function emLotes<T>(itens: T[], tamanho = 2000): T[][] {
  const out: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho))
  return out
}

export async function kanbanRoutes(app: FastifyInstance) {

  // ── GET /api/admin/kanban/funnels-summary ──
  app.get('/api/admin/kanban/funnels-summary', { preHandler: authMiddleware }, async () => {
    const funnels = await prisma.funnel.findMany({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { id: true, key: true, name: true, color: true } },
        _count: { select: { leads: true, stages: true } }
      }
    })

    // Count leads per stage for each funnel
    const result = await Promise.all(funnels.map(async (f) => {
      const stageCounts = await prisma.lead.groupBy({
        by: ['status'],
        where: { funnelId: f.id },
        _count: true
      })
      const stageMap: Record<string, number> = {}
      stageCounts.forEach(sc => { stageMap[sc.status] = sc._count })

      return {
        id: f.id,
        name: f.name,
        description: f.description,
        isDefault: f.isDefault,
        createdAt: f.createdAt,
        stageCount: f._count.stages,
        leadCount: f._count.leads,
        stages: f.stages.map(s => ({ ...s, leadCount: stageMap[s.key] || 0 }))
      }
    }))

    return { funnels: result }
  })

  // ── GET /api/admin/kanban/board ──
  app.get('/api/admin/kanban/board', { preHandler: authMiddleware }, async (req) => {
    const user = (req as any).user as JwtPayload
    const q = req.query as any
    const qFunnelId = q.funnelId

    // Resolve funnel
    let funnelId: number | undefined
    if (qFunnelId) {
      funnelId = Number(qFunnelId)
    } else {
      // Sem funil escolhido, vale o padrão da casa. E se NENHUM funil está
      // marcado como padrão, cai no primeiro ativo — na mesma ordem do seletor
      // da tela, para o quadro abrir onde o operador espera.
      //
      // Sem esse segundo passo o `funnelId` ficava indefinido e o quadro
      // deixava de filtrar por funil: no unialfa isso significava montar os
      // 118 mil leads qualificados numa resposta só, que estourava o limite de
      // parâmetros do MySQL e, depois de loteado, viraria uma resposta que o
      // navegador não abre. Kanban é sempre o quadro de UM funil.
      const def = await prisma.funnel.findFirst({
        where: { isDefault: true, active: true },
        select: { id: true },
      }) ?? await prisma.funnel.findFirst({
        where: { active: true },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: { id: true },
      })
      funnelId = def?.id
    }

    const stageWhere: any = { active: true }
    // Kanban exibe apenas leads qualificados — conversas WhatsApp ad-hoc ficam
    // na aba Conversas até que o operador as promova.
    const leadWhere: any = { qualifiedAt: { not: null } }
    if (funnelId) {
      stageWhere.funnelId = funnelId
      // O quadro de um funil mostra quem está nele — pelo funil principal
      // (`Lead.funnelId`, como sempre) OU por um vínculo adicional ativo. Sem o
      // segundo, colocar o lead "também" num funil não tinha efeito nenhum no
      // Kanban, que é justamente onde o processo é trabalhado.
      leadWhere.OR = [
        { funnelId },
        { leadFunnels: { some: { funnelId, saiuEm: null } } },
      ]
    }

    // Filtros compartilhados com /api/bychat/leads — Kanban respeita os mesmos
    // filtros aplicados pelo operador no SavedFiltersBar (scope='leads').
    if (q.outcome === 'open') leadWhere.outcome = null
    else if (q.outcome === 'won') leadWhere.outcome = 'won'
    else if (q.outcome === 'lost') leadWhere.outcome = 'lost'
    else if (q.outcome === 'classified') leadWhere.outcome = { in: ['won', 'lost'] }

    if (q.aiScoreLabel && ['hot', 'warm', 'cold'].includes(q.aiScoreLabel)) {
      leadWhere.aiScoreLabel = q.aiScoreLabel
    }

    if (q.sources) {
      const arr = String(q.sources).split(',').map((s: string) => s.trim()).filter(Boolean)
      if (arr.length > 0) leadWhere.source = { in: arr }
    } else if (q.source) {
      leadWhere.source = String(q.source)
    }

    if (q.assignedUserIds) {
      const ids = String(q.assignedUserIds).split(',').map((s: string) => parseInt(s.trim())).filter(Number.isInteger)
      if (ids.length > 0) leadWhere.assignedUserId = { in: ids }
    } else if (q.assignedUserId === 'me') {
      leadWhere.assignedUserId = user.userId
    } else if (q.assignedUserId) {
      const id = parseInt(String(q.assignedUserId))
      if (Number.isInteger(id)) leadWhere.assignedUserId = id
    } else if (q.onlyUnassigned === '1') {
      leadWhere.assignedUserId = null
    }

    if (q.tagIds) {
      const ids = String(q.tagIds).split(',').map((s: string) => parseInt(s.trim())).filter(Number.isInteger)
      if (ids.length > 0) leadWhere.tags = { some: { tagId: { in: ids } } }
    }

    if (q.dateFrom || q.dateTo) {
      leadWhere.createdAt = {}
      if (q.dateFrom) leadWhere.createdAt.gte = new Date(q.dateFrom)
      if (q.dateTo) leadWhere.createdAt.lte = new Date(q.dateTo + 'T23:59:59')
    }

    if (q.search) {
      leadWhere.OR = [
        { empresa: { contains: q.search } },
        { nome: { contains: q.search } },
        { whatsapp: { contains: q.search } },
        { email: { contains: q.search } },
      ]
    }

    // Reforma F1: scope efetivo do user no módulo 'leads'.
    const scopeWhere = await buildLeadAccessWhere(user.userId, user.role)
    const andClauses: any[] = []
    if (Object.keys(scopeWhere).length > 0) andClauses.push(scopeWhere)
    // Toggle "Ocultar perdidos": esconde outcome='lost', mantendo abertos (null) e
    // ganhos. Só aplica quando NÃO há filtro outcome explícito (o filtro vence).
    // OR explícito porque { not: 'lost' } no Prisma exclui linhas NULL.
    if (q.hideLost === '1' && !q.outcome) {
      andClauses.push({ OR: [{ outcome: null }, { outcome: { not: 'lost' } }] })
    }
    if (andClauses.length > 0) leadWhere.AND = andClauses

    const [stages, leads, perm, funnels] = await Promise.all([
      prisma.stage.findMany({ where: stageWhere, orderBy: { position: 'asc' } }),
      prisma.lead.findMany({ where: leadWhere, orderBy: { createdAt: 'desc' },
        select: { id: true, empresa: true, nome: true, whatsapp: true, email: true, scores: true, status: true, source: true, metaFormId: true, completed: true, createdAt: true, updatedAt: true, annotation: true, outcome: true, outcomeAt: true,
          // Conversa em curso: é o que decide se o card oferece o atalho para o
          // módulo Conversas. Sem mensagem trocada não há para onde ir — o
          // atalho apareceria e abriria uma tela vazia.
          lastMessageAt: true, unreadMessages: true,
          conversationOpenedAt: true, conversationClosedAt: true, conversationReopenedAt: true,
          // O card exibe os campos personalizados marcados showInKanban.
          customFields: true,
          assignedUserId: true, assignedAt: true, teamId: true,
          assignedUser: { select: { id: true, name: true } },
          // Módulo Resumo: o card mostra o código da situação atual.
          statusSummary: { select: { id: true, code: true, name: true, color: true } },
          tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
          // Só o vínculo DESTE funil: é dele que sai a etapa quando o lead está
          // aqui como adicional (o `status` do Lead é a etapa do principal, que
          // é outro funil e outra régua).
          funnelId: true,
          ...(funnelId ? { leadFunnels: { where: { funnelId, saiuEm: null }, select: { stageKey: true, entrouEm: true } } } : {}),
        }
      }),
      prisma.kanbanPermission.findUnique({ where: { role: user.role as any } }),
      prisma.funnel.findMany({ where: { active: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, isDefault: true } })
    ])

    // Count pending activities per lead
    const leadIds = leads.map(l => l.id)
    const actMap: Record<number, number> = {}
    for (const lote of emLotes(leadIds)) {
      const parcial = await prisma.activity.groupBy({
        by: ['leadId'],
        where: { leadId: { in: lote }, status: { in: ['pending', 'overdue'] } },
        _count: true,
      })
      parcial.forEach(a => { actMap[a.leadId] = a._count })
    }

    // Negociação do card: valor, título e prazo.
    //
    // Qual mostrar quando há várias: a ABERTA de maior valor, preferindo a
    // deste funil (uma negociação pertence a um funil — é dele a meta e a
    // comissão). Sem nenhuma aberta, vale a última fechada, que é o que
    // explica um lead marcado como Ganho.
    const negocMap: Record<number, { titulo: string; valor: number | null; moeda: string; prazo: string | null; aberta: boolean }> = {}
    for (const lote of emLotes(leadIds)) {
      const negocs = await prisma.negotiation.findMany({
        where: { leadId: { in: lote } },
        select: {
          leadId: true, titulo: true, valorFinal: true, moeda: true,
          fechamentoPrevisto: true, resultado: true, funnelId: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      const peso = (n: (typeof negocs)[number]) => {
        const aberta = !n.resultado
        const doFunil = funnelId != null && n.funnelId === funnelId
        return (aberta ? 4 : 0) + (doFunil ? 2 : 0)
      }
      for (const n of negocs) {
        const atual = negocMap[n.leadId]
        const valor = n.valorFinal != null ? Number(n.valorFinal) : null
        const candidato = {
          titulo: n.titulo,
          valor,
          moeda: n.moeda || 'BRL',
          prazo: n.fechamentoPrevisto ? n.fechamentoPrevisto.toISOString() : null,
          aberta: !n.resultado,
          _peso: peso(n),
          _valor: valor ?? 0,
        }
        const anterior = atual ? (atual as any)._peso * 1e12 + ((atual as any)._valor || 0) : -1
        if (candidato._peso * 1e12 + candidato._valor > anterior) negocMap[n.leadId] = candidato as any
      }
    }

    // Lookup Meta form names
    const metaFormIds = [...new Set(leads.map(l => l.metaFormId).filter(Boolean))] as string[]
    const metaFormNames: Record<string, string> = {}
    if (metaFormIds.length > 0) {
      const forms = await prisma.metaForm.findMany({ where: { formId: { in: metaFormIds } }, select: { formId: true, formName: true } })
      forms.forEach(f => { metaFormNames[f.formId] = f.formName })
    }

    // Lead classificado (outcome=won/lost) permanece na etapa que o gestor escolheu —
    // o badge/cor no card sinaliza o estado sem o sistema impor uma coluna fixa.
    const grouped: Record<string, any[]> = {}
    stages.forEach(s => { grouped[s.key] = [] })
    leads.forEach(l => {
      // Lead que está aqui como ADICIONAL tem etapa própria neste funil; o
      // `status` dele é a posição no funil principal e não vale nesta régua.
      const vinculo = (l as any).leadFunnels?.[0] ?? null
      const adicional = !!vinculo && (l as any).funnelId !== funnelId
      const etapaAqui = adicional ? (vinculo.stageKey ?? l.status) : l.status
      // O atalho para Conversas só existe quando houve conversa de verdade, e
      // avisa quando ela está ABERTA (em atendimento ou retorno do contato) —
      // o resto é histórico, que também vale abrir, mas sem chamar atenção.
      const temConversa = !!l.lastMessageAt
      const conversaAberta = (!!l.conversationOpenedAt && !l.conversationClosedAt) || !!l.conversationReopenedAt
      const enriched = {
        ...l,
        _negociacao: negocMap[l.id] ?? null,
        _temConversa: temConversa,
        _conversaAberta: temConversa && conversaAberta,
        _naoLidas: l.unreadMessages ?? 0,
        _activityCount: actMap[l.id] || 0,
        _metaFormName: l.metaFormId ? metaFormNames[l.metaFormId] || null : null,
        // O card precisa dizer que este não é o processo principal da pessoa —
        // sem isso o operador cobra aqui um andamento que está sendo tocado em
        // outro funil.
        _funilAdicional: adicional,
        status: etapaAqui,
      }
      if (grouped[etapaAqui]) grouped[etapaAqui].push(enriched)
    })

    return {
      stages,
      leads: grouped,
      funnels,
      currentFunnelId: funnelId,
      permissions: {
        // SUPERADMIN sempre tudo. Caso a row da role esteja na tabela, vale ela.
        // Senão, default seguro: ADMIN/MANAGER/AGENT podem avançar (operacional);
        // só ADMIN pode retroceder por default. VIEWER nunca move.
        canAdvance: user.role === 'SUPERADMIN'
          ? true
          : (perm?.canAdvance ?? ['ADMIN', 'MANAGER', 'AGENT'].includes(user.role)),
        canRetreat: user.role === 'SUPERADMIN'
          ? true
          : (perm?.canRetreat ?? user.role === 'ADMIN'),
      }
    }
  })

  // ── GET /api/admin/kanban/permissions ──
  app.get('/api/admin/kanban/permissions', { preHandler: adminOnly }, async () => {
    const perms = await prisma.kanbanPermission.findMany()
    return { permissions: perms }
  })

  // ── PUT /api/admin/kanban/permissions ──
  app.put('/api/admin/kanban/permissions', { preHandler: adminOnly }, async (req) => {
    const { permissions } = req.body as any
    for (const p of permissions) {
      await prisma.kanbanPermission.upsert({
        where: { role: p.role },
        update: { canAdvance: p.canAdvance, canRetreat: p.canRetreat },
        create: { role: p.role, canAdvance: p.canAdvance, canRetreat: p.canRetreat }
      })
    }
    return { ok: true }
  })
}
