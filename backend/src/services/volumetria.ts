// src/services/volumetria.ts
//
// Volumetria do mês (competência AAAA-MM, horário de Brasília): quanto cada
// canal e integração movimentou e, onde existe, o custo real. Só leitura —
// junta o registro de consumo (lib/consumo.ts, IA) com as tabelas que já
// guardam cada canal (mensagens, Cloud API, filas, VoIP, assinaturas...).
//
// Custo real × repasse: aqui é só o custo real. O preço cobrado do cliente é
// definido na loja central.

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { prisma } from '../lib/prisma.js'
import { UPLOADS_DIR } from '../lib/uploadsDir.js'
import { getPricingTable, estimateCost } from './cloudApiBilling.js'

const exec = promisify(execFile)

export function periodoDaCompetencia(competencia: string): { inicio: Date; fim: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia)
  if (!m) throw new Error('Competência inválida (use AAAA-MM).')
  const ano = Number(m[1]); const mes = Number(m[2])
  const inicio = new Date(`${m[1]}-${m[2]}-01T00:00:00-03:00`)
  const prox = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, '0')}`
  return { inicio, fim: new Date(`${prox}-01T00:00:00-03:00`) }
}

export function competenciaAtual(): string {
  const d = new Date(Date.now() - 3 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const num = (v: unknown) => Number(v ?? 0) || 0

/** Tamanho da pasta de uploads em bytes (foto do momento, não do mês). */
async function bytesDosUploads(): Promise<number | null> {
  try {
    const { stdout } = await exec('du', ['-sb', UPLOADS_DIR], { timeout: 20_000 })
    return Number(stdout.split(/\s/)[0]) || 0
  } catch { return null }
}

type LinhaMidia = { provider: string; mediaType: string; mediaUrl: string }
type SomaMidia = { quantidade: number; bytes: number; externas: number; porTipo: Map<string, { quantidade: number; bytes: number }> }

/**
 * Tamanho de cada mídia no disco. Arquivo em /uploads é medido; link externo
 * (mídia que ficou no provedor) conta como "externa", sem bytes nossos.
 * Mesmo arquivo em duas mensagens conta uma vez por canal.
 */
async function somarMidias(linhas: LinhaMidia[]): Promise<Map<string, SomaMidia>> {
  const porCanal = new Map<string, SomaMidia>()
  const vistos = new Set<string>()
  const pendentes: Array<{ canal: string; tipo: string; url: string }> = []
  for (const l of linhas) {
    const chave = `${l.provider}|${l.mediaUrl}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    pendentes.push({ canal: l.provider, tipo: l.mediaType, url: l.mediaUrl })
  }
  for (let i = 0; i < pendentes.length; i += 200) {
    await Promise.all(pendentes.slice(i, i + 200).map(async (m) => {
      const c = porCanal.get(m.canal) ?? { quantidade: 0, bytes: 0, externas: 0, porTipo: new Map() }
      porCanal.set(m.canal, c)
      const t = c.porTipo.get(m.tipo) ?? { quantidade: 0, bytes: 0 }
      c.porTipo.set(m.tipo, t)
      c.quantidade++; t.quantidade++
      if (!m.url.startsWith('/uploads/')) { c.externas++; return }
      const caminho = join(UPLOADS_DIR, decodeURIComponent(m.url.slice('/uploads/'.length).split('?')[0]))
      if (!caminho.startsWith(UPLOADS_DIR)) return
      const b = await stat(caminho).then((x) => x.size).catch(() => 0)
      c.bytes += b; t.bytes += b
    }))
  }
  return porCanal
}

const listarMidias = (m: Map<string, SomaMidia>) => [...m.entries()].map(([canal, x]) => ({
  canal, quantidade: x.quantidade, bytes: x.bytes, externas: x.externas,
  porTipo: [...x.porTipo.entries()].map(([tipo, t]) => ({ tipo, ...t })).sort((a, b) => b.bytes - a.bytes),
})).sort((a, b) => b.bytes - a.bytes)

