// src/services/painelComercial.ts
//
// Telas iniciais do comercial educacional (23/10/2026): Diretoria, Gerente e
// Agente. Um cálculo só para as três — o que muda entre elas é o RECORTE (quem
// entra) e o que o agente pode ver dos colegas (tudo, menos R$).
//
// Regras que atravessam o arquivo:
//   - CONVERSA NÃO É LEAD. Só conta quem tem `qualifiedAt` (o mesmo critério da
//     tela Contatos × Leads), não é grupo e não foi mesclado em outra ficha.
//   - MATRÍCULA é etapa de funil: o lead ENTROU na etapa de matrícula no período
//     (evento `status_changed`). A etapa de cada funil vem da configuração; sem
//     configuração, vale a etapa marcada como desfecho "ganho".
//   - PAGAMENTO é outra coisa: proposta ganha (valor pago, Receita única) +
//     inscrição paga que não virou proposta (sem contar duas vezes).
//   - TEMPO DE RESPOSTA vem das MENSAGENS (services/responseTime), em minutos
//     úteis — `firstResponseAt` depende de clique e existe em poucos leads.
//
// Setting `painelComercial.config` =
//   { funis?: number[], etapasMatricula?: { "<funnelId>": string[] },
//     etapasPerda?: { "<funnelId>": string[] },
//     pontos?: { matricula, pagamento, atendido, respostaRapida, atividade } }

import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { metaDoAgente, realizadoDoAgente, competenciaOf } from './commissions.js'
import { relogioDaCasa, medirTurnos, metaDeResposta } from './responseTime.js'

const CHAVE = 'painelComercial.config'
const DIA = 86_400_000
const PARADO_PADRAO_HORAS = 72
/** Lead sem interação há mais que isto é base antiga, não fila de trabalho. */
const FILA_JANELA_DIAS = 60

export type Visao = 'diretoria' | 'gerente' | 'agente'

export interface PesosDePontos { matricula: number; pagamento: number; atendido: number; respostaRapida: number; atividade: number }
export const PONTOS_PADRAO: PesosDePontos = { matricula: 10, pagamento: 5, atendido: 1, respostaRapida: 1, atividade: 1 }

export interface ConfigPainel { funis: number[] | null; etapasMatricula: Record<string, string[]>; etapasPerda: Record<string, string[]>; pontos: PesosDePontos }

export async function lerConfig(): Promise<ConfigPainel> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  const pontos = { ...PONTOS_PADRAO }
  for (const k of Object.keys(PONTOS_PADRAO) as (keyof PesosDePontos)[]) {
    const n = Number(v?.pontos?.[k])
    if (Number.isFinite(n) && n >= 0) pontos[k] = n
  }
  const porFunil = (o: any) => {
    const out: Record<string, string[]> = {}
    if (o && typeof o === 'object') for (const [f, ks] of Object.entries(o)) if (Array.isArray(ks)) out[String(Number(f))] = ks.map(String).filter(Boolean)
    return out
  }
  const funis = Array.isArray(v?.funis) ? v.funis.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null
  return { funis: funis && funis.length ? funis : null, etapasMatricula: porFunil(v?.etapasMatricula), etapasPerda: porFunil(v?.etapasPerda), pontos }
}

export async function salvarConfig(c: ConfigPainel): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: c as any, label: 'Telas do comercial: funis, etapa de matrícula e pontos', grp: 'comercial', fieldType: 'json' } as any,
    update: { value: c as any },
  })
}

interface FunilComEtapas { id: number; nome: string; etapas: { key: string; nome: string; cor: string; posicao: number; slaHoras: number | null; tipo: string | null }[] }

/** Funis ativos com etapas e a etapa de matrícula de cada um (configurada ou o desfecho "ganho"). */
export async function funisDoPainel(cfg?: ConfigPainel): Promise<{ funis: (FunilComEtapas & { matricula: string[]; perda: string[]; deVenda: boolean })[] }> {
  const c = cfg ?? await lerConfig()
  const fs = await prisma.funnel.findMany({
    where: { active: true },
    select: { id: true, name: true, stages: { where: { active: true }, orderBy: { position: 'asc' }, select: { key: true, name: true, color: true, position: true, slaHours: true, terminalKind: true } } },
    orderBy: { id: 'asc' },
  })
  const out = fs.map((f) => {
    const configuradas = c.etapasMatricula[String(f.id)]
    const matricula = configuradas ?? f.stages.filter((s) => s.terminalKind === 'won').map((s) => s.key)
    const perda = c.etapasPerda[String(f.id)] ?? f.stages.filter((s) => s.terminalKind === 'lost').map((s) => s.key)
    return {
      id: f.id, nome: f.name,
      etapas: f.stages.map((s) => ({ key: s.key, nome: s.name, cor: s.color, posicao: s.position, slaHoras: s.slaHours, tipo: s.terminalKind })),
      matricula,
      perda,
      deVenda: c.funis ? c.funis.includes(f.id) : matricula.length > 0,
    }
  })
  return { funis: out }
}

// ── Recorte ──────────────────────────────────────────────────────────────

