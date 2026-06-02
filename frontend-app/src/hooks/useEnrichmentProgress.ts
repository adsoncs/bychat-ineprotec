import { useEffect, useState } from 'preact/hooks'
import { onServerEvent } from '@/lib/realtime'

export interface EnrichmentProgress {
  provider: string
  index: number
  total: number
  factsSoFar: number
  at: number
}

/**
 * Ouve eventos WS lead:enrichment_started/progress/completed para o lead dado
 * e devolve o último progresso recebido. Limpa quando o enrichment completa.
 */
export function useEnrichmentProgress(leadId: number | null): EnrichmentProgress | null {
  const [progress, setProgress] = useState<EnrichmentProgress | null>(null)

  useEffect(() => {
    if (leadId === null) return
    setProgress(null)
    const off = onServerEvent((ev) => {
      const p = ev.payload as { leadId?: number; provider?: string; index?: number; total?: number; factsSoFar?: number } | undefined
      if (p?.leadId !== leadId) return
      if (ev.type === 'lead:enrichment_started') {
        setProgress({ provider: '', index: 0, total: 0, factsSoFar: 0, at: Date.now() })
      } else if (ev.type === 'lead:enrichment_progress') {
        if (typeof p.provider === 'string' && typeof p.index === 'number' && typeof p.total === 'number') {
          setProgress({
            provider: p.provider,
            index: p.index,
            total: p.total,
            factsSoFar: p.factsSoFar ?? 0,
            at: Date.now(),
          })
        }
      } else if (ev.type === 'lead:enrichment_completed') {
        setProgress(null)
      }
    })
    return off
  }, [leadId])

  return progress
}
