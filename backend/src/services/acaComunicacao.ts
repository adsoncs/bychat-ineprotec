// src/services/acaComunicacao.ts
// Módulo Acadêmico · P9 — Comunicação. Reusa os canais do ByChat (WhatsApp
// Evolution/Cloud + e-mail) para avisar o aluno: vencimento de parcela,
// publicação de notas e avisos manuais. Idempotente via AcaComunicacao.chaveDedup.

import { prisma } from '../lib/prisma.js'
import { getProviderForLeadOwner } from './whatsappProvider.js'
import { getEmailConfig, getFromAddress, sendEmailGeneric } from './notify.js'
import { alunoPortalLink } from '../lib/acaPortalToken.js'
import { getEncargosConfig, calcularEncargos } from './acaEncargos.js'

const CFG_KEYS = ['aca.notif.vencimento_enabled', 'aca.notif.vencimento_dias_antes', 'aca.notif.canal', 'aca.notif.msg_vencimento', 'aca.notif.msg_notas', 'aca.cobranca.regua_enabled', 'aca.cobranca.dias_pos', 'aca.notif.msg_cobranca'] as const
const DEFAULTS: Record<string, any> = {
  'aca.notif.vencimento_enabled': true,
  'aca.notif.vencimento_dias_antes': 3,
  'aca.notif.canal': 'ambos', // whatsapp | email | ambos
  'aca.notif.msg_vencimento': 'Olá {nome}! Sua parcela {parcela} do curso {curso} vence em {vencimento}, no valor de {valor}. Acesse seu portal para a 2ª via: {link}',
  'aca.notif.msg_notas': 'Olá {nome}! Suas notas do curso {curso} foram publicadas. Confira seu boletim no portal: {link}',
  'aca.cobranca.regua_enabled': false,
  'aca.cobranca.dias_pos': '1,7,15', // dias após o vencimento p/ cobrar
  'aca.notif.msg_cobranca': 'Olá {nome}! Identificamos a parcela {parcela} do curso {curso} vencida em {vencimento} ({atraso} dia(s) de atraso), valor atualizado {valor}. Regularize pelo portal: {link}',
}

export interface NotifConfig { vencimentoEnabled: boolean; vencimentoDiasAntes: number; canal: string; msgVencimento: string; msgNotas: string; reguaEnabled: boolean; diasPos: string; msgCobranca: string }

export async function getNotifConfig(): Promise<NotifConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { in: CFG_KEYS as unknown as string[] } } })
  const v = (k: string) => { const r = rows.find((x) => x.key === k); return r ? (r.value as any) : DEFAULTS[k] }
  return {
    vencimentoEnabled: !!v('aca.notif.vencimento_enabled'),
    vencimentoDiasAntes: Number(v('aca.notif.vencimento_dias_antes')) || 3,
    canal: String(v('aca.notif.canal') || 'ambos'),
    msgVencimento: String(v('aca.notif.msg_vencimento')),
    msgNotas: String(v('aca.notif.msg_notas')),
    reguaEnabled: !!v('aca.cobranca.regua_enabled'),
    diasPos: String(v('aca.cobranca.dias_pos') || '1,7,15'),
    msgCobranca: String(v('aca.notif.msg_cobranca')),
  }
}

export async function setNotifConfig(b: Partial<NotifConfig>): Promise<NotifConfig> {
  const map: Record<string, any> = {
    'aca.notif.vencimento_enabled': b.vencimentoEnabled, 'aca.notif.vencimento_dias_antes': b.vencimentoDiasAntes,
    'aca.notif.canal': b.canal, 'aca.notif.msg_vencimento': b.msgVencimento, 'aca.notif.msg_notas': b.msgNotas,
    'aca.cobranca.regua_enabled': b.reguaEnabled, 'aca.cobranca.dias_pos': b.diasPos, 'aca.notif.msg_cobranca': b.msgCobranca,
  }
  const BOOL = new Set(['aca.notif.vencimento_enabled', 'aca.cobranca.regua_enabled'])
  const NUM = new Set(['aca.notif.vencimento_dias_antes'])
  for (const k of CFG_KEYS) {
    if (map[k] === undefined) continue
    const val = BOOL.has(k) ? !!map[k] : NUM.has(k) ? Number(map[k]) : String(map[k])
    await prisma.setting.upsert({ where: { key: k }, update: { value: val as any }, create: { key: k, label: k, grp: 'academico', fieldType: BOOL.has(k) ? 'boolean' : NUM.has(k) ? 'number' : 'textarea', value: val as any } })
  }
  return getNotifConfig()
}

