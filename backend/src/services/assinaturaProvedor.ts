// src/services/assinaturaProvedor.ts
// Qual provedor de assinatura eletrônica o cliente usa.
//
// O cliente escolhe entre Autentique e Clicksign (ou nenhum: aceite no portal).
// A escolha vale para os envelopes NOVOS; cada envelope guarda em
// `AcaAssinatura.provider` com quem nasceu, e sincronizar/cancelar/reenviar
// sempre falam com esse provedor — trocar de fornecedor não quebra contratos
// que já estão em andamento.
//
// Compatibilidade: antes da Clicksign só existia `assinatura.modo`
// (SIMULADO|AUTENTIQUE). Sem `assinatura.provedor` gravado, vale o modo antigo.

import { prisma } from '../lib/prisma.js'

export type ProvedorAssinatura = 'SIMULADO' | 'AUTENTIQUE' | 'CLICKSIGN'

export const NOME_PROVEDOR: Record<string, string> = {
  AUTENTIQUE: 'Autentique', CLICKSIGN: 'Clicksign', SIMULADO: 'Simulado', PORTAL: 'aceite no portal',
}

async function getSetting(key: string): Promise<string | null> {
  const r = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  const v = r?.value as any
  return typeof v === 'string' ? v : (v == null ? null : String(v))
}

/** O que o cliente escolheu, sem checar credencial. */
export async function provedorEscolhido(): Promise<ProvedorAssinatura> {
  const p = process.env.ASSINATURA_PROVEDOR || (await getSetting('assinatura.provedor'))
  if (p === 'AUTENTIQUE' || p === 'CLICKSIGN' || p === 'SIMULADO') return p
  const { getConfig } = await import('./autentique.js')
  return (await getConfig()).modo === 'AUTENTIQUE' ? 'AUTENTIQUE' : 'SIMULADO'
}

/** O provedor que de fato vai assinar: o escolhido, se tiver credencial; senão SIMULADO. */
export async function provedorAtivo(): Promise<ProvedorAssinatura> {
  const p = await provedorEscolhido()
  if (p === 'AUTENTIQUE') {
    const { getConfig } = await import('./autentique.js')
    return (await getConfig()).token ? 'AUTENTIQUE' : 'SIMULADO'
  }
  if (p === 'CLICKSIGN') {
    const { getConfig } = await import('./clicksign.js')
    return (await getConfig()).token ? 'CLICKSIGN' : 'SIMULADO'
  }
  return 'SIMULADO'
}

export async function setProvedor(p: string): Promise<void> {
  if (p !== 'AUTENTIQUE' && p !== 'CLICKSIGN' && p !== 'SIMULADO') throw new Error('Provedor inválido')
  await prisma.setting.upsert({
    where: { key: 'assinatura.provedor' },
    update: { value: p as any },
    create: { key: 'assinatura.provedor', label: 'Provedor de assinatura eletrônica', grp: 'academico', fieldType: 'text', value: p as any },
  })
  // O modo antigo continua coerente para quem ainda lê só ele.
  await prisma.setting.upsert({
    where: { key: 'assinatura.modo' },
    update: { value: (p === 'AUTENTIQUE' ? 'AUTENTIQUE' : 'SIMULADO') as any },
    create: { key: 'assinatura.modo', label: 'Modo de assinatura', grp: 'academico', fieldType: 'text', value: (p === 'AUTENTIQUE' ? 'AUTENTIQUE' : 'SIMULADO') as any },
  })
}

/** Lê o PDF assinado guardado: arquivo local (/uploads/...) ou URL do provedor. */
export async function lerPdfAssinado(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  if (url.startsWith('/uploads/')) {
    const { uploadsPath } = await import('../lib/uploadsDir.js')
    const fs = await import('node:fs/promises')
    const rel = url.slice('/uploads/'.length)
    if (rel.includes('..')) return null
    return fs.readFile(uploadsPath(rel)).catch(() => null)
  }
  if (!url.startsWith('http')) return null
  return fetch(url, { signal: AbortSignal.timeout(15_000) })
    .then(async (r) => (r.ok && String(r.headers.get('content-type')).includes('pdf') ? Buffer.from(await r.arrayBuffer()) : null))
    .catch(() => null)
}
