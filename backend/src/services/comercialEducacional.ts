// src/services/comercialEducacional.ts
//
// Fase 3 da integração Negociações/Metas/Comissões × Educacional (22/10/2026):
// o painel comercial DENTRO do Educacional. Lê as mesmas propostas e comissões
// dos módulos gerais — só que as ligadas a inscrições (Negotiation.registrationId),
// recortadas por portal, curso, polo e vendedor.
//
// Venda = proposta ganha com fechamento no período (mês em Brasília, como a
// comissão). Metas por agente são as de Metas & Comissões; a meta do PORTAL fica
// em Setting `comercial.metas` = { "<portalId>": { "AAAA-MM": { valor, quantidade } } }.

import { prisma } from '../lib/prisma.js'
import { janelaDeFechamento, monthRange, parseCompetencia, metaDoAgente } from './commissions.js'

export interface FiltroComercial {
  mes: string // AAAA-MM
  portalId?: number | null
  courseId?: number | null
  campusId?: number | null
  vendedorId?: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const dec = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0 }

/** Polo da inscrição: o local escolhido; sem escolha, o único local do portal. */
function campusDaInscricao(reg: { formData: unknown; portal: { allowedCampusIds: unknown } | null }): number | null {
  const escolhido = Number((reg.formData as any)?.campusId)
  if (Number.isInteger(escolhido) && escolhido > 0) return escolhido
  const doPortal = Array.isArray(reg.portal?.allowedCampusIds) ? (reg.portal!.allowedCampusIds as unknown[]).map(Number).filter(Boolean) : []
  return doPortal.length === 1 ? doPortal[0]! : null
}

