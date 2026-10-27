// src/services/emailCampanhas.ts
//
// Campanhas de e-mail marketing (módulo email_marketing).
//
// O público é um conjunto de FILTROS, avaliado quando o envio começa. Ficam de
// fora sempre: lead sem e-mail válido, descadastrado do canal e-mail, endereço
// bloqueado (bounce/spam — ver emailEventos.ts) e e-mail repetido (dois leads
// com o mesmo endereço recebem uma vez só).
//
// O envio sai em lotes pequenos por um agendador: a conta Resend é dividida
// entre os clientes e tem limite de requisições por segundo. Estourou (429)?
// O destinatário volta para a fila e o lote para — o próximo tique continua.
//
// Nenhum envio é bloqueado pela cota do plano: o que passar do incluído vira
// excedente na fatura de consumo (decisão do usuário, 26/10). A prévia mostra
// quanto vai passar antes de alguém clicar em Enviar.

import { prisma } from '../lib/prisma.js'
import { sendEmailGeneric, getEmailConfig, getFromAddress } from './notify.js'
import { motivoDeBloqueio } from './emailEventos.js'
import { appendPreferencesLink } from './preferencesToken.js'
import { buildLeadVars, replaceVariables, TEMPLATE_VARIABLES } from '../routes/templates.js'

export interface Publico {
  funnelId?: number | null
  /** Chaves das etapas (Lead.status) dentro do funil. Vazio = todas. */
  etapas?: string[]
  tagIds?: number[]
  /** 'qualquer' = tem pelo menos uma das tags; 'todas' = tem todas. */
  tagModo?: 'qualquer' | 'todas'
  origens?: string[]
  criadoDe?: string | null
  criadoAte?: string | null
  cidade?: string | null
  segmento?: string | null
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Filtros → where do Prisma. Só o que o banco resolve bem; o resto é filtrado em memória. */
function whereDoPublico(p: Publico): any {
  const where: any = { AND: [] as any[] }
  if (p.funnelId) where.AND.push({ funnelId: Number(p.funnelId) })
  if (p.etapas?.length) where.AND.push({ status: { in: p.etapas.map(String) } })
  if (p.origens?.length) where.AND.push({ source: { in: p.origens.map(String) } })
  if (p.cidade?.trim()) where.AND.push({ cidade: { contains: p.cidade.trim() } })
  if (p.segmento?.trim()) where.AND.push({ segmento: { contains: p.segmento.trim() } })
  if (p.criadoDe) where.AND.push({ createdAt: { gte: new Date(`${p.criadoDe}T00:00:00-03:00`) } })
  if (p.criadoAte) where.AND.push({ createdAt: { lte: new Date(`${p.criadoAte}T23:59:59-03:00`) } })
  const tags = (p.tagIds ?? []).map(Number).filter(Boolean)
  if (tags.length) {
    if (p.tagModo === 'todas') for (const t of tags) where.AND.push({ tags: { some: { tagId: t } } })
    else where.AND.push({ tags: { some: { tagId: { in: tags } } } })
  }
  where.AND.push({ email: { contains: '@' } })
  return where
}

const optouEmail = (v: unknown) => Array.isArray(v) && (v as unknown[]).includes('email')

/**
 * Quem recebe: leads do filtro, menos descadastrados, bloqueados e repetidos.
 * Devolve também quantos ficaram de fora e por quê (é o que a prévia mostra).
 */
export async function resolverPublico(p: Publico) {
  const leads = await prisma.lead.findMany({
    where: whereDoPublico(p),
    select: { id: true, email: true, optOutChannels: true },
    orderBy: { id: 'asc' },
  })
  const bloqueados = new Map((await prisma.emailSupressao.findMany({ select: { email: true, motivo: true } })).map((s) => [s.email, s.motivo]))
  const vistos = new Set<string>()
  const destinatarios: Array<{ leadId: number; email: string }> = []
  const fora = { semEmail: 0, descadastrados: 0, bloqueados: 0, repetidos: 0 }
  for (const l of leads) {
    const email = String(l.email || '').trim().toLowerCase()
    if (!EMAIL_OK.test(email)) { fora.semEmail++; continue }
    if (optouEmail(l.optOutChannels)) { fora.descadastrados++; continue }
    // Spam também fica de fora aqui: campanha é envio automático para lead.
    if (bloqueados.has(email)) { fora.bloqueados++; continue }
    if (vistos.has(email)) { fora.repetidos++; continue }
    vistos.add(email)
    destinatarios.push({ leadId: l.id, email })
  }
  return { encontrados: leads.length, destinatarios, fora }
}

/** Mês corrente no horário de Brasília (AAAA-MM). */
function competencia(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)
}