export interface Filtros {
  dateFrom: string
  dateTo: string
  funis?: number[]
  teamId?: number | null
  userId?: number | null
  origem?: string | null
}

/** Datas no fuso de Brasília: "2026-10-01" começa às 03:00 UTC. */
const inicioDoDia = (d: string) => new Date(`${d}T00:00:00.000-03:00`)
const fimDoDia = (d: string) => new Date(inicioDoDia(d).getTime() + DIA - 1)
const diaBR = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)

interface Janela { de: Date; ate: Date }

function janelas(f: Filtros): { atual: Janela; anterior: Janela; dias: number; decorridos: number } {
  const de = inicioDoDia(f.dateFrom)
  const ate = fimDoDia(f.dateTo)
  const span = ate.getTime() - de.getTime() + 1
  const dias = Math.max(1, Math.round(span / DIA))
  const agora = Date.now()
  const decorridos = agora >= ate.getTime() ? dias : agora <= de.getTime() ? 0 : Math.max(1, Math.ceil((agora - de.getTime()) / DIA))
  return { atual: { de, ate }, anterior: { de: new Date(de.getTime() - span), ate: new Date(de.getTime() - 1) }, dias, decorridos }
}

/** Quem é "lead" para os KPIs. Alias `l`. */
const BASE_LEAD = Prisma.sql`l.qualifiedAt IS NOT NULL AND l.isGroup = 0 AND l.duplicateStatus <> 'merged'`

interface Recorte {
  funis: number[]
  /** Pares (funil, etapa) que contam como matrícula. */
  matricula: { funnelId: number; key: string }[]
  /** Etapas de desfecho (matrícula + perda + terminais): lead nelas não é fila. */
  terminais: { funnelId: number; key: string }[]
  /** null = todos; senão, só estes responsáveis. */
  usuarios: number[] | null
  /** Equipes do gerente (lead da equipe sem responsável também entra no total). */
  equipes: number[] | null
  origem: string | null
}

const lista = (xs: number[]) => Prisma.join(xs.length ? xs : [-1])

function noFunil(r: Recorte, alias = 'l') {
  const a = Prisma.raw(alias)
  return Prisma.sql`(${a}.funnelId IN (${lista(r.funis)}) OR EXISTS (SELECT 1 FROM bychat_lead_funnels lf WHERE lf.leadId = ${a}.id AND lf.saiuEm IS NULL AND lf.funnelId IN (${lista(r.funis)})))`
}
function daOrigem(r: Recorte) {
  return r.origem ? Prisma.sql`AND COALESCE(NULLIF(l.originType,''), NULLIF(l.source,''), 'desconhecida') = ${r.origem}` : Prisma.empty
}
/** Lead dentro do alcance (responsável na lista ou, para o gerente, a equipe). */
function noAlcance(r: Recorte, colUsuario = Prisma.sql`l.assignedUserId`) {
  if (!r.usuarios) return Prisma.empty
  if (r.equipes && r.equipes.length) return Prisma.sql`AND (${colUsuario} IN (${lista(r.usuarios)}) OR l.teamId IN (${lista(r.equipes)}))`
  return Prisma.sql`AND ${colUsuario} IN (${lista(r.usuarios)})`
}
/** Evento `e` entrou numa etapa de matrícula (o funil do evento ou, sem ele, o do lead). */
function entrouNaMatricula(r: Recorte, alias = 'e') {
  if (!r.matricula.length) return Prisma.sql`1 = 0`
  const e = Prisma.raw(alias)
  const funilDoEvento = Prisma.sql`COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(${e}.metadata, '$.funnelId')), 'null') AS UNSIGNED), (SELECT lx.funnelId FROM bychat_leads lx WHERE lx.id = ${e}.leadId))`
  return Prisma.sql`(${Prisma.join(r.matricula.map((m) => Prisma.sql`(${e}.newValue = ${m.key} AND ${funilDoEvento} = ${m.funnelId})`), ' OR ')})`
}

function foraDosTerminais(r: Recorte) {
  if (!r.terminais.length) return Prisma.sql`1 = 1`
  return Prisma.sql`NOT (${Prisma.join(r.terminais.map((t) => Prisma.sql`(l.funnelId = ${t.funnelId} AND l.status = ${t.key})`), ' OR ')})`
}

const num = (v: unknown) => (v == null ? 0 : Number(v))
const r2 = (n: number) => Math.round(n * 100) / 100
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null)
const mediana = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2)
}

// ── Consultas por responsável ────────────────────────────────────────────

type PorUsuario<T> = Map<number | null, T>

interface Atendimento { novos: number; contatados: number; tempos: number[]; rapidos: number }

/**
 * Leads novos do período, quantos receberam mensagem nossa e quanto tempo (em
 * minutos úteis) levou a 1ª resposta à 1ª mensagem do lead.
 */
