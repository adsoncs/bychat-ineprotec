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

// ─── Período de inscrição (edital) ─────────────────────────────────────────

type Janela = { inicioInscricao?: Date | null; terminoInscricao?: Date | null }

/**
 * Fim da janela. Data gravada sem hora (00:00:00.000 UTC — o campo de data do
 * painel) vale até o fim daquele dia no horário de Brasília; com hora, vale a
 * hora gravada.
 */
function fimDaJanela(d: Date): Date {
  const semHora = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  return semHora ? new Date(d.getTime() + 27 * 3600_000 - 1) : d
}

/** A janela está aberta agora? Sem data de um lado = aberta daquele lado. */
export function janelaAberta(j: Janela, agora = new Date()): boolean {
  if (j.inicioInscricao && agora < j.inicioInscricao) return false
  if (j.terminoInscricao && agora > fimDaJanela(j.terminoInscricao)) return false
  return true
}

/**
 * Por que não dá para se inscrever nesta oferta agora (null = dá): o período
 * do processo seletivo (edital) e o da própria oferta, quando houver.
 */
export function foraDoPeriodo(o: Janela & { selectionProcess?: Janela | null }, agora = new Date()): string | null {
  const dia = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  for (const j of [o.selectionProcess ?? {}, o]) {
    if (janelaAberta(j, agora)) continue
    const de = j.inicioInscricao ? dia(j.inicioInscricao) : null
    const ate = j.terminoInscricao ? dia(fimDaJanela(j.terminoInscricao)) : null
    if (j.inicioInscricao && agora < j.inicioInscricao) return `As inscrições para este curso abrem em ${de}${ate ? ` e vão até ${ate}` : ''}.`
    return `As inscrições para este curso foram encerradas${ate ? ` em ${ate}` : ''}.`
  }
  return null
}
