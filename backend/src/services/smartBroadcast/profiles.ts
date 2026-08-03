// src/services/smartBroadcast/profiles.ts
//
// Perfis de ritmo. Os três de sistema (Conservador/Padrão/Agressivo) são
// semeados no primeiro start e ficam protegidos contra edição — quem quiser um
// ritmo próprio cria um perfil novo em vez de alterar o significado de
// "Conservador" por baixo de campanhas que já o escolheram.

import { prisma } from '../../lib/prisma.js'
import { DEFAULT_WARMUP_CURVE } from './health.js'
import type { PacingConfig } from './pacing.js'

export const SYSTEM_PROFILES = [
  {
    name: 'Conservador',
    description: '40s a 3min entre mensagens, pausa a cada ~20 envios. O único recomendado para número novo.',
    minDelayMs: 40_000, maxDelayMs: 180_000, sessionSize: 20, sessionBreakMs: 600_000,
    typingEnabled: true, readReceipts: true, dailyCapStart: 20, dailyCapMax: 250,
  },
  {
    name: 'Padrão',
    description: '25s a 1min30. Para números já aquecidos e lista com relacionamento.',
    minDelayMs: 25_000, maxDelayMs: 90_000, sessionSize: 30, sessionBreakMs: 480_000,
    typingEnabled: true, readReceipts: true, dailyCapStart: 40, dailyCapMax: 250,
  },
  {
    name: 'Agressivo',
    description: '12s a 45s. Risco real de bloqueio — só com número antigo e lista que pediu contato.',
    minDelayMs: 12_000, maxDelayMs: 45_000, sessionSize: 45, sessionBreakMs: 300_000,
    typingEnabled: true, readReceipts: true, dailyCapStart: 80, dailyCapMax: 250,
  },
]

/** Cria os perfis de sistema se ainda não existirem. Idempotente. */
export async function seedSystemProfiles(): Promise<void> {
  for (const p of SYSTEM_PROFILES) {
    await prisma.smartPacingProfile.upsert({
      where: { name: p.name },
      create: { ...p, isSystem: true, warmupCurve: DEFAULT_WARMUP_CURVE },
      // Perfil de sistema é atualizado no código (descrição/valores podem melhorar);
      // perfil do usuário nunca é tocado aqui, porque o `where` é pelo nome exato.
      update: { ...p, isSystem: true, warmupCurve: DEFAULT_WARMUP_CURVE },
    }).catch(() => {})
  }
}

export async function listProfiles() {
  return prisma.smartPacingProfile.findMany({ orderBy: [{ isSystem: 'desc' }, { minDelayMs: 'desc' }] })
}

/** Converte um perfil salvo no formato que o motor consome. */
export function toPacingConfig(profile: {
  minDelayMs: number; maxDelayMs: number; sessionSize: number
  sessionBreakMs: number; typingEnabled: boolean; readReceipts: boolean
}): PacingConfig {
  return {
    minDelayMs: profile.minDelayMs,
    maxDelayMs: profile.maxDelayMs,
    sessionSize: profile.sessionSize,
    sessionBreakMs: profile.sessionBreakMs,
    typingEnabled: profile.typingEnabled,
    readReceipts: profile.readReceipts,
  }
}