async function leadsNovos(r: Recorte, j: Janela, ctx: CtxResposta): Promise<PorUsuario<Atendimento>> {
  const rows = await prisma.$queryRaw<{ id: number; u: number | null; contatado: number }[]>`
    SELECT l.id, l.assignedUserId u,
           EXISTS (SELECT 1 FROM bychat_messages m WHERE m.leadId = l.id AND m.fromMe = 1 AND m.isInternal = 0) contatado
      FROM bychat_leads l
     WHERE ${BASE_LEAD} AND l.createdAt BETWEEN ${j.de} AND ${j.ate} AND ${noFunil(r)} ${daOrigem(r)} ${noAlcance(r)}`
  const turnos = await medirTurnos(rows.map((x) => Number(x.id)), j.de, new Date(j.ate.getTime() + 7 * DIA), ctx.relogio)
  const primeiro = new Map<number, number | null>()
  for (const t of turnos.sort((a, b) => a.pergunta.getTime() - b.pergunta.getTime())) {
    if (!primeiro.has(t.leadId)) primeiro.set(t.leadId, t.minutos)
  }
  const m: PorUsuario<Atendimento> = new Map()
  for (const x of rows) {
    const k = x.u == null ? null : Number(x.u)
    const v = m.get(k) ?? { novos: 0, contatados: 0, tempos: [], rapidos: 0 }
    v.novos++
    if (num(x.contatado)) v.contatados++
    const min = primeiro.get(Number(x.id))
    if (min != null) { v.tempos.push(min); if (min <= ctx.metaMin) v.rapidos++ }
    m.set(k, v)
  }
  return m
}

interface CtxResposta { relogio: Awaited<ReturnType<typeof relogioDaCasa>>; metaMin: number }

async function matriculas(r: Recorte, j: Janela): Promise<{ u: number | null; leadId: number; dia: string; origem: string; segAteMatricula: number | null }[]> {
  const rows = await prisma.$queryRaw<{ u: number | null; leadId: number; em: Date; origem: string; criado: Date }[]>`
    SELECT l.assignedUserId u, l.id leadId, MIN(e.createdAt) em,
           COALESCE(NULLIF(l.originType,''), NULLIF(l.source,''), 'desconhecida') origem, l.createdAt criado
      FROM bychat_lead_events e JOIN bychat_leads l ON l.id = e.leadId
     WHERE e.type = 'status_changed' AND e.createdAt BETWEEN ${j.de} AND ${j.ate}
       AND ${entrouNaMatricula(r)} AND ${BASE_LEAD} ${daOrigem(r)} ${noAlcance(r)}
     GROUP BY l.id, l.assignedUserId, origem, l.createdAt`
  return rows.map((x) => ({
    u: x.u == null ? null : Number(x.u), leadId: Number(x.leadId), dia: diaBR(new Date(x.em)), origem: x.origem,
    segAteMatricula: Math.max(0, Math.round((new Date(x.em).getTime() - new Date(x.criado).getTime()) / 1000)),
  }))
}

interface Pagamento { u: number | null; valor: number; dia: string; curso: string }

async function pagamentos(r: Recorte, j: Janela): Promise<Pagamento[]> {
  const [negs, regs] = await Promise.all([
    prisma.$queryRaw<{ u: number | null; valor: any; em: Date; curso: string | null }[]>`
      SELECT n.responsavelUserId u, n.valorFinal valor, n.fechadaEm em,
             COALESCE((SELECT o.nome FROM bychat_edu_offerings o WHERE o.id = n.offeringId), NULLIF(n.titulo, '')) curso
        FROM bychat_negotiations n JOIN bychat_leads l ON l.id = n.leadId
       WHERE n.resultado = 'won' AND n.fechadaEm BETWEEN ${j.de} AND ${j.ate} AND ${BASE_LEAD}
         AND (n.funnelId IN (${lista(r.funis)}) OR (n.funnelId IS NULL AND ${noFunil(r)})) ${daOrigem(r)} ${noAlcance(r, Prisma.sql`n.responsavelUserId`)}`,
    prisma.$queryRaw<{ u: number | null; valor: any; em: Date; curso: string | null }[]>`
      SELECT l.assignedUserId u, r.paymentAmount valor, r.paymentPaidAt em, NULL curso
        FROM bychat_enrollment_registrations r JOIN bychat_leads l ON l.id = r.leadId
       WHERE r.paymentStatus = 'paid' AND r.mergedIntoId IS NULL AND r.paymentPaidAt BETWEEN ${j.de} AND ${j.ate}
         AND NOT EXISTS (SELECT 1 FROM bychat_negotiations n WHERE n.registrationId = r.id)
         AND ${BASE_LEAD} AND ${noFunil(r)} ${daOrigem(r)} ${noAlcance(r)}`,
  ])
  return [...negs, ...regs].map((x) => ({ u: x.u == null ? null : Number(x.u), valor: num(x.valor), dia: diaBR(new Date(x.em)), curso: x.curso || 'Sem curso definido' }))
}

