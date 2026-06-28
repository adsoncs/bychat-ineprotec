// src/services/acaAcesso.ts
// Módulo Acadêmico · F16 — Controle de Acesso Físico. Geração de credencial (QR)
// e decisão de liberação (credencial ativa + sem bloqueio acadêmico/financeiro).
// A catraca/leitor é o ponto de integração: chama registrarAcesso.

import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { statusBloqueio } from './acaBloqueio.js'

/** Cria ou rotaciona a credencial (token do QR) de um aluno. */
export async function gerarCredencial(alunoId: number) {
  const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { id: true } })
  if (!aluno) throw new Error('Aluno não encontrado')
  const token = `ACA-${crypto.randomBytes(16).toString('hex').toUpperCase()}`
  return prisma.acaCredencial.upsert({ where: { alunoId }, create: { alunoId, token, ativo: true }, update: { token, ativo: true } })
}

/**
 * Decisão de acesso (chamada pela catraca). Valida a credencial e o bloqueio;
 * registra o log e devolve autorizado/motivo. Não lança — sempre loga.
 */
export async function registrarAcesso(opts: { token: string; pontoId?: number; tipo?: string }) {
  const tipo = opts.tipo === 'SAIDA' ? 'SAIDA' : 'ENTRADA'
  const cred = await prisma.acaCredencial.findUnique({ where: { token: opts.token || '__none__' }, select: { alunoId: true, ativo: true } })
  const reg = async (alunoId: number | null, autorizado: boolean, motivo: string | null) => {
    await prisma.acaAcessoLog.create({ data: { alunoId, pontoId: opts.pontoId ?? null, tipo, autorizado, motivo } })
    let alunoNome: string | null = null
    if (alunoId) { const a = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { lead: { select: { nome: true } } } }); alunoNome = a?.lead.nome ?? null }
    return { autorizado, motivo, tipo, alunoNome }
  }
  if (!cred) return reg(null, false, 'Credencial inválida')
  if (!cred.ativo) return reg(cred.alunoId, false, 'Credencial inativa')
  const bloq = await statusBloqueio(cred.alunoId)
  if (bloq.bloqueado) return reg(cred.alunoId, false, bloq.motivo || 'Acesso bloqueado')
  return reg(cred.alunoId, true, null)
}
