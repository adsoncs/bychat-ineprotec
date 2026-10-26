// src/services/emailRelatorio.ts — relatório de e-mail por período (Fase 4).
//
// Tudo sai do OutboundSend (canal email): é onde cada envio é registrado
// (services/notify.ts) e onde a Resend devolve entregue/aberto/clicado/bounce/
// spam (services/emailEventos.ts). Campanha e modelo vêm de source=campanha.

import { prisma } from '../lib/prisma.js'

export interface Metricas { enviados: number; falhas: number; entregues: number; abertos: number; clicados: number; bounces: number; spam: number }
const vazio = (): Metricas => ({ enviados: 0, falhas: 0, entregues: 0, abertos: 0, clicados: 0, bounces: 0, spam: 0 })

type Linha = { source: string | null; sourceId: number | null; status: string; createdAt: Date; deliveredAt: Date | null; openedAt: Date | null; clickedAt: Date | null; complainedAt: Date | null }

function somar(m: Metricas, o: Linha) {
  if (o.status === 'failed' || o.status === 'error') { m.falhas++; return }
  m.enviados++
  if (o.deliveredAt || ['delivered', 'opened', 'clicked', 'complained'].includes(o.status)) m.entregues++
  if (o.openedAt) m.abertos++
  if (o.clickedAt) m.clicados++
  if (o.status === 'bounced') m.bounces++
  if (o.complainedAt) m.spam++
}

/** Dia no horário de Brasília (AAAA-MM-DD). */
const diaBR = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)

export function periodo(de?: string, ate?: string): { inicio: Date; fim: Date; de: string; ate: string } {
  const hoje = diaBR(new Date())
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const a = ok(ate) ?? hoje
  const d = ok(de) ?? diaBR(new Date(new Date(`${a}T12:00:00-03:00`).getTime() - 29 * 86400_000))
  return { inicio: new Date(`${d}T00:00:00-03:00`), fim: new Date(`${a}T23:59:59.999-03:00`), de: d, ate: a }
}

export async function relatorio(de?: string, ate?: string, origem?: string) {
  const p = periodo(de, ate)
  const linhas: Linha[] = await prisma.outboundSend.findMany({
    where: { channel: 'email', createdAt: { gte: p.inicio, lte: p.fim }, ...(origem ? { source: origem } : {}) },
    select: { source: true, sourceId: true, status: true, createdAt: true, deliveredAt: true, openedAt: true, clickedAt: true, complainedAt: true },
  })
  const total = vazio()
  const porDia = new Map<string, number>()
  const porOrigem = new Map<string, Metricas>()
  const porCampanha = new Map<number, Metricas>()
  for (const o of linhas) {
    somar(total, o)
    if (o.status !== 'failed' && o.status !== 'error') porDia.set(diaBR(o.createdAt), (porDia.get(diaBR(o.createdAt)) ?? 0) + 1)
    const org = o.source || 'system'
    if (!porOrigem.has(org)) porOrigem.set(org, vazio())
    somar(porOrigem.get(org)!, o)
    if (org === 'campanha' && o.sourceId) {
      if (!porCampanha.has(o.sourceId)) porCampanha.set(o.sourceId, vazio())
      somar(porCampanha.get(o.sourceId)!, o)
    }
  }
  // Série diária completa (dia sem envio = 0): buraco no eixo mente sobre o ritmo.
  const serie: Array<{ dia: string; enviados: number }> = []
  for (let t = new Date(`${p.de}T12:00:00-03:00`).getTime(); diaBR(new Date(t)) <= p.ate; t += 86400_000) {
    const d = diaBR(new Date(t)); serie.push({ dia: d, enviados: porDia.get(d) ?? 0 })
  }
  const campanhas = await prisma.emailCampanha.findMany({ where: { id: { in: [...porCampanha.keys()] } }, select: { id: true, nome: true, templateId: true, status: true, iniciadaEm: true } })
  const modelos = await prisma.messageTemplate.findMany({ where: { id: { in: campanhas.map((c) => c.templateId).filter((x): x is number => !!x) } }, select: { id: true, name: true } })
  const nomeModelo = new Map(modelos.map((m) => [m.id, m.name]))
  const porModelo = new Map<string, Metricas & { campanhas: number }>()
  for (const c of campanhas) {
    const nome = (c.templateId && nomeModelo.get(c.templateId)) || 'Modelo excluído'
    if (!porModelo.has(nome)) porModelo.set(nome, { ...vazio(), campanhas: 0 })
    const alvo = porModelo.get(nome)!, m = porCampanha.get(c.id)!
    alvo.campanhas++
    for (const k of Object.keys(m) as Array<keyof Metricas>) alvo[k] += m[k]
  }
  const descadastros = await prisma.leadEvent.count({ where: { type: 'email_unsubscribed', createdAt: { gte: p.inicio, lte: p.fim } } })
  return {
    periodo: { de: p.de, ate: p.ate },
    total, descadastros, serie,
    porOrigem: [...porOrigem.entries()].map(([origem, m]) => ({ origem, ...m })).sort((a, b) => b.enviados - a.enviados),
    porCampanha: campanhas.map((c) => ({ id: c.id, nome: c.nome, status: c.status, iniciadaEm: c.iniciadaEm, modelo: (c.templateId && nomeModelo.get(c.templateId)) || null, ...porCampanha.get(c.id)! }))
      .sort((a, b) => +new Date(b.iniciadaEm ?? 0) - +new Date(a.iniciadaEm ?? 0)),
    porModelo: [...porModelo.entries()].map(([modelo, m]) => ({ modelo, ...m })).sort((a, b) => b.enviados - a.enviados),
  }
}

/** CSV para Excel brasileiro: separador ";" e BOM UTF-8 (acentos certos ao abrir). */
export function csv(cab: string[], linhas: Array<Array<string | number | null | undefined>>): string {
  const cel = (v: unknown) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return '﻿' + [cab, ...linhas].map((l) => l.map(cel).join(';')).join('\r\n') + '\r\n'
}

/** Nome da origem do envio (OutboundSend.source) para gente ler. */
export const ORIGENS: Record<string, string> = {
  campanha: 'Campanhas', workflow: 'Workflows', cadence: 'Cadências', atividade: 'E-mails da equipe',
  system: 'Avisos do sistema', teste: 'Testes', manual: 'Envio manual',
  redefinicao_senha: 'Redefinição de senha',
}
export const nomeDaOrigem = (o: string) => ORIGENS[o] ?? o

export const taxa = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toString().replace('.', ',')}%` : '')