/**
 * Situação do plano de e-mail no mês: incluído, já usado e preço do excedente
 * (vem da loja central, Setting consumo.cobranca.AAAA-MM). Sem plano publicado
 * ou com conta própria, `incluido` é null — não há o que estimar.
 */
export async function situacaoDoPlano() {
  const comp = competencia()
  const inicio = new Date(`${comp}-01T03:00:00Z`)
  const usado = await prisma.outboundSend.count({ where: { channel: 'email', createdAt: { gte: inicio }, status: { notIn: ['failed', 'error'] } } })
  const s = await prisma.setting.findUnique({ where: { key: `consumo.cobranca.${comp}` } })
  const v: any = typeof s?.value === 'string' ? JSON.parse(s.value) : s?.value
  const item = Array.isArray(v?.plano) ? v.plano.find((x: any) => x.codigo === 'email') : null
  const proprio = !!v?.emailContaPropria
  const franquia = !proprio && item?.cobrar && item?.modo === 'franquia'
  return {
    usado,
    incluido: franquia ? Number(item.franquia ?? 0) : null,
    precoExcedente: franquia ? Number(item.precoUnitario ?? 0) : null,
    contaPropria: proprio,
  }
}

/** Prévia do público + quanto do plano o envio consome. */
export async function previa(p: Publico) {
  const r = await resolverPublico(p)
  const plano = await situacaoDoPlano()
  const aEnviar = r.destinatarios.length
  let excedente: { quantidade: number; valor: number | null } | null = null
  if (plano.incluido != null) {
    const depois = plano.usado + aEnviar
    const qtd = Math.max(0, depois - Math.max(plano.incluido, plano.usado))
    excedente = { quantidade: qtd, valor: plano.precoExcedente != null ? Math.round(qtd * plano.precoExcedente * 100) / 100 : null }
  }
  return { encontrados: r.encontrados, aEnviar, fora: r.fora, plano, excedente }
}

/** Cria os destinatários e põe a campanha para enviar. Congela o HTML do modelo. */
export async function iniciarEnvio(campanhaId: number): Promise<{ ok: true; total: number } | { ok: false; erro: string }> {
  const c = await prisma.emailCampanha.findUnique({ where: { id: campanhaId } })
  if (!c) return { ok: false, erro: 'Campanha não encontrada' }
  if (!['rascunho', 'agendada'].includes(c.status)) return { ok: false, erro: `A campanha está ${c.status}` }
  const tpl = c.templateId ? await prisma.messageTemplate.findUnique({ where: { id: c.templateId } }) : null
  const html = tpl?.bodyHtml || c.html
  if (!html?.trim()) return { ok: false, erro: 'O modelo escolhido não tem conteúdo de e-mail' }
  const { destinatarios } = await resolverPublico(c.publico as Publico)
  if (!destinatarios.length) return { ok: false, erro: 'Nenhum destinatário no público escolhido' }
  // Variante alternada: A, B, A, B… — metade para cada assunto, na mesma ordem.
  const comB = !!c.assuntoB?.trim()
  for (let i = 0; i < destinatarios.length; i += 1000) {
    await prisma.emailCampanhaEnvio.createMany({
      data: destinatarios.slice(i, i + 1000).map((d, j) => ({ campanhaId, leadId: d.leadId, email: d.email, variante: comB && (i + j) % 2 === 1 ? 'B' : 'A' })),
      skipDuplicates: true,
    })
  }
  await prisma.emailCampanha.update({ where: { id: campanhaId }, data: { status: 'enviando', html, total: destinatarios.length, iniciadaEm: new Date() } })
  return { ok: true, total: destinatarios.length }
}