async function perdidos(r: Recorte, j: Janela): Promise<{ u: number | null; motivo: string }[]> {
  const rows = await prisma.$queryRaw<{ u: number | null; motivo: string | null }[]>`
    SELECT l.assignedUserId u, lr.name motivo
      FROM bychat_leads l LEFT JOIN bychat_loss_reasons lr ON lr.id = l.lostReasonId
     WHERE l.outcome = 'lost' AND l.outcomeAt BETWEEN ${j.de} AND ${j.ate} AND ${BASE_LEAD} AND ${noFunil(r)} ${daOrigem(r)} ${noAlcance(r)}`
  return rows.map((x) => ({ u: x.u == null ? null : Number(x.u), motivo: x.motivo || 'Sem motivo informado' }))
}

async function atividades(r: Recorte, j: Janela): Promise<PorUsuario<{ concluidas: number; atrasadas: number }>> {
  const quem = Prisma.sql`COALESCE(a.assignedUserId, a.userId)`
  const alcance = r.usuarios ? Prisma.sql`AND ${quem} IN (${lista(r.usuarios)})` : Prisma.empty
  const [feitas, atrasadas] = await Promise.all([
    prisma.$queryRaw<{ u: number | null; c: bigint }[]>`
      SELECT ${quem} u, COUNT(*) c FROM bychat_activities a
       WHERE a.status = 'completed' AND a.completedAt BETWEEN ${j.de} AND ${j.ate} ${alcance} GROUP BY u`,
    prisma.$queryRaw<{ u: number | null; c: bigint }[]>`
      SELECT ${quem} u, COUNT(*) c FROM bychat_activities a
       WHERE a.status IN ('pending', 'overdue') AND a.scheduledAt < NOW(3) ${alcance} GROUP BY u`,
  ])
  const m: PorUsuario<{ concluidas: number; atrasadas: number }> = new Map()
  for (const x of feitas) m.set(x.u == null ? null : Number(x.u), { concluidas: num(x.c), atrasadas: 0 })
  for (const x of atrasadas) {
    const k = x.u == null ? null : Number(x.u)
    m.set(k, { concluidas: m.get(k)?.concluidas ?? 0, atrasadas: num(x.c) })
  }
  return m
}

/** Fila de agora (não depende do período): sem resposta e parados além do SLA da etapa. */
async function filaAgora(r: Recorte): Promise<PorUsuario<{ semResposta: number; parados: number; ativos: number }>> {
  const rows = await prisma.$queryRaw<{ u: number | null; semResposta: any; parados: any; ativos: bigint }[]>`
    SELECT l.assignedUserId u,
           SUM(l.unreadMessages > 0) semResposta,
           SUM(GREATEST(COALESCE(l.lastMessageAt, l.createdAt), COALESCE(l.lastActivityAt, l.createdAt))
               < NOW(3) - INTERVAL COALESCE(s.slaHours, ${PARADO_PADRAO_HORAS}) HOUR) parados,
           COUNT(*) ativos
      FROM bychat_leads l LEFT JOIN bychat_stages s ON s.funnelId = l.funnelId AND s.key = l.status
     WHERE l.outcome IS NULL AND ${BASE_LEAD} AND ${noFunil(r)} ${daOrigem(r)} ${noAlcance(r)}
       AND s.terminalKind IS NULL AND ${foraDosTerminais(r)}
       AND GREATEST(COALESCE(l.lastMessageAt, l.createdAt), COALESCE(l.lastActivityAt, l.createdAt)) >= NOW(3) - INTERVAL ${FILA_JANELA_DIAS} DAY
     GROUP BY l.assignedUserId`
  const m: PorUsuario<{ semResposta: number; parados: number; ativos: number }> = new Map()
  for (const x of rows) m.set(x.u == null ? null : Number(x.u), { semResposta: num(x.semResposta), parados: num(x.parados), ativos: num(x.ativos) })
  return m
}

// ── Funil ────────────────────────────────────────────────────────────────

async function funilDetalhado(r: Recorte, j: Janela, funis: FunilComEtapas[]) {
  const atual = await prisma.$queryRaw<{ f: number; k: string; c: bigint }[]>`
    SELECT l.funnelId f, l.status k, COUNT(*) c FROM bychat_leads l
     WHERE ${BASE_LEAD} AND l.funnelId IN (${lista(r.funis)}) ${daOrigem(r)} ${noAlcance(r)}
     GROUP BY l.funnelId, l.status`
  // Quem passou pela etapa no período e, dentre eles, quantos chegaram à
  // matrícula (no período, depois de passar por ela). É a leitura de "onde
  // trava": a conversão entre etapas vizinhas mente porque o lead pula etapa.
  const entradas = await prisma.$queryRaw<{ f: number; k: string; c: bigint; chegou: bigint }[]>`
    SELECT x.f, x.k, COUNT(*) c, SUM(x.chegou) chegou FROM (
      SELECT COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.funnelId')), 'null') AS UNSIGNED), l.funnelId) f,
             e.newValue k, e.leadId,
             MAX(EXISTS (SELECT 1 FROM bychat_lead_events e2 WHERE e2.leadId = e.leadId AND e2.type = 'status_changed'
                          AND e2.createdAt >= e.createdAt AND e2.createdAt <= ${j.ate} AND ${entrouNaMatricula(r, 'e2')})) chegou
        FROM bychat_lead_events e JOIN bychat_leads l ON l.id = e.leadId
       WHERE e.type = 'status_changed' AND e.createdAt BETWEEN ${j.de} AND ${j.ate} AND ${BASE_LEAD} ${daOrigem(r)} ${noAlcance(r)}
       GROUP BY f, k, e.leadId
    ) x WHERE x.f IN (${lista(r.funis)}) GROUP BY x.f, x.k`
  const chave = (f: number, k: string) => `${f}|${k}`
  const agora = new Map(atual.map((x) => [chave(Number(x.f), x.k), num(x.c)]))
  const entrou = new Map(entradas.map((x) => [chave(Number(x.f), x.k), { c: num(x.c), chegou: num(x.chegou) }]))
  return funis.filter((f) => r.funis.includes(f.id)).map((f) => {
    const etapas = f.etapas.map((s) => {
      const e = entrou.get(chave(f.id, s.key)) ?? { c: 0, chegou: 0 }
      const matricula = r.matricula.some((m) => m.funnelId === f.id && m.key === s.key)
      const terminal = matricula || r.terminais.some((t) => t.funnelId === f.id && t.key === s.key)
      return {
        key: s.key, nome: s.nome, cor: s.cor, terminal, matricula,
        agora: agora.get(chave(f.id, s.key)) ?? 0, entradas: e.c,
        chegaramAMatricula: terminal ? null : pct(e.chegou, e.c),
      }
    })
    return { id: f.id, nome: f.nome, etapas }
  })
}

