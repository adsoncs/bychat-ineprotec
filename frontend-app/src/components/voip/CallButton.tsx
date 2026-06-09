import { Phone, Loader2 } from 'lucide-preact'
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
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors shadow-sm',
        'bg-[#1a73e8] hover:bg-[#1666cc] text-white',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        compact ? 'h-8 w-8 p-0' : 'h-9 px-3 text-xs',
        className,
      )}
    >
      {dial.isPending ? <Loader2 size={compact ? 16 : 14} class="animate-spin" /> : <Phone size={compact ? 16 : 14} />}
      {!compact && (label ?? 'Ligar')}
    </button>
  )
}