const LOTE = Number(process.env.EMAIL_CAMPANHA_LOTE ?? 20)
const PAUSA_MS = Number(process.env.EMAIL_CAMPANHA_PAUSA_MS ?? 700)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Envia um lote da campanha. Devolve quantos saíram. */
async function enviarLote(campanhaId: number): Promise<number> {
  const c = await prisma.emailCampanha.findUnique({ where: { id: campanhaId } })
  if (!c || c.status !== 'enviando' || !c.html) return 0
  const pendentes = await prisma.emailCampanhaEnvio.findMany({ where: { campanhaId, status: 'pendente' }, orderBy: { id: 'asc' }, take: LOTE })
  if (!pendentes.length) {
    await prisma.emailCampanha.update({ where: { id: campanhaId }, data: { status: 'concluida', concluidaEm: new Date() } })
    return 0
  }
  const cfg = await getEmailConfig()
  const from = getFromAddress(cfg)
  let enviados = 0
  for (const e of pendentes) {
    // Pausa/cancelamento no meio do lote: para na hora.
    const atual = await prisma.emailCampanha.findUnique({ where: { id: campanhaId }, select: { status: true } })
    if (atual?.status !== 'enviando') break
    const lead = await prisma.lead.findUnique({ where: { id: e.leadId } })
    if (!lead) { await marcar(e.id, 'ignorado', 'lead excluído'); continue }
    if (optouEmail(lead.optOutChannels)) { await marcar(e.id, 'ignorado', 'descadastrado'); continue }
    const bloqueio = await motivoDeBloqueio(e.email, true)
    if (bloqueio) { await marcar(e.id, 'ignorado', bloqueio); continue }
    const vars = buildLeadVars(lead)
    const assunto = replaceVariables(e.variante === 'B' && c.assuntoB ? c.assuntoB : c.assunto, vars)
    try {
      const corpo = await appendPreferencesLink(replaceVariables(c.html, vars), lead.id, 'html')
      const id = await sendEmailGeneric({ from, to: e.email, subject: assunto, html: corpo, leadId: lead.id, origem: 'campanha', origemId: campanhaId })
      await prisma.emailCampanhaEnvio.update({ where: { id: e.id }, data: { status: id ? 'enviado' : 'falhou', externalId: id, enviadoEm: new Date(), motivo: id ? null : 'envio de e-mail não configurado', tentativas: { increment: 1 } } })
      if (id) enviados++
    } catch (err) {
      const msg = (err as Error).message || String(err)
      // Limite de requisições da Resend: devolve para a fila e para o lote.
      if (/rate.?limit|too many|429/i.test(msg)) {
        await prisma.emailCampanhaEnvio.update({ where: { id: e.id }, data: { tentativas: { increment: 1 } } })
        break
      }
      const tentativas = e.tentativas + 1
      await prisma.emailCampanhaEnvio.update({ where: { id: e.id }, data: { tentativas, ...(tentativas >= 3 ? { status: 'falhou', motivo: msg.slice(0, 300) } : {}) } })
    }
    await espera(PAUSA_MS)
  }
  return enviados
}

const marcar = (id: number, status: string, motivo: string) =>
  prisma.emailCampanhaEnvio.update({ where: { id }, data: { status, motivo: motivo.slice(0, 300) } })

let rodando = false

