// Filtros avançados da lista de Leads (barra de filtros nova).
//
// Tudo aqui entra no `AND` da consulta, nunca em chave solta do `where`: os
// filtros antigos (status, source, assignedUserId, tags…) continuam valendo e um
// filtro novo não pode sobrescrever outro. Valor "0" ou "__none" numa lista quer
// dizer "sem" (sem equipe, sem resumo, sem origem…), para o time conseguir achar
// o que ficou sem preencher.
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { isModuleEnabled } from '../lib/moduleManager.js'

const SEM = new Set(['0', '__none'])

function lista(v: unknown): string[] {
  if (v == null || v === '') return []
  return String(v).split(',').map((s) => s.trim()).filter(Boolean)
}

function inteiros(v: unknown): { ids: number[]; sem: boolean } {
  const itens = lista(v)
  return {
    ids: itens.filter((s) => !SEM.has(s)).map((s) => parseInt(s, 10)).filter(Number.isInteger),
    sem: itens.some((s) => SEM.has(s)),
  }
}

function textos(v: unknown): { vals: string[]; sem: boolean } {
  const itens = lista(v)
  return { vals: itens.filter((s) => !SEM.has(s)), sem: itens.some((s) => SEM.has(s)) }
}

/** Campo IN (lista) OU nulo quando a lista inclui "sem". */
function inOuNulo(campo: string, vals: unknown[], sem: boolean, texto = true): any | null {
  const ou: any[] = []
  if (vals.length) ou.push({ [campo]: { in: vals } })
  if (sem) {
    ou.push({ [campo]: null })
    // Texto vazio também é "sem" (cidade/segmento gravados como '').
    if (texto) ou.push({ [campo]: '' })
  }
  if (!ou.length) return null
  return ou.length === 1 ? ou[0] : { OR: ou }
}

// Sem hora, `new Date('AAAA-MM-DD')` é meia-noite UTC = 21h do dia anterior aqui.
function inicioDoDia(s: string): Date { return new Date(s.length === 10 ? s + 'T00:00:00' : s) }
function fimDoDia(s: string): Date { return new Date(s.length === 10 ? s + 'T23:59:59' : s) }

function faixa(campo: string, de: unknown, ate: unknown): any | null {
  if (!de && !ate) return null
  const f: any = {}
  if (de) f.gte = inicioDoDia(String(de))
  if (ate) f.lte = fimDoDia(String(ate))
  return { [campo]: f }
}

const ATIVIDADE_ABERTA = ['pending', 'overdue']

