// src/services/propostaDaInscricao.ts
//
// Fase 2 da integração Negociações/Metas/Comissões × Educacional (22/10/2026):
// a inscrição do portal vira PROPOSTA, e a proposta ganha conta em metas e
// comissões pelo motor de sempre (services/commissions.ts).
//
// Decisões do cliente (22/10):
//   - marco da venda POR PORTAL: 'pagamento' (1ª cobrança paga) ou 'jornada'
//     (todas as etapas do portal concluídas);
//   - valor = SÓ o que foi pago (entrada / curso à vista / taxa) — parcelas
//     futuras e as do SEI ficam fora;
//   - vendedor = responsável da ficha NO MOMENTO da inscrição
//     (EnrollmentRegistration.vendedorUserId, Fase 1); comissão vai à pessoa,
//     seja da sede, de polo ou de parceiro.
//
// Configuração por portal em Setting `comercial.portais` =
//   { "<portalId>": { modo: 'desligado'|'ativo', marco: 'pagamento'|'jornada' } }.
// Desligado = nada acontece. A SIMULAÇÃO (simularPortal) roda a mesma decisão
// sem gravar — é o "modo sombra" para conferir antes de ligar.
//
// Uma inscrição tem no máximo UMA proposta (Negotiation.registrationId). Se o
// lead já tem proposta MANUAL aberta do mesmo curso, ela é ADOTADA (ligada) em
// vez de criar outra. Tudo idempotente: rodar de novo não duplica nada.

import { prisma } from '../lib/prisma.js'

export type MarcoDaVenda = 'pagamento' | 'jornada'
export interface ConfigComercial { modo: 'desligado' | 'ativo'; marco: MarcoDaVenda }
const CHAVE = 'comercial.portais'
const PADRAO: ConfigComercial = { modo: 'desligado', marco: 'pagamento' }

let cache: { valor: Record<string, ConfigComercial>; ate: number } | null = null
export async function configsComerciais(): Promise<Record<string, ConfigComercial>> {
  if (cache && cache.ate > Date.now()) return cache.valor
  const s = await prisma.setting.findUnique({ where: { key: CHAVE }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  cache = { valor: v && typeof v === 'object' ? v : {}, ate: Date.now() + 30_000 }
  return cache.valor
}
export async function configDoPortal(portalId: number): Promise<ConfigComercial> {
  const c = (await configsComerciais())[String(portalId)]
  return {
    modo: c?.modo === 'ativo' ? 'ativo' : 'desligado',
    marco: c?.marco === 'jornada' ? 'jornada' : 'pagamento',
  }
}
export async function salvarConfigDoPortal(portalId: number, c: Partial<ConfigComercial>): Promise<ConfigComercial> {
  const todas = { ...(await configsComerciais()) }
  const atual = await configDoPortal(portalId)
  todas[String(portalId)] = {
    modo: c.modo === 'ativo' || c.modo === 'desligado' ? c.modo : atual.modo,
    marco: c.marco === 'jornada' || c.marco === 'pagamento' ? c.marco : atual.marco,
  }
  await prisma.setting.upsert({
    where: { key: CHAVE },
    create: { key: CHAVE, value: todas as any, label: 'Comercial: inscrição do portal → proposta (por portal)', grp: 'educacional', fieldType: 'json' } as any,
    update: { value: todas as any },
  })
  cache = null
  return todas[String(portalId)]!
}

const ABERTA_INSC = ['cancelled', 'rejected', 'merged', 'expired']

/** Situação da inscrição que decide o que fazer com a proposta. */
async function situacao(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: {
      id: true, candidateCode: true, portalId: true, leadId: true, status: true, mergedIntoId: true,
      paymentStatus: true, paymentAmount: true, paymentPaidAt: true, paymentPlan: true, vendedorUserId: true,
      portal: { select: { funnelId: true, nome: true } },
      lead: { select: { assignedUserId: true, funnelId: true } },
      processRegistration: { select: { offeringId: true, offering: { select: { courseId: true, nome: true, course: { select: { nome: true } } } } } },
    },
  })
  if (!reg || !reg.leadId) return null
  const curso = reg.processRegistration?.offering?.course?.nome || reg.processRegistration?.offering?.nome || 'Inscrição'
  const pago = reg.paymentStatus === 'paid'
  const estornado = reg.paymentStatus === 'refunded'
  const cancelada = ABERTA_INSC.includes(reg.status) || !!reg.mergedIntoId
  // Valor = o que foi pago; antes de pagar, o que está sendo cobrado agora.
  const plano: any = reg.paymentPlan || {}
  const valor = Number(reg.paymentAmount ?? plano.valorCobrado ?? 0) || 0
  return { reg, curso, pago, estornado, cancelada, valor }
}

