// src/services/smartBroadcast/suppression.ts
//
// Lista de supressão GLOBAL — telefones que não recebem disparo nenhum.
//
// Existe separada do opt-out por lead (Lead.optOutChannels) porque nem todo
// pedido de "não me mande mais nada" vem de um lead cadastrado: chega por
// telefone, por e-mail, por um terceiro, por decisão jurídica, ou é o número
// errado que responde irritado. Bloquear pelo TELEFONE cru cobre todos esses
// casos e sobrevive a exclusão e recriação do lead.
//
// É consultada duas vezes: ao montar a audiência (para o operador já ver o
// número saindo da conta) e no momento do envio (porque alguém pode ter pedido
// para sair depois que a campanha foi agendada).

import { prisma } from '../../lib/prisma.js'
import { phoneKey } from '../../lib/phone.js'

export type SuppressionReason = 'manual' | 'opt_out' | 'bounce' | 'legal' | 'import'

/** Chaves suprimidas dentre as informadas. Consulta só o que precisa. */
export async function suppressedKeys(keys: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const clean = [...new Set(keys.filter(Boolean))]
  if (!clean.length) return out
  // Em lotes: lista de 20k destinatários não cabe num IN só.
  for (let i = 0; i < clean.length; i += 1000) {
    const rows = await prisma.smartSuppression.findMany({
      where: { phoneKey: { in: clean.slice(i, i + 1000) } },
      select: { phoneKey: true },
    })
    for (const r of rows) out.add(r.phoneKey)
  }
  return out
}

export async function isSuppressed(rawPhone: string): Promise<boolean> {
  const key = phoneKey(rawPhone)
  if (!key) return false
  const hit = await prisma.smartSuppression.findUnique({ where: { phoneKey: key }, select: { id: true } })
  return !!hit
}

/** Adiciona (ou atualiza o motivo de) um telefone na lista. Idempotente. */
export async function suppress(
  rawPhone: string,
  reason: SuppressionReason = 'manual',
  note?: string,
  userId?: number | null,
): Promise<boolean> {
  const key = phoneKey(rawPhone)
  if (!key) return false
  await prisma.smartSuppression.upsert({
    where: { phoneKey: key },
    create: { phoneKey: key, phone: rawPhone.slice(0, 30), reason, note: note?.slice(0, 255) ?? null, createdByUserId: userId ?? null },
    update: { reason, note: note?.slice(0, 255) ?? null },
  })
  // Tira quem entrou na lista de qualquer campanha que ainda não disparou.
  await prisma.smartCampaignRecipient.updateMany({
    where: { phoneKey: key, status: { in: ['pending', 'scheduled'] } },
    data: { status: 'skipped', skipReason: 'suppressed' },
  })
  return true
}

export async function unsuppress(rawPhone: string): Promise<boolean> {
  const key = phoneKey(rawPhone)
  if (!key) return false
  await prisma.smartSuppression.deleteMany({ where: { phoneKey: key } })
  return true
}

/** Importa uma lista de telefones de uma vez (colar/planilha). */
export async function suppressMany(
  phones: string[],
  reason: SuppressionReason = 'import',
  note?: string,
  userId?: number | null,
): Promise<{ added: number; invalid: number }> {
  let added = 0
  let invalid = 0
  for (const p of phones) {
    const ok = await suppress(p, reason, note, userId).catch(() => false)
    ok ? added++ : invalid++
  }
  return { added, invalid }
}