const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`))
}

interface EnvioOpts { tipo: 'VENCIMENTO' | 'COBRANCA' | 'FALTAS' | 'NOTAS' | 'MANUAL'; texto: string; assunto: string; chaveDedup: string; refId?: number; canalCfg: string }

/** Envia ao aluno pelos canais habilitados; registra log idempotente (dedup). */
export async function enviarAluno(alunoId: number, opts: EnvioOpts): Promise<{ enviados: number; pulado: boolean }> {
  // dedup: se já existe qualquer envio com a mesma chave base, pula
  const ja = await prisma.acaComunicacao.findFirst({ where: { chaveDedup: { startsWith: opts.chaveDedup } }, select: { id: true } })
  if (ja) return { enviados: 0, pulado: true }
  const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { lead: { select: { id: true, nome: true, whatsapp: true, email: true } } } })
  if (!aluno) return { enviados: 0, pulado: false }
  const lead = aluno.lead
  const canais: string[] = opts.canalCfg === 'ambos' ? ['whatsapp', 'email'] : [opts.canalCfg]
  let enviados = 0
  for (const canal of canais) {
    const destino = canal === 'whatsapp' ? lead.whatsapp : lead.email
    if (!destino || !destino.trim()) continue
    let status = 'ENVIADO'; let erro: string | null = null
    try {
      if (canal === 'whatsapp') {
        const { provider } = await getProviderForLeadOwner({ id: lead.id, whatsapp: lead.whatsapp })
        await provider.sendText(lead.whatsapp, opts.texto)
      } else {
        const cfg = await getEmailConfig()
        await sendEmailGeneric({ from: getFromAddress(cfg, 'secretaria'), to: lead.email, subject: opts.assunto, html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${opts.texto.replace(/\n/g, '<br>')}</div>` })
      }
      enviados++
    } catch (e: any) { status = 'FALHA'; erro = String(e?.message || e).slice(0, 500) }
    await prisma.acaComunicacao.create({ data: { alunoId, tipo: opts.tipo, canal, destino: destino.slice(0, 190), assunto: opts.assunto.slice(0, 190), conteudo: opts.texto, status, erro, refId: opts.refId, chaveDedup: `${opts.chaveDedup}:${canal}`.slice(0, 120) } }).catch(() => {})
  }
  return { enviados, pulado: false }
}

/** Varre parcelas a vencer dentro da antecedência e dispara lembretes. */
export async function varrerVencimentos(): Promise<{ verificadas: number; enviados: number }> {
  const cfg = await getNotifConfig()
  if (!cfg.vencimentoEnabled) return { verificadas: 0, enviados: 0 }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const limite = new Date(hoje.getTime() + cfg.vencimentoDiasAntes * 86400_000); limite.setHours(23, 59, 59, 999)
  const parcelas = await prisma.acaParcela.findMany({
    where: { situacao: 'ABERTA', dataVencimento: { gte: hoje, lte: limite } },
    select: { id: true, nroParcela: true, tipo: true, valorBrutoCentavos: true, dataVencimento: true, contrato: { select: { matricula: { select: { alunoId: true, turma: { select: { courseOfferingId: true } } } } } } },
  })
  let enviados = 0
  for (const pc of parcelas) {
    const alunoId = pc.contrato.matricula.alunoId
    const curso = await cursoDaOferta(pc.contrato.matricula.turma.courseOfferingId)
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { lead: { select: { nome: true } } } })
    const texto = render(cfg.msgVencimento, {
      nome: aluno?.lead.nome || 'aluno(a)', curso, parcela: `${pc.nroParcela}ª (${pc.tipo.toLowerCase()})`,
      valor: money(pc.valorBrutoCentavos), vencimento: new Date(pc.dataVencimento).toLocaleDateString('pt-BR'), link: alunoPortalLink(alunoId),
    })
    const r = await enviarAluno(alunoId, { tipo: 'VENCIMENTO', texto, assunto: 'Lembrete de vencimento', chaveDedup: `venc:${pc.id}`, refId: pc.id, canalCfg: cfg.canal })
    enviados += r.enviados
  }
  return { verificadas: parcelas.length, enviados }
}