// ── Painel ───────────────────────────────────────────────────────────────

export interface Quem { userId: number; role: string }

interface LinhaAgente {
  userId: number; nome: string; avatar: string | null; equipe: string | null; eu: boolean
  leads: number; contatados: number; taxaContato: number | null
  /** Mediana da 1ª resposta, em minutos úteis (null com menos de 5 amostras). */
  tempoResposta: number | null; respostasNaMeta: number
  matriculas: number; conversao: number | null
  pagamentos: number; receita: number | null; ticketMedio: number | null
  perdidos: number; atividades: number; atrasadas: number; semResposta: number; parados: number; ativos: number
  pontos: number
  meta: { metrica: string; alvo: number | null; atual: number | null; atingimento: number | null; projecao: number | null } | null
  conquistas: string[]
  sequencia: number
}

/** O recorte de cada visão. Diretoria vê tudo; gerente, as equipes dele; agente, a si mesmo nos números e todos no placar. */
async function recorteDaVisao(visao: Visao, quem: Quem, f: Filtros, cfg: ConfigPainel) {
  const { funis } = await funisDoPainel(cfg)
  const deVenda = funis.filter((x) => x.deVenda)
  const escolhidos = (f.funis?.length ? funis.filter((x) => f.funis!.includes(x.id)) : deVenda)
  const matricula = escolhidos.flatMap((x) => x.matricula.map((key) => ({ funnelId: x.id, key })))
  const terminais = escolhidos.flatMap((x) => [...x.matricula, ...x.perda].map((key) => ({ funnelId: x.id, key })))

  let equipesDoGerente: number[] | null = null
  let usuariosDoRecorte: number[] | null = null
  if (visao === 'gerente' && quem.role !== 'SUPERADMIN' && quem.role !== 'ADMIN') {
    equipesDoGerente = (await prisma.teamMember.findMany({ where: { userId: quem.userId }, select: { teamId: true } })).map((t) => t.teamId)
    const membros = await prisma.teamMember.findMany({ where: { teamId: { in: equipesDoGerente.length ? equipesDoGerente : [-1] } }, select: { userId: true } })
    usuariosDoRecorte = [...new Set([quem.userId, ...membros.map((m) => m.userId)])]
  }
  if (f.teamId) {
    const membros = (await prisma.teamMember.findMany({ where: { teamId: f.teamId }, select: { userId: true } })).map((m) => m.userId)
    usuariosDoRecorte = usuariosDoRecorte ? usuariosDoRecorte.filter((u) => membros.includes(u)) : membros
    equipesDoGerente = equipesDoGerente ? equipesDoGerente.filter((t) => t === f.teamId) : [f.teamId]
  }
  if (f.userId && visao !== 'agente') {
    usuariosDoRecorte = usuariosDoRecorte ? usuariosDoRecorte.filter((u) => u === f.userId) : [f.userId]
    equipesDoGerente = null
  }
  const recorte: Recorte = { funis: escolhidos.map((x) => x.id), matricula, terminais, usuarios: usuariosDoRecorte, equipes: equipesDoGerente, origem: f.origem || null }
  return { recorte, funis, escolhidos }
}