export async function painelComercial(f: FiltroComercial) {
  const competencia = parseCompetencia(f.mes) ?? parseCompetencia(new Date().toISOString())!
  const { start, end } = monthRange(competencia)
  const janela = janelaDeFechamento(start, end)

  // Inscrições do recorte (portal/curso/polo/vendedor).
  const regs = await prisma.enrollmentRegistration.findMany({
    where: {
      mergedIntoId: null,
      ...(f.portalId ? { portalId: f.portalId } : {}),
      ...(f.courseId ? { processRegistration: { offering: { courseId: f.courseId } } } : {}),
    },
    select: {
      id: true, candidateCode: true, portalId: true, vendedorUserId: true, formData: true, paymentStatus: true,
      portal: { select: { nome: true, allowedCampusIds: true } },
      lead: { select: { id: true, nome: true, assignedUserId: true } },
      processRegistration: { select: { offering: { select: { courseId: true, course: { select: { nome: true } } } } } },
    },
  })
  const regInfo = new Map(regs.map((r) => [r.id, { ...r, campusId: campusDaInscricao(r) }]))
  const regIds = [...regInfo.values()].filter((r) => (!f.campusId || r.campusId === f.campusId)).map((r) => r.id)

  const props = regIds.length ? await prisma.negotiation.findMany({
    where: { registrationId: { in: regIds }, ...(f.vendedorId ? { responsavelUserId: f.vendedorId } : {}) },
    select: { id: true, registrationId: true, titulo: true, resultado: true, valorFinal: true, fechadaEm: true, responsavelUserId: true, createdAt: true, origem: true },
  }) : []
  const noPeriodo = (d: Date | null) => !!d && d >= janela.gte && d <= janela.lte
  const vendas = props.filter((p) => p.resultado === 'won' && noPeriodo(p.fechadaEm))
  const perdidas = props.filter((p) => p.resultado === 'lost' && noPeriodo(p.fechadaEm))
  const abertas = props.filter((p) => !p.resultado)

  const comissoes = vendas.length ? await prisma.commissionEntry.findMany({ where: { negotiationId: { in: vendas.map((v) => v.id) } }, select: { negotiationId: true, valorTotal: true, status: true } }) : []
  const comPorNeg = new Map(comissoes.map((c) => [c.negotiationId, c]))

  const somar = <K extends string | number>(lista: typeof vendas, chave: (p: (typeof vendas)[number]) => K | null) => {
    const m = new Map<K, { quantidade: number; valor: number }>()
    for (const p of lista) {
      const k = chave(p); if (k == null) continue
      const a = m.get(k) ?? { quantidade: 0, valor: 0 }
      a.quantidade++; a.valor += dec(p.valorFinal); m.set(k, a)
    }
    return m
  }

  // Nomes
  const userIds = [...new Set(props.map((p) => p.responsavelUserId).filter((x): x is number => !!x))]
  const campusIds = [...new Set([...regInfo.values()].map((r) => r.campusId).filter((x): x is number => !!x))]
  const [users, campi] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    campusIds.length ? prisma.campus.findMany({ where: { id: { in: campusIds } }, select: { id: true, nome: true } }) : [],
  ])
  const nomeUser = new Map(users.map((u) => [u.id, u.name]))
  const nomeCampus = new Map(campi.map((c) => [c.id, c.nome]))

  const porVendedorMap = somar(vendas, (p) => p.responsavelUserId ?? 0)
  const porVendedor = [] as Array<{ userId: number | null; nome: string; quantidade: number; valor: number; comissao: number; meta: { valor: number | null; quantidade: number | null }; atingimento: number | null }>
  for (const [uid, v] of porVendedorMap) {
    const metaValor = uid ? await metaDoAgente(uid, null, 'revenue', start, end).catch(() => null) : null
    const metaQtd = uid ? await metaDoAgente(uid, null, 'count', start, end).catch(() => null) : null
    const com = vendas.filter((p) => (p.responsavelUserId ?? 0) === uid).reduce((s, p) => s + dec(comPorNeg.get(p.id)?.valorTotal), 0)
    porVendedor.push({
      userId: uid || null, nome: uid ? nomeUser.get(uid) ?? `#${uid}` : 'Sem vendedor',
      quantidade: v.quantidade, valor: r2(v.valor), comissao: r2(com),
      meta: { valor: metaValor?.target ?? null, quantidade: metaQtd?.target ?? null },
      atingimento: metaValor?.target ? Math.round((v.valor / metaValor.target) * 1000) / 10 : null,
    })
  }
  porVendedor.sort((a, b) => b.valor - a.valor)

  const lista = (m: Map<any, { quantidade: number; valor: number }>, nome: (k: any) => string) =>
    [...m.entries()].map(([k, v]) => ({ id: k, nome: nome(k), quantidade: v.quantidade, valor: r2(v.valor) })).sort((a, b) => b.valor - a.valor)
  const porCurso = lista(somar(vendas, (p) => regInfo.get(p.registrationId!)?.processRegistration?.offering?.course?.nome ?? 'Sem curso'), (k) => k)
  const porPortal = lista(somar(vendas, (p) => regInfo.get(p.registrationId!)?.portalId ?? null), (k) => regs.find((r) => r.portalId === k)?.portal?.nome ?? `Portal ${k}`)
  const porPolo = lista(somar(vendas, (p) => regInfo.get(p.registrationId!)?.campusId ?? 0), (k) => (k ? nomeCampus.get(k) ?? `Local ${k}` : 'Sem polo definido'))

  const valorVendas = vendas.reduce((s, p) => s + dec(p.valorFinal), 0)
  const metaPortal = f.portalId ? await metaDoPortal(f.portalId, f.mes) : null
  return {
    mes: competencia.toISOString().slice(0, 7),
    kpis: {
      vendas: vendas.length, valorVendas: r2(valorVendas), ticket: vendas.length ? r2(valorVendas / vendas.length) : 0,
      abertas: abertas.length, valorAberto: r2(abertas.reduce((s, p) => s + dec(p.valorFinal), 0)),
      perdidas: perdidas.length,
      conversao: vendas.length + perdidas.length ? Math.round((vendas.length / (vendas.length + perdidas.length)) * 1000) / 10 : null,
      comissao: r2(comissoes.reduce((s, c) => s + dec(c.valorTotal), 0)),
      inscricoes: regIds.length, inscricoesComProposta: new Set(props.map((p) => p.registrationId)).size,
    },
    metaPortal: metaPortal ? {
      ...metaPortal,
      atingimentoValor: metaPortal.valor ? Math.round((valorVendas / metaPortal.valor) * 1000) / 10 : null,
      atingimentoQuantidade: metaPortal.quantidade ? Math.round((vendas.length / metaPortal.quantidade) * 1000) / 10 : null,
    } : null,
    porVendedor, porCurso, porPortal, porPolo,
    vendasDoMes: vendas
      .sort((a, b) => (b.fechadaEm?.getTime() ?? 0) - (a.fechadaEm?.getTime() ?? 0))
      .slice(0, 200)
      .map((p) => {
        const r = regInfo.get(p.registrationId!)
        return {
          negotiationId: p.id, leadId: r?.lead?.id ?? null, nome: r?.lead?.nome ?? '', codigo: r?.candidateCode ?? '',
          curso: r?.processRegistration?.offering?.course?.nome ?? '', portal: r?.portal?.nome ?? '',
          polo: r?.campusId ? nomeCampus.get(r.campusId) ?? null : null,
          vendedor: p.responsavelUserId ? nomeUser.get(p.responsavelUserId) ?? null : null,
          valor: r2(dec(p.valorFinal)), fechadaEm: p.fechadaEm, comissao: comPorNeg.get(p.id) ? r2(dec(comPorNeg.get(p.id)!.valorTotal)) : null,
          comissaoStatus: comPorNeg.get(p.id)?.status ?? null,
        }
      }),
  }
}