/** O acumulado varre todas as mídias da base — guardado por 10 min. */
let acumuladoCache: { em: number; valor: ReturnType<typeof listarMidias> } | null = null
async function midiasAcumuladas() {
  if (acumuladoCache && Date.now() - acumuladoCache.em < 10 * 60_000) return acumuladoCache.valor
  const linhas: LinhaMidia[] = await prisma.$queryRaw`
    SELECT provider, mediaType, mediaUrl FROM bychat_messages
    WHERE mediaUrl IS NOT NULL AND mediaType <> 'text' AND mediaUrl NOT LIKE 'data:%'`
  const valor = listarMidias(await somarMidias(linhas))
  acumuladoCache = { em: Date.now(), valor }
  return valor
}

export async function volumetriaDoMes(competencia: string) {
  const { inicio, fim } = periodoDaCompetencia(competencia)
  const noMes = { gte: inicio, lt: fim }

  // ── IA (registro de consumo) ──
  const iaModelos = await prisma.consumoEvento.groupBy({
    by: ['provedor', 'item'], where: { fonte: 'ia', createdAt: noMes },
    _count: { _all: true }, _sum: { entrada: true, saida: true, cacheEscrita: true, cacheLeitura: true, custoUsd: true },
  })
  const semPreco = await prisma.consumoEvento.groupBy({
    by: ['item'], where: { fonte: 'ia', createdAt: noMes, custoUsd: null }, _count: { _all: true },
  })
  const semPrecoSet = new Set(semPreco.map((s) => s.item))
  const iaFunc = await prisma.consumoEvento.groupBy({
    by: ['funcionalidade'], where: { fonte: 'ia', createdAt: noMes },
    _count: { _all: true }, _sum: { quantidade: true, custoUsd: true },
  })
  const iaDia: any[] = await prisma.$queryRaw`
    SELECT DATE(CONVERT_TZ(createdAt, '+00:00', '-03:00')) dia, COUNT(*) chamadas, COALESCE(SUM(custoUsd), 0) custo
    FROM bychat_consumo WHERE fonte = 'ia' AND createdAt >= ${inicio} AND createdAt < ${fim}
    GROUP BY dia ORDER BY dia`
  const primeiro = await prisma.consumoEvento.findFirst({ where: { fonte: 'ia' }, orderBy: { id: 'asc' }, select: { createdAt: true } })
  const ia = {
    medindoDesde: primeiro?.createdAt ?? null,
    chamadas: iaModelos.reduce((s, x) => s + x._count._all, 0),
    custoUsd: iaModelos.reduce((s, x) => s + num(x._sum.custoUsd), 0),
    porModelo: iaModelos.map((x) => ({
      provedor: x.provedor, modelo: x.item, chamadas: x._count._all,
      entrada: num(x._sum.entrada), saida: num(x._sum.saida), cacheEscrita: num(x._sum.cacheEscrita), cacheLeitura: num(x._sum.cacheLeitura),
      custoUsd: num(x._sum.custoUsd), semPreco: semPrecoSet.has(x.item),
    })).sort((a, b) => b.custoUsd - a.custoUsd),
    porFuncionalidade: iaFunc.map((x) => ({ funcionalidade: x.funcionalidade, chamadas: x._count._all, tokens: num(x._sum.quantidade), custoUsd: num(x._sum.custoUsd) }))
      .sort((a, b) => b.custoUsd - a.custoUsd),
    porDia: iaDia.map((d) => ({ dia: String(d.dia instanceof Date ? d.dia.toISOString().slice(0, 10) : d.dia), chamadas: num(d.chamadas), custoUsd: num(d.custo) })),
  }

  // ── Mensagens por canal (tabela de mensagens; sem notas internas) ──
  const porCanal: any[] = await prisma.$queryRaw`
    SELECT provider, fromMe, COUNT(*) n FROM bychat_messages
    WHERE isInternal = 0 AND timestamp >= ${inicio} AND timestamp < ${fim}
    GROUP BY provider, fromMe`
  const unicosCanal: any[] = await prisma.$queryRaw`
    SELECT provider, COUNT(DISTINCT leadId) n FROM bychat_messages
    WHERE isInternal = 0 AND timestamp >= ${inicio} AND timestamp < ${fim}
    GROUP BY provider`
  const unicosTotal: any[] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT leadId) n FROM bychat_messages
    WHERE isInternal = 0 AND timestamp >= ${inicio} AND timestamp < ${fim}`
  const canal = (p: string) => ({
    enviadas: num(porCanal.find((x) => x.provider === p && num(x.fromMe) === 1)?.n),
    recebidas: num(porCanal.find((x) => x.provider === p && num(x.fromMe) === 0)?.n),
    leadsUnicos: num(unicosCanal.find((x) => x.provider === p)?.n),
  })

  // ── WhatsApp Evolution: por número ──
  const evoNum: any[] = await prisma.$queryRaw`
    SELECT COALESCE(evolutionInstance, '(sem número)') inst, SUM(fromMe = 1) env, SUM(fromMe = 0) rec, COUNT(DISTINCT leadId) leads
    FROM bychat_messages WHERE provider = 'evolution' AND isInternal = 0 AND timestamp >= ${inicio} AND timestamp < ${fim}
    GROUP BY inst ORDER BY COUNT(*) DESC`
  const evolution = {
    ...canal('evolution'),
    porNumero: evoNum.map((x) => ({ numero: String(x.inst), enviadas: num(x.env), recebidas: num(x.rec), leadsUnicos: num(x.leads) })),
    custo: 'infraestrutura nossa (sem custo por mensagem)',
  }

  // ── WhatsApp Cloud API: a Meta cobra o cliente direto ──
  const tabelaMeta = await getPricingTable()
  const cloudCat = await prisma.cloudApiMessageLog.groupBy({
    by: ['category', 'billable'], where: { direction: { not: 'inbound' }, createdAt: noMes }, _count: { _all: true },
  })
  const cats = new Map<string, { categoria: string; enviadas: number; cobraveis: number; custoEstimadoUsd: number }>()
  for (const c of cloudCat) {
    const k = c.category ?? 'sem_categoria'
    const it = cats.get(k) ?? { categoria: k, enviadas: 0, cobraveis: 0, custoEstimadoUsd: 0 }
    it.enviadas += c._count._all
    if (c.billable) { it.cobraveis += c._count._all; it.custoEstimadoUsd += c._count._all * estimateCost(c.category, true, tabelaMeta) }
    cats.set(k, it)
  }
  const conexoes = await prisma.cloudApiConnection.findMany({ select: { id: true, displayPhone: true, displayName: true } })
  const cloudNum: any[] = await prisma.$queryRaw`
    SELECT cloudApiConnectionId cid, SUM(fromMe = 1) env, SUM(fromMe = 0) rec, COUNT(DISTINCT leadId) leads
    FROM bychat_messages WHERE provider = 'cloud_api' AND isInternal = 0 AND timestamp >= ${inicio} AND timestamp < ${fim}
    GROUP BY cid ORDER BY COUNT(*) DESC`
  const porCategoria = [...cats.values()].sort((a, b) => b.enviadas - a.enviadas)
  const whatsappCloud = {
    ...canal('cloud_api'),
    pagoPor: 'cliente' as const,
    custoEstimadoUsd: porCategoria.reduce((s, c) => s + c.custoEstimadoUsd, 0),
    porCategoria,
    porNumero: cloudNum.map((x) => {
      const c = conexoes.find((k) => k.id === num(x.cid))
      return { numero: c ? (c.displayName || c.displayPhone || `#${c.id}`) : '(sem número)', enviadas: num(x.env), recebidas: num(x.rec), leadsUnicos: num(x.leads) }
    }),
  }

  // ── SMS e e-mail ──
  const filas = await prisma.outboundSend.groupBy({ by: ['channel', 'status'], where: { createdAt: noMes, channel: { in: ['sms', 'email'] } }, _count: { _all: true } })
  const fila = (ch: string, ok: boolean) => filas.filter((f) => f.channel === ch && (ok ? !['failed', 'error'].includes(f.status) : ['failed', 'error'].includes(f.status))).reduce((s, f) => s + f._count._all, 0)
  const ativ = await prisma.activity.groupBy({ by: ['type', 'direction'], where: { type: { in: ['sms', 'email'] }, createdAt: noMes }, _count: { _all: true } })
  const at = (t: string, d?: string) => ativ.filter((a) => a.type === t && (d === undefined || a.direction === d)).reduce((s, a) => s + a._count._all, 0)
  const sms = { pelaFila: fila('sms', true), falhas: fila('sms', false), porAtividade: at('sms') }
  const email = { pelaFila: fila('email', true), falhas: fila('email', false), atividadesEnviadas: at('email', 'outbound'), atividadesRecebidas: at('email', 'inbound') }

  // ── Voz ──
  const voz = (await prisma.voipCall.groupBy({ by: ['provider', 'direction'], where: { startedAt: noMes }, _count: { _all: true }, _sum: { durationSec: true } }))
    .map((v) => ({ provedor: v.provider, direcao: v.direction, chamadas: v._count._all, minutos: Math.round(num(v._sum.durationSec) / 6) / 10 }))

  // ── Assinatura eletrônica, reuniões, SEI ──
  const assinaturas = (await prisma.acaAssinatura.groupBy({ by: ['provider'], where: { createdAt: noMes }, _count: { _all: true } }))
    .map((a) => ({ provedor: a.provider, envelopes: a._count._all }))
  const reunioes = await prisma.meetingRecording.count({ where: { createdAt: noMes } })
  const seiTotal = await prisma.seiChamada.count({ where: { createdAt: noMes } })
  const seiFalhas = await prisma.seiChamada.count({ where: { createdAt: noMes, ok: false } })

  // ── Base ──
  const usuariosAtivos = await prisma.user.count({ where: { active: true } })
  const leadsNovos = await prisma.lead.count({ where: { createdAt: noMes } })
  const leadsTotal = await prisma.lead.count()

  // ── Mídias das conversas por canal: as do mês e o acumulado guardado ──
  const midiasMes: LinhaMidia[] = await prisma.$queryRaw`
    SELECT provider, mediaType, mediaUrl FROM bychat_messages
    WHERE mediaUrl IS NOT NULL AND mediaType <> 'text' AND mediaUrl NOT LIKE 'data:%'
      AND timestamp >= ${inicio} AND timestamp < ${fim}`

  return {
    competencia, periodo: { inicio, fim },
    ia,
    whatsappCloud,
    evolution,
    outrosCanais: ['instagram', 'messenger', 'telegram', 'portal_chat'].map((p) => ({ canal: p, ...canal(p) })),
    sms, email, voz, assinaturas,
    reunioes: { gravacoes: reunioes },
    sei: { chamadas: seiTotal, falhas: seiFalhas },
    armazenamento: { bytes: await bytesDosUploads() },
    midias: { doMes: listarMidias(await somarMidias(midiasMes)), acumulado: await midiasAcumuladas() },
    leads: {
      total: leadsTotal, novos: leadsNovos, unicos: num(unicosTotal[0]?.n),
      unicosPorCanal: unicosCanal.map((x) => ({ canal: String(x.provider), leads: num(x.n) })).sort((a, b) => b.leads - a.leads),
    },
    base: { usuariosAtivos, leadsNovos, leadsTotal },
  }
}
