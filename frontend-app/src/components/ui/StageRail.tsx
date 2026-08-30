import { cn } from '@/lib/cn'

interface Stage {
  key: string
  name: string
  color?: string | null | undefined
  terminalKind?: 'won' | 'lost' | null | undefined
}

interface StageRailProps {
  /** Etapas do funil, na ordem. Use a lista que já vem de `useFunnels`/`useKanban`. */
  stages: Stage[]
  /** `key` da etapa atual do lead (o campo `status`). */
  current: string | null | undefined
  /** Esconde o nome ao lado — para colunas estreitas. */
  hideLabel?: boolean | undefined
  class?: string | undefined
}

/** Etapa perdida é vermelha mesmo que o funil tenha lhe dado outra cor: o
 *  desfecho vale mais que a decoração. Ganha usa verde pela mesma razão. */
function stageColor(stage: Stage | undefined): string {
  if (!stage) return 'var(--color-fg-muted)'
  if (stage.terminalKind === 'lost') return 'var(--color-danger)'
  if (stage.terminalKind === 'won') return 'var(--color-success)'
  if (stage.color && /^#[0-9a-f]{3,8}$/i.test(stage.color)) return stage.color
  return 'var(--color-accent)'
}

/**
 * Posição do lead no funil, como trilho de segmentos.
 *
 * O ganho é ler a lista sem ler a lista: com o nome da etapa sozinho, descobrir
 * se "Proposta enviada" vem antes ou depois de "Reunião marcada" exige conhecer
 * o funil de cor. O trilho mostra quanto do caminho já foi andado, e o olho
 * compara vinte linhas de uma vez.
 *
 * Um funil pode ter muitas etapas; acima de 6 o trilho vira uma serra ilegível,
 * então os segmentos são COMPRIMIDOS proporcionalmente em no máximo 6 — a
 * proporção preenchida continua verdadeira, só a granularidade cai.
 */
export function StageRail({ stages, current, hideLabel = false, class: className }: StageRailProps) {
  const active = stages.filter((s) => s.key)
  const idx = active.findIndex((s) => s.key === current)
  const stage = idx >= 0 ? active[idx] : undefined
  const color = stageColor(stage)
  // A cor do NOME não é a cor do funil. As cores das etapas são escolhidas pelo
  // tenant (as mesmas pintam o Kanban) e são tons de paleta web: sobre o card
  // branco medem entre 2,3:1 e 4,2:1, e texto pequeno exige 4,5:1. Então o nome
  // usa a cor de texto do sistema, e a cor do funil fica nos segmentos — onde
  // ela é redundante, porque o nome está logo ao lado. Desfecho é exceção: ali
  // a cor é semântica e vem de token já calibrado nos dois temas.
  const labelColor =
    stage?.terminalKind === 'lost' ? 'var(--color-danger)'
    : stage?.terminalKind === 'won' ? 'var(--color-success)'
    : 'var(--color-fg)'

  const total = active.length
  const segments = Math.min(6, Math.max(total, 1))
  // +1 porque estar NA primeira etapa já é um segmento andado.
  const filled = idx < 0 ? 0 : Math.max(1, Math.round(((idx + 1) / Math.max(total, 1)) * segments))

  return (
    <span class={cn('inline-flex items-center gap-2', className)}>
      <span class="inline-flex gap-px" aria-hidden="true">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            class="h-1 w-3 rounded-full"
            style={{ background: i < filled ? color : 'var(--color-border-strong)' }}
          />
        ))}
      </span>
      {!hideLabel && (
        <span class="text-xs font-medium truncate" style={{ color: labelColor }}>
          {stage?.name ?? '—'}
        </span>
      )}
    </span>
  )
}