export async function aplicarFiltrosAvancados(q: any, whereAnd: any[]): Promise<void> {
  const push = (c: any | null) => { if (c) whereAnd.push(c) }

  // ── Funil e etapa (várias) ──
  const funis = inteiros(q.funnelIds)
  push(inOuNulo('funnelId', funis.ids, funis.sem, false))
  const etapas = textos(q.statuses)
  if (etapas.vals.length) {
    // Etapa vem como "funnelId::key" quando escolhida numa lista de vários
    // funis (a mesma chave existe em funis diferentes) ou só "key".
    const ou: any[] = []
    for (const e of etapas.vals) {
      const [f, k] = e.includes('::') ? e.split('::') : [null, e]
      const fid = f ? parseInt(f, 10) : NaN
      ou.push(Number.isInteger(fid) ? { funnelId: fid, status: k } : { status: k })
    }
    push(ou.length === 1 ? ou[0] : { OR: ou })
  }

  // ── Pessoas ──
  const equipes = inteiros(q.teamIds)
  push(inOuNulo('teamId', equipes.ids, equipes.sem, false))

  // ── Etiquetas: todas / sem nenhuma / excluir ──
  if (q.tagMode === 'all' && q.tagIds) {
    for (const id of inteiros(q.tagIds).ids) push({ tags: { some: { tagId: id } } })
  }
  if (q.noTags === '1') push({ tags: { none: {} } })
  const fora = inteiros(q.excludeTagIds).ids
  if (fora.length) push({ tags: { none: { tagId: { in: fora } } } })

  // ── Origem e campanha ──
  const tipos = textos(q.originTypes)
  push(inOuNulo('originType', tipos.vals, tipos.sem))
  const camps = textos(q.campaigns)
  if (camps.vals.length) {
    push({ OR: [
      { campaignName: { in: camps.vals } },
      { googleCampaignName: { in: camps.vals } },
      { utmCampaign: { in: camps.vals } },
    ] })
  }
  const anuncios = textos(q.adNames)
  if (anuncios.vals.length) push({ adName: { in: anuncios.vals } })
  const us = textos(q.utmSources)
  push(inOuNulo('utmSource', us.vals, us.sem))
  const um = textos(q.utmMediums)
  push(inOuNulo('utmMedium', um.vals, um.sem))
  if (q.hasClickId === '1') {
    push({ OR: [
      { gclid: { not: null } }, { gbraid: { not: null } }, { wbraid: { not: null } },
      { fbclid: { not: null } }, { ctwaClid: { not: null } },
    ] })
  }

  // ── Canal (número de WhatsApp que recebeu o lead) ──
  const canais = lista(q.channels)
  if (canais.length) {
    const ou: any[] = []
    for (const c of canais) {
      if (c.startsWith('evo:')) ou.push({ instanceName: c.slice(4) })
      else if (c.startsWith('cloud:')) {
        const id = parseInt(c.slice(6), 10)
        if (Number.isInteger(id)) ou.push({ cloudApiConnectionId: id })
      } else if (SEM.has(c)) ou.push({ instanceName: null, cloudApiConnectionId: null })
    }
    if (ou.length) push({ OR: ou })
  }

  // ── Perfil ──
  const cidades = textos(q.cidades)
  push(inOuNulo('cidade', cidades.vals, cidades.sem))
  const segs = textos(q.segmentos)
  push(inOuNulo('segmento', segs.vals, segs.sem))
  if (q.hasEmail === 'yes') push({ email: { contains: '@' } })
  if (q.hasEmail === 'no') push({ NOT: { email: { contains: '@' } } })
  if (q.hasWhatsapp === 'yes') push({ NOT: { whatsapp: '' } })
  if (q.hasWhatsapp === 'no') push({ whatsapp: '' })

  // ── Qualidade ──
  const scores = textos(q.aiScoreLabels)
  push(inOuNulo('aiScoreLabel', scores.vals.filter((s) => ['hot', 'warm', 'cold'].includes(s)), scores.sem))
  const resumos = inteiros(q.statusSummaryIds)
  push(inOuNulo('statusSummaryId', resumos.ids, resumos.sem, false))
  if (q.duplicate === '1') push({ duplicateStatus: 'pending_review' })
  if (q.saleDetected === '1') push({ saleDetected: true })

  // ── Atendimento ──
  if (q.awaitingReply === '1') push({ unreadMessages: { gt: 0 } })
  if (q.neverAnswered === '1') push({ firstResponseAt: null })
  const parado = parseInt(String(q.idleDays ?? ''), 10)
  if (Number.isInteger(parado) && parado > 0) {
    const corte = new Date(Date.now() - parado * 86_400_000)
    push({ OR: [
      { lastMessageAt: { lt: corte } },
      { lastMessageAt: null, createdAt: { lt: corte } },
    ] })
  }
  const agora = new Date()
  if (q.activity === 'overdue') {
    push({ activities: { some: { status: { in: ATIVIDADE_ABERTA }, scheduledAt: { lt: agora } } } })
  } else if (q.activity === 'today') {
    const ini = new Date(agora); ini.setHours(0, 0, 0, 0)
    const fim = new Date(agora); fim.setHours(23, 59, 59, 999)
    push({ activities: { some: { status: { in: ATIVIDADE_ABERTA }, scheduledAt: { gte: ini, lte: fim } } } })
  } else if (q.activity === 'upcoming') {
    push({ activities: { some: { status: { in: ATIVIDADE_ABERTA }, scheduledAt: { gte: agora } } } })
  } else if (q.activity === 'none') {
    push({ activities: { none: { status: { in: ATIVIDADE_ABERTA } } } })
  }

  // ── Educacional ──
  if (q.registration === 'yes') push({ enrollmentRegistrations: { some: { NOT: { status: 'merged' } } } })
  if (q.registration === 'no') push({ enrollmentRegistrations: { none: { NOT: { status: 'merged' } } } })

  // ── Educacional ──
  // Tudo que é da inscrição vale para a MESMA inscrição: "portal X + pagamento
  // vencido" é quem tem uma inscrição do portal X com o pagamento vencido, não
  // quem tem uma no portal X e outra vencida em outro portal.
  const reg: any = { NOT: { status: 'merged' } }
  const regE: any[] = []
  const portais = inteiros(q.eduPortalIds).ids
  if (portais.length) regE.push({ portalId: { in: portais } })
  const situacoes = textos(q.eduStatuses).vals
  if (situacoes.length) regE.push({ status: { in: situacoes } })
  const pags = textos(q.eduPayments)
  const pag = inOuNulo('paymentStatus', pags.vals, pags.sem)
  if (pag) regE.push(pag)
  const cursos = inteiros(q.eduCourseIds).ids
  if (cursos.length) regE.push({ processRegistration: { is: { offering: { courseId: { in: cursos } } } } })
  const processos = inteiros(q.eduProcessIds).ids
  if (processos.length) regE.push({ processRegistration: { is: { selectionProcessId: { in: processos } } } })
  if (q.eduContract === 'yes') regE.push({ contratoAceite: { not: Prisma.DbNull } })
  if (q.eduContract === 'no') regE.push({ contratoAceite: { equals: Prisma.DbNull } })
  if (regE.length) push({ enrollmentRegistrations: { some: { ...reg, AND: regE } } })
  const vinc = textos(q.eduSituacoes).vals
  if (vinc.length) push({ aluno: { is: { vinculos: { some: { situacao: { in: vinc } } } } } })
  if (q.eduEnrolled === 'yes') push({ aluno: { is: { vinculos: { some: {} } } } })
  if (q.eduEnrolled === 'no') push({ OR: [{ aluno: { is: null } }, { aluno: { is: { vinculos: { none: {} } } } }] })

  // ── Campos personalizados ──
  // ?cf={"turno":["Noturno"],"cpf":["__any"]}: valores de cada campo (OU dentro
  // do campo, E entre campos). "__any" = preenchido, "__none" = vazio.
  if (q.cf) await filtrarCamposPersonalizados(String(q.cf), push)

  // ── Datas ──
  push(faixa('createdAt', q.createdFrom, q.createdTo))
  push(faixa('lastMessageAt', q.lastMessageFrom, q.lastMessageTo))
  push(faixa('outcomeAt', q.outcomeFrom, q.outcomeTo))
  push(faixa('assignedAt', q.assignedFrom, q.assignedTo))
}

