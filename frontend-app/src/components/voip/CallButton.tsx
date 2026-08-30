import { Phone, Loader2 } from '@/components/ui/icon-set'
import { useDialLead } from '@/hooks/useVoip'
import { useModuleAccess } from '@/hooks/usePermissions'
import { useActiveCall } from '@/stores/voipCall'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/cn'

interface CallButtonProps {
  leadId?: number | undefined
  phone?: string | null | undefined
  compact?: boolean
  class?: string
  label?: string
}

// Botão de click-to-call. Só aparece se o módulo VoIP estiver ativo e o operador
// tiver permissão de criar. A ligação toca no ramal do operador e depois disca o
// número do lead (resolução do ramal acontece no backend).
export function CallButton({ leadId, phone, compact, class: className, label }: CallButtonProps) {
  const access = useModuleAccess('voip', 'create')
  const dial = useDialLead()
  const startCall = useActiveCall((s) => s.startCall)
  const noPhone = !phone || !phone.replace(/\D/g, '')

  if (access.status !== 'allowed') return null

  function handleClick(e: Event) {
    e.stopPropagation()
    if (noPhone) return
    dial.mutate(
      { leadId, phone: phone as string },
      {
        onSuccess: (r) => {
          if (r.ok) {
            if (r.call?.id) startCall(r.call.id)
            toast('Ligação iniciada — atenda no seu ramal', 'success')
          } else toast(r.error || 'Não foi possível ligar', 'danger')
        },
        onError: (err: unknown) => toast((err as Error).message, 'danger'),
      },
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={noPhone || dial.isPending}
      title={noPhone ? 'Lead sem telefone cadastrado' : 'Ligar via ramal VoIP'}
      aria-label={label ?? 'Ligar'}
      class={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        // Era um azul fixo (#1a73e8), fora da paleta e mais alto que os vizinhos.
        compact
          ? 'h-8 w-8 p-0 bg-accent text-fg-on-brand shadow-sm'
          : 'h-8 px-3 text-xs bg-surface-2 text-fg border border-border surface-raised hover:bg-surface-3',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    >
      {dial.isPending ? <Loader2 size={compact ? 16 : 13} class="animate-spin" /> : <Phone size={compact ? 16 : 13} />}
      {!compact && (label ?? 'Ligar')}
    </button>
  )
}