// ── Meta do portal (por mês) ────────────────────────────────────────────────

const CHAVE_METAS = 'comercial.metas'
async function lerMetas(): Promise<Record<string, Record<string, { valor: number | null; quantidade: number | null }>>> {
  const s = await prisma.setting.findUnique({ where: { key: CHAVE_METAS }, select: { value: true } }).catch(() => null)
  let v: any = s?.value ?? {}
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
  return v && typeof v === 'object' ? v : {}
}
export async function metaDoPortal(portalId: number, mes: string): Promise<{ valor: number | null; quantidade: number | null } | null> {
  const m = (await lerMetas())[String(portalId)]?.[mes.slice(0, 7)]
  return m ? { valor: m.valor ?? null, quantidade: m.quantidade ?? null } : null
}
export async function salvarMetaDoPortal(portalId: number, mes: string, meta: { valor?: unknown; quantidade?: unknown }) {
  const todas = await lerMetas()
  const num = (v: unknown) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n <= 0 ? null : r2(n) }
  const chave = String(portalId), m = mes.slice(0, 7)
  todas[chave] = { ...(todas[chave] ?? {}), [m]: { valor: num(meta.valor), quantidade: num(meta.quantidade) } }
  await prisma.setting.upsert({
    where: { key: CHAVE_METAS },
    create: { key: CHAVE_METAS, value: todas as any, label: 'Comercial: metas por portal e mês', grp: 'educacional', fieldType: 'json' } as any,
    update: { value: todas as any },
  })
  return todas[chave]![m]
}

/** Proposta e comissão de UMA inscrição (card no detalhe da inscrição). */
export async function comercialDaInscricao(registrationId: number) {
  const reg = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { vendedorUserId: true } })
  const p = await prisma.negotiation.findFirst({
    where: { registrationId }, orderBy: { id: 'asc' },
    select: { id: true, leadId: true, titulo: true, status: true, resultado: true, valorFinal: true, fechadaEm: true, responsavelUserId: true, origem: true },
  })
  const ids = [reg?.vendedorUserId, p?.responsavelUserId].filter((x): x is number => !!x)
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nome = (id?: number | null) => (id ? users.find((u) => u.id === id)?.name ?? `#${id}` : null)
  const c = p ? await prisma.commissionEntry.findUnique({ where: { negotiationId: p.id }, select: { valorTotal: true, status: true, competencia: true } }) : null
  return {
    vendedor: nome(reg?.vendedorUserId),
    proposta: p ? { ...p, valorFinal: dec(p.valorFinal), responsavel: nome(p.responsavelUserId) } : null,
    comissao: c ? { valor: dec(c.valorTotal), status: c.status, competencia: c.competencia.toISOString().slice(0, 7) } : null,
  }
}