const CHAVE_SEGURA = /^[A-Za-z0-9_-]{1,100}$/

async function filtrarCamposPersonalizados(bruto: string, push: (c: any) => void): Promise<void> {
  let pedido: Record<string, unknown>
  try { pedido = JSON.parse(bruto) } catch { return }
  if (!pedido || typeof pedido !== 'object') return
  const chaves = Object.keys(pedido).filter((k) => CHAVE_SEGURA.test(k))
  if (!chaves.length) return
  const campos = await prisma.customField.findMany({ where: { key: { in: chaves } }, select: { key: true, type: true } })
  const tipo = new Map(campos.map((c) => [c.key, c.type]))
  for (const k of chaves) {
    if (!tipo.has(k)) continue
    const vals = (Array.isArray(pedido[k]) ? (pedido[k] as unknown[]) : []).map(String).filter(Boolean).slice(0, 200)
    if (!vals.length) continue
    const path = `$."${k}"`
    const vazio = [{ customFields: { path, equals: Prisma.AnyNull } }, { customFields: { path, equals: '' } }]
    const ou: any[] = []
    for (const v of vals) {
      if (v === '__none') ou.push(...vazio)
      else if (v === '__any') ou.push({ NOT: { OR: vazio } })
      else {
        ou.push({ customFields: { path, equals: v } })
        if (tipo.get(k) === 'multiselect') ou.push({ customFields: { path, array_contains: [v] } })
        if (v === 'true' || v === 'false') ou.push({ customFields: { path, equals: v === 'true' } })
        else if (/^-?\d+(\.\d+)?$/.test(v)) ou.push({ customFields: { path, equals: Number(v) } })
      }
    }
    push(ou.length === 1 ? ou[0] : { OR: ou })
  }
}