/** Régua de cobrança: parcelas vencidas há exatamente N dias (config dias_pos) → cobrança. */
export async function varrerInadimplencia(): Promise<{ verificadas: number; enviados: number }> {
  const cfg = await getNotifConfig()
  if (!cfg.reguaEnabled) return { verificadas: 0, enviados: 0 }
  const dias = cfg.diasPos.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0)
  if (!dias.length) return { verificadas: 0, enviados: 0 }
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  // janela de vencimento que hoje completa exatamente um dos "dias após"
  const alvoDatas = dias.map((d) => { const dt = new Date(hoje.getTime() - d * 86400_000); return dt })
  const inicio = new Date(Math.min(...alvoDatas.map((d) => d.getTime())))
  const fim = new Date(Math.max(...alvoDatas.map((d) => d.getTime()))); fim.setHours(23, 59, 59, 999)
  const enc = await getEncargosConfig()
  const parcelas = await prisma.acaParcela.findMany({
    where: { situacao: { in: ['ABERTA', 'VENCIDA'] }, dataVencimento: { gte: inicio, lte: fim } },
    select: { id: true, nroParcela: true, tipo: true, valorBrutoCentavos: true, dataVencimento: true, situacao: true, contrato: { select: { matricula: { select: { alunoId: true, turma: { select: { courseOfferingId: true } } } } } } },
  })
  let enviados = 0, verificadas = 0
  for (const pc of parcelas) {
    const venc = new Date(pc.dataVencimento); venc.setHours(0, 0, 0, 0)
    const atraso = Math.floor((hoje.getTime() - venc.getTime()) / 86400_000)
    if (!dias.includes(atraso)) continue
    verificadas++
    const alunoId = pc.contrato.matricula.alunoId
    const curso = await cursoDaOferta(pc.contrato.matricula.turma.courseOfferingId)
    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { lead: { select: { nome: true } } } })
    const calc = calcularEncargos(pc, enc)
    const texto = render(cfg.msgCobranca, {
      nome: aluno?.lead.nome || 'aluno(a)', curso, parcela: `${pc.nroParcela}ª (${pc.tipo.toLowerCase()})`,
      valor: money(calc.valorCobranca), vencimento: venc.toLocaleDateString('pt-BR'), atraso: String(atraso), link: alunoPortalLink(alunoId),
    })
    const r = await enviarAluno(alunoId, { tipo: 'COBRANCA', texto, assunto: 'Cobrança de parcela vencida', chaveDedup: `cobr:${pc.id}:${atraso}`, refId: pc.id, canalCfg: cfg.canal })
    enviados += r.enviados
  }
  return { verificadas, enviados }
}

/** Aviso manual de publicação de notas para todos os matriculados de uma turma. */
export async function notificarNotasTurma(turmaId: number): Promise<{ alunos: number; enviados: number }> {
  const cfg = await getNotifConfig()
  const turma = await prisma.acaTurma.findUnique({ where: { id: turmaId }, select: { courseOfferingId: true } })
  const curso = await cursoDaOferta(turma?.courseOfferingId ?? null)
  const mats = await prisma.acaMatricula.findMany({ where: { turmaId, status: 'MATRICULADO', listaEspera: false }, select: { alunoId: true, aluno: { select: { lead: { select: { nome: true } } } } } })
  // dedup por dia (permite reavisar em datas diferentes)
  const dia = new Date().toISOString().slice(0, 10)
  let enviados = 0
  for (const m of mats) {
    const texto = render(cfg.msgNotas, { nome: m.aluno.lead.nome || 'aluno(a)', curso, link: alunoPortalLink(m.alunoId) })
    const r = await enviarAluno(m.alunoId, { tipo: 'NOTAS', texto, assunto: 'Notas publicadas', chaveDedup: `notas:${turmaId}:${dia}:${m.alunoId}`, refId: turmaId, canalCfg: cfg.canal })
    enviados += r.enviados
  }
  return { alunos: mats.length, enviados }
}

async function cursoDaOferta(courseOfferingId: number | null): Promise<string> {
  if (!courseOfferingId) return 'seu curso'
  const off = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId }, select: { courseId: true } })
  if (!off) return 'seu curso'
  const c = await prisma.course.findUnique({ where: { id: off.courseId }, select: { nome: true } })
  return c?.nome || 'seu curso'
}

// ───────── Scheduler (varredura diária de vencimentos) ─────────
let timer: NodeJS.Timeout | null = null
const INTERVAL_MS = 6 * 3600_000 // 6h
export function startAcaComunicacaoScheduler(): void {
  if (timer) return
  const run = () => Promise.all([varrerVencimentos(), varrerInadimplencia()])
    .then(([v, i]) => { if (v.enviados || i.enviados) console.log(`[acaComunicacao] vencimentos: ${v.enviados} · cobranças: ${i.enviados}`) })
    .catch((e) => console.warn('[acaComunicacao] cron erro:', e?.message || e))
  timer = setInterval(run, INTERVAL_MS)
  setTimeout(run, 60_000) // primeira passada 1min após o boot
  console.log(`[acaComunicacao] scheduler iniciado (a cada ${INTERVAL_MS / 3600000}h)`)
}