async function jornadaConcluida(registrationId: number): Promise<boolean> {
  const { etapasDaInscricao } = await import('./portalJornada.js')
  const j = await etapasDaInscricao(registrationId, 'inscricao').catch(() => null)
  return !!j && j.etapas.length > 0 && j.etapas.every((e: any) => e.situacao === 'feito' || e.liberada)
}

export type AcaoProposta =
  | { tipo: 'nada'; motivo: string }
  | { tipo: 'criar' | 'adotar' | 'atualizar' | 'ganhar' | 'perder' | 'reabrir'; motivo: string; negotiationId?: number; valor: number; vendedorUserId: number | null; ganha?: boolean }

/** Decide (sem gravar) o que a inscrição pede da proposta. */
export async function decidir(registrationId: number, marco: MarcoDaVenda): Promise<{ acao: AcaoProposta; sit: NonNullable<Awaited<ReturnType<typeof situacao>>> | null; propostaId: number | null; adotavel: number | null }> {
  const sit = await situacao(registrationId)
  if (!sit) return { acao: { tipo: 'nada', motivo: 'inscrição sem ficha' }, sit: null, propostaId: null, adotavel: null }
  const { reg, pago, estornado, cancelada, valor } = sit
  const vendedorUserId = reg.vendedorUserId ?? reg.lead?.assignedUserId ?? null
  const propria = await prisma.negotiation.findFirst({ where: { registrationId: reg.id }, orderBy: { id: 'asc' }, select: { id: true, resultado: true, valorUnico: true } })

  // Proposta manual aberta do mesmo curso, do mesmo lead, ainda sem inscrição: adotar.
  let adotavel: number | null = null
  if (!propria) {
    const courseId = reg.processRegistration?.offering?.courseId
    const abertas = await prisma.negotiation.findMany({ where: { leadId: reg.leadId!, resultado: null, registrationId: null }, select: { id: true, items: { select: { productId: true } } } })
    if (abertas.length && courseId) {
      const prodIds = [...new Set(abertas.flatMap((a) => a.items.map((i) => i.productId)).filter((x): x is number => !!x))]
      const prods = prodIds.length ? await prisma.product.findMany({ where: { id: { in: prodIds }, courseId }, select: { id: true } }) : []
      const doCurso = abertas.filter((a) => a.items.some((i) => i.productId && prods.some((p) => p.id === i.productId)))
      if (doCurso.length === 1) adotavel = doCurso[0]!.id
    }
  }

  const venda = marco === 'jornada' ? (pago && await jornadaConcluida(reg.id)) : pago
  const desfeita = cancelada || estornado

  if (!propria && !adotavel) {
    if (desfeita) return { acao: { tipo: 'nada', motivo: cancelada ? 'inscrição cancelada, sem proposta' : 'pagamento estornado, sem proposta' }, sit, propostaId: null, adotavel }
    return { acao: { tipo: 'criar', motivo: venda ? 'nova proposta, já ganha (marco atingido)' : 'nova proposta aberta', valor, vendedorUserId, ganha: venda }, sit, propostaId: null, adotavel }
  }
  const alvoId = propria?.id ?? adotavel!
  const resultado = propria?.resultado ?? null
  if (!propria) return { acao: { tipo: 'adotar', motivo: venda ? 'ligar a proposta manual do mesmo curso e ganhar' : 'ligar a proposta manual do mesmo curso', negotiationId: alvoId, valor, vendedorUserId, ganha: venda }, sit, propostaId: null, adotavel }
  if (desfeita) {
    if (resultado === 'lost') return { acao: { tipo: 'nada', motivo: 'proposta já perdida' }, sit, propostaId: alvoId, adotavel }
    return { acao: { tipo: 'perder', motivo: cancelada ? 'inscrição cancelada' : 'pagamento estornado', negotiationId: alvoId, valor, vendedorUserId }, sit, propostaId: alvoId, adotavel }
  }
  if (resultado === 'won') {
    if (!venda) return { acao: { tipo: 'reabrir', motivo: 'o marco da venda deixou de valer', negotiationId: alvoId, valor, vendedorUserId }, sit, propostaId: alvoId, adotavel }
    return { acao: { tipo: 'nada', motivo: 'proposta já ganha' }, sit, propostaId: alvoId, adotavel }
  }
  if (resultado === 'lost') return { acao: { tipo: 'reabrir', motivo: 'inscrição voltou a valer', negotiationId: alvoId, valor, vendedorUserId }, sit, propostaId: alvoId, adotavel }
  if (venda) return { acao: { tipo: 'ganhar', motivo: marco === 'jornada' ? 'jornada concluída' : 'pagamento confirmado', negotiationId: alvoId, valor, vendedorUserId }, sit, propostaId: alvoId, adotavel }
  if (Number(propria.valorUnico ?? 0) !== valor) return { acao: { tipo: 'atualizar', motivo: 'valor mudou', negotiationId: alvoId, valor, vendedorUserId }, sit, propostaId: alvoId, adotavel }
  return { acao: { tipo: 'nada', motivo: 'proposta em dia' }, sit, propostaId: alvoId, adotavel }
}

