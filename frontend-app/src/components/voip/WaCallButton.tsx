// Botão "Ligar via WhatsApp" — inicia uma chamada de voz de saída (WebRTC).
// Reutilizável: basta o telefone do cliente (o backend resolve a conexão Cloud API).
// Sem opt-in do cliente, o backend responde no_permission e oferecemos enviar o pedido.
import { useState } from 'preact/hooks'
import { Phone } from 'lucide-preact'
import { startOutbound, requestCallPermission } from '@/lib/waCallManager'
import { useWaCall } from '@/stores/waCall'
import { env } from '@/lib/env'
import { cn } from '@/lib/cn'

interface WaCallButtonProps {
  phone: string
  leadId?: number | null
  cloudApiConnectionId?: number | null
  class?: string
  label?: string
}

export function WaCallButton({ phone, leadId = null, cloudApiConnectionId = null, class: className, label }: WaCallButtonProps) {
  const [busy, setBusy] = useState(false)
  const inCall = useWaCall((s) => s.call !== null)

  // Oculto até a Calling API ser habilitada (Meta + backend) — ver env.waCalling.
  if (!env.waCalling) return null

  async function onClick() {
    if (busy || inCall || !phone) return
    setBusy(true)
    try {
      const res = await startOutbound(phone, cloudApiConnectionId, leadId)
      if (!res.ok && res.error === 'no_permission') {
        const ask = window.confirm(
          'O cliente ainda não autorizou chamadas pelo WhatsApp.\n\nEnviar um pedido de permissão agora?'
        )
        if (ask) {
          const p = await requestCallPermission(phone, cloudApiConnectionId)
          window.alert(p.ok ? 'Pedido de permissão enviado.' : `Falha ao enviar: ${p.error || 'erro'}`)
        }
      } else if (!res.ok) {
        window.alert(`Não foi possível ligar: ${res.error || 'erro'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || inCall}
      title="Ligar via WhatsApp"
      class={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
        'bg-[#25D366]/15 text-[#128C7E] hover:bg-[#25D366]/25 disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      <Phone size={15} />
      {label ?? 'Ligar'}
    </button>
  )
}