// ── Opções da barra de filtros ──
// Contagens sobre o universo padrão da lista (leads qualificados que o usuário
// pode ver), para o time saber quantos há em cada opção antes de clicar.
type Contagem = { value: string; label: string; count: number; group?: string; color?: string | null }

function ordenar(itens: Contagem[]): Contagem[] {
  return itens.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

export async function opcoesDosFiltros(base: any, contarCampos = false): Promise<Record<string, any>> {
  const g = (by: any[], extra: any = {}) =>
    (prisma.lead.groupBy as any)({ by, where: { AND: [base, extra] }, _count: { _all: true } }) as Promise<any[]>

  const [
    porResp, porEquipe, porEtapa, porOrigem, porTipo, porCampMeta, porCampGoogle, porCampUtm,
    porAnuncio, porUtmS, porUtmM, porCidade, porSeg, porResumo, porMotivo, porScore, porEvo, porCloud,
    porTag,
  ] = await Promise.all([
    g(['assignedUserId']), g(['teamId']), g(['funnelId', 'status']), g(['source']), g(['originType']),
    g(['campaignName'], { campaignName: { not: null } }),
    g(['googleCampaignName'], { googleCampaignName: { not: null } }),
    g(['utmCampaign'], { utmCampaign: { not: null } }),
    g(['adName'], { adName: { not: null } }),
    g(['utmSource']), g(['utmMedium']), g(['cidade']), g(['segmento']), g(['statusSummaryId']),
    g(['lostReasonId'], { outcome: 'lost' }), g(['aiScoreLabel']),
    g(['instanceName'], { instanceName: { not: null } }),
    g(['cloudApiConnectionId'], { cloudApiConnectionId: { not: null } }),
    (prisma.leadTag.groupBy as any)({ by: ['tagId'], where: { lead: base }, _count: { _all: true } }) as Promise<any[]>,
  ])

  const ids = (rows: any[], k: string) => rows.map((r) => r[k]).filter((v) => v != null) as number[]
  const [users, teams, funnels, stages, resumos, motivos, instancias, clouds, tags] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids(porResp, 'assignedUserId') } }, select: { id: true, name: true, email: true } }),
    prisma.team.findMany({ where: { id: { in: ids(porEquipe, 'teamId') } }, select: { id: true, name: true, color: true } }),
    prisma.funnel.findMany({ where: { id: { in: ids(porEtapa, 'funnelId') } }, select: { id: true, name: true } }),
    prisma.stage.findMany({ where: { funnelId: { in: ids(porEtapa, 'funnelId') } }, select: { funnelId: true, key: true, name: true, position: true, color: true } }),
    prisma.statusSummary.findMany({ where: { id: { in: ids(porResumo, 'statusSummaryId') } }, select: { id: true, code: true, name: true, color: true } }),
    prisma.lossReason.findMany({ where: { id: { in: ids(porMotivo, 'lostReasonId') } }, select: { id: true, name: true, color: true } }),
    prisma.whatsAppInstance.findMany({ select: { instanceName: true, name: true, phone: true } }),
    prisma.cloudApiConnection.findMany({ select: { id: true, displayPhone: true, displayName: true } }),
    prisma.tag.findMany({ where: { id: { in: ids(porTag, 'tagId') } }, select: { id: true, name: true, color: true } }),
  ])

  const nomeUser = new Map(users.map((u) => [u.id, u.name || u.email]))
  const equipe = new Map(teams.map((t) => [t.id, t]))
  const funil = new Map(funnels.map((f) => [f.id, f.name]))
  const etapa = new Map(stages.map((s) => [`${s.funnelId}::${s.key}`, s]))
  const resumo = new Map(resumos.map((r) => [r.id, r]))
  const motivo = new Map(motivos.map((m) => [m.id, m]))
  const inst = new Map(instancias.map((i) => [i.instanceName, i]))
  const cloud = new Map(clouds.map((c) => [c.id, c]))
  const tag = new Map(tags.map((t) => [t.id, t]))

  const simples = (rows: any[], k: string, semRotulo: string): Contagem[] => {
    const acc = new Map<string, Contagem>()
    for (const r of rows) {
      const bruto = r[k] == null ? '' : String(r[k]).trim()
      const value = bruto === '' ? '__none' : bruto
      const atual = acc.get(value.toLowerCase())
      if (atual) atual.count += r._count._all
      else acc.set(value.toLowerCase(), { value, label: bruto === '' ? semRotulo : bruto, count: r._count._all })
    }
    return ordenar([...acc.values()])
  }

  // Campanha: Meta, Google e utm_campaign viram uma lista só, pelo nome.
  const campanhas = new Map<string, Contagem>()
  for (const [rows, k, grupo] of [
    [porCampMeta, 'campaignName', 'Meta'], [porCampGoogle, 'googleCampaignName', 'Google'], [porCampUtm, 'utmCampaign', 'UTM'],
  ] as const) {
    for (const r of rows) {
      const nome = String(r[k]).trim()
      if (!nome || nome.includes('{')) continue // "{campaignname}" literal de link sem substituição
      const c = campanhas.get(nome)
      if (c) c.count = Math.max(c.count, r._count._all)
      else campanhas.set(nome, { value: nome, label: nome, count: r._count._all, group: grupo })
    }
  }

  const stageOrder = new Map(stages.map((s) => [`${s.funnelId}::${s.key}`, s.position ?? 0]))

  return {
    agents: ordenar(porResp.map((r) => ({
      value: r.assignedUserId == null ? '__none' : String(r.assignedUserId),
      label: r.assignedUserId == null ? 'Sem responsável' : (nomeUser.get(r.assignedUserId) ?? `Usuário #${r.assignedUserId}`),
      count: r._count._all,
    }))),
    teams: ordenar(porEquipe.map((r) => ({
      value: r.teamId == null ? '0' : String(r.teamId),
      label: r.teamId == null ? 'Sem equipe' : (equipe.get(r.teamId)?.name ?? `Equipe #${r.teamId}`),
      color: r.teamId == null ? null : equipe.get(r.teamId)?.color ?? null,
      count: r._count._all,
    }))),
    stages: porEtapa
      .filter((r) => r.funnelId != null && r.status)
      .map((r) => {
        const k = `${r.funnelId}::${r.status}`
        return {
          value: k,
          label: etapa.get(k)?.name ?? r.status,
          group: funil.get(r.funnelId) ?? `Funil #${r.funnelId}`,
          color: etapa.get(k)?.color ?? null,
          count: r._count._all,
        }
      })
      .sort((a, b) => a.group.localeCompare(b.group, 'pt-BR') || (stageOrder.get(a.value) ?? 0) - (stageOrder.get(b.value) ?? 0)),
    funnels: ordenar(Object.values(porEtapa.reduce((acc: Record<string, Contagem>, r) => {
      const v = r.funnelId == null ? '0' : String(r.funnelId)
      acc[v] ??= { value: v, label: r.funnelId == null ? 'Sem funil' : (funil.get(r.funnelId) ?? `Funil #${r.funnelId}`), count: 0 }
      acc[v]!.count += r._count._all
      return acc
    }, {}))),
    sources: simples(porOrigem, 'source', 'Sem origem'),
    originTypes: simples(porTipo, 'originType', 'Sem tipo'),
    campaigns: ordenar([...campanhas.values()]).slice(0, 300),
    adNames: simples(porAnuncio, 'adName', '').filter((c) => c.value !== '__none').slice(0, 300),
    utmSources: simples(porUtmS, 'utmSource', 'Sem utm_source'),
    utmMediums: simples(porUtmM, 'utmMedium', 'Sem utm_medium'),
    cidades: simples(porCidade, 'cidade', 'Sem cidade').slice(0, 300),
    segmentos: simples(porSeg, 'segmento', 'Sem segmento').slice(0, 300),
    statusSummaries: ordenar(porResumo.map((r) => ({
      value: r.statusSummaryId == null ? '0' : String(r.statusSummaryId),
      label: r.statusSummaryId == null ? 'Sem resumo' : (() => { const s = resumo.get(r.statusSummaryId); return s ? `${s.code} · ${s.name}` : `Resumo #${r.statusSummaryId}` })(),
      color: r.statusSummaryId == null ? null : resumo.get(r.statusSummaryId)?.color ?? null,
      count: r._count._all,
    }))),
    lossReasons: ordenar(porMotivo.filter((r) => r.lostReasonId != null).map((r) => ({
      value: String(r.lostReasonId),
      label: motivo.get(r.lostReasonId)?.name ?? `Motivo #${r.lostReasonId}`,
      color: motivo.get(r.lostReasonId)?.color ?? null,
      count: r._count._all,
    }))),
    aiScores: porScore.map((r) => ({ value: r.aiScoreLabel ?? '__none', label: r.aiScoreLabel ?? 'Sem score', count: r._count._all })),
    channels: ordenar([
      ...porEvo.map((r) => {
        const i = inst.get(r.instanceName)
        return { value: `evo:${r.instanceName}`, label: i ? (i.phone ? `${i.name} · ${i.phone}` : i.name) : r.instanceName, group: 'WhatsApp', count: r._count._all }
      }),
      ...porCloud.map((r) => {
        const c = cloud.get(r.cloudApiConnectionId)
        return { value: `cloud:${r.cloudApiConnectionId}`, label: c ? [c.displayName, c.displayPhone].filter(Boolean).join(' · ') || `Conexão #${c.id}` : `Conexão #${r.cloudApiConnectionId}`, group: 'API oficial', count: r._count._all }
      }),
    ]),
    tags: ordenar(porTag.filter((r) => tag.has(r.tagId)).map((r) => ({
      value: String(r.tagId), label: tag.get(r.tagId)!.name, color: tag.get(r.tagId)!.color, count: r._count._all,
    }))),
    customFields: await opcoesDosCampos(contarCampos),
    edu: await opcoesDoEducacional(base),
  }
}

