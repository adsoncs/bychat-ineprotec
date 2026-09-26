// src/services/portalModos.ts
// Quais processos seletivos um portal realmente oferece.
//
// O portal guarda a lista de processos (selectionProcessIds) e, no bloco
// "Modos de ingresso" do editor, o operador pode desligar um modo (ex.: Nota do
// ENEM). Desligar precisa tirar do portal os cursos dos processos daquele modo —
// antes só sumia a etapa de campos extras e o candidato continuava escolhendo o
// curso do ENEM. A escolha mora em formConfig._entryModes.perMode[code].enabled.

import { prisma } from '../lib/prisma.js'

/** Códigos de modo desligados no formConfig do portal. */
export function modosDesligados(formConfig: unknown): Set<string> {
  const perMode = (formConfig as any)?._entryModes?.perMode
  const out = new Set<string>()
  if (!perMode || typeof perMode !== 'object') return out
  for (const [code, cfg] of Object.entries(perMode as Record<string, any>)) {
    if (cfg && cfg.enabled === false) out.add(code)
  }
  return out
}

/** selectionProcessIds do portal sem os processos de modos desligados. */
export async function processosOferecidos(portal: { selectionProcessIds: unknown; formConfig?: unknown }): Promise<number[]> {
  const ids = (Array.isArray(portal.selectionProcessIds) ? portal.selectionProcessIds : [])
    .map((x: any) => Number(x)).filter((n: number) => Number.isInteger(n) && n > 0)
  const off = modosDesligados(portal.formConfig)
  if (ids.length === 0 || off.size === 0) return ids
  const sps = await prisma.selectionProcess.findMany({
    where: { id: { in: ids } },
    select: { id: true, entryMode: { select: { code: true } } },
  })
  const fora = new Set(sps.filter((sp) => sp.entryMode?.code && off.has(sp.entryMode.code)).map((sp) => sp.id))
  return ids.filter((id) => !fora.has(id))
}

/**
 * Curso pré-fixado (bloco Curso › "Curso pré-fixado"): o portal só inscreve
 * nesta oferta. null = sem fixação.
 */
export function ofertaFixa(formConfig: unknown): number | null {
  const steps = Array.isArray((formConfig as any)?.steps) ? (formConfig as any).steps : []
  for (const s of steps) {
    for (const f of (Array.isArray(s?.fields) ? s.fields : [])) {
      if (f?.type === 'offering-picker' && f?.config?.mode === 'fixed') {
        const id = Number(f.config.fixedOfferingId)
        return Number.isInteger(id) && id > 0 ? id : null
      }
    }
  }
  return null
}
