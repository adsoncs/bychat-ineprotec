// src/lib/portalGuard.ts
//
// A trava do acesso por portal: um preHandler global que roda em toda rota do
// ESCOPO (lib/portalRotasTabela.ts) antes do código dela.
//
// Para quem vê todos os portais, ou numa instalação sem portal restrito, ela
// não faz nada — custo de uma leitura em cache. Para quem é recortado:
//   • entidade/portal na URL → resolve até a(s) inscrição(ões) e decide
//     (fora do alcance 404; escrita em portal só com VER 403);
//   • ids no corpo ou na query (registrationId, alunoIds, portalId…) → idem;
//   • somenteTodos, ou rota do escopo sem classificação → 403.
// As listas (`lista`) passam: o recorte delas é feito no código da rota.

import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './prisma.js'
import { resolveUserFromRequest } from './permissions.js'
import {
  alcanceDePortais, podeOperarPortal, podeVerInscricao, podeVerPortal,
  type AcaoPortal, type AlcancePortais,
} from './portalAccess.js'
import { CHAVES_DE_ID, regraDaRota, type Entidade } from './portalRotasTabela.js'

const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// POST que só lê (prévia, simulação) não exige OPERAR.
const POST_LE = /\/(previa|simular|search|export)$/

type Alvo = { portalIds: number[] } | { inscricoes: Array<{ portalId: number; dono: number | null }> } | { semInscricao: true } | { inexistente: true }

const selReg = { portalId: true, lead: { select: { assignedUserId: true } } } as const
const deRegs = (regs: Array<{ portalId: number; lead: { assignedUserId: number | null } | null }>): Alvo =>
  regs.length ? { inscricoes: regs.map((r) => ({ portalId: r.portalId, dono: r.lead?.assignedUserId ?? null })) } : { semInscricao: true }

async function regsDoLead(leadId: number | null | undefined): Promise<Alvo> {
  if (!leadId) return { semInscricao: true }
  return deRegs(await prisma.enrollmentRegistration.findMany({ where: { leadId }, select: selReg }))
}
async function regPorId(id: number | null | undefined): Promise<Alvo> {
  if (!id) return { semInscricao: true }
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id }, select: selReg })
  return r ? deRegs([r]) : { inexistente: true }
}
async function alvoDaMatricula(id: number): Promise<Alvo> {
  const m = await prisma.acaMatricula.findUnique({ where: { id }, select: { enrollmentRegistrationId: true } })
  if (!m) return { inexistente: true }
  return regPorId(m.enrollmentRegistrationId)
}
async function alvoDoAluno(id: number): Promise<Alvo> {
  const a = await prisma.aluno.findUnique({ where: { id }, select: { leadId: true } })
  if (!a) return { inexistente: true }
  return regsDoLead(a.leadId)
}
async function alvoDoContrato(id: number): Promise<Alvo> {
  const c = await prisma.acaContrato.findUnique({ where: { id }, select: { matriculaId: true } })
  return c ? alvoDaMatricula(c.matriculaId) : { inexistente: true }
}

/** Até onde a entidade leva: portais, inscrições, ou nenhuma inscrição. */
async function resolver(ent: Entidade, id: number): Promise<Alvo> {
  if (!Number.isFinite(id)) return { inexistente: true }
  switch (ent) {
    case 'portal': return { portalIds: [id] }
    case 'inscricao': return regPorId(id)
    case 'documento': {
      const d = await prisma.enrollmentDocument.findUnique({ where: { id }, select: { registrationId: true } })
      return d ? regPorId(d.registrationId) : { inexistente: true }
    }
    case 'redacao': {
      const d = await prisma.essaySubmission.findUnique({ where: { id }, select: { registrationId: true } })
      return d ? regPorId(d.registrationId) : { inexistente: true }
    }
    case 'enem': {
      const d = await prisma.enemScoreImport.findUnique({ where: { id }, select: { registrationId: true } })
      return d ? regPorId(d.registrationId) : { inexistente: true }
    }
    case 'seiEnvio': {
      const d = await prisma.seiEnvio.findUnique({ where: { id }, select: { registrationId: true } })
      return d ? regPorId(d.registrationId) : { inexistente: true }
    }
    case 'webhookHit': {
      const d = await prisma.paymentWebhookHit.findUnique({ where: { id }, select: { registrationId: true } })
      return d ? regPorId(d.registrationId) : { inexistente: true }
    }
    case 'envelope': {
      const e = await prisma.acaAssinatura.findUnique({ where: { id }, select: { registrationId: true, matriculaId: true, alunoId: true, contratoId: true } })
      if (!e) return { inexistente: true }
      if (e.registrationId) return regPorId(e.registrationId)
      if (e.matriculaId) return alvoDaMatricula(e.matriculaId)
      if (e.contratoId) return alvoDoContrato(e.contratoId)
      if (e.alunoId) return alvoDoAluno(e.alunoId)
      return { semInscricao: true }
    }
    case 'matricula': return alvoDaMatricula(id)
    case 'aluno': return alvoDoAluno(id)
    case 'contrato': return alvoDoContrato(id)
    case 'parcela': {
      const p = await prisma.acaParcela.findUnique({ where: { id }, select: { contratoId: true } })
      return p ? alvoDoContrato(p.contratoId) : { inexistente: true }
    }
    case 'ged': {
      const g = await prisma.acaGedArquivo.findUnique({ where: { id }, select: { alunoId: true } })
      return g ? alvoDoAluno(g.alunoId) : { inexistente: true }
    }
    case 'lead': {
      const l = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
      if (!l) return { inexistente: true }
      const alvo = await regsDoLead(id)
      // Lead que nunca se inscreveu não tem dado de portal: quem decide é a
      // regra do lead (dono/equipe), aplicada pela própria rota.
      return 'semInscricao' in alvo ? { portalIds: [] } : alvo
    }
    case 'processo': {
      const p = await prisma.processRegistration.findUnique({ where: { id }, select: { enrollmentRegistration: { select: selReg } } })
      if (!p) return { inexistente: true }
      return p.enrollmentRegistration ? deRegs([p.enrollmentRegistration]) : { semInscricao: true }
    }
  }
}