// Campos personalizados: cada campo com os valores que existem nas fichas.
// A contagem sai de SQL direto no JSON — só para quem vê todos os leads (sem
// escopo), para não revelar quantos leads de outro setor têm cada valor.
async function opcoesDosCampos(contar: boolean) {
  const campos = await prisma.customField.findMany({
    where: { active: true, type: { notIn: ['textarea'] } },
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    select: { key: true, label: true, type: true, options: true, group: true },
  })
  const out: { key: string; label: string; type: string; group: string | null; values: Contagem[] }[] = []
  for (const c of campos) {
    if (!CHAVE_SEGURA.test(c.key)) continue
    const acc = new Map<string, Contagem>()
    // Opções cadastradas primeiro (aparecem mesmo sem lead ainda).
    const ops = Array.isArray(c.options) ? (c.options as any[]) : []
    for (const o of ops) {
      const v = typeof o === 'string' ? o : String(o?.value ?? o?.label ?? '')
      const l = typeof o === 'string' ? o : String(o?.label ?? o?.value ?? '')
      if (v) acc.set(v, { value: v, label: l || v, count: 0 })
    }
    if (c.type === 'checkbox' && !acc.size) {
      acc.set('true', { value: 'true', label: 'Sim', count: 0 })
      acc.set('false', { value: 'false', label: 'Não', count: 0 })
    }
    try {
      const rows = await prisma.$queryRawUnsafe<{ v: string | null; n: bigint }[]>(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(customFields, ?)) AS v, COUNT(*) AS n
           FROM bychat_leads WHERE qualifiedAt IS NOT NULL AND customFields IS NOT NULL
          GROUP BY v ORDER BY n DESC LIMIT 300`,
        `$."${c.key}"`,
      )
      let vazios = 0
      for (const r of rows) {
        const n = contar ? Number(r.n) : 0
        if (r.v == null || r.v === '' || r.v === 'null') { vazios += Number(r.n); continue }
        // multiselect guarda lista: conta cada item.
        let itens: string[] = [r.v]
        if (r.v.startsWith('[')) { try { const arr = JSON.parse(r.v); if (Array.isArray(arr)) itens = arr.map(String) } catch { /* texto */ } }
        for (const it of itens) {
          const atual = acc.get(it)
          if (atual) atual.count += n
          else acc.set(it, { value: it, label: it === 'true' ? 'Sim' : it === 'false' ? 'Não' : it, count: n })
        }
      }
      void vazios
    } catch { /* coluna JSON ilegível: fica só com as opções cadastradas */ }
    const valores = [...acc.values()]
    out.push({
      key: c.key, label: c.label, type: c.type, group: c.group ?? null,
      values: [
        { value: '__any', label: 'Preenchido', count: 0 },
        { value: '__none', label: 'Vazio', count: 0 },
        ...(contar ? ordenar(valores) : valores),
      ],
    })
  }
  return out
}

// Educacional: portais, cursos, processos, situação da inscrição e do vínculo.
// Contagem = inscrições (ou vínculos), não leads. Desligado → null.
async function opcoesDoEducacional(base: any) {
  if (!(await isModuleEnabled('educacional').catch(() => false))) return null
  const doLead = { lead: { is: base } }
  const regBase = { ...doLead, NOT: { status: 'merged' } }
  const [porPortal, porStatus, porPag, porOferta, porProc, porSit, contrato] = await Promise.all([
    (prisma.enrollmentRegistration.groupBy as any)({ by: ['portalId'], where: regBase, _count: { _all: true } }) as Promise<any[]>,
    (prisma.enrollmentRegistration.groupBy as any)({ by: ['status'], where: regBase, _count: { _all: true } }) as Promise<any[]>,
    (prisma.enrollmentRegistration.groupBy as any)({ by: ['paymentStatus'], where: regBase, _count: { _all: true } }) as Promise<any[]>,
    (prisma.processRegistration.groupBy as any)({ by: ['offeringId'], where: { ...doLead, enrollmentRegistration: { isNot: null } }, _count: { _all: true } }) as Promise<any[]>,
    (prisma.processRegistration.groupBy as any)({ by: ['selectionProcessId'], where: { ...doLead, enrollmentRegistration: { isNot: null } }, _count: { _all: true } }) as Promise<any[]>,
    (prisma.acaVinculo.groupBy as any)({ by: ['situacao'], where: { aluno: { lead: { is: base } } }, _count: { _all: true } }).catch(() => []) as Promise<any[]>,
    Promise.all([
      prisma.enrollmentRegistration.count({ where: { ...regBase, contratoAceite: { not: Prisma.DbNull } } }),
      prisma.enrollmentRegistration.count({ where: { ...regBase, contratoAceite: { equals: Prisma.DbNull } } }),
    ]),
  ])
  const [portais, ofertas, processos] = await Promise.all([
    prisma.enrollmentPortal.findMany({ where: { id: { in: porPortal.map((r) => r.portalId) } }, select: { id: true, nome: true } }),
    prisma.courseOffering.findMany({ where: { id: { in: porOferta.map((r) => r.offeringId) } }, select: { id: true, courseId: true, course: { select: { nome: true } } } }),
    prisma.selectionProcess.findMany({ where: { id: { in: porProc.map((r) => r.selectionProcessId) } }, select: { id: true, nome: true } }),
  ])
  const nomePortal = new Map(portais.map((p) => [p.id, p.nome]))
  const nomeProc = new Map(processos.map((p) => [p.id, p.nome]))
  const ofertaCurso = new Map(ofertas.map((o) => [o.id, o]))
  const cursos = new Map<number, Contagem>()
  for (const r of porOferta) {
    const o = ofertaCurso.get(r.offeringId)
    if (!o) continue
    const c = cursos.get(o.courseId)
    if (c) c.count += r._count._all
    else cursos.set(o.courseId, { value: String(o.courseId), label: o.course?.nome ?? `Curso #${o.courseId}`, count: r._count._all })
  }
  return {
    portals: ordenar(porPortal.map((r) => ({ value: String(r.portalId), label: nomePortal.get(r.portalId) ?? `Portal #${r.portalId}`, count: r._count._all }))),
    courses: ordenar([...cursos.values()]),
    processes: ordenar(porProc.map((r) => ({ value: String(r.selectionProcessId), label: nomeProc.get(r.selectionProcessId) ?? `Processo #${r.selectionProcessId}`, count: r._count._all }))),
    statuses: ordenar(porStatus.map((r) => ({ value: String(r.status), label: String(r.status), count: r._count._all }))),
    payments: ordenar(porPag.map((r) => ({ value: r.paymentStatus ?? '__none', label: r.paymentStatus ?? 'Sem cobrança', count: r._count._all }))),
    situacoes: ordenar(porSit.map((r) => ({ value: String(r.situacao), label: String(r.situacao), count: r._count._all }))),
    contrato: { assinado: contrato[0], semAssinatura: contrato[1] },
  }
}
