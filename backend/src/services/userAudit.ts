// src/services/userAudit.ts
//
// Trilho de auditoria de AÇÕES SENSÍVEIS do usuário — alimenta a tela
// "Usuário > Histórico". Diferente do leadHistory (timeline do lead), aqui
// registramos o que um OPERADOR faz no sistema: gestão de usuários, permissões,
// configurações/integrações e exclusões de dados.
//
// O modelo UserAudit guarda tanto ações SOBRE um usuário (userId = alvo) quanto
// ações de SISTEMA sem usuário-alvo (userId null + targetType/targetLabel).
// A tela mostra o que o usuário FEZ (actorId) e o que fizeram com ele (userId).

import { prisma } from '../lib/prisma.js'
import type { FastifyRequest } from 'fastify'

export type AuditChanges = Record<string, unknown>

export interface AuditEntry {
  action: string                  // ex: 'user.deleted', 'cloudapi.disconnected'
  actorId?: number | null         // operador que executou a ação
  actorName?: string | null
  targetUserId?: number | null    // usuário-alvo (quando a ação é sobre um usuário)
  targetType?: string | null      // 'user' | 'setting' | 'cloud_api' | 'api_key' | 'module_permission' | 'module' | 'lead' | 'chatbot' | 'form' | 'portal' | 'enrollment_registration' | 'routing_rule' | 'auth' | 'payment_provider'
  targetLabel?: string | null     // descrição legível do alvo
  changes?: AuditChanges | null   // { campo: { from, to } } ou objeto livre
  ipAddress?: string | null
}

// Grava uma entrada de auditoria. Best-effort: NUNCA lança — não pode quebrar a
// operação que está sendo auditada.
export async function logUserAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.userAudit.create({
      data: {
        action: entry.action,
        userId: entry.targetUserId ?? null,
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        targetType: entry.targetType ?? null,
        targetLabel: entry.targetLabel ?? null,
        changes: (entry.changes ?? undefined) as any,
        ipAddress: entry.ipAddress ?? null,
      },
    })
  } catch {
    /* auditoria é best-effort */
  }
}

// Extrai ator (operador logado) + IP de uma request autenticada.
export function auditActor(req: FastifyRequest): { actorId: number | null; actorName: string | null; ipAddress: string | null } {
  const u = (req as any).user as { userId?: number; name?: string; email?: string } | undefined
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || null
  return {
    actorId: u?.userId ?? null,
    actorName: u?.name || u?.email || null,
    ipAddress: ip,
  }
}

// Atalho: registra uma ação a partir da request (resolve ator/ip sozinho).
export async function auditFromReq(
  req: FastifyRequest,
  action: string,
  extra: Omit<AuditEntry, 'action' | 'actorId' | 'actorName' | 'ipAddress'> = {},
): Promise<void> {
  const { actorId, actorName, ipAddress } = auditActor(req)
  await logUserAudit({ action, actorId, actorName, ipAddress, ...extra })
}

// Diff {campo: {from,to}} entre dois objetos para os campos informados.
export function diffFields<T extends Record<string, any>>(
  before: T, after: T, fields: (keyof T)[],
): Record<string, { from: any; to: any }> {
  const changes: Record<string, { from: any; to: any }> = {}
  for (const f of fields) {
    if (before[f] !== after[f]) changes[String(f)] = { from: before[f], to: after[f] }
  }
  return changes
}