/** 'ok' | 404 | 403 para um alvo resolvido. */
function decidir(alc: AlcancePortais, alvo: Alvo, acao: AcaoPortal, todas = false): 'ok' | 404 | 403 {
  if ('inexistente' in alvo) return 'ok' // a rota responde o 404 dela, sem pista de alcance
  if ('semInscricao' in alvo) return 404 // registro sem portal: só quem vê todos
  if ('portalIds' in alvo) {
    if (alvo.portalIds.some((p) => !podeVerPortal(alc, p))) return 404
    if (acao === 'operar' && alvo.portalIds.some((p) => !podeOperarPortal(alc, p))) return 403
    return 'ok'
  }
  const visiveis = alvo.inscricoes.filter((r) => podeVerInscricao(alc, { portalId: r.portalId, donoDoLead: r.dono }))
  if (!visiveis.length) return 404
  if (todas) {
    if (visiveis.length < alvo.inscricoes.length) return 403
    if (acao === 'operar' && !visiveis.every((r) => podeOperarPortal(alc, r.portalId))) return 403
    return 'ok'
  }
  if (acao === 'operar' && !visiveis.some((r) => podeOperarPortal(alc, r.portalId))) return 403
  return 'ok'
}

function idsDe(v: unknown): number[] {
  const lista = Array.isArray(v) ? v : [v]
  return lista.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
}

function negar(reply: FastifyReply, codigo: 404 | 403) {
  return codigo === 404
    ? reply.code(404).send({ error: 'Registro não encontrado' })
    : reply.code(403).send({ error: 'Sua equipe só acompanha este portal — a ação não é permitida.', code: 'PORTAL_SOMENTE_LEITURA' })
}

export async function portalAccessHook(req: FastifyRequest, reply: FastifyReply) {
  const rota = (req as any).routeOptions?.url as string | undefined
  if (!rota || !rota.startsWith('/api/')) return
  const r = regraDaRota(req.method, rota)
  if (!r) return
  const user = resolveUserFromRequest(req)
  if (!user) return // a autenticação da rota responde
  const alc = await alcanceDePortais(user.userId, user.role)
  if (alc.todos || !alc.restritos.length) return

  const { regra } = r
  if (regra.t === 'somenteTodos') {
    return reply.code(403).send({ error: 'Esta visão reúne todos os portais — disponível só para quem vê todos.', code: 'PORTAL_SOMENTE_TODOS' })
  }
  const acao: AcaoPortal = ESCRITA.has(req.method) && !POST_LE.test(rota) ? 'operar' : 'ver'
  const params = (req.params ?? {}) as Record<string, unknown>

  if (regra.t === 'entidade' || regra.t === 'portal') {
    const id = Number(params[regra.param])
    const alvo = regra.t === 'portal' ? await resolver('portal', id) : await resolver(regra.ent, id)
    const d = decidir(alc, alvo, acao, regra.t === 'entidade' && !!regra.todas)
    if (d !== 'ok') return negar(reply, d)
    // Número do portal inteiro: o membro só vê as inscrições dos próprios leads.
    if (regra.t === 'portal' && regra.agregado && alc.restritos.includes(id) && !alc.lider.includes(id)) return negar(reply, 404)
  }

  if (regra.t === 'lista' && regra.corpoLivre) return
  if (regra.t === 'semPortal' && !ESCRITA.has(req.method)) return

  // Ids no corpo e na query.
  const fontes = [req.query, req.body].filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
  for (const fonte of fontes) {
    for (const [chave, ent] of Object.entries(CHAVES_DE_ID)) {
      if (!(chave in fonte)) continue
      for (const id of idsDe(fonte[chave])) {
        const d = decidir(alc, await resolver(ent, id), acao, regra.t === 'lista' && !!regra.todas)
        if (d !== 'ok') return negar(reply, d)
      }
    }
    // Prévia de contrato com inscrição real: código MAT-… ou id.
    if (typeof fonte.inscricao === 'string' || typeof fonte.inscricao === 'number') {
      const v = String(fonte.inscricao).trim()
      const reg = /^\d+$/.test(v)
        ? await prisma.enrollmentRegistration.findUnique({ where: { id: Number(v) }, select: selReg })
        : await prisma.enrollmentRegistration.findFirst({ where: { candidateCode: v }, select: selReg })
      if (reg) {
        const d = decidir(alc, deRegs([reg]), 'ver')
        if (d !== 'ok') return negar(reply, d)
      }
    }
  }
}