async function totais(r: Recorte, j: Janela, ctx: CtxResposta) {
  const [novos, mats, pags] = await Promise.all([leadsNovos(r, j, ctx), matriculas(r, j), pagamentos(r, j)])
  let leads = 0, contatados = 0, rapidos = 0
  const tempos: number[] = []
  for (const v of novos.values()) { leads += v.novos; contatados += v.contatados; rapidos += v.rapidos; tempos.push(...v.tempos) }
  const receita = r2(pags.reduce((s, p) => s + p.valor, 0))
  return {
    leads, contatados, taxaContato: pct(contatados, leads),
    tempoResposta: tempos.length >= 5 ? mediana(tempos) : null, amostraResposta: tempos.length, dentroDaMeta: pct(rapidos, tempos.length),
    matriculas: mats.length, conversao: pct(mats.length, leads),
    pagamentos: pags.length, receita, ticketMedio: pags.length ? r2(receita / pags.length) : null,
    cicloMedioDias: (() => { const m = mediana(mats.map((x) => x.segAteMatricula ?? 0)); return m == null ? null : Math.round((m / 86400) * 10) / 10 })(),
    _novos: novos, _mats: mats, _pags: pags,
  }
}

/** Dias seguidos (até o último dia do período, sem domingo) com ao menos uma matrícula. */
function sequenciaDeDias(dias: Set<string>, ultimo: Date): number {
  let n = 0
  const d = new Date(ultimo.getTime())
  for (let i = 0; i < 90; i++) {
    const k = diaBR(d)
    const domingo = new Date(`${k}T12:00:00-03:00`).getUTCDay() === 0
    if (dias.has(k)) n++
    else if (!domingo && !(i === 0)) break // hoje ainda sem matrícula não quebra a sequência
    d.setTime(d.getTime() - DIA)
  }
  return n
}

