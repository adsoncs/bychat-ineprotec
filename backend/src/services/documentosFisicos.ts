// src/services/documentosFisicos.ts
//
// Documentos físicos: o que a escola recebe em papel (ata da avaliação final,
// fichas, contrato assinado, estágio, TCC, prova final…). Não é upload do aluno
// e não entra na etapa "Documentos" da jornada — é a conferência da secretaria.
//
// O modo de ingresso diz o que pede (EntryModePhysicalDoc), com condição opcional
// sobre o formulário — ex.: só para o polo ENSA ({ campo: 'campusId', valores }).
// A inscrição guarda o recebimento (EnrollmentPhysicalDoc).

import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { condicaoAtende, normalizarCondicao } from './docCondicional.js'

export interface RequisitoFisico { id: number; nome: string; ordem: number; condicao: { campo: string; valores: string[] } | null }

export interface FisicoDaInscricao {
  id: number
  nome: string
  recebido: { em: string; porNome: string | null; observacao: string | null } | null
}

/** Lista do modo de ingresso (tela de configuração). */
export async function requisitosFisicosDoModo(entryModeId: number): Promise<RequisitoFisico[]> {
  const rs = await prisma.entryModePhysicalDoc.findMany({ where: { entryModeId }, orderBy: [{ ordem: 'asc' }, { id: 'asc' }] })
  return rs.map((r) => ({ id: r.id, nome: r.nome, ordem: r.ordem, condicao: normalizarCondicao(r.condicao) }))
}

/**
 * Substitui a lista do modo. Itens com `id` são atualizados (o recebimento já
 * registrado continua valendo); os que saíram da lista são apagados com os
 * recebimentos deles.
 */
export async function gravarRequisitosFisicos(entryModeId: number, itens: Array<{ id?: number | null; nome: string; condicao?: unknown }>): Promise<RequisitoFisico[]> {
  const limpos = itens
    .map((i, k) => ({ id: Number(i.id) || null, nome: String(i.nome ?? '').trim().slice(0, 191), condicao: normalizarCondicao(i.condicao), ordem: k + 1 }))
    .filter((i) => i.nome.length >= 2)
  const atuais = await prisma.entryModePhysicalDoc.findMany({ where: { entryModeId }, select: { id: true } })
  const ficam = new Set(limpos.map((i) => i.id).filter(Boolean) as number[])
  const saem = atuais.map((a) => a.id).filter((id) => !ficam.has(id))
  await prisma.$transaction(async (tx) => {
    if (saem.length) {
      await tx.enrollmentPhysicalDoc.deleteMany({ where: { requisitoId: { in: saem } } })
      await tx.entryModePhysicalDoc.deleteMany({ where: { id: { in: saem } } })
    }
    for (const i of limpos) {
      // Coluna JSON vazia: o Prisma exige DbNull, não null cru.
      const data = { nome: i.nome, ordem: i.ordem, condicao: (i.condicao ?? Prisma.DbNull) as any }
      if (i.id && atuais.some((a) => a.id === i.id)) {
        await tx.entryModePhysicalDoc.update({ where: { id: i.id }, data })
      } else {
        await tx.entryModePhysicalDoc.create({ data: { entryModeId, ...data } })
      }
    }
  })
  return requisitosFisicosDoModo(entryModeId)
}

/** O que esta inscrição deve entregar em papel, e o que já chegou. */
export async function fisicosDaInscricao(registrationId: number): Promise<FisicoDaInscricao[]> {
  const reg = await prisma.enrollmentRegistration.findUnique({
    where: { id: registrationId },
    select: { formData: true, processRegistration: { select: { selectionProcess: { select: { entryModeId: true } } } } },
  })
  const modo = reg?.processRegistration?.selectionProcess?.entryModeId
  if (!reg || !modo) return []
  const reqs = (await requisitosFisicosDoModo(modo)).filter((r) => condicaoAtende(r.condicao, reg.formData))
  if (!reqs.length) return []
  const recebidos = await prisma.enrollmentPhysicalDoc.findMany({ where: { registrationId, requisitoId: { in: reqs.map((r) => r.id) } } })
  const por = new Map(recebidos.map((r) => [r.requisitoId, r]))
  return reqs.map((r) => {
    const x = por.get(r.id)
    return { id: r.id, nome: r.nome, recebido: x ? { em: x.recebidoEm.toISOString(), porNome: x.recebidoPorNome, observacao: x.observacao } : null }
  })
}

type Resultado = { ok: true } | { ok: false; status: number; erro: string }

export async function marcarRecebido(registrationId: number, requisitoId: number, p: { porId: number | null; porNome: string; observacao?: string | null; em?: string | null }): Promise<Resultado> {
  const lista = await fisicosDaInscricao(registrationId)
  if (!lista.some((r) => r.id === requisitoId)) return { ok: false, status: 404, erro: 'Este documento físico não é pedido nesta inscrição.' }
  const em = p.em ? new Date(p.em) : new Date()
  if (Number.isNaN(em.getTime()) || em.getTime() > Date.now() + 60_000) return { ok: false, status: 400, erro: 'Data de recebimento inválida.' }
  const dados = { recebidoEm: em, recebidoPorId: p.porId, recebidoPorNome: String(p.porNome || '').slice(0, 191) || null, observacao: String(p.observacao ?? '').trim().slice(0, 2000) || null }
  await prisma.enrollmentPhysicalDoc.upsert({
    where: { registrationId_requisitoId: { registrationId, requisitoId } },
    create: { registrationId, requisitoId, ...dados },
    update: dados,
  })
  const r = await prisma.enrollmentRegistration.findUnique({ where: { id: registrationId }, select: { leadId: true, candidateCode: true } })
  const nome = lista.find((x) => x.id === requisitoId)?.nome ?? 'Documento físico'
  if (r?.leadId) {
    const { logEvent } = await import('./leadHistory.js')
    logEvent({ leadId: r.leadId, type: 'physical_doc_received', category: 'operator', title: 'Documento físico recebido', source: 'panel', actorType: 'operator',
      userId: p.porId ?? undefined, userName: p.porNome || undefined, description: `${nome} — inscrição ${r.candidateCode}.`, metadata: { registrationId, requisitoId } })
  }
  return { ok: true }
}

export async function desmarcarRecebido(registrationId: number, requisitoId: number): Promise<Resultado> {
  const n = await prisma.enrollmentPhysicalDoc.deleteMany({ where: { registrationId, requisitoId } })
  return n.count ? { ok: true } : { ok: false, status: 404, erro: 'Não estava marcado como recebido.' }
}

// ─── Dados internos da oferta ────────────────────────────────────────────────

export async function internoDaOferta(offeringId: number): Promise<{ prazoConclusao: string | null }> {
  const r = await prisma.offeringInterno.findUnique({ where: { offeringId } })
  return { prazoConclusao: r?.prazoConclusao ?? null }
}

export async function gravarInternoDaOferta(offeringId: number, p: { prazoConclusao?: string | null }) {
  const prazo = String(p.prazoConclusao ?? '').trim().slice(0, 200) || null
  await prisma.offeringInterno.upsert({ where: { offeringId }, create: { offeringId, prazoConclusao: prazo }, update: { prazoConclusao: prazo } })
  return internoDaOferta(offeringId)
}
