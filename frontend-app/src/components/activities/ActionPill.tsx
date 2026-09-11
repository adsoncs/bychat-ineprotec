import { cn } from '@/lib/cn'

export type PillTone = 'neutral' | 'success' | 'danger' | 'info' | 'muted'

const TONES: Record<PillTone, string> = {
  neutral: 'border-border bg-surface text-fg-muted hover:bg-surface-3 hover:text-fg',
  success: 'border-success/40 bg-success/10 text-success hover:bg-success/20',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
  info: 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
  muted: 'border-border bg-surface text-fg-muted hover:bg-surface-3',
}

/**
 * Um botão de ação da lista de atividades.
 *
 * Existe para que TODAS as ações da linha — as do contato e as da tarefa —
 * tenham exatamente a mesma forma. Antes, "Concluir" era o único fora do menu
 * `⋯` e destoava do resto; harmonia aqui não é enfeite, é o que faz a fileira
 * ser lida como um conjunto de opções em vez de um botão solto ao lado de um
 * menu escondido.
 *
 * Vira `<a>` quando o destino é externo ao painel (`tel:`, `mailto:`) e
 * `<button>` quando a ação acontece aqui dentro.
 */
export function ActionPill({
  icone, rotulo, titulo, tone = 'neutral', onClick, href, disabled,
}: {
  icone: preact.ComponentChildren
  rotulo: string
  titulo: string
  tone?: PillTone
  onClick?: () => void
  href?: string
  disabled?: boolean
}) {
  const classe = cn(
    'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-2xs font-medium transition-colors',
    TONES[tone],
    disabled && 'opacity-50 pointer-events-none',
  )

  // `stopPropagation`: a linha pode ganhar clique próprio, e uma ação que
  // dispara duas coisas ao mesmo tempo é pior que não ter ação.
  if (href) {
    return (
      <a href={href} class={classe} title={titulo} onClick={(e) => e.stopPropagation()}>
        {icone}{rotulo}
      </a>
    )
  }
  return (
    <button
      type="button"
      class={classe}
      title={titulo}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
    >
      {icone}{rotulo}
    </button>
  )
}
