// Widget de chamada de voz WhatsApp (WebRTC). Diferente do CallWidget (FaleMais),
// aqui o áudio roda no navegador — então o widget controla atender/recusar/mudo/desligar.
import { useEffect, useState } from 'preact/hooks'
import { Phone, PhoneOff, Mic, MicOff } from '@/components/ui/icon-set'
import { useWaCall } from '@/stores/waCall'
import { acceptIncoming, rejectIncoming, hangup, toggleMute, retryPermission, cancelCall } from '@/lib/waCallManager'
import { cn } from '@/lib/cn'

const STATUS_LABEL: Record<string, string> = {
  ringing: 'Chamada recebida no WhatsApp',
  requesting_permission: 'Permitindo microfone…',
  permission_denied: 'Microfone bloqueado',
  connecting: 'Conectando…',
  active: 'Em chamada',
  ended: 'Encerrada',
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function WaCallWidget() {
  const call = useWaCall((s) => s.call)
  const muted = useWaCall((s) => s.muted)
  const [elapsed, setElapsed] = useState(0)

  const active = call?.status === 'active'
  const startedAt = call?.startedAt ?? null

  useEffect(() => {
    if (!active || !startedAt) return
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [active, startedAt])

  if (!call) return null

  const isRinging = call.status === 'ringing' && call.direction === 'incoming'
  const isTerminal = call.status === 'ended'
  const title = call.from || 'Ligação WhatsApp'

  return (
    <div class="fixed bottom-4 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-2.5 bg-[#25D366] text-white">
        <span class={cn('inline-flex items-center justify-center size-7 rounded-full bg-white/20', !isTerminal && 'animate-pulse')}>
          {isTerminal ? <PhoneOff size={15} /> : <Phone size={15} />}
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate">{title}</div>
          <div class="text-2xs opacity-90">
            {STATUS_LABEL[call.status] || call.status}
            {call.direction === 'outgoing' && call.status === 'connecting' ? ' (saída)' : ''}
          </div>
        </div>
        {active && <div class="text-xs font-mono tabular-nums">{fmt(elapsed)}</div>}
      </div>

      <div class="px-4 py-3">
        {call.error && <div class="mb-2 text-xs text-danger">{call.error}</div>}

        <div class="flex items-center justify-center gap-3">
          {call.status === 'permission_denied' ? (
            <>
              <button
                type="button"
                onClick={() => void retryPermission()}
                class="inline-flex items-center gap-1.5 rounded-full bg-success px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                <Mic size={16} /> Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => cancelCall()}
                class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-surface-3"
              >
                Cancelar
              </button>
            </>
          ) : call.status === 'requesting_permission' ? (
            <>
              <span class="text-sm text-fg-muted">Aguardando permissão do microfone…</span>
              <button
                type="button"
                onClick={() => cancelCall()}
                class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-3"
              >
                Cancelar
              </button>
            </>
          ) : isRinging ? (
            <>
              <button
                type="button"
                onClick={() => void acceptIncoming()}
                class="inline-flex items-center gap-1.5 rounded-full bg-success px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                <Phone size={16} /> Atender
              </button>
              <button
                type="button"
                onClick={() => void rejectIncoming()}
                class="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                <PhoneOff size={16} /> Recusar
              </button>
            </>
          ) : isTerminal ? (
            <span class="text-sm text-fg-muted">Chamada encerrada</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => toggleMute()}
                class={cn(
                  'inline-flex items-center justify-center size-10 rounded-full border border-border',
                  muted ? 'bg-warning/15 text-warning' : 'bg-surface-2 text-fg'
                )}
                title={muted ? 'Reativar microfone' : 'Mutar'}
              >
                {muted ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
              <button
                type="button"
                onClick={() => void hangup()}
                class="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                <PhoneOff size={16} /> Desligar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