const emAndamento = new Map<number, Promise<unknown>>()

/**
 * Aplica a decisão (portal com modo 'ativo'). Serializado por inscrição —
 * vários eventos da mesma inscrição em sequência não criam duas propostas.
 */
export function sincronizarPropostaDaInscricao(registrationId: number): Promise<AcaoProposta | null> {
  const anterior = emAndamento.get(registrationId) ?? Promise.resolve()
  const p = anterior.catch(() => null).then(() => aplicar(registrationId))
  emAndamento.set(registrationId, p)
  void p.finally(() => { if (emAndamento.get(registrationId) === p) emAndamento.delete(registrationId) })
  return p
}

async function aplicar(registrationId: number): Promise<AcaoProposta | null> {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { portalId: true } })
  if (!reg) return null
  const cfg = await configDoPortal(reg.portalId)
  if (cfg.modo !== 'ativo') return null
  const { acao, sit } = await decidir(registrationId, cfg.marco)
  if (acao.tipo === 'nada' || !sit) return acao
  const { reg: r, curso, valor } = sit
  const { onNegotiationChanged } = await import('./commissions.js')
  const { logEvent } = await import('./leadHistory.js')
  const agora = new Date()
  const quandoGanhou = cfg.marco === 'pagamento' ? (r.paymentPaidAt ?? agora) : agora
  const ganha = acao.ganha === true || acao.tipo === 'ganhar'
  const valores = { valorTabela: valor, valorFinal: valor, valorUnico: valor, valorRecorrente: 0 }
  let id = acao.negotiationId ?? null

  if (acao.tipo === 'criar') {
    const courseId = r.processRegistration?.offering?.courseId
    const produto = courseId ? await prisma.product.findFirst({ where: { courseId, active: true }, select: { id: true } }) : null
    const n = await prisma.negotiation.create({
      data: {
        leadId: r.leadId!, titulo: `Inscrição ${r.candidateCode} — ${curso}`.slice(0, 191),
        status: ganha ? 'aceita' : 'enviada', ...valores,
        responsavelUserId: acao.vendedorUserId, funnelId: r.portal?.funnelId ?? r.lead?.funnelId ?? null,
        registrationId: r.id, offeringId: r.processRegistration?.offeringId ?? null, origem: 'portal',
        observacoes: 'Gerada pela inscrição do portal (valor = o que foi pago).',
        ...(ganha ? { resultado: 'won', fechadaEm: quandoGanhou } : {}),
        items: { create: [{ productId: produto?.id ?? null, nome: curso.slice(0, 191), quantidade: 1, precoUnit: valor, subtotal: valor, cobranca: 'unico' }] },
      } as any,
    })
    id = n.id
  } else if (acao.tipo === 'adotar') {
    await prisma.negotiation.update({ where: { id: id! }, data: {
      registrationId: r.id, offeringId: r.processRegistration?.offeringId ?? null,
      ...(ganha ? { status: 'aceita', resultado: 'won', fechadaEm: quandoGanhou, ...valores } : {}),
    } as any })
  } else if (acao.tipo === 'atualizar') {
    await prisma.negotiation.update({ where: { id: id! }, data: valores as any })
  } else if (acao.tipo === 'ganhar') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'aceita', resultado: 'won', fechadaEm: quandoGanhou, ...valores } as any })
  } else if (acao.tipo === 'perder') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'recusada', resultado: 'lost', fechadaEm: agora } as any })
  } else if (acao.tipo === 'reabrir') {
    await prisma.negotiation.update({ where: { id: id! }, data: { status: 'enviada', resultado: null, fechadaEm: null, fechadaPor: null, lostReasonId: null, ...valores } as any })
  }
  if (id) await onNegotiationChanged(id).catch((e) => console.warn('[propostaDaInscricao] comissão:', e?.message || e))
  const titulos: Record<string, string> = {
    criar: ganha ? 'Proposta criada e ganha pela inscrição' : 'Proposta criada pela inscrição',
    adotar: 'Proposta ligada à inscrição', atualizar: 'Valor da proposta atualizado pela inscrição',
    ganhar: 'Proposta ganha pela inscrição', perder: 'Proposta perdida pela inscrição', reabrir: 'Proposta reaberta pela inscrição',
  }
  logEvent({ leadId: r.leadId!, type: 'negotiation_from_enrollment' as any, category: 'lifecycle', title: `${titulos[acao.tipo]} ${r.candidateCode}`, description: acao.motivo, actorType: 'system', metadata: { negotiationId: id, registrationId: r.id, acao: acao.tipo, valor } } as any)
  return acao
}

