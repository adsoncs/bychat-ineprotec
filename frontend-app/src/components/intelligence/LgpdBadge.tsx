import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-preact'
import { Badge } from '@/components/ui/Badge'
import type { LgpdConsentSource } from '@/hooks/useIntelligence'

interface LgpdBadgeProps {
  consent: boolean
  source?: LgpdConsentSource
  compact?: boolean
}

/**
 * Badge único e honesto sobre o estado LGPD do lead.
 *   - Sem consent → 'Sem LGPD' (vermelho)
 *   - Consent vindo do titular → 'LGPD ✓' (verde)
 *   - Consent dado por operador em massa → 'LGPD (override)' (laranja, sinaliza risco)
 *   - Consent legado (antes da migração) → 'LGPD (legacy)' (cinza, recomenda revalidar)
 */
export function LgpdBadge({ consent, source, compact = false }: LgpdBadgeProps) {
  if (!consent) {
    return (
      <Badge tone="danger" solid>
        <ShieldX size={10} class="mr-0.5" />
        {compact ? '✕' : 'Sem LGPD'}
      </Badge>
    )
  }
  if (source === 'operator_override') {
    return (
      <Badge tone="warning" solid>
        <ShieldAlert size={10} class="mr-0.5" />
        {compact ? 'OV' : 'LGPD (override)'}
      </Badge>
    )
  }
  if (source === 'legacy') {
    return (
      <Badge tone="neutral" solid>
        <ShieldCheck size={10} class="mr-0.5" />
        {compact ? 'LG' : 'LGPD (legacy)'}
      </Badge>
    )
  }
  // titular ou null (consent antes da coluna existir, mas verdadeiro)
  return (
    <Badge tone="success" solid>
      <ShieldCheck size={10} class="mr-0.5" />
      {compact ? '✓' : 'LGPD ✓'}
    </Badge>
  )
}

export function lgpdSourceLabel(source: LgpdConsentSource): string {
  switch (source) {
    case 'titular': return 'Titular consentiu'
    case 'operator_override': return 'Override do operador (base legal própria)'
    case 'legacy': return 'Consent anterior à auditoria — revalidar se questionado'
    default: return 'Sem origem registrada'
  }
}