export async function painelComercial(visao: Visao, quem: Quem, f: Filtros) {
  const cfg = await lerConfig()
  const jan = janelas(f)
  const ctx: CtxResposta = { relogio: await relogioDaCasa(), metaMin: await metaDeResposta() }
  const { recorte, funis, escolhidos } = await recorteDaVisao(visao, quem, f, cfg)

  // O agente vê os PRÓPRIOS números no topo e todos os colegas no placar.
  const recorteDoTopo: Recorte = visao === 'agente' ? { ...recorte, usuarios: [quem.userId], equipes: null } : recorte
  const recorteDoPlacar: Recorte = visao === 'agente' ? { ...recorte, usuarios: null, equipes: null } : recorte

  const [atual, anterior, perdas, ativ, fila, funil] = await Promise.all([
    totais(recorteDoPlacar, jan.atual, ctx),
    totais(recorteDoTopo, jan.anterior, ctx),
    perdidos(recorteDoPlacar, jan.atual),
    atividades(recorteDoPlacar, jan.atual),
    filaAgora(recorteDoPlacar),
    funilDetalhado(recorteDoTopo, jan.atual, funis),
  ])

  // ── Linhas por agente ──
  const ids = new Set<number>()
  for (const m of [atual._novos, ativ, fila]) for (const k of m.keys()) if (k != null) ids.add(k)
  for (const x of atual._mats) if (x.u != null) ids.add(x.u)
  for (const x of atual._pags) if (x.u != null) ids.add(x.u)
  const ativos = await prisma.user.findMany({ where: { active: true, role: { in: ['AGENT', 'MANAGER'] } }, select: { id: true } })
  for (const u of ativos) if (!recorteDoPlacar.usuarios || recorteDoPlacar.usuarios.includes(u.id)) ids.add(u.id)
  const usuarios = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, displayName: true, role: true, teams: { select: { team: { select: { name: true } } }, take: 1 } },
  })

  const funilUnico = recorte.funis.length === 1 ? recorte.funis[0]! : null
  const competencia = competenciaOf(jan.atual.de)
  const comissoes = await prisma.commissionEntry.groupBy({
    by: ['userId'], where: { competencia, status: { in: ['prevista', 'paga'] } }, _sum: { valorTotal: true },
  }).catch(() => [] as any[])

  const linhas: LinhaAgente[] = []
  for (const u of usuarios) {
    if (u.role === 'VIEWER') continue
    const n = atual._novos.get(u.id) ?? { novos: 0, contatados: 0, tempos: [], rapidos: 0 }
    const mats = atual._mats.filter((x) => x.u === u.id)
    const pags = atual._pags.filter((x) => x.u === u.id)
    const at = ativ.get(u.id) ?? { concluidas: 0, atrasadas: 0 }
    const fl = fila.get(u.id) ?? { semResposta: 0, parados: 0, ativos: 0 }
    const receita = r2(pags.reduce((s, p) => s + p.valor, 0))
    const pontos = mats.length * cfg.pontos.matricula + pags.length * cfg.pontos.pagamento + n.contatados * cfg.pontos.atendido
      + n.rapidos * cfg.pontos.respostaRapida + at.concluidas * cfg.pontos.atividade

    // Meta: a de nº de ganhas vem primeiro (é a que o time persegue), depois receita e conversão.
    let meta: LinhaAgente['meta'] = null
    for (const metrica of ['count', 'revenue', 'conversion'] as const) {
      const g = await metaDoAgente(u.id, funilUnico, metrica, jan.atual.de, jan.atual.ate).catch(() => null)
      if (!g || !(g.target > 0)) continue
      const real = await realizadoDoAgente(u.id, funilUnico, jan.atual.de, jan.atual.ate)
      const atualM = metrica === 'conversion' ? real.conversion : (real as any)[metrica]
      const proj = metrica === 'conversion' || !jan.decorridos ? atualM : r2((num(atualM) / jan.decorridos) * jan.dias)
      meta = { metrica, alvo: g.target, atual: atualM ?? null, atingimento: atualM != null ? r2((num(atualM) / g.target) * 100) : null, projecao: proj ?? null }
      break
    }

    linhas.push({
      userId: u.id, nome: u.displayName || u.name, avatar: null, equipe: u.teams[0]?.team.name ?? null, eu: u.id === quem.userId,
      leads: n.novos, contatados: n.contatados, taxaContato: pct(n.contatados, n.novos),
      tempoResposta: n.tempos.length >= 5 ? mediana(n.tempos) : null, respostasNaMeta: n.rapidos,
      matriculas: mats.length, conversao: pct(mats.length, n.novos),
      pagamentos: pags.length, receita, ticketMedio: pags.length ? r2(receita / pags.length) : null,
      perdidos: perdas.filter((p) => p.u === u.id).length, atividades: at.concluidas, atrasadas: at.atrasadas,
      semResposta: fl.semResposta, parados: fl.parados, ativos: fl.ativos,
      pontos, meta, conquistas: [], sequencia: sequenciaDeDias(new Set(mats.map((x) => x.dia)), new Date(Math.min(Date.now(), jan.atual.ate.getTime()))),
    })
  }
  // Fora quem não tem nada no período nem na fila (usuário de suporte, por exemplo).
  const placar = linhas.filter((l) => l.leads || l.matriculas || l.pagamentos || l.ativos || l.atividades || l.meta)

  // ── Conquistas ──
  const comLeads = placar.filter((l) => l.leads >= 10)
  const convMedia = comLeads.length ? comLeads.reduce((s, l) => s + (l.conversao ?? 0), 0) / comLeads.length : null
  for (const l of placar) {
    if (l.tempoResposta != null && l.tempoResposta <= ctx.metaMin) l.conquistas.push('relampago')
    if (l.matriculas >= 5) l.conquistas.push('fechador')
    if (l.meta?.atingimento != null && l.meta.atingimento >= 100) l.conquistas.push('meta_batida')
    if (l.ativos > 0 && l.atrasadas === 0 && l.semResposta === 0) l.conquistas.push('em_dia')
    if (convMedia != null && l.leads >= 10 && (l.conversao ?? 0) >= convMedia * 1.2 && (l.conversao ?? 0) > 0) l.conquistas.push('conversor')
    if (l.sequencia >= 3) l.conquistas.push('sequencia')
  }
  const lider = [...placar].sort((a, b) => b.pontos - a.pontos)[0]
  if (lider && lider.pontos > 0) lider.conquistas.push('lider')

  // ── Agente: nada de R$ dos colegas ──
  if (visao === 'agente') {
    for (const l of placar) {
      if (l.eu) continue
      l.receita = null; l.ticketMedio = null
      if (l.meta && l.meta.metrica === 'revenue') l.meta = { ...l.meta, alvo: null, atual: null, projecao: null }
    }
  }

  // ── Topo (o agente vê só os dele) ──
  const topo = visao === 'agente' ? await totais(recorteDoTopo, jan.atual, ctx) : atual
  const meus = visao === 'agente' ? placar.find((l) => l.eu) ?? null : null
  const minhaComissao = visao === 'agente' ? num(comissoes.find((c: any) => c.userId === quem.userId)?._sum?.valorTotal) : null

  // ── Série diária ──
  const serie: { dia: string; leads: number; matriculas: number; pagamentos: number }[] = []
  {
    const leadsDia = await prisma.$queryRaw<{ d: string; c: bigint }[]>`
      SELECT DATE_FORMAT(l.createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') d, COUNT(*) c FROM bychat_leads l
       WHERE ${BASE_LEAD} AND l.createdAt BETWEEN ${jan.atual.de} AND ${jan.atual.ate} AND ${noFunil(recorteDoTopo)} ${daOrigem(recorteDoTopo)} ${noAlcance(recorteDoTopo)}
       GROUP BY d`
    const mapL = new Map(leadsDia.map((x) => [x.d, num(x.c)]))
    const mats = visao === 'agente' ? topo._mats : atual._mats
    const pags = visao === 'agente' ? topo._pags : atual._pags
    for (let t = jan.atual.de.getTime(); t <= jan.atual.ate.getTime(); t += DIA) {
      const d = diaBR(new Date(t + 3 * 3600_000))
      serie.push({ dia: d, leads: mapL.get(d) ?? 0, matriculas: mats.filter((x) => x.dia === d).length, pagamentos: pags.filter((x) => x.dia === d).length })
    }
  }

  // ── Quebras ──
  const contar = <T>(xs: T[], k: (x: T) => string) => {
    const m = new Map<string, number>()
    for (const x of xs) m.set(k(x), (m.get(k(x)) ?? 0) + 1)
    return [...m.entries()].map(([nome, c]) => ({ nome, c })).sort((a, b) => b.c - a.c)
  }
  const leadsPorOrigem = await prisma.$queryRaw<{ o: string; c: bigint }[]>`
    SELECT COALESCE(NULLIF(l.originType,''), NULLIF(l.source,''), 'desconhecida') o, COUNT(*) c FROM bychat_leads l
     WHERE ${BASE_LEAD} AND l.createdAt BETWEEN ${jan.atual.de} AND ${jan.atual.ate} AND ${noFunil(recorteDoTopo)} ${noAlcance(recorteDoTopo)}
     GROUP BY o ORDER BY c DESC LIMIT 15`
  const matsTopo = visao === 'agente' ? topo._mats : atual._mats
  const pagsTopo = visao === 'agente' ? topo._pags : atual._pags
  const porOrigem = leadsPorOrigem.map((x) => {
    const m = matsTopo.filter((y) => y.origem === x.o).length
    return { nome: x.o, leads: num(x.c), matriculas: m, conversao: pct(m, num(x.c)) }
  })
  const porCurso = (() => {
    const m = new Map<string, { c: number; v: number }>()
    for (const p of pagsTopo) { const a = m.get(p.curso) ?? { c: 0, v: 0 }; a.c++; a.v += p.valor; m.set(p.curso, a) }
    return [...m.entries()].map(([nome, a]) => ({ nome, pagamentos: a.c, receita: r2(a.v) })).sort((a, b) => b.pagamentos - a.pagamentos).slice(0, 20)
  })()
  const perdasTopo = visao === 'agente' ? perdas.filter((p) => p.u === quem.userId) : perdas
  const motivosDePerda = contar(perdasTopo, (p) => p.motivo).slice(0, 10)

  // ── Meta da operação (missão do time) ──
  let missao: { alvo: number; atual: number; atingimento: number; metrica: string; projecao: number } | null = null
  {
    const g = await metaDoAgente(null, funilUnico, 'count', jan.atual.de, jan.atual.ate).catch(() => null)
    if (g && g.target > 0) {
      const real = await realizadoDoAgente(null, funilUnico, jan.atual.de, jan.atual.ate)
      missao = { metrica: 'count', alvo: g.target, atual: real.count, atingimento: r2((real.count / g.target) * 100), projecao: jan.decorridos ? r2((real.count / jan.decorridos) * jan.dias) : real.count }
    }
  }

  const semReceita = (t: typeof atual) => {
    const { _novos, _mats, _pags, ...resto } = t
    return resto
  }
  const filtrosDisponiveis = {
    funis: funis.map((x) => ({ id: x.id, nome: x.nome, deVenda: x.deVenda, temMatricula: x.matricula.length > 0 })),
    equipes: visao === 'agente' ? [] : await prisma.team.findMany({ where: { active: true, ...(recorte.equipes && visao === 'gerente' ? { id: { in: recorte.equipes } } : {}) }, select: { id: true, name: true }, orderBy: { position: 'asc' } }),
    origens: porOrigem.map((o) => o.nome),
  }

  return {
    visao,
    periodo: { de: f.dateFrom, ate: f.dateTo, dias: jan.dias, decorridos: jan.decorridos },
    funisNoRecorte: escolhidos.map((x) => ({ id: x.id, nome: x.nome, semEtapaDeMatricula: x.matricula.length === 0 })),
    kpis: semReceita(topo),
    anterior: semReceita(anterior),
    projecao: jan.decorridos && jan.decorridos < jan.dias
      ? { matriculas: Math.round((topo.matriculas / jan.decorridos) * jan.dias), pagamentos: Math.round((topo.pagamentos / jan.decorridos) * jan.dias), receita: r2((topo.receita / jan.decorridos) * jan.dias) }
      : null,
    fila: visao === 'agente'
      ? { semResposta: meus?.semResposta ?? 0, parados: meus?.parados ?? 0, atrasadas: meus?.atrasadas ?? 0, ativos: meus?.ativos ?? 0 }
      : {
          ...[...fila.values()].reduce((s, v) => ({ semResposta: s.semResposta + v.semResposta, parados: s.parados + v.parados, ativos: s.ativos + v.ativos }), { semResposta: 0, parados: 0, ativos: 0 }),
          atrasadas: [...ativ.values()].reduce((s, v) => s + v.atrasadas, 0),
        },
    semResponsavel: visao === 'agente' ? null : { leads: atual._novos.get(null)?.novos ?? 0, ativos: fila.get(null)?.ativos ?? 0 },
    serie,
    funil,
    porOrigem,
    porCurso,
    motivosDePerda,
    agentes: placar,
    mediaDoTime: placar.length ? {
      conversao: convMedia,
      tempoResposta: mediana(placar.map((l) => l.tempoResposta).filter((x): x is number => x != null)),
      matriculas: r2(placar.reduce((s, l) => s + l.matriculas, 0) / placar.length),
      pontos: r2(placar.reduce((s, l) => s + l.pontos, 0) / placar.length),
    } : null,
    eu: meus ? { ...meus, comissaoPrevista: minhaComissao } : null,
    missao,
    pontos: cfg.pontos,
    metaDeRespostaMin: ctx.metaMin,
    filtros: filtrosDisponiveis,
  }
}