/** Um tique: inicia as agendadas que venceram e manda um lote de cada campanha em envio. */
export async function tique(): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    const vencidas = await prisma.emailCampanha.findMany({ where: { status: 'agendada', agendadaPara: { lte: new Date() } }, select: { id: true, nome: true } })
    for (const v of vencidas) {
      const r = await iniciarEnvio(v.id)
      if (!r.ok) {
        console.warn(`[emailCampanhas] "${v.nome}" não começou: ${r.erro}`)
        await prisma.emailCampanha.update({ where: { id: v.id }, data: { status: 'pausada' } })
      }
    }
    const ativas = await prisma.emailCampanha.findMany({ where: { status: 'enviando' }, select: { id: true }, orderBy: { iniciadaEm: 'asc' } })
    for (const a of ativas) await enviarLote(a.id)
  } catch (e) {
    console.error('[emailCampanhas] tique falhou:', (e as Error).message)
  } finally {
    rodando = false
  }
}

export function startEmailCampanhas(): void {
  const s = Number(process.env.EMAIL_CAMPANHA_TIQUE_S ?? 20)
  setTimeout(() => { void tique(); setInterval(() => void tique(), s * 1000) }, 30_000)
  console.log(`[emailCampanhas] agendador a cada ${s}s (lote ${LOTE}, pausa ${PAUSA_MS}ms)`)
}

/** Valores de exemplo das variáveis — envio de teste. */
export const VARS_EXEMPLO = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.example]))

/**
 * Números da campanha: andamento (pendente/enviado/falhou/ignorado, por
 * variante) e acompanhamento da Resend (entregue, aberto, clicado, bounce,
 * spam) pelo OutboundSend com source=campanha.
 */
export async function numeros(campanhaId: number) {
  const porStatus = await prisma.emailCampanhaEnvio.groupBy({ by: ['status', 'variante'], where: { campanhaId }, _count: { _all: true } })
  const env = await prisma.outboundSend.findMany({
    where: { channel: 'email', source: 'campanha', sourceId: campanhaId },
    select: { externalId: true, status: true, deliveredAt: true, openedAt: true, clickedAt: true, complainedAt: true },
  })
  const variantePorId = new Map((await prisma.emailCampanhaEnvio.findMany({ where: { campanhaId, externalId: { not: null } }, select: { externalId: true, variante: true } })).map((e) => [e.externalId, e.variante]))
  const vazio = () => ({ enviados: 0, entregues: 0, abertos: 0, clicados: 0, bounces: 0, spam: 0 })
  const metricas = { total: vazio(), A: vazio(), B: vazio() } as Record<'total' | 'A' | 'B', ReturnType<typeof vazio>>
  for (const o of env) {
    const alvos = [metricas.total, metricas[(variantePorId.get(o.externalId) as 'A' | 'B') ?? 'A']]
    for (const m of alvos) {
      if (o.status === 'failed') continue
      m.enviados++
      if (o.deliveredAt || ['delivered', 'opened', 'clicked'].includes(o.status)) m.entregues++
      if (o.openedAt) m.abertos++
      if (o.clickedAt) m.clicados++
      if (o.status === 'bounced') m.bounces++
      if (o.complainedAt) m.spam++
    }
  }
  const andamento: Record<string, number> = { pendente: 0, enviado: 0, falhou: 0, ignorado: 0 }
  for (const g of porStatus) andamento[g.status] = (andamento[g.status] ?? 0) + g._count._all
  const c = await prisma.emailCampanha.findUnique({ where: { id: campanhaId }, select: { iniciadaEm: true } })
  // Descadastros de quem recebeu, depois que a campanha começou.
  const descadastros = !c?.iniciadaEm ? 0 : await prisma.leadEvent.count({
    where: { type: 'email_unsubscribed', createdAt: { gte: c.iniciadaEm }, leadId: { in: (await prisma.emailCampanhaEnvio.findMany({ where: { campanhaId, status: 'enviado' }, select: { leadId: true } })).map((e) => e.leadId) } },
  })
  return { andamento, metricas, descadastros }
}