/** Simulação de um portal: o que cada inscrição faria com a proposta, sem gravar. */
export async function simularPortal(portalId: number, marco?: MarcoDaVenda) {
  const cfg = await configDoPortal(portalId)
  const m = marco ?? cfg.marco
  const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId, mergedIntoId: null, leadId: { not: null } }, orderBy: { id: 'desc' }, take: 1000, select: { id: true } })
  const linhas: Array<{ registrationId: number; codigo: string; curso: string; acao: string; motivo: string; valor: number; vendedorUserId: number | null; ganha: boolean }> = []
  for (const r of regs) {
    const { acao, sit } = await decidir(r.id, m)
    if (!sit) continue
    linhas.push({ registrationId: r.id, codigo: sit.reg.candidateCode, curso: sit.curso, acao: acao.tipo, motivo: acao.motivo, valor: 'valor' in acao ? acao.valor : 0, vendedorUserId: 'vendedorUserId' in acao ? acao.vendedorUserId : null, ganha: acao.tipo === 'ganhar' || ('ganha' in acao && acao.ganha === true) })
  }
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.vendedorUserId).filter((x): x is number => !!x))] } }, select: { id: true, name: true } })
  const nome = new Map(users.map((u) => [u.id, u.name]))
  const resumo: Record<string, number> = {}
  for (const l of linhas) resumo[l.acao] = (resumo[l.acao] ?? 0) + 1
  const vendas = linhas.filter((l) => l.ganha)
  return {
    marco: m, total: linhas.length, resumo,
    vendas: { quantidade: vendas.length, valor: Math.round(vendas.reduce((s, l) => s + l.valor, 0) * 100) / 100 },
    linhas: linhas.map((l) => ({ ...l, vendedor: l.vendedorUserId ? nome.get(l.vendedorUserId) ?? `#${l.vendedorUserId}` : null })),
  }
}

/** Ao ligar o portal: aplica a todas as inscrições existentes (mesma decisão da simulação). */
export async function aplicarPortal(portalId: number): Promise<Record<string, number>> {
  const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId, mergedIntoId: null, leadId: { not: null } }, select: { id: true } })
  const cont: Record<string, number> = {}
  for (const r of regs) {
    const a = await sincronizarPropostaDaInscricao(r.id).catch(() => null)
    if (a) cont[a.tipo] = (cont[a.tipo] ?? 0) + 1
  }
  return cont
}

/**
 * Escuta os eventos da inscrição (pagamento, documentos, contrato, cancelamento…)
 * e, a cada 10 min, revisa as inscrições mexidas nas últimas 48 h — rede de
 * segurança para o que não emite evento (estorno, baixa manual, expiração).
 */
let ligado = false
export function ligarPropostaDaInscricao(): void {
  if (ligado) return
  ligado = true
  import('../lib/eventBus.js').then(({ eventBus }) => {
    eventBus.on('*', async (event: any) => {
      if (typeof event?.type !== 'string' || !event.type.startsWith('enrollment.')) return
      const id = Number(event.payload?.enrollmentId ?? event.payload?.registrationId)
      if (Number.isInteger(id) && id > 0) await sincronizarPropostaDaInscricao(id).catch(() => null)
    })
  }).catch(() => {})
  setInterval(async () => {
    const ativos = Object.entries(await configsComerciais()).filter(([, c]) => c?.modo === 'ativo').map(([k]) => Number(k))
    if (!ativos.length) return
    const regs = await prisma.enrollmentRegistration.findMany({ where: { portalId: { in: ativos }, updatedAt: { gte: new Date(Date.now() - 48 * 3600_000) } }, select: { id: true }, take: 2000 }).catch(() => [])
    for (const r of regs) await sincronizarPropostaDaInscricao(r.id).catch(() => null)
  }, 10 * 60_000).unref()
}
